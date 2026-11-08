// Randomisers. Pure functions over the patch, driven by a seeded Rng so results are recallable.
import { PARAM_SPECS, SPEC_BY_PATH, getPath, setPath, makeStep, MAX_STEPS, LOCK_KEYS, MULT_PRESETS, FILL_STYLES, MOD_TARGETS as MOD_TARGETS_LOCAL, NUM_OPS, ALGORITHMS } from './params.js';
import { SHAPES } from './shapes.js';

const NICE_RATIOS = [0.5, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 6, 7, 8, 1.5, 2.5, 3.5, 9, 11, 13];
const MULT_WEIGHTS = [0.3, 0.6, 1, 1, 3, 1, 1, 4, 1, 2, 4, 3, 3, 2, 1, 0.6, 0.5, 0.2, 0.1]; // per MULT_PRESETS entry
// shape weights for palettes: percussive shapes are more likely
const SHAPE_WEIGHTS = [5, 4, 2, 1, 1, 2, 1, 2, 2];

function weighted(rng, w) {
  let sum = 0;
  for (const x of w) sum += x;
  let r = rng.next() * sum;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; }
  return w.length - 1;
}

export function randomMult(rng) {
  if (rng.next() < 0.08) return Math.round(rng.range(0.25, 6) * 100) / 100; // occasional float
  return MULT_PRESETS[weighted(rng, MULT_WEIGHTS)];
}

export function randomRatio(rng) {
  if (rng.next() < 0.12) return Math.round(Math.exp(rng.range(Math.log(0.5), Math.log(16))) * 1000) / 1000;
  return rng.pick(NICE_RATIOS);
}

// New value for one parameter. amount 0 = unchanged, 1 = fully random.
export function randomizeValue(spec, cur, amount, rng) {
  if (amount <= 0) return cur;
  const lo = spec.rndMin ?? spec.min, hi = spec.rndMax ?? spec.max;
  switch (spec.type) {
    case 'lin': {
      let r = lo + (hi - lo) * rng.next();
      if (spec.rndScale) { const mid = (lo + hi) / 2; r = mid + (r - mid) * spec.rndScale; }
      return round4(cur + (r - cur) * amount);
    }
    case 'log': {
      const r = Math.log(lo) + (Math.log(hi) - Math.log(lo)) * rng.next();
      const c = Math.log(Math.max(spec.min, cur));
      return round4(Math.exp(c + (r - c) * amount));
    }
    case 'int': {
      const r = lo + rng.next() * (hi - lo + 1);
      return Math.max(spec.min, Math.min(spec.max, Math.floor(cur + (r - cur) * amount)));
    }
    case 'choice':
      if (rng.next() >= amount) return cur;
      return spec.rndWeights ? weighted(rng, spec.rndWeights) : rng.int(spec.n);
    case 'bool':
      if (rng.next() >= amount) return cur;
      return rng.next() < (spec.rndBias ?? 0.5);
    case 'ratio':
      if (rng.next() >= amount) return cur;
      return randomRatio(rng);
    case 'mult':
      if (rng.next() >= amount) return cur;
      return randomMult(rng);
    default: return cur;
  }
}

function round4(x) { return Math.round(x * 10000) / 10000; }

export function randomizePath(patch, path, amount, rng) {
  const spec = SPEC_BY_PATH[path];
  if (!spec) return;
  setPath(patch, path, randomizeValue(spec, getPath(patch, path), amount, rng));
}

// ---------- step fills ----------
function euclid(k, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(((i * k) % n) < k ? 1 : 0);
  return out;
}

function onPattern(style, rng) {
  const n = MAX_STEPS;
  const density = rng.range(0.3, 0.7);
  const on = new Array(n).fill(0);
  switch (FILL_STYLES[style] || 'uniform') {
    case 'drunk': {
      let state = 1;
      for (let i = 0; i < n; i++) {
        on[i] = state;
        // persistence: tends to stay in its current state, biased by density
        const stay = state ? 0.35 + density * 0.4 : 0.75 - density * 0.4;
        if (rng.next() > stay) state = 1 - state;
      }
      break;
    }
    case 'sparse': {
      const d = density * 0.45;
      for (let i = 0; i < n; i++) on[i] = rng.next() < d ? 1 : 0;
      break;
    }
    case 'cluster': {
      let i = 0;
      while (i < n) {
        if (rng.next() < density * 0.55) {
          const len = 2 + rng.int(3);
          for (let k = 0; k < len && i < n; k++, i++) on[i] = 1;
          i += 1 + rng.int(3);
        } else i++;
      }
      break;
    }
    case 'euclid': {
      const k = Math.max(1, Math.round(density * n));
      const e = euclid(k, n);
      const rot = rng.int(n);
      for (let i = 0; i < n; i++) on[i] = e[(i + rot) % n];
      break;
    }
    default:
      for (let i = 0; i < n; i++) on[i] = rng.next() < density ? 1 : 0;
  }
  on[0] = 1; // step 1 always on
  return on;
}

