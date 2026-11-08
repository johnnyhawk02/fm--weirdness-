// UI shell: builds the LCD panel, keeps the patch, undo/redo, snapshots, and drives the worklet.
import {
  defaultPatch, clonePatch, getPath, setPath, SPEC_BY_PATH, ALGORITHMS, OP_NAMES, MULT_PRESETS, MULT_LABELS,
  DIRECTIONS, DESTS, FILL_STYLES, LOCK_KEYS, MOD_TARGETS, MAX_STEPS, multLabel, masterRateHz,
} from '../dsp/params.js';
import { SHAPES, shapeValue } from '../dsp/shapes.js';
import { Rng, hashSeed } from '../dsp/rng.js';
import { randomizePath, randomizeSection, fillSteps, rndLocks, rndAll, morphPatches, randomLockValue, randomizeEverything } from '../dsp/random.js';
import { presetName } from './names.js';
import { el, knob, selector, toggle, button, hiCanvas, toNorm, fromNorm } from './widgets.js';

const C = { ink: '#17200e', spot: '#e0532a', dim: 'rgba(23,32,14,0.22)', faint: 'rgba(23,32,14,0.10)', bg: '#d1c7ac', mid: 'rgba(23,32,14,0.55)' };
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => NOTE[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
const LANES = ['depth', 'prob', 'ratch', 'lock'];

// ---------------- state ----------------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('fmseq.' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('fmseq.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const fresh = new URLSearchParams(location.search).has('fresh');
let patch = (!fresh && store.get('patch')) || defaultPatch();
const ui = {
  seedLocked: false,
  locks: { voice: false, seq: false, clocks: false, mods: false },
  rndCount: 0,
  lane: [0, 0, 0, 0], lockKey: [0, 0, 0, 0],
  snaps: (!fresh && store.get('snaps')) || new Array(8).fill(null),
  snapA: 0, snapB: 1, morph: 0,
  running: false, state: null, selected: null,
  presets: (!fresh && store.get('presets')) || null,
  presetIdx: -1, presetName: (!fresh && store.get('presetName')) || '', presetDirty: false,
};
const undoStack = [], redoStack = [];
const refreshers = [];
let lastEditTime = 0, patchDirty = false;

function pushUndo() {
  undoStack.push(JSON.stringify(patch));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(patch));
  patch = JSON.parse(undoStack.pop());
  changed(true);
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(patch));
  patch = JSON.parse(redoStack.pop());
  changed(true);
}
function refreshAll() { for (const f of refreshers) f(); }
function changed(refresh = true) {
  patchDirty = true;
  ui.presetDirty = true;
  if (refresh) refreshAll();
}
function uiRng() { return new Rng(hashSeed(patch.seed, 'ui', ui.rndCount++)); }

// Context handed to widgets.
const ctx = {
  get: (p) => getPath(patch, p),
  set: (p, v) => { setPath(patch, p, v); changed(true); },
  beginEdit(coalesce) {
    const now = performance.now();
    if (!coalesce || now - lastEditTime > 600) pushUndo();
    lastEditTime = now;
  },
  register: (f) => refreshers.push(f),
  select(node) {
    if (ui.selected && ui.selected !== node) ui.selected.classList.remove('sel');
    ui.selected = node; node.classList.add('sel');
  },
  rnd(p, opts) {
    pushUndo();
    const rng = uiRng();
    if (SPEC_BY_PATH[p]) randomizePath(patch, p, patch.rnd.amount, rng);
    else if (opts && (opts.values || opts.labels)) {
      const vals = opts.values || opts.labels.map((_, i) => i);
      if (rng.next() < patch.rnd.amount) setPath(patch, p, vals[rng.int(vals.length)]);
    } else if (typeof getPath(patch, p) === 'boolean') {
      if (rng.next() < patch.rnd.amount) setPath(patch, p, rng.next() < 0.5);
    }
    changed(true);
  },
};
// Context for UI-only values (morph, slot pickers).
const uictx = {
  get: (p) => ui[p], set: (p, v) => { ui[p] = v; if (p === 'morph') applyMorph(); refreshAll(); },
  beginEdit: () => ctx.beginEdit(true), register: ctx.register, select: ctx.select, rnd() {},
};

