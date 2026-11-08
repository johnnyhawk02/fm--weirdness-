// Preset name generator: splices small chunks of words from themed lists. No DOM.
export const WORDS = {
  greece: ['Athena', 'Sparta', 'Delphi', 'Achilles', 'Olympus', 'Corinth', 'Hermes', 'Pericles', 'Mycenae', 'Theseus',
    'Kronos', 'Argos', 'Thebes', 'Odysseus', 'Agora', 'Hoplite', 'Medusa', 'Apollo', 'Knossos', 'Ithaca', 'Socrates',
    'Amphora', 'Trireme', 'Minotaur', 'Persephone', 'Parthenon', 'Electra', 'Icarus'],
  chinese: ['Wonton', 'Dumpling', 'Chowmein', 'Dimsum', 'Bao', 'Kungpao', 'Hoisin', 'Szechuan', 'Mapo', 'Siumai',
    'Lomein', 'Charsiu', 'Congee', 'Jiaozi', 'Xiaolong', 'Bokchoy', 'Fooyung', 'Wokhei', 'Tofu', 'Hargow', 'Chashu',
    'Eggroll', 'Wuxi', 'Dandan', 'Zongzi', 'Mooncake'],
  mountains: ['Everest', 'Kilimanjaro', 'Matterhorn', 'Denali', 'Eiger', 'Annapurna', 'Fuji', 'Elbrus', 'Aconcagua',
    'Olympus', 'Kosciuszko', 'Snowdon', 'Ben Nevis', 'Rainier', 'Makalu', 'Lhotse', 'Nanga', 'Tabor', 'Etna',
    'Vesuvius', 'Helvellyn', 'Scafell', 'Cotopaxi', 'Toubkal', 'Triglav', 'Kailash'],
  villages: ['Bourton', 'Wetwang', 'Giggleswick', 'Snitterfield', 'Bibury', 'Lacock', 'Mousehole', 'Clovelly', 'Grasmere',
    'Polperro', 'Castleton', 'Ombersley', 'Nether Wallop', 'Great Snoring', 'Barton', 'Pity Me', 'Wigglesworth',
    'Ugley', 'Didling', 'Bletchley', 'Muker', 'Thwaite', 'Goathland', 'Haworth', 'Biggin', 'Slaggyford', 'Whitwell'],
  astronomy: ['Nebula', 'Quasar', 'Pulsar', 'Perihelion', 'Aphelion', 'Zenith', 'Nadir', 'Parallax', 'Corona', 'Umbra',
    'Penumbra', 'Albedo', 'Azimuth', 'Syzygy', 'Magnetar', 'Redshift', 'Sirius', 'Vega', 'Betelgeuse', 'Orion',
    'Andromeda', 'Kuiper', 'Oort', 'Ecliptic', 'Equinox', 'Solstice', 'Meteor', 'Nova', 'Halo', 'Libration'],
};
const LISTS = Object.keys(WORDS);

// split a word into vowel-anchored chunks: "Giggleswick" -> gi, ggle, swi, ck
export function chunks(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  const parts = w.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy](?![aeiouy]))?/g) || [w];
  const used = parts.join('').length;
  if (used < w.length) parts[parts.length - 1] += w.slice(used);
  return parts;
}

function pick(rng, a) { return a[Math.floor(rng.next() * a.length)]; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// One spliced word: head chunks of one word + tail chunks of another (different list).
function splice(rng) {
  const l1 = pick(rng, LISTS);
  let l2 = pick(rng, LISTS);
  if (l2 === l1) l2 = LISTS[(LISTS.indexOf(l1) + 1 + Math.floor(rng.next() * 4)) % LISTS.length];
  const a = chunks(pick(rng, WORDS[l1])), b = chunks(pick(rng, WORDS[l2]));
  const nh = Math.max(1, Math.min(a.length - (a.length > 1 ? 1 : 0), 1 + Math.floor(rng.next() * 2)));
  const nt = Math.max(1, Math.min(b.length, 1 + Math.floor(rng.next() * 2)));
  let s = a.slice(0, nh).join('') + b.slice(b.length - nt).join('');
  if (s.length < 4) s += pick(rng, chunks(pick(rng, WORDS[pick(rng, LISTS)])));
  return cap(s.slice(0, 12));
}

// rng: anything with next() -> [0,1)
export function presetName(rng) {
  const r = rng.next();
  if (r < 0.6) return splice(rng);
  if (r < 0.85) return `${splice(rng)} ${splice(rng)}`;
  // a spliced word next to a whole one
  const whole = pick(rng, WORDS[pick(rng, LISTS)]);
  return rng.next() < 0.5 ? `${splice(rng)} ${whole}` : `${whole} ${splice(rng)}`;
}
