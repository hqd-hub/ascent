// ───────────────────────────── UI ─────────────────────────────
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg, kind) { const host = $(typeof App !== 'undefined' && App.ride ? '#toasts' : '#homeToasts'); if (!host) return; while (host.children.length > 2) host.firstChild.remove(); const d = document.createElement('div'); d.className = 'toast ' + (kind || ''); d.textContent = msg; host.appendChild(d); setTimeout(() => d.classList.add('out'), 3800); setTimeout(() => d.remove(), 4400); }
function say(text) { if (!Settings.get().voice || !window.speechSynthesis) return; try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; u.lang = 'en-GB'; speechSynthesis.speak(u); } catch (e) {} }

const Sound = {
  ctx: null, wind: null,
  start() {
    if (!Settings.get().sound) return;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume();
      const n = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0); let last = 0;
      for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true; const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = this.ctx.createGain(); g.gain.value = 0; src.connect(f).connect(g).connect(this.ctx.destination); src.start(); this.wind = { src, g, f };
    } catch (e) {}
  },
  update(v) { if (!this.wind) return; const k = Math.min(1, v / 16); this.wind.g.gain.setTargetAtTime(k * k * 0.5, this.ctx.currentTime, 0.3); this.wind.f.frequency.setTargetAtTime(300 + k * 900, this.ctx.currentTime, 0.3); },
  stop() { try { this.wind?.src.stop(); } catch (e) {} this.wind = null; },
  chime() { if (!this.ctx || !Settings.get().sound) return; const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.setValueAtTime(880, this.ctx.currentTime); o.frequency.setValueAtTime(1320, this.ctx.currentTime + 0.12); g.gain.setValueAtTime(0.18, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.6); o.connect(g).connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime + 0.6); }
};

// ── Profile drawing
function drawProfile(cv, route, opts = {}) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || cv.width, h = cv.clientHeight || cv.height;
  cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const N = route.N, pad = opts.pad ?? 4, span = Math.max(30, route.maxE - route.minE);
  const X = (i) => i / (N - 1) * w, Y = (e) => h - pad - (e - route.minE) / span * (h - pad * 2 - (opts.top || 0));
  const step = Math.max(1, Math.floor(N / (w * 1.5)));
  for (let i = 0; i < N - step; i += step) {
    const gr = route.grade[i]; g.fillStyle = gr > 9 ? '#b91c1c' : gr > 6 ? '#ea580c' : gr > 3 ? '#eab308' : gr > -2 ? '#3f8f4f' : '#2f6fa3';
    g.globalAlpha = opts.alpha ?? 0.9; g.beginPath(); g.moveTo(X(i), h); g.lineTo(X(i), Y(route.elev[i])); g.lineTo(X(i + step), Y(route.elev[i + step])); g.lineTo(X(i + step), h); g.fill();
  }
  g.globalAlpha = 1; g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.2; g.beginPath();
  for (let i = 0; i < N; i += step) { i ? g.lineTo(X(i), Y(route.elev[i])) : g.moveTo(X(i), Y(route.elev[i])); } g.stroke();
  for (const sg of route.def.segments || []) { if (!opts.segs) break; const a = X(sg.from / STEP), b = X(Math.min(N - 1, sg.to / STEP)); g.fillStyle = sg.type === 'kom' ? 'rgba(220,38,38,.9)' : 'rgba(22,163,74,.9)'; g.fillRect(a, 0, b - a, 3); }
  return { X: (s) => X(s / STEP), Y };
}
function drawWorkout(cv, w, opts = {}) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || cv.width, H = cv.clientHeight || cv.height;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  const tl = workoutTimeline(w, 1), maxP = 1.9; let t = 0;
  for (const s of tl.segs) {
    const x0 = s.t0 / tl.total * W, x1 = s.t1 / tl.total * W; const pa = Array.isArray(s.b.p) ? s.b.p : [s.b.p, s.b.p];
    g.fillStyle = ZONE_COL[pwrZone(Math.max(...pa), 1)]; g.globalAlpha = opts.now != null && opts.now > s.t1 ? 0.35 : 0.95;
    g.beginPath(); g.moveTo(x0, H); g.lineTo(x0, H - pa[0] / maxP * H); g.lineTo(x1, H - pa[1] / maxP * H); g.lineTo(x1, H); g.fill();
  }
  g.globalAlpha = 1; if (opts.now != null) { const x = opts.now / tl.total * W; g.fillStyle = '#fff'; g.fillRect(x - 1, 0, 2, H); }
}

