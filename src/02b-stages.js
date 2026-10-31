// ───────────────────────────── More stages: real climbs, worlds, tours ─────────────────────────────
// Real climbs: length, average gradient and start elevation from published climb stats; the per-km shape is an
// approximation, rescaled so total gain matches length × average. Good for feel, not a surveyed GPX.
function climb(o) {
  const n = Math.ceil(o.km - 1e-6), last = +(o.km - (n - 1)).toFixed(2);
  const shape = o.shape.slice(0, n); while (shape.length < n) shape.push(o.avg);
  const prof = pieces(km(shape, last < 1 ? last : null), o.km * 1000 * o.avg / 100);
  const climbLen = o.km * 1000;
  return Object.assign({ real: true, theme: 'alpine', path: 'sweep', profile: [[0.6, 0.5], ...prof, [0.4, 0.5]], startElev: o.start - 3,
    segments: [{ name: o.name + ' KOM', type: 'kom', from: 600, to: 600 + climbLen }], video: o.name + ' full climb cycling POV' }, o);
}
// Worlds: [km, grade, segmentName?, 'kom'|'sprint'?] — segments are derived from named pieces so they always line up
function world(o) {
  let d = 0; const segs = [];
  for (const [l, g, nm, ty] of o.pieces) { if (nm) segs.push({ name: nm, type: ty || (g >= 2 ? 'kom' : 'sprint'), from: Math.round(d * 1000), to: Math.round((d + l) * 1000) }); d += l; }
  return Object.assign({ real: false, path: 'meander', startElev: 20, profile: o.pieces.map(p => [p[0], p[1]]), segments: segs }, o);
}