// Fill an operator's steps. amount < 1 only re-rolls that fraction of the steps.
export function fillSteps(op, style, rng, amount = 1) {
  const on = onPattern(style, rng);
  const nShapes = 1 + rng.int(3);
  const palette = [];
  while (palette.length < nShapes) {
    const s = weighted(rng, SHAPE_WEIGHTS);
    if (palette.indexOf(s) < 0) palette.push(s);
  }
  let drunkDepth = rng.range(0.5, 1);
  for (let i = 0; i < MAX_STEPS; i++) {
    const roll = rng.next();
    const st = makeStep();
    if (on[i]) {
      drunkDepth = Math.min(1, Math.max(0.3, drunkDepth + rng.bipolar() * 0.25));
      const mag = FILL_STYLES[style] === 'drunk' ? drunkDepth : rng.range(0.35, 1);
      const neg = i !== 0 && rng.next() < 0.15;
      st.depth = Math.round((neg ? -mag : mag) * 100) / 100;
      st.shape = palette[rng.int(palette.length)];
      if (i !== 0 && rng.next() < 0.25) st.prob = Math.round(rng.range(0.4, 0.95) * 100) / 100;
      if (rng.next() < 0.1) { st.ratchet = 2 + rng.int(3); st.ratchetProb = Math.round(rng.range(0.4, 1) * 100) / 100; }
      if (i !== 0 && rng.next() < 0.05) st.skip = 1;
      if (rng.next() < 0.05) st.repeat = 0.5;
    }
    if (i === 0 || roll < amount) op.steps[i] = st;
  }
}

// Scatter parameter locks over active steps.
export function rndLocks(op, density, rng) {
  for (const st of op.steps) {
    st.lock = { ratio: null, decay: null, feedback: null, shape: null };
    if (st.depth === 0 || rng.next() >= density) continue;
    const key = LOCK_KEYS[rng.int(LOCK_KEYS.length)];
    st.lock[key] = randomLockValue(key, rng);
  }
}

export function randomLockValue(key, rng) {
  switch (key) {
    case 'ratio': return randomRatio(rng);
    case 'decay': return round4(Math.exp(rng.range(Math.log(0.02), Math.log(2))));
    case 'feedback': return round4(rng.bipolar());
    case 'shape': return rng.int(SHAPES.length);
  }
  return null;
}

// Randomise one section: voice | seq | clocks | mods.
export function randomizeSection(patch, section, amount, rng, opIndex = -1) {
  for (const spec of PARAM_SPECS) {
    if (spec.section !== section || spec.nornd) continue;
    if (opIndex >= 0 && spec.path.startsWith('ops.') && !spec.path.startsWith(`ops.${opIndex}.`)) continue;
    if (opIndex >= 0 && !spec.path.startsWith('ops.')) continue;
    if (spec.path === 'voice.hz' && patch.voice.pitchMode !== 'hz') continue;
    if (spec.path.endsWith('.fixedHz')) continue;
    if (spec.path === 'clock.hz' && patch.clock.mode !== 'hz') continue;
    randomizePath(patch, spec.path, amount, rng);
  }
  if (section === 'seq') {
    for (let i = 0; i < NUM_OPS; i++) {
      if (opIndex >= 0 && i !== opIndex) continue;
      if (rng.next() < amount) fillSteps(patch.ops[i], patch.rnd.style, rng, 1);
    }
  }
  if (section === 'clocks') {
    for (let i = 0; i < NUM_OPS; i++) {
      if (opIndex >= 0 && i !== opIndex) continue;
      if (rng.next() < amount * 0.5) {
        const set = [];
        while (set.length < 3) { const k = weighted(rng, MULT_WEIGHTS); if (set.indexOf(k) < 0) set.push(k); }
        patch.ops[i].jumpSet = set.sort((a, b) => a - b);
      }
    }
  }
}

// rnd all, respecting section locks { voice, seq, clocks, mods }.
export function rndAll(patch, locks, amount, rng) {
  for (const sec of ['voice', 'seq', 'clocks', 'mods']) {
    if (locks[sec]) continue;
    randomizeSection(patch, sec, amount, rng);
  }
}

// ---------- morph ----------
const LOG_KEYS = new Set(['ratio', 'attack', 'decay', 'fixedHz', 'hz', 'pitchEnvDecay', 'rate', 'mult']);
const LIN_KEYS = new Set(['fine', 'level', 'seqAmount', 'destRange', 'drift', 'jitter', 'scatter', 'jumpChance',
  'depth', 'prob', 'ratchetProb', 'skip', 'repeat', 'pitchEnvSemis', 'pan', 'feedback', 'bpm', 'smooth',
  'algoChance', 'amount', 'lockDensity']);
const ROUND_KEYS = new Set(['note']);

export function morphPatches(a, b, x) {
  return morphNode(a, b, x, '');
}

