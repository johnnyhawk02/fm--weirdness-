// One 4-operator phase-modulation voice. Plain JS, no allocation in the audio path.
import { ALGORITHMS, NUM_OPS } from './params.js';

const FB_OP = NUM_OPS - 1; // feedback lives on the last operator

const TWO_PI = Math.PI * 2;
const MOD_INDEX = 0.6;   // phase deviation (cycles) of a modulator at level 1 (~3.8 rad)
const FB_SCALE = 0.3;    // feedback deviation (cycles) at |feedback| = 1
const AA_CORNER = 5000;  // Hz: modulation index halves when the modulated op reaches this

export class Voice {
  constructor(sr) {
    this.sr = sr;
    this.phase = new Float64Array(NUM_OPS);
    this.env = new Float64Array(NUM_OPS);      // envelope value 0..1
    this.stage = new Uint8Array(NUM_OPS);      // 0 attack, 1 decay
    this.out = new Float64Array(NUM_OPS);      // last operator outputs (scaled)
    this.fb1 = 0; this.fb2 = 0;
    this.pitchEnv = 0;                   // 1 -> 0 decaying pitch envelope
    this.algorithm = 0;
  }

  copyFrom(v) {
    this.phase.set(v.phase); this.env.set(v.env); this.stage.set(v.stage); this.out.set(v.out);
    this.fb1 = v.fb1; this.fb2 = v.fb2; this.pitchEnv = v.pitchEnv; this.algorithm = v.algorithm;
  }

  // keep: bitmask of free-running operators whose envelopes ignore the note trigger
  trigger(offsetSamples = 0, keep = 0) {
    // offsetSamples: fraction of a sample already elapsed since the trigger point (sub-sample start)
    for (let j = 0; j < NUM_OPS; j++) {
      this.phase[j] = 0; this.out[j] = 0;
      if (!(keep & (1 << j))) { this.env[j] = 0; this.stage[j] = 0; }
    }
    this.fb1 = this.fb2 = 0;
    this.pitchEnv = 1;
    this.subOffset = offsetSamples;
  }

  // Retrigger one operator's envelope without a jump: the attack rises from where it is now.
  retrigOp(j) { this.stage[j] = 0; }

  // freq[4]: Hz per op before the pitch envelope. gain[4]: level * seq gain per op. attInc[4]: env increment per sample.
  // decCoef[4]: per-sample decay multiplier. feedback: -1..1.
  // pitchSemis: pitch-envelope depth. pitchCoef: pitch env decay multiplier per sample.
  render(freq, gain, attInc, decCoef, feedback, pitchSemis, pitchCoef) {
    const alg = ALGORITHMS[this.algorithm];
    const sr = this.sr;
    const pe = pitchSemis * this.pitchEnv;
    this.pitchEnv *= pitchCoef;
    const pmul = pe !== 0 ? Math.pow(2, pe / 12) : 1;
    const fmax = sr * 0.45;
    const off = this.subOffset || 0;
    this.subOffset = 0;
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

      let pm = 0;
      const srcs = alg.mods[j];
      if (srcs.length) {
        for (let k = 0; k < srcs.length; k++) pm += this.out[srcs[k]];
        const r = f / AA_CORNER;
        pm *= MOD_INDEX / (1 + r * r);
      }
      if (j === FB_OP && feedback !== 0) {
        const h = 0.5 * (this.fb1 + this.fb2);
        pm += (feedback > 0 ? feedback * h : -feedback * h * h) * FB_SCALE * e;
      }
      const s = Math.sin(TWO_PI * (ph + pm));
      if (j === FB_OP) { this.fb2 = this.fb1; this.fb1 = s; }
      this.out[j] = s * gain[j] * e;
    }
    const c = alg.carriers;
    let sum = 0;
    for (let k = 0; k < c.length; k++) sum += this.out[c[k]];
    return sum / c.length;
  }
}
