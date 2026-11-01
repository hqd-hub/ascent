// ───────────────────────────── Bluetooth: bike + heart rate ─────────────────────────────
// Toputure TBE5/TEB5 advertises FTMS (0x1826) + FitShow proprietary (0xFFF0: FFF1 notify, FFF2 write).
// Resistance via FTMS on this bike is reported as erratic (qdomyos-zwift PR #5354), so the default
// control path is the FitShow 02 44 05 <level> <b4> <xor> 03 packet on FFF2 — the same family Kinomap uses.

// Full 128-bit UUID strings: Bluefy (iPad/iPhone) rejects the short numeric/name forms that Chrome accepts.
const U = (n) => '0000' + n.toString(16).padStart(4, '0') + '-0000-1000-8000-00805f9b34fb';
const FITSHOW_SVC = U(0xfff0), FITSHOW_NOTIFY = U(0xfff1), FITSHOW_WRITE = U(0xfff2);
const FTMS_SVC = U(0x1826), FTMS_BIKE_DATA = U(0x2ad2), FTMS_CP = U(0x2ad9), FTMS_STATUS = U(0x2ada);
const CPS_SVC = U(0x1818), CPS_MEAS = U(0x2a63), CSC_SVC = U(0x1816), HR_SVC = U(0x180d), HR_MEAS = U(0x2a37);
const errText = (e) => (e && (e.name ? e.name + ': ' : '') + (e.message || e)) || String(e);
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

  async connectBike(showAll) {
    if (!this.supported) throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge on Mac/Windows/Android, or the Bluefy browser on iPad/iPhone.');
    const optionalServices = [FTMS_SVC, FITSHOW_SVC, CPS_SVC, CSC_SVC];
    let device;
    this.addLog('··', 'opening Bluetooth chooser' + (showAll ? ' (all devices)' : '') + ' · ' + navigator.userAgent.slice(0, 80));
    const tries = showAll ? [{ acceptAllDevices: true, optionalServices }] : [
      { filters: [{ services: [FTMS_SVC] }, { services: [FITSHOW_SVC] }, { namePrefix: 'Toputure' }, { namePrefix: 'FS-' }, { namePrefix: 'TBE' }, { namePrefix: 'TEB' }], optionalServices },
      { filters: [{ namePrefix: 'Toputure' }, { namePrefix: 'FS-' }, { namePrefix: 'TBE' }, { namePrefix: 'TEB' }], optionalServices },
      { acceptAllDevices: true, optionalServices }, { acceptAllDevices: true }];
    let lastErr;
    for (const opt of tries) {
      try { device = await navigator.bluetooth.requestDevice(opt); break; }
      catch (e) { lastErr = e; this.addLog('!!', 'chooser failed (' + (opt.acceptAllDevices ? 'all' : 'filtered') + '): ' + errText(e)); if (isCancel(e) || e.name === 'NotFoundError') throw e; }
    }
    if (!device) throw lastErr;
    if (this.bike) this.disconnectBike();
    device.addEventListener('gattserverdisconnected', () => this.onBikeDisconnect());
    this.bike = { device, name: device.name || 'Bike', protocol: 'none' };
    try { await this.setupBike(); }
    catch (e) { this.addLog('!!', 'setup failed: ' + e.message); const d = this.bike?.device; this.bike = null; try { d?.gatt.disconnect(); } catch (x) {} this.emit(); throw new Error('Found "' + (device.name || 'device') + '" but couldn\u2019t connect: ' + e.message); }
    if (!b_hasService(this.bike)) { this.addLog('!!', 'no FTMS or FitShow service on ' + device.name); }
    return this.bike;
  },

  async setupBike() {
    const b = this.bike; if (!b) return;
    b.server = await b.device.gatt.connect();
    this.addLog('··', `connected to ${b.name}`);
    // FitShow proprietary channel
    try {
      const svc = await b.server.getPrimaryService(FITSHOW_SVC);
      b.fsWrite = await svc.getCharacteristic(FITSHOW_WRITE);
      const n = await svc.getCharacteristic(FITSHOW_NOTIFY);
      n.addEventListener('characteristicvaluechanged', e => this.onFitShow(new Uint8Array(e.target.value.buffer)));
      await n.startNotifications();
      this.addLog('··', 'FitShow FFF0 found');
      await this.fitshowInit();
    } catch (e) { this.addLog('··', 'no FitShow service (' + e.message + ')'); }
    // FTMS
    try {
      const svc = await b.server.getPrimaryService(FTMS_SVC);
      const d = await svc.getCharacteristic(FTMS_BIKE_DATA);
      d.addEventListener('characteristicvaluechanged', e => this.onFtms(e.target.value));
      await d.startNotifications();
      try {
        b.ftmsCp = await svc.getCharacteristic(FTMS_CP);
        b.ftmsCp.addEventListener('characteristicvaluechanged', e => this.addLog('<<', 'CP ' + hex(new Uint8Array(e.target.value.buffer))));
        await b.ftmsCp.startNotifications();
      } catch (e) { this.addLog('··', 'FTMS control point unavailable'); }
      this.addLog('··', 'FTMS 1826 found');
    } catch (e) { this.addLog('··', 'no FTMS service'); }
    // Choose control protocol
    const pref = Settings.get().protocol;
    if (pref === 'fitshow' && b.fsWrite) b.protocol = 'fitshow';
    else if ((pref === 'ftms-level' || pref === 'ftms-sim') && b.ftmsCp) b.protocol = pref;
    else if (pref === 'none') b.protocol = 'none';
    else b.protocol = b.fsWrite ? 'fitshow' : (b.ftmsCp ? 'ftms-level' : 'none');
    if (b.protocol.startsWith('ftms')) await this.ftmsWrite([0x00]).catch(() => {}); // request control
    if (b.protocol === 'ftms-sim') await this.ftmsWrite([0x07]).catch(() => {}); // start
    this.addLog('··', 'resistance control: ' + b.protocol);
    clearInterval(this._poll);
    if (b.fsWrite) {
      let k = 0;
      this._poll = setInterval(() => { // FitShow bikes only stream data while polled
        if (!b.server?.connected) return;
        const pkt = (k++ % 2) ? [0x02, 0x43, 0x01, 0x42, 0x03] : [0x02, 0x42, 0x42, 0x03];
        this.fsWrite(new Uint8Array(pkt), true);
      }, 500);
    }
    this.lastLevelSent = 0;
    this.emit();
  },

  async fitshowInit() {
    const seq = [[0x02,0x42,0x42,0x03],[0x02,0x42,0x42,0x03],[0x02,0x41,0x02,0x43,0x03],[0x02,0x41,0x03,0x42,0x03],
      [0x02,0x44,0x01,0x45,0x03],[0x02,0x44,0x0a,0x00,0x00,0x00,0x00,0x3c,0xaa,0x18,0x00,0xc0,0x03],[0x02,0x42,0x42,0x03],
      [0x02,0x44,0x0b,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x4e,0x03],[0x02,0x44,0x02,0x46,0x03]];
    for (const p of seq) { await this.fsWrite(new Uint8Array(p)); await wait(120); }
  },

  _fsQueue: Promise.resolve(),
  fsWrite(u8, quiet) {
    const c = this.bike?.fsWrite; if (!c) return Promise.resolve();
    this._fsQueue = this._fsQueue.then(async () => {
      try {
        if (c.writeValueWithoutResponse) await c.writeValueWithoutResponse(u8); else await c.writeValue(u8);
        if (!quiet) this.addLog('>>', 'FFF2 ' + hex(u8));
      } catch (e) { this.addLog('!!', 'write failed ' + e.message); }
    });
    return this._fsQueue;
  },
  async ftmsWrite(arr) {
    const c = this.bike?.ftmsCp; if (!c) return;
    const u8 = new Uint8Array(arr);
    this.addLog('>>', 'CP ' + hex(u8));
    try { await (c.writeValueWithResponse ? c.writeValueWithResponse(u8) : c.writeValue(u8)); } catch (e) { this.addLog('!!', e.message); }
  },

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
    else if (b.protocol === 'ftms-level') this.ftmsWrite([0x04, level & 0xff]); // FTMS Set Target Resistance (fallback path; raw level)
  },
  setSimGrade(gradePct) { // only used in ftms-sim mode
    const b = this.bike; if (!b || b.protocol !== 'ftms-sim') return;
    const now = performance.now(); if (now - this.lastSendT < 1000) return; this.lastSendT = now;
    const g = Math.round(gradePct * 100); const buf = new DataView(new ArrayBuffer(7));
    buf.setUint8(0, 0x11); buf.setInt16(1, 0, true); buf.setInt16(3, g, true); buf.setUint8(5, 40); buf.setUint8(6, 51);
    this.ftmsWrite(Array.from(new Uint8Array(buf.buffer)));
  },
  resendLevel() { const l = this.pendingLevel || this.lastLevelSent; this.lastLevelSent = 0; if (l) this.setLevel(l, true); },

  onFitShow(u8) {
    if (Settings.get().rawLog) this.addLog('<<', 'FFF1 ' + hex(u8));
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

  onFtms(dv) {
    if (Settings.get().rawLog) this.addLog('<<', '2AD2 ' + hex(new Uint8Array(dv.buffer)));
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
    if (out.power != null || out.cadence != null) { d.src = 'ftms'; d.t = performance.now(); }
    this.emit();
  },

  async onBikeDisconnect() {
    if (!this.bike) return;
    this.addLog('!!', 'bike disconnected — reconnecting');
    clearInterval(this._poll); this.emit();
    for (let a = 0; a < 6 && this.bike; a++) {
      await wait(1500 * (a + 1));
      try { await this.setupBike(); this.resendLevel(); toast('Bike reconnected'); return; } catch (e) {}
    }
    toast('Bike lost — tap Bike to reconnect');
  },
  disconnectBike() { const b = this.bike; this.bike = null; clearInterval(this._poll); try { b?.device.gatt.disconnect(); } catch (e) {} this.emit(); },

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
