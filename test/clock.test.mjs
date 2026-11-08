// Clock tests: slave saws advance at exactly mult x per master cycle; sync aligns wraps; free drifts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../dsp/engine.js';
import { defaultPatch } from '../dsp/params.js';

const SR = 48000;

function runClocks(configure, cycles, block = 128) {
  const p = defaultPatch();
  p.clock.mode = 'bpm'; p.clock.bpm = 137; p.clock.beats = 4; // deliberately non-integer cycle length
  p.rnd.algoChance = 0;
  for (const m of p.mods) m.on = false;
  for (const o of p.ops) o.syncEvery = 1; // hard sync on every master wrap
  configure(p);
  const e = new Engine(SR);
  e.setPatch(p);
  const master = [];               // sample index of each master wrap
  const wraps = [[], [], [], []];  // per op: { sample, cycle }
  e.onMasterWrap = (c, s) => master.push(s);
  e.onWrap = (op, s) => wraps[op].push({ s, cycle: master.length - 1 });
  e.reset();
  const cycleSamples = SR * 60 * 4 / 137;
  const n = Math.ceil(cycleSamples * cycles) + 8;
  const L = new Float32Array(block), R = new Float32Array(block);
  for (let i = 0; i < n; i += block) e.process(L, R, Math.min(block, n - i));
  return { master, wraps, p };
}

test('multipliers 1,2,3,4 advance operators exactly 1x..4x per master cycle (sync on)', () => {
  const mults = [1, 2, 3, 4];
  const { master, wraps } = runClocks((p) => p.ops.forEach((o, i) => { o.mult = mults[i]; o.sync = true; }), 12);
  assert.ok(master.length >= 12);
  const full = master.length - 1; // complete master cycles
  for (let i = 0; i < 4; i++) {
    for (let c = 0; c < full; c++) {
      const count = wraps[i].filter((w) => w.cycle === c).length;
      assert.equal(count, mults[i], `op ${'ABCD'[i]} cycle ${c}: ${count} wraps, expected ${mults[i]}`);
    }
  }
});

test('with sync on, all four wraps land on the master wrap sample every cycle', () => {
  const mults = [1, 2, 3, 4];
  const { master, wraps } = runClocks((p) => p.ops.forEach((o, i) => { o.mult = mults[i]; o.sync = true; }), 12);
  for (const ms of master) {
    for (let i = 0; i < 4; i++) {
      assert.ok(wraps[i].some((w) => w.s === ms), `op ${'ABCD'[i]} has no wrap on master sample ${ms}`);
    }
  }
});

test('polyrhythm 3:4 with sync realigns on every master wrap', () => {
  const mults = [3 / 4, 4 / 3, 3, 4];
  const { master, wraps } = runClocks((p) => p.ops.forEach((o, i) => { o.mult = mults[i]; o.sync = true; }), 9);
  for (const ms of master) for (let i = 0; i < 4; i++) assert.ok(wraps[i].some((w) => w.s === ms));
});

test('free-running wraps are evenly spaced at the right rate (sync off, integer mults)', () => {
  const mults = [1, 2, 3, 4];
  const { master, wraps } = runClocks((p) => p.ops.forEach((o, i) => { o.mult = mults[i]; o.sync = false; }), 12);
  const period = master[master.length - 1] - master[master.length - 2];
  for (let i = 0; i < 4; i++) {
    const w = wraps[i].map((x) => x.s);
    const total = w.length - 1;
    const span = w[w.length - 1] - w[0];
    assert.ok(Math.abs(span / total - period / mults[i]) < 1.5, `op ${i} spacing`);
  }
});

test('with sync off and a float multiplier, the saw drifts against the master', () => {
  const { master, wraps } = runClocks((p) => {
    p.ops[0].mult = 1; p.ops[0].sync = true;
    p.ops[1].mult = 1.37; p.ops[1].sync = false;
    p.ops[2].mult = 2.9; p.ops[2].sync = false;
    p.ops[3].mult = 1; p.ops[3].sync = false; p.ops[3].drift = 0.04;
  }, 16);
  for (const op of [1, 2, 3]) {
    const ws = wraps[op].map((w) => w.s);
    // relative phase of the nearest preceding slave wrap at each master wrap must change over time
    const offsets = master.slice(1).map((ms) => {
      const prev = ws.filter((s) => s <= ms).pop();
      return ms - prev;
    });
    const distinct = new Set(offsets).size;
    assert.ok(distinct > offsets.length / 2, `op ${'ABCD'[op]} did not drift: ${offsets.slice(0, 6)}`);
    const aligned = master.slice(1).filter((ms) => ws.includes(ms)).length;
    assert.ok(aligned < master.length / 3, `op ${'ABCD'[op]} stayed aligned with the master`);
  }
});

test('sub-sample wrap offsets are reported and lie inside one sample', () => {
  const p = defaultPatch();
  p.clock.bpm = 137; // cycle length is not a whole number of samples
  const e = new Engine(SR);
  e.setPatch(p);
  const offs = [];
  e.onWrap = (op, s, off) => offs.push(off);
  e.reset();
  const L = new Float32Array(128), R = new Float32Array(128);
  for (let i = 0; i < SR * 4; i += 128) e.process(L, R, 128);
  assert.ok(offs.length > 20);
  for (const o of offs) assert.ok(o >= 0 && o < 1.0000001, `offset ${o}`);
  assert.ok(offs.some((o) => o > 0.01), 'offsets carry fractional position');
});
