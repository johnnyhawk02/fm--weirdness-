// Output dynamics: a slow leveller, a compressor and a soft limiter, stereo-linked.
// Plain JS with no allocation per sample, so it ports straight to C++.
//
//   leveller   - rides the gain slowly (seconds) toward a target loudness, so quiet patches come up and
//                loud ones come down; range limited to +-12 dB.
//   compressor - fast peak-ish follower (5 ms attack, 120 ms release), 4:1 above the threshold.
//   limiter    - smooth soft clip that never exceeds the ceiling, so nothing hard-clips.
// amount 0..1 sets how hard all three work (0 = bypass apart from the safety limiter).

const undb = (d) => Math.pow(10, d / 20);

export class Dynamics {
  constructor(sr) {
    this.sr = sr;
    this.rms = 0;           // leveller power follower
    this.lvl = 1;           // leveller gain
    this.env = 0;           // compressor envelope
    this.gr = 1;            // last compressor gain (for the meter)
    this.cnt = 0;
    this.aRms = 1 - Math.exp(-1 / (0.4 * sr));
    this.aLvl = 1 - Math.exp(-1 / (1.5 * sr));
    this.att = 1 - Math.exp(-1 / (0.005 * sr));
    this.rel = 1 - Math.exp(-1 / (0.12 * sr));
    this.setAmount(0.6);
  }

  reset() { this.rms = 0; this.lvl = 1; this.env = 0; this.gr = 1; }

  setAmount(a) {
    a = Math.max(0, Math.min(1, a));
    this.amount = a;
    this.target = 0.18;                      // ~-15 dBFS RMS
    this.maxBoost = undb(12 * a);
    this.maxCut = undb(-12 * a);
    this.thresh = undb(-6 - 12 * a);         // -6 dB at amount 0 .. -18 dB at amount 1
    this.ratio = 1 + 5 * a;                  // 1:1 .. 6:1
    this.makeup = undb(6 * a);
    this.ceiling = 0.95;
  }

  // Process one stereo sample in place: returns via this.l / this.r.
  process(l, r) {
    const a = this.amount;
    // leveller
    if (a > 0) {
      const p = 0.5 * (l * l + r * r);
      this.rms += (p - this.rms) * this.aRms;
      const rms = Math.sqrt(this.rms);
      let want = rms > 1e-5 ? this.target / rms : this.maxBoost;
      if (want > this.maxBoost) want = this.maxBoost;
      if (want < this.maxCut) want = this.maxCut;
      this.lvl += (want - this.lvl) * this.aLvl;
      l *= this.lvl; r *= this.lvl;
      // compressor
      const x = Math.max(Math.abs(l), Math.abs(r));
      this.env += (x - this.env) * (x > this.env ? this.att : this.rel);
      // gain computer every 8 samples (log/pow are expensive); the envelope itself runs per sample
      if (--this.cnt <= 0) {
        this.cnt = 8;
        let g = 1;
        if (this.env > this.thresh) g = Math.pow(this.env / this.thresh, -(1 - 1 / this.ratio));
        this.gr = g;
      }
      const g = this.gr * this.makeup;
      l *= g; r *= g;
    }
    // soft limiter: linear below the knee, smooth tanh-style curve up to the ceiling
    this.l = soft(l, this.ceiling); this.r = soft(r, this.ceiling);
  }
}

function soft(x, c) {
  const k = 0.7 * c, ax = Math.abs(x);
  if (ax <= k) return x;
  const room = c - k;
  const y = k + room * Math.tanh((ax - k) / room);
  return x < 0 ? -y : y;
}
