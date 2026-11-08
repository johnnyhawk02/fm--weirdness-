// Render tests: 4 bars to WAV with no NaNs or clipping; seeded determinism; mutation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { Engine } from '../dsp/engine.js';
import { defaultPatch, clonePatch, masterRateHz } from '../dsp/params.js';
import { Rng } from '../dsp/rng.js';
import { rndAll, rndLocks, randomizeEverything } from '../dsp/random.js';
import { renderPatch, barSeconds } from '../tools/render.mjs';
import { writeWavFloat } from '../tools/wav.mjs';

const SR = 48000;
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

function check(L, R, label) {
  let peak = 0, nan = 0, energy = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = R[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) nan++;
    peak = Math.max(peak, Math.abs(a), Math.abs(b));
    energy += a * a + b * b;
  }
  assert.equal(nan, 0, `${label}: ${nan} non-finite samples`);
  assert.ok(peak <= 1.0, `${label}: peak ${peak} clips above 0 dBFS`);
  assert.ok(energy > 0, `${label}: silent`);
  return peak;
}

function wildPatch(seed) {
  const p = defaultPatch();
  p.seed = seed;
  const rng = new Rng(seed);
  rndAll(p, {}, 1, rng);
  for (const op of p.ops) { rndLocks(op, 0.4, rng); op.mutateK = 2; op.mutateEvery = 1; op.jumpChance = 0.3; }
  p.rnd.algoChance = 0.5;
  p.voice.level = 1; p.voice.feedback = -1;
  for (const m of p.mods) { m.on = true; m.depth = 1; }
  return p;
}

test('4 bars render to WAV with no NaNs and no clipping above 0 dBFS', () => {
  const p = defaultPatch();
  const secs = 4 * barSeconds(p);
  const { L, R } = renderPatch(p, secs, SR);
  assert.equal(L.length, Math.round(secs * SR));
  const peak = check(L, R, 'default patch');
  writeWavFloat(new URL('../out/render-4bars.wav', import.meta.url).pathname, L, R, SR);
  console.log(`# default patch: 4 bars, ${secs.toFixed(2)} s, peak ${peak.toFixed(4)} (${(20 * Math.log10(peak)).toFixed(2)} dBFS)`);
});

test('randomised extreme patches (rnd all = 1, locks, mutate, jumps, mods) stay finite and under 0 dBFS', () => {
  for (const seed of [1, 7, 42, 99, 2024, 31337]) {
    const p = wildPatch(seed);
    const { L, R } = renderPatch(p, 4 * barSeconds(p), SR);
    check(L, R, `seed ${seed}`);
  }
});

test('the same seed gives a bit-identical render, independent of block size', () => {
  const p = wildPatch(4242);
  const a = renderPatch(clonePatch(p), 6, SR, 128);
  const b = renderPatch(clonePatch(p), 6, SR, 128);
  const c = renderPatch(clonePatch(p), 6, SR, 97);
  assert.deepEqual(Buffer.from(a.L.buffer), Buffer.from(b.L.buffer));
  assert.deepEqual(Buffer.from(a.R.buffer), Buffer.from(b.R.buffer));
  assert.deepEqual(Buffer.from(a.L.buffer), Buffer.from(c.L.buffer));
  const q = clonePatch(p); q.seed = 4243;
  const d = renderPatch(q, 6, SR, 128);
  assert.notDeepEqual(Buffer.from(a.L.buffer), Buffer.from(d.L.buffer), 'a different seed should change the render');
});

test('with mutate on, the pattern after 16 master cycles differs from cycle 1 but stays in the palette', () => {
  const p = defaultPatch();
  p.clock.beats = 1; // short cycles
  for (const op of p.ops) { op.mutateK = 2; op.mutateEvery = 1; }
  const e = new Engine(SR);
  e.setPatch(p);
  let first = null, after = null;
  e.onMasterWrap = (c) => {
    if (c === 1) first = clonePatch(p).ops;
    if (c === 17) after = clonePatch(p).ops;
  };
  e.reset();
  const L = new Float32Array(128), R = new Float32Array(128);
  const n = Math.ceil(18 / masterRateHz(p.clock) * SR);
  for (let i = 0; i < n; i += 128) e.process(L, R, 128);
  assert.ok(first && after);
  for (let i = 0; i < 4; i++) {
    const len = p.ops[i].length;
    const a = first[i].steps.slice(0, len), b = after[i].steps.slice(0, len);
    assert.notDeepEqual(a, b, `op ${'ABCD'[i]} did not evolve`);
    const palette = new Set(a.filter((s) => s.depth !== 0).map((s) => s.shape));
    for (const s of b) if (s.depth !== 0) assert.ok(palette.has(s.shape), `op ${'ABCD'[i]} left its palette (shape ${s.shape})`);
    for (const s of b) assert.ok(s.depth >= -1 && s.depth <= 1);
    const changed = a.filter((s, k) => JSON.stringify(s) !== JSON.stringify(b[k])).length;
    console.log(`# op ${'ABCD'[i]}: ${changed}/${len} steps changed after 16 cycles, palette [${[...palette]}]`);
    assert.ok(b[0].depth !== 0 || a[0].depth === 0, 'step 1 stays on');
  }
});

test('randomise-everything patches stay finite, under 0 dBFS and audible', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const p = defaultPatch();
    p.seed = seed * 7919;
    randomizeEverything(p, new Rng(seed));
    const { L, R } = renderPatch(p, 4 * barSeconds(p), SR);
    check(L, R, `everything seed ${seed}`);
  }
});
