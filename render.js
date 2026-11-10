/**
 * 弓弦星 — original canvas renderer (staff, violin pad, result card).
 * Shared by the browser shell and the headless preview.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./engine.js"));
  } else {
    root.BowStarRender = factory(root.BowStarEngine);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (E) {
  "use strict";

  const C = {
    paper0: "#f3eee6",
    paper1: "#ebe4d8",
    ink: "#2a241c",
    inkSoft: "#5c564c",
    inkFaint: "#b5ae9f",
    line: "rgba(42,36,28,0.16)",
    guide: "rgba(42,36,28,0.14)",
    label: "#7a7468",
    taupe: "#c9bead",
    mustard: "#d4a43a",
    mustardEdge: "rgba(90,62,16,0.28)",
    trace: "#2a241c",
    wrong: "#8b3a24",
    click: "#4a3426",
    pop: "#8a847c",
    hud: "#2a241c",
    woodLight: "#d49a52",
    woodMid: "#c17a38",
    woodDeep: "#8a4a1c",
    woodEdge: "#5a2e10",
    woodShade: "#6e3814",
    board: "#16110e",
    bridge: "#f3ead8",
    hair: "#f7f4ec",
    stick: "#e6d9bf",
    stickEdge: "#b9a888",
  };

  function clamp(x, a, b) {
    return x < a ? a : x > b ? b : x;
  }

  function mapPadY(pointerY, padTop, padH) {
    if (!(padH > 0)) return 0;
    return clamp((pointerY - padTop) / padH, 0, 1);
  }

  function layout(cssW, cssH, safeTop) {
    const staffH = Math.max(120, cssH * 0.4);
    const padTop = staffH;
    const safe = safeTop || 0;
    return {
      w: cssW,
      h: cssH,
      safeTop: safe,
      hudH: safe + 58,
      staffY: 0,
      staffH: staffH,
      padTop: padTop,
      padH: cssH - padTop,
      playX: cssW * 0.24,
      pxPerSec: (cssW * 0.62) / (8 * E.BEAT),
    };
  }

  function roundedRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function staffRows(L) {
    const top = Math.max(L.hudH, 8);
    const usable = Math.max(48, L.staffH - top - 8);
    return { top: top, h: usable / 4 };
  }

  function xAt(L, t, now) {
    return L.playX + (t - now) * L.pxPerSec;
  }

  function laneMid(rows, lane) {
    return rows.top + rows.h * (lane + 0.5);
  }

  function midLanes(rows, lanes, fallback) {
    if (!lanes || !lanes.length) return fallback;
    let s = 0;
    for (let i = 0; i < lanes.length; i++) s += laneMid(rows, lanes[i]);
    return s / lanes.length;
  }

  function padBandY(L, padY) {
    return L.padTop + clamp(padY, 0, 1) * L.padH;
  }

  function padLaneCenter(L, lane) {
    return L.padTop + L.padH * ((lane + 0.5) / 4);
  }

  function seedRnd(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function drawPaper(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, C.paper0);
    g.addColorStop(1, C.paper1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const rnd = seedRnd(80211);
    ctx.save();
    ctx.globalAlpha = 0.045;
    for (let i = 0; i < 700; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = 0.4 + rnd() * 1.1;
      ctx.fillStyle = rnd() < 0.5 ? "#7a6a50" : "#fffaf0";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function violinMetrics(L) {
    const unit = (L.padH * 0.74) / 0.92;
    const cx = L.w * 0.47;
    const marginB = L.padH * 0.035;
    const cy = L.padTop + L.padH - marginB - 0.51 * unit;
    return { cx: cx, cy: cy, unit: unit };
  }

  function violinBodyPath(ctx, u) {
    // Origin at the body centre. -y toward the scroll, +y toward the tailpiece.
    // Original outline — not traced from another work.
    ctx.beginPath();
    ctx.moveTo(0, -0.42 * u);
    ctx.bezierCurveTo(-0.07 * u, -0.42 * u, -0.20 * u, -0.405 * u, -0.255 * u, -0.32 * u);
    ctx.bezierCurveTo(-0.29 * u, -0.25 * u, -0.28 * u, -0.18 * u, -0.205 * u, -0.135 * u);
    ctx.bezierCurveTo(-0.16 * u, -0.11 * u, -0.162 * u, -0.06 * u, -0.168 * u, 0.01 * u);
    ctx.bezierCurveTo(-0.172 * u, 0.07 * u, -0.175 * u, 0.11 * u, -0.215 * u, 0.16 * u);
    ctx.bezierCurveTo(-0.29 * u, 0.23 * u, -0.35 * u, 0.27 * u, -0.348 * u, 0.365 * u);
    ctx.bezierCurveTo(-0.345 * u, 0.45 * u, -0.20 * u, 0.508 * u, 0, 0.50 * u);
    ctx.bezierCurveTo(0.20 * u, 0.508 * u, 0.345 * u, 0.45 * u, 0.348 * u, 0.365 * u);
    ctx.bezierCurveTo(0.35 * u, 0.27 * u, 0.29 * u, 0.23 * u, 0.215 * u, 0.16 * u);
    ctx.bezierCurveTo(0.175 * u, 0.11 * u, 0.172 * u, 0.07 * u, 0.168 * u, 0.01 * u);
    ctx.bezierCurveTo(0.162 * u, -0.06 * u, 0.16 * u, -0.11 * u, 0.205 * u, -0.135 * u);
    ctx.bezierCurveTo(0.28 * u, -0.18 * u, 0.29 * u, -0.25 * u, 0.255 * u, -0.32 * u);
    ctx.bezierCurveTo(0.20 * u, -0.405 * u, 0.07 * u, -0.42 * u, 0, -0.42 * u);
    ctx.closePath();
  }

  function drawFHole(ctx, u, side) {
    // Original f-hole, mirrored for each side. side = -1 left, +1 right.
    ctx.save();
    ctx.scale(side, 1);
    const x = 0.155 * u;
    const y = 0.145 * u;
    const s = u;
    ctx.fillStyle = "#1a120c";
    ctx.beginPath();
    ctx.arc(x - 0.006 * s, y - 0.085 * s, 0.018 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 0.010 * s, y + 0.088 * s, 0.017 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 0.016 * s, y - 0.078 * s);
    ctx.bezierCurveTo(
      x + 0.028 * s, y - 0.050 * s,
      x - 0.030 * s, y + 0.010 * s,
      x + 0.016 * s, y + 0.070 * s
    );
    ctx.bezierCurveTo(
      x + 0.026 * s, y + 0.086 * s,
      x + 0.022 * s, y + 0.096 * s,
      x + 0.008 * s, y + 0.096 * s
    );
    ctx.bezierCurveTo(
      x - 0.034 * s, y + 0.084 * s,
      x + 0.012 * s, y + 0.016 * s,
      x - 0.028 * s, y - 0.028 * s
    );
    ctx.bezierCurveTo(
      x - 0.042 * s, y - 0.055 * s,
      x - 0.028 * s, y - 0.072 * s,
      x - 0.016 * s, y - 0.078 * s
    );
    ctx.closePath();
    ctx.fill();
    // Nicks
    ctx.fillRect(x - 0.030 * s, y - 0.006 * s, 0.048 * s, 0.011 * s);
    ctx.restore();
  }

  function drawViolin(ctx, L) {
    const m = violinMetrics(L);
    const u = m.unit;
    const cx = m.cx;
    const cy = m.cy;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, L.padTop, L.w, L.padH);
    ctx.clip();

    ctx.translate(cx, cy);

    // Soft contact shadow on the paper
    ctx.save();
    ctx.shadowColor = "rgba(60, 40, 20, 0.22)";
    ctx.shadowBlur = 0.08 * u;
    ctx.shadowOffsetY = 0.02 * u;
    violinBodyPath(ctx, u);
    ctx.fillStyle = "rgba(60,40,20,0.12)";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.restore();

    // Neck + pegbox + scroll (often cropped at the staff edge)
    drawNeck(ctx, u);

    // Body fill
    violinBodyPath(ctx, u);
    const wood = ctx.createRadialGradient(-0.10 * u, -0.02 * u, 0.02 * u, 0.02 * u, 0.08 * u, 0.52 * u);
    wood.addColorStop(0, "#e0a85c");
    wood.addColorStop(0.22, C.woodLight);
    wood.addColorStop(0.55, C.woodMid);
    wood.addColorStop(0.82, C.woodDeep);
    wood.addColorStop(1, C.woodEdge);
    ctx.fillStyle = wood;
    ctx.fill();

    // Varnish gloss
    ctx.save();
    violinBodyPath(ctx, u);
    ctx.clip();
    const gloss = ctx.createRadialGradient(-0.12 * u, -0.16 * u, 0, -0.04 * u, 0.02 * u, 0.38 * u);
    gloss.addColorStop(0, "rgba(255,236,200,0.38)");
    gloss.addColorStop(0.45, "rgba(255,220,160,0.10)");
    gloss.addColorStop(1, "rgba(80,40,10,0)");
    ctx.fillStyle = gloss;
    ctx.fillRect(-0.5 * u, -0.5 * u, u, u);

    const gloss2 = ctx.createRadialGradient(0.10 * u, 0.22 * u, 0, 0.06 * u, 0.28 * u, 0.28 * u);
    gloss2.addColorStop(0, "rgba(255,230,180,0.18)");
    gloss2.addColorStop(1, "rgba(80,40,10,0)");
    ctx.fillStyle = gloss2;
    ctx.fillRect(-0.5 * u, 0, u, 0.6 * u);

    // Edge darkening
    ctx.strokeStyle = "rgba(50,24,8,0.28)";
    ctx.lineWidth = 0.028 * u;
    violinBodyPath(ctx, u);
    ctx.stroke();

    // Grain
    const rnd = seedRnd(4217);
    ctx.strokeStyle = "rgba(90,42,10,0.07)";
    ctx.lineWidth = Math.max(0.5, 0.0028 * u);
    ctx.lineCap = "round";
    for (let i = 0; i < 26; i++) {
      const x0 = (-0.32 + rnd() * 0.64) * u;
      ctx.beginPath();
      const y0 = -0.40 * u;
      const y1 = 0.50 * u;
      const wobble = (rnd() - 0.5) * 0.012 * u;
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0 + wobble, y0 + 0.3 * u, x0 - wobble, y0 + 0.62 * u, x0 + (rnd() - 0.5) * 0.008 * u, y1);
      ctx.stroke();
    }
    ctx.restore();

    // Purfling + ink contour
    ctx.save();
    ctx.strokeStyle = "rgba(30,16,8,0.45)";
    ctx.lineWidth = Math.max(1, 0.006 * u);
    violinBodyPath(ctx, u);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = C.ink;
    ctx.lineWidth = Math.max(1.2, 0.008 * u);
    ctx.lineJoin = "round";
    violinBodyPath(ctx, u);
    ctx.stroke();

    drawFHole(ctx, u, -1);
    drawFHole(ctx, u, 1);

    // Fingerboard (black, widening toward the body)
    const nutY = -0.90 * u;
    const fbEnd = -0.035 * u;
    const nutW = 0.042 * u;
    const fbW = 0.078 * u;
    ctx.fillStyle = C.board;
    ctx.beginPath();
    ctx.moveTo(-nutW, nutY);
    ctx.lineTo(nutW, nutY);
    ctx.lineTo(fbW, fbEnd);
    ctx.lineTo(-fbW, fbEnd);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#0c0a08";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Bridge (cream, just below the waist, between the f-holes)
    const brY = 0.145 * u;
    const brW = 0.092 * u;
    const brH = 0.018 * u;
    ctx.fillStyle = C.bridge;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-brW, brY + brH * 0.2);
    ctx.lineTo(-brW * 0.92, brY - brH);
    ctx.lineTo(brW * 0.92, brY - brH);
    ctx.lineTo(brW, brY + brH * 0.2);
    ctx.lineTo(brW * 0.72, brY + brH);
    ctx.lineTo(-brW * 0.72, brY + brH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Tailpiece
    const tp0 = 0.23 * u;
    const tp1 = 0.445 * u;
    ctx.fillStyle = C.board;
    ctx.beginPath();
    ctx.moveTo(-0.068 * u, tp0);
    ctx.lineTo(0.068 * u, tp0);
    ctx.lineTo(0.032 * u, tp1);
    ctx.lineTo(-0.032 * u, tp1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#0c0a08";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Fine tuners (tiny circles)
    for (let i = 0; i < 4; i++) {
      const tx = (-0.045 + i * 0.030) * u;
      ctx.fillStyle = "#3a342c";
      ctx.beginPath();
      ctx.arc(tx, tp0 + 0.018 * u, 0.007 * u, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tailgut + saddle + end button
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = Math.max(1, 0.006 * u);
    ctx.beginPath();
    ctx.moveTo(0, tp1);
    ctx.lineTo(0, 0.492 * u);
    ctx.stroke();
    ctx.fillStyle = C.bridge;
    roundedRect(ctx, -0.028 * u, 0.486 * u, 0.056 * u, 0.014 * u, 0.003 * u);
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = C.board;
    ctx.beginPath();
    ctx.arc(0, 0.508 * u, 0.012 * u, 0, Math.PI * 2);
    ctx.fill();

    // Strings: G D A E, left → right, nut to tailpiece, slightly raised at the bridge
    const nutXs = [-0.027, -0.009, 0.009, 0.027];
    const brXs = [-0.058, -0.020, 0.020, 0.058];
    const tpXs = [-0.045, -0.016, 0.016, 0.045];
    for (let i = 0; i < 4; i++) {
      const lw = i === 0 ? 1.7 : i === 3 ? 0.9 : 1.25;
      ctx.lineWidth = lw;
      ctx.strokeStyle = "#c4bbae";
      ctx.beginPath();
      ctx.moveTo(nutXs[i] * u, nutY);
      ctx.lineTo(brXs[i] * u, brY - brH);
      ctx.stroke();
      ctx.strokeStyle = i === 3 ? "#4a453c" : "#2a241c";
      ctx.beginPath();
      ctx.moveTo(brXs[i] * u, brY - brH);
      ctx.lineTo(tpXs[i] * u, tp0);
      ctx.stroke();
    }

    ctx.restore();
    return m;
  }

  function drawNeck(ctx, u) {
    // Neck shaft under the fingerboard, pegbox and a compact scroll.
    const neckW0 = 0.055 * u;
    const neckW1 = 0.042 * u;
    const neckTop = -0.90 * u;
    const neckBot = -0.40 * u;
    const neckWood = ctx.createLinearGradient(-neckW0, 0, neckW0, 0);
    neckWood.addColorStop(0, C.woodDeep);
    neckWood.addColorStop(0.5, C.woodLight);
    neckWood.addColorStop(1, C.woodDeep);
    ctx.fillStyle = neckWood;
    ctx.beginPath();
    ctx.moveTo(-neckW0, neckBot);
    ctx.lineTo(-neckW1, neckTop);
    ctx.lineTo(neckW1, neckTop);
    ctx.lineTo(neckW0, neckBot);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // Pegbox
    ctx.fillStyle = C.woodMid;
    ctx.beginPath();
    ctx.moveTo(-0.042 * u, neckTop);
    ctx.lineTo(-0.048 * u, -1.02 * u);
    ctx.lineTo(0.016 * u, -1.06 * u);
    ctx.lineTo(0.048 * u, -1.00 * u);
    ctx.lineTo(0.042 * u, neckTop);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.stroke();

    // Scroll volute (may be cropped)
    ctx.fillStyle = C.woodDeep;
    ctx.beginPath();
    ctx.arc(-0.004 * u, -1.085 * u, 0.038 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.fillStyle = C.woodLight;
    ctx.beginPath();
    ctx.arc(-0.010 * u, -1.090 * u, 0.018 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = C.woodEdge;
    ctx.arc(-0.014 * u, -1.092 * u, 0.007 * u, 0, Math.PI * 2);
    ctx.fill();

    // Pegs (four, two per side)
    const pegs = [
      [-0.058 * u, -0.94 * u],
      [0.058 * u, -0.955 * u],
      [-0.060 * u, -0.995 * u],
      [0.056 * u, -1.010 * u],
    ];
    for (let i = 0; i < pegs.length; i++) {
      ctx.fillStyle = "#3a2a18";
      ctx.beginPath();
      ctx.ellipse(pegs[i][0], pegs[i][1], 0.016 * u, 0.009 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  function drawPadGuides(ctx, L, activeLanes) {
    ctx.save();
    ctx.font = "13px 'PingFang HK', 'Noto Sans CJK HK', 'Noto Sans TC', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 4; i++) {
      const y = padLaneCenter(L, i);
      const on = activeLanes && activeLanes.indexOf(i) !== -1;
      ctx.strokeStyle = on ? "rgba(42,36,28,0.28)" : C.guide;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(L.w, y);
      ctx.stroke();
      ctx.fillStyle = on ? C.ink : C.label;
      ctx.fillText(E.LANE_NAMES[i], L.w - 12, y);
    }
    ctx.restore();
  }

  function drawBow(ctx, L, state) {
    const engine = state.engine;
    const input = state.input || {};
    const s = engine && typeof engine.s === "number" ? engine.s : 0.5;
    const m = violinMetrics(L);
    const contactX = m.cx;

    let contactY;
    if (engine && engine.lanes && engine.lanes.length) {
      let sum = 0;
      for (let i = 0; i < engine.lanes.length; i++) sum += padLaneCenter(L, engine.lanes[i]);
      contactY = sum / engine.lanes.length;
    } else if (input.pointerDown && input.padY != null) {
      contactY = padBandY(L, input.padY);
    } else {
      contactY = padLaneCenter(L, 1);
    }
    // Keep the bow on the pad, close to the body.
    contactY = clamp(contactY, L.padTop + 18, L.padTop + L.padH - 18);

    const hairLen = Math.min(L.w * 0.96, 420);
    // s=0: frog at the contact (hair extends left to the tip).
    // s=1: tip at the contact (hair extends right to the frog).
    const tipX = contactX - (1 - s) * hairLen;
    const frogX = tipX + hairLen;
    const y = contactY;
    const stickOff = -5;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, L.padTop, L.w, L.padH);
    ctx.clip();

    // Hair
    ctx.strokeStyle = C.hair;
    ctx.lineWidth = 4.2;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(tipX + 10, y);
    ctx.lineTo(frogX - 16, y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(42,36,28,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tipX + 10, y - 2.2);
    ctx.lineTo(frogX - 16, y - 2.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tipX + 10, y + 2.2);
    ctx.lineTo(frogX - 16, y + 2.2);
    ctx.stroke();

    // Stick (slight camber away from the hair / toward the viewer is drawn above)
    ctx.strokeStyle = C.stickEdge;
    ctx.lineWidth = 5.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tipX + 6, y + stickOff);
    ctx.quadraticCurveTo((tipX + frogX) / 2, y + stickOff - 3.5, frogX - 10, y + stickOff);
    ctx.stroke();
    ctx.strokeStyle = C.stick;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(tipX + 6, y + stickOff);
    ctx.quadraticCurveTo((tipX + frogX) / 2, y + stickOff - 3.5, frogX - 10, y + stickOff);
    ctx.stroke();

    // Tip (left)
    ctx.fillStyle = "#f3ead8";
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(tipX - 2, y + stickOff - 4);
    ctx.lineTo(tipX + 12, y + stickOff - 4);
    ctx.lineTo(tipX + 14, y + 3);
    ctx.lineTo(tipX + 2, y + 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Frog (right)
    const fx = frogX - 4;
    ctx.fillStyle = C.board;
    ctx.beginPath();
    ctx.moveTo(fx - 6, y + stickOff - 6);
    ctx.lineTo(fx + 18, y + stickOff - 6);
    ctx.lineTo(fx + 20, y + stickOff + 4);
    ctx.lineTo(fx + 16, y + 7);
    ctx.lineTo(fx - 4, y + 7);
    ctx.lineTo(fx - 8, y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    // Ferrule
    ctx.fillStyle = "#efe6d0";
    roundedRect(ctx, fx - 10, y - 5, 5, 12, 1);
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Screw / eye
    ctx.fillStyle = "#d8d0c4";
    ctx.beginPath();
    ctx.arc(fx + 12, y + stickOff + 1, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawStaff(ctx, L, state) {
    const now = state.now || 0;
    const rows = staffRows(L);
    const playing = !!state.playing;
    const trace = state.trace || [];

    const gutter = 34;
    // Lane bands
    ctx.save();
    for (let i = 0; i < 4; i++) {
      const y = rows.top + rows.h * i;
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gutter, y + rows.h);
      ctx.lineTo(L.w, y + rows.h);
      ctx.stroke();
    }
    ctx.restore();

    // Notes (keep a left gutter so lane labels stay readable)
    for (let i = 0; i < E.NOTES.length; i++) {
      const n = E.NOTES[i];
      const x0 = xAt(L, n.start, now);
      const x1 = xAt(L, n.end, now);
      if (x1 < gutter || x0 > L.w + 24) continue;
      const y = rows.top + rows.h * n.lane + rows.h * 0.16;
      const h = rows.h * 0.68;
      const drawX = Math.max(x0, gutter);
      const w = Math.max(0, x1 - 3 - drawX);
      if (w < 2) continue;
      const current = playing && n.start <= now && now < n.end;
      ctx.fillStyle = current ? C.mustard : C.taupe;
      roundedRect(ctx, drawX, y, w, h, h * 0.5);
      ctx.fill();
    }

    // Labels on top of notes, with a sliver of paper behind them
    ctx.save();
    ctx.font = "13px 'PingFang HK', 'Noto Sans CJK HK', 'Noto Sans TC', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 4; i++) {
      const y = rows.top + rows.h * (i + 0.5);
      ctx.fillStyle = C.paper0;
      ctx.fillRect(0, rows.top + rows.h * i + 2, gutter - 2, rows.h - 4);
      ctx.fillStyle = C.label;
      ctx.fillText(E.LANE_NAMES[i], 12, y);
    }
    ctx.restore();

    drawTrace(ctx, L, now, trace, rows);

    // Playhead + knob
    const headTop = rows.top + 2;
    const headBot = rows.top + rows.h * 4;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.moveTo(L.playX, headTop);
    ctx.lineTo(L.playX, headBot);
    ctx.stroke();

    let knobY = midLanes(rows, state.engine && state.engine.lanes, rows.top + rows.h * 2);
    if (state.input && state.input.pointerDown && state.input.padY != null) {
      knobY = rows.top + clamp(state.input.padY, 0, 1) * rows.h * 4;
    } else if (state.engine && state.engine.lanes && state.engine.lanes.length) {
      knobY = midLanes(rows, state.engine.lanes, knobY);
    }
    knobY = clamp(knobY, headTop + 6, headBot - 6);
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(L.playX, knobY, 6.2, 0, Math.PI * 2);
    ctx.fill();

    if (playing && now < E.LEAD) {
      const beat = Math.min(3, Math.floor(now / E.BEAT));
      ctx.fillStyle = C.inkSoft;
      ctx.font = "bold 28px 'Songti TC', 'Noto Serif CJK HK', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(4 - beat), L.playX + 38, rows.top + rows.h * 2);
    }
  }

  function drawTrace(ctx, L, now, trace, rows) {
    if (!trace || !trace.length) return;
    for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1];
      const b = trace[i];
      if (b.t > now + 0.01) break;
      const x0 = xAt(L, a.t, now);
      const x1 = xAt(L, b.t, now);
      if (x1 < 0 && x0 < 0) continue;
      if (x0 > L.playX + 2) continue;
      const kind = a.kind;
      if (kind === "silent") continue;

      const y0 = midLanes(rows, a.lanes, rows.top + rows.h * 2);
      const y1 = midLanes(rows, b.lanes, y0);
      const xEnd = Math.min(x1, L.playX);

      if (kind === "double" && a.lanes && a.lanes.length >= 2) {
        ctx.strokeStyle = C.trace;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([]);
        ctx.lineCap = "round";
        for (let k = 0; k < 2; k++) {
          const ya = laneMid(rows, a.lanes[k]) + (k ? 3 : -3);
          const yb = laneMid(rows, b.lanes[k] != null ? b.lanes[k] : a.lanes[k]) + (k ? 3 : -3);
          ctx.beginPath();
          ctx.moveTo(x0, ya);
          ctx.lineTo(xEnd, yb);
          ctx.stroke();
        }
        continue;
      }

      ctx.setLineDash(kind === "suka" ? [2, 4.5] : []);
      ctx.lineWidth = kind === "suka" ? 1.3 : kind === "click" ? 2.8 : 2.1;
      ctx.strokeStyle = kind === "wrong" ? C.wrong : kind === "click" ? C.click : C.trace;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      if (kind === "gii") {
        const steps = Math.max(2, Math.ceil(Math.abs(xEnd - x0) / 3));
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const x = x0 + (xEnd - x0) * u;
          const y = y0 + (y1 - y0) * u + Math.sin((a.t + u * 0.05) * 48) * 4.5;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        ctx.moveTo(x0, y0);
        ctx.lineTo(xEnd, y1);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawPops(ctx, L, state) {
    const engine = state.engine;
    if (!engine || !engine.pops) return;
    const pops = engine.pops;
    for (let i = 0; i < pops.length; i++) {
      const p = pops[i];
      const age = engine.time - p.time;
      if (age < 0 || age > 0.9) continue;
      const u = age / 0.9;
      const x = L.playX + 48;
      const rows = staffRows(L);
      const y = rows.top + rows.h * 0.6 + (1 - u) * 14;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - u);
      ctx.fillStyle = C.pop;
      ctx.font = "20px 'PingFang HK', 'Noto Sans CJK HK', 'Noto Sans TC', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(p.label, x, y);
      ctx.restore();
    }
  }

  function drawHint(ctx, L) {
    const x = L.w * 0.5;
    const y = L.padTop + L.padH * 0.42;
    const w = Math.min(L.w - 40, 320);
    const h = 88;
    ctx.fillStyle = "rgba(243,238,230,0.92)";
    roundedRect(ctx, x - w / 2, y - h / 2, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(42,36,28,0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 18px 'PingFang HK', 'Noto Sans CJK HK', sans-serif";
    ctx.fillText("左右拉弓、上下握弦", x, y - 12);
    ctx.font = "14px 'PingFang HK', 'Noto Sans CJK HK', sans-serif";
    ctx.fillStyle = C.inkSoft;
    ctx.fillText("跟住拍子嚟；撳住就可以開始", x, y + 16);
  }

  function drawHud(ctx, L, state) {
    const y = L.safeTop + 26;
    ctx.fillStyle = C.hud;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = "600 20px 'PingFang HK', 'Noto Sans CJK HK', 'Noto Sans TC', sans-serif";
    ctx.fillText("弓弦星", 16, y);

    const score = state.hudScore == null ? "—" : state.hudScore;
    const label = "演奏分";
    ctx.textAlign = "right";
    ctx.fillStyle = C.hud;
    ctx.font = "700 22px 'PingFang HK', 'Noto Sans CJK HK', sans-serif";
    const scoreW = ctx.measureText(score).width;
    ctx.fillText(score, L.w - 44, y);
    ctx.fillStyle = C.inkSoft;
    ctx.font = "13px 'PingFang HK', 'Noto Sans CJK HK', sans-serif";
    ctx.fillText(label, L.w - 44 - scoreW - 10, y);

    // Quiet mute icon (the live game uses a DOM button in the same corner)
    ctx.save();
    ctx.strokeStyle = "#6e685e";
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const mx = L.w - 22;
    const my = y;
    ctx.beginPath();
    ctx.moveTo(mx - 7, my - 2);
    ctx.lineTo(mx - 4, my - 2);
    ctx.lineTo(mx - 1, my - 5);
    ctx.lineTo(mx - 1, my + 5);
    ctx.lineTo(mx - 4, my + 2);
    ctx.lineTo(mx - 7, my + 2);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx - 1, my, 4.2, -0.7, 0.7);
    ctx.stroke();
    ctx.restore();
  }

  function paint(ctx, state) {
    const L = layout(state.cssW, state.cssH, state.safeTop || 0);
    drawPaper(ctx, L.w, L.h);
    drawStaff(ctx, L, state);
    const active = (state.engine && state.engine.lanes) || [];
    drawViolin(ctx, L);
    drawPadGuides(ctx, L, active);
    drawBow(ctx, L, state);
    if (state.playing) drawPops(ctx, L, state);
    if (state.showHint) drawHint(ctx, L);
    if (state.drawHud) drawHud(ctx, L, state);
  }

  function paintTraceCard(ctx, result, w, h) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.paper0;
    ctx.fillRect(0, 0, w, h);

    const top = 22;
    const rowH = (h - 36) / 4;
    const playX = 36;
    const span = E.SONG_END - E.LEAD;
    const px = (w - 52) / span;

    ctx.font = "11px 'PingFang HK', 'Noto Sans CJK HK', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(42,36,28,0.04)" : "rgba(42,36,28,0.02)";
      ctx.fillRect(0, top + rowH * i, w, rowH);
      ctx.fillStyle = C.label;
      ctx.fillText(E.LANE_NAMES[i], 6, top + rowH * (i + 0.5));
    }

    function X(t) {
      return playX + (t - E.LEAD) * px;
    }

    for (let i = 0; i < E.NOTES.length; i++) {
      const n = E.NOTES[i];
      const x0 = X(n.start);
      const x1 = X(n.end);
      const yy = top + rowH * n.lane + 4;
      const hh = rowH - 8;
      ctx.fillStyle = C.taupe;
      roundedRect(ctx, x0, yy, Math.max(3, x1 - x0), hh, 4);
      ctx.fill();
    }

    const rows = { top: top, h: rowH };
    const trace = (result && result.trace) || [];
    for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1];
      const b = trace[i];
      if (a.t < E.LEAD - 0.05 || a.t > E.SONG_END + 0.05) continue;
      if (a.kind === "silent") continue;
      const x0 = X(a.t);
      const x1 = X(b.t);
      if (a.kind === "double" && a.lanes && a.lanes.length >= 2) {
        ctx.strokeStyle = C.trace;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([]);
        for (let k = 0; k < 2; k++) {
          ctx.beginPath();
          ctx.moveTo(x0, laneMid(rows, a.lanes[k]) + (k ? 2 : -2));
          ctx.lineTo(x1, laneMid(rows, b.lanes[k] != null ? b.lanes[k] : a.lanes[k]) + (k ? 2 : -2));
          ctx.stroke();
        }
        continue;
      }
      ctx.setLineDash(a.kind === "suka" ? [2, 3] : []);
      ctx.lineWidth = a.kind === "suka" ? 1 : 1.8;
      ctx.strokeStyle = a.kind === "wrong" ? C.wrong : a.kind === "click" ? C.click : C.trace;
      ctx.lineCap = "round";
      ctx.beginPath();
      if (a.kind === "gii") {
        const steps = Math.max(2, Math.ceil(Math.abs(x1 - x0) / 2));
        const yBase = midLanes(rows, a.lanes, top + rowH * 2);
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const x = x0 + (x1 - x0) * u;
          const y = yBase + Math.sin((a.t + u * 0.05) * 48) * 3;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        ctx.moveTo(x0, midLanes(rows, a.lanes, top + rowH * 2));
        ctx.lineTo(x1, midLanes(rows, b.lanes, top + rowH * 2));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = "rgba(42,36,28,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(E.SONG_END), top);
    ctx.lineTo(X(E.SONG_END), top + rowH * 4);
    ctx.stroke();
  }

  return {
    COLORS: C,
    clamp: clamp,
    mapPadY: mapPadY,
    layout: layout,
    staffRows: staffRows,
    paint: paint,
    paintTraceCard: paintTraceCard,
    violinMetrics: violinMetrics,
  };
});