// ---------------- audio ----------------
let ac = null, node = null;
async function ensureAudio() {
  if (node) return;
  ac = new AudioContext({ latencyHint: 'interactive' });
  await ac.audioWorklet.addModule(new URL('../worklet/processor.js', import.meta.url));
  node = new AudioWorkletNode(ac, 'fm-seq', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  node.connect(ac.destination);
  node.port.onmessage = (e) => onWorklet(e.data);
}
function onWorklet(m) {
  if (m.type === 'state') ui.state = m.state;
  else if (m.type === 'sync') {
    for (const k of Object.keys(m.ops)) { patch.ops[k].steps = m.ops[k].steps; patch.ops[k].mult = m.ops[k].mult; }
    if (m.algorithm != null) patch.voice.algorithm = m.algorithm;
    refreshAll();
  } else if (m.type === 'stopped') ui.state = null;
}
async function startStop() {
  if (ui.running) {
    ui.running = false;
    if (node) node.port.postMessage({ type: 'stop' });
  } else {
    await ensureAudio();
    await ac.resume();
    node.port.postMessage({ type: 'start', patch });
    patchDirty = false;
    ui.running = true;
  }
  refreshAll();
}

// ---------------- builders ----------------
const top = document.getElementById('top');
const opsEl = document.getElementById('ops');
const bottom = document.getElementById('bottom');

function group(parent, title) {
  const g = el('div', 'col', parent);
  if (title) el('div', 'lbl', g, title).style.color = C.mid;
  const r = el('div', 'row', g);
  return r;
}

// --- top bar ---
const brand = el('div', 'brand', top, 'FM/STEP');
const nameBox = el('input', 'pname', brand);
nameBox.spellcheck = false;
nameBox.title = 'preset name (type to rename, enter to save)';
nameBox.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { savePreset(); nameBox.blur(); } });
nameBox.addEventListener('input', () => { ui.presetName = nameBox.value; ui.presetDirty = true; refreshAll(); });
ctx.register(() => {
  if (document.activeElement !== nameBox) nameBox.value = ui.presetName;
  nameBox.classList.toggle('dirty', ui.presetDirty);
});
const startBtn = button(top, 'START', startStop, 'space');
startBtn.id = 'start';
const bigRnd = button(top, 'RANDOMISE', () => randomiseAll(), 'randomise everything, ignoring locks, with a new name (R)');
bigRnd.id = 'bigrnd';
ctx.register(() => { startBtn.textContent = ui.running ? 'STOP' : 'START'; startBtn.classList.toggle('spot', ui.running); });
el('div', 'sep', top);

const clockG = group(top, 'master saw');
const cm = el('div', 'col', clockG);
selector(ctx, cm, { path: 'clock.mode', labels: ['bpm', 'hz'], values: ['bpm', 'hz'], width: 34 });
const cycleLbl = el('div', 'val', cm, '');
knob(ctx, clockG, { path: () => (patch.clock.mode === 'hz' ? 'clock.hz' : 'clock.bpm'), label: () => (patch.clock.mode === 'hz' ? 'rate' : 'bpm'),
  fmt: (v) => (patch.clock.mode === 'hz' ? v.toFixed(2) : v.toFixed(0)) });
knob(ctx, clockG, { path: 'clock.beats', label: 'beats', fmt: (v) => String(v) });
const masterSaw = hiCanvas(clockG, 'saw');
masterSaw.style.width = '110px'; masterSaw.style.height = '34px';
el('div', 'sep', top);

const voiceG = group(top, 'voice');
const vm = el('div', 'col', voiceG);
selector(ctx, vm, { path: 'voice.pitchMode', labels: ['note', 'hz'], values: ['note', 'hz'], width: 38 });
knob(ctx, voiceG, { path: () => (patch.voice.pitchMode === 'hz' ? 'voice.hz' : 'voice.note'), label: 'pitch',
  fmt: (v) => (patch.voice.pitchMode === 'hz' ? v.toFixed(0) : noteName(v)) });
knob(ctx, voiceG, { path: 'voice.pitchEnvSemis', label: 'p.env', fmt: (v) => v.toFixed(1) });
knob(ctx, voiceG, { path: 'voice.pitchEnvDecay', label: 'p.dec', fmt: (v) => (v < 1 ? (v * 1000).toFixed(0) + 'm' : v.toFixed(2)) });
el('div', 'sep', top);

const algoG = group(top, 'algorithm');
const algos = el('div', 'algos', algoG);
const algoEls = ALGORITHMS.map((a, i) => {
  const b = el('div', 'algo', algos);
  el('span', 'n', b, String(i + 1));
  b.appendChild(algoSvg(a));
  b.title = a.name;
  b.addEventListener('pointerdown', (e) => {
    if (e.shiftKey) { ctx.rnd('voice.algorithm'); return; }
    ctx.beginEdit(); patch.voice.algorithm = i; changed(true);
  });
  return b;
});
ctx.register(() => algoEls.forEach((b, i) => b.classList.toggle('base', i === patch.voice.algorithm)));
el('div', 'sep', top);
const outG = group(top, 'out');
knob(ctx, outG, { path: 'voice.feedback', label: 'fb D' });
knob(ctx, outG, { path: 'voice.level', label: 'level' });
knob(ctx, outG, { path: 'voice.pan', label: 'pan' });

function algoSvg(a) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', 34); svg.setAttribute('height', 38);
  // level = distance from a carrier
  const lvl = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) for (let t = 0; t < 4; t++) if (a.mods[t].includes(j)) lvl[j] = Math.max(lvl[j], lvl[t] + 1);
  for (let j = 0; j < 4; j++) for (let t = 0; t < 4; t++) if (a.mods[t].includes(j)) lvl[j] = Math.max(lvl[j], lvl[t] + 1);
  const maxL = Math.max(...lvl);
  const pos = [];
  for (let L = 0; L <= maxL; L++) {
    const ops = [0, 1, 2, 3].filter((j) => lvl[j] === L);
    ops.forEach((j, k) => { pos[j] = { x: 17 + (k - (ops.length - 1) / 2) * 8, y: 30 - L * (maxL > 2 ? 7 : 9) }; });
  }
  const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; };
  for (let t = 0; t < 4; t++) for (const s of a.mods[t]) add('line', { x1: pos[s].x, y1: pos[s].y, x2: pos[t].x, y2: pos[t].y, stroke: C.ink, 'stroke-width': 1 });
  add('line', { x1: 3, y1: 35, x2: 31, y2: 35, stroke: C.ink, 'stroke-width': 1 });
  for (const c of a.carriers) add('line', { x1: pos[c].x, y1: pos[c].y, x2: pos[c].x, y2: 35, stroke: C.ink, 'stroke-width': 1 });
  for (let j = 0; j < 4; j++) {
    add('rect', { x: pos[j].x - 2.5, y: pos[j].y - 2.5, width: 5, height: 5, fill: j === 3 ? C.bg : C.ink, stroke: C.ink, 'stroke-width': 1 });
  }
  return svg;
}

