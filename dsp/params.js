// Patch model, constants and parameter specs. Plain data, no DOM.

export const NUM_OPS = 7;
export const OP_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
export const MAX_STEPS = 16;

// Algorithms: mods[target] = operator indices modulating target; carriers = summed to output.
// Every modulator has a higher index than its target, so operators render G down to A.
// Feedback is on G, the last operator.
function alg(name, edges, carriers) {
  const mods = Array.from({ length: NUM_OPS }, () => []);
  for (const e of edges) { const [src, dst] = e.split('>').map((c) => c.charCodeAt(0) - 65); mods[dst].push(src); }
  const isCarrier = Array.from({ length: NUM_OPS }, (_, j) => carriers.includes(j));
  return { name, mods, carriers, isCarrier };
}
export const ALGORITHMS = [
  alg('G>F>E>D>C>B>A', ['B>A', 'C>B', 'D>C', 'E>D', 'F>E', 'G>F'], [0]),
  alg('D>C>B>A  G>F>E', ['B>A', 'C>B', 'D>C', 'F>E', 'G>F'], [0, 4]),
  alg('B>A  D>C  G>F>E', ['B>A', 'D>C', 'F>E', 'G>F'], [0, 2, 4]),
  alg('B,C,D>A  G>F>E', ['B>A', 'C>A', 'D>A', 'F>E', 'G>F'], [0, 4]),
  alg('G>A,B,C,D,E,F', ['G>A', 'G>B', 'G>C', 'G>D', 'G>E', 'G>F'], [0, 1, 2, 3, 4, 5]),
  alg('G>F>A,B,C  E>D', ['F>A', 'F>B', 'F>C', 'G>F', 'E>D'], [0, 1, 2, 3]),
  alg('B>A  D>C  F>E  G', ['B>A', 'D>C', 'F>E'], [0, 2, 4, 6]),
  alg('A B C D E F G', [], [0, 1, 2, 3, 4, 5, 6]),
  alg('C>B>A  F>E>D  G', ['B>A', 'C>B', 'E>D', 'F>E'], [0, 3, 6]),
  alg('G>F>E>D>C  B,C>A', ['B>A', 'C>A', 'D>C', 'E>D', 'F>E', 'G>F'], [0]),
  alg('diamond', ['G>F', 'G>E', 'F>D', 'E>D', 'D>C', 'C>B', 'B>A'], [0]),
  alg('G>F>E>A,B,C,D', ['G>F', 'F>E', 'E>D', 'E>C', 'E>B', 'E>A'], [0, 1, 2, 3]),
  alg('B..G>A', ['B>A', 'C>A', 'D>A', 'E>A', 'F>A', 'G>A'], [0]),
  alg('G,F>B,C>A', ['G>B', 'G>C', 'F>B', 'F>C', 'B>A', 'C>A'], [0]),
  alg('C>B>A  E>D  G>F', ['B>A', 'C>B', 'E>D', 'G>F'], [0, 3, 5]),
  alg('G>F>E>D  C>B  A', ['G>F', 'F>E', 'E>D', 'C>B'], [0, 1, 3]),
  alg('G>A F>B E>C  D', ['G>A', 'F>B', 'E>C'], [0, 1, 2, 3]),
  alg('G>F,E,D  C>B>A', ['G>F', 'G>E', 'G>D', 'C>B', 'B>A'], [0, 3, 4, 5]),
  alg('D>A,B,C  G>E,F', ['D>C', 'D>B', 'D>A', 'G>F', 'G>E'], [0, 1, 2, 4, 5]),
  alg('G>F>E>D  B,C>A', ['G>F', 'F>E', 'E>D', 'C>A', 'B>A'], [0, 3]),
  alg('tree', ['F>E', 'G>E', 'E>D', 'D>A', 'C>A', 'B>A'], [0]),
  alg('G>A,B,C,D  E F', ['G>A', 'G>B', 'G>C', 'G>D'], [0, 1, 2, 3, 4, 5]),
  alg('E>D>C>B>A  F G', ['B>A', 'C>B', 'D>C', 'E>D'], [0, 5, 6]),
  alg('A  C>B  E>D  G>F', ['G>F', 'E>D', 'C>B'], [0, 1, 3, 5]),
  alg('B,F,G>A  D,E>C', ['F>A', 'G>A', 'B>A', 'D>C', 'E>C'], [0, 2]),
  alg('G>F>A,B,C,D,E', ['G>F', 'F>E', 'F>D', 'F>C', 'F>B', 'F>A'], [0, 1, 2, 3, 4]),
  alg('F,G>E>A  D>A  C>B', ['G>E', 'F>E', 'E>A', 'D>A', 'C>B'], [0, 1]),
  alg('lattice', ['B>A', 'C>A', 'D>B', 'E>C', 'F>D', 'G>E'], [0]),
  alg('F,G>A  C,D,E>B', ['G>A', 'F>A', 'E>B', 'D>B', 'C>B'], [0, 1]),
  alg('F,G>C  D,E>B  >A', ['G>C', 'F>C', 'E>B', 'D>B', 'C>A', 'B>A'], [0]),
  alg('G>F,D,B  F>E D>C B>A', ['G>F', 'G>D', 'G>B', 'F>E', 'D>C', 'B>A'], [0, 2, 4]),
  alg('C>B>A  F>E>D  G', ['C>B', 'B>A', 'F>E', 'E>D'], [0, 3, 6]),
];
export const STEREO_MODES = ['spread', 'alt', 'mirror', 'random', 'rotate', 'mono'];


