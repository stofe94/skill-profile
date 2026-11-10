/* CrashDefNet hero: a 3D schematic of an autoregressive rollout.
   A bumper beam with two crash boxes hits a rigid pole. Every rollout step predicts the next
   state from the current one; contact edges (orange) are rebuilt from the predicted geometry.
   The deformation is an analytic illustration, not a model result.
   Needs WebGL and three.js (loaded on demand); otherwise falls back to the 2D plate in viz.js. */
(function () {
  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
  var hosts = document.querySelectorAll('[data-viz="crash3d"]');
  if (!hosts.length) return;

  function fallback(host) {
    host.innerHTML = '';
    host.classList.add('is-fallback');
    var c = document.createElement('canvas');
    c.className = 'viz viz-plate';
    c.setAttribute('data-viz', 'plate');
    host.appendChild(c);
    if (window.SkillViz && window.SkillViz.plate) window.SkillViz.plate(c);
  }
  function hasWebGL() {
    try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); }
    catch (e) { return false; }
  }
  if (!hasWebGL()) { Array.prototype.forEach.call(hosts, fallback); return; }

  import(THREE_URL).then(function (THREE) {
    Array.prototype.forEach.call(hosts, function (h) {
      try { scene3d(THREE, h); } catch (e) { if (window.console) console.warn('crash3d:', e); fallback(h); }
    });
  }).catch(function () { Array.prototype.forEach.call(hosts, fallback); });

  /* ================================================================= */
  function scene3d(THREE, host) {
    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var STEPS = 10;

    /* ---------- geometry constants (metres) ---------- */
    var LB = 1.30, HB = 0.10, DB = 0.07;          // beam length, height, depth
    var XBOX = 0.42, ABOX = 0.08, LBOX = 0.17;    // crash box position, section, length
    var R = 0.127, POLE_Y0 = -0.24, POLE_Y1 = 0.30; // pole radius (254 mm diameter)
    var GAP0 = 0.09, DMAX = 0.21, RW = 0.034, EPS = 0.007, DMIN = 0.018;
    function zc(x) { var u = x / (LB / 2); return -0.10 * u * u; }

    /* ---------- colour ---------- */
    function css(name, fb) { var v = getComputedStyle(host).getPropertyValue(name).trim(); return v || fb; }
    var LUT = [];
    (function () {
      function lerp(a, b, t) { return a + (b - a) * t; }
      var c = new THREE.Color();
      for (var i = 0; i < 256; i++) {
        var t = i / 255, r, g, b;
        if (t < 0.5) { var u = t / 0.5; r = lerp(37, 0, u); g = lerp(64, 166, u); b = lerp(217, 156, u); }
        else { var v = (t - 0.5) / 0.5; r = lerp(0, 255, v); g = lerp(166, 106, v); b = lerp(156, 61, v); }
        c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        LUT.push([c.r, c.g, c.b]);
      }
    })();

    /* ---------- deformable mesh (beam + crash boxes) ---------- */
    var P = [];      // per-vertex parameters
    var tris = [];   // triangle indices
    var quadEdges = []; // mesh lines (quad edges, no diagonals)
    function grid(nu, nv, make) {
      var base = P.length;
      for (var j = 0; j <= nv; j++) for (var i = 0; i <= nu; i++) P.push(make(i / nu, j / nv));
      for (var j2 = 0; j2 < nv; j2++) for (var i2 = 0; i2 < nu; i2++) {
        var a = base + j2 * (nu + 1) + i2, b = a + 1, c = a + nu + 1, d = c + 1;
        tris.push(a, b, d, a, d, c);
        quadEdges.push(a, b, a, c);
        if (i2 === nu - 1) quadEdges.push(b, d);
        if (j2 === nv - 1) quadEdges.push(c, d);
      }
    }
    var NXB = 104, NYB = 8, NEB = 6;
    // beam faces: x along the beam, y height, eta 0 = back face, 1 = front face (towards the pole)
    grid(NXB, NYB, function (u, v) { return { k: 0, x: (u - 0.5) * LB, y: (v - 0.5) * HB, e: 1, f: 'front' }; });
    grid(NXB, NYB, function (u, v) { return { k: 0, x: (u - 0.5) * LB, y: (v - 0.5) * HB, e: 0, f: 'back' }; });
    grid(NXB, NEB, function (u, v) { return { k: 0, x: (u - 0.5) * LB, y: HB / 2, e: v, f: 'top' }; });
    grid(NXB, NEB, function (u, v) { return { k: 0, x: (u - 0.5) * LB, y: -HB / 2, e: v, f: 'bottom' }; });
    // end caps of the beam
    [-1, 1].forEach(function (s) {
      grid(NEB, NYB, function (u, v) { return { k: 0, x: s * LB / 2, y: (v - 0.5) * HB, e: u, f: 'cap' }; });
    });
    // crash boxes: xi 0 = mount, 1 = beam; s across the face in [-1, 1]
    var NXI = 18, NS = 6;
    [-XBOX, XBOX].forEach(function (xb) {
      [-1, 1].forEach(function (side) {
        grid(NXI, NS, function (u, v) { return { k: 1, xb: xb, xi: u, ox: side * ABOX / 2, oy: (v - 0.5) * ABOX, s: v * 2 - 1, nx: side, ny: 0 }; });
        grid(NXI, NS, function (u, v) { return { k: 1, xb: xb, xi: u, ox: (v - 0.5) * ABOX, oy: side * ABOX / 2, s: v * 2 - 1, nx: 0, ny: side }; });
      });
    });
    var NV = P.length;

    // neighbours for the strain measure (unique quad edges)
    var eKey = {}, E = [];
    for (var q = 0; q < quadEdges.length; q += 2) {
      var a0 = Math.min(quadEdges[q], quadEdges[q + 1]), b0 = Math.max(quadEdges[q], quadEdges[q + 1]);
      var key = a0 * 65536 + b0;
      if (!eKey[key]) { eKey[key] = 1; E.push(a0, b0); }
    }
    var NE = E.length / 2;
    var restLen = new Float32Array(NE), deg = new Float32Array(NV);
    for (var ei = 0; ei < NE; ei++) { deg[E[2 * ei]]++; deg[E[2 * ei + 1]]++; }

    /* ---------- state per cycle ---------- */
    var st = { xp: 0.12, zp: 0, dmax: DMAX, S: 0, kL: 0, kR: 0, wb: 0, scale: 1 };
    function newCycle(first) {
      var r = first ? 0.62 : Math.random();
      st.xp = (r - 0.5) * 0.84;                         // pole across the beam, about -420..+420 mm
      st.dmax = DMAX * (0.88 + (first ? 0.6 : Math.random()) * 0.24);
      st.zp = zc(st.xp) + DB / 2 + R + GAP0;
    }

    /* intrusion beyond first contact A -> crash box crush and beam bending */
    function setLoad(A) {
      var t = (st.xp + XBOX) / (2 * XBOX);
      st.kL = A * 0.30 * (1 - 0.7 * (t - 0.5));
      st.kR = A * 0.30 * (1 + 0.7 * (t - 0.5));
      st.wb = A * 0.46;
    }
    function kOf(x) { var t = (x + XBOX) / (2 * XBOX); return st.kL + (st.kR - st.kL) * t; }
    function wOf(x) {
      var d = x - st.xp;
      return st.wb * (0.55 * Math.exp(-(d * d) / 0.040) + 0.45 * Math.exp(-(d * d) / 0.25));
    }

    /* beam section at x: back point B and (projected) front point F in the xz plane */
    var tmpB = [0, 0], tmpF = [0, 0], crush = 0;
    function section(x) {
      var base = zc(x) + st.S - kOf(x) - wOf(x);
      var zB = base - DB / 2, xF = x, zF = base + DB / 2;
      var dx = xF - st.xp, dz = zF - st.zp, r = Math.sqrt(dx * dx + dz * dz), RR = R + EPS;
      if (r < RR) { xF = st.xp + dx / r * RR; zF = st.zp + dz / r * RR; }
      if (zF - zB < DMIN) zB = zF - DMIN;
      tmpB[0] = x; tmpB[1] = zB; tmpF[0] = xF; tmpF[1] = zF;
      crush = Math.max(0, Math.min(1, 1 - (zF - zB) / DB));
    }

    function place(p, out, o) {
      if (p.k === 0) {
        section(p.x);
        var e = p.e, x = tmpB[0] + (tmpF[0] - tmpB[0]) * e, z = tmpB[1] + (tmpF[1] - tmpB[1]) * e;
        var y = p.y * (1 + 0.30 * crush);
        if (p.f === 'top' || p.f === 'bottom') {
          var m = 4 * e * (1 - e);
          y += Math.sign(p.y) * crush * m * (0.016 + 0.006 * Math.sin(p.x * 130));
        } else if (p.f === 'front') {
          z -= crush * 0.006 * Math.sin(p.x * 150) * (1 - Math.pow(2 * p.y / HB, 2));
        }
        out[o] = x; out[o + 1] = y; out[o + 2] = z;
        return;
      }
      // crash box node: attach end follows the beam's back face at the same x and y
      var xa = p.xb + p.ox;
      section(xa);
      var zAtt = tmpB[1];
      var zMount = zc(p.xb) - DB / 2 - LBOX + st.S;
      var eps = Math.max(0, Math.min(0.74, 1 - (zAtt - zMount) / LBOX));
      var xi0 = Math.max(0, 1 - eps / 0.75), z;
      if (p.xi <= xi0) z = zMount + LBOX * p.xi;
      else z = zMount + LBOX * xi0 + 0.25 * LBOX * (p.xi - xi0);
      var fold = 0;
      if (p.xi > xi0 && xi0 < 1) {
        var ph = (p.xi - xi0) * LBOX / 0.03 * Math.PI;
        fold = 0.013 * Math.sin(ph) * (1 - p.s * p.s) * (p.nx ? 1 : -1) * Math.min(1, eps * 4);
      }
      out[o] = xa + p.nx * fold;
      out[o + 1] = p.oy + p.ny * fold;
      out[o + 2] = z;
    }

    var pos = new Float32Array(NV * 3), col = new Float32Array(NV * 3), strain = new Float32Array(NV), sm = new Float32Array(NV);
    function deformAll() { for (var i = 0; i < NV; i++) place(P[i], pos, i * 3); }
    function computeStrain(out) {
      out.fill(0);
      for (var e = 0; e < NE; e++) {
        var a = E[2 * e] * 3, b = E[2 * e + 1] * 3;
        var dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
        var s = Math.abs(Math.sqrt(dx * dx + dy * dy + dz * dz) / restLen[e] - 1);
        out[E[2 * e]] += s; out[E[2 * e + 1]] += s;
      }
      for (var i = 0; i < NV; i++) out[i] /= Math.max(1, deg[i]);
      for (var pass = 0; pass < 2; pass++) {               // light smoothing along the mesh
        sm.fill(0);
        for (var e2 = 0; e2 < NE; e2++) { var a2 = E[2 * e2], b2 = E[2 * e2 + 1]; sm[a2] += out[b2]; sm[b2] += out[a2]; }
        for (var k = 0; k < NV; k++) out[k] = 0.5 * out[k] + 0.5 * sm[k] / Math.max(1, deg[k]);
      }
    }
    function computeRest() {
      var keep = st.S; st.S = 0; setLoad(0); deformAll(); st.S = keep;
      for (var e = 0; e < NE; e++) {
        var a = E[2 * e] * 3, b = E[2 * e + 1] * 3;
        var dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
        restLen[e] = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
    }
    function calibrate() {
      st.S = GAP0 + st.dmax; setLoad(st.dmax); deformAll(); computeStrain(strain);
      var v = Array.prototype.slice.call(strain).sort(function (a, b) { return a - b; });
      st.scale = Math.max(1e-6, v[Math.floor(v.length * 0.94)]);
    }

    /* ---------- three.js scene ---------- */
    var canvas = document.createElement('canvas');
    canvas.className = 'c3-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(26, 2, 0.05, 20);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3b2, 1.55));
    var key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(-1.2, 2.4, 2.0); scene.add(key);
    var rim = new THREE.DirectionalLight(0xffffff, 0.7); rim.position.set(1.6, 0.8, -1.8); scene.add(rim);

    var geo = new THREE.BufferGeometry();
    var posAttr = new THREE.BufferAttribute(pos, 3); posAttr.setUsage(THREE.DynamicDrawUsage);
    var colAttr = new THREE.BufferAttribute(col, 3); colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr); geo.setAttribute('color', colAttr); geo.setIndex(tris);
    var mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    var mesh = new THREE.Mesh(geo, mat); scene.add(mesh);

    var lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', posAttr); lgeo.setIndex(quadEdges);
    var lmat = new THREE.LineBasicMaterial({ color: 0x0b1222, transparent: true, opacity: 0.22 });
    scene.add(new THREE.LineSegments(lgeo, lmat));

    // mount plates of the rigid body behind the crash boxes (move with the structure)
    var rigid = new THREE.Group();
    var rmat = new THREE.MeshStandardMaterial({ color: 0x8e98a8, roughness: 0.7, metalness: 0.1 });
    [-XBOX, XBOX].forEach(function (xb) {
      var plate = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.012), rmat);
      plate.position.set(xb, 0, zc(xb) - DB / 2 - LBOX - 0.006); rigid.add(plate);
    });
    scene.add(rigid);

    // the pole: translucent, with its own surface mesh (it acts through contact edges)
    var poleGroup = new THREE.Group();
    var PH = POLE_Y1 - POLE_Y0, PSEG = 40;
    var pmat = new THREE.MeshStandardMaterial({ color: 0x9aa4b4, roughness: 0.45, metalness: 0.2, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(R, R, PH, PSEG, 1, false), pmat);
    pole.position.y = (POLE_Y0 + POLE_Y1) / 2; pole.renderOrder = 2; poleGroup.add(pole);
    var pl = [], ringStep = 0.025, ringDraw = 0.05;
    for (var yy = POLE_Y0; yy <= POLE_Y1 + 1e-6; yy += ringDraw)
      for (var s2 = 0; s2 < PSEG; s2++) {
        var a1 = s2 / PSEG * Math.PI * 2, a2 = (s2 + 1) / PSEG * Math.PI * 2;
        pl.push(R * Math.sin(a1), yy, R * Math.cos(a1), R * Math.sin(a2), yy, R * Math.cos(a2));
        if (yy + ringDraw <= POLE_Y1 + 1e-6) pl.push(R * Math.sin(a1), yy, R * Math.cos(a1), R * Math.sin(a1), yy + ringDraw, R * Math.cos(a1));
      }
    var plg = new THREE.BufferGeometry(); plg.setAttribute('position', new THREE.Float32BufferAttribute(pl, 3));
    var plm = new THREE.LineBasicMaterial({ color: 0x5f6a78, transparent: true, opacity: 0.28, depthWrite: false });
    poleGroup.add(new THREE.LineSegments(plg, plm));
    scene.add(poleGroup);
    // pole nodes near the beam height: candidates for contact edges
    var poleNodes = [];
    for (var yn = -0.075; yn <= 0.075 + 1e-6; yn += ringStep)
      for (var sn = 0; sn < PSEG; sn++) { var an = sn / PSEG * Math.PI * 2; poleNodes.push([R * Math.sin(an), yn, R * Math.cos(an)]); }

    // contact edges + their end nodes
    var MAXC = 420;
    var cpos = new Float32Array(MAXC * 6), cgeo = new THREE.BufferGeometry();
    var cattr = new THREE.BufferAttribute(cpos, 3); cattr.setUsage(THREE.DynamicDrawUsage);
    cgeo.setAttribute('position', cattr); cgeo.setDrawRange(0, 0);
    var cmat = new THREE.LineBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.95 });
    var contact = new THREE.LineSegments(cgeo, cmat); contact.renderOrder = 3; scene.add(contact);
    var dgeo = new THREE.BufferGeometry(); dgeo.setAttribute('position', cattr); dgeo.setDrawRange(0, 0);
    var dmat = new THREE.PointsMaterial({ color: 0xff6a3d, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0.95 });
    var dots = new THREE.Points(dgeo, dmat); dots.renderOrder = 3; scene.add(dots);

    // floor grid that fades out with distance
    var gl = [], gc = [], G = 1.6, GS = 0.1, GY = POLE_Y0;
    function gpush(x1, z1, x2, z2) {
      var n = 16;
      for (var i = 0; i < n; i++) {
        var t1 = i / n, t2 = (i + 1) / n;
        var ax = x1 + (x2 - x1) * t1, az = z1 + (z2 - z1) * t1, bx = x1 + (x2 - x1) * t2, bz = z1 + (z2 - z1) * t2;
        gl.push(ax, GY, az, bx, GY, bz);
        [[ax, az], [bx, bz]].forEach(function (p) {
          var r = Math.sqrt(p[0] * p[0] + (p[1] + 0.1) * (p[1] + 0.1)) / G;
          gc.push(1, 1, 1, Math.max(0, 1 - r) * Math.max(0, 1 - r));
        });
      }
    }
    for (var gx = -G; gx <= G + 1e-6; gx += GS) { gpush(gx, -G, gx, G); gpush(-G, gx, G, gx); }
    var ggeo = new THREE.BufferGeometry();
    ggeo.setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
    ggeo.setAttribute('color', new THREE.Float32BufferAttribute(gc, 4));
    var gmat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false });
    var floor = new THREE.LineSegments(ggeo, gmat); scene.add(floor);

    function applyTheme() {
      var dark = getComputedStyle(host).colorScheme === 'dark' ||
        (document.documentElement.getAttribute('data-theme') === 'dark') ||
        (document.documentElement.getAttribute('data-theme') !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      var lineStrong = new THREE.Color(css('--line-strong', '#BFC8D4'));
      gmat.color.copy(lineStrong);
      pmat.color.set(dark ? 0x7d889a : 0xa7b0be);
      pmat.opacity = dark ? 0.45 : 0.55;
      plm.color.set(dark ? 0xaab4c3 : 0x5f6a78);
      rmat.color.set(dark ? 0x5c6779 : 0x8e98a8);
      lmat.opacity = dark ? 0.32 : 0.22;
      var hot = new THREE.Color(css('--hot', '#D9501F'));
      cmat.color.copy(hot); dmat.color.copy(hot);
      host.classList.toggle('c3-dark', !!dark);
    }

    /* ---------- HUD ---------- */
    var hud = document.createElement('div'); hud.className = 'c3-hud';
    hud.innerHTML =
      '<div class="c3-row"><span class="c3-lbl">rollout step</span><span class="c3-step">0 / ' + STEPS + '</span></div>' +
      '<div class="c3-ticks">' + new Array(STEPS + 1).join('<i></i>') + '</div>' +
      '<div class="c3-row c3-sub"><span class="c3-con">contact edges 0</span><span class="c3-pole"></span></div>';
    host.appendChild(hud);
    var legend = document.createElement('div'); legend.className = 'c3-legend';
    legend.innerHTML = '<span class="c3-lbl">strain</span><span class="c3-bar"></span><span class="c3-lbl">high</span>' +
      '<span class="c3-key"><i></i>contact edge</span>';
    host.appendChild(legend);
    var hint = document.createElement('div'); hint.className = 'c3-hint'; hint.textContent = 'drag to rotate';
    host.appendChild(hint);
    var elStep = hud.querySelector('.c3-step'), elCon = hud.querySelector('.c3-con'), elPole = hud.querySelector('.c3-pole');
    var ticks = hud.querySelectorAll('.c3-ticks i');
    var lastHud = '';
    function setHud(step, ncon, live) {
      var s = step + '|' + ncon + '|' + live;
      if (s === lastHud) return; lastHud = s;
      elStep.textContent = step + ' / ' + STEPS;
      elCon.textContent = 'contact edges ' + ncon;
      elPole.textContent = 'pole at ' + (st.xp >= 0 ? '+' : '−') + Math.round(Math.abs(st.xp) * 1000) + ' mm';
      for (var i = 0; i < ticks.length; i++) {
        ticks[i].className = i < step ? 'on' : (i === step && live ? 'live' : '');
      }
    }

    /* ---------- update ---------- */
    var flash = 0;
    function updateMesh(S, A) {
      st.S = S; setLoad(A); deformAll(); computeStrain(strain);
      for (var i = 0; i < NV; i++) {
        var t = Math.min(1, strain[i] / st.scale), c = LUT[Math.round(Math.pow(t, 0.55) * 255)];
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      }
      posAttr.needsUpdate = true; colAttr.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      rigid.position.z = S;
      poleGroup.position.set(st.xp, 0, st.zp);
      return updateContact();
    }
    function updateContact() {
      var n = 0, px = st.xp, pz = st.zp;
      for (var i = 0; i < NV && n < MAXC; i++) {
        var p = P[i];
        if (p.k !== 0 || p.e < 0.99) continue;                       // front face and its edges
        if (Math.round((p.x / LB + 0.5) * NXB) % 2) continue;          // every second column
        if (p.f === 'front' && Math.round((p.y / HB + 0.5) * NYB) % 2) continue;
        var o = i * 3, x = pos[o], y = pos[o + 1], z = pos[o + 2];
        if (Math.abs(x - px) > R + RW) continue;
        var dx = x - px, dz = z - pz, r = Math.sqrt(dx * dx + dz * dz);
        if (r - R > RW) continue;
        var best = -1, bd = RW * RW;
        for (var j = 0; j < poleNodes.length; j++) {
          var q = poleNodes[j], ex = q[0] + px - x, ey = q[1] - y, ez = q[2] + pz - z, d2 = ex * ex + ey * ey + ez * ez;
          if (d2 < bd) { bd = d2; best = j; }
        }
        if (best < 0) continue;
        var qb = poleNodes[best], w = n * 6;
        cpos[w] = x; cpos[w + 1] = y; cpos[w + 2] = z;
        cpos[w + 3] = qb[0] + px; cpos[w + 4] = qb[1]; cpos[w + 5] = qb[2] + pz;
        n++;
      }
      cattr.needsUpdate = true;
      cgeo.setDrawRange(0, n * 2); dgeo.setDrawRange(0, n * 2);
      return n;
    }

    /* ---------- camera ---------- */
    // seen from the vehicle side, slightly above, as in the rollout animations of the repository
    var cam = { az: Math.PI - 0.62, el: 0.72, userAz: 0, userEl: 0, t: 0 };
    var target = new THREE.Vector3(0, -0.04, 0.06);
    function fit() {
      var r = host.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      host.classList.toggle('c3-compact', w < 520);
      target.y = w < 520 ? 0.06 : 0.02;    // keep the scene clear of the HUD
      draw();
    }
    function placeCamera() {
      var az = cam.az + cam.userAz + (reduce ? 0 : 0.42 * Math.sin(cam.t * 0.2));
      var el = Math.max(0.12, Math.min(1.25, cam.el + cam.userEl));
      var vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
      var need = Math.max(0.72 / Math.tan(hf / 2), 0.44 / Math.tan(vf / 2));
      var d = need * 1.02;
      camera.position.set(target.x + d * Math.sin(az) * Math.cos(el), target.y + d * Math.sin(el), target.z + d * Math.cos(az) * Math.cos(el));
      camera.lookAt(target);
    }
    function draw() { placeCamera(); renderer.render(scene, camera); }

    // drag to rotate (horizontal on touch, so the page still scrolls)
    var drag = null;
    canvas.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, az: cam.userAz, el: cam.userEl, id: e.pointerId };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      host.classList.add('c3-dragging');
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      cam.userAz = drag.az - (e.clientX - drag.x) * 0.008;
      cam.userEl = drag.el + (e.clientY - drag.y) * 0.006;
      host.classList.add('c3-used');
      if (reduce || !running) draw();
    });
    function endDrag() { drag = null; host.classList.remove('c3-dragging'); }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    /* ---------- timeline ---------- */
    var APPROACH = 1100, STEP = 520, MOVE = 360, HOLD = 2200, FADE = 450;
    var CYCLE = APPROACH + STEPS * STEP + HOLD;
    function frameAt(ms) {
      // returns structure translation S, intrusion A, step index and whether a step is in progress
      if (ms < APPROACH) {
        var u = ms / APPROACH, e = 1 - Math.pow(1 - u, 1.6);
        return { S: GAP0 * e * 0.999, A: 0, step: 0, live: false };
      }
      var r = ms - APPROACH, k = Math.min(STEPS, Math.floor(r / STEP)), w = r - k * STEP;
      var frac = k >= STEPS ? 0 : Math.min(1, w / MOVE), sm = frac * frac * (3 - 2 * frac);
      var p = Math.min(1, (k + sm) / STEPS);
      var A = st.dmax * (1 - Math.pow(1 - p, 1.7));
      return { S: GAP0 + A, A: A, step: Math.min(STEPS, k + (frac >= 1 ? 1 : 0)), live: k < STEPS && frac < 1 };
    }

    newCycle(true); computeRest(); calibrate();
    applyTheme();
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onTheme = function () { applyTheme(); draw(); };
      if (mq.addEventListener) mq.addEventListener('change', onTheme); else if (mq.addListener) mq.addListener(onTheme);
    }

    var running = !reduce, visible = true, lastStep = -1, clock = 0, prev = null;
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0.02 }).observe(host);
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(host); else window.addEventListener('resize', fit);

    if (reduce) {
      var f = frameAt(APPROACH + STEPS * STEP);
      setHud(STEPS, updateMesh(f.S, f.A), false);
      fit();
      host.classList.add('c3-ready');
      return;
    }

    (function loop(ts) {
      requestAnimationFrame(loop);
      if (ts === undefined || !visible) { prev = null; return; }   // paused while off screen
      if (prev !== null) {
        var dt = Math.min(64, ts - prev);
        cam.t += dt / 1000;
        clock += dt;
      }
      prev = ts;
      if (clock > CYCLE + FADE) {
        clock = 0; newCycle(false); calibrate(); lastStep = -1;
      }
      var fr = frameAt(Math.min(clock, CYCLE));
      var n = updateMesh(fr.S, fr.A);
      if (fr.step !== lastStep) { flash = 1; lastStep = fr.step; }
      flash *= 0.9;
      cmat.opacity = 0.75 + 0.25 * flash; dmat.size = 2.6 + 1.4 * flash;
      setHud(fr.step, n, fr.live);
      // fade out at the end of a cycle and back in at the start
      var o = 1;
      if (clock > CYCLE) o = Math.max(0, 1 - (clock - CYCLE) / FADE);
      else if (clock < 300) o = clock / 300;
      canvas.style.opacity = o.toFixed(3);
      draw();
    })();
    fit();
    host.classList.add('c3-ready');
  }
})();