// --- operator rows ---
const opUI = [];
for (let i = 0; i < 4; i++) buildOp(i);

function buildOp(i) {
  const o = `ops.${i}.`;
  const row = el('div', 'op', opsEl);
  // head
  const head = el('div', 'head', row);
  el('div', 'letter', head, OP_NAMES[i]);
  const role = el('div', 'role', head, '');
  selector(ctx, head, { path: o + 'ratioMode', labels: ['ratio', 'fixed'], values: ['ratio', 'fixed'], width: 42 });
  const rr = el('div', 'row', head); rr.style.gap = '2px';
  button(rr, 'fm', () => rndSection('voice', i), 'randomise this operator\'s FM settings');
  button(rr, 'clk', () => rndSection('clocks', i), 'randomise this operator\'s clock');
  ctx.register(() => {
    const a = ALGORITHMS[patch.voice.algorithm];
    role.textContent = a.carriers.includes(i) ? 'carrier' : a.mods.some((m) => m.includes(i)) ? 'mod' : 'unused';
  });

  // FM knobs
  const kg = el('div', 'knobgrid fmk', row);
  knob(ctx, kg, { path: () => (patch.ops[i].ratioMode === 'fixed' ? o + 'fixedHz' : o + 'ratio'),
    label: () => (patch.ops[i].ratioMode === 'fixed' ? 'hz' : 'ratio'),
    fmt: (v) => (patch.ops[i].ratioMode === 'fixed' ? v.toFixed(0) : v.toFixed(2)) });
  knob(ctx, kg, { path: o + 'fine', label: 'fine', fmt: (v) => v.toFixed(0) + 'c' });
  knob(ctx, kg, { path: o + 'level', label: () => (ALGORITHMS[patch.voice.algorithm].carriers.includes(i) ? 'level' : 'index') });
  knob(ctx, kg, { path: o + 'attack', label: 'att', fmt: ms });
  knob(ctx, kg, { path: o + 'decay', label: 'dec', fmt: ms });
  knob(ctx, kg, { path: o + 'seqAmount', label: 'seq amt' });

  // step strip
  const sw = el('div', 'stripwrap', row);
  const strip = hiCanvas(sw, 'strip');
  const tools = el('div', 'striptools', sw);
  selector(uictxLane(i), tools, { path: 'lane', labels: LANES, width: 44 });
  const lockSel = selector(uictxLane(i), tools, { path: 'lockKey', labels: LOCK_KEYS, width: 52 });
  ctx.register(() => { lockSel.style.display = ui.lane[i] === 3 ? '' : 'none'; });
  const stepCount = selector(ctx, tools, { path: o + 'length', labels: Array.from({ length: 16 }, (_, k) => `${k + 1} st`), values: Array.from({ length: 16 }, (_, k) => k + 1), width: 38 });
  stepCount.title = 'step count (click/right-click/wheel)';
  selector(ctx, tools, { path: 'rnd.style', labels: FILL_STYLES, width: 52 });
  button(tools, 'rnd', (e) => rndSteps(i, e), 'fill steps with the chosen style (shift: rnd amount)');
  button(tools, 'rnd lk', () => { pushUndo(); rndLocks(patch.ops[i], patch.rnd.lockDensity, uiRng()); changed(true); }, 'scatter parameter locks');
  button(tools, 'clr', () => { pushUndo(); for (const s of patch.ops[i].steps) { s.depth = 0; s.lock = { ratio: null, decay: null, feedback: null, shape: null }; } changed(true); });
  const posLbl = el('div', 'val', tools, '');
  posLbl.style.marginLeft = 'auto';
  stripEvents(strip, i);

  // seq column
  const sc = el('div', 'knobgrid seqk', row);
  const dsel = el('div', 'col', sc);
  selector(ctx, dsel, { path: o + 'dest', labels: DESTS, label: 'dest', width: 38 });
  knob(ctx, sc, { path: o + 'destRange', label: 'range', fmt: (v) => (patch.ops[i].dest === 0 ? '-' : (v * 2).toFixed(1) + 'oc') });
  const dirc = el('div', 'col', sc);
  selector(ctx, dirc, { path: o + 'direction', labels: DIRECTIONS, label: 'dir', width: 38 });
  knob(ctx, sc, { path: o + 'mutateK', label: 'mutate', fmt: (v) => (v ? v + ' st' : 'off') });
  knob(ctx, sc, { path: o + 'mutateEvery', label: 'every', fmt: (v) => v + ' cy' });
  knob(ctx, sc, { path: o + 'syncEvery', label: 'reset', fmt: (v) => v + ' cy' });

  // clock column
  const cc = el('div', 'col clockc', row);
  const r1 = el('div', 'row', cc); r1.style.alignItems = 'flex-end';
  const mcol = el('div', 'col', r1);
  el('div', 'lbl', mcol, 'mult');
  multSelector(mcol, i);
  const scol = el('div', 'col', r1);
  el('div', 'lbl', scol, 'sync');
  toggle(ctx, scol, { path: o + 'sync', text: 'sync' });
  const sawc = el('div', 'col', r1);
  const sawLbl = el('div', 'lbl', sawc, 'slave saw');
  const saw = hiCanvas(sawc, 'saw');
  const r2 = el('div', 'row', cc); r2.style.gap = '2px';
  knob(ctx, r2, { path: o + 'drift', label: 'drift', fmt: (v) => (v * 100).toFixed(1) + '%' });
  knob(ctx, r2, { path: o + 'jitter', label: 'jitter', fmt: pct });
  knob(ctx, r2, { path: o + 'scatter', label: 'scatt', fmt: pct });
  knob(ctx, r2, { path: o + 'jumpChance', label: 'jump', fmt: pct });
  const js = el('div', 'col', r2);
  el('div', 'lbl', js, 'jump set');
  const jset = el('div', 'jumpset', js);
  const jEls = MULT_PRESETS.map((m, k) => {
    const b = el('div', 'j', jset);
    b.title = MULT_LABELS[k];
    b.addEventListener('pointerdown', () => {
      pushUndo();
      const set = patch.ops[i].jumpSet;
      const at = set.indexOf(k);
      if (at >= 0) set.splice(at, 1); else { set.push(k); set.sort((a, b2) => a - b2); }
      changed(true);
    });
    return b;
  });
  const jlab = el('div', 'val', js, '');
  ctx.register(() => {
    jEls.forEach((b, k) => b.classList.toggle('on', patch.ops[i].jumpSet.includes(k)));
    jlab.textContent = patch.ops[i].jumpSet.map((k) => MULT_LABELS[k]).join(' ');
  });
  opUI[i] = { strip, saw, posLbl, sawLbl };
}

