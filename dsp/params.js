// Patch model, constants and parameter specs. Plain data, no DOM.

export const OP_NAMES = ['A', 'B', 'C', 'D'];
export const MAX_STEPS = 16;

// Algorithms: mods[target] = operator indices modulating target; carriers = summed to output.
// Every modulator has a higher index than its target, so operators render D, C, B, A.
export const ALGORITHMS = [
  { name: 'D>C>B>A',       mods: [[1], [2], [3], []],     carriers: [0] },
  { name: 'D,C>B>A',       mods: [[1], [2, 3], [], []],   carriers: [0] },
  { name: 'B>A  D>C',      mods: [[1], [], [3], []],      carriers: [0, 2] },
  { name: 'B,C,D>A',       mods: [[1, 2, 3], [], [], []], carriers: [0] },
  { name: 'D>A,B,C',       mods: [[3], [3], [3], []],     carriers: [0, 1, 2] },
  { name: 'D>C  B,C>A',    mods: [[1, 2], [], [3], []],   carriers: [0] },
  { name: 'D>C  A B C',    mods: [[], [], [3], []],       carriers: [0, 1, 2] },
  { name: 'A B C D',       mods: [[], [], [], []],        carriers: [0, 1, 2, 3] },
];

export const MULT_PRESETS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4, 6, 8];
export const MULT_LABELS = ['1/4', '1/3', '1/2', '2/3', '3/4', '1', '4/3', '3/2', '2', '3', '4', '6', '8'];
export const DIRECTIONS = ['fwd', 'rev', 'pend', 'walk'];
export const DESTS = ['level', 'ratio', 'pitch'];
export const FILL_STYLES = ['uniform', 'drunk', 'sparse', 'cluster', 'euclid'];
export const LOCK_KEYS = ['ratio', 'decay', 'feedback', 'shape'];
export const MOD_TARGETS = [
  'off', 'pitch', 'feedback', 'algorithm', 'pan',
  'A.level', 'B.level', 'C.level', 'D.level',
  'A.ratio', 'B.ratio', 'C.ratio', 'D.ratio',
  'A.decay', 'B.decay', 'C.decay', 'D.decay',
  'A.seqAmount', 'B.seqAmount', 'C.seqAmount', 'D.seqAmount',
];

export function multLabel(m) {
  for (let i = 0; i < MULT_PRESETS.length; i++) if (Math.abs(MULT_PRESETS[i] - m) < 1e-9) return MULT_LABELS[i];
  return m.toFixed(m < 1 ? 3 : 2);
}

export function makeStep(depth = 0, shape = 0) {
  return {
    depth, shape,
    prob: 1,          // chance to fire
    ratchet: 1,       // 1..4 sub-hits
    ratchetProb: 1,   // chance the ratchet happens
    skip: 0,          // chance the step is jumped
    repeat: 0,        // chance the step plays twice
    lock: { ratio: null, decay: null, feedback: null, shape: null },
  };
}

function makeOp(i) {
  const ratios = [1, 2, 3, 0.5];
  const mults = [2, 4, 3, 3 / 2];
  const levels = [0.85, 0.45, 0.55, 0.35];
  const steps = [];
  for (let s = 0; s < MAX_STEPS; s++) steps.push(makeStep());
  return {
    // FM
    ratioMode: 'ratio', ratio: ratios[i], fine: 0, fixedHz: 440,
    level: levels[i], attack: 0.002, decay: [3, 0.8, 2.5, 2][i],
    // sequencer
    length: [8, 16, 12, 6][i], steps, seqAmount: 1, dest: 0, destRange: 0.5,
    mutateEvery: 2, mutateK: 0,
    // clock
    mult: mults[i], sync: true, syncEvery: 4, drift: 0, jitter: 0, scatter: 0,
    direction: 0, jumpChance: 0, jumpSet: [5, 8, 9, 10],
  };
}

export function defaultPatch() {
  const p = {
    seed: 1234,
    voice: {
      pitchMode: 'note', note: 45, hz: 110,
      pitchEnvSemis: 7, pitchEnvDecay: 0.02,
      level: 0.8, pan: 0, algorithm: 2, feedback: 0.2,
    },
    clock: {
      mode: 'bpm', bpm: 120, beats: 1, hz: 0.5,
      gateOn: false, gateLen: 8, gate: Array.from({ length: MAX_STEPS }, (_, i) => i % 4 === 0),
    },
    ops: [0, 1, 2, 3].map(makeOp),
    rnd: { algoChance: 0, amount: 0.5, style: 0, lockDensity: 0.25 },
    mods: [
      { on: true, target: 'algorithm', depth: 0.3, rate: 0.125, smooth: 0 },
      { on: true, target: 'feedback', depth: 0.3, rate: 0.5, smooth: 0.8 },
      { on: true, target: 'pitch', depth: 0.04, rate: 0.3, smooth: 0.9 },
      { on: false, target: 'A.ratio', depth: 0.2, rate: 0.15, smooth: 0.7 },
    ],
  };
  // a musical starting pattern
  const pat = [
    [[0, 1, 0], [3, 0.6, 1], [6, 0.8, 0], [7, 0.4, 1]],
    [[0, 0.9, 1], [2, 0.5, 1], [5, 0.7, 0], [9, 0.6, 8], [12, 1, 1], [14, 0.4, 1]],
    [[0, 0.7, 6], [4, -0.6, 0], [7, 0.8, 3], [10, 0.5, 6]],
    [[0, 1, 2], [2, 0.6, 4], [4, -0.8, 5]],
  ];
  pat.forEach((list, i) => list.forEach(([s, d, sh]) => { p.ops[i].steps[s].depth = d; p.ops[i].steps[s].shape = sh; }));
  return p;
}

