// ───────────────────────────── Ride engine ─────────────────────────────
const G = 9.81, RHO = 1.2;

function physicsStep(v, P, gradePct, mass, cda, crr, draft, dt) {
  const th = Math.atan(gradePct / 100);
  const Fg = mass * G * Math.sin(th), Fr = mass * G * crr * Math.cos(th) * (v > 0.1 ? 1 : 0), Fa = 0.5 * RHO * cda * (1 - draft) * v * v;
  const Fd = P > 0 ? P / Math.max(v, 1.2) : 0;
  const a = (Fd - Fg - Fr - Fa) / (mass + 1.2);
  return Math.max(0, Math.min(25, v + a * dt));
}
function workoutTimeline(w, ftp) {
  const out = []; let t = 0;
  for (const b of w.blocks) { out.push({ t0: t, t1: t + b.d, b }); t += b.d; }
  const targetAt = (time) => {
    const seg = out.find(x => time >= x.t0 && time < x.t1); if (!seg) return null;
    const f = (time - seg.t0) / seg.b.d; const p = Array.isArray(seg.b.p) ? seg.b.p[0] + (seg.b.p[1] - seg.b.p[0]) * f : seg.b.p;
    return { watts: Math.round(p * ftp), frac: p, seg, remain: seg.t1 - time, next: out[out.indexOf(seg) + 1] };
  };
  return { segs: out, total: t, targetAt };
}

class Ride {
  constructor(opts) {
    this.o = opts; const S = Settings.get();
    this.route = opts.route; this.mode = opts.mode; this.workout = opts.workout ? workoutTimeline(opts.workout, S.ftp) : null;
    this.erg = opts.erg !== false; this.s = 0; this.v = 0; this.t = 0; this.paused = false; this.finished = false;
    this.gear = 6; this.manualLevel = null; this.level = S.flatLevel; this.lateral = -1.6;
    this.power = 0; this.cadence = 0; this.hr = 0; this.p3 = []; this.kj = 0; this.gain = 0; this.lastY = this.route.at(0).y;
    this.rec = []; this.recT = 0; this.events = []; this.segState = {}; this.segResults = [];
    this.demo = !BLE.bike; this.demoPower = 150; this.demoCad = 85;
    this.draft = 0; this.ergLevel = S.flatLevel; this.ergT = 0; this.lowCadT = 0; this.nextKm = 1000; this.nextTurn = 0;
    this.startedAt = new Date(); this.cueSaid = {};
    // Bots
    const mass = S.weight;
    this.bots = [];
    const pacer = opts.focus ? null : PACERS.find(p => p.name === opts.pacer);
    this.freeLevel = Settings.get().flatLevel;
    if (pacer) this.bots.push({ name: pacer.name + ' · ' + pacer.wkg.toFixed(1) + ' W/kg', wkg: pacer.wkg, mass: 72, s: 6, v: 6, lateral: -1.3, color: pacer.color, pacer: true });
    const rnd = mulberry(Date.now() & 0xffff);
    const nb = (opts.mode === 'video' || opts.focus) ? 0 : (Settings.get().quality === 'low' ? 5 : 9);
    for (let i = 0; i < nb; i++) this.bots.push({ name: BOT_NAMES[i % BOT_NAMES.length], wkg: 1.8 + rnd() * 2.4, mass: 62 + rnd() * 25, s: rnd() * 600 - 100, v: 7, lateral: -2.6 + rnd() * 4.8, color: new THREE.Color().setHSL(rnd(), 0.65, 0.5).getHex(), var: rnd() * 6 });
    this.bots.forEach(b => { if (b.s < 0) b.s = 0; b.p = b.wkg * b.mass; });
    // Ghost (personal best on this route)
    const pb = store.get('ghost.' + this.route.def.id, null);
    this.ghost = opts.ghost && pb ? pb : null; // {time, s:[distance per 2 s]}
  }