function uictxLane(i) {
  return {
    get: (p) => (p === 'lane' ? ui.lane[i] : ui.lockKey[i]),
    set: (p, v) => { if (p === 'lane') ui.lane[i] = v; else ui.lockKey[i] = v; refreshAll(); },
    beginEdit() {}, register: ctx.register, select: ctx.select, rnd() {},
  };
}

function multSelector(parent, i) {
  const p = `ops.${i}.mult`;
  const box = el('div', 'sel-box', parent);
  box.style.width = '44px';
  const nearest = () => {
    const m = patch.ops[i].mult;
    let best = 0;
    MULT_PRESETS.forEach((v, k) => { if (Math.abs(Math.log(v / m)) < Math.abs(Math.log(MULT_PRESETS[best] / m))) best = k; });
    return best;
  };
  ctx.register(() => { box.textContent = '×' + multLabel(patch.ops[i].mult); });
  const stepBy = (d) => {
    ctx.beginEdit();
    const m = patch.ops[i].mult;
    let k = nearest();
    if (Math.abs(MULT_PRESETS[k] - m) < 1e-9 || (d > 0 ? MULT_PRESETS[k] < m : MULT_PRESETS[k] > m)) k += d;
    k = Math.max(0, Math.min(MULT_PRESETS.length - 1, k));
    patch.ops[i].mult = MULT_PRESETS[k];
    changed(true);
  };
  box.addEventListener('pointerdown', (e) => {
    ctx.select(box);
    if (e.shiftKey) { ctx.rnd(p); return; }
    stepBy(e.button === 2 ? -1 : 1);
  });
  box.addEventListener('contextmenu', (e) => e.preventDefault());
  box.addEventListener('wheel', (e) => { e.preventDefault(); stepBy(e.deltaY > 0 ? -1 : 1); }, { passive: false });
  box.title = 'click/right-click: presets · double-click: free value (0.01-16)';
  box.addEventListener('dblclick', () => {
    const inp = el('input', 'num', null);
    inp.value = String(+patch.ops[i].mult.toFixed(4));
    inp.style.width = '44px';
    box.replaceWith(inp);
    inp.focus(); inp.select();
    const done = (ok) => {
      if (ok) {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) { pushUndo(); patch.ops[i].mult = Math.min(16, Math.max(0.01, v)); }
      }
      inp.replaceWith(box);
      changed(true);
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true), { once: true });
  });
}

function ms(v) { return v < 1 ? (v * 1000).toFixed(v < 0.01 ? 1 : 0) + 'm' : v.toFixed(2) + 's'; }
function pct(v) { return (v * 100).toFixed(0) + '%'; }

// --- step strip interaction ---
function stripGeom(c) {
  const w = c._w, h = c._h;
  const glyphH = 12, indH = 9;
  const top = 2, bot = h - glyphH - indH - 2;
  return { w, h, cw: w / MAX_STEPS, top, bot, H: bot - top, mid: top + (bot - top) / 2, glyphH, indH };
}

const LOCK_RANGE = {
  ratio: { type: 'log', min: 0.5, max: 16 }, decay: { type: 'log', min: 0.01, max: 4 },
  feedback: { type: 'lin', min: -1, max: 1 }, shape: { type: 'int', min: 0, max: SHAPES.length - 1 },
};

