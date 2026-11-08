// Offline render helper: node tools/render.mjs [bars] [out.wav] [seed]
import { Engine } from '../dsp/engine.js';
import { defaultPatch, masterRateHz } from '../dsp/params.js';
import { writeWavFloat } from './wav.mjs';

// One bar = 4 beats at the patch tempo (or 4 master cycles in Hz mode).
export function barSeconds(p) {
  return p.clock.mode === 'bpm' ? 240 / p.clock.bpm : 4 / masterRateHz(p.clock);
}

export function renderPatch(patch, seconds, sr = 48000, block = 128) {
  const e = new Engine(sr);
  e.setPatch(patch);
  e.reset();
  const n = Math.round(seconds * sr);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i += block) {
    const m = Math.min(block, n - i);
    e.process(L.subarray(i, i + m), R.subarray(i, i + m), m);
  }
  return { L, R, engine: e };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bars = Number(process.argv[2] || 4);
  const out = process.argv[3] || 'out/render.wav';
  const p = defaultPatch();
  if (process.argv[4]) p.seed = Number(process.argv[4]);
  const secs = barSeconds(p) * bars;
  const { L, R } = renderPatch(p, secs);
  writeWavFloat(out, L, R, 48000);
  let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  console.log(`wrote ${out}: ${secs.toFixed(2)} s, peak ${peak.toFixed(4)}`);
}