export function clonePatch(p) { return JSON.parse(JSON.stringify(p)); }

export function noteToHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }

export function masterRateHz(clock) {
  if (clock.mode === 'hz') return clock.hz;
  return clock.bpm / (60 * clock.beats);
}

// ---- Specs used by randomisers, morphing and the UI ----
// section: voice | seq | clocks.  type: lin | log | int | choice | bool
const opSpecs = [];
for (let i = 0; i < 4; i++) {
  const o = `ops.${i}.`;
  opSpecs.push(
    { path: o + 'ratio', section: 'voice', type: 'ratio', min: 0.5, max: 16, def: [1, 2, 3, 0.5][i] },
    { path: o + 'fine', section: 'voice', type: 'lin', min: -50, max: 50, def: 0, rndScale: 0.3 },
    { path: o + 'level', section: 'voice', type: 'lin', min: 0, max: 1, def: 0.5 },
    { path: o + 'attack', section: 'voice', type: 'log', min: 0.0005, max: 1, def: 0.002, rndMax: 0.15 },
    { path: o + 'decay', section: 'voice', type: 'log', min: 0.01, max: 8, def: 0.5 },
    { path: o + 'fixedHz', section: 'voice', type: 'log', min: 20, max: 8000, def: 440 },
    { path: o + 'seqAmount', section: 'seq', type: 'lin', min: 0, max: 1, def: 1 },
    { path: o + 'dest', section: 'seq', type: 'choice', n: 3, def: 0, rndWeights: [6, 2, 2] },
    { path: o + 'destRange', section: 'seq', type: 'lin', min: 0, max: 1, def: 0.5 },
    { path: o + 'length', section: 'seq', type: 'int', min: 1, max: 16, def: 16, rndMin: 3 },
    { path: o + 'mutateEvery', section: 'seq', type: 'int', min: 1, max: 16, def: 2 },
    { path: o + 'mutateK', section: 'seq', type: 'int', min: 0, max: 8, def: 0, rndMax: 3 },
    { path: o + 'mult', section: 'clocks', type: 'mult', min: 0.01, max: 16, def: 1 },
    { path: o + 'sync', section: 'clocks', type: 'bool', def: true, rndBias: 0.7 },
    { path: o + 'syncEvery', section: 'clocks', type: 'int', min: 1, max: 16, def: 1, rndMax: 4 },
    { path: o + 'drift', section: 'clocks', type: 'lin', min: 0, max: 0.05, def: 0 },
    { path: o + 'jitter', section: 'clocks', type: 'lin', min: 0, max: 1, def: 0, rndMax: 0.4 },
    { path: o + 'scatter', section: 'clocks', type: 'lin', min: 0, max: 1, def: 0, rndMax: 0.5 },
    { path: o + 'direction', section: 'clocks', type: 'choice', n: 4, def: 0, rndWeights: [5, 2, 2, 1] },
    { path: o + 'jumpChance', section: 'clocks', type: 'lin', min: 0, max: 1, def: 0, rndMax: 0.35 },
  );
}

export const PARAM_SPECS = [
  { path: 'voice.note', section: 'voice', type: 'int', min: 24, max: 84, def: 45, rndMin: 28, rndMax: 64 },
  { path: 'voice.hz', section: 'voice', type: 'log', min: 20, max: 2000, def: 110 },
  { path: 'voice.pitchEnvSemis', section: 'voice', type: 'lin', min: -24, max: 24, def: 0 },
  { path: 'voice.pitchEnvDecay', section: 'voice', type: 'log', min: 0.005, max: 2, def: 0.05 },
  { path: 'voice.level', section: 'voice', type: 'lin', min: 0, max: 1, def: 0.7, nornd: true },
  { path: 'voice.pan', section: 'voice', type: 'lin', min: -1, max: 1, def: 0, rndScale: 0.5 },
  { path: 'voice.algorithm', section: 'voice', type: 'choice', n: 8, def: 0 },
  { path: 'voice.feedback', section: 'voice', type: 'lin', min: -1, max: 1, def: 0 },
  { path: 'clock.bpm', section: 'clocks', type: 'int', min: 40, max: 240, def: 120, rndMin: 70, rndMax: 180 },
  { path: 'clock.beats', section: 'clocks', type: 'int', min: 1, max: 16, def: 4, rndMax: 8 },
  { path: 'clock.hz', section: 'clocks', type: 'log', min: 0.05, max: 20, def: 0.5, rndMax: 4 },
  { path: 'rnd.algoChance', section: 'clocks', type: 'lin', min: 0, max: 1, def: 0, rndMax: 0.3 },
  ...opSpecs,
];
for (let m = 0; m < 4; m++) {
  PARAM_SPECS.push(
    { path: `mods.${m}.rate`, section: 'mods', type: 'log', min: 0.02, max: 8, def: 0.3, rndMax: 2 },
    { path: `mods.${m}.smooth`, section: 'mods', type: 'lin', min: 0, max: 1, def: 0.5 },
    { path: `mods.${m}.depth`, section: 'mods', type: 'lin', min: -1, max: 1, def: 0, rndScale: 0.6 },
  );
}
export const SPEC_BY_PATH = Object.fromEntries(PARAM_SPECS.map((s) => [s.path, s]));

export function getPath(obj, path) {
  const parts = path.split('.');
  let o = obj;
  for (const k of parts) o = o[k];
  return o;
}
export function setPath(obj, path, v) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = v;
}
