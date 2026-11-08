// Step envelope shapes. Each maps t in [0,1] to a 0..1 curve.

export const SHAPES = ['perc', 'pluck', 'long', 'swell', 'rise', 'fall', 'tri', 'gate', 'bounce'];
export const SHAPE_INDEX = Object.fromEntries(SHAPES.map((s, i) => [s, i]));

function attackDecay(t, att, k) {
  if (t < att) return t / att;
  return Math.exp(-k * (t - att));
}

export function shapeValue(shape, t) {
  if (t <= 0) t = 0; else if (t >= 1) t = 1;
  switch (shape) {
    case 0: return attackDecay(t, 0.02, 7);    // perc
    case 1: return attackDecay(t, 0.01, 18);   // pluck
    case 2: return attackDecay(t, 0.04, 2.5);  // long
    case 3: return (Math.exp(4 * t) - 1) / 53.6; // swell
    case 4: return t;                          // rise
    case 5: return 1 - t;                      // fall
    case 6: return t < 0.5 ? 2 * t : 2 - 2 * t; // tri
    case 7: // gate: fast attack, hold to 70 %, fall finished by 74 %
      if (t < 0.005) return t / 0.005;
      if (t < 0.7) return 1;
      if (t < 0.74) return 1 - (t - 0.7) / 0.04;
      return 0;
    case 8: { // bounce
      let v = Math.exp(-14 * t);
      if (t >= 0.5) v += 0.6 * Math.exp(-14 * (t - 0.5));
      return v;
    }
    default: return 0;
  }
}
