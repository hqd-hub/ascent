// ───────────────────────────── Start-up flow: bike → heart rate → resistance test → choose ride ─────────────────────────────
const Setup = {
  step: 0, result: null, running: false,
  open() { this.step = -1; this.adding = !Users.list().length; this.result = null; $('#setup').hidden = false; document.body.classList.add('insetup'); this.render(); this._l = () => this.live(); BLE.listeners.add(this._l); },
  close() { $('#setup').hidden = true; document.body.classList.remove('insetup'); BLE.listeners.delete(this._l); },
  go(n) { this.step = n; this.render(); },

  render() {
    const steps = ['Rider', 'Bike', 'Heart rate', 'Resistance', 'Ride'];
    const dots = steps.map((t, j) => { const i = j - 1; return `<li class="${i < this.step ? 'done' : i === this.step ? 'on' : ''}"><i>${i < this.step ? '✓' : j + 1}</i>${t}</li>`; }).join('');
    const b = $('#setupBody');
    $('#setupSteps').innerHTML = dots;
    if (this.step === -1) { this.renderRiders(b); } else if (this.step === 0) {
      const ok = BLE.bike?.server?.connected, mods = BLE.links;
      b.innerHTML = `<div class="sIcon">🚲</div><h2>Connect your bike</h2>
        <p>Pedal for a second to wake the bike, then tap <b>Connect bike</b> and choose <b>Sport02-…</b>. That's your bike's main module, and the bike's display shows when it's connected. If <b>Toputure TEB5</b> also appears, you can add it as a second device, but it isn't required.</p>
        ${mods.length ? `<div class="hrList" style="margin:12px 0">${mods.map(l => `<div class="hrRow ${l.server?.connected ? 'ok' : ''}"><span>${esc(l.name)}</span><small style="width:auto">${[l.fsWrite ? 'FitShow' : '', l.ftmsCp ? 'FTMS' : ''].filter(Boolean).join(' + ') || 'no bike services'}${l.server?.connected ? '' : ' · reconnecting…'}</small></div>`).join('')}</div>` : ''}
        ${BLE.supported ? `<button class="go ${ok ? 'sec2' : ''}" id="sBike">${ok ? '+ Add another device (optional)' : 'Connect bike'}</button>` : `<div class="warn" style="margin:16px 0">This browser can't use Bluetooth. On iPad/iPhone use <b>Bluefy</b>. On a Mac use <b>Chrome</b>.</div>`}
        <div class="warn" id="sAvail" hidden style="margin:12px 0;text-align:left">This device reports Bluetooth as <b>off or not allowed</b>. Turn Bluetooth on. On a Mac, allow Chrome under System Settings → Privacy & Security → Bluetooth. On iPad, allow Bluefy under Settings → Bluefy.</div>
        ${this.bikeErr ? `<div class="warn" style="margin:12px 0;text-align:left">${esc(this.bikeErr)}</div>` : ''}
        ${BLE.supported ? `<button class="lnk" id="sAll">Show all Bluetooth devices</button>` : ''}
        <button class="go ${ok ? '' : 'off'}" id="sNext" ${ok ? '' : 'disabled'}>Next: heart rate</button>
        <button class="lnk" id="sDemo">No bike here: try demo mode</button>`;
      const doConnect = async (all) => { const btn = $('#sBike'); if (btn) { btn.disabled = true; btn.textContent = 'Opening Bluetooth…'; } this.bikeErr = await App.connectBike(all, true); this.render(); };
      $('#sBike') && ($('#sBike').onclick = () => doConnect(false));
      $('#sAll') && ($('#sAll').onclick = () => doConnect(true));
      if (navigator.bluetooth?.getAvailability) navigator.bluetooth.getAvailability().then(ok => { if (!ok && $('#sAvail')) $('#sAvail').hidden = false; }).catch(() => {});
      $('#sNext').onclick = () => { this.bikeErr = null; this.go(1); };
      $('#sDemo').onclick = () => { App.demoSession = true; this.go(3); };
    } else if (this.step === 1) {
      const live = BLE.hr.filter(h => h.bpm);
      b.innerHTML = `<div class="sIcon">❤️</div><h2>Connect heart rate</h2>
        <div class="hrHelp"><div><b>Whoop</b><span>Whoop app → Devices → <i>Heart Rate Broadcast</i> ON.</span></div><div><b>Apple Watch</b><span>Open <i>HeartCast</i> or <i>BlueHeart</i> on the watch and start broadcasting.</span></div></div>
        ${Settings.get().hrPrimary ? `<p class="note" style="margin:0 0 6px">${esc(Users.current()?.name || '')}'s heart-rate device: <b>${esc(Settings.get().hrPrimary)}</b>. It's used first when several are connected.</p>` : ''}
        <div id="sHrList" class="hrList">${this.hrList()}</div>
        <button class="go sec2" id="sHr">${BLE.hr.length ? '+ Add another' : 'Connect Whoop / Apple Watch'}</button>
        <button class="go ${live.length ? '' : 'off'}" id="sNext" ${live.length ? '' : 'disabled'}>Next: test resistance</button>
        <button class="lnk" id="sSkip">Ride without heart rate</button>`;
      $('#sHr').onclick = async () => { const h = await App.connectHR(); if (h && !Settings.get().hrPrimary) Settings.set({ hrPrimary: h.name }); this.render(); };
      $('#sNext').onclick = () => this.go(2); $('#sSkip').onclick = () => this.go(2);
    } else if (this.step === 2) {
      const r = this.result, m = this.methods(), mi = this.methodIndex();
      b.innerHTML = `<div class="sIcon">⚙️</div><h2>Resistance test</h2>
        <p>Pedal at an easy, steady pace. Ascent sets the bike <b>light</b> for 5 seconds, then <b>heavy</b> for 6 seconds. You tell it whether you felt the change.</p>
        <div class="tLive"><div><b id="tCadL">0</b><small>RPM</small></div><div><b id="tPhase">–</b><small>NOW</small></div><div><b id="tLvlL">–</b><small>SENT → BIKE SAYS</small></div></div>
        <div class="tBar"><i id="tProg"></i></div>
        <p class="note" style="margin-top:8px">Method ${mi + 1} of ${m.length}: <b>${esc(this.methodLabel(m[mi]))}</b> → ${esc(BLE.links.filter(l => (m[mi] || [''])[0] === 'fitshow' ? l.fsWrite : l.ftmsCp).map(l => l.name).join(', ') || '–')}</p>
        <p class="tMsg" id="tMsg">${r ? r.msg : 'Start pedalling, then tap Start test.'}</p>
        ${!r || r.state === 'fail' ? `<button class="go" id="sTest" ${this.running ? 'disabled' : ''}>${r ? 'Start again from method 1' : 'Start test'}</button>` : ''}
        ${r && r.state === 'ask' ? `<div class="row"><button class="go sec2" id="sNo">No change: try next method</button><button class="go" id="sYes">Yes, it got heavier</button></div><button class="lnk" id="sAgain">Run this method again</button>` : ''}
        ${r && r.state === 'ok' ? `<button class="go" id="sYes">Continue</button>` : ''}
        ${r && r.state === 'fail' ? `<button class="lnk" id="sAnyway">Continue anyway (resistance won't change)</button>` : ''}
        <button class="lnk" id="sLog">Copy Bluetooth log</button>`;
      $('#sTest') && ($('#sTest').onclick = () => { this.applyMethod(m[0]); this.runTest(); });
      $('#sAgain') && ($('#sAgain').onclick = () => this.runTest());
      $('#sYes') && ($('#sYes').onclick = () => this.confirmWorks());
      $('#sNo') && ($('#sNo').onclick = () => { if (this.nextMethod()) this.runTest(); else { this.result = { state: 'fail', msg: 'None of the methods changed the resistance. Check that Sport02 is connected (step 2), then copy the Bluetooth log and send it to Claude.' }; this.render(); } });
      $('#sAnyway') && ($('#sAnyway').onclick = () => this.go(3));
      $('#sLog').onclick = () => { navigator.clipboard?.writeText(BLE.log.join('\n')); toast('Log copied. Paste it to Claude.'); };
      this.live();
    } else {
      const S = Settings.get();
      b.innerHTML = `<div class="sIcon">🏁</div><h2>What are you riding today?</h2>${App.demoSession ? '<p class="note" style="margin-top:0">Demo mode: power comes from a slider, not the bike.</p>' : ''}
        <div class="choose">
          <button data-c="video"><span>▶</span><b>Video ride</b><small>Follow a YouTube climb. The resistance follows the gradient in the video.</small></button>
          <button data-c="routes"><span>⛰</span><b>Virtual route</b><small>3D climbs, worlds and tours, with pace partners and PR ghosts.</small></button>
          <button data-c="workouts"><span>📈</span><b>Workout / intervals</b><small>Structured sessions on a focus screen, no video needed. FTP ${S.ftp} W.</small></button>
          <button data-c="free"><span>🚴</span><b>Just ride</b><small>No plan. Set the resistance yourself with + and −. Time, watts and heart rate are recorded.</small></button>
        </div>`;
      $$('[data-c]', b).forEach(el => el.onclick = () => { const c = el.dataset.c; this.close(); if (c === 'free') App.freeRide(); else App.show(c); });
    }
  },
  renderRiders(b) {
    const users = Users.list(), S = Settings.get();
    if (this.adding) {
      b.innerHTML = `<div class="sIcon">👤</div><h2>${users.length ? 'Add a rider' : 'Who are you?'}</h2><p>Each rider keeps their own settings, rides, PRs and badges.</p>
        <div class="form rForm">
          <label>Name<input id="nName" type="text" placeholder="e.g. Hasse" autocomplete="off"></label>
          <div class="row2"><label>Weight (kg)<input id="nW" type="number" min="30" max="160" placeholder="kg"></label><label>FTP (W)<input id="nF" type="number" min="50" max="500" placeholder="Don't know? Leave blank"></label></div>
          <div class="row2"><label>Max heart rate<input id="nH" type="number" min="120" max="220" placeholder="Blank = 185"></label><label>Preferred screen<select id="nV"><option value="3d">3D world</option><option value="data">Data screen</option></select></label></div>
          <label>Trainer difficulty <output id="nDV">60 %</output><input type="range" id="nD" min="20" max="100" step="5" value="60"><small>How much of a climb's real gradient you feel. Lower is gentler.</small></label>
          <small class="note" style="margin:0">No FTP? Ascent starts at an estimate (2.2 W/kg). Do the FTP Ramp Test workout to set it properly.</small>
        </div>
        <button class="go" id="nSave">Save rider</button>${users.length ? '<button class="lnk" id="nCancel">Cancel</button>' : ''}`;
      $('#nD').oninput = (e) => $('#nDV').textContent = e.target.value + ' %';
      $('#nCancel') && ($('#nCancel').onclick = () => { this.adding = false; this.render(); });
      $('#nSave').onclick = () => {
        const name = $('#nName').value.trim(); if (!name) return toast('Enter a name', 'err');
        const weight = +$('#nW').value || 75; const ftp = +$('#nF').value || Math.round(weight * 2.2 / 5) * 5;
        Users.create({ name, weight, ftp, maxHr: +$('#nH').value || 185, screen: $('#nV').value, difficulty: +$('#nD').value });
        store.set('screen', $('#nV').value); this.adding = false; App.onUserChange(); toast('Welcome, ' + name); this.go(BLE.bike?.server?.connected ? 1 : 0);
      };
      return;
    }
    b.innerHTML = `<div class="sIcon">👥</div><h2>Who's riding?</h2><p>Your settings, rides and PRs are loaded for you.</p>
      <div class="riders">${users.map(u => { const s = (() => { try { return JSON.parse(localStorage.getItem('ascent.u.' + u.id + '.settings')) || {}; } catch (e) { return {}; } })(); return `<button class="rider ${u.id === Users.current()?.id ? 'cur' : ''}" data-u="${u.id}"><i style="background:${u.color}">${esc(u.name.slice(0, 1).toUpperCase())}</i><b>${esc(u.name)}</b><small>${s.ftp ? s.ftp + ' W FTP' : ''}${s.weight ? ' · ' + s.weight + ' kg' : ''}</small></button>`; }).join('')}
        <button class="rider add" id="rAdd"><i>+</i><b>Add rider</b><small>New profile</small></button></div>`;
    $$('[data-u]', b).forEach(el => el.onclick = () => { Users.use(el.dataset.u); App.onUserChange(); this.go(BLE.bike?.server?.connected ? (BLE.hr.some(h => h.bpm) ? 2 : 1) : 0); });
    $('#rAdd').onclick = () => { this.adding = true; this.render(); };
  },
  hrList() { return BLE.hr.map(h => `<div class="hrRow ${h.bpm ? 'ok' : ''}"><span>${esc(h.name)}</span><b>${h.bpm || '…'}</b><small>${h.bpm ? 'bpm' : 'waiting for signal'}</small></div>`).join('') || '<p class="note">No heart-rate device connected yet.</p>'; },
  live() {
    if ($('#setup').hidden) return;
    if (this.step === 0 || this.step === 1) { const el = $('#sHrList'); if (el) el.innerHTML = this.hrList(); const n = $('#sNext'); if (this.step === 1 && n && BLE.hr.some(h => h.bpm)) { n.disabled = false; n.classList.remove('off'); } return; }
    if (this.step === 2) { const d = BLE.data, fresh = performance.now() - d.t < 3500; $('#tCadL') && ($('#tCadL').textContent = fresh ? Math.round(d.cadence) : 0, $('#tLvlL').textContent = (BLE.bike?.protocol === 'ftms-sim' ? (this.phase === 'HEAVY' ? '12%' : '0%') : (this.testLevel || '–')) + ' → ' + (d.level || '–'), $('#tPhase').textContent = this.phase || '–'); }
  },

  methods() { const b = BLE.bike, m = []; if (b?.ftmsCp) m.push(['ftms-sim', 'kinomap'], ['ftms-level', 'kinomap'], ['ftms-level10', 'kinomap']); if (BLE.links.some(l => l.fsWrite && !l.aa)) m.push(['fitshow', 'kinomap'], ['fitshow', 'clean']); return m; },
  methodLabel(x) { return !x ? '–' : x[0] === 'fitshow' ? 'FitShow, ' + (x[1] === 'clean' ? 'clean table' : 'Kinomap table') : x[0] === 'ftms-level' ? 'FTMS resistance level' : x[0] === 'ftms-level10' ? 'FTMS resistance level (×10 format)' : 'FTMS gradient simulation (like Zwift)'; },
  methodIndex() { const m = this.methods(), p = BLE.bike?.protocol, t = Settings.get().fsTable; const i = m.findIndex(([a, b]) => a === p && (a !== 'fitshow' || b === t)); return Math.max(0, i); },
  applyMethod(x) { if (!x) return; Settings.set({ protocol: x[0], fsTable: x[1] }); if (BLE.bike) BLE.bike.protocol = x[0]; if (x[0].startsWith('ftms') && !BLE.hasControl) BLE.takeControl(); },
  nextMethod() { const m = this.methods(), nx = m[this.methodIndex() + 1]; if (nx) { this.applyMethod(nx); return true; } return false; },
  sendTest(level, grade) { this.testLevel = level; if (BLE.bike?.protocol === 'ftms-sim') { BLE.lastSendT = 0; BLE.setSimGrade(grade); } else BLE.setLevel(level, true); },

  async runTest() {
    if (this.running) return; if (!BLE.bike?.server?.connected) { toast('Bike not connected', 'err'); return this.go(0); }
    this.running = true; this.result = { state: 'run', msg: 'Pedal steadily…' }; this.render();
    const raw = Settings.get().rawLog; Settings.set({ rawLog: true });
    const msg = (t) => { const el = $('#tMsg'); if (el) el.textContent = t; }, prog = (f) => { const el = $('#tProg'); if (el) el.style.width = (f * 100) + '%'; };
    let w = 0; while (performance.now() - BLE.data.t > 3500 || BLE.data.cadence < 30) { msg('Start pedalling (above 40 rpm)…'); this.phase = '…'; await wait(500); if (++w > 60) { this.running = false; Settings.set({ rawLog: raw }); this.result = { state: 'fail', msg: 'The bike isn\u2019t sending cadence. Check that Sport02 is connected and pedal a bit faster.' }; return this.render(); } }
    const S = Settings.get(), lo = Math.max(1, Math.round(S.maxLevel * 0.1)), hi = Math.round(S.maxLevel * 0.75);
    const phase = async (level, grade, label, secs, f0, f1) => {
      this.phase = label; this.sendTest(level, grade); const out = [], t0 = performance.now();
      while (performance.now() - t0 < secs * 1000) { await wait(250); const f = (performance.now() - t0) / (secs * 1000); prog(f0 + (f1 - f0) * f); msg(`${label}: ${BLE.bike?.protocol === 'ftms-sim' ? grade + ' % gradient' : 'level ' + level}. Pedal steadily.`); if (f > 0.4) { const d = BLE.data; if (d.cadence > 20) out.push({ p: d.power, c: d.cadence, l: d.level }); } if (Math.abs(f - 0.35) < 0.03) this.sendTest(level, grade); }
      const n = out.length || 1; return { p: out.reduce((a, x) => a + x.p, 0) / n, c: out.reduce((a, x) => a + x.c, 0) / n, l: out.length ? out[out.length - 1].l : 0 };
    };
    if ((BLE.bike?.protocol || '').startsWith('ftms') && !BLE.hasControl) { msg('Asking the bike for control…'); await BLE.takeControl(); }
    const A = await phase(lo, 0, 'LIGHT', 5, 0, 0.45), B = await phase(hi, 12, 'HEAVY', 6, 0.45, 1);
    this.sendTest(S.flatLevel, 0); this.phase = 'done'; prog(1); Settings.set({ rawLog: raw });
    const levelEcho = B.l && A.l && (B.l - A.l >= 2);
    const ratio = A.c > 0 && A.p > 0 ? (B.p / B.c) / (A.p / A.c) : 0; this.lastRatio = ratio;
    BLE.addLog('··', `test ${this.methodLabel([BLE.bike.protocol, Settings.get().fsTable])}: L${lo} ${A.p.toFixed(0)}W@${A.c.toFixed(0)} bike L${A.l} | L${hi} ${B.p.toFixed(0)}W@${B.c.toFixed(0)} bike L${B.l} | watts/rev ratio ${ratio.toFixed(2)}`);
    this.running = false;
    this.result = levelEcho ? { state: 'ok', msg: `✓ The bike reported its resistance going from ${A.l} to ${B.l}.` }
      : { state: 'ask', msg: 'Did the pedals get noticeably heavier in the HEAVY phase?' };
    this.render();
  },
  confirmWorks() {
    const S = Settings.get(); let note = '';
    if (this.lastRatio && this.lastRatio > 0.85 && this.lastRatio < 1.15) { Settings.set({ powerSource: 'estimate' }); note = ' Your bike\u2019s watt reading ignores resistance, so Ascent now estimates watts from cadence and level.'; }
    else if (this.lastRatio >= 1.15) Settings.set({ powerSource: 'bike' });
    store.set('lastTest', { t: Date.now(), ok: true, protocol: BLE.bike?.protocol, table: S.fsTable });
    BLE.addLog('··', 'resistance confirmed by rider: ' + this.methodLabel([BLE.bike?.protocol, S.fsTable]) + (note ? ' · power: estimate' : ''));
    toast('Resistance method saved.' + note); this.go(3);
  }
};
