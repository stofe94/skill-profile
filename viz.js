/* Schematic visuals for the skill profile. All drawings are illustrations, not model results. */
(function () {
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function lerp(a, b, t) { return a + (b - a) * t; }
  /* blue -> teal -> orange, the same scale as the hero mesh */
  function cmap(t, a) {
    t = Math.max(0, Math.min(1, t)); var r, g, b;
    if (t < 0.5) { var u = t / 0.5; r = lerp(37, 0, u); g = lerp(64, 166, u); b = lerp(217, 156, u); }
    else { var v = (t - 0.5) / 0.5; r = lerp(0, 255, v); g = lerp(166, 106, v); b = lerp(156, 61, v); }
    return 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + (a == null ? 1 : a) + ')';
  }
  function token(el, name, fallback) {
    var v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* canvas with device-pixel-ratio handling and resize */
  function surface(canvas, onResize) {
    var ctx = canvas.getContext('2d'), s = { ctx: ctx, w: 1, h: 1 };
    var ready = false;
    function fit() {
      var r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.w = Math.max(1, r.width); s.h = Math.max(1, r.height);
      canvas.width = Math.round(s.w * dpr); canvas.height = Math.round(s.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (ready && onResize) onResize();
    }
    fit(); ready = true;
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(canvas);
    else window.addEventListener('resize', fit);
    return s;
  }
  function watchVisible(el, state) {
    state.visible = true;
    if (!('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (es) { state.visible = es[0].isIntersecting; }, { threshold: 0.05 }).observe(el);
  }

  /* ---------------------------------------------------------------
     1. Plate under impact: a mesh graph deforming step by step (rollout)
     --------------------------------------------------------------- */
  function plate(canvas) {
    var NX = 34, NY = 5, T = 0.075, STEPS = 40;
    var ref = [], tris = [];
    for (var j = 0; j < NY; j++) for (var i = 0; i < NX; i++) ref.push([i / (NX - 1), (j / (NY - 1)) * T]);
    function id(i, j) { return j * NX + i; }
    for (var j2 = 0; j2 < NY - 1; j2++) for (var i2 = 0; i2 < NX - 1; i2++) {
      var a = id(i2, j2), b = id(i2 + 1, j2), c = id(i2, j2 + 1), d = id(i2 + 1, j2 + 1);
      if ((i2 + j2) % 2) { tris.push([a, b, d]); tris.push([a, d, c]); } else { tris.push([a, b, c]); tris.push([b, d, c]); }
    }
    var edges = {}, edgeList = [];
    tris.forEach(function (t) {
      [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(function (e) {
        var k = Math.min(e[0], e[1]) + '-' + Math.max(e[0], e[1]);
        if (!edges[k]) { edges[k] = 1; edgeList.push(e); }
      });
    });

    var st = { step: 0, xc: 0.5, hold: 0, scale: 1 };
    var s = surface(canvas, function () { draw(); });
    watchVisible(canvas, st);

    function phi(x, xc) { return x < xc ? 0.5 * x / xc : 0.5 + 0.5 * (x - xc) / (1 - xc); }
    function deform(step) {
      var p = step / STEPS, gap = Math.max(0, (0.22 - p) / 0.22);
      var depth = 0.15 * ease(Math.max(0, (p - 0.22) / 0.78));
      var out = [];
      for (var k = 0; k < ref.length; k++) {
        var x = ref[k][0], z = ref[k][1];
        var bend = Math.pow(Math.sin(Math.PI * phi(x, st.xc)), 2);
        var dent = Math.exp(-Math.pow((x - st.xc) / 0.055, 2)) * (1 - 0.55 * z / T);
        var v = depth * (0.72 * bend + 0.28 * dent);
        var h = 1e-3, xb = Math.min(1, x + h);
        var vb = depth * (0.72 * Math.pow(Math.sin(Math.PI * phi(xb, st.xc)), 2));
        var slope = (vb - depth * 0.72 * bend) / h;
        out.push([x - (z - T / 2) * slope * 0.9, z + v]);
      }
      return { pts: out, depth: depth, gap: gap };
    }
    function strain(P, Q) {
      var a1 = P[1][0] - P[0][0], a2 = P[2][0] - P[0][0], b1 = P[1][1] - P[0][1], b2 = P[2][1] - P[0][1];
      var det = a1 * b2 - a2 * b1; if (!det) return 0;
      var i11 = b2 / det, i12 = -a2 / det, i21 = -b1 / det, i22 = a1 / det;
      var c1 = Q[1][0] - Q[0][0], c2 = Q[2][0] - Q[0][0], d1 = Q[1][1] - Q[0][1], d2 = Q[2][1] - Q[0][1];
      var F11 = c1 * i11 + c2 * i21, F12 = c1 * i12 + c2 * i22, F21 = d1 * i11 + d2 * i21, F22 = d1 * i12 + d2 * i22;
      var E11 = 0.5 * (F11 * F11 + F21 * F21 - 1), E22 = 0.5 * (F12 * F12 + F22 * F22 - 1), E12 = 0.5 * (F11 * F12 + F21 * F22);
      return Math.sqrt(Math.max(0, E11 * E11 + E22 * E22 - E11 * E22 + 3 * E12 * E12));
    }
    function calibrate() {
      var D = deform(STEPS).pts, m = 1e-9;
      tris.forEach(function (t) {
        var v = strain([ref[t[0]], ref[t[1]], ref[t[2]]], [D[t[0]], D[t[1]], D[t[2]]]);
        if (v > m) m = v;
      });
      st.scale = m * 0.8;
    }

    function draw() {
      var ctx = s.ctx, W = s.w, H = s.h;
      ctx.clearRect(0, 0, W, H);
      var L = Math.min(W - 2 * Math.max(26, W * 0.07), (H * 0.62) / 0.23), mx = (W - L) / 2, oy = H * 0.36;
      function X(x) { return mx + x * L; }
      function Y(z) { return oy + z * L; }
      var D = deform(st.step), P = D.pts;
      var line = token(canvas, '--line-strong', '#BFC8D4'), muted = token(canvas, '--muted', '#5F6A78');
      var muted2 = token(canvas, '--muted-2', '#8A94A2'), mono = token(canvas, '--f-mono', 'monospace');

      // clamped supports
      ctx.fillStyle = line;
      var sw = Math.max(10, mx * 0.45), th = T * L;
      ctx.fillRect(mx - sw, oy - th * 0.6, sw, th * 2.2);
      ctx.fillRect(mx + L, oy - th * 0.6, sw, th * 2.2);

      // triangles and edges coloured by strain
      tris.forEach(function (t) {
        var v = strain([ref[t[0]], ref[t[1]], ref[t[2]]], [P[t[0]], P[t[1]], P[t[2]]]) / st.scale;
        ctx.beginPath();
        ctx.moveTo(X(P[t[0]][0]), Y(P[t[0]][1])); ctx.lineTo(X(P[t[1]][0]), Y(P[t[1]][1])); ctx.lineTo(X(P[t[2]][0]), Y(P[t[2]][1]));
        ctx.closePath(); ctx.fillStyle = cmap(v, 0.38); ctx.fill();
      });
      ctx.lineWidth = 0.8;
      edgeList.forEach(function (e) {
        var mid = (P[e[0]][1] - ref[e[0]][1] + P[e[1]][1] - ref[e[1]][1]) / 2 / 0.15;
        ctx.strokeStyle = cmap(Math.min(1, mid * 1.1), 0.75);
        ctx.beginPath(); ctx.moveTo(X(P[e[0]][0]), Y(P[e[0]][1])); ctx.lineTo(X(P[e[1]][0]), Y(P[e[1]][1])); ctx.stroke();
      });
      for (var k = 0; k < P.length; k++) {
        var dv = (P[k][1] - ref[k][1]) / 0.15;
        ctx.fillStyle = cmap(Math.min(1, dv * 1.1), 1);
        ctx.beginPath(); ctx.arc(X(P[k][0]), Y(P[k][1]), 1.6, 0, Math.PI * 2); ctx.fill();
      }

      // impactor
      var R = 0.06, topAtXc = 0;
      for (var q = 0; q < NX; q++) if (Math.abs(ref[q][0] - st.xc) < 0.5 / (NX - 1) + 1e-9) topAtXc = P[q][1];
      var cy = topAtXc - R - D.gap * 0.16;
      ctx.beginPath(); ctx.arc(X(st.xc), Y(cy), R * L, 0, Math.PI * 2);
      ctx.fillStyle = line; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = muted2; ctx.stroke();

      // labels
      var fs = Math.max(10, Math.min(12, W / 60));
      ctx.font = '500 ' + fs + 'px ' + mono; ctx.fillStyle = muted; ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left'; ctx.fillText('rollout step ' + st.step + ' / ' + STEPS, mx - sw, H - 12);
      ctx.textAlign = 'right'; ctx.fillText('schematic', mx + L + sw, H - 12);
    }

    calibrate();
    if (reduce) { st.step = STEPS; draw(); return; }
    var last = 0;
    (function loop(ts) {
      requestAnimationFrame(loop);
      if (!st.visible || ts === undefined) return;
      if (ts - last < 110) return; last = ts;
      if (st.step < STEPS) { st.step++; }
      else if (++st.hold > 12) { st.hold = 0; st.step = 0; st.xc = 0.36 + Math.random() * 0.28; calibrate(); }
      draw();
    })();
  }

  /* ---------------------------------------------------------------
     2. Signals: simulated vs. test channels, rated like an expert would
     --------------------------------------------------------------- */
  function signals(canvas) {
    var N = 3, RATINGS = [['excellent', '--teal'], ['good', '--cool'], ['fair', '--hot'], ['poor', '--hot']];
    var st = { t0: null, ch: [] };
    var s = surface(canvas, function () { if (reduce) draw(1, 1); });
    watchVisible(canvas, st);

    function g(t, c, w) { return Math.exp(-Math.pow((t - c) / w, 2)); }
    function newCycle() {
      st.ch = [];
      var qs = [Math.random() * 0.25, 0.25 + Math.random() * 0.3, 0.5 + Math.random() * 0.45].sort(function () { return Math.random() - 0.5; });
      for (var c = 0; c < N; c++) {
        st.ch.push({
          c1: 0.26 + Math.random() * 0.12, w1: 0.07 + Math.random() * 0.04, a2: 0.35 + Math.random() * 0.35,
          f: 3 + Math.random() * 3, q: qs[c], sign: Math.random() < 0.5 ? -1 : 1, ph: Math.random() * 6
        });
      }
    }
    function refv(p, t) { return g(t, p.c1, p.w1) - p.a2 * g(t, p.c1 + 0.17, p.w1 * 1.6) + 0.18 * Math.sin(2 * Math.PI * p.f * t) * g(t, 0.62, 0.22); }
    function simv(p, t) {
      var sh = p.q * 0.06, gain = 1 + p.sign * p.q * 0.3;
      return gain * refv(p, t - sh) + p.q * 0.22 * Math.sin(2 * Math.PI * (p.f + 1.7) * t + p.ph) * g(t, 0.55, 0.3);
    }
    function rating(q) { return RATINGS[q < 0.25 ? 0 : q < 0.5 ? 1 : q < 0.75 ? 2 : 3]; }

    function draw(prog, reveal) {
      var ctx = s.ctx, W = s.w, H = s.h;
      ctx.clearRect(0, 0, W, H);
      var mono = token(canvas, '--f-mono', 'monospace'), body = token(canvas, '--f-body', 'sans-serif');
      var muted = token(canvas, '--muted', '#5F6A78'), muted2 = token(canvas, '--muted-2', '#8A94A2');
      var lineC = token(canvas, '--line', '#D6DDE6'), cool = token(canvas, '--cool', '#2540D9'), ink = token(canvas, '--ink', '#0E1420');
      var rw = Math.max(78, Math.min(130, W * 0.2)), x0 = 8, x1 = W - rw - 14, top = 6, sh = (H - top) / N;
      var fs = Math.max(10, Math.min(12, W / 60));
      for (var c = 0; c < N; c++) {
        var p = st.ch[c], y0 = top + c * sh, mid = y0 + sh * 0.56, amp = sh * 0.3;
        ctx.strokeStyle = lineC; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x0, mid); ctx.lineTo(x1, mid); ctx.stroke();
        ctx.font = '500 ' + fs + 'px ' + mono; ctx.fillStyle = muted; ctx.textAlign = 'left';
        ctx.fillText('channel ' + (c + 1), x0, y0 + fs + 4);
        var n = 160, upto = Math.round(n * prog);
        // test signal (reference), dashed
        ctx.strokeStyle = muted2; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]); ctx.beginPath();
        for (var i = 0; i <= upto; i++) { var t = i / n, xx = lerp(x0, x1, t), yy = mid - amp * refv(p, t); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
        ctx.stroke(); ctx.setLineDash([]);
        // simulation
        ctx.strokeStyle = cool; ctx.lineWidth = 2; ctx.beginPath();
        for (var k = 0; k <= upto; k++) { var t2 = k / n, x2 = lerp(x0, x1, t2), y2 = mid - amp * simv(p, t2); k ? ctx.lineTo(x2, y2) : ctx.moveTo(x2, y2); }
        ctx.stroke();
        // rating
        if (reveal > 0) {
          var r = rating(p.q), col = token(canvas, r[1], cool);
          ctx.globalAlpha = reveal;
          ctx.font = '500 ' + (fs - 1) + 'px ' + mono; ctx.fillStyle = muted2; ctx.fillText('rating', x1 + 18, mid - 9);
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x1 + 22, mid + 6, 4, 0, Math.PI * 2); ctx.fill();
          ctx.font = '600 ' + (fs + 2) + 'px ' + body; ctx.fillStyle = ink; ctx.fillText(r[0], x1 + 32, mid + 11);
          ctx.globalAlpha = 1;
        }
      }
      // cursor
      if (prog < 1) {
        var cx = lerp(x0, x1, prog);
        ctx.strokeStyle = muted2; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, H - 4); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }

    newCycle();
    if (reduce) { draw(1, 1); return; }
    var DRAW = 2600, FADE = 400, HOLD = 2400;
    (function loop(ts) {
      requestAnimationFrame(loop);
      if (!st.visible || ts === undefined) return;
      if (st.t0 === null) st.t0 = ts;
      var e = ts - st.t0;
      if (e > DRAW + FADE + HOLD) { st.t0 = ts; newCycle(); e = 0; }
      draw(Math.min(1, e / DRAW), Math.max(0, Math.min(1, (e - DRAW) / FADE)));
    })();
  }

  /* ---------------------------------------------------------------
     3. CBR loop: retrieve -> reuse -> revise -> retain, with case memory
     --------------------------------------------------------------- */
  function cbr(svg) {
    var NS = 'http://www.w3.org/2000/svg';
    var cx = 320, cy = 220, R = 130, memC = [320, 204];
    var tokenEl = svg.querySelector('.cbr-token'), casesG = svg.querySelector('.cbr-cases');
    var countEl = svg.querySelector('.cbr-count');
    var st = { exp: 1, cases: [], visible: true };
    watchVisible(svg, st);
    var stations = { retrieve: -90, reuse: 0, revise: 90, retain: 180 };

    function slot(n) { var a = n * 2.39996, r = 8 * Math.sqrt(n + 0.6); return [memC[0] + r * Math.cos(a), memC[1] + r * Math.sin(a) * 0.9]; }
    function addCase(animate) {
      var n = st.cases.length, p = slot(n), c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', p[0].toFixed(1)); c.setAttribute('cy', p[1].toFixed(1)); c.setAttribute('r', animate ? '0' : '4.5');
      c.setAttribute('class', 'cbr-case'); casesG.appendChild(c); st.cases.push(c);
      if (animate) requestAnimationFrame(function () { c.setAttribute('r', '4.5'); });
    }
    function resetCases() { while (casesG.firstChild) casesG.removeChild(casesG.firstChild); st.cases = []; for (var i = 0; i < 4; i++) addCase(false); }
    function setOn(name, on) {
      var g = svg.querySelector('[data-st="' + name + '"]'); if (g) g.classList.toggle('on', on);
      var l = svg.querySelector('[data-link="' + name + '"]'); if (l) l.classList.toggle('on', on);
    }
    function place(deg) {
      var a = deg * Math.PI / 180;
      tokenEl.setAttribute('cx', (cx + R * Math.cos(a)).toFixed(1)); tokenEl.setAttribute('cy', (cy + R * Math.sin(a)).toFixed(1));
    }
    function label() { countEl.textContent = 'experiment ' + st.exp + ' · ' + st.cases.length + ' cases'; }

    resetCases(); place(-90); label();
    if (reduce) { addCase(false); addCase(false); place(0); setOn('reuse', true); label(); return; }

    function wait(ms) { return new Promise(function (r) { (function chk() { if (st.visible) setTimeout(r, ms); else setTimeout(chk, 400); })(); }); }
    function move(from, to, ms) {
      return new Promise(function (res) {
        var t0 = null;
        (function f(ts) {
          if (t0 === null) t0 = ts;
          var k = Math.min(1, (ts - t0) / ms); place(from + (to - from) * ease(k));
          if (k < 1) requestAnimationFrame(f); else res();
        })(performance.now());
      });
    }
    async function run() {
      for (;;) {
        tokenEl.classList.remove('rej'); tokenEl.style.opacity = '1'; place(-90);
        setOn('retrieve', true);
        var hit = st.cases[Math.floor(Math.random() * st.cases.length)]; if (hit) hit.classList.add('hit');
        await wait(1100); setOn('retrieve', false); if (hit) hit.classList.remove('hit');
        await move(-90, 0, 900); setOn('reuse', true); await wait(900); setOn('reuse', false);
        await move(0, 90, 900); setOn('revise', true); await wait(900);
        var pass = Math.random() < 0.7;
        setOn('revise', false);
        if (!pass) {
          tokenEl.classList.add('rej'); await wait(700); tokenEl.style.opacity = '0'; await wait(500);
        } else {
          await move(90, 180, 900); setOn('retain', true); addCase(true); label(); await wait(1000); setOn('retain', false);
          await move(180, 270, 900);
        }
        st.exp++; if (st.cases.length >= 16) resetCases(); label();
      }
    }
    run();
  }

  function boot() {
    Array.prototype.forEach.call(document.querySelectorAll('canvas[data-viz="plate"]'), plate);
    Array.prototype.forEach.call(document.querySelectorAll('canvas[data-viz="signals"]'), signals);
    Array.prototype.forEach.call(document.querySelectorAll('svg[data-viz="cbr"]'), cbr);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
