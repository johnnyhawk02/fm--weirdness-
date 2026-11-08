// One seven-operator phase-modulation voice. Plain JS, no allocation in the audio path.
import { ALGORITHMS, NUM_OPS } from './params.js';


const TWO_PI = Math.PI * 2;
// sine lookup with linear interpolation (phase in cycles); much cheaper than Math.sin per operator
const TBL = 4096;
const SIN = new Float64Array(TBL + 1);
for (let i = 0; i <= TBL; i++) SIN[i] = Math.sin(TWO_PI * i / TBL);
function sin1(x) {
  x -= Math.floor(x);
  const f = x * TBL, i = f | 0;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * (f - i);
}
const MOD_INDEX = 0.6;   // phase deviation (cycles) of a modulator at level 1 (~3.8 rad)
const FB_SCALE = 0.3;    // self-feedback deviation (cycles) at |feedback| = 1
const PATH_SCALE = 0.5;  // cross-feedback path deviation (cycles) per unit of source output at amount 1
const AA_CORNER = 5000;  // Hz: modulation index halves when the modulated op reaches this

export class Voice {
  constructor(sr) {
    this.sr = sr;
    this.phase = new Float64Array(NUM_OPS);
    this.env = new Float64Array(NUM_OPS);      // envelope value 0..1
    this.stage = new Uint8Array(NUM_OPS);      // 0 attack, 1 decay
    this.out = new Float64Array(NUM_OPS);      // last operator outputs (scaled)
    this.fb1 = new Float64Array(NUM_OPS); this.fb2 = new Float64Array(NUM_OPS); // self-feedback history per op
    this.pathPm = new Float64Array(NUM_OPS);
    this.pitchEnv = 0;                   // 1 -> 0 decaying pitch envelope
    this.algorithm = 0;
    this.l = 0; this.r = 0;
    this.outL = new Float64Array(NUM_OPS); this.outR = new Float64Array(NUM_OPS);
  }

  copyFrom(v) {
    this.phase.set(v.phase); this.outL.set(v.outL); this.outR.set(v.outR); this.env.set(v.env); this.stage.set(v.stage); this.out.set(v.out);
    this.fb1.set(v.fb1); this.fb2.set(v.fb2); this.pitchEnv = v.pitchEnv; this.algorithm = v.algorithm;
  }

  // keep: bitmask of free-running operators whose envelopes ignore the note trigger
  trigger(offsetSamples = 0, keep = 0) {
    // offsetSamples: fraction of a sample already elapsed since the trigger point (sub-sample start)
    for (let j = 0; j < NUM_OPS; j++) {
      this.phase[j] = 0; this.out[j] = 0;
      if (!(keep & (1 << j))) { this.env[j] = 0; this.stage[j] = 0; }
    }
    this.fb1.fill(0); this.fb2.fill(0);
    this.pitchEnv = 1;
    this.subOffset = offsetSamples;
  }

  // Retrigger one operator's envelope without a jump: the attack rises from where it is now.
  retrigOp(j) { this.stage[j] = 0; }

  // freq: Hz per op before the pitch envelope. gain: level * seq gain per op. attInc: env increment per sample.
  // decCoef: per-sample decay multiplier. fb: self-feedback per op, -1..1 (negative = squared, noisier).
  // paths: cross-feedback routes as [from, to, amount] triples; a route reads the source's latest output
  // (one sample old when the source renders after the target), so any operator can feed any other, carriers included.
  // pitchSemis: pitch-envelope depth. pitchCoef: pitch env decay multiplier per sample.
  render(freq, gain, attInc, decCoef, fb, paths, pitchSemis, pitchCoef, panL, panR, balL, balR) {
    const alg = ALGORITHMS[this.algorithm];
    const sr = this.sr;
    const pe = pitchSemis * this.pitchEnv;
    this.pitchEnv *= pitchCoef;
    const pmul = pe !== 0 ? Math.pow(2, pe / 12) : 1;
    const fmax = sr * 0.45;
    const off = this.subOffset || 0;
    this.subOffset = 0;
    const ppm = this.pathPm;
    ppm.fill(0);
    // cross-feedback: each path adds the source's latest output to the target's phase
    for (let k = 0; k < paths.length; k += 3) { const a = paths[k + 2]; if (a !== 0) ppm[paths[k + 1]] += a * PATH_SCALE * this.out[paths[k]]; }
    for (let j = NUM_OPS - 1; j >= 0; j--) {
      // envelope
      let e = this.env[j];
      if (this.stage[j] === 0) {
        e += attInc[j] * (1 + off);
        if (e >= 1) { e = 1; this.stage[j] = 1; }
      } else {
        e *= decCoef[j];
      }
      this.env[j] = e;

      let f = freq[j] * pmul;
      if (f > fmax) f = fmax;
      let ph = this.phase[j] + f / sr;
      ph -= Math.floor(ph);
      this.phase[j] = ph;

      // Carriers are stereo pairs: each modulator feeds the left and right copy by its own pan,
      // so a modulator panned left only bends the left side of the carrier.
      const srcs = alg.mods[j];
      const carrier = alg.isCarrier[j];
      let pm = 0, pmL = 0, pmR = 0;
      if (srcs.length) {
        const r = f / AA_CORNER, idx = MOD_INDEX / (1 + r * r);
        if (carrier) {
          for (let k = 0; k < srcs.length; k++) { const q = srcs[k], o = this.out[q]; pmL += o * balL[q]; pmR += o * balR[q]; }
          pmL *= idx; pmR *= idx;
        } else {
          for (let k = 0; k < srcs.length; k++) pm += this.out[srcs[k]];
          pm *= idx;
        }
      }
      const fj = fb[j];
      let fbv = ppm[j];
      if (fj !== 0) {
        const h = 0.5 * (this.fb1[j] + this.fb2[j]);
        fbv += (fj > 0 ? fj * h : -fj * h * h) * FB_SCALE * e;
      }
      if (fbv !== 0) { pm += fbv; pmL += fbv; pmR += fbv; }
      const amp = gain[j] * e;
      if (carrier) {
        const sL = sin1(ph + pmL), sR = pmL === pmR ? sL : sin1(ph + pmR);
        this.fb2[j] = this.fb1[j]; this.fb1[j] = 0.5 * (sL + sR);
        this.outL[j] = sL * amp; this.outR[j] = sR * amp;
        this.out[j] = 0.5 * (sL + sR) * amp;
      } else {
        const s = sin1(ph + pm);
        this.fb2[j] = this.fb1[j]; this.fb1[j] = s;
        this.out[j] = s * amp;
      }
    }
    // stereo: each carrier sits at its own place (equal-power gains in panL/panR)
    const c = alg.carriers, inv = 1 / c.length;
    let l = 0, r = 0;
    for (let k = 0; k < c.length; k++) { const j = c[k]; l += this.outL[j] * panL[j]; r += this.outR[j] * panR[j]; }
    this.l = l * inv; this.r = r * inv;
  }
}
