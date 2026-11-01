// ───────────────────────────── Settings, storage, routes, workouts ─────────────────────────────
// Storage: per-rider keys live under ascent.u.<id>.*; bike + video sync data is shared by everyone.
const SHARED = new Set(['users', 'currentUser', 'bike', 'vids', 'lastTest', 'migrated']);
const isShared = (k) => SHARED.has(k) || k.startsWith('vid.');
let _uid = null;
try { _uid = JSON.parse(localStorage.getItem('ascent.currentUser')); } catch (e) {}
const store = {
  key(k) { return isShared(k) || !_uid ? 'ascent.' + k : 'ascent.u.' + _uid + '.' + k; },
  prefix() { return _uid ? 'ascent.u.' + _uid + '.' : 'ascent.'; },
  get(k, d) { try { const v = localStorage.getItem(this.key(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(this.key(k), JSON.stringify(v)); } catch (e) {} }
};

const BIKE_KEYS = ['maxLevel', 'minLevel', 'protocol', 'fsTable', 'rawLog', 'quality'];
const RIDER_DEFAULTS = {
  name: 'Rider', weight: 75, ftp: 180, maxHr: 185,
  difficulty: 60,          // % of real gradient felt (Zwift "trainer difficulty")
  flatLevel: 6,            // bike resistance level on 0 %
  levelsPerPct: 1.6,       // extra levels per 1 % effective gradient
  hrPrimary: '', voice: true, sound: true, cda: 0.32, crr: 0.005, units: 'metric', screen: '3d', color: '#ff5a1f'
};
const BIKE_DEFAULTS = {
  maxLevel: 32, minLevel: 1,
  protocol: 'auto',        // auto | fitshow | ftms-level | ftms-sim | none
  fsTable: 'kinomap',      // kinomap (VirtuFit table, verbatim) | clean (byte4 = 0)
  rawLog: false, quality: 'medium'
};
let _settings = {};
const Settings = {
  load() { _settings = Object.assign({}, RIDER_DEFAULTS, BIKE_DEFAULTS, store.get('settings', {}), store.get('bike', {})); const u = _uid && store.get('users', []).find(x => x.id === _uid); if (u) { _settings.name = u.name; _settings.color = u.color; } },
  get: () => _settings,
  set(p) {
    _settings = Object.assign({}, _settings, p);
    const rider = {}, bike = store.get('bike', {});
    for (const [k, v] of Object.entries(_settings)) (BIKE_KEYS.includes(k) ? bike : rider)[k] = v;
    for (const k of BIKE_KEYS) if (k in p) bike[k] = p[k];
    store.set('settings', rider); store.set('bike', bike);
  }
};

// Riders
const RIDER_COLORS = ['#ff5a1f', '#e85d75', '#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#14b8a6'];
const Users = {
  list() { return store.get('users', []); },
  current() { return this.list().find(u => u.id === _uid) || null; },
  use(id) { _uid = id; try { localStorage.setItem('ascent.currentUser', JSON.stringify(id)); } catch (e) {} Settings.load(); },
  create(p) {
    const users = this.list(); const id = 'u' + Date.now().toString(36);
    const color = p.color || RIDER_COLORS[users.length % RIDER_COLORS.length];
    users.push({ id, name: p.name, color }); store.set('users', users);
    this.use(id); Settings.set(Object.assign({}, RIDER_DEFAULTS, p, { color })); return id;
  },
  rename(id, name) { const users = this.list(); const u = users.find(x => x.id === id); if (u) { u.name = name; store.set('users', users); } },
  remove(id) {
    store.set('users', this.list().filter(u => u.id !== id));
    try { Object.keys(localStorage).filter(k => k.startsWith('ascent.u.' + id + '.')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    if (_uid === id) { _uid = null; try { localStorage.removeItem('ascent.currentUser'); } catch (e) {} }
  },
  // One-time: data saved before riders existed becomes the first rider's
  migrate() {
    if (store.get('migrated', false) || this.list().length) return;
    let old = {}; try { old = JSON.parse(localStorage.getItem('ascent.settings') || 'null') || {}; } catch (e) {}
    const legacy = (() => { try { return Object.keys(localStorage).filter(k => k.startsWith('ascent.') && !k.startsWith('ascent.u.') && !isShared(k.slice(7))); } catch (e) { return []; } })();
    if (legacy.length) {
      const id = 'u' + Date.now().toString(36), users = [{ id, name: old.name || 'Hasse', color: RIDER_COLORS[0] }];
      for (const k of legacy) { try { localStorage.setItem('ascent.u.' + id + '.' + k.slice(7), localStorage.getItem(k)); localStorage.removeItem(k); } catch (e) {} }
      const bike = {}; for (const k of BIKE_KEYS) if (k in old) bike[k] = old[k];
      try { localStorage.setItem('ascent.users', JSON.stringify(users)); localStorage.setItem('ascent.bike', JSON.stringify(bike)); } catch (e) {}
      _uid = null; this.use(id);
    }
    store.set('migrated', true);
  }
};
Users.migrate(); if (_uid && !Users.current()) _uid = null; Settings.load();

// Build a profile from [lengthKm, gradePct] pieces; optionally rescale to a published total gain.
function pieces(list, targetGain) {
  if (targetGain) {
    const up = list.reduce((a, [l, g]) => a + (g > 0 ? l * 1000 * g / 100 : 0), 0);
    const k = targetGain / up; list = list.map(([l, g]) => [l, g > 0 ? +(g * k).toFixed(2) : g]);
  }
  return list;
}
const km = (arr, last) => arr.map((g, i) => [i === arr.length - 1 && last ? last : 1, g]);

const THEMES = {
  alpine:  { sky: [0x6fa8dc, 0xdcecf7], fog: 0xc9dceb, fogD: 2600, grass: 0x5d8a3a, rock: 0x7d7468, snow: 0xf4f6f8, road: 0x3b3d42, tree: 'pine', water: null, sun: 0xfff2d6, peaks: true },
  provence:{ sky: [0x4f8fd6, 0xf2e6c9], fog: 0xe8dcc0, fogD: 2800, grass: 0x8a9a4a, rock: 0xcfc8b8, snow: 0xe9e6dd, road: 0x45464a, tree: 'oak', water: null, sun: 0xfff0c8, peaks: false },
  coast:   { sky: [0x3f8fe0, 0xbfe3ff], fog: 0xbfdcf2, fogD: 2200, grass: 0x6fa045, rock: 0xd8c9a0, snow: 0xd8c9a0, road: 0x404247, tree: 'palm', water: 0x1f6fa8, sun: 0xffffff, peaks: false },
  nordic:  { sky: [0x7a9cc0, 0xe4ecf2], fog: 0xd5e0e8, fogD: 1800, grass: 0x4f7a3c, rock: 0x6e6e6a, snow: 0xeef2f5, road: 0x36383c, tree: 'birch', water: 0x2c5878, sun: 0xffeedd, peaks: false },
  volcano: { sky: [0xd0703a, 0xf6c58a], fog: 0xe0a070, fogD: 1900, grass: 0x6b5a3e, rock: 0x3a302c, snow: 0x221b19, road: 0x2a2a2d, tree: 'palm', water: null, sun: 0xffc890, peaks: true }
};

const ROUTES = [
  { id: 'alpe', name: "Alpe d'Huez", real: true, country: 'France', theme: 'alpine', path: 'switchback', hairpins: 21, countdown: true,
    blurb: '21 numbered hairpins from Bourg-d’Oisans. The classic Tour de France summit finish.',
    profile: [[0.6, 0.5], ...pieces(km([10.4, 10.1, 8.8, 8.6, 7.7, 8.9, 7.6, 8.2, 8.5, 7.0, 7.9, 7.4, 8.0, 4.5], 0.8), 1118), [0.4, 0.5]],
    startElev: 720, segments: [{ name: "Alpe d'Huez KOM", type: 'kom', from: 600, to: 14400 }],
    video: "Alpe d'Huez full climb indoor cycling 4K" },
  { id: 'ventoux', name: 'Mont Ventoux', real: true, country: 'France', theme: 'provence', path: 'sweep', hairpins: 6,
    blurb: 'From Bédoin: through the forest at 9–10 %, past Chalet Reynard and onto the bare moonscape.',
    profile: [[0.6, 0.5], ...pieces(km([3.5, 4.2, 4.8, 5.2, 7.2, 9.2, 9.5, 9.6, 9.3, 10.0, 9.4, 9.1, 9.3, 9.1, 8.0, 4.3, 6.6, 7.7, 7.6, 8.4, 9.8, 9.0], 0.5), 1612), [0.3, 0.5]],
    startElev: 296, segments: [{ name: 'Forest wall', type: 'kom', from: 5600, to: 15600 }, { name: 'Ventoux KOM', type: 'kom', from: 600, to: 22100 }],
    video: 'Mont Ventoux Bedoin full climb indoor cycling video' },
  { id: 'stelvio', name: 'Passo dello Stelvio', real: true, country: 'Italy', theme: 'alpine', path: 'switchback', hairpins: 48, countdown: true,
    blurb: 'From Prato: 48 tornanti stacked up the wall to 2 757 m.',
    profile: [[0.6, 0.5], ...pieces(km([5.4, 5.6, 4.8, 6.6, 6.9, 7.4, 7.1, 8.1, 7.9, 8.0, 7.6, 8.3, 9.2, 8.1, 8.0, 8.2, 7.6, 7.8, 7.9, 8.2, 8.7, 7.9, 8.0, 9.0, 7.0], 0.3), 1798), [0.4, 0.5]],
    startElev: 915, segments: [{ name: 'Stelvio KOM', type: 'kom', from: 600, to: 24900 }],
    video: 'Stelvio Prato full climb indoor cycling video' },
  { id: 'tourmalet', name: 'Col du Tourmalet', real: true, country: 'France', theme: 'alpine', path: 'sweep', hairpins: 8,
    blurb: 'From Sainte-Marie-de-Campan through La Mongie. Steepest at the top.',
    profile: [[0.6, 0.5], ...pieces(km([3.5, 4.5, 5.5, 6.8, 7.0, 7.5, 8.2, 8.5, 8.0, 9.0, 9.2, 9.5, 8.5, 8.8, 9.5, 10.0, 10.5, 9.0], 0.2), 1268), [0.4, 0.5]],
    startElev: 857, segments: [{ name: 'Tourmalet KOM', type: 'kom', from: 600, to: 17800 }],
    video: 'Col du Tourmalet Sainte Marie de Campan full climb indoor cycling' },
  { id: 'coast', name: 'Coastal Sprint Loop', real: false, theme: 'coast', path: 'meander',
    blurb: 'Fast seaside road with two punchy rises and a flat-out sprint along the beach.',
    profile: [[2, 0.4], [1, -0.4], [0.8, 3.2], [0.6, -3], [3, 0.1], [0.5, 4.8], [0.5, -4.2], [1.6, 0.2], [0.4, 0], [2.5, 0.6], [1, -1], [1.2, 2.5], [1.2, -2.2], [1.7, 0]],
    startElev: 8, segments: [{ name: 'Lighthouse rise', type: 'kom', from: 3000, to: 3800 }, { name: 'Beach sprint', type: 'sprint', from: 10000, to: 10400 }, { name: 'Harbour sprint', type: 'sprint', from: 17000, to: 17500 }] },
  { id: 'fjord', name: 'Nordic Fjord Rollers', real: false, theme: 'nordic', path: 'meander',
    blurb: 'Birch forest, red cabins and endless rollers along the water. Great for tempo.',
    profile: [[1.5, 0.3], [0.9, 4], [0.7, -3.5], [2, 1], [1.2, -1.5], [0.6, 6], [0.8, -4], [3, 0.4], [1, 3.5], [1.1, -2.8], [2.5, 0], [0.5, 7], [0.6, -5], [2, 0.5], [1.5, 2], [2, -1.6], [2.5, 0.2], [1.5, 0]],
    startElev: 12, segments: [{ name: 'Fjord wall', type: 'kom', from: 6300, to: 6900 }, { name: 'Troll hill', type: 'kom', from: 15300, to: 15800 }, { name: 'Cabin sprint', type: 'sprint', from: 20000, to: 20400 }] },
  { id: 'volcano', name: 'Volcano Circuit', real: false, theme: 'volcano', path: 'meander',
    blurb: 'Black lava road climbing to the crater rim, then a screaming descent.',
    profile: [[1.5, 0.5], [3.2, 6.2], [0.8, 2], [0.8, 0], [3, -6], [2, 0.2], [0.4, 0], [2.3, 0.4]],
    startElev: 40, segments: [{ name: 'Crater climb', type: 'kom', from: 1500, to: 4700 }, { name: 'Lava sprint', type: 'sprint', from: 11300, to: 11700 }] },
  { id: 'epic', name: 'Hairpin Highway', real: false, theme: 'alpine', path: 'switchback', hairpins: 12, countdown: false,
    blurb: 'A short, sharp alpine pass. 9 km at 7 % — your benchmark climb.',
    profile: [[0.8, 0.5], [9, 7], [0.6, 1], [1, -6], [0.6, 0]],
    startElev: 600, segments: [{ name: 'Hairpin KOM', type: 'kom', from: 800, to: 9800 }] },
  { id: 'lake', name: 'Lakeside Recovery', real: false, theme: 'nordic', path: 'meander',
    blurb: 'Pan-flat lakeside spin. Recovery days, warm-ups, chatting with the bots.',
    profile: [[3, 0.2], [2, -0.2], [3, 0.3], [2, -0.3]], startElev: 20, segments: [] }
];

// Workouts: blocks of {d: seconds, p: fraction of FTP (or [from,to] ramp), c: optional cadence cue, label}
const W = (d, p, label, c) => ({ d, p, label, c });
const WORKOUTS = [
  { id: 'ramp', name: 'FTP Ramp Test', tag: 'Test', desc: '1-minute steps rising 6 % FTP each. Ride until you can’t. FTP = 75 % of best minute.',
    blocks: [W(300, 0.45, 'Warm-up'), ...Array.from({ length: 25 }, (_, i) => W(60, 0.5 + i * 0.06, 'Step ' + (i + 1)))], ramp: true },
  { id: 'ss', name: 'Sweet Spot 2×20', tag: 'Threshold', desc: 'The time-crunched classic. Two 20-minute blocks at 88–92 % FTP.',
    blocks: [W(600, [0.45, 0.7], 'Warm-up'), W(1200, 0.9, 'Sweet spot 1', 90), W(300, 0.5, 'Recover'), W(1200, 0.9, 'Sweet spot 2', 90), W(600, [0.6, 0.4], 'Cool-down')] },
  { id: 'vo2', name: 'VO₂max 5×3', tag: 'VO₂', desc: 'Five 3-minute efforts at 115 % FTP. Hurts. Works.',
    blocks: [W(600, [0.45, 0.75], 'Warm-up'), ...[1, 2, 3, 4, 5].flatMap(i => [W(180, 1.15, 'Interval ' + i, 100), W(180, 0.5, 'Recover')]), W(420, 0.45, 'Cool-down')] },
  { id: 'ou', name: 'Over-Unders 3×9', tag: 'Threshold', desc: 'Alternate 2 min at 95 % and 1 min at 108 %. Teaches you to clear lactate.',
    blocks: [W(600, [0.45, 0.75], 'Warm-up'), ...[1, 2, 3].flatMap(i => [W(120, 0.95, 'Under'), W(60, 1.08, 'Over'), W(120, 0.95, 'Under'), W(60, 1.08, 'Over'), W(120, 0.95, 'Under'), W(60, 1.08, 'Over'), W(300, 0.5, 'Recover')]), W(300, 0.45, 'Cool-down')] },
  { id: 'z2', name: 'Endurance 60', tag: 'Zone 2', desc: 'An hour of steady aerobic base with a few cadence drills.',
    blocks: [W(300, [0.45, 0.65], 'Warm-up'), W(900, 0.68, 'Endurance'), W(60, 0.68, 'High cadence', 110), W(900, 0.7, 'Endurance'), W(60, 0.68, 'High cadence', 110), W(900, 0.7, 'Endurance'), W(480, [0.6, 0.45], 'Cool-down')] },
  { id: 'sprint', name: 'Sprint Power 8×15s', tag: 'Anaerobic', desc: 'Eight all-out 15-second sprints with full recovery.',
    blocks: [W(600, [0.45, 0.75], 'Warm-up'), ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap(i => [W(15, 1.8, 'SPRINT ' + i, 110), W(165, 0.45, 'Recover')]), W(300, 0.4, 'Cool-down')] },
  { id: 'rec', name: 'Recovery Spin 30', tag: 'Recovery', desc: 'Easy legs. Flush the system.', blocks: [W(1800, 0.5, 'Easy spin', 90)] }
];

const PACERS = [
  { name: 'Freya', wkg: 2.0, color: 0xe85d75 }, { name: 'Bjørn', wkg: 2.6, color: 0x3b82f6 },
  { name: 'Sigrid', wkg: 3.2, color: 0x22c55e }, { name: 'Leif', wkg: 3.9, color: 0xf59e0b }
];
const BOT_NAMES = ['M. Jensen', 'K. Larsen', 'A. Nielsen', 'S. Holm', 'P. Berg', 'L. Dahl', 'J. Moreau', 'T. Rossi', 'E. Lund', 'N. Kühn', 'O. Strand', 'I. Vik'];

function hrZone(bpm, maxHr) { const r = bpm / maxHr; return r < 0.6 ? 1 : r < 0.7 ? 2 : r < 0.8 ? 3 : r < 0.9 ? 4 : 5; }
function pwrZone(w, ftp) { const r = w / ftp; return r < 0.55 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : r < 1.05 ? 4 : r < 1.2 ? 5 : 6; }
const ZONE_COL = ['#8a8f98', '#9aa3ad', '#3b82f6', '#22c55e', '#facc15', '#f97316', '#ef4444'];