export const MULT_PRESETS = [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4, 6, 8, 12, 16, 32, 64];
export const MULT_LABELS = ['1/16', '1/8', '1/4', '1/3', '1/2', '2/3', '3/4', '1', '4/3', '3/2', '2', '3', '4', '6', '8', '12', '16', '32', '64'];
export const MULT_MIN = 1 / 64, MULT_MAX = 64;
export const AMP_SOURCES = ['env', 'hold', 'lfo1', 'lfo2', 'lfo3', 'lfo4'];
export const LFO_SHAPES = ['walk', 'sine', 'tri', 'saw', 'square'];
export const DIRECTIONS = ['fwd', 'rev', 'pend', 'walk'];
export const DESTS = ['level', 'ratio', 'pitch'];
export const FILL_STYLES = ['uniform', 'drunk', 'sparse', 'cluster', 'euclid'];
export const LOCK_KEYS = ['ratio', 'decay', 'feedback', 'shape'];
export const MOD_TARGETS = [
  'off', 'pitch', 'feedback', 'fb1', 'fb2', 'algorithm', 'pan', 'width', 'clock',
  ...['pan', 'rate', 'level', 'ratio', 'decay', 'seqAmount', 'fb'].flatMap((k) => ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((o) => `${o}.${k}`)),
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
  const ratios = [1, 2, 3, 0.5, 2, 3.5, 7];
  const mults = [2, 4, 3, 3 / 2, 2, 6, 1];
  const levels = [0.85, 0.45, 0.55, 0.35, 0.6, 0.5, 0.3];
  const steps = [];
  for (let s = 0; s < MAX_STEPS; s++) steps.push(makeStep());
  return {
    // FM
    ratioMode: 'ratio', ratio: ratios[i], fine: 0, fixedHz: 440, fb: 0, slew: [0.4, 0.25, 0.6, 1.2, 0.4, 0.15, 2][i], // slew: pitch glide time (s) // fb: self-feedback (G uses voice.feedback)
    level: levels[i], attack: 0.002,
    decay: [3, 0.8, 2.5, 2, 3, 0.6, 1.2][i],
    pan: [0, -0.8, 0.8, 0, 0, -0.5, 0.6][i], // modulators: which side of the carrier pair they modulate; carriers: placement
    amp: i === 0 || i === 4 ? 1 : 0, // amp source: 0 note envelope, 1 hold (steady), 2-5 LFO 1-4
    // sequencer
    length: [8, 16, 12, 6, 10, 7, 5][i], steps, seqAmount: i === 0 || i === 4 ? 0.3 : 1, dest: 0, destRange: 0.5,
    mutateEvery: 2, mutateK: 0,
    // clock
    clock: 1, hz: [1.1, 5.3, 3.7, 2.15, 0.9, 7.1, 1.6][i], // 0 = linked to the master saw (mult), 1 = free-running at hz steps/s
    mult: mults[i], sync: true, syncEvery: 4, drift: 0, jitter: 0, scatter: 0,
    direction: 0, jumpChance: 0, jumpSet: [7, 10, 11, 12],
  };
}

