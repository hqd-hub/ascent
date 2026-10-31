// ───────────────────────────── Route geometry + 3D world ─────────────────────────────
const STEP = 5; // metres between road samples

// Deterministic noise
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash2(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Build sampled route: position, elevation, grade, heading
function buildRoute(def, gpx) {
  let prof = [];
  if (gpx) { // gpx: [{d, e}] cumulative distance + elevation
    const total = gpx[gpx.length - 1].d; const n = Math.max(2, Math.floor(total / STEP));
    let j = 0;
    for (let i = 0; i <= n; i++) { const s = i * STEP; while (j < gpx.length - 2 && gpx[j + 1].d < s) j++; const a = gpx[j], b = gpx[j + 1]; const t = b.d > a.d ? (s - a.d) / (b.d - a.d) : 0; prof.push(a.e + (b.e - a.e) * Math.max(0, Math.min(1, t))); }
  } else {
    let e = def.startElev || 0; prof.push(e);
    for (const [lk, g] of def.profile) { const n = Math.round(lk * 1000 / STEP); for (let i = 0; i < n; i++) { e += STEP * g / 100; prof.push(e); } }
  }
  const N = prof.length;
  // Smooth elevation (≈60 m window) so gradient changes feel like a real road
  const W = 6, elev = new Float32Array(N);
  for (let i = 0; i < N; i++) { let s = 0, c = 0; for (let k = -W; k <= W; k++) { const j = Math.max(0, Math.min(N - 1, i + k)); s += prof[j]; c++; } elev[i] = s / c; }
  const grade = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = Math.max(0, i - 2), b = Math.min(N - 1, i + 2); grade[i] = (elev[b] - elev[a]) / ((b - a) * STEP) * 100; }

  // Plan path heading
  const head = new Float32Array(N), xs = new Float32Array(N), zs = new Float32Array(N);
  const style = def.path || 'meander';
  const turns = []; // hairpin sample indices
  if (style === 'switchback') {
    // climbing region
    let c0 = grade.findIndex(g => g > 2); if (c0 < 0) c0 = 0;
    let c1 = N - 1; while (c1 > c0 && grade[c1] < 2) c1--;
    const climbLen = (c1 - c0) * STEP, H = def.hairpins || 10;
    const leg = climbLen / (H + 1), r = 13, turnLen = Math.PI * r;
    const avgG = Math.max(0.03, (elev[c1] - elev[c0]) / Math.max(1, climbLen));
    const spacing = Math.max(2 * r + 20, leg * avgG * 1.6);
    const theta = Math.asin(Math.min(0.5, Math.max(0.02, (spacing - 2 * r) / leg)));
    const base = Math.PI / 2 - theta; let dir = 1;
    for (let k = 1; k <= H; k++) turns.push(Math.round(c0 + (leg * k) / STEP));
    let h = base, ti = 0; const tSteps = Math.round(turnLen / STEP);
    for (let i = 0; i < N; i++) {
      if (i <= c0) h = base;
      if (ti < turns.length && i >= turns[ti] - tSteps / 2 && i < turns[ti] + tSteps / 2) {
        h -= dir * (2 * base) / tSteps;
        if (i === Math.floor(turns[ti] + tSteps / 2) - 1) { ti++; dir = -dir; }
      } else if (i > c1) h += (0 - h) * 0.01;
      head[i] = h;
    }
  } else {
    const r = mulberry(def.id ? def.id.length * 977 + def.name.length : 7), p1 = r() * 6, p2 = r() * 6, p3 = r() * 6;
    const A = style === 'sweep' ? 0.85 : 0.95;
    for (let i = 0; i < N; i++) { const s = i * STEP; head[i] = A * Math.sin(s / 650 + p1) + 0.35 * Math.sin(s / 240 + p2) + 0.1 * Math.sin(s / 90 + p3); }
  }
  for (let i = 1; i < N; i++) { xs[i] = xs[i - 1] + Math.sin(head[i]) * STEP; zs[i] = zs[i - 1] + Math.cos(head[i]) * STEP; }

  let minE = Infinity, maxE = -Infinity; for (const e of elev) { minE = Math.min(minE, e); maxE = Math.max(maxE, e); }
  let gain = 0; for (let i = 1; i < N; i++) if (elev[i] > elev[i - 1]) gain += elev[i] - elev[i - 1];
  const route = { def, N, length: (N - 1) * STEP, elev, grade, head, xs, zs, minE, maxE, gain, turns };
  // Spatial hash of road segments (every 4th sample = 20 m) for terrain queries
  const CS = 60, grid = new Map(), key = (a, b) => a * 73856093 ^ b * 19349663;
  for (let i = 0; i < N - 4; i += 4) {
    const cx = Math.floor((xs[i] + xs[i + 4]) / 2 / CS), cz = Math.floor((zs[i] + zs[i + 4]) / 2 / CS);
    const k = key(cx, cz); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
  }
  const coarse = []; for (let i = 0; i < N; i += 40) coarse.push(i);
  route.query = (x, z, R = 240) => { // → {d, e (nearest elev), ie (blended elev), i, side}
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), rc = Math.ceil(R / CS);
    let best = 1e9, bi = 0, bt = 0, ws = 0, we = 0;
    for (let a = -rc; a <= rc; a++) for (let b = -rc; b <= rc; b++) {
      const L = grid.get(key(cx + a, cz + b)); if (!L) continue;
      for (const i of L) {
        const ax = xs[i], az = zs[i], bx = xs[i + 4], bz = zs[i + 4], dx = bx - ax, dz = bz - az;
        let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz); t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + dx * t - x, pz = az + dz * t - z, d = Math.sqrt(px * px + pz * pz);
        if (d < best) { best = d; bi = i; bt = t; }
        if (d < R) { const e = elev[i] + (elev[i + 4] - elev[i]) * t, w = 1 / ((d + 8) * (d + 8)); ws += w; we += w * e; }
      }
    }
    if (best > 1e8) { // far away: coarse fallback
      for (const i of coarse) { const d = Math.hypot(xs[i] - x, zs[i] - z); if (d < best) { best = d; bi = i; bt = 0; } }
      const sd = Math.sign((x - xs[bi]) * Math.cos(head[bi]) - (z - zs[bi]) * Math.sin(head[bi]));
      return { d: best, e: elev[bi], ie: elev[bi], i: bi, side: sd };
    }
    const e = elev[bi] + (elev[Math.min(N - 1, bi + 4)] - elev[bi]) * bt;
    const hx = Math.sin(head[bi]), hz = Math.cos(head[bi]); const side = Math.sign((x - xs[bi]) * hz - (z - zs[bi]) * hx);
    return { d: best, e, ie: ws ? we / ws : e, i: bi, side };
  };
  route.at = (s) => { // interpolated state at distance s
    const f = Math.max(0, Math.min(N - 1.001, s / STEP)), i = Math.floor(f), t = f - i;
    const L = (a) => a[i] + (a[i + 1] - a[i]) * t;
    return { x: L(xs), z: L(zs), y: L(elev), h: L(head), g: L(grade), i };
  };
  return route;
}