// ── App controller
const App = {
  tab: 'routes', world: null, ride: null, raf: 0, routeCache: {}, sel: null, gpx: null,

  init() {
    this.world = new World($('#world'));
    BLE.listeners.add(() => this.renderDevices());
    $$('.tab').forEach(t => t.onclick = () => this.show(t.dataset.tab));
    this.show(store.get('tab', 'routes'));
    this.renderDevices();
    document.addEventListener('keydown', e => this.key(e));
    if (!BLE.supported) $('#bleWarn').hidden = false;
    $('#devSetup').onclick = () => Setup.open();
    $('#devUser').onclick = () => Setup.open();
    this.onUserChange();
    Setup.open();
  },
  route(id) { if (!this.routeCache[id]) this.routeCache[id] = buildRoute(ROUTES.find(r => r.id === id)); return this.routeCache[id]; },

  show(tab) {
    this.tab = tab; store.set('tab', tab);
    $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
    const m = $('#main'); m.innerHTML = '';
    ({ routes: () => this.viewRoutes(m), workouts: () => this.viewWorkouts(m), video: () => this.viewVideo(m), activity: () => this.viewActivity(m), settings: () => this.viewSettings(m) })[tab]();
  },

  renderDevices() {
    const b = BLE.bike, el = $('#devBike');
    el.classList.toggle('ok', !!b?.server?.connected);
    el.querySelector('span').textContent = b ? (b.server?.connected ? b.name : 'Reconnecting…') : 'Connect bike';
    const live = BLE.hr.map(h => `<button class="chip ok hrchip" data-id="${esc(h.device.id)}" title="Tap to disconnect"><i class="dot"></i>${esc(h.name)} <b>${h.bpm || '–'}</b></button>`).join('');
    $('#devHr').innerHTML = live + `<button class="chip" id="addHr"><i class="dot"></i><span>${BLE.hr.length ? '+ HR' : 'Whoop / Watch HR'}</span></button>`;
    $('#addHr').onclick = () => this.connectHR();
    $$('.hrchip').forEach(c => c.onclick = () => { if (confirmLite('Disconnect ' + c.textContent.trim() + '?')) BLE.removeHR(c.dataset.id); });
    if (this.ride) this.hudDevices();
  },
  async connectBike() {
    if (BLE.bike) { if (confirmLite('Disconnect bike?')) BLE.disconnectBike(); return; }
    try { await BLE.connectBike(); toast('Bike connected · control: ' + BLE.bike.protocol); } catch (e) { if (e.name !== 'NotFoundError') toast(e.message, 'err'); }
  },
  async connectHR() { try { const h = await BLE.connectHR(); toast('Heart rate: ' + h.name); return h; } catch (e) { if (e.name !== 'NotFoundError') toast(e.message, 'err'); } },

  // ── Routes tab
  viewRoutes(m) {
    const done = new Set(store.get('rides', []).filter(r => r.finished && !r.demo).map(r => r.routeId));
    const countries = [...new Set(ROUTES.filter(r => r.real).map(r => r.country))];
    m.innerHTML = `<div class="hero"><div><h1>Pick a road.</h1><p>${ROUTES.filter(r => r.real).length} legendary climbs, ${ROUTES.filter(r => !r.real).length} worlds and ${TOURS.length} multi-stage tours. The resistance follows the road.</p></div></div>
      <h2 class="sec">Tours</h2><div class="grid" id="gTours"></div>
      ${countries.map(c => `<h2 class="sec">Legendary climbs · ${c}</h2><div class="grid" data-c="${c}"></div>`).join('')}
      <h2 class="sec">Worlds</h2><div class="grid" id="gWorld"></div>`;
    for (const t of TOURS) {
      const n = t.stages.filter(id => done.has(id)).length, next = t.stages.find(id => !done.has(id));
      const c = document.createElement('div'); c.className = 'card tour';
      c.innerHTML = `<div class="cbody"><div class="ctop"><span class="badge real">TOUR · ${t.stages.length} STAGES</span><span class="pr">${n}/${t.stages.length}</span></div><h3>${esc(t.name)}</h3><p>${esc(t.desc)}</p>
        <ol class="stages">${t.stages.map((id, i) => { const d = ROUTES.find(r => r.id === id); return `<li class="${done.has(id) ? 'ok' : id === next ? 'next' : ''}"><button data-r="${id}"><em>${i + 1}</em>${esc(d.name)}<span>${done.has(id) ? '✓' : id === next ? 'Next ›' : ''}</span></button></li>`; }).join('')}</ol></div>`;
      $('#gTours').appendChild(c); $$('[data-r]', c).forEach(b => b.onclick = () => this.routeSheet(b.dataset.r));
    }
    for (const def of ROUTES) {
      const r = this.route(def.id), pr = store.get('ghost.' + def.id, null);
      const card = document.createElement('button'); card.className = 'card route t-' + def.theme;
      card.innerHTML = `<canvas class="mini"></canvas><div class="cbody"><div class="ctop"><span class="badge ${def.real ? 'real' : ''}">${def.real ? 'REAL CLIMB · ' + def.country : 'WORLD'}</span>${pr ? `<span class="pr">PR ${fmtTime(pr.time)}</span>` : done.has(def.id) ? '<span class="pr">✓</span>' : ''}</div>
        <h3>${esc(def.name)}</h3><div class="stats"><span>${(r.length / 1000).toFixed(1)} km</span><span>↑ ${Math.round(r.gain)} m</span><span>${def.real ? (r.gain / (r.length - 1000) * 100).toFixed(1) + ' % avg' : (def.segments.length + ' segments')}</span></div></div>`;
      (def.real ? $(`[data-c="${def.country}"]`) : $('#gWorld')).appendChild(card);
      requestAnimationFrame(() => drawProfile(card.querySelector('canvas'), r, { segs: true }));
      card.onclick = () => this.routeSheet(def.id);
    }
  },
  routeSheet(id, workout) {
    const r = this.route(id), def = r.def, S = Settings.get();
    const pr = store.get('ghost.' + id, null);
    const segs = (def.segments || []).map(sg => { const p = store.get('seg.' + id + '.' + sg.name, null); return `<li><i class="${sg.type}"></i>${esc(sg.name)} <em>${((sg.to - sg.from) / 1000).toFixed(1)} km</em><b>${p ? fmtTime(p.time) : '—'}</b></li>`; }).join('');
    sheet(`<div class="sheethead t-${def.theme}"><span class="badge ${def.real ? 'real' : ''}">${def.real ? 'REAL CLIMB · ' + def.country : 'WORLD'}</span><h2>${esc(def.name)}</h2><p>${esc(def.blurb)}</p></div>
      <canvas class="bigprof"></canvas>
      <div class="kv"><div><b>${(r.length / 1000).toFixed(1)}</b> km</div><div><b>${Math.round(r.gain)}</b> m up</div><div><b>${Math.round(r.maxE)}</b> m top</div><div><b>${Math.max(...r.grade).toFixed(0)}</b> % max</div></div>
      ${segs ? `<h4>Segments · your PRs</h4><ul class="segs">${segs}</ul>` : ''}
      <div class="form">
        <label>Pace partner<select id="oPacer"><option value="">None</option>${PACERS.map(p => `<option ${store.get('pacer', '') === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}</select><small>${PACERS.map(p => p.name + ' ' + p.wkg + ' W/kg').join(' · ')}</small></label>
        <label class="chk"><input type="checkbox" id="oGhost" ${pr ? 'checked' : 'disabled'}> Race my PR ghost ${pr ? '(' + fmtTime(pr.time) + ')' : '(after your first finish)'}</label>
        <label>Screen<select id="oView"><option value="3d" ${store.get('screen', '3d') === '3d' ? 'selected' : ''}>3D world (first-person)</option><option value="data" ${store.get('screen', '3d') === 'data' ? 'selected' : ''}>Data screen: numbers, graphs and zone bars only</option></select><small>You can switch mid-ride with the DATA / 3D button.</small></label>
        <label>Trainer difficulty <output id="oDiffV">${S.difficulty} %</output><input type="range" id="oDiff" min="20" max="100" step="5" value="${S.difficulty}"><small>How much of the real gradient you feel. 100 % = brutal on a 32-level bike.</small></label>
      </div>
      ${def.real && def.video ? `<a class="link" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(def.video)}">▶ Find first-person footage of this climb on YouTube (for Video rides)</a>` : ''}
      <button class="go" id="goRide">${workout ? 'Start workout' : 'Start ride'}</button>`, (root) => {
      requestAnimationFrame(() => drawProfile($('.bigprof', root), r, { segs: true, top: 8 }));
      $('#oDiff', root).oninput = (e) => { $('#oDiffV', root).textContent = e.target.value + ' %'; Settings.set({ difficulty: +e.target.value }); };
      $('#goRide', root).onclick = () => { const pacer = $('#oPacer', root).value; store.set('pacer', pacer); const view = $('#oView', root).value; store.set('screen', view); closeSheet(); this.start({ route: r, mode: workout ? 'workout' : 'route', workout, pacer, ghost: $('#oGhost', root).checked, erg: workout ? store.get('erg', true) : false, focus: view === 'data' }); };
    });
  },

  // ── Workouts tab
  viewWorkouts(m) {
    const S = Settings.get();
    m.innerHTML = `<div class="hero"><div><h1>Structured training.</h1><p>Targets scale to your FTP (${S.ftp} W). Auto-resistance steps the bike's levels to hold your target power — your TBE5 has no true ERG, so Ascent closes the loop itself.</p></div></div><div class="grid" id="gW"></div>`;
    for (const w of WORKOUTS) {
      const tl = workoutTimeline(w, S.ftp); const c = document.createElement('button'); c.className = 'card wo';
      c.innerHTML = `<canvas class="mini"></canvas><div class="cbody"><div class="ctop"><span class="badge">${w.tag}</span><span class="pr">${fmtTime(tl.total)}</span></div><h3>${esc(w.name)}</h3><p>${esc(w.desc)}</p></div>`;
      $('#gW').appendChild(c); requestAnimationFrame(() => drawWorkout(c.querySelector('canvas'), w));
      c.onclick = () => this.workoutSheet(w);
    }
  },
  workoutSheet(w0) {
    const S = Settings.get(), orig = workoutTimeline(w0, S.ftp).total, om = Math.round(orig / 60);
    const lens = [...new Set([15, 20, 30, 45, 60, 75, 90, 120, om])].sort((a, b) => a - b);
    let w = w0;
    sheet(`<div class="sheethead"><span class="badge">${w0.tag}</span><h2>${esc(w0.name)}</h2><p>${esc(w0.desc)}</p></div><canvas class="bigprof"></canvas>
      <div class="kv"><div><b id="kvDur">${fmtTime(orig)}</b> duration</div><div><b id="kvSet">–</b> main set</div><div><b id="kvTss">–</b> TSS (est.)</div><div><b>${S.ftp}</b> W FTP</div></div>
      <div class="form">${w0.ramp ? '<p class="note">The ramp test runs until you can’t hold the power, so its length isn’t set in advance.</p>' : `
        <label>How long do you have? <output id="oLenV">${om} min</output><div class="lens">${lens.map(m => `<button class="sm ${m === om ? 'on' : ''}" data-len="${m}">${m}${m === om ? '*' : ''}</button>`).join('')}</div><small>* = original length. Intervals are added or removed to fit, and the warm-up and cool-down adapt. The intensities stay the same.</small></label>`}
        <label>Screen<select id="oRoute"><option value="">Data screen: numbers, graphs, zone bars and intervals (no video or 3D)</option>${ROUTES.map(r => `<option value="${r.id}">3D scenery: ${esc(r.name)}</option>`).join('')}</select><small>The data screen saves battery and works on any iPad.</small></label>
      <label class="chk"><input type="checkbox" id="oErg" ${store.get('erg', true) ? 'checked' : ''}> Auto-resistance (pseudo-ERG): bike levels follow the power target</label>
      <label>Pace partner<select id="oPacer"><option value="">None</option>${PACERS.map(p => `<option>${p.name}</option>`).join('')}</select><small>Only shown with 3D scenery.</small></label></div>
      <button class="go" id="goW">Start workout</button>`, (root) => {
      const refresh = () => {
        const tl = workoutTimeline(w, S.ftp); $('#kvDur', root).textContent = fmtTime(tl.total); $('#kvTss', root).textContent = w0.ramp ? '–' : estTSS(w, S.ftp);
        const mainBlk = w.blocks.filter(b => !/warm|cool/i.test(b.label)); const hard = mainBlk.filter(b => (Array.isArray(b.p) ? b.p[0] : b.p) >= 0.85);
        $('#kvSet', root).textContent = w0.ramp ? '–' : (hard.length ? `${hard.length}× ${fmtTime(hard[0].d)}` : fmtTime(mainBlk.reduce((a, b) => a + b.d, 0)));
        requestAnimationFrame(() => drawWorkout($('.bigprof', root), w));
      };
      $$('[data-len]', root).forEach(bt => bt.onclick = () => { $$('[data-len]', root).forEach(x => x.classList.toggle('on', x === bt)); const m = +bt.dataset.len; w = m === om ? w0 : adaptWorkout(w0, m * 60); $('#oLenV', root).textContent = Math.round(workoutTimeline(w, S.ftp).total / 60) + ' min'; refresh(); });
      refresh();
      $('#goW', root).onclick = () => { store.set('erg', $('#oErg', root).checked); const rid = $('#oRoute', root).value, r = this.route(rid || 'lake'); closeSheet(); this.start({ route: r, mode: 'workout', workout: w, pacer: $('#oPacer', root).value, erg: $('#oErg', root).checked, focus: !rid }); };
    });
  },

  // ── Video tab
  viewVideo(m) {
    const recent = store.get('vids', []);
    m.innerHTML = `<div class="hero"><div><h1>Ride real footage.</h1><p>Paste a YouTube climb. Ascent works out which climb it is from the title, plays it full-screen at <i>your</i> speed and sets the resistance from the gradient at that point in the video. Tap <b>SYNC</b> when you pass a km sign and it locks on, and it's saved for next time.</p></div></div>
    ${recent.length ? `<h2 class="sec">Recent videos</h2><div class="vids">${recent.map(v => `<button class="vid" data-id="${esc(v.id)}"><img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt=""><span>${esc(v.title || v.id)}</span><small>${(store.get('vid.' + v.id, {}).anchors || []).length} sync points</small></button>`).join('')}</div>` : ''}
    <div class="panel form">
      <label>Video source<select id="vSrc"><option value="yt">YouTube link</option><option value="file">Video file on this device (smoothest playback)</option></select></label>
      <label id="vYtL">YouTube URL<input type="url" id="vYt" placeholder="Paste e.g. https://youtu.be/…" autocomplete="off"></label>
      <div id="vDetect" class="detect" hidden></div>
      <label id="vFileL" hidden>Video file<input type="file" id="vFile" accept="video/*"></label>
      <label>Gradient source<select id="vProf"><option value="auto">Auto: match the video title</option><option value="gpx">GPX of the same ride</option>${ROUTES.filter(r => r.real).map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}<option value="custom">Custom: length + average gradient</option>${ROUTES.filter(r => !r.real).map(r => `<option value="${r.id}">World profile: ${esc(r.name)}</option>`).join('')}</select></label>
      <div id="vCustom" class="row2" hidden><label>Climb length (km)<input type="number" id="vKm" step="0.1" min="0.3" max="60"></label><label>Average gradient (%)<input type="number" id="vPct" step="0.1" min="-5" max="20"></label></div>
      <label id="vGpxL" hidden>GPX file<input type="file" id="vGpx" accept=".gpx,application/gpx+xml"><small id="vGpxInfo">From Strava/Komoot/RideWithGPS: export the route as GPX.</small></label>
      <label>Filmed speed until synced <output id="vRefV">15 km/h</output><input type="range" id="vRef" min="6" max="40" value="15"><small>Used for intros and before you add sync points. After that the filmed speed comes from your sync points.</small></label>
      <button class="go" id="goV">Start video ride</button>
    </div>
    <h2 class="sec">Find climbs on YouTube</h2><div class="links">${ROUTES.filter(r => r.video).map(r => `<a target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(r.video)}">▶ ${esc(r.name)}</a>`).join('')}
      <a target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent('full climb cycling POV km %')}">▶ Any climb (titles with km + %)</a></div>
    <p class="note">On iPad: share a video from the YouTube app → Copy link → paste it here. Climb videos with "km" and "%" in the title are matched automatically even when the climb isn't in Ascent's library.</p>`;
    let det = null;
    const upd = () => { const yt = $('#vSrc').value === 'yt'; $('#vYtL').hidden = !yt; $('#vDetect').hidden = !yt || !det; $('#vFileL').hidden = yt; $('#vGpxL').hidden = $('#vProf').value !== 'gpx'; $('#vCustom').hidden = $('#vProf').value !== 'custom' && !($('#vProf').value === 'auto' && det && !det.route); };
    const detect = async () => {
      const id = ytId($('#vYt').value); det = null; if (!id) { upd(); return; }
      const box = $('#vDetect'); box.hidden = false; box.innerHTML = `<img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt=""><div><b>Reading video…</b></div>`;
      const saved = store.get('vid.' + id, null);
      const title = saved?.title || await fetchYtTitle(id) || '';
      det = Object.assign(matchTitle(title), { id });
      if (saved?.prof) { $('#vProf').value = saved.prof; if (saved.km) $('#vKm').value = saved.km; if (saved.pct) $('#vPct').value = saved.pct; }
      else { $('#vProf').value = 'auto'; if (det.km) $('#vKm').value = det.km; if (det.pct) $('#vPct').value = det.pct; }
      const rd = det.route && ROUTES.find(r => r.id === det.route);
      box.innerHTML = `<img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt=""><div><b>${esc(title || 'Title not available')}</b><small>${
        saved?.anchors?.length ? `✓ Ridden before · ${saved.anchors.length} sync points saved` :
        rd ? `✓ Matched: ${esc(rd.name)} (${esc(rd.blurb.split(':')[0].split('.')[0])})${det.sideWarn ? ' — ⚠ the title mentions a different side of the climb; check the profile' : ''}` :
        det.km && det.pct ? `✓ Climb stats found in the title: ${det.km} km at ${det.pct} %` :
        '⚠ No climb recognised. Pick a profile or enter the length and average gradient below.'}</small></div>`;
      upd();
    };
    $('#vYt').addEventListener('input', () => { clearTimeout(this._dt); this._dt = setTimeout(detect, 500); });
    $('#vSrc').onchange = upd; $('#vProf').onchange = upd; upd();
    $('#vRef').oninput = e => $('#vRefV').textContent = e.target.value + ' km/h';
    $$('.vid', m).forEach(b => b.onclick = () => { $('#vSrc').value = 'yt'; $('#vYt').value = 'https://youtu.be/' + b.dataset.id; detect(); $('#vYt').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    $('#vGpx').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { this.gpx = parseGPX(await f.text()); $('#vGpxInfo').textContent = `${this.gpx.name}: ${(this.gpx.pts.at(-1).d / 1000).toFixed(1)} km`; } catch (err) { toast(err.message, 'err'); } };
    $('#goV').onclick = () => {
      const src = $('#vSrc').value, file = $('#vFile').files[0], yt = ytId($('#vYt').value); let prof = $('#vProf').value;
      if (src === 'file' && !file) return toast('Choose a video file', 'err'); if (src === 'yt' && !yt) return toast('Paste a valid YouTube link', 'err');
      if (prof === 'auto') prof = src === 'yt' && det?.route ? det.route : 'custom';
      let route;
      if (prof === 'gpx') { if (!this.gpx) return toast('Add the GPX, or pick a profile', 'err'); route = buildRoute({ id: 'gpx', name: this.gpx.name, theme: 'alpine', path: 'meander', segments: [], real: false }, this.gpx.pts); }
      else if (prof === 'custom') {
        const km = +$('#vKm').value, pct = +$('#vPct').value; if (!km) return toast('Enter the climb length and average gradient', 'err');
        route = buildRoute({ id: 'custom', name: det?.title || 'Video climb', theme: 'alpine', path: 'meander', profile: [[km, pct]], startElev: 400, segments: [{ name: 'Climb', type: 'kom', from: 0, to: Math.round(km * 1000) }], real: false });
      } else route = this.route(prof);
      const key = src === 'yt' ? yt : (file.name + ':' + file.size);
      const cfg = Object.assign(store.get('vid.' + key, {}), { prof: $('#vProf').value === 'auto' ? prof : $('#vProf').value, km: +$('#vKm').value || undefined, pct: +$('#vPct').value || undefined, title: det?.title || file?.name });
      store.set('vid.' + key, cfg);
      if (src === 'yt') store.set('vids', [{ id: yt, title: cfg.title }, ...store.get('vids', []).filter(v => v.id !== yt)].slice(0, 8));
      this.start({ route, mode: 'video', video: { file: src === 'file' ? file : null, youtube: src === 'yt' ? yt : null, refSpeedKmh: +$('#vRef').value, synced: true, key, anchors: cfg.anchors || [] }, gpx: prof === 'gpx' ? this.gpx : null });
    };
  },

  // ── Sync panel (video rides)
  syncPanel() {
    const R = this.ride; if (!R?.video) return; const box = $('#syncBox'); if (!box.hidden) { box.hidden = true; return; }
    const kom = (R.route.def.segments || []).filter(s => s.type === 'kom').sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
    const start = kom ? kom.from : 0, summit = kom ? kom.to : R.route.length;
    const toGo = Math.max(0, (summit - R.s) / 1000);
    box.innerHTML = `<b>Line up the video</b><small>Tap when the video shows it. Saved for this video.</small>
      <div class="row"><button class="sm" data-a="start">Climb starts now</button><button class="sm" data-a="summit">Summit now</button></div>
      <div class="row"><input type="number" id="syKm" step="0.1" min="0" value="${Math.round(toGo)}" inputmode="decimal"><span>km to go (km sign)</span><button class="sm" data-a="km">Set</button></div>
      <div class="row"><button class="sm" data-a="clear">Clear sync points</button><button class="sm" data-a="close">Close</button></div>`;
    box.hidden = false;
    $$('[data-a]', box).forEach(b => b.onclick = () => {
      const a = b.dataset.a; let s = null;
      if (a === 'start') s = start; else if (a === 'summit') s = summit; else if (a === 'km') s = summit - (+$('#syKm', box).value) * 1000;
      else if (a === 'clear') { R.video.anchors = []; const cfg = store.get('vid.' + R.video.key, {}); cfg.anchors = []; store.set('vid.' + R.video.key, cfg); toast('Sync points cleared'); }
      if (s != null) { if (R.video.addAnchor(Math.max(0, Math.min(R.route.length, s)))) toast(`Synced · ${((summit - s) / 1000).toFixed(1)} km to go`); else toast('Video not ready yet', 'err'); }
      box.hidden = true;
    });
  },

  // ── Activity tab
  viewActivity(m) {
    const rides = store.get('rides', []), xp = store.get('xp', 0), lvl = levelFor(xp), badges = store.get('badges', {});
    const tot = rides.reduce((a, r) => (a.km += r.dist / 1000, a.m += r.gain, a.t += r.time, a), { km: 0, m: 0, t: 0 });
    m.innerHTML = `<div class="hero lvl"><div><h1>Level ${lvl.n}</h1><div class="xpbar"><i style="width:${lvl.pct}%"></i></div><p>${Math.round(xp)} XP · ${Math.round(lvl.next - xp)} XP to level ${lvl.n + 1}</p></div>
      <div class="kv"><div><b>${tot.km.toFixed(0)}</b> km</div><div><b>${Math.round(tot.m)}</b> m climbed</div><div><b>${(tot.t / 3600).toFixed(1)}</b> h</div><div><b>${rides.length}</b> rides</div></div></div>
      <h2 class="sec">Badges</h2><div class="badges">${BADGES.map(b => `<div class="bdg ${badges[b.id] ? 'on' : ''}"><span>${b.icon}</span><b>${b.name}</b><small>${b.desc}</small></div>`).join('')}</div>
      <h2 class="sec">Rides</h2><div class="rides">${rides.length ? rides.slice().reverse().map(r => `<div class="ride"><div><b>${esc(r.workout || r.route)}</b><small>${new Date(r.date).toLocaleString()}${r.demo ? ' · demo' : ''}</small></div><span>${(r.dist / 1000).toFixed(1)} km</span><span>${fmtTime(r.time)}</span><span>${r.avgP} W</span><span>${r.avgHr || '–'} bpm</span><span>${r.tss} TSS</span><button class="sm" data-tcx="${r.id}" ${store.get('rec.' + r.id, null) ? '' : 'disabled'}>TCX</button></div>`).join('') : '<p class="note">No rides yet. Go climb something.</p>'}</div>`;
    $$('[data-tcx]', m).forEach(b => b.onclick = () => { const r = rides.find(x => x.id == b.dataset.tcx), rec = store.get('rec.' + r.id, []); download(`ascent-${r.date.slice(0, 10)}-${r.routeId}.tcx`, toTCX(r, rec, null)); });
  },

  // ── Settings tab
  viewSettings(m) {
    const S = Settings.get();
    const f = (k, label, attrs, help) => `<label>${label}<input data-k="${k}" value="${esc(S[k])}" ${attrs}>${help ? `<small>${help}</small>` : ''}</label>`;
    const users = Users.list(), cur = Users.current();
    m.innerHTML = `<div class="panel"><h3 style="font-family:var(--fc);font-size:20px;margin-bottom:10px">Riders</h3><div class="riders sm">${users.map(u => `<div class="rider ${u.id === cur?.id ? 'cur' : ''}"><i style="background:${u.color}">${esc(u.name.slice(0, 1).toUpperCase())}</i><b>${esc(u.name)}</b>${u.id === cur?.id ? '<small>Riding now</small>' : `<button class="sm" data-switch="${u.id}">Switch</button>`}${users.length > 1 ? `<button class="sm del" data-del="${u.id}">Delete</button>` : ''}</div>`).join('')}<button class="rider add" id="setAddRider"><i>+</i><b>Add rider</b></button></div></div>
    <div class="cols"><div class="panel form"><h3>${esc(cur?.name || 'Rider')}'s settings</h3>${f('name', 'Name', 'type="text"')}${f('weight', 'Weight (kg)', 'type="number" min="35" max="160"')}${f('ftp', 'FTP (W)', 'type="number" min="60" max="500"', 'Unknown? Do the FTP Ramp Test workout.')}${f('maxHr', 'Max heart rate', 'type="number" min="120" max="220"')}
      <h3>Heart rate</h3><label>Primary HR source<select data-k="hrPrimary"><option value="">Freshest signal</option>${BLE.hr.map(h => `<option ${S.hrPrimary === h.name ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}</select><small>Whoop: Whoop app → Device Settings → Heart Rate Broadcast ON. Apple Watch: watchOS can't broadcast HR over Bluetooth on its own; use an app like HeartCast or BlueHeart, start it on the watch, then connect here.</small></label>
      <h3>Experience</h3><label class="chk"><input type="checkbox" data-k="voice" ${S.voice ? 'checked' : ''}> Voice coach</label><label class="chk"><input type="checkbox" data-k="sound" ${S.sound ? 'checked' : ''}> Wind sound</label>
      <label>Graphics<select data-k="quality">${['low', 'medium', 'high'].map(q => `<option ${S.quality === q ? 'selected' : ''}>${q}</option>`).join('')}</select><small>Use low on an older iPad.</small></label></div>
      <div class="panel form"><h3>Bike & resistance</h3>
      <label>Control protocol<select data-k="protocol">${[['auto', 'Auto (FitShow on Toputure)'], ['fitshow', 'FitShow FFF2 — Kinomap style (TBE5 default)'], ['ftms-level', 'FTMS set resistance level'], ['ftms-sim', 'FTMS simulation (grade)'], ['none', 'Off — read data only']].map(([v, l]) => `<option value="${v}" ${S.protocol === v ? 'selected' : ''}>${l}</option>`).join('')}</select><small>Reconnect the bike after changing.</small></label>
      <label>FitShow packet table<select data-k="fsTable"><option value="kinomap" ${S.fsTable === 'kinomap' ? 'selected' : ''}>Kinomap / VirtuFit table</option><option value="clean" ${S.fsTable === 'clean' ? 'selected' : ''}>Clean (incline byte 0)</option></select><small>Try the other one if the levels don't change.</small></label>
      ${f('maxLevel', 'Bike levels', 'type="number" min="8" max="100"', 'TBE5 = 32. Auto-detected if the bike reports it.')}${f('flatLevel', 'Level on flat road', 'type="number" min="1" max="32"')}${f('levelsPerPct', 'Levels per 1 % gradient', 'type="number" step="0.1" min="0.3" max="5"', 'Feel: 10 % × difficulty 60 % × 1.6 = +10 levels.')}
      <label>Test resistance<div class="row">${[1, 8, 16, 24, 32].map(l => `<button class="sm" data-lvl="${l}">${l}</button>`).join('')}</div><small>Pedal and tap — you should feel each step.</small></label>
      <label class="chk"><input type="checkbox" data-k="rawLog" ${S.rawLog ? 'checked' : ''}> Log raw Bluetooth frames</label>
      <pre id="bleLog">${esc(BLE.log.slice(-120).join('\n')) || 'Bluetooth log appears here once the bike connects.'}</pre>
      <div class="row"><button class="sm" id="copyLog">Copy log</button><button class="sm" id="resetAll">Reset everything (all riders)</button></div></div></div>`;
    $$('[data-k]', m).forEach(el => el.onchange = () => { const k = el.dataset.k; let v = el.type === 'checkbox' ? el.checked : el.value; if (el.type === 'number') v = +v; Settings.set({ [k]: v }); if (k === 'name' && cur) { Users.rename(cur.id, v); this.onUserChange(); } toast('Saved'); });
    $$('[data-switch]', m).forEach(b => b.onclick = () => { Users.use(b.dataset.switch); this.onUserChange(); toast('Switched to ' + Users.current().name); });
    $$('[data-del]', m).forEach(b => b.onclick = () => { const u = users.find(x => x.id === b.dataset.del); if (confirmLite(`Delete ${u.name} and all their rides, PRs and settings?`)) { Users.remove(u.id); if (!Users.current()) Users.use(Users.list()[0].id); this.onUserChange(); } });
    $('#setAddRider').onclick = () => { Setup.open(); Setup.adding = true; Setup.render(); };
    $$('[data-lvl]', m).forEach(b => b.onclick = () => { if (!BLE.bike) return toast('Connect the bike first', 'err'); BLE.setLevel(+b.dataset.lvl, true); toast('Level ' + b.dataset.lvl + ' sent'); });
    $('#copyLog').onclick = () => { navigator.clipboard?.writeText(BLE.log.join('\n')); toast('Log copied'); };
    $('#resetAll').onclick = () => { if (confirmLite('Delete ALL riders, rides, PRs and settings on this device?')) { try { Object.keys(localStorage).filter(k => k.startsWith('ascent.')).forEach(k => localStorage.removeItem(k)); } catch (e) {} location.reload(); } };
  },

  ensureWorld(R) {
    if (R.worldReady) return; this.world.load(R.route);
    R.bots.forEach(b => { b.obj = this.world.makeRider(b.color); b.obj.add(this.world.makeLabel(b.name.split(' · ')[0], b.pacer ? '#ffd166' : '#fff')); });
    if (R.ghost) { R.ghostObj = this.world.makeRider(0x9ad1ff, true); R.ghostObj.add(this.world.makeLabel('PR ghost', '#9ad1ff')); }
    R.me = this.world.makeRider(0xff5a1f); R.worldReady = true;
  },
  toggleView() {
    const R = this.ride; if (!R) return; R.view = R.view === '3d' ? 'data' : '3d'; const data = R.view === 'data';
    if (!data) { this.ensureWorld(R); this.world.resize(); setTimeout(() => { this.profileMap = drawProfile($('#profCanvas'), R.route, { segs: true, alpha: 0.75, top: 10 }); if (R.workout) drawWorkout($('#wkCanvas'), R.o.workout, { now: R.t }); }, 30); }
    else Dash.build(R);
    document.body.classList.toggle('focus', data); $('#dash').hidden = !data; $('#btnData').textContent = data ? '3D' : 'DATA';
    $('#freeBox').hidden = true; store.set('screen', R.view);
  },
  onUserChange() {
    const u = Users.current(); const c = $('#devUser');
    if (c) c.innerHTML = u ? `<i class="av" style="background:${u.color}">${esc(u.name.slice(0, 1).toUpperCase())}</i><span>${esc(u.name)}</span>` : '<span>Choose rider</span>';
    if (!this.ride) this.show(store.get('tab', 'routes'));
  },
  freeRide() { this.start({ route: this.route('lake'), mode: 'free', focus: true }); },

  // ── Ride
  start(opts) {
    $('#home').hidden = true; $('#rideView').hidden = false; document.body.classList.add('riding');
    const focus = !!opts.focus; document.body.classList.toggle('focus', focus); document.body.classList.toggle('free', opts.mode === 'free');
    this.world.view = store.get('view', 'first');
    this.ride = new Ride(opts); const R = this.ride; R.view = focus ? 'data' : '3d'; R.worldReady = false;
    if (!focus) this.ensureWorld(R);
    if (focus) Dash.build(R); $('#dash').hidden = !focus;
    const canToggle = opts.mode === 'route' || opts.mode === 'workout'; $('#btnData').hidden = !canToggle; $('#btnData').textContent = focus ? '3D' : 'DATA';
    if (opts.mode === 'video') {
      R.video = new VideoSync({ ...opts.video, el: $('#video'), ytHost: $('#ytHost'), routeLength: opts.route.length });
      $('#btnSync').hidden = false; if (!(opts.video.anchors || []).length) setTimeout(() => toast('Tap SYNC when you see the climb start or a km sign'), 4000);
      $('#world').style.opacity = 0; R.gpx = opts.gpx;
    } else { $('#world').style.opacity = 1; $('#btnSync').hidden = true; }
    $('#wkBar').hidden = !R.workout; $('#demoBox').hidden = !R.demo; $('#tgtBox').hidden = !R.workout;
    if (R.workout) setTimeout(() => drawWorkout($('#wkCanvas'), opts.workout, { now: 0 }), 30);
    this.profileMap = null; if (!focus) setTimeout(() => { this.profileMap = drawProfile($('#profCanvas'), R.route, { segs: true, alpha: 0.75, top: 10 }); }, 30);
    $('#freeBox').hidden = true;
    Sound.start(); try { navigator.wakeLock?.request('screen').then(l => this.wake = l).catch(() => {}); } catch (e) {}
    if (R.demo) toast('Demo mode — no bike connected. Use ↑ ↓ or the slider to set watts.');
    say(opts.mode === 'workout' ? `${opts.workout.name}. Let's go.` : opts.mode === 'free' ? 'Free ride. Use plus and minus to change resistance.' : `${opts.route.def.name}. Good luck.`);
    this.hudDevices(); this.bindHud();
    let last = performance.now(), acc = 0;
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      R.tick(dt, this.world);
      const W = this.world;
      if (R.view === '3d' && R.worldReady) {
        W.setRider(R.me, R.s, R.lateral, R.cadence, R.v, dt); R.me.visible = W.view !== 'first';
        R.bots.forEach(b => W.setRider(b.obj, b.s, b.lateral, 85, b.v, dt));
        if (R.ghostObj) { if (R.ghostS != null) { R.ghostObj.visible = true; W.setRider(R.ghostObj, R.ghostS, R.lateral + 1.1, 85, 7, dt); } else R.ghostObj.visible = false; }
        if (opts.mode !== 'video') { W.updateCamera(R.s, R.lateral, R.cadence, dt, R.t); W.render(); }
      }
      Sound.update(R.v);
      acc += dt; if (acc > 0.2) { acc = 0; this.hud(); }
      if (R.finished) return this.end();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },
  bindHud() {
    const R = this.ride;
    const S0 = Settings.get();
    $('#gearUp').onclick = $('#freeUp').onclick = () => { if (R.mode === 'free') R.freeLevel = Math.min(S0.maxLevel, R.freeLevel + 1); else R.gear = Math.min(11, R.gear + 1); this.hud(); };
    $('#gearDn').onclick = $('#freeDn').onclick = () => { if (R.mode === 'free') R.freeLevel = Math.max(1, R.freeLevel - 1); else R.gear = Math.max(1, R.gear - 1); this.hud(); };
    $('#btnView').onclick = () => { this.world.view = this.world.view === 'first' ? 'third' : 'first'; store.set('view', this.world.view); };
    $('#btnPause').onclick = () => { R.paused = !R.paused; $('#btnPause').textContent = R.paused ? '▶' : '❚❚'; $('#pausedOv').hidden = !R.paused; };
    $('#btnEnd').onclick = () => { if (confirmLite('End ride and save?')) R.finish('Ride ended'); };
    $('#btnLvl').onclick = () => { R.manualLevel = R.manualLevel == null ? R.level : null; toast(R.manualLevel == null ? 'Auto resistance' : 'Manual resistance — use gears'); };
    $('#demoP').oninput = (e) => { R.demoPower = +e.target.value; };
    $('#btnLane').onclick = () => { R.lateral = R.lateral < -1 ? 0.2 : -1.6; };
    $('#btnSync').onclick = () => this.syncPanel();
    $('#btnData').onclick = () => this.toggleView();
  },
  key(e) {
    const R = this.ride; if (!R) return; if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowUp') { R.demoPower = Math.min(1200, R.demoPower + 10); $('#demoP').value = R.demoPower; }
    else if (e.key === 'ArrowDown') { R.demoPower = Math.max(0, R.demoPower - 10); $('#demoP').value = R.demoPower; }
    else if (e.key === '+' || e.key === '=' || e.key === ']') $('#gearUp').click();
    else if (e.key === '-' || e.key === '[') $('#gearDn').click();
    else if (e.key === 'c' || e.key === 'C') $('#btnView').click();
    else if (e.key === ' ') { e.preventDefault(); $('#btnPause').click(); }
    else if (e.key === 'l' || e.key === 'L') $('#btnLane').click();
  },
  hudDevices() { const b = BLE.bike; $('#hBike').className = 'pill ' + (b?.server?.connected ? 'ok' : this.ride?.demo ? 'demo' : 'bad'); $('#hBike').textContent = b ? (b.server?.connected ? 'BIKE' : 'BIKE…') : 'DEMO'; const hr = BLE.heartRate(); $('#hHr').className = 'pill ' + (hr ? 'ok' : 'bad'); $('#hHr').textContent = BLE.hr.map(h => h.name.split(' ')[0]).join(' + ') || 'NO HR'; },
  hud() {
    const R = this.ride, S = Settings.get(); if (!R) return;
    if (R.view === 'data') Dash.update(R);
    const p = Math.round(R.avg3()), wkg = p / S.weight, g = R.route.at(R.s + 4).g;
    $('#hPow').textContent = p; $('#hWkg').textContent = wkg.toFixed(1);
    $('#hPowZ').style.background = ZONE_COL[pwrZone(p, S.ftp)];
    $('#hCad').textContent = Math.round(R.cadence);
    const hr = R.hr; $('#hHrV').textContent = hr || '–'; $('#hHrZ').textContent = hr ? 'Z' + hrZone(hr, S.maxHr) : ''; $('#hrBlock').style.setProperty('--z', hr ? ZONE_COL[hrZone(hr, S.maxHr) + 1] : '#444');
    $('#hSpd').textContent = (R.v * 3.6).toFixed(1); $('#hDist').textContent = ((R.mode === 'video' ? R.s : R.dist) / 1000).toFixed(2); $('#hElev').textContent = Math.round(R.gain); $('#hTime').textContent = fmtTime(R.t);
    $('#hGrade').textContent = (g >= 0 ? '' : '−') + Math.abs(g).toFixed(1); $('#gradeBox').style.background = g > 9 ? '#b91c1c' : g > 6 ? '#ea580c' : g > 3 ? '#ca8a04' : g > -2 ? '#1f2937' : '#1d4ed8';
    $('#hLvl').textContent = R.level; $('#hGear').textContent = R.mode === 'free' ? R.level : R.gear; $('#freeLvl').textContent = R.level; $('#btnLvl').classList.toggle('manual', R.manualLevel != null);
    $('#hDraft').hidden = R.draft < 0.08;
    if (R.mode === 'free' || R.o.focus) $('#hRemain').textContent = R.mode === 'free' ? 'Free ride' : (R.o.workout?.name || ''); else $('#hRemain').textContent = R.route.def.real && !R.workout ? `${((R.route.length - R.s) / 1000).toFixed(1)} km to summit` : `${(R.route.length / 1000 - R.s / 1000).toFixed(1)} km left`;
    $('#demoV').textContent = R.demoPower + ' W';
    if (R.workout && R.target) {
      const tg = R.target; $('#tW').textContent = tg.watts; $('#tLbl').textContent = tg.seg.b.label; $('#tRem').textContent = fmtTime(tg.remain);
      $('#tCad').textContent = tg.seg.b.c ? tg.seg.b.c + ' rpm' : ''; const diff = p - tg.watts; $('#tgtBox').dataset.state = Math.abs(diff) < tg.watts * 0.06 ? 'on' : diff < 0 ? 'low' : 'high';
      if (!this._wkT || R.t - this._wkT > 1) { this._wkT = R.t; drawWorkout($('#wkCanvas'), this.ride.o.workout, { now: R.t }); }
    }
    // Profile marker + riders
    if (this.profileMap && R.view === '3d') {
      const mk = $('#profMe'), x = this.profileMap.X(R.s); mk.style.left = x + 'px';
      $('#profGhost').hidden = R.ghostS == null; if (R.ghostS != null) $('#profGhost').style.left = this.profileMap.X(R.ghostS) + 'px';
    }
    const near = R.bots.map(b => ({ n: b.name, gap: b.s - R.s, pacer: b.pacer, wkg: b.wkg })).concat(R.ghostS != null ? [{ n: 'PR ghost', gap: R.ghostS - R.s, ghost: true }] : []);
    near.push({ n: S.name || 'You', gap: 0, me: true }); near.sort((a, b) => b.gap - a.gap);
    const mi = near.findIndex(x => x.me); const view = near.slice(Math.max(0, mi - 4), mi + 5);
    $('#riders').innerHTML = view.map(x => `<div class="${x.me ? 'me' : ''} ${x.pacer ? 'pacer' : ''} ${x.ghost ? 'ghost' : ''}"><span>${esc(x.n.split(' · ')[0])}</span><em>${x.me ? (wkg.toFixed(1) + ' W/kg') : (x.gap > 0 ? '+' : '') + (Math.abs(x.gap) > 1000 ? (x.gap / 1000).toFixed(1) + ' km' : Math.round(x.gap) + ' m')}</em></div>`).join('');
    this.hudDevices();
  },
  end() {
    cancelAnimationFrame(this.raf); const R = this.ride; this.ride = null; Sound.stop(); try { this.wake?.release(); } catch (e) {}
    R.video?.stop(); $('#syncBox').hidden = true; document.body.classList.remove('riding', 'focus', 'free');
    const sum = R.summary();
    if (R.rec.length < 20) { $('#rideView').hidden = true; $('#home').hidden = false; toast('Ride too short to save'); this.show(this.tab); return; }
    // Persist
    const rides = store.get('rides', []); rides.push(sum); store.set('rides', rides.slice(-200));
    store.set('rec.' + sum.id, R.rec); const keep = rides.slice(-15).map(r => 'rec.' + r.id); try { Object.keys(localStorage).filter(k => k.startsWith(store.prefix() + 'rec.') && !keep.includes(k.slice(store.prefix().length))).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    let newPb = false;
    if (sum.finished && !R.workout && R.mode !== 'video' && R.mode !== 'free') { const pb = store.get('ghost.' + sum.routeId, null); if (!pb || R.t < pb.time) { newPb = !!pb || true; const s = []; for (let i = 0; i < R.rec.length; i += 2) s.push(R.rec[i].s); store.set('ghost.' + sum.routeId, { time: R.t, s, date: Date.now() }); } }
    const xpGain = sum.dist / 1000 * 20 + sum.gain * 0.6 + sum.time / 60 * 2 + (sum.finished ? 100 : 0); const xp0 = store.get('xp', 0), l0 = levelFor(xp0).n; store.set('xp', xp0 + xpGain); const l1 = levelFor(xp0 + xpGain).n;
    const earned = awardBadges(sum, rides);
    const ftpNew = R.o.workout?.ramp && sum.best60 ? Math.round(sum.best60 * 0.75) : null;
    sheet(`<div class="sheethead"><span class="badge real">${esc(R.finishMsg || 'Ride saved')}</span><h2>${esc(sum.workout || sum.route)}</h2><p>${new Date(sum.date).toLocaleString()}${sum.demo ? ' · demo ride' : ''}</p></div>
      <div class="kv k6"><div><b>${(sum.dist / 1000).toFixed(2)}</b> km</div><div><b>${fmtTime(sum.time)}</b> time</div><div><b>${sum.gain}</b> m up</div><div><b>${sum.avgP}</b> W avg</div><div><b>${sum.np}</b> W NP</div><div><b>${sum.avgHr || '–'}</b> bpm</div><div><b>${sum.tss}</b> TSS</div><div><b>${sum.kcal}</b> kcal</div><div><b>${sum.best5}</b> W 5 s</div><div><b>${sum.best60}</b> W 1 min</div></div>
      <canvas class="chart" id="sumChart"></canvas>
      ${sum.segs.length ? `<h4>Segments</h4><ul class="segs">${sum.segs.map(sg => `<li><i class="${sg.type}"></i>${esc(sg.name)} <em>${Math.round(sg.watts)} W</em><b>${fmtTime(sg.time)} ${sg.pr ? '🏆' : ''}</b></li>`).join('')}</ul>` : ''}
      <p class="note">+${Math.round(xpGain)} XP${l1 > l0 ? ` · <b>Level up → ${l1}!</b>` : ''}${earned.length ? ' · New badge: ' + earned.map(b => b.icon + ' ' + b.name).join(', ') : ''}${newPb && sum.finished && !R.workout ? ' · Your ghost on this route is updated.' : ''}</p>
      ${ftpNew ? `<div class="ftpbox">Estimated FTP: <b>${ftpNew} W</b> (75 % of your best minute, ${sum.best60} W)<button class="sm" id="setFtp">Use as my FTP</button></div>` : ''}
      <div class="row"><button class="go sec2" id="tcx">Download .tcx</button><button class="go" id="done">Done</button></div>
      <p class="note">Whoop and Apple Watch record the session on their own side. Upload the .tcx to Strava (strava.com/upload/select) to get power, cadence and the route into your log.</p>`, (root) => {
      requestAnimationFrame(() => drawSummaryChart($('#sumChart', root), R.rec));
      $('#tcx', root).onclick = () => download(`ascent-${sum.date.slice(0, 10)}-${sum.routeId}.tcx`, toTCX(sum, R.rec, R.gpx?.pts));
      $('#done', root).onclick = () => { closeSheet(); $('#rideView').hidden = true; $('#home').hidden = false; this.show(this.tab); };
      $('#setFtp', root) && ($('#setFtp', root).onclick = () => { Settings.set({ ftp: ftpNew }); toast('FTP set to ' + ftpNew + ' W'); });
    }, true);
    say(R.finishMsg || 'Ride saved');
  }
};

function drawSummaryChart(cv, rec) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  if (!rec.length) return; const maxP = Math.max(100, ...rec.map(r => r.p)), maxH = Math.max(120, ...rec.map(r => r.hr)); const X = i => i / (rec.length - 1) * w;
  const minY = Math.min(...rec.map(r => r.y)), maxY = Math.max(minY + 10, ...rec.map(r => r.y));
  g.fillStyle = 'rgba(148,163,184,.18)'; g.beginPath(); g.moveTo(0, h); rec.forEach((r, i) => g.lineTo(X(i), h - (r.y - minY) / (maxY - minY) * h * 0.6)); g.lineTo(w, h); g.fill();
  const line = (f, max, col) => { g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); let acc = 0; rec.forEach((r, i) => { acc = acc * 0.8 + f(r) * 0.2; const y = h - acc / max * h * 0.92; i ? g.lineTo(X(i), y) : g.moveTo(X(i), y); }); g.stroke(); };
  line(r => r.p, maxP, '#ff5a1f'); if (rec.some(r => r.hr)) line(r => r.hr, maxH, '#f43f5e');
  g.fillStyle = '#ff5a1f'; g.font = '600 11px system-ui'; g.fillText('Power', 6, 14); g.fillStyle = '#f43f5e'; g.fillText('Heart rate', 56, 14); g.fillStyle = '#94a3b8'; g.fillText('Elevation', 128, 14);
}