  input() {
    const S = Settings.get(), now = performance.now();
    if (this.demo) {
      this.power = this.demoPower > 0 ? Math.max(0, this.demoPower + Math.sin(this.t * 1.7) * 6) : 0;
      this.cadence = this.demoPower > 0 ? this.demoCad + Math.sin(this.t) * 2 : 0;
      this.hr = BLE.heartRate() || Math.round(68 + Math.min(105, this.power / S.ftp * 70 + this.t / 90));
      return;
    }
    const d = BLE.data, fresh = now - d.t < 3500;
    this.cadence = fresh ? d.cadence : 0;
    let p = fresh ? d.power : 0;
    if (p <= 0 && this.cadence > 20) p = this.cadence * (0.45 + this.level * 0.11) * 1.1; // estimate if bike reports no power
    this.power = p; this.hr = BLE.heartRate();
  }

  targetLevel(grade) {
    const S = Settings.get();
    if (this.mode === 'free') return this.freeLevel;
    if (this.manualLevel != null) return this.manualLevel;
    const gearOff = (this.gear - 6) * 1.2;
    if (this.workout && this.erg) return this.ergLevel + gearOff * 0;
    let eff = grade * S.difficulty / 100; if (eff < 0) eff *= 0.5;
    eff -= this.draft * 4; // drafting makes it easier
    return S.flatLevel + eff * S.levelsPerPct + gearOff;
  }