// Terrain height for theme
function terrainHeight(route, theme, x, z, q) {
  q = q || route.query(x, z);
  const T = THEMES[theme];
  const clear = 9;
  const w = smooth(clear, clear + 60, q.d);
  const base = q.e + (q.ie - q.e) * w;
  const hill = T.peaks ? 0.42 : theme === 'provence' ? 0.25 : 0.14;
  const n = fbm(x / 420, z / 420), n2 = fbm(x / 90 + 7, z / 90 + 3);
  let rise = Math.max(0, q.d - clear); if (rise > 300) rise = 300 + (rise - 300) * 0.35;
  let h = base - 0.45 + rise * hill * (0.6 + n) + (n2 - 0.5) * 16 * smooth(clear, 120, q.d) + (n - 0.45) * 140 * smooth(150, 900, q.d) * (T.peaks ? 1.6 : 0.7);
  if ((theme === 'coast' || theme === 'nordic') && q.side < 0) h -= rise * (hill + 0.12) * smooth(clear, 80, q.d) + 6 * smooth(clear, 60, q.d);
  // Carve: never rise above the road edge close to it
  const cap = q.e - 0.45 + Math.max(0, q.d - clear) * 0.7;
  return Math.min(h, cap);
}

// ── Canvas text textures
function textTex(lines, opts = {}) {
  const c = document.createElement('canvas'); c.width = opts.w || 512; c.height = opts.h || 128;
  const g = c.getContext('2d'); g.fillStyle = opts.bg || '#111'; g.fillRect(0, 0, c.width, c.height);
  if (opts.stripe) { g.fillStyle = opts.stripe; for (let x = 0; x < c.width; x += 40) g.fillRect(x, 0, 20, 10), g.fillRect(x + 20, c.height - 10, 20, 10); }
  g.fillStyle = opts.fg || '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const L = Array.isArray(lines) ? lines : [lines];
  L.forEach((t, i) => { g.font = `${i === 0 ? 800 : 600} ${opts.size || 64}px system-ui, sans-serif`; g.fillText(t, c.width / 2, c.height * (i + 1) / (L.length + 1)); });
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4; return tex;
}
function roadTexture(color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512; const g = c.getContext('2d');
  const col = '#' + color.toString(16).padStart(6, '0'); g.fillStyle = col; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 9000; i++) { const v = Math.random() * 40 - 20; g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 260})`; g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2); }
  g.fillStyle = '#e9e9e9'; g.fillRect(8, 0, 6, 512); g.fillRect(242, 0, 6, 512);
  g.fillStyle = '#f2f2f2'; g.fillRect(125, 0, 6, 220);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 9000);
    this.scene.add(this.camera);
    this.tiles = new Map(); this.riders = []; this.view = 'first';
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const q = Settings.get().quality; const pr = Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'low' ? 1 : 1.5);
    this.renderer.setPixelRatio(pr); const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  dispose() {
    this.scene.traverse(o => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach(m => { m.map?.dispose?.(); m.dispose?.(); }); });
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
    this.camera.clear();
    this.scene.add(this.camera); this.tiles.clear(); this.riders = []; this.peaks = null; this.water = null; this.fans = null;
  }

  load(route) {
    this.dispose(); this.route = route; const T = THEMES[route.def.theme]; this.T = T; this.theme = route.def.theme;
    const S = this.scene; this.resize();
    S.fog = new THREE.Fog(T.fog, 120, T.fogD);
    this.renderer.setClearColor(T.fog);
    // Sky dome
    const skyG = new THREE.SphereGeometry(8000, 32, 16); const cols = []; const top = new THREE.Color(T.sky[0]), hor = new THREE.Color(T.sky[1]);
    const p = skyG.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 8000; const c = hor.clone().lerp(top, Math.pow(Math.max(0, y), 0.55)); cols.push(c.r, c.g, c.b); }
    skyG.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.sky = new THREE.Mesh(skyG, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); S.add(this.sky);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(160, 16, 8), new THREE.MeshBasicMaterial({ color: T.sun, fog: false })); sun.position.set(-3000, 2600, 5200); this.sky.add(sun);
    // Clouds
    const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xc8ccd4, transparent: true, opacity: 0.9, fog: false });
    const rnd = mulberry(42);
    for (let i = 0; i < 26; i++) { const g = new THREE.Group(); for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(60 + rnd() * 80, 1), cm); m.position.set(k * 90 - 180 + rnd() * 40, rnd() * 30, rnd() * 60); m.scale.y = 0.45; g.add(m); } const a = rnd() * Math.PI * 2, r = 2500 + rnd() * 3500; g.position.set(Math.cos(a) * r, 900 + rnd() * 600, Math.sin(a) * r); this.sky.add(g); }
    // Lights
    S.add(new THREE.HemisphereLight(T.sky[0], T.grass, 0.75));
    const dl = new THREE.DirectionalLight(T.sun, 0.95); dl.position.set(-0.5, 0.8, 0.6); S.add(dl);
    // Distant peaks (follow rider; fake horizon)
    if (T.peaks) {
      this.peaks = new THREE.Group(); const pm = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false, flatShading: true });
      for (let i = 0; i < 34; i++) {
        const hgt = 700 + rnd() * 1300, g = new THREE.ConeGeometry(500 + rnd() * 700, hgt, 7, 4); const pa = g.attributes.position; const cc = [];
        for (let k = 0; k < pa.count; k++) { const y = pa.getY(k); pa.setX(k, pa.getX(k) * (0.8 + rnd() * 0.4)); pa.setZ(k, pa.getZ(k) * (0.8 + rnd() * 0.4)); const rel = (y + hgt / 2) / hgt; const c = new THREE.Color(rel > 0.62 ? T.snow : T.rock).lerp(new THREE.Color(T.fog), 0.45); cc.push(c.r, c.g, c.b); }
        g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3)); g.computeVertexNormals();
        const m = new THREE.Mesh(g, pm); const a = (i / 34) * Math.PI * 2 + rnd() * 0.15, r = 4600 + rnd() * 1800; m.position.set(Math.cos(a) * r, hgt / 2 - 250, Math.sin(a) * r); this.peaks.add(m);
      }
      S.add(this.peaks);
    }
    // Water
    if (T.water) {
      this.water = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshPhongMaterial({ color: T.water, shininess: 90, specular: 0x88aacc, transparent: true, opacity: 0.93 }));
      this.water.rotation.x = -Math.PI / 2; this.water.position.y = route.minE - 2.5; S.add(this.water);
    }
    this.buildRoad(); this.buildProps(); this.buildTrees();
    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    // Handlebars (first-person cockpit)
    this.cockpit = this.makeCockpit(); this.camera.add(this.cockpit);
    this.ensureTiles(0, 0, true);
  }

  buildRoad() {
    const r = this.route, T = this.T, N = r.N, half = 3.6;
    const pos = [], uv = [], idx = [], sp = [], sidx = [];
    for (let i = 0; i < N; i++) {
      const nx = Math.cos(r.head[i]), nz = -Math.sin(r.head[i]), y = r.elev[i] + 0.06;
      pos.push(r.xs[i] - nx * half, y, r.zs[i] - nz * half, r.xs[i] + nx * half, y, r.zs[i] + nz * half);
      uv.push(0, i * STEP / 12, 1, i * STEP / 12);
      // shoulders: edge → 1.6 m out, 0.6 m down
      for (const sgn of [-1, 1]) { sp.push(r.xs[i] + sgn * nx * half, y - 0.01, r.zs[i] + sgn * nz * half, r.xs[i] + sgn * nx * (half + 1.8), y - 0.7, r.zs[i] + sgn * nz * (half + 1.8)); }
      if (i < N - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); const b = i * 4; sidx.push(b, b + 1, b + 4, b + 1, b + 5, b + 4, b + 2, b + 6, b + 3, b + 3, b + 6, b + 7); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const road = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: roadTexture(T.road), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.scene.add(road);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setIndex(sidx); sg.computeVertexNormals();
    this.scene.add(new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: new THREE.Color(T.rock).lerp(new THREE.Color(0x777777), 0.5), side: THREE.DoubleSide })));
    // Safety walls on hairpins / alpine
    if (this.theme === 'alpine' || this.theme === 'volcano') {
      const wm = new THREE.MeshLambertMaterial({ color: 0xd9d4ca }); const wg = new THREE.BoxGeometry(0.4, 0.7, 6);
      const cnt = Math.floor(N / 3); const inst = new THREE.InstancedMesh(wg, wm, cnt); const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      let k = 0;
      for (let i = 0; i < N - 1 && k < cnt; i += 3) {
        const qq = r.query(r.xs[i] + Math.cos(r.head[i]) * 25, r.zs[i] - Math.sin(r.head[i]) * 25);
        const th = terrainHeight(r, this.theme, r.xs[i] + Math.cos(r.head[i]) * 25, r.zs[i] - Math.sin(r.head[i]) * 25, qq);
        if (th > r.elev[i] - 6) continue; // only where it drops away on the right
        const side = 1; const nx = Math.cos(r.head[i]) * side, nz = -Math.sin(r.head[i]) * side;
        e.set(0, r.head[i], 0); q.setFromEuler(e); m.compose(new THREE.Vector3(r.xs[i] + nx * 5.6, r.elev[i] + 0.0, r.zs[i] + nz * 5.6), q, new THREE.Vector3(1, 1, 1)); inst.setMatrixAt(k++, m);
      }
      inst.count = k; this.scene.add(inst);
    }
  }

  placeBoard(s, lateral, tex, w, h, height, poleCol) {
    const r = this.route, p = r.at(s); const g = new THREE.Group();
    const nx = Math.cos(p.h), nz = -Math.sin(p.h);
    g.position.set(p.x + nx * lateral, p.y, p.z + nz * lateral); g.rotation.y = p.h + Math.PI;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); board.position.y = height; g.add(board);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, height), new THREE.MeshLambertMaterial({ color: poleCol || 0x888888 })); pole.position.y = height / 2 - h / 2; g.add(pole);
    this.scene.add(g); return g;
  }
  arch(s, tex, color) {
    const r = this.route, p = r.at(s), g = new THREE.Group(); g.position.set(p.x, p.y, p.z); g.rotation.y = p.h + Math.PI;
    const m = new THREE.MeshLambertMaterial({ color });
    for (const x of [-5, 5]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), m); post.position.set(x, 3, 0); g.add(post); }
    const ban = new THREE.Mesh(new THREE.BoxGeometry(10.5, 1.6, 0.3), [m, m, m, m, new THREE.MeshBasicMaterial({ map: tex }), new THREE.MeshBasicMaterial({ map: tex })]); ban.position.y = 6.3; g.add(ban);
    this.scene.add(g);
  }
  buildProps() {
    const r = this.route, def = r.def;
    this.arch(4, textTex(def.name.toUpperCase(), { bg: '#0b1220', fg: '#fff', size: 52 }), 0x222831);
    this.arch(r.length - 30, textTex('FINISH', { bg: '#111', fg: '#fff', stripe: '#fff', size: 80 }), 0x111111);
    for (const sg of def.segments || []) {
      const col = sg.type === 'kom' ? '#c81e1e' : '#16a34a';
      this.arch(sg.from, textTex([sg.type === 'kom' ? 'KOM START' : 'SPRINT START', sg.name], { bg: col, size: 50 }), sg.type === 'kom' ? 0xb91c1c : 0x15803d);
      this.arch(Math.min(sg.to, r.length - 60), textTex([sg.type === 'kom' ? 'KOM' : 'SPRINT', 'BANNER'], { bg: sg.type === 'kom' ? '#fff' : col, fg: sg.type === 'kom' ? '#c81e1e' : '#fff', size: 56, stripe: sg.type === 'kom' ? '#c81e1e' : null }), sg.type === 'kom' ? 0xb91c1c : 0x15803d);
    }
    // km markers (remaining to summit for climbs, else distance)
    for (let d = 1000; d < r.length - 200; d += 1000) {
      const rem = ((r.length - d) / 1000).toFixed(0), g = r.at(d).g;
      const txt = def.real ? [`${rem} km`, `${g.toFixed(1)} %`] : [`${(d / 1000).toFixed(0)} km`];
      this.placeBoard(d, 5.2, textTex(txt, { bg: '#f7f7f2', fg: '#111', w: 256, h: 192, size: 54 }), 0.9, 0.68, 1.4, 0xf0f0f0);
    }
    // Hairpin signs
    const turns = r.turns; turns.forEach((ti, k) => {
      const n = def.countdown ? turns.length - k : k + 1; const label = ({ Italy: 'Tornante', Spain: 'Curva' })[def.country] || 'Virage';
      this.placeBoard(ti * STEP - 40, -5, textTex([`${label} ${n}`, `${Math.round(r.elev[ti])} m`], { bg: '#1d4ed8', fg: '#fff', w: 384, h: 192, size: 60 }), 1.6, 0.8, 2.2, 0x999999);
    });
    // Cabins (nordic) / beach huts (coast)
    if (this.theme === 'nordic' || this.theme === 'coast') {
      const rnd = mulberry(9), wallM = new THREE.MeshLambertMaterial({ color: this.theme === 'nordic' ? 0x9b2226 : 0xf1f5f9 }), roofM = new THREE.MeshLambertMaterial({ color: this.theme === 'nordic' ? 0x2b2b2b : 0x0ea5e9 });
      for (let d = 300; d < r.length; d += 380 + rnd() * 500) {
        const p = r.at(d), side = rnd() > 0.5 ? 1 : -1, off = 18 + rnd() * 30, nx = Math.cos(p.h) * side, nz = -Math.sin(p.h) * side;
        const x = p.x + nx * off, z = p.z + nz * off, q = r.query(x, z); if (q.d < 12) continue;
        const y = terrainHeight(r, this.theme, x, z, q); if (this.water && y < this.water.position.y + 0.5) continue;
        const g = new THREE.Group(); const w = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 4.5), wallM); w.position.y = 1.6; g.add(w);
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 3.9, 2.2, 4, 1), roofM); roof.rotation.y = Math.PI / 4; roof.scale.set(1.1, 1, 0.8); roof.position.y = 4.3; g.add(roof);
        g.position.set(x, y, z); g.rotation.y = p.h + (rnd() - 0.5) * 0.6; this.scene.add(g);
      }
    }
    // Spectators near summits / sprint finishes
    const fans = []; for (const sg of def.segments || []) for (let d = sg.to - (sg.type === 'kom' ? 700 : 200); d < sg.to; d += 7) fans.push(d);
    if (fans.length) {
      const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.28, 0.9, 3, 6), new THREE.MeshLambertMaterial(), fans.length * 2);
      const m = new THREE.Matrix4(), c = new THREE.Color(), rnd = mulberry(5); let k = 0;
      for (const d of fans) for (const side of [-1, 1]) {
        if (rnd() < 0.35) continue; const p = r.at(d), off = side * (5.2 + rnd() * 2), nx = Math.cos(p.h), nz = -Math.sin(p.h);
        m.makeTranslation(p.x + nx * off, p.y + 0.75, p.z + nz * off); body.setMatrixAt(k, m); body.setColorAt(k, c.setHSL(rnd(), 0.7, 0.5)); k++;
      }
      body.count = k; this.fans = body; this.scene.add(body);
    }
  }

  buildTrees() {
    const r = this.route, T = this.T, q = Settings.get().quality; const density = q === 'low' ? 0.5 : q === 'high' ? 1.6 : 1;
    const type = T.tree; const rnd = mulberry(1234);
    const trunkG = type === 'palm' ? new THREE.CylinderGeometry(0.18, 0.28, 7, 5) : new THREE.CylinderGeometry(0.15, 0.25, type === 'pine' ? 2.2 : 3, 5);
    const crownG = type === 'pine' ? new THREE.ConeGeometry(2.2, 7, 7) : type === 'palm' ? new THREE.ConeGeometry(3.2, 1.4, 7) : new THREE.IcosahedronGeometry(2.4, 0);
    const trunkM = new THREE.MeshLambertMaterial({ color: type === 'birch' ? 0xeae6dc : 0x5a3d2b });
    const crownM = new THREE.MeshLambertMaterial({ color: type === 'pine' ? 0x24452a : type === 'birch' ? 0x7aa64a : type === 'palm' ? 0x3f8a3a : 0x47682f, flatShading: true });
    const max = Math.floor(r.length / 7 * density) + 50;
    const trunks = new THREE.InstancedMesh(trunkG, trunkM, max), crowns = new THREE.InstancedMesh(crownG, crownM, max);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(); let k = 0;
    const treeLine = this.theme === 'alpine' ? Math.max(1900, r.minE + 900) : this.theme === 'provence' ? 1450 : this.theme === 'volcano' ? r.minE + 60 : 1e9;
    for (let a = 0; a < max * 3 && k < max; a++) {
      const s = rnd() * r.length, p = r.at(s), side = rnd() > 0.5 ? 1 : -1, off = 9 + Math.pow(rnd(), 1.6) * 160;
      const x = p.x + Math.cos(p.h) * off * side, z = p.z - Math.sin(p.h) * off * side; const qy = r.query(x, z); if (qy.d < 8.5) continue;
      const y = terrainHeight(r, this.theme, x, z, qy); if (y > treeLine - rnd() * 120) continue; if (this.water && y < this.water.position.y + 0.8) continue;
      const s0 = 0.7 + rnd() * 0.7; sc.set(s0, s0 * (0.85 + rnd() * 0.4), s0); qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      const th = type === 'palm' ? 7 : type === 'pine' ? 2.2 : 3;
      m.compose(pv.set(x, y + th / 2 * sc.y, z), qq, sc); trunks.setMatrixAt(k, m);
      m.compose(pv.set(x, y + (th + (type === 'pine' ? 3.2 : type === 'palm' ? 0.2 : 1.6)) * sc.y, z), qq, sc); crowns.setMatrixAt(k, m); k++;
    }
    trunks.count = crowns.count = k; this.scene.add(trunks, crowns);
  }

  // Terrain tiles generated around the rider
  ensureTiles(x, z, sync) {
    const TS = 400, q = Settings.get().quality, RES = q === 'low' ? 24 : q === 'high' ? 50 : 36, R = q === 'low' ? 2 : 3;
    const cx = Math.floor(x / TS), cz = Math.floor(z / TS); let built = 0;
    const want = [];
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) want.push([cx + a, cz + b, a * a + b * b]);
    want.sort((p, q) => p[2] - q[2]);
    for (const [tx, tz] of want) {
      const k = tx + ',' + tz; if (this.tiles.has(k)) continue;
      if (!sync && built >= 1) break;
      this.tiles.set(k, this.makeTile(tx, tz, TS, RES)); built++;
    }
    for (const [k, mesh] of this.tiles) { const [tx, tz] = k.split(',').map(Number); if (Math.abs(tx - cx) > R + 1 || Math.abs(tz - cz) > R + 1) { this.scene.remove(mesh); mesh.geometry.dispose(); this.tiles.delete(k); } }
  }
  makeTile(tx, tz, TS, RES) {
    const r = this.route, T = this.T, g = new THREE.PlaneGeometry(TS, TS, RES, RES); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, cols = new Float32Array(p.count * 3);
    const cG = new THREE.Color(T.grass), cR = new THREE.Color(T.rock), cS = new THREE.Color(T.snow), c = new THREE.Color(), cD = new THREE.Color(T.grass).multiplyScalar(0.75);
    const snowLine = this.theme === 'alpine' ? Math.max(2350, r.maxE + 250) : this.theme === 'provence' ? 1500 : this.theme === 'volcano' ? -1e9 : 1e9;
    const ox = tx * TS + TS / 2, oz = tz * TS + TS / 2;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + ox, z = p.getZ(i) + oz; const qy = r.query(x, z); const y = terrainHeight(r, this.theme, x, z, qy);
      p.setXYZ(i, x, y, z);
      const rel = y - qy.e, n = vnoise(x / 30, z / 30);
      c.copy(cG).lerp(cD, n * 0.6);
      if (this.theme === 'coast' && this.water && y < this.water.position.y + 2.5) c.copy(cR);
      c.lerp(cR, smooth(30, 160, rel + n * 40));
      if (y > snowLine - n * 200) c.copy(cS);
      if (this.theme === 'volcano') c.lerp(cR, 0.5 + 0.5 * smooth(5, 60, rel));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.terrainMat); this.scene.add(mesh); return mesh;
  }

  makeRider(color, ghost) {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c, transparent: !!ghost, opacity: ghost ? 0.35 : 1 });
    const jersey = mat(color), dark = mat(0x16181d), skin = mat(0xe0b48f);
    const wheelG = new THREE.TorusGeometry(0.34, 0.035, 6, 20);
    const w1 = new THREE.Mesh(wheelG, dark), w2 = new THREE.Mesh(wheelG, dark); w1.rotation.y = w2.rotation.y = Math.PI / 2; w1.position.set(0, 0.34, 0.52); w2.position.set(0, 0.34, -0.52); g.add(w1, w2);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.0), mat(color)); frame.position.set(0, 0.62, 0); frame.rotation.x = -0.12; g.add(frame);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 3, 8), jersey); torso.position.set(0, 1.1, 0.05); torso.rotation.x = 1.05; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mat(0xfafafa)); head.position.set(0, 1.38, 0.38); g.add(head);
    const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.55, 2, 6), dark), legR = legL.clone(); legL.position.set(0.12, 0.72, -0.05); legR.position.set(-0.12, 0.72, -0.05); g.add(legL, legR);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.4, 2, 6), skin), arm2 = arm.clone(); arm.position.set(0.17, 1.05, 0.38); arm2.position.set(-0.17, 1.05, 0.38); arm.rotation.x = arm2.rotation.x = 0.6; g.add(arm, arm2);
    g.userData = { w1, w2, legL, legR };
    this.scene.add(g); return g;
  }
  makeLabel(text, color) {
    const tex = textTex(text, { bg: 'rgba(10,14,22,0.75)', fg: color || '#fff', w: 256, h: 64, size: 34 });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })); sp.scale.set(1.5, 0.375, 1); sp.position.y = 2.0; return sp;
  }
  makeCockpit() {
    const g = new THREE.Group(); const m = new THREE.MeshLambertMaterial({ color: 0x15171c }), tape = new THREE.MeshLambertMaterial({ color: 0x2a2d35 });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 10), tape); bar.rotation.z = Math.PI / 2; g.add(bar);
    for (const s of [-1, 1]) { const hood = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), m); hood.position.set(s * 0.2, 0.02, -0.03); g.add(hood); const drop = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.013, 6, 12, Math.PI), tape); drop.rotation.y = Math.PI / 2; drop.position.set(s * 0.21, -0.06, 0.0); drop.rotation.z = Math.PI / 2; g.add(drop); }
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.12), m); stem.position.set(0, -0.005, 0.06); g.add(stem);
    const comp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.09), new THREE.MeshBasicMaterial({ color: 0x0b0f14 })); comp.position.set(0, 0.012, -0.05); g.add(comp);
    g.position.set(0, -0.36, -0.5); g.rotation.x = 0.25; return g;
  }

  setRider(obj, s, lateral, cadence, speed, dt) {
    const p = this.route.at(s), nx = Math.cos(p.h), nz = -Math.sin(p.h);
    obj.position.set(p.x + nx * lateral, p.y + 0.06, p.z + nz * lateral);
    obj.rotation.set(0, p.h, 0); obj.rotateX(-Math.atan(p.g / 100));
    const u = obj.userData; if (u.w1) { u.w1.rotation.x -= speed / 0.34 * dt; u.w2.rotation.x = u.w1.rotation.x; const ph = (u.ph = (u.ph || 0) + cadence / 60 * Math.PI * 2 * dt); u.legL.rotation.x = Math.sin(ph) * 0.5; u.legR.rotation.x = -Math.sin(ph) * 0.5; }
  }

  updateCamera(s, lateral, cadence, dt, t) {
    const r = this.route, p = r.at(s); const look = r.at(Math.min(r.length, s + 22));
    const nx = Math.cos(p.h), nz = -Math.sin(p.h), lnx = Math.cos(look.h), lnz = -Math.sin(look.h);
    const bob = Math.sin(t * cadence / 60 * Math.PI * 2) * 0.012 * Math.min(1, cadence / 60);
    const sway = Math.sin(t * cadence / 60 * Math.PI) * 0.01;
    if (this.view === 'first') {
      this.camera.position.set(p.x + nx * lateral + sway * nx, p.y + 1.55 + bob, p.z + nz * lateral + sway * nz);
      this.camera.lookAt(look.x + lnx * lateral, look.y + 1.2, look.z + lnz * lateral); this.cockpit.visible = true;
    } else {
      const back = r.at(Math.max(0, s - 7));
      this.camera.position.set(back.x + Math.cos(back.h) * lateral, back.y + 3.2, back.z - Math.sin(back.h) * lateral);
      this.camera.lookAt(p.x + nx * lateral, p.y + 1.2, p.z + nz * lateral); this.cockpit.visible = false;
    }
    const cx = this.camera.position.x, cz = this.camera.position.z;
    this.sky.position.set(cx, 0, cz); if (this.peaks) this.peaks.position.set(cx, r.minE, cz);
    if (this.water) { this.water.position.x = cx; this.water.position.z = cz; }
    this.ensureTiles(cx, cz, false);
  }
  render() { this.renderer.render(this.scene, this.camera); }
}