function stripEvents(c, i) {
  let painting = false, pressTimer = 0, moved = false, lastCell = -1;
  const cellAt = (e) => {
    const r = c.getBoundingClientRect();
    const g = stripGeom(c);
    return { k: Math.max(0, Math.min(MAX_STEPS - 1, Math.floor((e.clientX - r.left) / g.cw))), y: e.clientY - r.top, g };
  };
  const apply = (k, y, g) => {
    const st = patch.ops[i].steps[k];
    const lane = ui.lane[i];
    if (lane === 0) {
      let v = (g.mid - y) / (g.H / 2);
      v = Math.max(-1, Math.min(1, v));
      if (Math.abs(v) < 0.08) v = 0;
      st.depth = Math.round(v * 100) / 100;
    } else if (lane === 1) {
      st.prob = Math.round(Math.max(0, Math.min(1, (g.bot - y) / g.H)) * 100) / 100;
    } else if (lane === 2) {
      st.ratchet = Math.max(1, Math.min(4, 1 + Math.floor((g.bot - y) / g.H * 4)));
      if (st.ratchet > 1 && !st.ratchetProb) st.ratchetProb = 1;
    } else {
      const key = LOCK_KEYS[ui.lockKey[i]];
      const n = (g.bot - y) / g.H;
      let v = fromNorm(LOCK_RANGE[key], n);
      if (key !== 'shape') v = Math.round(v * 1000) / 1000;
      st.lock[key] = v;
    }
    changed(false);
  };
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  c.addEventListener('pointerdown', (e) => {
    const { k, y, g } = cellAt(e);
    const st = patch.ops[i].steps[k];
    if (e.button === 2) { pushUndo(); cycleShape(st, e.shiftKey ? -1 : 1); changed(false); return; }
    if (e.shiftKey) { pushUndo(); st.skip = st.skip > 0 ? 0 : 1; changed(false); return; }
    if (e.altKey) { pushUndo(); st.repeat = st.repeat > 0 ? 0 : 1; changed(false); return; }
    pushUndo();
    painting = true; moved = false; lastCell = k;
    c.setPointerCapture(e.pointerId);
    apply(k, y, g);
    if (e.pointerType !== 'mouse') {
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => { if (!moved) { undo(); pushUndo(); cycleShape(st, 1); changed(false); painting = false; } }, 450);
    }
  });
  c.addEventListener('pointermove', (e) => {
    if (!painting) return;
    const { k, y, g } = cellAt(e);
    moved = true;
    if (k !== lastCell) {
      const a = Math.min(k, lastCell), b = Math.max(k, lastCell);
      for (let q = a; q <= b; q++) apply(q, y, g);
      lastCell = k;
    } else apply(k, y, g);
  });
  const end = () => { painting = false; clearTimeout(pressTimer); };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
  c.addEventListener('dblclick', (e) => {
    const { k } = cellAt(e);
    const st = patch.ops[i].steps[k];
    if (ui.lane[i] === 3) st.lock[LOCK_KEYS[ui.lockKey[i]]] = null;
    else if (ui.lane[i] === 1) st.prob = 1;
    else if (ui.lane[i] === 2) st.ratchet = 1;
    else st.depth = 0;
    changed(false);
  });
}
function cycleShape(st, d) {
  st.shape = (st.shape + d + SHAPES.length) % SHAPES.length;
  if (st.depth === 0) st.depth = 0.8;
}

// --- randomise helpers ---
function rndSection(section, opIndex) {
  pushUndo();
  randomizeSection(patch, section, patch.rnd.amount, uiRng(), opIndex);
  changed(true);
}
function rndSteps(i) {
  pushUndo();
  fillSteps(patch.ops[i], patch.rnd.style, uiRng(), patch.rnd.amount < 0.05 ? 0 : Math.max(patch.rnd.amount, 0.999 * (patch.rnd.amount >= 0.5)));
  changed(true);
}
function randomiseAll() {
  pushUndo();
  if (!ui.seedLocked) patch.seed = (Math.random() * 4294967296) >>> 0;
  ui.presetName = presetName(new Rng(hashSeed(patch.seed, 'name'))); ui.presetIdx = -1;
  randomizeEverything(patch, new Rng(hashSeed(patch.seed, 'everything')));
  changed(true);
  ui.presetDirty = true;
}
function rndEverything(rename) {
  pushUndo();
  if (rename !== false) { ui.presetName = presetName(uiRng()); ui.presetDirty = true; ui.presetIdx = -1; }
  if (!ui.seedLocked) patch.seed = (Math.random() * 4294967296) >>> 0;
  rndAll(patch, ui.locks, patch.rnd.amount, new Rng(hashSeed(patch.seed, 'rndall')));
  changed(true);
}

// --- bottom panels ---
const modsP = el('div', 'panel', bottom);
el('div', 'title', modsP, 'random walk');
const modsRow = el('div', 'mods', modsP);
const modBars = [];
for (let m = 0; m < 4; m++) {
  const mc = el('div', 'mod', modsRow);
  const hr = el('div', 'row', mc); hr.style.gap = '2px';
  toggle(ctx, hr, { path: `mods.${m}.on`, text: String(m + 1) });
  selector(ctx, hr, { path: `mods.${m}.target`, labels: MOD_TARGETS, values: MOD_TARGETS, width: 80 });
  const kr = el('div', 'row', mc); kr.style.gap = '2px';
  knob(ctx, kr, { path: `mods.${m}.rate`, label: 'rate', fmt: (v) => v.toFixed(2) });
  knob(ctx, kr, { path: `mods.${m}.smooth`, label: 'smooth' });
  knob(ctx, kr, { path: `mods.${m}.depth`, label: 'depth' });
  const bar = el('div', 'modbar', mc);
  modBars.push(el('i', null, bar));
}

