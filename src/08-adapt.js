// ───────────────────────────── Fit a workout to the time you have ─────────────────────────────
// Warm-up/cool-down scale gently (with minimums). A repeating main set (e.g. 5×3 min) changes its number of
// repetitions; a non-repeating main set (e.g. 2×20) stretches or shrinks each block. Intensities never change.
function adaptWorkout(w, target) {
  const orig = w.blocks.reduce((a, b) => a + b.d, 0);
  if (w.ramp || Math.abs(target - orig) < 30) return w;
  const isWarm = b => /warm/i.test(b.label), isCool = b => /cool/i.test(b.label);
  let i0 = 0; while (i0 < w.blocks.length && isWarm(w.blocks[i0])) i0++;
  let i1 = w.blocks.length; while (i1 > i0 && isCool(w.blocks[i1 - 1])) i1--;
  const warm = w.blocks.slice(0, i0), main = w.blocks.slice(i0, i1), cool = w.blocks.slice(i1);
  const f = Math.max(0.5, Math.min(1.5, target / orig)), r30 = s => Math.max(30, Math.round(s / 30) * 30);
  const scaleWC = (arr, min) => { const tot = arr.reduce((a, b) => a + b.d, 0); if (!tot) return []; const nt = Math.max(Math.min(min, tot), r30(tot * f)); return arr.map(b => ({ ...b, d: r30(b.d * nt / tot) })); };
  const W2 = scaleWC(warm, 300), C2 = scaleWC(cool, 180);
  const M = Math.max(60, target - W2.reduce((a, b) => a + b.d, 0) - C2.reduce((a, b) => a + b.d, 0));
  const key = b => b.label.replace(/\s*\d+$/, '') + '|' + b.d + '|' + JSON.stringify(b.p);
  let unit = null;
  for (let k = 1; k <= main.length / 2; k++) {
    if (main.length % k) continue;
    if (main.every((b, i) => key(b) === key(main[i % k]))) { unit = main.slice(0, k); break; }
  }
  let M2;
  if (unit && main.length / unit.length >= 2) {
    const ud = unit.reduce((a, b) => a + b.d, 0), reps0 = main.length / unit.length;
    const n = Math.max(1, Math.min(Math.ceil(reps0 * 1.6), Math.round(M / ud)));
    const r = Math.max(0.75, Math.min(1.3, M / (n * ud)));
    M2 = []; for (let k = 1; k <= n; k++) for (const b of unit) M2.push({ ...b, d: b.d >= 120 && (Array.isArray(b.p) ? b.p[0] : b.p) < 0.85 ? r30(b.d * r) : b.d, label: /\d+$/.test(b.label) ? b.label.replace(/\d+$/, k) : b.label });
  } else {
    const md = main.reduce((a, b) => a + b.d, 0) || 1, r = M / md;
    const hardCap = (b) => (Array.isArray(b.p) ? b.p[0] : b.p) >= 0.85 ? Math.min(r, 1.6) : r;
    M2 = main.map(b => ({ ...b, d: b.d < 60 ? b.d : r30(b.d * hardCap(b)) }));
  }
  // Time left over after capping the hard work → steady Zone 2 before the cool-down
  const left = M - M2.reduce((a, b) => a + b.d, 0);
  if (left >= 300) M2.push({ d: r30(left), p: 0.65, label: 'Endurance (Z2)' });
  const blocks = [...W2, ...M2, ...C2];
  const total = blocks.reduce((a, b) => a + b.d, 0);
  const reps = unit ? M2.length / unit.length : null;
  return { ...w, blocks, name: w.name.replace(/\s*\d+$/, '') + ` · ${Math.round(total / 60)} min`, adapted: { from: orig, to: total, reps } };
}
function estTSS(w, ftp) { // quick estimate from block intensities
  let s = 0, t = 0; for (const b of w.blocks) { const p = Array.isArray(b.p) ? (b.p[0] + b.p[1]) / 2 : b.p; s += Math.pow(p, 4) * b.d; t += b.d; }
  const IF = Math.pow(s / t, 0.25); return Math.round(t * IF * IF / 36);
}
