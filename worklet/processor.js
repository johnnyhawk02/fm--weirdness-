// AudioWorklet host for the engine. All clocks run per sample inside Engine.process.
import { Engine, STATE_SIZE } from '../dsp/engine.js';

class FMSeqProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new Engine(sampleRate);
    this.running = false;
    this.stopping = false;
    this.gain = 0;
    this.state = new Float32Array(STATE_SIZE);
    this.interval = Math.round(sampleRate / 60); // ~60 UI updates per second
    this.counter = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    const eng = this.engine;
    if (m.type === 'patch') {
      eng.setPatch(m.patch);
    } else if (m.type === 'start') {
      eng.patch = null;
      eng.setPatch(m.patch);
      eng.reset();
      this.running = true; this.stopping = false; this.gain = 1;
    } else if (m.type === 'stop') {
      this.stopping = true;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    if (!this.running) return true;
    const n = L.length;
    this.engine.process(L, R, n);
    if (this.stopping) { // short fade instead of a click
      for (let i = 0; i < n; i++) { this.gain = Math.max(0, this.gain - 1 / 256); L[i] *= this.gain; R[i] *= this.gain; }
      if (this.gain <= 0) { this.running = false; this.stopping = false; this.port.postMessage({ type: 'stopped' }); }
    }
    this.counter += n;
    if (this.counter >= this.interval) {
      this.counter -= this.interval;
      const eng = this.engine;
      eng.writeState(this.state);
      this.port.postMessage({ type: 'state', state: this.state.slice() });
      if (eng.dirtyVoice || eng.dirtyOps.some(Boolean)) {
        const ops = {};
        eng.dirtyOps.forEach((d, i) => { if (d) ops[i] = { steps: eng.patch.ops[i].steps, mult: eng.patch.ops[i].mult }; });
        this.port.postMessage({ type: 'sync', ops, algorithm: eng.dirtyVoice ? eng.patch.voice.algorithm : null });
        eng.dirtyVoice = false;
        eng.dirtyOps.fill(false);
      }
    }
    return true;
  }
}

registerProcessor('fm-seq', FMSeqProcessor);
