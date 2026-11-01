// ───────────────────────────── Start-up flow: bike → heart rate → resistance test → choose ride ─────────────────────────────
const Setup = {
  step: 0, result: null, running: false,
  open() { this.step = BLE.bike?.server?.connected ? 1 : 0; this.result = null; $('#setup').hidden = false; document.body.classList.add('insetup'); this.render(); this._l = () => this.live(); BLE.listeners.add(this._l); },
  close() { $('#setup').hidden = true; document.body.classList.remove('insetup'); BLE.listeners.delete(this._l); },
  go(n) { this.step = n; this.render(); },

  render() {
    const steps = ['Bike', 'Heart rate', 'Resistance', 'Ride'];
    const dots = steps.map((t, i) => `<li class="${i < this.step ? 'done' : i === this.step ? 'on' : ''}"><i>${i < this.step ? '✓' : i + 1}</i>${t}</li>`).join('');
    const b = $('#setupBody');
    $('#setupSteps').innerHTML = dots;
    if (this.step === 0) {
      const ok = BLE.bike?.server?.connected;
      b.innerHTML = `<div class="sIcon">🚲</div><h2>Connect your bike</h2>
        <p>Turn on the Toputure and pedal for a second to wake it up. Then tap below and choose <b>Toputure TBE5</b> (or <b>FS-…</b>). If a <b>Sport02</b> device shows up, ignore it.</p>
        ${BLE.supported ? `<button class="go" id="sBike">${ok ? '✓ ' + esc(BLE.bike.name) + ' connected' : 'Connect bike'}</button>` : `<div class="warn" style="margin:16px 0">This browser can't use Bluetooth. On iPad/iPhone use <b>Bluefy</b>. On a Mac use <b>Chrome</b>.</div>`}
        <button class="go ${ok ? '' : 'off'}" id="sNext" ${ok ? '' : 'disabled'}>Next: heart rate</button>
        <button class="lnk" id="sDemo">No bike here: try demo mode</button>`;
      $('#sBike') && ($('#sBike').onclick = async () => { await App.connectBike(); this.render(); });
      $('#sNext').onclick = () => this.go(1);
      $('#sDemo').onclick = () => { App.demoSession = true; this.go(3); };
    } else if (this.step === 1) {
      const live = BLE.hr.filter(h => h.bpm);
      b.innerHTML = `<div class="sIcon">❤️</div><h2>Connect heart rate</h2>
        <div class="hrHelp"><div><b>Whoop</b><span>Whoop app → Devices → <i>Heart Rate Broadcast</i> ON.</span></div><div><b>Apple Watch</b><span>Open <i>HeartCast</i> or <i>BlueHeart</i> on the watch and start broadcasting.</span></div></div>
        <div id="sHrList" class="hrList">${this.hrList()}</div>
        <button class="go sec2" id="sHr">${BLE.hr.length ? '+ Add another' : 'Connect Whoop / Apple Watch'}</button>
        <button class="go ${live.length ? '' : 'off'}" id="sNext" ${live.length ? '' : 'disabled'}>Next: test resistance</button>
        <button class="lnk" id="sSkip">Ride without heart rate</button>`;
      $('#sHr').onclick = async () => { await App.connectHR(); this.render(); };
      $('#sNext').onclick = () => this.go(2); $('#sSkip').onclick = () => this.go(2);
    } else if (this.step === 2) {
      const r = this.result;
      b.innerHTML = `<div class="sIcon">⚙️</div><h2>Resistance test</h2>
        <p>Pedal at an easy, steady pace. Ascent switches the bike between a <b>light</b> and a <b>heavy</b> level and checks that it really changes. It takes about 15 seconds.</p>
        <div class="tLive"><div><b id="tCadL">0</b><small>RPM</small></div><div><b id="tPowL">0</b><small>WATTS</small></div><div><b id="tLvlL">–</b><small>BIKE LEVEL</small></div></div>
        <div class="tBar"><i id="tProg"></i></div><p class="tMsg" id="tMsg">${r ? r.msg : 'Start pedalling, then tap Start test.'}</p>
        ${!r || r.state === 'fail' ? `<button class="go" id="sTest" ${this.running ? 'disabled' : ''}>${r ? 'Try again' : 'Start test'}</button>` : ''}
        ${r && r.state === 'ok' ? `<div class="row"><button class="go sec2" id="sNo">I didn't feel it</button><button class="go" id="sYes">Felt it: continue</button></div>` : ''}
        ${r && r.state === 'fail' ? `<button class="lnk" id="sAnyway">Continue anyway (resistance may not change)</button><button class="lnk" id="sLog">Copy Bluetooth log</button>` : ''}`;
      $('#sTest') && ($('#sTest').onclick = () => this.runTest());
      $('#sYes') && ($('#sYes').onclick = () => { store.set('lastTest', { t: Date.now(), ok: true, protocol: BLE.bike?.protocol, table: Settings.get().fsTable }); this.go(3); });
      $('#sNo') && ($('#sNo').onclick = () => { this.nextMethod(); this.runTest(); });
      $('#sAnyway') && ($('#sAnyway').onclick = () => this.go(3));
      $('#sLog') && ($('#sLog').onclick = () => { navigator.clipboard?.writeText(BLE.log.join('\n')); toast('Log copied. Paste it to Claude.'); });
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
  hrList() { return BLE.hr.map(h => `<div class="hrRow ${h.bpm ? 'ok' : ''}"><span>${esc(h.name)}</span><b>${h.bpm || '…'}</b><small>${h.bpm ? 'bpm' : 'waiting for signal'}</small></div>`).join('') || '<p class="note">No heart-rate device connected yet.</p>'; },
  live() {
    if ($('#setup').hidden) return;
    if (this.step === 0 || this.step === 1) { const el = $('#sHrList'); if (el) el.innerHTML = this.hrList(); const n = $('#sNext'); if (this.step === 1 && n && BLE.hr.some(h => h.bpm)) { n.disabled = false; n.classList.remove('off'); } return; }
    if (this.step === 2) { const d = BLE.data, fresh = performance.now() - d.t < 3500; $('#tCadL') && ($('#tCadL').textContent = fresh ? Math.round(d.cadence) : 0, $('#tPowL').textContent = fresh ? Math.round(d.power) : 0, $('#tLvlL').textContent = d.level || '–'); }
  },

  methods() { const b = BLE.bike, m = []; if (b?.fsWrite) m.push(['fitshow', 'kinomap'], ['fitshow', 'clean']); if (b?.ftmsCp) m.push(['ftms-level', 'kinomap']); return m; },
  applyMethod([proto, table]) { Settings.set({ protocol: proto, fsTable: table }); if (BLE.bike) { BLE.bike.protocol = proto; if (proto.startsWith('ftms')) BLE.ftmsWrite([0x00]); } },
  nextMethod() { const m = this.methods(), cur = m.findIndex(([p, t]) => p === BLE.bike?.protocol && (p !== 'fitshow' || t === Settings.get().fsTable)); const nx = m[cur + 1]; if (nx) { this.applyMethod(nx); return true; } return false; },

  async runTest() {
    if (this.running) return; if (!BLE.bike?.server?.connected) { toast('Bike not connected', 'err'); return this.go(0); }
    this.running = true; this.result = { state: 'run', msg: 'Pedal steadily…' }; this.render();
    const msg = (t) => { const el = $('#tMsg'); if (el) el.textContent = t; }, prog = (f) => { const el = $('#tProg'); if (el) el.style.width = (f * 100) + '%'; };
    // wait for pedalling
    let w = 0; while (performance.now() - BLE.data.t > 3500 || BLE.data.cadence < 35) { msg('Start pedalling (above 40 rpm)…'); await wait(500); if (++w > 60) { this.running = false; this.result = { state: 'fail', msg: 'No pedalling detected from the bike. Check that it is awake and connected.' }; return this.render(); } }
    const S = Settings.get(), lo = Math.max(1, Math.round(S.maxLevel * 0.12)), hi = Math.round(S.maxLevel * 0.62);
    const sample = async (level, label, f0) => {
      BLE.setLevel(level, true); const out = []; const t0 = performance.now();
      while (performance.now() - t0 < 6000) { await wait(250); prog(f0 + (performance.now() - t0) / 6000 * 0.45); msg(`${label}: level ${level}…`); if (performance.now() - t0 > 2500) { const d = BLE.data; if (d.cadence > 20) out.push({ p: d.power, c: d.cadence, l: d.level }); } if (performance.now() - t0 > 2000 && performance.now() - t0 < 2300) BLE.setLevel(level, true); }
      const n = out.length || 1; return { p: out.reduce((a, x) => a + x.p, 0) / n, c: out.reduce((a, x) => a + x.c, 0) / n, l: out.length ? out[out.length - 1].l : 0, n: out.length };
    };
    const A = await sample(lo, 'Light', 0), B = await sample(hi, 'Heavy', 0.45);
    BLE.setLevel(S.flatLevel, true); prog(1);
    const levelEcho = B.l && Math.abs(B.l - hi) <= 1 && Math.abs(A.l - lo) <= 1;
    const perRev = (x) => x.c > 0 ? x.p / x.c : 0, ratio = perRev(A) > 0 ? perRev(B) / perRev(A) : 0;
    BLE.addLog('··', `test ${BLE.bike.protocol}/${S.fsTable}: A L${lo}→bike ${A.l} ${A.p.toFixed(0)}W@${A.c.toFixed(0)} | B L${hi}→bike ${B.l} ${B.p.toFixed(0)}W@${B.c.toFixed(0)} | ratio ${ratio.toFixed(2)}`);
    this.running = false;
    if (levelEcho || ratio > 1.25) {
      this.result = { state: 'ok', msg: `✓ Resistance works (${BLE.bike.protocol === 'fitshow' ? 'FitShow' : 'FTMS'}${BLE.bike.protocol === 'fitshow' ? ' · ' + S.fsTable : ''}). ${levelEcho ? `The bike confirmed level ${lo} → ${hi}.` : `Watts per pedal stroke rose ×${ratio.toFixed(1)}.`} Did it feel heavier?` };
    } else if (this.nextMethod()) {
      this.result = null; msg('No change detected. Trying the next method…'); await wait(800); return this.runTest();
    } else {
      this.result = { state: 'fail', msg: 'Ascent couldn’t confirm a resistance change with any method. Copy the Bluetooth log and send it to Claude, or continue anyway.' };
    }
    this.render();
  }
};
