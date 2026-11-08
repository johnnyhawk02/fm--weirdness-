// The complete instrument: master saw, four slave saws, four step sequencers, random-walk
// modulators and the FM voice. Everything runs per sample; nothing depends on timers or the DOM.
// Deterministic: the same patch + seed renders bit-identical audio regardless of block size.
import { Dynamics } from './dynamics.js';
import { LowPass } from './filter.js';
import { Rng, hashSeed } from './rng.js';
import { Voice } from './voice.js';
import { OpSequencer, mutateSteps } from './sequencer.js';
import { MULT_PRESETS, MOD_TARGETS, noteToHz, masterRateHz, NUM_OPS, ALGORITHMS } from './params.js';

const TWO_PI = Math.PI * 2;

const CTRL = 32;                 // control-rate interval in samples
const LN_MINUS_60DB = Math.log(0.001);
const RETRIGGER_FADE = 64;       // samples
const ALGO_FADE_SEC = 0.004;

function decayCoef(sec, sr) { return Math.exp(LN_MINUS_60DB / (Math.max(0.001, sec) * sr)); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export class Engine {
  constructor(sr) {
    this.sr = sr;
    this.voice = new Voice(sr);
    this.tail = new Voice(sr);
    this.rngClock = new Rng(1);
    this.rngMod = new Rng(1);
    this.rngSeq = Array.from({ length: NUM_OPS }, () => new Rng(1));
    this.rngMut = Array.from({ length: NUM_OPS }, () => new Rng(1));
    this.rngDrift = Array.from({ length: NUM_OPS }, () => new Rng(1));
    this.seqs = this.rngSeq.map((r) => new OpSequencer(r));
    // per-sample voice inputs
    this.freq = new Float64Array(NUM_OPS);
    this.gain = new Float64Array(NUM_OPS);
    this.attInc = new Float64Array(NUM_OPS);
    this.decCoef = new Float64Array(NUM_OPS);
    // control-rate effective values
    this.levelEff = new Float64Array(NUM_OPS);
    this.ratioEff = new Float64Array(NUM_OPS);
    this.ratioSm = new Float64Array(NUM_OPS);
    this.cPanL = new Float64Array(NUM_OPS).fill(Math.SQRT1_2); // per-operator carrier placement
    this.cPanR = new Float64Array(NUM_OPS).fill(Math.SQRT1_2);
    this.cPos = new Float64Array(NUM_OPS);
    this.dcWork = new Float64Array(NUM_OPS);
    this.balL = new Float64Array(NUM_OPS).fill(1); // per-operator modulation balance into carrier pairs
    this.balR = new Float64Array(NUM_OPS).fill(1);
    this.opPan = new Float64Array(NUM_OPS);
    this.rotPhase = 0;   // slewed ratio (pitch faders glide)
    this.fixedSm = new Float64Array(NUM_OPS);   // slewed fixed frequency
    this.decEff = new Float64Array(NUM_OPS);
    this.seqAmtEff = new Float64Array(NUM_OPS);
    this.lockDecCoef = new Float64Array(NUM_OPS);
    // slave saws
    this.sPhase = new Float64Array(NUM_OPS);
    this.sK = new Float64Array(NUM_OPS);
    this.sBaseOff = new Float64Array(NUM_OPS);
    this.sBasePos = new Float64Array(NUM_OPS);
    this.sResetCycle = new Float64Array(NUM_OPS);
    this.sValue = new Float64Array(NUM_OPS);
    this.drift = new Float64Array(NUM_OPS);
    this.driftTarget = new Float64Array(NUM_OPS);
    // modulators
    this.modVal = new Float64Array(4);
    this.modTarget = new Float64Array(4);
    this.modTimer = new Float64Array(4);
    this.modPhase = new Float64Array(4);
    this.effMult = new Float64Array(NUM_OPS);   // multiplier after LFO rate modulation
    this.rateMod = new Float64Array(NUM_OPS);
    this.effHz = new Float64Array(NUM_OPS);     // free clock rate after LFO modulation
    this.dirtyOps = new Array(NUM_OPS).fill(false);
    this.dyn = new Dynamics(sr);
    this.lp = new LowPass(sr); this.cutSm = 20000;
    // SMOOTH: de-click smoothing on operator gain and pitch, set at control rate from voice.smooth
    this.gainSm = new Float64Array(NUM_OPS); this.gainK = 1 - Math.exp(-1 / (0.0012 * sr));
    this.freqSm = new Float64Array(NUM_OPS); this.freqK = 1;
    this.retrigFade = RETRIGGER_FADE; this.algoFade = ALGO_FADE_SEC; this.attFloor = 0;
    this.fbOp = new Float64Array(NUM_OPS); this.fbWork = new Float64Array(NUM_OPS); this.paths = new Float64Array(6); this._z6 = new Float64Array(NUM_OPS);
    this._z0 = new Float64Array(NUM_OPS); this._z1 = new Float64Array(NUM_OPS); this._z2 = new Float64Array(NUM_OPS);
    this._z3 = new Float64Array(NUM_OPS); this._z4 = new Float64Array(NUM_OPS); this._z5 = new Float64Array(NUM_OPS);
    this.dirtyVoice = false;
    this.onWrap = null;        // (op, sampleIndex, subSampleOffset, isReset)
    this.onMasterWrap = null;  // (cycle, sampleIndex, subSampleOffset)
    this.onTrigger = null;     // (sampleIndex)
    this.patch = null;
  }

  // Replace the patch without resetting clocks. A changed multiplier on a synced operator is
  // rebased so its saw keeps its phase instead of jumping.
  setPatch(p) {
    const old = this.patch;
    if (old && this.cycle >= 0) {
      for (let i = 0; i < NUM_OPS; i++) {
        const o = old.ops[i], n = p.ops[i];
        if (n.sync && n.clock !== 1 && !(o.sync && o.clock !== 1)) { // joining sync: line up at the current master position
          const pos = (this.cycle - this.sResetCycle[i]) + this.mPhase;
          this.sBaseOff[i] = this.sPhase[i] + this.sK[i];
          this.sBasePos[i] = pos;
        }
      }
    }
    // a new seed re-seeds the random streams in place, so the clocks keep running
    const reseed = old && this.cycle >= 0 && (old.seed >>> 0) !== (p.seed >>> 0);
    this.patch = p;
    if (reseed) this._seedStreams();
  }

  _seedStreams() {
    const seed = this.patch.seed >>> 0;
    this.rngClock.seed(hashSeed(seed, 'clock'));
    this.rngMod.seed(hashSeed(seed, 'mod'));
    for (let i = 0; i < NUM_OPS; i++) {
      this.rngSeq[i].seed(hashSeed(seed, 'seq', i));
      this.rngMut[i].seed(hashSeed(seed, 'mut', i));
      this.rngDrift[i].seed(hashSeed(seed, 'drift', i));
    }
  }

  reset() {
    this._seedStreams();
    this.dyn.reset(); this.lp.reset(); this.cutSm = this.patch.voice.cutoff ?? 20000; this.freqSm.fill(0); this.gainSm.fill(0);
    for (let i = 0; i < NUM_OPS; i++) {
      this.seqs[i].reset(this.patch.ops[i]);
      this.sPhase[i] = 0; this.sK[i] = 0; this.sBaseOff[i] = 0; this.sBasePos[i] = 0;
      this.sResetCycle[i] = 0; this.drift[i] = 0; this.driftTarget[i] = 0; this.sValue[i] = 0;
      this.modVal[i] = 0; this.modTarget[i] = 0; this.modTimer[i] = 0; this.modPhase[i] = 0;
      this.effMult[i] = this.patch.ops[i].mult; this.rateMod[i] = 0;
      this.ratioSm[i] = 0; this.fixedSm[i] = 0;
    }
    this.voice = new Voice(this.sr);
    this.tail = new Voice(this.sr);
    this.fadePos = 1; this.fadeLen = 1;
    this.mPhase = 0; this.mInc = 0;
    this.cycle = -1;
    this.startPending = true;
    this.sample = 0;
    this.ctrlCount = 0;
    this.gateIdx = -1;
    this.outGain = 0; this.outGainTarget = 0;
    this.panL = 0.7071; this.panR = 0.7071;
    this.algoEff = this.patch.voice.algorithm;
    this.voice.algorithm = this.algoEff;
    this.fbEff = 0;
    this._control();
    this.outGain = this.outGainTarget;
  }

  // ---------- control rate ----------
  _control() {
    const p = this.patch, v = p.voice, sr = this.sr;
    const dt = CTRL / sr;

    // random-walk modulators
    let mCut = 0, mPitch = 0, mFb = 0, mP1 = 0, mP2 = 0, mAlgo = 0, mPan = 0, mClock = 0, mWidth = 0;
    const mFbOp = this._z6.fill(0), mPanOp = this._z5.fill(0), mLevel = this._z0.fill(0), mRatio = this._z1.fill(0), mDecay = this._z2.fill(0), mSeq = this._z3.fill(0), mRate = this._z4.fill(0);
    for (let m = 0; m < 4; m++) {
      const md = p.mods[m];
      const rate = Math.max(0.005, md.rate);
      const shape = md.shape | 0;
      let raw;
      if (shape === 0) { // smooth random walk
        this.modTimer[m] -= dt;
        if (this.modTimer[m] <= 0) {
          this.modTimer[m] += 1 / rate;
          this.modTarget[m] = clamp(this.modTarget[m] + this.rngMod.bipolar() * 0.9, -1, 1);
        }
        raw = this.modTarget[m];
      } else { // periodic LFO
        let ph = this.modPhase[m] + rate * dt;
        ph -= Math.floor(ph);
        this.modPhase[m] = ph;
        if (shape === 1) raw = Math.sin(TWO_PI * ph);
        else if (shape === 2) raw = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
        else if (shape === 3) raw = 2 * ph - 1;
        else raw = ph < 0.5 ? 1 : -1;
      }
      // smooth: slew time as a fraction of one period
      const tau = md.smooth / rate * (shape === 0 ? 0.5 : 0.15);
      const k = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
      this.modVal[m] += (raw - this.modVal[m]) * k;
      if (!md.on || md.target === 'off') continue;
      const x = this.modVal[m] * md.depth;
      const t = md.target;
      if (t === 'pitch') mPitch += x;
      else if (t === 'feedback') mFb += x;
      else if (t === 'cutoff') mCut += x;
      else if (t === 'fb1') mP1 += x;
      else if (t === 'fb2') mP2 += x;
      else if (t === 'algorithm') mAlgo += x;
      else if (t === 'pan') mPan += x;
      else if (t === 'clock') mClock += x;
      else if (t === 'width') mWidth += x;
      else {
        const oi = t.charCodeAt(0) - 65, key = t.slice(2);
        if (key === 'level') mLevel[oi] += x;
        else if (key === 'ratio') mRatio[oi] += x;
        else if (key === 'decay') mDecay[oi] += x;
        else if (key === 'seqAmount') mSeq[oi] += x;
        else if (key === 'rate') mRate[oi] += x;
        else if (key === 'pan') mPanOp[oi] += x;
        else if (key === 'fb') mFbOp[oi] += x;
      }
    }

    // master rate: depth 1 = +-3 octaves
    this.mInc = masterRateHz(p.clock) * Math.pow(2, mClock * 3) / sr;

    // per-operator sequencer rate: depth 1 = +-3 octaves. Synced saws are rebased so the
    // phase stays continuous while the rate moves.
    for (let i = 0; i < NUM_OPS; i++) {
      const op = p.ops[i];
      this.rateMod[i] = mRate[i];
      const em = Math.min(256, Math.max(1 / 256, op.mult * (mRate[i] !== 0 ? Math.pow(2, mRate[i] * 3) : 1)));
      this.effHz[i] = Math.min(400, Math.max(0.001, (op.hz || 1) * (mRate[i] !== 0 ? Math.pow(2, mRate[i] * 3) : 1)));
      if (em !== this.effMult[i]) {
        if (op.sync && this.cycle >= 0) this._rebase(i);
        this.effMult[i] = em;
      }
    }

    // voice
    const baseHz = v.pitchMode === 'hz' ? v.hz : noteToHz(v.note);
    this.voiceHz = baseHz * Math.pow(2, mPitch);          // depth 1 = +-1 octave
    this.fbEff = clamp(v.feedback + mFb + mFbOp[NUM_OPS - 1], -1, 1);
    for (let i = 0; i < NUM_OPS - 1; i++) this.fbOp[i] = clamp((p.ops[i].fb || 0) + mFbOp[i], -1, 1);
    this.fbOp[NUM_OPS - 1] = this.fbEff;
    const ps = v.paths || [], pm = [mP1, mP2];
    for (let k = 0; k < 2; k++) {
      const q = ps[k];
      this.paths[k * 3] = q ? q.from | 0 : 0; this.paths[k * 3 + 1] = q ? q.to | 0 : 0;
      this.paths[k * 3 + 2] = q ? clamp(q.amt + pm[k], -1, 1) : 0;
    }
    this.pitchSemis = v.pitchEnvSemis;
    this.pitchCoef = Math.exp(-1 / (Math.max(0.001, v.pitchEnvDecay) * sr));
    const NA = ALGORITHMS.length;
    const algo = ((((v.algorithm | 0) + Math.round(mAlgo * 8)) % NA) + NA) % NA;
    if (algo !== this.algoEff) this._switchAlgorithm(algo);
    // master balance (keeps the stereo image, never boosts)
    const pan = clamp(v.pan + mPan, -1, 1);
    this.panL = pan > 0 ? 1 - pan : 1; this.panR = pan < 0 ? 1 + pan : 1;
    for (let i = 0; i < NUM_OPS; i++) {
      const op = p.ops[i];
      const pp = clamp((op.pan || 0) + mPanOp[i], -1, 1);
      this.opPan[i] = pp;
      this.balL[i] = pp > 0 ? 1 - pp : 1; this.balR[i] = pp < 0 ? 1 + pp : 1;
    }
    this._stereo(clamp((v.width ?? 0.8) + mWidth, 0, 1), dt);
    this.outGainTarget = clamp(v.level, 0, 1);
    if ((v.comp ?? 0.6) !== this.dyn.amount) this.dyn.setAmount(v.comp ?? 0.6);
    // SMOOTH 0..1: longer gain / pitch glides, softer attacks and longer retrigger crossfades
    const sm = clamp(v.smooth ?? 0.25, 0, 1);
    this.gainK = 1 - Math.exp(-1 / ((0.001 + 0.03 * sm) * sr));
    this.freqK = sm <= 0 ? 1 : 1 - Math.exp(-1 / (0.025 * sm * sr));
    this.attFloor = 0.02 * sm;
    this.retrigFade = Math.round(RETRIGGER_FADE + 0.03 * sm * sr);
    this.algoFade = ALGO_FADE_SEC + 0.06 * sm;
    // low-pass filter: LFO depth 1 = +-4 octaves; cutoff glides at control rate
    const cut = clamp((v.cutoff ?? 20000) * Math.pow(2, mCut * 4), 30, 20000);
    this.cutSm += (cut - this.cutSm) * 0.3;
    this.lp.set(this.cutSm, v.reso ?? 0);

    for (let i = 0; i < NUM_OPS; i++) {
      const op = p.ops[i];
      this.levelEff[i] = clamp(op.level + mLevel[i], 0, 1);
      this.ratioEff[i] = op.ratio * Math.pow(2, mRatio[i] * 2 + op.fine / 1200);
      // pitch slew: glide in the log (musical) domain
      const slew = (op.slew ?? v.pitchSlew ?? 0.4) * (v.slewScale ?? 1);
      const ks = slew <= 0 || !(this.ratioSm[i] > 0) ? 1 : 1 - Math.exp(-dt / slew);
      const tr = this.ratioEff[i], tf = op.fixedHz;
      this.ratioSm[i] = ks >= 1 ? tr : this.ratioSm[i] * Math.pow(tr / this.ratioSm[i], ks);
      this.fixedSm[i] = ks >= 1 || !(this.fixedSm[i] > 0) ? tf : this.fixedSm[i] * Math.pow(tf / this.fixedSm[i], ks);
      this.decEff[i] = op.decay * Math.pow(2, mDecay[i] * 3);
      this.decCoef[i] = decayCoef(this.decEff[i], sr);
      this.attInc[i] = 1 / (Math.max(0.0002, op.attack, this.attFloor) * sr);
      this.seqAmtEff[i] = clamp(op.seqAmount + mSeq[i], 0, 1);
      // drift: slow random walk on free-running slave rate
      if (op.drift > 0 && (op.clock === 1 || !op.sync)) {
        if (this.rngDrift[i].next() < dt * 2) this.driftTarget[i] = this.rngDrift[i].bipolar();
        this.drift[i] += (this.driftTarget[i] - this.drift[i]) * (1 - Math.exp(-dt / 0.8));
      } else {
        this.drift[i] = 0;
      }
    }
  }

  // Place each carrier of the current algorithm in the stereo field.
  _stereo(width, dt) {
    const v = this.patch.voice, mode = v.stereo | 0;
    this.rotPhase += (v.rotate || 0) * dt;
    this.rotPhase -= Math.floor(this.rotPhase);
    const c = ALGORITHMS[this.algoEff].carriers, n = c.length;
    this.cPos.fill(0);
    for (let k = 0; k < n; k++) {
      let p = 0;
      if (mode === 0) p = n > 1 ? -1 + 2 * k / (n - 1) : 0;                 // spread evenly
      else if (mode === 1) p = n > 1 ? (k % 2 ? 1 : -1) : 0;                // alternate hard L / R
      else if (mode === 2) p = n > 1 ? (k % 2 ? 1 : -1) * (1 - Math.floor(k / 2) / Math.ceil(n / 2)) : 0; // mirrored pairs
      else if (mode === 3) p = ((hashSeed(this.patch.seed, this.algoEff, k) & 0xffff) / 32767.5) - 1; // fixed random places
      else if (mode === 4) p = Math.sin(2 * Math.PI * (this.rotPhase + k / Math.max(1, n)));        // rotate around
      this.cPos[c[k]] = clamp(p * width + this.opPan[c[k]], -1, 1); // mode placement + the carrier's own pan
    }
    for (let j = 0; j < NUM_OPS; j++) {
      const a = (this.cPos[j] + 1) * Math.PI / 4;
      this.cPanL[j] = Math.cos(a); this.cPanR[j] = Math.sin(a);
    }
  }

  _switchAlgorithm(algo) {
    this.tail.copyFrom(this.voice);
    this.voice.algorithm = algo;
    this.algoEff = algo;
    this.fadePos = 0;
    this.fadeLen = Math.max(1, Math.round(this.algoFade * this.sr));
  }

  _trigger(offset) {
    this.tail.copyFrom(this.voice);
    let keep = 0;
    for (let i = 0; i < NUM_OPS; i++) if (this.patch.ops[i].clock === 1) keep |= 1 << i;
    this.voice.trigger(offset, keep);
    this.fadePos = 0;
    this.fadeLen = this.retrigFade;
    if (this.onTrigger) this.onTrigger(this.sample);
  }

  _slavePos(i) {
    const pos = (this.cycle - this.sResetCycle[i]) + this.mPhase;
    return this.sBaseOff[i] + (pos - this.sBasePos[i]) * this.effMult[i];
  }

  // keep the synced saw's current position, so a new multiplier continues from here
  _rebase(i) {
    this.sBaseOff[i] = this._slavePos(i);
    this.sBasePos[i] = (this.cycle - this.sResetCycle[i]) + this.mPhase;
  }

  _onMasterWrap(offset) {
    this.cycle++;
    const p = this.patch, c = this.cycle;
    if (this.onMasterWrap) this.onMasterWrap(c, this.sample, offset);
    if (c === 0) return;
    const r = this.rngClock;
    // algorithm switching
    const ac = p.rnd.algoChance;
    const ra = r.next(), rb = r.next();
    if (ac > 0 && ra < ac) {
      let n = Math.floor(rb * (ALGORITHMS.length - 1));
      if (n >= p.voice.algorithm) n++;
      p.voice.algorithm = n;
      this.dirtyVoice = true;
      // the next control tick moves algoEff (with the crossfade)
    }
    for (let i = 0; i < NUM_OPS; i++) {
      const op = p.ops[i];
      // multiplier jump
      const rj = r.next(), rs = r.next();
      if (op.clock !== 1 && op.jumpChance > 0 && rj < op.jumpChance && op.jumpSet.length) {
        const nm = MULT_PRESETS[op.jumpSet[Math.floor(rs * op.jumpSet.length)]];
        if (nm !== op.mult) {
          if (op.sync) this._rebase(i); // phase stays continuous
          op.mult = nm;
          this.effMult[i] = Math.min(256, Math.max(1 / 256, nm * (this.rateMod[i] !== 0 ? Math.pow(2, this.rateMod[i] * 3) : 1)));
          this.dirtyOps[i] = true;
        }
      }
      // mutation
      if (op.mutateK > 0 && c % Math.max(1, op.mutateEvery) === 0) {
        if (mutateSteps(op, op.mutateK, this.rngMut[i])) this.dirtyOps[i] = true;
      }
    }
  }

  // ---------- audio rate ----------
  process(outL, outR, n) {
    const p = this.patch;
    if (!p) { outL.fill(0); outR.fill(0); return; }
    const ops = p.ops, seqs = this.seqs;
    const clk = p.clock;
    for (let s = 0; s < n; s++) {
      if (this.ctrlCount <= 0) { this._control(); this.ctrlCount = CTRL; }
      this.ctrlCount--;

      // master saw
      let masterWrapped = false, mOff = 0;
      if (this.startPending) {
        this.startPending = false; masterWrapped = true; this.mPhase = 0;
      } else {
        let mp = this.mPhase + this.mInc;
        if (mp >= 1) {
          mp -= 1;
          if (mp >= 1) mp -= Math.floor(mp);
          masterWrapped = true;
          mOff = this.mInc > 0 ? mp / this.mInc : 0; // samples elapsed since the exact wrap
        }
        this.mPhase = mp;
      }
      if (masterWrapped) this._onMasterWrap(mOff);

      // slave saws + sequencers
      for (let i = 0; i < NUM_OPS; i++) {
        const op = ops[i];
        let wrapped = false, isReset = false, off = 0;
        const free = op.clock === 1;
        if (!free && op.sync) {
          if (masterWrapped && (this.cycle % Math.max(1, op.syncEvery) === 0 || !seqs[i].started)) {
            this.sResetCycle[i] = this.cycle;
            this.sBasePos[i] = 0;
            this.sBaseOff[i] = op.scatter > 0 ? this.rngClock.next() * op.scatter : 0;
            isReset = true; wrapped = true; off = mOff;
          }
          const sp = this._slavePos(i);
          const k = Math.floor(sp);
          const ph = sp - k;
          if (!isReset && k !== this.sK[i]) {
            wrapped = true;
            off = ph / (this.mInc * this.effMult[i]);
          }
          this.sK[i] = k;
          this.sPhase[i] = ph;
        } else {
          if (masterWrapped && !seqs[i].started) {
            this.sPhase[i] = 0; isReset = true; wrapped = true;
          } else {
            const inc = (free ? this.effHz[i] / this.sr : this.mInc * this.effMult[i]) * (1 + op.drift * this.drift[i]);
            let ph = this.sPhase[i] + inc;
            if (ph >= 1) {
              ph -= Math.floor(ph);
              wrapped = true;
              off = ph / inc;
            }
            this.sPhase[i] = ph;
          }
        }
        if (wrapped) {
          const sq = seqs[i];
          sq.advance(op, isReset);
          // a free sequencer is its own voice part: each fired step retriggers its operator envelope
          if (free && sq.fired && !isReset) this.voice.retrigOp(i);
          this.lockDecCoef[i] = sq.lockDecay != null ? decayCoef(sq.lockDecay, this.sr) : 0;
          if (this.onWrap) this.onWrap(i, this.sample, off, isReset);
        }
      }

      // note trigger: master wrap, or the master gate row
      if (clk.gateOn) {
        const gl = Math.max(1, Math.min(16, clk.gateLen));
        const g = Math.min(gl - 1, Math.floor(this.mPhase * gl));
        if (masterWrapped || g !== this.gateIdx) {
          this.gateIdx = g;
          if (clk.gate[g]) this._trigger(masterWrapped ? mOff : 0);
        }
      } else if (masterWrapped) {
        this._trigger(mOff);
      }

      // per-operator inputs
      const fb = this.fbWork; fb.set(this.fbOp);
      for (let i = 0; i < NUM_OPS; i++) {
        const op = ops[i], sq = seqs[i];
        const m = sq.value(this.sPhase[i]);
        this.sValue[i] = m;
        const a = this.seqAmtEff[i];
        let gain = this.levelEff[i], fmul = 1;
        if (op.dest === 0) {
          const g = !sq.fired ? 0 : (sq.depth >= 0 ? m : 1 + m);
          gain *= 1 - a + a * g;
        } else if (m !== 0 && a > 0) {
          const oct = op.destRange * 2; // ratio: +-2 octaves, pitch: +-24 semitones at range 1
          fmul = Math.pow(2, a * m * oct);
        }
        const amp = op.amp | 0;
        if (amp >= 2) gain *= 0.5 * (1 + this.modVal[amp - 2]); // level follows an LFO
        this.gainSm[i] += (gain - this.gainSm[i]) * this.gainK; // step edges (fall, gate, swell) no longer click
        this.gain[i] = this.gainSm[i];
        let base;
        if (op.ratioMode === 'fixed') base = this.fixedSm[i] * (op.dest === 2 ? fmul : 1);
        else {
          const ratio = sq.lockRatio != null ? sq.lockRatio : this.ratioSm[i];
          base = this.voiceHz * ratio * fmul;
        }
        const fs = this.freqSm[i];
        this.freq[i] = this.freqSm[i] = fs > 0 && this.freqK < 1 ? fs + (base - fs) * this.freqK : base;
        if (sq.lockFeedback != null) fb[i] = sq.lockFeedback;
      }
      const dc = this.dcWork;
      for (let i = 0; i < NUM_OPS; i++) {
        if ((ops[i].amp | 0) !== 0) dc[i] = 1;              // hold / LFO: no envelope decay
        else if (this.lockDecCoef[i] > 0) dc[i] = this.lockDecCoef[i];
        else dc[i] = this.decCoef[i];
      }

      const vc = this.voice;
      vc.render(this.freq, this.gain, this.attInc, dc, fb, this.paths, this.pitchSemis, this.pitchCoef, this.cPanL, this.cPanR, this.balL, this.balR);
      let l = vc.l, r = vc.r;
      if (this.fadePos < this.fadeLen) {
        const x = this.fadePos / this.fadeLen;
        const t = this.tail;
        t.render(this.freq, this.gain, this.attInc, dc, fb, this.paths, this.pitchSemis, this.pitchCoef, this.cPanL, this.cPanR, this.balL, this.balR);
        l = l * x + t.l * (1 - x); r = r * x + t.r * (1 - x);
        this.fadePos++;
      }

      this.outGain += (this.outGainTarget - this.outGain) * 0.002;
      const dyn = this.dyn;
      const lp = this.lp;
      lp.process(l * this.panL, r * this.panR);
      dyn.process(lp.l, lp.r);
      outL[s] = dyn.l * this.outGain;
      outR[s] = dyn.r * this.outGain;
      this.sample++;
    }
  }

  // Snapshot for the UI. Layout: [mPhase, cycle, algoEff, then per op: phase, pos, fired, mult, value,
  // then 4 modulator values].
  writeState(arr) {
    arr[0] = this.mPhase; arr[1] = this.cycle; arr[2] = this.algoEff;
    for (let i = 0; i < NUM_OPS; i++) {
      const b = 3 + i * OP_STATE;
      arr[b] = this.sPhase[i];
      arr[b + 1] = this.seqs[i].pos;
      arr[b + 2] = this.seqs[i].fired ? 1 : 0;
      arr[b + 3] = this.patch.ops[i].clock === 1 ? this.effHz[i] : this.effMult[i];
      arr[b + 4] = this.sValue[i];
      arr[b + 5] = this.patch.ops[i].ratioMode === 'fixed' ? this.fixedSm[i] : this.ratioSm[i];
    }
    for (let m = 0; m < 4; m++) arr[3 + NUM_OPS * OP_STATE + m] = this.modVal[m];
    return arr;
  }
}
export const OP_STATE = 6; // per op: phase, pos, fired, rate, seq value, current (slewed) pitch
export const STATE_SIZE = 3 + NUM_OPS * OP_STATE + 4;
export { MOD_TARGETS };