  tick(dt, world) {
    if (this.paused || this.finished) return;
    const S = Settings.get();
    this.input();
    this.t += dt;
    const route = this.route;
    let grade;
    if (this.video && this.video.synced) { // distance follows the footage
      const d = this.video.distance(); if (d != null) this.s = d;
    }
    grade = route.at(Math.min(route.length, this.s + 4)).g;
    // Drafting: bot 0.5–6 m ahead within 1.2 m lateral
    let draft = 0;
    for (const b of this.bots) { const gap = b.s - this.s; if (gap > 0.5 && gap < 6 && Math.abs(b.lateral - this.lateral) < 1.3) draft = Math.max(draft, 0.33 * (1 - (gap - 0.5) / 5.5)); }
    this.draft += (draft - this.draft) * Math.min(1, dt * 2);
    const mass = S.weight + 9;
    this.v = physicsStep(this.v, this.power, grade, mass, S.cda, S.crr, this.draft, dt);
    if (!(this.video && this.video.synced)) this.s += this.v * dt;
    if (this.video) this.video.setSpeed(this.v);
    this.kj += this.power * dt / 1000;
    const y = route.at(this.s).y; if (y > this.lastY) this.gain += y - this.lastY; this.lastY = y;
    this.p3.push([this.t, this.power]); while (this.p3.length && this.t - this.p3[0][0] > 3) this.p3.shift();

    // Workout / pseudo-ERG: close the loop on power by stepping the resistance level
    if (this.workout) {
      const tg = this.workout.targetAt(this.t); this.target = tg;
      if (tg && this.erg && this.manualLevel == null) {
        this.ergT += dt;
        if (this.ergT > 1.5 && this.cadence > 35) {
          this.ergT = 0; const err = tg.watts - this.avg3();
          const step = Math.max(-2, Math.min(2, Math.round(err / Math.max(12, tg.watts * 0.07))));
          this.ergLevel = Math.max(S.minLevel, Math.min(S.maxLevel, this.ergLevel + step));
        }
      }
      if (tg) this.cues(tg);
      if (!tg && this.t > this.workout.total) this.finish('Workout complete');
      if (this.o.workout.ramp && this.t > 300) { if (this.cadence < 45) this.lowCadT += dt; else this.lowCadT = 0; if (this.lowCadT > 8) this.finish('Ramp test over'); }
    }
    // Resistance to the bike
    this.level = Math.max(S.minLevel, Math.min(S.maxLevel, Math.round(this.targetLevel(grade))));
    if (BLE.bike) { if (BLE.bike.protocol === 'ftms-sim') BLE.setSimGrade(grade * S.difficulty / 100); else BLE.setLevel(this.level); }

    // Bots
    for (const b of this.bots) {
      const bg = route.at(Math.min(route.length, b.s + 4)).g;
      let p = b.wkg * b.mass * (b.pacer ? 1 : (1 + 0.08 * Math.sin(this.t / 20 + b.var)));
      if (!b.pacer && bg > 3) p *= 1.08; // bots dig in on climbs
      if (b.pacer && b.s - this.s > 25) p *= 0.85; // pace partner waits a little
      b.v = physicsStep(b.v, p, bg, b.mass + 8, 0.32, 0.005, 0, dt); b.s = Math.min(route.length - 2, b.s + b.v * dt);
    }
    if (this.ghost) { const i = this.t / 2, a = Math.floor(i); this.ghostS = this.ghost.s[Math.min(this.ghost.s.length - 1, a)] ?? null; }

    // Segments
    for (const sg of route.def.segments || []) {
      const st = this.segState[sg.name];
      if (!st && this.s >= sg.from && this.s < sg.from + 50) { this.segState[sg.name] = { t0: this.t, p0: this.kj }; toast(`${sg.type === 'kom' ? '⛰ KOM' : '⚡ Sprint'} — ${sg.name}`, 'seg'); say(`${sg.name} starts now`); }
      else if (st && !st.done && this.s >= sg.to) {
        st.done = true; const time = this.t - st.t0, watts = (this.kj - st.p0) * 1000 / time; const key = 'seg.' + route.def.id + '.' + sg.name;
        const pr = store.get(key, null), isPr = !pr || time < pr.time; if (isPr) store.set(key, { time, watts, date: Date.now() });
        this.segResults.push({ name: sg.name, type: sg.type, time, watts, pr: isPr, prev: pr?.time });
        toast(`${sg.name}: ${fmtTime(time)} ${isPr ? '🏆 NEW PR' : ''}`, isPr ? 'pr' : 'seg'); say(`${sg.name}. ${Math.round(time)} seconds. ${isPr ? 'New personal record!' : ''}`); Sound.chime();
      }
    }
    // Km + hairpin callouts
    if (this.s >= this.nextKm) {
      const rem = (route.length - this.s) / 1000; const g = route.at(this.s + 500).g;
      if (route.def.real) toast(`${rem.toFixed(1)} km to the summit · next km ${g.toFixed(1)} %`); this.nextKm += 1000;
      if (route.def.real && rem > 0.5 && Math.round(rem) % 2 === 0) say(`${Math.round(rem)} kilometres to go`);
      this.nextKm = (Math.floor(this.s / 1000) + 1) * 1000;
    }
    const turns = route.turns; while (this.nextTurn < turns.length - 1 && this.s >= turns[this.nextTurn + 1] * STEP - 30) this.nextTurn++;
    if (this.nextTurn < turns.length && this.s >= turns[this.nextTurn] * STEP - 30) {
      const n = route.def.countdown ? turns.length - this.nextTurn : this.nextTurn + 1; toast(`${({ Italy: 'Tornante', Spain: 'Curva' })[route.def.country] || 'Virage'} ${n}`); this.nextTurn++;
    }
    // Recording (1 Hz)
    this.recT += dt; if (this.recT >= 1) { this.recT -= 1; this.rec.push({ t: Math.round(this.t), s: +this.s.toFixed(1), p: Math.round(this.power), c: Math.round(this.cadence), hr: this.hr || 0, v: +this.v.toFixed(2), y: +y.toFixed(1), l: this.level }); }
    if (!this.workout && this.mode !== 'free' && this.s >= route.length - 1) this.finish('Summit!');
    if ((this.workout || this.mode === 'free') && this.s >= route.length - 5) { this.s = 0; this.nextKm = 1000; this.nextTurn = 0; this.bots.forEach(b => b.s = Math.random() * 300); } // loop scenery
  }

  cues(tg) {
    const S = Settings.get(); const k = tg.seg.t0;
    if (tg.remain < 6 && tg.remain > 5 && tg.next && !this.cueSaid[k]) {
      this.cueSaid[k] = 1; const nb = tg.next.b; const w = Math.round((Array.isArray(nb.p) ? nb.p[0] : nb.p) * S.ftp);
      say(`In 5 seconds: ${nb.label}, ${Math.round(nb.d / 60) || nb.d + ' seconds'}${nb.d >= 60 ? ' minutes' : ''} at ${w} watts`);
      toast(`Next: ${nb.label} · ${fmtTime(nb.d)} @ ${w} W`);
    }
  }
  avg3() { return this.p3.length ? this.p3.reduce((a, b) => a + b[1], 0) / this.p3.length : 0; }
  finish(msg) { if (this.finished) return; this.finished = true; this.finishMsg = msg; }

