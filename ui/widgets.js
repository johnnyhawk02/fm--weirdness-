// Flat LCD widgets. Each widget binds to a patch path through ctx and re-reads it on refresh().
import { SPEC_BY_PATH } from '../dsp/params.js';

const NS = 'http://www.w3.org/2000/svg';
export const RATIO_STEPS = [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

export function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function toNorm(spec, v) {
  if (spec.type === 'log' || spec.type === 'ratio' || spec.type === 'mult') return Math.log(v / spec.min) / Math.log(spec.max / spec.min);
  return (v - spec.min) / (spec.max - spec.min);
}
export function fromNorm(spec, n) {
  n = Math.min(1, Math.max(0, n));
  if (spec.type === 'log' || spec.type === 'ratio' || spec.type === 'mult') return spec.min * Math.pow(spec.max / spec.min, n);
  const v = spec.min + (spec.max - spec.min) * n;
  return spec.type === 'int' ? Math.round(v) : v;
}

function arcPath(cx, cy, r, a0, a1) {
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;

// Knob. opts: { path (string or fn), label, fmt(v), spec (optional override), bipolar, onChange }
export function knob(ctx, parent, opts) {
  const root = el('div', 'knob', parent);
  const lab = el('div', 'lbl', root, opts.label);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', 28); svg.setAttribute('height', 24);
  const off = document.createElementNS(NS, 'path'); off.setAttribute('class', 'arc-off');
  const on = document.createElementNS(NS, 'path'); on.setAttribute('class', 'arc-on');
  const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('class', 'dot'); dot.setAttribute('r', 2);
  for (const p of [off, on]) { p.setAttribute('fill', 'none'); p.setAttribute('stroke-width', 3); }
  off.setAttribute('d', arcPath(14, 13, 10, A0, A1));
  svg.append(off, on, dot);
  root.appendChild(svg);
  const val = el('div', 'val', root);
  const path = () => (typeof opts.path === 'function' ? opts.path() : opts.path);
  const spec = () => opts.spec || SPEC_BY_PATH[path().replace(/^ops\.\d\./, (m) => m)] || SPEC_BY_PATH[path()];
  const fmt = opts.fmt || ((v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)));

  function refresh() {
    const sp = spec();
    const v = ctx.get(path());
    const n = toNorm(sp, v);
    const a = A0 + (A1 - A0) * n;
    const bip = sp.min < 0 && sp.max > 0;
    const aMid = A0 + (A1 - A0) * toNorm(sp, 0);
    if (bip) on.setAttribute('d', a >= aMid ? arcPath(14, 13, 10, aMid, Math.max(aMid + 0.001, a)) : arcPath(14, 13, 10, a, aMid));
    else on.setAttribute('d', arcPath(14, 13, 10, A0, Math.max(A0 + 0.001, a)));
    dot.setAttribute('cx', (14 + 6 * Math.cos(a)).toFixed(2));
    dot.setAttribute('cy', (13 + 6 * Math.sin(a)).toFixed(2));
    val.textContent = fmt(v);
    lab.textContent = typeof opts.label === 'function' ? opts.label() : opts.label;
  }

  let startY = 0, startN = 0, dragging = false;
  root.addEventListener('pointerdown', (e) => {
    ctx.select(root);
    if (e.shiftKey) { ctx.rnd(path()); return; }
    if (e.button !== 0) return;
    dragging = true; startY = e.clientY;
    const sp = spec();
    startN = sp.type === 'ratio' ? RATIO_STEPS.indexOf(nearestRatio(ctx.get(path()))) : toNorm(sp, ctx.get(path()));
    ctx.beginEdit();
    root.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const sp = spec();
    const dy = startY - e.clientY;
    let v;
    if (sp.type === 'ratio' && !e.altKey) {
      const idx = Math.max(0, Math.min(RATIO_STEPS.length - 1, Math.round(startN + dy / 8)));
      v = RATIO_STEPS[idx];
    } else {
      const base = sp.type === 'ratio' ? toNorm(sp, RATIO_STEPS[Math.max(0, startN)]) : startN;
      v = fromNorm(sp, base + dy * (e.altKey ? 0.001 : 0.006));
    }
    ctx.set(path(), round(v), false);
  });
  root.addEventListener('pointerup', () => { dragging = false; });
  root.addEventListener('dblclick', () => {
    const sp = spec();
    ctx.beginEdit();
    ctx.set(path(), sp.def ?? sp.min, false);
  });
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const sp = spec();
    ctx.beginEdit(true);
    const n = toNorm(sp, ctx.get(path())) - Math.sign(e.deltaY) * (sp.type === 'int' ? 1 / (sp.max - sp.min) : 0.01);
    ctx.set(path(), round(fromNorm(sp, n)), false);
  }, { passive: false });
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  ctx.register(refresh);
  refresh();
  return root;
}

