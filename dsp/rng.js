// Seeded PRNG (mulberry32) plus helpers. No DOM, no globals: ports directly to C++.

export function hashSeed(...parts) {
  // FNV-1a over 32-bit integers, used to derive independent streams from one seed.
  let h = 0x811c9dc5;
  for (const p of parts) {
    let v = typeof p === 'string' ? strHash(p) : (p >>> 0);
    for (let i = 0; i < 4; i++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      v >>>= 8;
    }
  }
  return h >>> 0;
}

function strHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed = 1) { this.state = seed >>> 0; }
  seed(s) { this.state = s >>> 0; }
  // uniform [0, 1)
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo, hi) { return lo + (hi - lo) * this.next(); }
  int(n) { return Math.floor(this.next() * n); } // 0..n-1
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[this.int(arr.length)]; }
  bipolar() { return this.next() * 2 - 1; }
  // cheap approx gaussian (sum of 4 uniforms), mean 0, sd ~1
  gauss() { return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732; }
}