  summary() {
    const S = Settings.get(), r = this.rec, n = r.length || 1;
    const avgP = r.reduce((a, b) => a + b.p, 0) / n, hrs = r.filter(x => x.hr), avgHr = hrs.length ? hrs.reduce((a, b) => a + b.hr, 0) / hrs.length : 0;
    // Normalized power (30 s rolling, 4th power)
    let np = 0; if (r.length > 30) { const roll = []; let sum = 0; for (let i = 0; i < r.length; i++) { sum += r[i].p; if (i >= 30) sum -= r[i - 30].p; if (i >= 29) roll.push(Math.pow(sum / 30, 4)); } np = Math.pow(roll.reduce((a, b) => a + b, 0) / roll.length, 0.25); } else np = avgP;
    const IF = np / S.ftp, tss = (this.t * np * IF) / (S.ftp * 3600) * 100;
    let best60 = 0; for (let i = 60; i <= r.length; i++) { let s = 0; for (let k = i - 60; k < i; k++) s += r[k].p; best60 = Math.max(best60, s / 60); }
    let best5 = 0; for (let i = 5; i <= r.length; i++) { let s = 0; for (let k = i - 5; k < i; k++) s += r[k].p; best5 = Math.max(best5, s / 5); }
    return { id: Date.now(), date: this.startedAt.toISOString(), route: this.mode === 'free' ? 'Free ride' : this.route.def.name, routeId: this.mode === 'free' ? 'free' : this.route.def.id, workout: this.o.workout?.name || null, mode: this.mode,
      time: Math.round(this.t), dist: Math.round(this.s), gain: Math.round(this.gain), avgP: Math.round(avgP), np: Math.round(np), maxP: Math.max(0, ...r.map(x => x.p)), avgHr: Math.round(avgHr), maxHr: Math.max(0, ...r.map(x => x.hr)),
      kcal: Math.round(this.kj / 0.24 / 4.184), tss: Math.round(tss), IF: +IF.toFixed(2), best60: Math.round(best60), best5: Math.round(best5), segs: this.segResults, finished: this.s >= this.route.length - 2, demo: this.demo };
  }
}