function nearestRatio(v) {
  let best = RATIO_STEPS[0];
  for (const r of RATIO_STEPS) if (Math.abs(Math.log(r / v)) < Math.abs(Math.log(best / v))) best = r;
  return best;
}
function round(v) { return Math.round(v * 10000) / 10000; }

// Selector: click = next, right-click = previous, wheel, shift-click = rnd.
// opts: { path, labels[], values[] (optional), label, width }
export function selector(ctx, parent, opts) {
  const wrap = el('div', 'field', parent);
  if (opts.label) el('div', 'lbl', wrap, opts.label);
  const box = el('div', 'sel-box', wrap);
  if (opts.width) box.style.width = opts.width + 'px';
  const values = opts.values || opts.labels.map((_, i) => i);
  const path = () => (typeof opts.path === 'function' ? opts.path() : opts.path);
  function idx() { const v = ctx.get(path()); const i = values.indexOf(v); return i < 0 ? 0 : i; }
  function refresh() {
    const v = ctx.get(path());
    const i = values.indexOf(v);
    box.textContent = i >= 0 ? opts.labels[i] : (opts.fmt ? opts.fmt(v) : String(v));
  }
  function step(d) {
    ctx.beginEdit();
    ctx.set(path(), values[(idx() + d + values.length) % values.length], false);
    if (opts.onChange) opts.onChange();
  }
  box.addEventListener('pointerdown', (e) => {
    ctx.select(box);
    if (e.shiftKey) { ctx.rnd(path(), opts); return; }
    step(e.button === 2 ? -1 : 1);
  });
  box.addEventListener('contextmenu', (e) => e.preventDefault());
  box.addEventListener('wheel', (e) => { e.preventDefault(); step(e.deltaY > 0 ? 1 : -1); }, { passive: false });
  ctx.register(refresh);
  refresh();
  return box;
}

// Toggle bound to a boolean path (or 0/1 number).
export function toggle(ctx, parent, opts) {
  const b = el('div', 'tog', parent, opts.text);
  const path = () => (typeof opts.path === 'function' ? opts.path() : opts.path);
  function refresh() {
    const on = !!ctx.get(path());
    b.classList.toggle('on', on); b.classList.toggle('off', !on);
  }
  b.addEventListener('pointerdown', (e) => {
    if (e.shiftKey && opts.rnd !== false) { ctx.rnd(path()); return; }
    ctx.beginEdit();
    const cur = ctx.get(path());
    ctx.set(path(), typeof cur === 'number' ? (cur ? 0 : 1) : !cur, false);
    if (opts.onChange) opts.onChange();
  });
  if (opts.title) b.title = opts.title;
  ctx.register(refresh);
  refresh();
  return b;
}

// Plain button.
export function button(parent, text, onClick, title) {
  const b = el('div', 'btn', parent, text);
  b.addEventListener('pointerdown', (e) => onClick(e));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  if (title) b.title = title;
  return b;
}

// Canvas sized to its CSS box at device pixel ratio. draw(ctx2d, w, h) is called by the owner.
export function hiCanvas(parent, cls) {
  const c = el('canvas', cls, parent);
  const fit = () => {
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c._dpr = dpr; c._w = r.width; c._h = r.height;
  };
  new ResizeObserver(fit).observe(c);
  fit();
  return c;
}