function morphNode(a, b, x, key) {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return x < 0.5 ? a : b;
    return a.map((v, i) => morphNode(v, b[i], x, key));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const o = {};
    for (const k of Object.keys(a)) o[k] = morphNode(a[k], b[k], x, k);
    return o;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (LOG_KEYS.has(key) && a > 0 && b > 0) return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * x);
    if (LIN_KEYS.has(key)) return a + (b - a) * x;
    if (ROUND_KEYS.has(key)) return Math.round(a + (b - a) * x);
  }
  return x < 0.5 ? a : b;
}

// Randomise every part of the patch, ignoring section locks: voice, operators, steps (style, probability,
// ratchets, locks), clocks, jump sets, gate row and random-walk modulators. Output level is left alone.
export function randomizeEverything(patch, rng) {
  rndAll(patch, {}, 1, rng);
  patch.rnd.style = rng.int(FILL_STYLES.length);
  patch.rnd.lockDensity = round4(rng.range(0, 0.4));
  patch.voice.pitchEnvSemis = round4(rng.next() < 0.5 ? rng.range(-24, 24) : rng.range(-4, 4));
  for (let i = 0; i < NUM_OPS; i++) {
    const op = patch.ops[i];
    op.ratioMode = rng.next() < 0.12 ? 'fixed' : 'ratio';
    op.fixedHz = round4(Math.exp(rng.range(Math.log(40), Math.log(4000))));
    fillSteps(op, rng.int(FILL_STYLES.length), rng, 1);
    rndLocks(op, patch.rnd.lockDensity, rng);
    const set = [];
    const n = 2 + rng.int(3);
    while (set.length < n) { const k = rng.int(MULT_PRESETS.length); if (set.indexOf(k) < 0) set.push(k); }
    op.jumpSet = set.sort((a, b) => a - b);
  }
  // keep at least one carrier clearly audible
  const alg = patch.voice.algorithm;
  const carriers = ALGORITHMS[alg].carriers;
  for (const c of carriers) patch.ops[c].level = Math.max(patch.ops[c].level, 0.45);
  if (rng.next() < 0.5) patch.ops[carriers[0]].amp = 1; // often a steady carrier, so modulation is audible
  patch.ops[carriers[0]].seqAmount = Math.max(0.5, patch.ops[carriers[0]].seqAmount);
  const targets = MOD_TARGETS_LOCAL;
  for (const m of patch.mods) {
    m.on = rng.next() < 0.7;
    m.target = targets[1 + rng.int(targets.length - 1)];
    m.depth = round4(rng.bipolar() * (m.target === 'pitch' ? 0.15 : 0.6));
  }
  patch.clock.mode = 'bpm';
  patch.clock.gateOn = rng.next() < 0.3;
  patch.clock.gateLen = 4 + rng.int(13);
  patch.clock.gate = patch.clock.gate.map((_, k) => k === 0 || rng.next() < 0.4);
  patch.rnd.algoChance = round4(rng.next() < 0.5 ? 0 : rng.range(0, 0.3));
}

// ---------- alter ----------
// Nudge every continuous value a little: amount is the typical move as a fraction of each parameter's range
// (log-scaled for log parameters). Choices, step counts, ratios and clock multipliers stay as they are, so the
// sound keeps its character; operator pitch only moves by a few cents through 'fine'. Output level is left alone.
export function alterEverything(patch, rng, amount = 0.03) {
  const nudge = () => (rng.next() + rng.next() - 1) * 2 * amount; // triangular, -2a..2a, mostly small
  for (const spec of PARAM_SPECS) {
    if (spec.nornd || (spec.type !== 'lin' && spec.type !== 'log')) continue;
    const cur = getPath(patch, spec.path);
    if (typeof cur !== 'number' || !isFinite(cur)) continue;
    let v;
    if (spec.type === 'log') {
      const lr = Math.log(spec.max) - Math.log(spec.min);
      v = Math.exp(Math.log(Math.max(spec.min, cur)) + nudge() * lr * 0.5);
    } else {
      const d = spec.path.endsWith('.fine') ? 0.1 : 1; // keep pitch moves to a few cents
      v = cur + nudge() * (spec.max - spec.min) * 0.5 * d;
    }
    setPath(patch, spec.path, round4(Math.max(spec.min, Math.min(spec.max, v))));
  }
  for (const op of patch.ops) {
    for (const st of op.steps) {
      if (st.depth !== 0) {
        const s = Math.sign(st.depth);
        st.depth = round4(s * Math.max(0.05, Math.min(1, Math.abs(st.depth) + nudge())));
      }
      if (st.prob < 1) st.prob = round4(Math.max(0.05, Math.min(1, st.prob + nudge())));
      if (st.ratchetProb < 1) st.ratchetProb = round4(Math.max(0.05, Math.min(1, st.ratchetProb + nudge())));
    }
  }
}