const rndP = el('div', 'panel', bottom);
el('div', 'title', rndP, 'randomise');
const rr1 = el('div', 'row', rndP);
const rcol = el('div', 'col', rr1);
const rall = button(rcol, 'RND ALL', () => rndEverything(true), 'roll everything not locked');
rall.style.height = '22px'; rall.style.lineHeight = '20px'; rall.style.fontWeight = '700';
const lockRow = el('div', 'row', rcol); lockRow.style.gap = '2px';
for (const sec of ['voice', 'seq', 'clocks', 'mods']) {
  const t = el('div', 'tog', lockRow, sec);
  t.title = `lock ${sec} against rnd all`;
  const ref = () => { t.classList.toggle('on', ui.locks[sec]); t.classList.toggle('off', !ui.locks[sec]); t.textContent = (ui.locks[sec] ? '▪' : '') + sec; };
  t.addEventListener('pointerdown', () => { ui.locks[sec] = !ui.locks[sec]; ref(); });
  ref();
}
const seedRow = el('div', 'row', rcol); seedRow.style.gap = '2px'; seedRow.style.alignItems = 'center';
el('div', 'lbl', seedRow, 'seed');
const seedIn = el('input', 'num', seedRow);
seedIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') seedIn.blur(); });
seedIn.addEventListener('change', () => { const v = parseInt(seedIn.value, 10); if (Number.isFinite(v)) { pushUndo(); patch.seed = v >>> 0; changed(true); } });
ctx.register(() => { if (document.activeElement !== seedIn) seedIn.value = String(patch.seed); });
const seedLock = el('div', 'tog off', seedRow, 'lock');
seedLock.title = 'keep this seed for rnd all (same seed, same roll)';
seedLock.addEventListener('pointerdown', () => { ui.seedLocked = !ui.seedLocked; seedLock.classList.toggle('on', ui.seedLocked); seedLock.classList.toggle('off', !ui.seedLocked); });
const urRow = el('div', 'row', rcol); urRow.style.gap = '2px';
button(urRow, 'undo', undo, 'ctrl-z');
button(urRow, 'redo', redo, 'ctrl-shift-z');
const rk = el('div', 'row', rr1); rk.style.gap = '2px';
knob(ctx, rk, { path: 'rnd.amount', label: 'amount', spec: { type: 'lin', min: 0, max: 1, def: 0.5 } });
knob(ctx, rk, { path: 'rnd.algoChance', label: 'algo%', fmt: pct });
knob(ctx, rk, { path: 'rnd.lockDensity', label: 'lock%', spec: { type: 'lin', min: 0, max: 1, def: 0.25 }, fmt: pct });

const snapP = el('div', 'panel', bottom);
snapP.style.flex = '1';
el('div', 'title', snapP, 'snapshots · note gate');
const sr1 = el('div', 'row', snapP); sr1.style.alignItems = 'center';
const slots = el('div', 'slots', sr1);
const slotEls = ui.snaps.map((_, k) => {
  const s = el('div', 'slot', slots, String(k + 1));
  s.title = 'click: store if empty, recall if full · shift-click: overwrite · right-click: clear';
  s.addEventListener('contextmenu', (e) => e.preventDefault());
  s.addEventListener('pointerdown', (e) => {
    if (e.button === 2) ui.snaps[k] = null;
    else if (!ui.snaps[k] || e.shiftKey) ui.snaps[k] = clonePatch(patch);
    else { pushUndo(); patch = clonePatch(ui.snaps[k]); changed(true); }
    store.set('snaps', ui.snaps);
    refreshAll();
  });
  return s;
});
ctx.register(() => slotEls.forEach((s, k) => { s.classList.toggle('full', !!ui.snaps[k]); }));
const slotOpts = { labels: ui.snaps.map((_, k) => 'S' + (k + 1)), width: 30 };
selector(uictx, sr1, { ...slotOpts, path: 'snapA', label: 'a' });
knob(uictx, sr1, { path: 'morph', label: 'morph', spec: { type: 'lin', min: 0, max: 1, def: 0 } });
selector(uictx, sr1, { ...slotOpts, path: 'snapB', label: 'b' });
function applyMorph() {
  const a = ui.snaps[ui.snapA], b = ui.snaps[ui.snapB];
  if (!a || !b) return;
  patch = morphPatches(a, b, ui.morph);
  patchDirty = true;
}
// presets
const pr = el('div', 'row', snapP); pr.style.alignItems = 'center'; pr.style.gap = '2px';
el('div', 'lbl', pr, 'preset');
button(pr, '◂', () => stepPreset(-1), 'previous preset');
button(pr, '▸', () => stepPreset(1), 'next preset');
const pcount = el('div', 'val', pr, '');
pcount.style.width = '40px'; pcount.style.textAlign = 'center';
button(pr, 'save', () => savePreset(), 'save under the current name (overwrites a preset of the same name)');
button(pr, 'name', () => { ui.presetName = presetName(uiRng()); ui.presetDirty = true; refreshAll(); }, 'generate a new name');
button(pr, 'del', () => deletePreset(), 'delete the current preset');
button(pr, 'export', () => exportPresets(), 'download all presets as JSON');
button(pr, 'import', () => importPresets(), 'load presets from a JSON file');
ctx.register(() => {
  pcount.textContent = ui.presetIdx >= 0 ? `${ui.presetIdx + 1}/${ui.presets.length}` : `-/${ui.presets.length}`;
});
const gr = el('div', 'row', snapP); gr.style.alignItems = 'center';
toggle(ctx, gr, { path: 'clock.gateOn', text: 'gate', title: 'retrigger notes from the gate row instead of every master wrap' });
selector(ctx, gr, { path: 'clock.gateLen', labels: Array.from({ length: 16 }, (_, k) => `${k + 1}`), values: Array.from({ length: 16 }, (_, k) => k + 1), width: 24 });
const gates = el('div', 'gates', gr);
const gateEls = Array.from({ length: MAX_STEPS }, (_, k) => {
  const g = el('div', 'gate', gates);
  g.addEventListener('pointerdown', (e) => {
    pushUndo();
    if (e.shiftKey) { const r = uiRng(); patch.clock.gate = patch.clock.gate.map((v, q) => q === 0 || r.next() < 0.4); }
    else patch.clock.gate[k] = !patch.clock.gate[k];
    changed(true);
  });
  return g;
});
ctx.register(() => gateEls.forEach((g, k) => { g.classList.toggle('on', !!patch.clock.gate[k]); g.classList.toggle('off-len', k >= patch.clock.gateLen); }));