// ── Video controller: local file (continuous rate) or YouTube (stepped rate).
// Sync model: anchors [[videoSeconds, routeMetres], ...] set by the rider ("climb starts", "5 km to go", "summit").
// Distance = piecewise-linear over anchors; filmed speed = slope of the current anchor span → playback rate = your speed / filmed speed.
class VideoSync {
  constructor({ file, youtube, refSpeedKmh, synced, el, ytHost, routeLength, key, anchors }) {
    this.ref = Math.max(5, refSpeedKmh || 20) / 3.6; this.synced = synced; this.kind = file ? 'file' : 'yt';
    this.routeLength = routeLength; this.key = key; this.anchors = (anchors || []).slice();
    this.lastRate = 0; this.rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    if (file) { this.el = el; el.src = URL.createObjectURL(file); el.muted = true; el.loop = false; el.playsInline = true; el.style.display = 'block'; el.play().catch(() => {}); el.pause(); }
    else if (youtube) {
      ytHost.style.display = 'block';
      loadYT(() => {
        this.yt = new YT.Player('ytPlayer', { videoId: youtube, playerVars: { controls: 0, modestbranding: 1, rel: 0, mute: 1, playsinline: 1, iv_load_policy: 3, autoplay: 1, disablekb: 1 },
          events: { onReady: (e) => { e.target.mute(); this.ready = true; try { const r = e.target.getAvailablePlaybackRates(); if (r?.length) this.rates = r; } catch (x) {} e.target.playVideo(); },
                    onStateChange: (e) => { this.playing = e.data === 1; } } });
      });
    }
  }
  duration() { return this.kind === 'file' ? (this.el?.duration || 0) : (this.ready ? this.yt.getDuration() : 0); }
  time() { return this.kind === 'file' ? this.el.currentTime : (this.ready ? this.yt.getCurrentTime() : 0); }
  full() { // anchors incl. implicit start/end
    const d = this.duration(), a = this.anchors.slice().sort((p, q) => p[0] - q[0]);
    if (!a.length || a[0][0] > 0.5) a.unshift([0, 0]);
    if (d && a[a.length - 1][0] < d - 0.5) a.push([d, Math.max(this.routeLength, a[a.length - 1][1])]);
    return a;
  }
  span(t) { const a = this.full(); let i = 0; while (i < a.length - 2 && t > a[i + 1][0]) i++; return [a[i], a[Math.min(i + 1, a.length - 1)]]; }
  distance() {
    if (!this.duration()) return null; const t = this.time(), [p, q] = this.span(t);
    if (q[0] <= p[0]) return Math.min(this.routeLength, p[1]);
    return Math.max(0, Math.min(this.routeLength, p[1] + (q[1] - p[1]) * (t - p[0]) / (q[0] - p[0])));
  }
  filmedSpeed() {
    if (!this.synced || !this.duration()) return this.ref;
    const [p, q] = this.span(this.time()); const v = (q[1] - p[1]) / Math.max(1, q[0] - p[0]);
    return v > 0.8 ? Math.min(25, v) : this.ref; // spans with no progress (intro, talking) fall back to the set speed
  }
  addAnchor(s) {
    const t = this.time(); if (!this.duration()) return false;
    this.anchors = this.anchors.filter(([at, as]) => Math.abs(at - t) > 4 && ((at < t && as < s) || (at > t && as > s)));
    this.anchors.push([t, s]); this.anchors.sort((p, q) => p[0] - q[0]);
    if (this.key) { const cfg = store.get('vid.' + this.key, {}); cfg.anchors = this.anchors; store.set('vid.' + this.key, cfg); }
    return true;
  }
  setSpeed(v) {
    const rate = v / this.filmedSpeed();
    if (this.kind === 'file') {
      const el = this.el; if (rate < 0.08) { if (!el.paused) el.pause(); return; }
      const r = Math.max(0.1, Math.min(4, rate)); if (Math.abs(r - this.lastRate) > 0.03) { el.playbackRate = r; this.lastRate = r; } if (el.paused) el.play().catch(() => {});
    } else if (this.yt && this.ready) {
      const st = this.yt.getPlayerState();
      if (rate < 0.15) { if (st === 1) this.yt.pauseVideo(); return; }
      const r = this.rates.reduce((a, b) => Math.abs(b - rate) < Math.abs(a - rate) ? b : a);
      if (r !== this.lastRate) { this.yt.setPlaybackRate(r); this.lastRate = r; }
      if (st !== 1 && st !== 3) this.yt.playVideo();
    }
  }
  progress() { const d = this.duration(); return d ? this.time() / d : null; }
  stop() { try { this.el && (this.el.pause(), this.el.removeAttribute('src'), this.el.load(), this.el.style.display = 'none'); } catch (e) {} try { this.yt?.destroy(); } catch (e) {} const h = document.getElementById('ytHost'); h.style.display = 'none'; h.innerHTML = '<div id="ytPlayer"></div>'; }
}
function loadYT(cb) {
  if (window.YT && YT.Player) return cb();
  (window._ytq = window._ytq || []).push(cb);
  if (!window._ytLoading) { window._ytLoading = 1; window.onYouTubeIframeAPIReady = () => window._ytq.splice(0).forEach(f => f()); const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s); }
}
// Video title → known climb, or stats in the title ("13.8 km at 8.1 %")
const CLIMB_KEYS = { alpe: [/alpe\s*d['’ ]?\s*huez/i, /\bl['’]alpe\b/i], ventoux: [/ventoux/i], stelvio: [/stelvio/i, /stilfser/i], tourmalet: [/tourmalet/i] };
const SIDE_WARN = { ventoux: [/malauc[eè]ne/i, /\bsault\b/i], stelvio: [/bormio/i, /umbrail/i], tourmalet: [/\bbar[eè]ges\b/i, /\bluz\b/i] };
function matchTitle(title) {
  const out = { title };
  for (const [id, res] of Object.entries({ ...CLIMB_KEYS, ...CLIMB_KEYS_EXTRA })) if (res.some(r => r.test(title))) { out.route = id; if ((SIDE_WARN[id] || []).some(r => r.test(title))) out.sideWarn = true; break; }
  const km = title.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*km\b/i), pc = title.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
  if (km) out.km = parseFloat(km[1].replace(',', '.')); if (pc) out.pct = parseFloat(pc[1].replace(',', '.'));
  return out;
}
async function fetchYtTitle(id) {
  const url = encodeURIComponent('https://www.youtube.com/watch?v=' + id);
  for (const u of ['https://www.youtube.com/oembed?format=json&url=' + url, 'https://noembed.com/embed?url=' + url]) {
    try { const r = await fetch(u); if (r.ok) { const j = await r.json(); if (j.title) return j.title; } } catch (e) {}
  }
  return new Promise((res) => { // fallback: hidden player
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-9999px;width:200px;height:120px'; const inner = document.createElement('div'); inner.id = 'ytProbe' + Date.now(); host.appendChild(inner); document.body.appendChild(host);
    const done = (t) => { try { p?.destroy(); } catch (e) {} host.remove(); res(t); }; let p; setTimeout(() => done(null), 8000);
    loadYT(() => { p = new YT.Player(inner.id, { videoId: id, playerVars: { mute: 1 }, events: { onReady: (e) => done(e.target.getVideoData?.().title || null) } }); });
  });
}

