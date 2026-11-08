// Per-operator step sequencer state machine. Advances once per slave-saw wrap.
import { shapeValue } from './shapes.js';

export class OpSequencer {
  constructor(rng) {
    this.rng = rng;
    this.reset(null);
  }

  reset(op) {
    this.pos = op && op.direction === 1 ? Math.max(0, op.length - 1) : 0;
    this.pendDir = 1;
    this.repeatPending = false;
    this.started = false;
    this.fired = false;
    this.depth = 0;
    this.shape = 0;
    this.ratchet = 1;
    this.jitter = 0;
    this.lockRatio = null; this.lockDecay = null; this.lockFeedback = null;
    this.hits = 0; // count of step advances (for tests / UI)
  }

  _next(op, pos) {
    const len = Math.max(1, Math.min(op.length, op.steps.length));
    if (len === 1) return 0;
    switch (op.direction) {
      case 1: return (pos - 1 + len) % len;
      case 2: { // pendulum
        let p = pos + this.pendDir;
        if (p >= len) { this.pendDir = -1; p = len - 2; }
        else if (p < 0) { this.pendDir = 1; p = 1; }
        return p;
      }
      case 3: { // random walk
        const p = pos + (this.rng.next() < 0.5 ? -1 : 1);
        return (p + len) % len;
      }
      default: return (pos + 1) % len;
    }
  }

  // Called on each slave wrap. reset = this wrap was a sync reset (position returns to start).
  advance(op, reset) {
    const rng = this.rng;
    const len = Math.max(1, Math.min(op.length, op.steps.length));
    if (reset || !this.started) {
      this.pos = op.direction === 1 ? len - 1 : 0;
      this.pendDir = 1;
      this.repeatPending = false;
      this.started = true;
    } else if (this.repeatPending) {
      this.repeatPending = false; // play the same step again
    } else {
      let p = this._next(op, this.pos);
      // skip: jump over steps that roll their skip chance (bounded, so it never hangs)
      for (let guard = 0; guard < len - 1; guard++) {
        const sk = op.steps[p].skip;
        if (sk > 0 && rng.next() < sk) p = this._next(op, p);
        else break;
      }
      this.pos = p;
      const rp = op.steps[p].repeat;
      if (rp > 0 && rng.next() < rp) this.repeatPending = true;
    }
    if (this.pos >= len) this.pos = this.pos % len;
    const st = op.steps[this.pos];
    // Always draw the same number of random values per step so streams stay aligned.
    const rProb = rng.next(), rRat = rng.next(), rJit = rng.next();
    this.fired = st.depth !== 0 && rProb < st.prob;
    this.depth = st.depth;
    const lk = st.lock;
    this.shape = lk && lk.shape != null ? lk.shape : st.shape;
    this.ratchet = st.ratchet > 1 && rRat < st.ratchetProb ? st.ratchet : 1;
    this.jitter = op.jitter > 0 ? rJit * op.jitter * 0.5 : 0;
    this.lockRatio = this.fired && lk ? lk.ratio : null;
    this.lockDecay = this.fired && lk ? lk.decay : null;
    this.lockFeedback = this.fired && lk ? lk.feedback : null;
    this.hits++;
  }

  // Signed modulation value for the current position inside the step (phase 0..1).
  value(phase) {
    if (!this.fired) return 0;
    let t = phase;
    const j = this.jitter;
    if (j > 0) {
      if (t < j) return 0;
      t = (t - j) / (1 - j);
    }
    if (this.ratchet > 1) { t *= this.ratchet; t -= Math.floor(t); }
    return this.depth * shapeValue(this.shape, t);
  }
}

// Mutate k random steps of an operator in place: nudge depth, swap shape within the
// pattern's own palette, or flip probability. Returns true if anything changed.
export function mutateSteps(op, k, rng) {
  const len = Math.max(1, Math.min(op.length, op.steps.length));
  const palette = [];
  for (let i = 0; i < len; i++) {
    const s = op.steps[i];
    if (s.depth !== 0 && palette.indexOf(s.shape) < 0) palette.push(s.shape);
  }
  let changed = false;
  for (let n = 0; n < k; n++) {
    const i = rng.int(len);
    const st = op.steps[i];
    const action = rng.int(3);
    if (action === 0) {
      if (st.depth === 0) {
        // wake an empty step quietly, using the palette
        if (palette.length && i !== 0) {
          st.depth = Math.round((0.2 + rng.next() * 0.5) * 100) / 100;
          st.shape = palette[rng.int(palette.length)];
          changed = true;
        }
      } else {
        let d = st.depth + rng.bipolar() * 0.3;
        // keep the sign: mutation nudges, it does not invert
        if (st.depth > 0) d = Math.min(1, Math.max(0.05, d));
        else d = Math.max(-1, Math.min(-0.05, d));
        // occasionally silence a non-first step
        if (i !== 0 && rng.next() < 0.15) d = 0;
        st.depth = Math.round(d * 100) / 100;
        changed = true;
      }
    } else if (action === 1) {
      if (palette.length > 1 && st.depth !== 0) {
        st.shape = palette[rng.int(palette.length)];
        changed = true;
      }
    } else {
      st.prob = st.prob < 1 ? 1 : 0.5;
      changed = true;
    }
  }
  return changed;
}