// ---------------- presets ----------------
function factoryPresets() {
  const out = [];
  const r = new Rng(hashSeed(2026, 'factory'));
  out.push({ name: presetName(r), patch: defaultPatch() });
  for (let k = 0; k < 11; k++) {
    const p = defaultPatch();
    p.seed = (r.next() * 4294967296) >>> 0;
    rndAll(p, { mods: k % 3 === 0 }, 1, new Rng(hashSeed(p.seed, 'rndall')));
    if (k % 2) for (const op of p.ops) { op.mutateK = 1 + (k % 3); op.mutateEvery = 2; }
    out.push({ name: presetName(r), patch: p });
  }
  return out;
}
if (!Array.isArray(ui.presets) || !ui.presets.length) { ui.presets = factoryPresets(); store.set('presets', ui.presets); }
if (!ui.presetName) { ui.presetIdx = 0; ui.presetName = ui.presets[0].name; patch = clonePatch(ui.presets[0].patch); }
else ui.presetIdx = ui.presets.findIndex((q) => q.name === ui.presetName);

function savePreset() {
  const name = (ui.presetName || '').trim() || presetName(uiRng());
  ui.presetName = name;
  const at = ui.presets.findIndex((q) => q.name === name);
  const entry = { name, patch: clonePatch(patch) };
  if (at >= 0) { ui.presets[at] = entry; ui.presetIdx = at; } else { ui.presets.push(entry); ui.presetIdx = ui.presets.length - 1; }
  ui.presetDirty = false;
  store.set('presets', ui.presets); store.set('presetName', name);
  flash('saved ' + name);
  refreshAll();
}
function loadPreset(k) {
  if (!ui.presets.length) return;
  k = (k + ui.presets.length) % ui.presets.length;
  pushUndo();
  ui.presetIdx = k; ui.presetName = ui.presets[k].name; ui.presetDirty = false;
  patch = clonePatch(ui.presets[k].patch);
  store.set('presetName', ui.presetName);
  changed(false);
  ui.presetDirty = false;
  refreshAll();
}
function stepPreset(d) { loadPreset(ui.presetIdx < 0 ? (d > 0 ? 0 : -1) : ui.presetIdx + d); }
function deletePreset() {
  const k = ui.presetIdx;
  if (k < 0) return;
  ui.presets.splice(k, 1);
  store.set('presets', ui.presets);
  ui.presetIdx = -1; ui.presetDirty = true;
  flash('deleted');
  refreshAll();
}
function exportPresets() {
  const blob = new Blob([JSON.stringify({ format: 'fm-step-presets', version: 1, presets: ui.presets }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'fm-step-presets.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importPresets() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      const list = Array.isArray(data) ? data : data.presets;
      let n = 0;
      for (const q of list || []) {
        if (!q || typeof q.name !== 'string' || !q.patch || !Array.isArray(q.patch.ops)) continue;
        const at = ui.presets.findIndex((x) => x.name === q.name);
        if (at >= 0) ui.presets[at] = q; else ui.presets.push(q);
        n++;
      }
      store.set('presets', ui.presets);
      flash(`imported ${n}`);
      refreshAll();
    } catch { flash('import failed'); }
  };
  inp.click();
}
let flashTimer = 0;
function flash(msg) {
  const h = document.getElementById('hint');
  if (!h._orig) h._orig = h.textContent;
  h.textContent = msg; h.style.color = C.ink;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { h.textContent = h._orig; h.style.color = ''; }, 1600);
}

// ---------------- drawing ----------------
function drawSaw(c, phase, live) {
  const g = c.getContext('2d');
  const dpr = c._dpr || 1, w = c._w, h = c._h;
  if (!w) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = C.bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = C.dim; g.lineWidth = 1;
  g.beginPath(); g.moveTo(1, h - 2); g.lineTo(w - 1, 2); g.lineTo(w - 1, h - 2); g.stroke();
  if (live) {
    const x = 1 + (w - 2) * phase;
    g.strokeStyle = C.ink; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(1, h - 2); g.lineTo(x, h - 2 - (h - 4) * phase); g.stroke();
    g.fillStyle = C.spot; g.fillRect(x - 1, 1, 2, h - 2);
  }
}