function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const pts = [...doc.querySelectorAll('trkpt, rtept')].map(p => ({ lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon'), e: +(p.querySelector('ele')?.textContent || 0) }));
  if (pts.length < 2) throw new Error('No track points in GPX');
  let d = 0; const out = [{ d: 0, e: pts[0].e, lat: pts[0].lat, lon: pts[0].lon }];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    d += 2 * R * Math.asin(Math.sqrt(h)); out.push({ d, e: b.e, lat: b.lat, lon: b.lon });
  }
  const name = doc.querySelector('trk > name, rte > name, metadata > name')?.textContent || 'GPX route';
  return { pts: out, name };
}
const ytId = (u) => { const m = String(u).match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/); return m ? m[1] : (/^[\w-]{11}$/.test(u) ? u : null); };

function toTCX(sum, rec, gpxPts) {
  const t0 = new Date(sum.date).getTime(); const iso = (t) => new Date(t0 + t * 1000).toISOString();
  let gi = 0;
  const pts = rec.map(r => {
    let pos = '';
    if (gpxPts) { while (gi < gpxPts.length - 2 && gpxPts[gi + 1].d < r.s) gi++; const g = gpxPts[gi]; pos = `<Position><LatitudeDegrees>${g.lat}</LatitudeDegrees><LongitudeDegrees>${g.lon}</LongitudeDegrees></Position>`; }
    return `<Trackpoint><Time>${iso(r.t)}</Time>${pos}<AltitudeMeters>${r.y}</AltitudeMeters><DistanceMeters>${r.s}</DistanceMeters>${r.hr ? `<HeartRateBpm><Value>${r.hr}</Value></HeartRateBpm>` : ''}<Cadence>${r.c}</Cadence><Extensions><ns3:TPX><ns3:Speed>${r.v}</ns3:Speed><ns3:Watts>${r.p}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Biking"><Id>${iso(0)}</Id><Lap StartTime="${iso(0)}"><TotalTimeSeconds>${sum.time}</TotalTimeSeconds><DistanceMeters>${sum.dist}</DistanceMeters><Calories>${sum.kcal}</Calories>${sum.avgHr ? `<AverageHeartRateBpm><Value>${sum.avgHr}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${sum.maxHr}</Value></MaximumHeartRateBpm>` : ''}<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod><Track>
${pts}
</Track></Lap><Notes>Ascent indoor ride: ${sum.workout || sum.route}</Notes></Activity></Activities></TrainingCenterDatabase>`;
}