ROUTES.push(
  climb({ id: 'galibier', name: 'Col du Galibier', country: 'France', km: 18.1, avg: 6.9, start: 1430, hairpins: 8, blurb: 'From Valloire to 2 642 m. It gets steeper all the way to the summit tunnel.', shape: [4, 5.5, 6, 6.5, 7, 7, 6.5, 5, 6, 6.5, 7, 7.5, 7, 7.5, 8, 8, 8.5, 9.5, 10] }),
  climb({ id: 'telegraphe', name: 'Col du Télégraphe', country: 'France', km: 11.8, avg: 7.1, start: 730, path: 'switchback', hairpins: 12, blurb: 'From Saint-Michel-de-Maurienne: steady, wooded and relentless. The warm-up for the Galibier.', shape: [7, 7.5, 7, 7, 7.5, 7, 7, 7, 7.5, 6.5, 7, 7] }),
  climb({ id: 'madeleine', name: 'Col de la Madeleine', country: 'France', km: 19.2, avg: 8.0, start: 450, hairpins: 10, blurb: 'From La Chambre: irregular and long, with ramps that never let you settle.', shape: [6, 8.5, 8, 9, 9.5, 6, 8.5, 9, 9.5, 6, 8, 9, 7, 6, 8, 9, 9, 8.5, 7, 7] }),
  climb({ id: 'beille', name: 'Plateau de Beille', country: 'France', km: 15.8, avg: 7.9, start: 520, theme: 'provence', blurb: 'From Les Cabannes in the Ariège Pyrenees. Steep and steady through the forest to the ski plateau.', shape: [7, 8, 9, 8.5, 8, 8.5, 7, 8, 8.5, 8, 7, 8, 7, 6, 5, 4] }),
  climb({ id: 'peyresourde', name: 'Col de Peyresourde', country: 'France', km: 15.3, avg: 6.1, start: 630, theme: 'provence', blurb: 'From Bagnères-de-Luchon. A rhythm climb with green pastures near the top.', shape: [4, 5, 6, 7, 7, 7.5, 8, 8, 7, 6, 5, 5, 7, 8, 7, 6] }),
  climb({ id: 'mortirolo', name: 'Passo del Mortirolo', country: 'Italy', km: 12.4, avg: 10.5, start: 552, path: 'switchback', hairpins: 33, countdown: true, blurb: 'From Mazzo di Valtellina. Lance Armstrong called it the hardest climb he ever rode.', shape: [7, 10, 11, 12, 12.5, 12, 11.5, 11, 10.5, 10, 10, 8, 8] }),
  climb({ id: 'zoncolan', name: 'Monte Zoncolan', country: 'Italy', km: 10.1, avg: 11.9, start: 524, blurb: 'From Ovaro. The final 6 km sit at 13–15 %. Pure suffering.', shape: [6, 7, 8, 13, 14, 15, 13, 14, 14, 12, 10] }),
  climb({ id: 'gavia', name: 'Passo di Gavia', country: 'Italy', km: 17.3, avg: 7.9, start: 1258, hairpins: 6, blurb: 'From Ponte di Legno up a narrow road to 2 621 m, with snow walls in early summer.', shape: [5, 6, 7, 8, 9, 8, 7.5, 9, 10, 9, 8, 7, 8, 9, 8.5, 8, 7, 6] }),
  climb({ id: 'giau', name: 'Passo Giau', country: 'Italy', km: 9.9, avg: 9.3, start: 1315, path: 'switchback', hairpins: 29, blurb: 'From Selva di Cadore. 29 hairpins below Dolomite towers, steady at 9 %.', shape: [9, 9.5, 9.5, 9, 10, 9.5, 9, 9, 9, 8] }),
  climb({ id: 'angliru', name: "Alto de l'Angliru", country: 'Spain', km: 12.5, avg: 10.1, start: 307, theme: 'nordic', blurb: 'Asturias. Gentle for 6 km, then a wall that peaks at over 20 % at the Cueña les Cabres.', shape: [5, 6, 7, 7, 5, 4, 9, 10, 13, 15, 17, 13, 12] }),
  climb({ id: 'calobra', name: 'Sa Calobra', country: 'Spain', km: 9.4, avg: 7.1, start: 50, theme: 'provence', path: 'switchback', hairpins: 26, blurb: 'Mallorca. 26 hairpins from the sea, including the famous knot where the road crosses over itself.', shape: [7, 7, 7.5, 7, 7.5, 7, 7, 7, 7, 6.5] }),
  world({ id: 'classics', name: 'Classics Circuit', theme: 'nordic', blurb: 'Short, savage bergs inspired by Flanders and the Ardennes. Punch, recover, repeat.',
    pieces: [[2, 0.2], [2.2, 4.2, 'Kwaremont-style drag'], [1.5, -2], [0.6, 11.6, 'Koppenberg-style wall'], [1.4, -3], [2.5, 0.2], [0.4, 12.5, 'Paterberg-style wall'], [1.2, -3.2], [3, 0.3], [1.3, 9.6, 'Huy-style mur'], [1.5, -5], [2, 0], [0.5, 0, 'Velodrome sprint', 'sprint'], [1, 0]] }),
  world({ id: 'danish', name: 'Danish Hills Loop', theme: 'nordic', startElev: 10, blurb: 'Rolling Jutland roads past red farmhouses and fjord views, with a Vejle-style kicker.',
    pieces: [[3, 0.3], [0.6, 9.3, 'Vejle kicker'], [1.2, -3], [4, 0.5], [1.5, 3.5, 'Bavnehøj drag'], [1.6, -3], [5, 0.2], [0.8, 4.5, 'Fjord rise'], [0.9, -4], [4, 0.1], [0.4, 0, 'Harbour sprint', 'sprint'], [2, 0]] }),
  world({ id: 'riviera', name: 'Riviera Corniche', theme: 'coast', startElev: 5, blurb: 'Coastal cliffs, a long 5 % climb above the sea, and a fast descent to the promenade.',
    pieces: [[4, 0.5], [6, 5.2, 'Corniche climb'], [1.5, 1], [6, -4.5], [5, 0.2], [0.5, 0, 'Promenade sprint', 'sprint'], [3, 1], [2, 3, 'Lighthouse kick'], [4, -1.5]] }),
  world({ id: 'dolomites', name: 'Dolomites Ring', theme: 'alpine', startElev: 1000, path: 'sweep', blurb: 'Two mountain passes and a valley loop. Pace it: it is a long day.',
    pieces: [[3, 1], [8, 7, 'First pass'], [1, 1], [8, -6.5], [6, 0.8], [7, 6.5, 'Second pass'], [1, 1], [7, -6.2], [4, 0]] }),
  world({ id: 'fondo', name: 'Gran Fondo Alpina', theme: 'alpine', startElev: 500, path: 'sweep', blurb: '60 km and three climbs. Your sportive simulator. Bring snacks.',
    pieces: [[6, 0.5], [9, 6.5, 'Col 1'], [9, -6], [8, 0.4], [7, 7.5, 'Col 2'], [7, -7], [5, 0.3], [6, 8, 'Summit finish'], [3, 0.5]] }),
  world({ id: 'canyon', name: 'Desert Canyon', theme: 'volcano', startElev: 300, blurb: 'Red rock and long straights. Big-ring tempo with crosswinds in your head.',
    pieces: [[6, 0.6], [2.5, 3, 'Mesa rise'], [3, -2], [8, 0.2], [0.5, 0, 'Canyon sprint', 'sprint'], [4, 1.5], [3, -2.2], [3, 0]] }),
  world({ id: 'crit', name: 'Harbour Crit', theme: 'coast', startElev: 3, blurb: 'Short, flat and fast. Four sprint banners in 8 km. Great for intervals.',
    pieces: [[1.5, 0], [0.3, 0, 'Sprint 1', 'sprint'], [1.7, 0.3], [0.3, 0, 'Sprint 2', 'sprint'], [1.7, -0.3], [0.3, 0, 'Sprint 3', 'sprint'], [1.7, 0.2], [0.3, 0, 'Sprint 4', 'sprint'], [0.5, 0]] })
);

const TOURS = [
  { id: 'starter', name: 'Starter Tour', desc: 'Four stages to learn the bike, the gears and the gradients.', stages: ['lake', 'coast', 'danish', 'epic'] },
  { id: 'tdf', name: 'Grand Tour · France', desc: 'Seven stages from the coast to the Alps, finishing on Alpe d’Huez.', stages: ['coast', 'classics', 'fjord', 'peyresourde', 'tourmalet', 'galibier', 'alpe'] },
  { id: 'giro', name: 'Giro Week', desc: 'Five Italian stages, each harder than the last, ending on the Stelvio.', stages: ['dolomites', 'giau', 'gavia', 'mortirolo', 'stelvio'] },
  { id: 'monsters', name: 'Monsters of the Mountains', desc: 'The steepest roads in Europe. Not for the faint-hearted.', stages: ['zoncolan', 'angliru', 'mortirolo', 'ventoux'] },
  { id: 'island', name: 'Island Camp', desc: 'Spring training camp: sun, sea and Sa Calobra.', stages: ['crit', 'riviera', 'calobra', 'canyon', 'volcano'] }
];
const CLIMB_KEYS_EXTRA = ({
  galibier: [/galibier/i], telegraphe: [/t[ée]l[ée]graphe/i], madeleine: [/madeleine/i], beille: [/beille/i], peyresourde: [/peyresourde/i],
  mortirolo: [/mortirolo/i], zoncolan: [/zoncolan/i], gavia: [/gavia/i], giau: [/\bgiau\b/i], angliru: [/angliru/i], calobra: [/calobra/i]
});
