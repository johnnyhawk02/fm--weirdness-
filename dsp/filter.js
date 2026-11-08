// Stereo state-variable low-pass (topology-preserving transform, after Zavalishin / Simper).
// Stable at any cutoff, so an LFO can sweep it. Plain JS for a later C++ port.
export class LowPass {
  constructor(sr) { this.sr = sr; this.l = 0; this.r = 0; this.reset(); this.set(20000, 0); }
  reset() { this.l1 = 0; this.l2 = 0; this.r1 = 0; this.r2 = 0; }
  // cutoff in Hz, reso 0..1 (1 rings close to self-oscillation)
  set(cutoff, reso) {
    const fc = Math.max(20, Math.min(cutoff, this.sr * 0.45));
    const g = Math.tan(Math.PI * fc / this.sr);
    const k = 2 - 1.9 * Math.max(0, Math.min(1, reso)); // damping
    this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  process(l, r) {
    const a1 = this.a1, a2 = this.a2, a3 = this.a3;
    let v3 = l - this.l2;
    let v1 = a1 * this.l1 + a2 * v3;
    let v2 = this.l2 + a2 * this.l1 + a3 * v3;
    this.l1 = 2 * v1 - this.l1; this.l2 = 2 * v2 - this.l2; this.l = v2;
    v3 = r - this.r2;
    v1 = a1 * this.r1 + a2 * v3;
    v2 = this.r2 + a2 * this.r1 + a3 * v3;
    this.r1 = 2 * v1 - this.r1; this.r2 = 2 * v2 - this.r2; this.r = v2;
  }
}
