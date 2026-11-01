// ───────────────────────────── Data screen: numbers, graphs and bars (no video / 3D) ─────────────────────────────
const Dash = {
  build(R) {
    const S = Settings.get(), el = $('#dash');
    const ctx = R.workout ? 'workout' : R.mode === 'free' ? 'free' : 'route';
    el.innerHTML = `
      <div class="dRow big">
        <div class="dT pow"><small>POWER · 3 s</small><b id="dPow">0</b><em><span id="dWkg">0.0</span> W/kg · <span id="dPZ">Z1</span></em><i class="zbar" id="dPZb"></i></div>
        ${ctx === 'workout' ? `<div class="dT tgt" id="dTgt"><small id="dTgtL">TARGET</small><b><span id="dTgtW">0</span><span class="u">W</span></b><em><span id="dTgtR">0:00</span> left · <span id="dTgtC"></span></em><i class="zbar" id="dTgtB"></i></div>` : ''}
        <div class="dT hr"><small>HEART RATE</small><b id="dHr">–</b><em><span id="dHrZ">–</span> · <span id="dHrP">–</span> % max</em><i class="zbar" id="dHZb"></i></div>
        <div class="dT"><small>CADENCE</small><b id="dCad">0</b><em>rpm</em></div>
        ${ctx !== 'workout' ? `<div class="dT"><small>SPEED</small><b id="dSpd">0</b><em>km/h</em></div>` : ''}
      </div>
      <div class="dRow small">
        <div class="dT"><small>TIME</small><b id="dTime">0:00</b></div>
        <div class="dT"><small>DISTANCE</small><b id="dDist">0.00</b><em>km</em></div>
        ${ctx === 'route' ? `<div class="dT"><small>GRADE</small><b id="dGrade">0.0</b><em>%</em></div><div class="dT"><small>CLIMBED</small><b id="dElev">0</b><em>m</em></div>` : ''}
        <div class="dT"><small>AVG POWER</small><b id="dAvg">0</b><em>W</em></div>
        <div class="dT"><small>NORM. POWER</small><b id="dNp">–</b><em>W</em></div>
        <div class="dT"><small>ENERGY</small><b id="dKj">0</b><em>kJ ≈ kcal</em></div>
        <div class="dT lvl"><small>${ctx === 'free' ? 'RESISTANCE' : 'BIKE LEVEL'}</small><div class="lv"><button id="dDn">−</button><b id="dLvl">0</b><button id="dUp">+</button></div><em id="dLvlE">${ctx === 'free' ? 'tap − / +' : 'gear <span id="dGear">6</span>'}</em></div>
      </div>
      <div class="dRow charts">
        <div class="dC wide"><div class="dH"><small>POWER & HEART RATE · last 10 min</small><span><i class="k p"></i>Power <i class="k h"></i>HR</span></div><canvas id="dLine"></canvas></div>
        <div class="dC"><div class="dH"><small>TIME IN POWER ZONES</small><span>FTP ${S.ftp} W</span></div><div class="zones" id="dPZones"></div></div>
        <div class="dC"><div class="dH"><small>TIME IN HR ZONES</small><span>max ${S.maxHr}</span></div><div class="zones" id="dHZones"></div></div>
      </div>
      <div class="dRow ctx">
        ${ctx === 'workout' ? `<div class="dC wide"><div class="dH"><small id="dWkName">WORKOUT</small><span id="dWkLeft"></span></div><canvas id="dWk"></canvas></div>` :
          ctx === 'route' ? `<div class="dC wide"><div class="dH"><small>${esc(R.route.def.name.toUpperCase())} · PROFILE</small><span id="dRem"></span></div><div class="profWrap"><canvas id="dProf"></canvas><i id="dProfMe"></i></div></div>
                             <div class="dC"><div class="dH"><small>NEXT 1 KM · GRADIENT PER 100 m</small><span></span></div><div class="ahead" id="dAhead"></div></div>` :
          `<div class="dC wide"><div class="dH"><small>BEST EFFORTS THIS RIDE</small><span></span></div><div class="bests" id="dBests"></div></div>`}
      </div>`;
    $('#dUp').onclick = () => $('#gearUp').click(); $('#dDn').onclick = () => $('#gearDn').click();
    this.lastChart = -9; this.npT = 0; this.R = R; el.classList.toggle('single', ctx !== 'route');
    setTimeout(() => { if (R.workout) drawWorkout($('#dWk'), R.o.workout, { now: 0 }); if (ctx === 'route') this.profMap = drawProfile($('#dProf'), R.route, { segs: true, alpha: 0.85, top: 6 }); }, 40);
  },

  update(R) {
    if (!$('#dPow')) return;
    const S = Settings.get(), p = Math.round(R.avg3()), set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const pz = pwrZone(p, S.ftp), hz = R.hr ? hrZone(R.hr, S.maxHr) : 0;
    set('dPow', p); set('dWkg', (p / S.weight).toFixed(1)); set('dPZ', 'Z' + pz); $('#dPZb').style.background = ZONE_COL[pz]; $('#dPZb').style.width = Math.min(100, p / (S.ftp * 1.5) * 100) + '%';
    set('dHr', R.hr || '–'); set('dHrZ', R.hr ? 'Z' + hz : '–'); set('dHrP', R.hr ? Math.round(R.hr / S.maxHr * 100) : '–');
    $('#dHZb').style.background = R.hr ? ZONE_COL[hz + 1] : '#333'; $('#dHZb').style.width = R.hr ? Math.min(100, R.hr / S.maxHr * 100) + '%' : '0';
    set('dCad', Math.round(R.cadence)); set('dSpd', (R.v * 3.6).toFixed(1)); set('dTime', fmtTime(R.t)); set('dDist', (R.dist / 1000).toFixed(2));
    set('dGrade', R.route.at(R.s + 4).g.toFixed(1)); set('dElev', Math.round(R.gain)); set('dKj', Math.round(R.kj));
    const n = R.rec.length; set('dAvg', n ? Math.round(R.rec.reduce((a, b) => a + b.p, 0) / n) : 0); set('dLvl', R.level); set('dGear', R.gear);
    if (n > 30 && R.t - (this.npT || 0) > 5) { this.npT = R.t; set('dNp', R.summaryLite().np); }
    if (R.workout && R.target) {
      const tg = R.target, diff = p - tg.watts, st = Math.abs(diff) < tg.watts * 0.06 ? 'on' : diff < 0 ? 'low' : 'high';
      set('dTgtL', tg.seg.b.label.toUpperCase()); set('dTgtW', tg.watts); set('dTgtR', fmtTime(tg.remain)); set('dTgtC', tg.seg.b.c ? tg.seg.b.c + ' rpm' : (st === 'on' ? 'on target' : st === 'low' ? `${-diff} W under` : `${diff} W over`));
      $('#dTgt').dataset.state = st; $('#dTgtB').style.width = (1 - tg.remain / tg.seg.b.d) * 100 + '%';
      set('dWkName', (R.o.workout.name + ' · ' + tg.seg.b.label).toUpperCase()); set('dWkLeft', fmtTime(R.workout.total - R.t) + ' left');
    }
    if (this.profMap && $('#dProfMe')) { $('#dProfMe').style.left = this.profMap.X(R.s) + 'px'; set('dRem', ((R.route.length - R.s) / 1000).toFixed(1) + ' km left'); }
    // Zone bars
    const bars = (host, arr, offset, labels) => { const tot = arr.reduce((a, b) => a + b, 0) || 1; host.innerHTML = arr.map((v, i) => `<div><span>${labels[i]}</span><i style="width:${v / tot * 100}%;background:${ZONE_COL[i + offset]}"></i><em>${fmtTime(v)}</em></div>`).join(''); };
    if (R.t - this.lastChart >= 1) {
      this.lastChart = R.t;
      bars($('#dPZones'), R.zt.slice(1), 1, ['Z1 Recovery', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Threshold', 'Z5 VO₂max', 'Z6 Anaerobic']);
      bars($('#dHZones'), R.hzt.slice(1), 2, ['Z1 <60 %', 'Z2 60–70 %', 'Z3 70–80 %', 'Z4 80–90 %', 'Z5 >90 %']);
      this.line($('#dLine'), R.rec.slice(-600), S);
      if (R.workout) drawWorkout($('#dWk'), R.o.workout, { now: R.t });
      const ah = $('#dAhead'); if (ah) { const gs = Array.from({ length: 10 }, (_, k) => R.route.at(Math.min(R.route.length, R.s + 50 + k * 100)).g); const mx = Math.max(8, ...gs.map(Math.abs)); ah.innerHTML = gs.map(g => `<div><i style="height:${Math.abs(g) / mx * 100}%;background:${g > 9 ? '#b91c1c' : g > 6 ? '#ea580c' : g > 3 ? '#eab308' : g > -2 ? '#3f8f4f' : '#2f6fa3'}"></i><span>${g.toFixed(0)}</span></div>`).join(''); }
      const bs = $('#dBests'); if (bs) { const best = (w) => { let m = 0, s = 0; for (let i = 0; i < n; i++) { s += R.rec[i].p; if (i >= w) s -= R.rec[i - w].p; if (i >= w - 1) m = Math.max(m, s / w); } return Math.round(m); }; const B = [[5, '5 s'], [30, '30 s'], [60, '1 min'], [300, '5 min'], [1200, '20 min']].map(([w, l]) => [l, n >= w ? best(w) : 0]); const mx = Math.max(100, ...B.map(b => b[1])); bs.innerHTML = B.map(([l, v]) => `<div><i style="height:${v / mx * 100}%;background:${ZONE_COL[pwrZone(v, S.ftp)]}"></i><b>${v || '–'}</b><span>${l}</span></div>`).join(''); }
    }
  },

  line(cv, rec, S) {
    if (!cv) return; const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const maxP = Math.max(S.ftp * 1.4, ...rec.map(r => r.p)), N = 600, X = (i) => w - (rec.length - 1 - i) / (N - 1) * w;
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1; for (const f of [0.55, 0.75, 0.9, 1.05, 1.2]) { const y = h - f * S.ftp / maxP * h; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.35)'; g.font = '600 10px system-ui'; g.fillText('FTP', 4, h - S.ftp / maxP * h - 3);
    const bw = Math.max(1, w / N);
    rec.forEach((r, i) => { g.fillStyle = ZONE_COL[pwrZone(r.p, S.ftp)]; g.globalAlpha = 0.85; const bh = r.p / maxP * h; g.fillRect(X(i) - bw, h - bh, bw + 0.3, bh); });
    g.globalAlpha = 1;
    if (rec.some(r => r.hr)) { const lo = 50, hi = S.maxHr + 5; g.strokeStyle = '#ff4d6d'; g.lineWidth = 2; g.beginPath(); let st = false; rec.forEach((r, i) => { if (!r.hr) return; const y = h - (r.hr - lo) / (hi - lo) * h; st ? g.lineTo(X(i), y) : (g.moveTo(X(i), y), st = true); }); g.stroke(); }
  }
};
