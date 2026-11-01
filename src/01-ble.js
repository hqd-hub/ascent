// ───────────────────────────── Bluetooth: bike + heart rate ─────────────────────────────
// Toputure TBE5/TEB5 advertises FTMS (0x1826) + FitShow proprietary (0xFFF0: FFF1 notify, FFF2 write).
// Resistance via FTMS on this bike is reported as erratic (qdomyos-zwift PR #5354), so the default
// control path is the FitShow 02 44 05 <level> <b4> <xor> 03 packet on FFF2 — the same family Kinomap uses.

// Full 128-bit UUID strings: Bluefy (iPad/iPhone) rejects the short numeric/name forms that Chrome accepts.
const U = (n) => '0000' + n.toString(16).padStart(4, '0') + '-0000-1000-8000-00805f9b34fb';
const FITSHOW_SVC = U(0xfff0), FITSHOW_NOTIFY = U(0xfff1), FITSHOW_WRITE = U(0xfff2);
const FTMS_SVC = U(0x1826), FTMS_BIKE_DATA = U(0x2ad2), FTMS_CP = U(0x2ad9), FTMS_STATUS = U(0x2ada);
const CPS_SVC = U(0x1818), CPS_MEAS = U(0x2a63), CSC_SVC = U(0x1816), HR_SVC = U(0x180d), HR_MEAS = U(0x2a37);
const errText = (e) => { if (e == null) return 'unknown error'; if (typeof e !== 'object') return String(e); const s = (e.name ? e.name + ': ' : '') + (e.message || e.code || ''); return s || JSON.stringify(e) || 'unknown error'; };
const isCancel = (e) => /cancel/i.test(String(e && e.message || e));

// Byte 4 of the VirtuFit/FitShow 32-level table (verbatim from qdomyos-zwift fitplusbike::forceResistance)
const FITSHOW_B4 = [0xf9,0xf9,0xfa,0xfb,0xfc,0xfd,0xfe,0xff,0x00,0x00,0x01,0x03,0x03,0x05,0x05,0x06,
                    0x07,0x08,0x09,0x0a,0x0b,0x0c,0x0d,0x0e,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00];