const BADGES = [
  { id: 'first', icon: '🚲', name: 'First pedal', desc: 'Complete any ride', test: (s) => true },
  { id: 'alpe', icon: '⛰', name: '21 hairpins', desc: "Finish Alpe d'Huez", test: (s) => s.routeId === 'alpe' && s.finished },
  { id: 'ventoux', icon: '🌕', name: 'Giant of Provence', desc: 'Finish Mont Ventoux', test: (s) => s.routeId === 'ventoux' && s.finished },
  { id: 'stelvio', icon: '🏔', name: '48 tornanti', desc: 'Finish the Stelvio', test: (s) => s.routeId === 'stelvio' && s.finished },
  { id: 'tourmalet', icon: '🗻', name: 'Géant du Tourmalet', desc: 'Finish the Tourmalet', test: (s) => s.routeId === 'tourmalet' && s.finished },
  { id: 'k1', icon: '📈', name: '1 000 m day', desc: 'Climb 1 000 m in one ride', test: (s) => s.gain >= 1000 },
  { id: 'everest', icon: '🧗', name: 'Everesting', desc: '8 848 m in total', test: (s, all) => all.reduce((a, r) => a + r.gain, 0) >= 8848 },
  { id: 'c100', icon: '💯', name: 'Century', desc: '100 km in total', test: (s, all) => all.reduce((a, r) => a + r.dist, 0) >= 100000 },
  { id: 'ftp', icon: '⚡', name: 'Know your numbers', desc: 'Do the FTP ramp test', test: (s) => s.workout === 'FTP Ramp Test' },
  { id: 'hour', icon: '⏱', name: 'The hour', desc: 'Ride 60 minutes non-stop', test: (s) => s.time >= 3600 },
  { id: 'kom', icon: '🏆', name: 'PR hunter', desc: 'Set 5 segment PRs', test: (s, all) => all.reduce((a, r) => a + (r.segs || []).filter(x => x.pr).length, 0) >= 5 },
  { id: 'w5', icon: '🔥', name: 'Consistent', desc: '5 rides in 7 days', test: (s, all) => all.filter(r => Date.now() - new Date(r.date) < 7 * 864e5).length >= 5 }
];
function awardBadges(sum, all) { if (sum.demo) return []; const have = store.get('badges', {}), out = []; for (const b of BADGES) if (!have[b.id] && b.test(sum, all.filter(r => !r.demo))) { have[b.id] = Date.now(); out.push(b); } store.set('badges', have); return out; }
function levelFor(xp) { let n = 1, need = 0; const req = (k) => Math.round(400 * Math.pow(k, 1.35)); while (xp >= need + req(n)) { need += req(n); n++; } return { n, pct: (xp - need) / req(n) * 100, next: need + req(n) }; }
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/xml' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function confirmLite(msg) { try { return window.confirm(msg); } catch (e) { return true; } }
function sheet(html, bind, locked) { const s = $('#sheet'); $('#sheetBody').innerHTML = html; s.hidden = false; s.dataset.locked = locked ? 1 : ''; bind && bind($('#sheetBody')); }
function closeSheet() { $('#sheet').hidden = true; }

window.addEventListener('DOMContentLoaded', () => {
  $('#devBike').onclick = () => App.connectBike();
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' && !$('#sheet').dataset.locked) closeSheet(); });
  $('#sheetClose').onclick = () => { if ($('#sheet').dataset.locked) $('#done')?.click(); else closeSheet(); };
  App.init();
});
