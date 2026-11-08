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
  for (let i = 0; i < p.ops.length; i++) {
    const len = p.ops[i].length;
    const a = first[i].steps.slice(0, len), b = after[i].steps.slice(0, len);
    assert.notDeepEqual(a, b, `op ${'ABCDEFG'[i]} did not evolve`);
    const palette = new Set(a.filter((s) => s.depth !== 0).map((s) => s.shape));
    for (const s of b) if (s.depth !== 0) assert.ok(palette.has(s.shape), `op ${'ABCDEFG'[i]} left its palette (shape ${s.shape})`);
    for (const s of b) assert.ok(s.depth >= -1 && s.depth <= 1);
    const changed = a.filter((s, k) => JSON.stringify(s) !== JSON.stringify(b[k])).length;
    console.log(`# op ${'ABCDEFG'[i]}: ${changed}/${len} steps changed after 16 cycles, palette [${[...palette]}]`);
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

test('operator pitch glides with slew instead of jumping', () => {
  const p = defaultPatch();
  p.ops[1].slew = 0.5; p.ops[2].slew = 0.001;
  for (const m of p.mods) m.on = false;
  const e = new Engine(SR);
  e.setPatch(p); e.reset();
  const L = new Float32Array(128), R = new Float32Array(128);
  for (let i = 0; i < SR * 0.2; i += 128) e.process(L, R, 128);
  const q = clonePatch(p); q.ops[1].ratio = 8; e.setPatch(q);
  for (let i = 0; i < SR * 0.25; i += 128) e.process(L, R, 128);
  const mid = e.ratioSm[1];
  assert.ok(mid > 2.5 && mid < 7.5, `halfway through the glide the ratio is ${mid}`);
  for (let i = 0; i < SR * 4; i += 128) e.process(L, R, 128);
  assert.ok(Math.abs(e.ratioSm[1] - 8) < 0.01, 'glide arrives at the target');
  // each operator has its own slew: C (1 ms) jumps while B glides
  const r = clonePatch(q); r.ops[1].ratio = 1; r.ops[2].ratio = 9; e.setPatch(r);
  for (let i = 0; i < SR * 0.05; i += 128) e.process(L, R, 128);
  assert.ok(Math.abs(e.ratioSm[2] - 9) < 0.01, `C snapped: ${e.ratioSm[2]}`);
  assert.ok(e.ratioSm[1] > 4, `B still gliding: ${e.ratioSm[1]}`);
});

test('every algorithm in every stereo mode stays finite and under 0 dBFS; carrier pairs are stereo', async () => {
  const { ALGORITHMS, STEREO_MODES } = await import('../dsp/params.js');
  assert.ok(ALGORITHMS.length >= 32);
  let wide = 0;
  for (let a = 0; a < ALGORITHMS.length; a++) {
    for (let m = 0; m < STEREO_MODES.length; m++) {
      const p = defaultPatch();
      p.voice.algorithm = a; p.voice.stereo = m; p.voice.width = 1; p.voice.level = 1; p.voice.feedback = 0.8;
      for (const md of p.mods) md.on = false;
      p.ops.forEach((o, i) => { o.level = 1; o.pan = i % 2 ? -1 : 1; });
      const { L, R } = renderPatch(p, 0.4, SR);
      check(L, R, `algorithm ${a + 1} stereo ${STEREO_MODES[m]}`);
      let d = 0; for (let i = 0; i < L.length; i++) d += Math.abs(L[i] - R[i]);
      if (d > 1) wide++;
    }
  }
  assert.ok(wide > ALGORITHMS.length * 4, `only ${wide} renders had a stereo difference`);
  // a single-carrier algorithm still goes stereo through panned modulators (stereo carrier pair)
  const p = defaultPatch();
  p.voice.algorithm = 0; p.voice.stereo = 5; for (const md of p.mods) md.on = false;
  p.ops.forEach((o, i) => { o.pan = i === 0 ? 0 : (i % 2 ? -1 : 1); o.level = 0.6; o.amp = 1; o.seqAmount = 0; });
  const { L, R } = renderPatch(p, 0.5, SR);
  let d = 0; for (let i = 0; i < L.length; i++) d += Math.abs(L[i] - R[i]);
  assert.ok(d > 10, `carrier pair L/R difference ${d}`);
});

test('alter nudges values slightly and keeps them in range', async () => {
  const { defaultPatch, PARAM_SPECS, getPath, clonePatch } = await import('../dsp/params.js');
  const { alterEverything } = await import('../dsp/random.js');
  const { Rng } = await import('../dsp/rng.js');
  const a = defaultPatch();
  const b = clonePatch(a);
  alterEverything(b, new Rng(7), 0.03);
  let moved = 0;
  for (const s of PARAM_SPECS) {
    const x = getPath(a, s.path), y = getPath(b, s.path);
    if (typeof y !== 'number') continue;
    assert.ok(isFinite(y), s.path);
    if (s.min !== undefined) assert.ok(y >= s.min - 1e-9 && y <= s.max + 1e-9, s.path);
    if (s.type === 'lin') assert.ok(Math.abs(y - x) <= 0.061 * (s.max - s.min), s.path);
    if (s.type !== 'lin' && s.type !== 'log') assert.equal(y, x, s.path);
    if (y !== x) moved++;
  }
  assert.ok(moved > 30);
  assert.equal(b.voice.algorithm, a.voice.algorithm);
});

test('feedback paths: every route at full amount stays finite and under 0 dBFS, and changes the sound', () => {
  const base = defaultPatch();
  const ref = renderPatch(base, 1, SR).L;
  for (let from = 0; from < 7; from++) for (let to = 0; to < 7; to++) {
    const p = clonePatch(base);
    p.voice.paths[0] = { from, to, amt: (from + to) % 2 ? 1 : -1 };
    p.voice.paths[1] = { from: to, to: from, amt: 0.7 };
    for (const op of p.ops) op.fb = from === to ? -1 : 0.6;
    const { L, R } = renderPatch(p, 1, SR);
    check(L, R, `path ${from}->${to}`);
    if (from === 0 && to === 1) {
      let d = 0; for (let i = 0; i < L.length; i++) d += Math.abs(L[i] - ref[i]);
      assert.ok(d / L.length > 1e-3, 'path changes the output');
    }
  }
});