function drawStrip(i) {
  const c = opUI[i].strip;
  const g = c.getContext('2d');
  const geo = stripGeom(c);
  if (!geo.w) return;
  const dpr = c._dpr || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = C.bg; g.fillRect(0, 0, geo.w, geo.h);
  const op = patch.ops[i];
  const st = ui.state;
  const pos = st ? st[3 + i * 5 + 1] : -1;
  const phase = st ? st[3 + i * 5] : 0;
  const fired = st ? st[3 + i * 5 + 2] > 0 : false;
  const lane = ui.lane[i];
  const segH = 3, segGap = 1;
  const nseg = Math.max(4, Math.floor(geo.H / (segH + segGap)));
  const segPitch = geo.H / nseg;
  g.font = '8px ui-monospace, Menlo, monospace';
  g.textBaseline = 'top';
  for (let k = 0; k < MAX_STEPS; k++) {
    const s = op.steps[k];
    const x = k * geo.cw + 2, cw = geo.cw - 4;
    const inLen = k < op.length;
    const cur = k === pos && inLen;
    g.globalAlpha = inLen ? 1 : 0.35;
    const lit = cur ? C.spot : C.ink;
    // value of this lane, mapped to lit segments
    for (let q = 0; q < nseg; q++) {
      const y = geo.top + q * segPitch;
      const vc = (q + 0.5) / nseg; // 0 top .. 1 bottom
      let on = false;
      if (lane === 0) {
        const v = 1 - 2 * vc; // +1 top .. -1 bottom
        on = (s.depth > 0 && v > 0 && v <= s.depth + 1e-6) || (s.depth < 0 && v < 0 && v >= s.depth - 1e-6);
      } else if (lane === 1) on = s.depth !== 0 && 1 - vc <= s.prob + 1e-6;
      else if (lane === 2) on = s.depth !== 0 && Math.floor((1 - vc) * 4) < s.ratchet;
      else {
        const key = LOCK_KEYS[ui.lockKey[i]];
        const lv = s.lock[key];
        on = lv != null && 1 - vc <= toNorm(LOCK_RANGE[key], lv) + 1e-6;
      }
      g.fillStyle = on ? lit : C.faint;
      g.fillRect(x, y, cw, segPitch - segGap);
    }
    if (lane === 0) { g.fillStyle = C.dim; g.fillRect(x, geo.mid - 0.5, cw, 1); }
    // shape glyph
    const gy = geo.bot + 3, gh = geo.glyphH - 3;
    const shape = s.lock.shape != null ? s.lock.shape : s.shape;
    g.strokeStyle = s.depth === 0 ? C.dim : lit;
    g.lineWidth = 1.2;
    g.beginPath();
    for (let p = 0; p <= 16; p++) {
      const t = p / 16;
      const yy = gy + gh - gh * shapeValue(shape, t) * (s.depth < 0 ? 1 : 1);
      if (p === 0) g.moveTo(x + t * cw, yy); else g.lineTo(x + t * cw, yy);
    }
    g.stroke();
    // indicators
    const parts = [];
    if (s.depth !== 0 && s.prob < 1) parts.push(Math.round(s.prob * 100) + '');
    if (s.ratchet > 1) parts.push('×' + s.ratchet);
    if (s.skip > 0) parts.push('sk');
    if (s.repeat > 0) parts.push('rp');
    if (LOCK_KEYS.some((kk) => s.lock[kk] != null)) parts.push('L');
    if (parts.length) {
      g.fillStyle = cur ? C.spot : C.ink;
      g.fillText(parts.join(' '), x, geo.h - geo.indH, cw);
    }
    // playhead progress inside the running step
    if (cur) {
      g.fillStyle = C.spot;
      g.fillRect(x, geo.bot + 1, cw * phase, 1.5);
      if (!fired) { g.strokeStyle = C.spot; g.lineWidth = 1; g.strokeRect(x + 0.5, geo.top + 0.5, cw - 1, geo.H - 1); }
    }
  }
  g.globalAlpha = 1;
}

function frame() {
  if (patchDirty && node && ui.running) {
    node.port.postMessage({ type: 'patch', patch });
    patchDirty = false;
  }
  if (patchDirty) { store.set('patch', patch); }
  const st = ui.state;
  const live = ui.running && !!st;
  drawSaw(masterSaw, live ? st[0] : 0, live);
  cycleLbl.textContent = live ? `cy ${Math.max(0, st[1] | 0)}` : `${(1 / masterRateHz(patch.clock)).toFixed(2)}s`;
  for (let i = 0; i < 4; i++) {
    drawStrip(i);
    drawSaw(opUI[i].saw, live ? st[3 + i * 5] : 0, live);
    const pos = live ? st[3 + i * 5 + 1] + 1 : 0;
    opUI[i].posLbl.textContent = live ? `step ${String(pos).padStart(2, '0')}/${patch.ops[i].length}` : `${patch.ops[i].length} steps`;
  }
  const liveAlgo = live ? st[2] : -1;
  algoEls.forEach((b, k) => b.classList.toggle('live', k === liveAlgo));
  for (let m = 0; m < 4; m++) {
    const v = live ? st[23 + m] : 0;
    modBars[m].style.left = `calc(${((v + 1) / 2 * 100).toFixed(1)}% - 1px)`;
    modBars[m].style.opacity = patch.mods[m].on ? 1 : 0.3;
  }
  if (live && patch.clock.gateOn) {
    const gi = Math.floor(st[0] * patch.clock.gateLen);
    gateEls.forEach((g, k) => g.classList.toggle('cur', k === gi));
  } else gateEls.forEach((g) => g.classList.remove('cur'));
  requestAnimationFrame(frame);
}

// ---------------- keys ----------------
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space') { e.preventDefault(); startStop(); }
  else if (e.key === 'r' && !e.ctrlKey && !e.metaKey) randomiseAll();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); savePreset(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
});

refreshAll();
requestAnimationFrame(frame);
window.fmseq = { get patch() { return patch; }, startStop, ui };
