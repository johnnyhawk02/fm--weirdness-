import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetName, chunks, WORDS } from '../ui/names.js';
import { Rng } from '../dsp/rng.js';

test('preset names are spliced from word chunks, seeded and varied', () => {
  assert.deepEqual(chunks('Giggleswick').join(''), 'giggleswick');
  assert.equal(Object.keys(WORDS).length, 5);
  const a = Array.from({ length: 50 }, ((r) => () => presetName(r))(new Rng(3)));
  const b = Array.from({ length: 50 }, ((r) => () => presetName(r))(new Rng(3)));
  assert.deepEqual(a, b);
  assert.ok(new Set(a).size > 45);
  for (const n of a) assert.match(n, /^[A-Z][A-Za-z ]{2,40}$/);
});
