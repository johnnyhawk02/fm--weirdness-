// The complete instrument: master saw, four slave saws, four step sequencers, random-walk
// modulators and the FM voice. Everything runs per sample; nothing depends on timers or the DOM.
// Deterministic: the same patch + seed renders bit-identical audio regardless of block size.
import { Rng, hashSeed } from './rng.js';
import { Voice } from './voice.js';
import { OpSequencer, mutateSteps } from './sequencer.js';
import { MULT_PRESETS, MOD_TARGETS, noteToHz, masterRateHz } from './params.js';

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
    this.rngSeq = [0, 1, 2, 3].map(() => new Rng(1));
    this.rngMut = [0, 1, 2, 3].map(() => new Rng(1));
    this.rngDrift = [0, 1, 2, 3].map(() => new Rng(1));
    this.seqs = this.rngSeq.map((r) => new OpSequencer(r));
    // per-sample voice inputs
    this.freq = new Float64Array(4);
    this.gain = new Float64Array(4);
    this.attInc = new Float64Array(4);
    this.decCoef = new Float64Array(4);
    // control-rate effective values
    this.levelEff = new Float64Array(4);
    this.ratioEff = new Float64Array(4);
    this.decEff = new Float64Array(4);
    this.seqAmtEff = new Float64Array(4);
    this.lockDecCoef = new Float64Array(4);
    // slave saws
    this.sPhase = new Float64Array(4);
    this.sK = new Float64Array(4);
    this.sBaseOff = new Float64Array(4);
    this.sBasePos = new Float64Array(4);
    this.sResetCycle = new Float64Array(4);
    this.sValue = new Float64Array(4);
    this.drift = new Float64Array(4);
    this.driftTarget = new Float64Array(4);
    // modulators
    this.modVal = new Float64Array(4);
    this.modTarget = new Float64Array(4);
    this.modTimer = new Float64Array(4);
    this.dirtyOps = [false, false, false, false];
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
      for (let i = 0; i < 4; i++) {
        const o = old.ops[i], n = p.ops[i];
        if (n.sync && o.sync && n.mult !== o.mult) {
          const sp = this._slavePos(i, o);
          this.sBaseOff[i] = sp;
          this.sBasePos[i] = (this.cycle - this.sResetCycle[i]) + this.mPhase;
        }
        if (n.sync && !o.sync) { // joining sync: line up at the current master position
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
    for (let i = 0; i < 4; i++) {
      this.rngSeq[i].seed(hashSeed(seed, 'seq', i));
      this.rngMut[i].seed(hashSeed(seed, 'mut', i));
      this.rngDrift[i].seed(hashSeed(seed, 'drift', i));
    }
  }

  reset() {
    this._seedStreams();
    for (let i = 0; i < 4; i++) {
      this.seqs[i].reset(this.patch.ops[i]);
      this.sPhase[i] = 0; this.sK[i] = 0; this.sBaseOff[i] = 0; this.sBasePos[i] = 0;
      this.sResetCycle[i] = 0; this.drift[i] = 0; this.driftTarget[i] = 0; this.sValue[i] = 0;
      this.modVal[i] = 0; this.modTarget[i] = 0; this.modTimer[i] = 0;
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
    this.mInc = masterRateHz(p.clock) / sr;

    // random-walk modulators
    let mPitch = 0, mFb = 0, mAlgo = 0, mPan = 0;
    const mLevel = [0, 0, 0, 0], mRatio = [0, 0, 0, 0], mDecay = [0, 0, 0, 0], mSeq = [0, 0, 0, 0];
    for (let m = 0; m < 4; m++) {
      const md = p.mods[m];
      this.modTimer[m] -= dt;
      if (this.modTimer[m] <= 0) {
        this.modTimer[m] += 1 / Math.max(0.01, md.rate);
        // drunk walk target, kept inside -1..1
        this.modTarget[m] = clamp(this.modTarget[m] + this.rngMod.bipolar() * 0.9, -1, 1);
      }
      const tau = md.smooth / Math.max(0.01, md.rate) * 0.5;
      const k = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
      this.modVal[m] += (this.modTarget[m] - this.modVal[m]) * k;
      if (!md.on || md.target === 'off') continue;
      const x = this.modVal[m] * md.depth;
      const t = md.target;
      if (t === 'pitch') mPitch += x;
      else if (t === 'feedback') mFb += x;
      else if (t === 'algorithm') mAlgo += x;
      else if (t === 'pan') mPan += x;
      else {
        const oi = t.charCodeAt(0) - 65, key = t.slice(2);
        if (key === 'level') mLevel[oi] += x;
        else if (key === 'ratio') mRatio[oi] += x;
        else if (key === 'decay') mDecay[oi] += x;
        else if (key === 'seqAmount') mSeq[oi] += x;
      }
    }

    // voice
    const baseHz = v.pitchMode === 'hz' ? v.hz : noteToHz(v.note);
    this.voiceHz = baseHz * Math.pow(2, mPitch);          // depth 1 = +-1 octave
    this.fbEff = clamp(v.feedback + mFb, -1, 1);
    this.pitchSemis = v.pitchEnvSemis;
    this.pitchCoef = Math.exp(-1 / (Math.max(0.001, v.pitchEnvDecay) * sr));
    const algo = (((v.algorithm + Math.round(mAlgo * 4)) % 8) + 8) % 8;
    if (algo !== this.algoEff) this._switchAlgorithm(algo);
    const pan = clamp(v.pan + mPan, -1, 1);
    const a = (pan + 1) * Math.PI / 4;
    this.panL = Math.cos(a); this.panR = Math.sin(a);
    this.outGainTarget = clamp(v.level, 0, 1);

    for (let i = 0; i < 4; i++) {
      const op = p.ops[i];
      this.levelEff[i] = clamp(op.level + mLevel[i], 0, 1);
      this.ratioEff[i] = op.ratio * Math.pow(2, mRatio[i] * 2 + op.fine / 1200);
      this.decEff[i] = op.decay * Math.pow(2, mDecay[i] * 3);
      this.decCoef[i] = decayCoef(this.decEff[i], sr);
      this.attInc[i] = 1 / (Math.max(0.0002, op.attack) * sr);
      this.seqAmtEff[i] = clamp(op.seqAmount + mSeq[i], 0, 1);
      // drift: slow random walk on free-running slave rate
      if (op.drift > 0 && !op.sync) {
        if (this.rngDrift[i].next() < dt * 2) this.driftTarget[i] = this.rngDrift[i].bipolar();
        this.drift[i] += (this.driftTarget[i] - this.drift[i]) * (1 - Math.exp(-dt / 0.8));
      } else {
        this.drift[i] = 0;
      }
    }
  }

  _switchAlgorithm(algo) {
    this.tail.copyFrom(this.voice);
    this.voice.algorithm = algo;
    this.algoEff = algo;
    this.fadePos = 0;
    this.fadeLen = Math.max(1, Math.round(ALGO_FADE_SEC * this.sr));
  }

  _trigger(offset) {
    this.tail.copyFrom(this.voice);
    this.voice.trigger(offset);
    this.fadePos = 0;
    this.fadeLen = RETRIGGER_FADE;
    if (this.onTrigger) this.onTrigger(this.sample);
  }

  _slavePos(i, op) {
    const pos = (this.cycle - this.sResetCycle[i]) + this.mPhase;
    return this.sBaseOff[i] + (pos - this.sBasePos[i]) * op.mult;
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
      let n = Math.floor(rb * 7);
      if (n >= p.voice.algorithm) n++;
      p.voice.algorithm = n;
      this.dirtyVoice = true;
      // the next control tick moves algoEff (with the crossfade)
    }
    for (let i = 0; i < 4; i++) {
      const op = p.ops[i];
      // multiplier jump
      const rj = r.next(), rs = r.next();
      if (op.jumpChance > 0 && rj < op.jumpChance && op.jumpSet.length) {
        const nm = MULT_PRESETS[op.jumpSet[Math.floor(rs * op.jumpSet.length)]];
        if (nm !== op.mult) {
          if (op.sync) { // rebase so the phase stays continuous
            const sp = this._slavePos(i, op);
            this.sBaseOff[i] = sp;
            this.sBasePos[i] = (this.cycle - this.sResetCycle[i]) + this.mPhase;
          }
          op.mult = nm;
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
      for (let i = 0; i < 4; i++) {
        const op = ops[i];
        let wrapped = false, isReset = false, off = 0;
        if (op.sync) {
          if (masterWrapped && (this.cycle % Math.max(1, op.syncEvery) === 0 || !seqs[i].started)) {
            this.sResetCycle[i] = this.cycle;
            this.sBasePos[i] = 0;
            this.sBaseOff[i] = op.scatter > 0 ? this.rngClock.next() * op.scatter : 0;
            isReset = true; wrapped = true; off = mOff;
          }
          const sp = this._slavePos(i, op);
          const k = Math.floor(sp);
          const ph = sp - k;
          if (!isReset && k !== this.sK[i]) {
            wrapped = true;
            off = ph / (this.mInc * op.mult);
          }
          this.sK[i] = k;
          this.sPhase[i] = ph;
        } else {
          if (masterWrapped && !seqs[i].started) {
            this.sPhase[i] = 0; isReset = true; wrapped = true;
          } else {
            const inc = this.mInc * op.mult * (1 + op.drift * this.drift[i]);
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
      let fb = this.fbEff;
      for (let i = 0; i < 4; i++) {
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
        this.gain[i] = gain;
        let base;
        if (op.ratioMode === 'fixed') base = op.fixedHz * (op.dest === 2 ? fmul : 1);
        else {
          const ratio = sq.lockRatio != null ? sq.lockRatio : this.ratioEff[i];
          base = this.voiceHz * ratio * fmul;
        }
        this.freq[i] = base;
        if (sq.lockFeedback != null) fb = sq.lockFeedback;
      }
      const dc = this.decCoef;
      const saved0 = dc[0], saved1 = dc[1], saved2 = dc[2], saved3 = dc[3];
      for (let i = 0; i < 4; i++) if (this.lockDecCoef[i] > 0) dc[i] = this.lockDecCoef[i];

      let out = this.voice.render(this.freq, this.gain, this.attInc, dc, fb, this.pitchSemis, this.pitchCoef);
      if (this.fadePos < this.fadeLen) {
        const x = this.fadePos / this.fadeLen;
        const t = this.tail.render(this.freq, this.gain, this.attInc, dc, fb, this.pitchSemis, this.pitchCoef);
        out = out * x + t * (1 - x);
        this.fadePos++;
      }
      dc[0] = saved0; dc[1] = saved1; dc[2] = saved2; dc[3] = saved3;

      this.outGain += (this.outGainTarget - this.outGain) * 0.002;
      out *= this.outGain;
      outL[s] = out * this.panL;
      outR[s] = out * this.panR;
      this.sample++;
    }
  }

  // Snapshot for the UI. Layout: [mPhase, cycle, algoEff, then per op: phase, pos, fired, mult, value,
  // then 4 modulator values].
  writeState(arr) {
    arr[0] = this.mPhase; arr[1] = this.cycle; arr[2] = this.algoEff;
    for (let i = 0; i < 4; i++) {
      const b = 3 + i * 5;
      arr[b] = this.sPhase[i];
      arr[b + 1] = this.seqs[i].pos;
      arr[b + 2] = this.seqs[i].fired ? 1 : 0;
      arr[b + 3] = this.patch.ops[i].mult;
      arr[b + 4] = this.sValue[i];
    }
    for (let m = 0; m < 4; m++) arr[23 + m] = this.modVal[m];
    return arr;
  }
}
export const STATE_SIZE = 27;
export { MOD_TARGETS };