export function defaultPatch() {
  const p = {
    seed: 1234,
    voice: {
      pitchMode: 'note', note: 45, hz: 110,
      pitchEnvSemis: 7, pitchEnvDecay: 0.02,
      level: 0.8, pan: 0, algorithm: 1, feedback: 0.2,
      slewScale: 1, // multiplies every operator's pitch slew time
      stereo: 0, width: 0.8, rotate: 0.15, // carrier placement: mode, width 0..1, rotate speed (Hz)
      // cross-feedback paths: any operator's output bends any other's phase (G self-feedback is voice.feedback)
      paths: [{ from: 0, to: 6, amt: 0 }, { from: 2, to: 1, amt: 0 }],
    },
    clock: {
      mode: 'bpm', bpm: 120, beats: 1, hz: 0.5,
      gateOn: false, gateLen: 8, gate: Array.from({ length: MAX_STEPS }, (_, i) => i % 4 === 0),
    },
    ops: Array.from({ length: NUM_OPS }, (_, i) => makeOp(i)),
    rnd: { algoChance: 0, amount: 0.5, style: 0, lockDensity: 0.25 },
    mods: [
      { on: true, target: 'algorithm', depth: 0.3, rate: 0.125, smooth: 0, shape: 0 },
      { on: true, target: 'feedback', depth: 0.3, rate: 0.5, smooth: 0.8, shape: 0 },
      { on: true, target: 'pitch', depth: 0.04, rate: 0.3, smooth: 0.9, shape: 0 },
      { on: false, target: 'B.rate', depth: 0.3, rate: 0.1, smooth: 0, shape: 1 },
    ],
  };
  // a musical starting pattern
  const pat = [
    [[0, 1, 0], [3, 0.6, 1], [6, 0.8, 0], [7, 0.4, 1]],
    [[0, 0.9, 1], [2, 0.5, 1], [5, 0.7, 0], [9, 0.6, 8], [12, 1, 1], [14, 0.4, 1]],
    [[0, 0.7, 6], [4, -0.6, 0], [7, 0.8, 3], [10, 0.5, 6]],
    [[0, 1, 2], [2, 0.6, 4], [4, -0.8, 5]],
    [[0, 1, 0], [5, 0.7, 1]],
    [[0, 0.8, 1], [1, 0.4, 1], [3, 0.9, 7], [5, 0.5, 1]],
    [[0, 0.9, 6], [2, 0.6, 3], [3, -0.7, 0]],
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
for (let i = 0; i < NUM_OPS; i++) {
  const o = `ops.${i}.`;
  opSpecs.push(
    { path: o + 'ratio', section: 'voice', type: 'ratio', min: 0.5, max: 16, def: [1, 2, 3, 0.5][i] },
    { path: o + 'fine', section: 'voice', type: 'lin', min: -50, max: 50, def: 0, rndScale: 0.3 },
    { path: o + 'level', section: 'voice', type: 'lin', min: 0, max: 1, def: 0.5 },
    { path: o + 'attack', section: 'voice', type: 'log', min: 0.0005, max: 1, def: 0.002, rndMax: 0.15 },
    { path: o + 'decay', section: 'voice', type: 'log', min: 0.01, max: 8, def: 0.5 },
    { path: o + 'fixedHz', section: 'voice', type: 'log', min: 20, max: 8000, def: 440 },
    { path: o + 'pan', section: 'voice', type: 'lin', min: -1, max: 1, def: 0 },
    { path: o + 'slew', section: 'voice', type: 'log', min: 0.001, max: 8, def: 0.4, rndMax: 4 },
    ...(i < NUM_OPS - 1 ? [{ path: o + 'fb', section: 'voice', type: 'lin', min: -1, max: 1, def: 0, rndScale: 0.5 }] : []),
    { path: o + 'amp', section: 'voice', type: 'choice', n: 6, def: 0, rndWeights: [6, 2, 1, 1, 1, 1] },
    { path: o + 'seqAmount', section: 'seq', type: 'lin', min: 0, max: 1, def: 1 },
    { path: o + 'dest', section: 'seq', type: 'choice', n: 3, def: 0, rndWeights: [6, 2, 2] },
    { path: o + 'destRange', section: 'seq', type: 'lin', min: 0, max: 1, def: 0.5 },
    { path: o + 'length', section: 'seq', type: 'int', min: 1, max: 16, def: 16, rndMin: 3 },
    { path: o + 'mutateEvery', section: 'seq', type: 'int', min: 1, max: 16, def: 2 },
    { path: o + 'mutateK', section: 'seq', type: 'int', min: 0, max: 8, def: 0, rndMax: 3 },
    { path: o + 'clock', section: 'clocks', type: 'choice', n: 2, def: 1, rndWeights: [3, 7] },
    { path: o + 'hz', section: 'clocks', type: 'log', min: 0.02, max: 64, def: 2, rndMin: 0.3, rndMax: 12 },
    { path: o + 'mult', section: 'clocks', type: 'mult', min: 1 / 64, max: 64, def: 1 },
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
  { path: 'voice.algorithm', section: 'voice', type: 'choice', n: 32, def: 0 },
  { path: 'voice.stereo', section: 'voice', type: 'choice', n: 6, def: 0, rndWeights: [3, 3, 2, 2, 3, 0.3] },
  { path: 'voice.width', section: 'voice', type: 'lin', min: 0, max: 1, def: 0.8, rndMin: 0.3 },
  { path: 'voice.rotate', section: 'voice', type: 'log', min: 0.01, max: 8, def: 0.15, rndMax: 2 },
  { path: 'voice.slewScale', section: 'voice', type: 'log', min: 0.1, max: 10, def: 1, rndMin: 0.5, rndMax: 2 },
  { path: 'voice.feedback', section: 'voice', type: 'lin', min: -1, max: 1, def: 0 },
  ...[0, 1].flatMap((k) => [
    { path: `voice.paths.${k}.from`, section: 'voice', type: 'choice', n: NUM_OPS, def: 0 },
    { path: `voice.paths.${k}.to`, section: 'voice', type: 'choice', n: NUM_OPS, def: 6 },
    { path: `voice.paths.${k}.amt`, section: 'voice', type: 'lin', min: -1, max: 1, def: 0, rndScale: 0.6 },
  ]),
  { path: 'clock.bpm', section: 'clocks', type: 'int', min: 10, max: 999, def: 120, rndMin: 70, rndMax: 180 },
  { path: 'clock.beats', section: 'clocks', type: 'int', min: 1, max: 16, def: 4, rndMax: 8 },
  { path: 'clock.hz', section: 'clocks', type: 'log', min: 0.01, max: 50, def: 0.5, rndMax: 4 },
  { path: 'rnd.algoChance', section: 'clocks', type: 'lin', min: 0, max: 1, def: 0, rndMax: 0.3 },
  ...opSpecs,
];
for (let m = 0; m < 4; m++) {
  PARAM_SPECS.push(
    { path: `mods.${m}.rate`, section: 'mods', type: 'log', min: 0.01, max: 20, def: 0.3, rndMax: 2 },
    { path: `mods.${m}.shape`, section: 'mods', type: 'choice', n: 5, def: 0 },
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