function fitshowPacket(level, table) {
  level = Math.max(1, Math.min(32, Math.round(level)));
  const b4 = table === 'clean' ? 0x00 : FITSHOW_B4[level - 1];
  const xor = 0x44 ^ 0x05 ^ level ^ b4;
  return new Uint8Array([0x02, 0x44, 0x05, level, b4, xor & 0xff, 0x03]);
}
const b_hasService = (b) => !!(b && (b.fsWrite || b.ftmsCp || b.protocol !== 'none'));
const hex = (u8) => Array.from(u8, b => b.toString(16).padStart(2, '0')).join(' ');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const BLE = {
  supported: typeof navigator !== 'undefined' && !!navigator.bluetooth,
  log: [],
  listeners: new Set(),
  bike: null,      // {device, server, fsWrite, ftmsCp, protocol, name}
  hr: [],          // [{device, name, bpm, t}]
  data: { power: 0, cadence: 0, speed: 0, level: 0, t: 0, src: '' },
  lastLevelSent: 0, lastSendT: 0, pendingLevel: null,

  emit() { this.listeners.forEach(f => { try { f(); } catch (e) {} }); },
  addLog(dir, msg) {
    const line = `${new Date().toLocaleTimeString()} ${dir} ${msg}`;
    this.log.push(line); if (this.log.length > 300) this.log.shift();
    const el = document.getElementById('bleLog'); if (el && el.offsetParent) { el.textContent = this.log.slice(-120).join('\n'); el.scrollTop = 1e9; }
  },

  // The Toputure shows up as TWO peripherals ("Toputure TEB5" with FitShow only, "Sport02-xxxx" with FitShow + FTMS).
  // Ascent can hold several "links" at once: data is read from all of them and resistance is sent to every one that accepts it.
  links: [],
  facade() {
    const self = this;
    if (!this.bike) this.bike = { protocol: 'none',
      get name() { return self.links.map(l => l.name).join(' + ') || 'Bike'; },
      get device() { return self.links[0]?.device; },
      server: { get connected() { return self.links.some(l => l.server?.connected); } },
      get fsWrite() { return self.links.some(l => l.fsWrite); },
      get ftmsCp() { return self.links.some(l => l.ftmsCp); } };
    return this.bike;
  },
  async connectBike(showAll) {
    if (!this.supported) throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge on Mac/Windows/Android, or the Bluefy browser on iPad/iPhone.');
    const optionalServices = [FTMS_SVC, FITSHOW_SVC, CPS_SVC, CSC_SVC];
    let device;
    this.addLog('··', 'opening Bluetooth chooser' + (showAll ? ' (all devices)' : '') + ' · ' + navigator.userAgent.slice(0, 80));
    const tries = showAll ? [{ acceptAllDevices: true, optionalServices }] : [
      { filters: [{ services: [FTMS_SVC] }, { services: [FITSHOW_SVC] }, { namePrefix: 'Toputure' }, { namePrefix: 'FS-' }, { namePrefix: 'TBE' }, { namePrefix: 'TEB' }, { namePrefix: 'Sport' }], optionalServices },
      { filters: [{ namePrefix: 'Toputure' }, { namePrefix: 'FS-' }, { namePrefix: 'TBE' }, { namePrefix: 'TEB' }, { namePrefix: 'Sport' }], optionalServices },
      { acceptAllDevices: true, optionalServices }, { acceptAllDevices: true }];
    let lastErr;
    for (const opt of tries) {
      try { device = await navigator.bluetooth.requestDevice(opt); break; }
      catch (e) { lastErr = e; this.addLog('!!', 'chooser failed (' + (opt.acceptAllDevices ? 'all' : 'filtered') + '): ' + errText(e)); if (isCancel(e) || e.name === 'NotFoundError') throw e; }
    }
    if (!device) throw lastErr;
    let L = this.links.find(l => l.device.id === device.id);
    if (!L) { L = { device, name: (device.name || 'Bike').trim() }; this.links.push(L); device.addEventListener('gattserverdisconnected', () => this.onLinkDisconnect(L)); }
    this.facade();
    try { await this.setupLink(L); }
    catch (e) { this.addLog('!!', 'setup failed: ' + errText(e)); this.links = this.links.filter(x => x !== L); try { device.gatt.disconnect(); } catch (x) {} if (!this.links.length) this.bike = null; this.emit(); throw new Error('Found "' + (device.name || 'device') + '" but couldn\u2019t connect: ' + (e.message || e)); }
    return this.bike;
  },

  // One GATT operation at a time: Bluefy (iOS) fails overlapping writes with a bare error ("2").
  _q: Promise.resolve(),
  gatt(fn) { const run = this._q.then(fn, fn); this._q = run.catch(() => {}); return run; },

  async setupLink(L) {
    L.server = await L.device.gatt.connect();
    this.addLog('··', `connected to ${L.name}`);
    L.aa = false; L.fsClassic = false;
    // FTMS first (standard; this is what Zwift uses)
    try {
      const svc = await L.server.getPrimaryService(FTMS_SVC);
      const d = await svc.getCharacteristic(FTMS_BIKE_DATA);
      d.addEventListener('characteristicvaluechanged', e => this.onFtms(e.target.value, L));
      await d.startNotifications();
      try {
        L.ftmsCp = await svc.getCharacteristic(FTMS_CP);
        L.ftmsCp.addEventListener('characteristicvaluechanged', e => this.onCp(new Uint8Array(e.target.value.buffer), L));
        await L.ftmsCp.startNotifications(); await wait(400);
      } catch (e) { L.ftmsCp = null; this.addLog('··', L.name + ': FTMS control point unavailable (' + errText(e) + ')'); }
      this.addLog('··', L.name + ': FTMS 1826 found');
    } catch (e) { this.addLog('··', L.name + ': no FTMS service'); }
    // FitShow channel: listen first; only speak the 02…03 FitShow protocol if the bike talks it
    try {
      const svc = await L.server.getPrimaryService(FITSHOW_SVC);
      L.fsWrite = await svc.getCharacteristic(FITSHOW_WRITE);
      const n = await svc.getCharacteristic(FITSHOW_NOTIFY);
      n.addEventListener('characteristicvaluechanged', e => this.onFitShow(new Uint8Array(e.target.value.buffer), L));
      await n.startNotifications();
      this.addLog('··', L.name + ': FFF0 channel found');
      await wait(1500);
      if (L.aa) this.addLog('··', L.name + ': FFF1 speaks the "aa…aa" protocol, not FitShow 02…03. FitShow commands disabled for this device.');
      else if (!L.ftmsCp) { L.fsClassic = true; await this.fitshowInit(L); }
      else this.addLog('··', L.name + ': FFF1 silent; FitShow kept as fallback');
    } catch (e) { L.fsWrite = null; this.addLog('··', L.name + ': no FitShow service'); }
    await this.chooseProtocol();
    clearInterval(this._poll);
    let k = 0;
    this._poll = setInterval(() => { // classic FitShow bikes only stream data while polled
      const pkt = new Uint8Array((k++ % 2) ? [0x02, 0x43, 0x01, 0x42, 0x03] : [0x02, 0x42, 0x42, 0x03]);
      for (const l of this.links) if (l.fsClassic && l.fsWrite && l.server?.connected) this.fsWriteTo(l, pkt, true);
    }, 1000);
    this.lastLevelSent = 0;
    this.emit();
  },
  async chooseProtocol() {
    const b = this.facade(), pref = Settings.get().protocol, fsOk = this.links.some(l => l.fsWrite && !l.aa);
    if (pref === 'fitshow' && fsOk) b.protocol = 'fitshow';
    else if (pref.startsWith('ftms') && b.ftmsCp) b.protocol = pref;
    else if (pref === 'none') b.protocol = 'none';
    else b.protocol = b.ftmsCp ? 'ftms-sim' : (fsOk ? 'fitshow' : 'none');
    if (b.protocol.startsWith('ftms')) await this.takeControl();
    this.addLog('··', 'resistance control: ' + b.protocol + ' → ' + this.links.filter(l => b.protocol === 'fitshow' ? (l.fsWrite && !l.aa) : l.ftmsCp).map(l => l.name).join(', '));
  },
  // FTMS handshake like Zwift: Request Control (0x00) → wait for 80 00 01 → Start/Resume (0x07)
  async takeControl() {
    for (let a = 0; a < 3; a++) {
      const r = await this.ftmsCmd([0x00]);
      if (r === 1) { await this.ftmsCmd([0x07]); this.hasControl = true; return true; }
      await wait(800);
    }
    this.hasControl = false; this.addLog('!!', 'FTMS: the bike did not grant control');
    return false;
  },
  onCp(u8, L) {
    const RES = { 1: 'OK', 2: 'not supported', 3: 'invalid parameter', 4: 'failed', 5: 'control not permitted' };
    if (u8[0] === 0x80) { this.addLog('<<', `${L.name} CP reply to 0x${u8[1].toString(16).padStart(2, '0')}: ${RES[u8[2]] || u8[2]}`); if (L.cpWait) { L.cpWait(u8[2]); L.cpWait = null; } }
    else this.addLog('<<', L.name + ' CP ' + hex(u8));
  },
  // Send one control-point command to every FTMS link; resolves with the bike's result code (1 = OK) or 0 (no reply)
  async ftmsCmd(arr, quiet) {
    const u8 = new Uint8Array(arr); let best = 0;
    for (const L of this.links.filter(l => l.ftmsCp && l.server?.connected)) {
      const r = await this.gatt(async () => {
        if (!quiet) this.addLog('>>', L.name + ' CP ' + hex(u8));
        const reply = new Promise(res => { L.cpWait = res; setTimeout(() => { if (L.cpWait === res) { L.cpWait = null; res(0); } }, 2500); });
        let sent = await this.cpSend(L, u8);
        if (!sent) { // re-acquire the characteristic once and retry (some iOS bridges lose the handle)
          try { const svc = await L.server.getPrimaryService(FTMS_SVC); L.ftmsCp = await svc.getCharacteristic(FTMS_CP); L.ftmsCp.addEventListener('characteristicvaluechanged', e => this.onCp(new Uint8Array(e.target.value.buffer), L)); await L.ftmsCp.startNotifications(); await wait(300); this.addLog('··', L.name + ': control point re-acquired'); } catch (e) { this.addLog('!!', 're-acquire failed: ' + errText(e)); }
          sent = await this.cpSend(L, u8);
        }
        if (!sent) { L.cpWait = null; return -1; }
        const code = await reply; if (!code && !quiet) this.addLog('!!', L.name + ' CP: no reply from bike');
        return code;
      });
      best = Math.max(best, r || 0);
    }
    return best;
  },
  ftmsWrite(arr) { return this.ftmsCmd(arr); },
  // Try every way Web Bluetooth implementations accept a write; remember the first that works.
  async cpSend(L, u8) {
    const c = L.ftmsCp; if (!c) return false;
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), dv = new DataView(ab);
    const ways = [
      ['withResponse(Uint8Array)', () => c.writeValueWithResponse(u8)], ['withResponse(ArrayBuffer)', () => c.writeValueWithResponse(ab)],
      ['writeValue(Uint8Array)', () => c.writeValue(u8)], ['writeValue(ArrayBuffer)', () => c.writeValue(ab)], ['writeValue(DataView)', () => c.writeValue(dv)],
      ['withoutResponse(Uint8Array)', () => c.writeValueWithoutResponse(u8)]
    ].filter(([n]) => typeof c[n.split('(')[0] === 'withResponse' ? 'writeValueWithResponse' : n.split('(')[0] === 'withoutResponse' ? 'writeValueWithoutResponse' : 'writeValue'] === 'function');
    const order = L.cpWay ? [ways.find(w => w[0] === L.cpWay), ...ways.filter(w => w[0] !== L.cpWay)].filter(Boolean) : ways;
    for (const [nm, fn] of order) {
      try { await fn(); if (L.cpWay !== nm) this.addLog('··', L.name + ' CP write accepted via ' + nm); L.cpWay = nm; return true; }
      catch (e) { this.addLog('!!', L.name + ' CP ' + nm + ' failed: ' + errText(e)); }
    }
    return false;
  },

  async fitshowInit(L) {
    const seq = [[0x02,0x42,0x42,0x03],[0x02,0x42,0x42,0x03],[0x02,0x41,0x02,0x43,0x03],[0x02,0x41,0x03,0x42,0x03],
      [0x02,0x44,0x01,0x45,0x03],[0x02,0x44,0x0a,0x00,0x00,0x00,0x00,0x3c,0xaa,0x18,0x00,0xc0,0x03],[0x02,0x42,0x42,0x03],
      [0x02,0x44,0x0b,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x4e,0x03],[0x02,0x44,0x02,0x46,0x03]];
    for (const p of seq) { await this.fsWriteTo(L, new Uint8Array(p)); await wait(120); }
  },
  fsWriteTo(L, u8, quiet) {
    const c = L?.fsWrite; if (!c) return Promise.resolve();
    return this.gatt(async () => {
      try {
        if (c.writeValueWithoutResponse) await c.writeValueWithoutResponse(u8); else await c.writeValue(u8);
        if (!quiet) this.addLog('>>', L.name + ' FFF2 ' + hex(u8));
      } catch (e) { if (!quiet) this.addLog('!!', L.name + ' write failed: ' + errText(e)); }
    });
  },
  fsWrite(u8, quiet) { return Promise.all(this.links.filter(l => l.fsWrite && !l.aa && l.server?.connected).map(l => this.fsWriteTo(l, u8, quiet))); },

  // Resistance: level 1..maxLevel. Throttled; only sends on change.
  setLevel(level, force) {
    const s = Settings.get();
    level = Math.max(1, Math.min(s.maxLevel, Math.round(level)));
    this.pendingLevel = level;
    const now = performance.now();
    if (!force && (level === this.lastLevelSent || now - this.lastSendT < 450)) return;
    this.lastLevelSent = level; this.lastSendT = now;
    const b = this.bike; if (!b || !b.server?.connected) return;
    if (b.protocol === 'fitshow') this.fsWrite(fitshowPacket(level, s.fsTable));
    else if (b.protocol === 'ftms-level') this.ftmsCmd([0x04, level & 0xff]); // FTMS Set Target Resistance, raw level (uint8)
    else if (b.protocol === 'ftms-level10') { const v = level * 10; this.ftmsCmd([0x04, v & 0xff, (v >> 8) & 0xff]); } // FTMS 1.0.1: sint16, 0.1 resolution
  },
  setSimGrade(gradePct) { // only used in ftms-sim mode
    const b = this.bike; if (!b || b.protocol !== 'ftms-sim') return;
    const now = performance.now(); if (now - this.lastSendT < 1000) return; this.lastSendT = now;
    const g = Math.round(gradePct * 100); const buf = new DataView(new ArrayBuffer(7));
    buf.setUint8(0, 0x11); buf.setInt16(1, 0, true); buf.setInt16(3, g, true); buf.setUint8(5, 40); buf.setUint8(6, 51);
    this.ftmsCmd(Array.from(new Uint8Array(buf.buffer)));
  },
  resendLevel() { const l = this.pendingLevel || this.lastLevelSent; this.lastLevelSent = 0; if (l) this.setLevel(l, true); },

  onFitShow(u8, L) {
    if (u8[0] === 0xaa && L && !L.aa) { L.aa = true; }
    if (Settings.get().rawLog) this.addLog('<<', (L ? L.name + ' ' : '') + 'FFF1 ' + hex(u8));
    // 15-byte 02 42 02 status frame: [5]=resistance, [6]=cadence, [9..10]=power*10 (LE)
    if (u8.length === 15 && u8[0] === 0x02 && u8[1] === 0x42) {
      const level = u8[5], cad = u8[6], pw = ((u8[10] << 8) | u8[9]) / 10;
      this.data.level = level;
      if (this.data.src !== 'ftms' || performance.now() - this.data.t > 2500) {
        this.data.cadence = cad; this.data.power = pw; this.data.src = 'fitshow'; this.data.t = performance.now();
      }
      this.emit();
    }
    if (u8.length >= 9 && u8[0] === 0x02 && u8[1] === 0x41 && u8[2] === 0x02) {
      const mx = u8[3]; if (mx >= 8 && mx <= 32) { Settings.set({ maxLevel: mx }); this.addLog('··', 'bike reports ' + mx + ' levels'); }
    }
  },

  onFtms(dv, L) {
    if (Settings.get().rawLog) this.addLog('<<', (L ? L.name + ' ' : '') + '2AD2 ' + hex(new Uint8Array(dv.buffer)));
    let i = 0; const f = dv.getUint16(i, true); i += 2;
    const out = {};
    if (!(f & 0x01)) { out.speed = dv.getUint16(i, true) / 100; i += 2; }
    if (f & 0x02) i += 2;
    if (f & 0x04) { out.cadence = dv.getUint16(i, true) / 2; i += 2; }
    if (f & 0x08) i += 2;
    if (f & 0x10) i += 3;
    if (f & 0x20) { out.level = dv.getInt16(i, true); i += 2; }
    if (f & 0x40) { out.power = dv.getInt16(i, true); i += 2; }
    if (f & 0x80) i += 2;
    if (f & 0x100) i += 5;
    if (f & 0x200) { out.hr = dv.getUint8(i); i += 1; }
    const d = this.data;
    if (out.cadence != null) d.cadence = out.cadence;
    if (out.power != null) d.power = Math.max(0, out.power);
    if (out.speed != null) d.speed = out.speed;
    if (out.hr) d.bikeHr = out.hr;
    if (out.level != null) { d.level = out.level; d.levelT = performance.now(); }
    if (out.power != null || out.cadence != null) { d.src = 'ftms'; d.t = performance.now(); }
    this.emit();
  },

  async onLinkDisconnect(L) {
    if (!this.links.includes(L)) return;
    this.addLog('!!', L.name + ' disconnected, reconnecting'); this.emit();
    for (let a = 0; a < 6 && this.links.includes(L); a++) {
      await wait(1500 * (a + 1));
      try { await this.setupLink(L); this.resendLevel(); toast(L.name + ' reconnected'); return; } catch (e) {}
    }
    toast(L.name + ' lost. Tap Connect bike to reconnect.');
  },
  disconnectBike() { const ls = this.links; this.links = []; this.bike = null; clearInterval(this._poll); for (const l of ls) { try { l.device.gatt.disconnect(); } catch (e) {} } this.emit(); },

  // Heart rate: standard 0x180D — Whoop ("Broadcast Heart Rate"), Apple Watch via HeartCast/BlueHeart/etc., chest straps
  async connectHR() {
    if (!this.supported) throw new Error('No Web Bluetooth in this browser.');
    let device;
    try { device = await navigator.bluetooth.requestDevice({ filters: [{ services: [HR_SVC] }] }); }
    catch (e) { this.addLog('!!', 'HR chooser failed: ' + errText(e)); if (isCancel(e) || e.name === 'NotFoundError') throw e; device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [HR_SVC] }); }
    const entry = { device, name: device.name || 'HR', bpm: 0, t: 0 };
    const attach = async () => {
      const server = await device.gatt.connect();
      const c = await (await server.getPrimaryService(HR_SVC)).getCharacteristic(HR_MEAS);
      c.addEventListener('characteristicvaluechanged', e => {
        const dv = e.target.value; const fl = dv.getUint8(0);
        entry.bpm = (fl & 1) ? dv.getUint16(1, true) : dv.getUint8(1); entry.t = performance.now(); this.emit();
      });
      await c.startNotifications();
    };
    device.addEventListener('gattserverdisconnected', async () => {
      entry.bpm = 0; this.emit();
      for (let a = 0; a < 5 && this.hr.includes(entry); a++) { await wait(2000 * (a + 1)); try { await attach(); return; } catch (e) {} }
    });
    await attach();
    this.hr = this.hr.filter(h => h.device.id !== device.id); this.hr.push(entry);
    this.addLog('··', 'HR connected: ' + entry.name); this.emit();
    return entry;
  },
  removeHR(id) { const h = this.hr.find(x => x.device.id === id); this.hr = this.hr.filter(x => x !== h); try { h?.device.gatt.disconnect(); } catch (e) {} this.emit(); },
  heartRate() { // primary = chosen source, else freshest
    const now = performance.now(); const live = this.hr.filter(h => h.bpm && now - h.t < 6000);
    const pref = Settings.get().hrPrimary; const p = live.find(h => h.name === pref) || live[0];
    if (p) return p.bpm;
    if (this.data.bikeHr && now - this.data.t < 5000) return this.data.bikeHr;
    return 0;
  }
};
