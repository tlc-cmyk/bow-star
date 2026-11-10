/**
 * 弓弦星 — original canvas game shell: staff, pad, input, screens.
 */
(function () {
  "use strict";

  const E = window.BowStarEngine;
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  const traceCard = document.getElementById("trace-card");
  const traceCtx = traceCard.getContext("2d");

  const el = {
    hud: document.getElementById("hud"),
    hudScore: document.getElementById("hud-score"),
    title: document.getElementById("screen-title"),
    result: document.getElementById("screen-result"),
    headline: document.getElementById("result-headline"),
    score: document.getElementById("result-score"),
    best: document.getElementById("result-best"),
    sub: document.getElementById("result-sub"),
    rotate: document.getElementById("rotate-hint"),
    mute: document.getElementById("btn-mute"),
    muteTitle: document.getElementById("btn-mute-title"),
    muteResult: document.getElementById("btn-mute-result"),
    start: document.getElementById("btn-start"),
    retry: document.getElementById("btn-retry"),
    home: document.getElementById("btn-home"),
    safe: document.getElementById("safe-probe"),
  };

  const STORE_MUTE = "bowstar-v2-mute";
  const STORE_BEST = "bowstar-v2-best";
  const STORE_HINT = "bowstar-v2-hint";

  const audio = new window.BowStarAudio();
  const engine = new E.PlayEngine();

  const input = {
    pointerDown: false,
    lastX: 0,
    lastY: 0,
    deltas: [],
    padY: null,
    hadPad: false,
    id: null,
  };

  let screen = "title"; // title | play | result
  let lastResult = null;
  let startAudioTime = null;
  let startPerf = 0;
  let cssW = 360;
  let cssH = 640;
  let dpr = 1;
  let showHint = localStorage.getItem(STORE_HINT) !== "1";
  let muted = localStorage.getItem(STORE_MUTE) === "1";
  let lastClickState = false;
  let stars = [];
  let lastFrame = 0;

  const COLORS = {
    bg0: "#0c0814",
    bg1: "#1a1024",
    gold: "#f4c45a",
    cream: "#fff6e4",
    wood0: "#2a160c",
    wood1: "#5a3318",
    wood2: "#8a5a2e",
    wood3: "#c4a36a",
    string: "#e8dcc0",
    playhead: "#fff0b0",
    note: "#e8c45a",
    clean: "#f4d56a",
    gii: "#e07040",
    suka: "#9ad8ff",
    wrong: "#ff5aa8",
    dble: "#7ee0c4",
    click: "#ffcc88",
  };

  function seededStars() {
    const list = [];
    let s = 80211;
    function rnd() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    }
    for (let i = 0; i < 90; i++) {
      list.push({
        x: rnd(),
        y: rnd(),
        r: 0.4 + rnd() * 1.4,
        p: rnd() * Math.PI * 2,
        t: 0.4 + rnd() * 0.8,
      });
    }
    return list;
  }
  stars = seededStars();

  function layout() {
    const staffTop = (el.safe ? el.safe.offsetHeight : 0) + 54;
    const staffH = Math.max(120, cssH * 0.4);
    const padTop = staffH;
    return {
      staffTop: staffTop,
      staffY: 0,
      staffH: staffH,
      padTop: padTop,
      padH: cssH - padTop,
      playX: cssW * 0.22,
      pxPerSec: (cssW * 0.62) / (8 * E.BEAT),
    };
  }

  function resize() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    updateRotate();
  }

  function updateRotate() {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const landscape = cssW > cssH;
    el.rotate.classList.toggle("hidden", !(coarse && landscape));
  }

  function setMuted(next) {
    muted = !!next;
    localStorage.setItem(STORE_MUTE, muted ? "1" : "0");
    audio.setMuted(muted);
    const label = muted ? "聲音：關" : "聲音：開";
    el.muteTitle.textContent = label;
    el.muteResult.textContent = label;
    el.mute.textContent = muted ? "靜" : "聲";
    el.mute.setAttribute("aria-label", muted ? "開啟聲音" : "靜音");
  }

  function showScreen(name) {
    screen = name;
    el.title.classList.toggle("hidden", name !== "title");
    el.result.classList.toggle("hidden", name !== "result");
    el.hud.classList.toggle("hidden", name !== "play");
  }

  function nowT() {
    if (audio.ctx && startAudioTime != null) {
      return audio.ctx.currentTime - startAudioTime;
    }
    return (performance.now() - startPerf) / 1000;
  }

  function consumeInput() {
    const pack = {
      pointerDown: input.pointerDown,
      deltas: input.deltas.slice(),
      padY: input.hadPad ? input.padY : null,
      canvasCssWidth: cssW,
    };
    input.deltas.length = 0;
    return pack;
  }

  function updatePadY(clientY) {
    const L = layout();
    if (clientY >= L.padTop && clientY <= cssH) {
      input.padY = (clientY - L.padTop) / L.padH;
      input.hadPad = true;
    }
  }

  function onPointerDown(ev) {
    if (screen !== "play" && screen !== "title") return;
    if (ev.target && ev.target.closest && ev.target.closest("button, .panel")) return;
    ev.preventDefault();
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch (err) {}
    input.pointerDown = true;
    input.id = ev.pointerId;
    input.lastX = ev.clientX;
    input.lastY = ev.clientY;
    input.deltas.length = 0;
    input.hadPad = false;
    input.padY = null;
    updatePadY(ev.clientY);
    if (showHint && screen === "play") {
      showHint = false;
      localStorage.setItem(STORE_HINT, "1");
    }
  }

  function onPointerMove(ev) {
    if (!input.pointerDown || ev.pointerId !== input.id) {
      return;
    }
    ev.preventDefault();
    const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      input.deltas.push(e.clientX - input.lastX);
      input.lastX = e.clientX;
      input.lastY = e.clientY;
    }
    updatePadY(ev.clientY);
  }

  function onPointerUp(ev) {
    if (ev.pointerId !== input.id) return;
    ev.preventDefault();
    input.pointerDown = false;
    input.id = null;
    input.hadPad = false;
  }

  function preventScroll(ev) {
    if (ev.target && ev.target.closest && ev.target.closest("button, .panel, .icon-btn")) return;
    ev.preventDefault();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("touchstart", preventScroll, { passive: false });
  window.addEventListener("touchmove", preventScroll, { passive: false });

  async function beginPlay() {
    await audio.unlock();
    engine.reset();
    lastClickState = false;
    input.pointerDown = false;
    input.deltas.length = 0;
    input.hadPad = false;
    startPerf = performance.now();
    if (audio.ctx) {
      if (audio.ctx.state === "suspended") await audio.ctx.resume();
      startAudioTime = audio.ctx.currentTime + 0.06;
      audio.scheduleScore(startAudioTime, E);
    } else {
      startAudioTime = null;
    }
    showScreen("play");
    el.hudScore.textContent = "—";
  }

  function finishPlay() {
    audio.stopVoices();
    audio.cancelAccompaniment();
    const result = engine.result();
    lastResult = result;
    let best = parseFloat(localStorage.getItem(STORE_BEST) || "NaN");
    const isNew = !Number.isFinite(best) || result.shown > best;
    if (isNew) {
      localStorage.setItem(STORE_BEST, String(result.shown));
      best = result.shown;
    }
    el.headline.textContent = result.headline;
    el.score.textContent = "名演度 " + result.shown.toFixed(1);
    el.best.classList.toggle("hidden", !isNew || result.shown <= 0);
    if (result.shown >= 90) {
      el.sub.textContent = result.type === result.headline ? "" : result.type;
    } else {
      el.sub.textContent = "評級：" + result.grade;
    }
    drawTraceCard(result);
    showScreen("result");
  }

  el.start.addEventListener("click", function () {
    beginPlay();
  });
  el.retry.addEventListener("click", function () {
    beginPlay();
  });
  el.home.addEventListener("click", function () {
    audio.stopVoices();
    audio.cancelAccompaniment();
    startAudioTime = null;
    engine.reset();
    showScreen("title");
  });
  el.mute.addEventListener("click", function () {
    setMuted(!muted);
  });
  el.muteTitle.addEventListener("click", function () {
    setMuted(!muted);
  });
  el.muteResult.addEventListener("click", function () {
    setMuted(!muted);
  });

  function roundedRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function laneY(L, lane, h) {
    const usableTop = Math.max(L.staffTop, 8);
    const usableH = L.staffH - usableTop - 8;
    const row = usableH / 4;
    return usableTop + row * (lane + 0.5);
  }

  function laneRow(L) {
    const usableTop = Math.max(L.staffTop, 8);
    const usableH = L.staffH - usableTop - 8;
    return { top: usableTop, h: usableH / 4 };
  }

  function xAt(L, t, now) {
    return L.playX + (t - now) * L.pxPerSec;
  }

  function drawBackground(now) {
    const g = ctx.createLinearGradient(0, 0, 0, cssH);
    g.addColorStop(0, COLORS.bg0);
    g.addColorStop(0.45, "#140c1c");
    g.addColorStop(1, COLORS.bg1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(now * s.t + s.p));
      ctx.globalAlpha = tw * (s.y < 0.45 ? 1 : 0.35);
      ctx.fillStyle = i % 7 === 0 ? COLORS.gold : COLORS.cream;
      ctx.beginPath();
      ctx.arc(s.x * cssW, s.y * cssH, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawStaff(L, now, trace, playing) {
    ctx.fillStyle = "rgba(8,6,18,0.55)";
    ctx.fillRect(0, 0, cssW, L.staffH);
    ctx.strokeStyle = "rgba(244,196,90,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, L.staffH - 0.5);
    ctx.lineTo(cssW, L.staffH - 0.5);
    ctx.stroke();

    const rows = laneRow(L);
    for (let i = 0; i < 4; i++) {
      const y = rows.top + rows.h * i;
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,246,228,0.03)" : "rgba(255,246,228,0.015)";
      ctx.fillRect(0, y, cssW, rows.h);
      ctx.fillStyle = "rgba(246,236,216,0.45)";
      ctx.font = "11px PingFang HK, Noto Sans TC, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(E.LANE_NAMES[i], 8, y + rows.h * 0.5);
    }

    // Upcoming (and just-passed) notes
    for (let i = 0; i < E.NOTES.length; i++) {
      const n = E.NOTES[i];
      const x0 = xAt(L, n.start, now);
      const x1 = xAt(L, n.end, now);
      if (x1 < -20 || x0 > cssW + 20) continue;
      const y = rows.top + rows.h * n.lane + 5;
      const h = rows.h - 10;
      const w = Math.max(6, x1 - x0 - 2);
      ctx.fillStyle = n.start <= now && now < n.end ? "#f4d56a" : "rgba(232,196,90,0.72)";
      roundedRect(ctx, x0, y, w, h, 7);
      ctx.fill();
      if (n.start <= now && now < n.end) {
        ctx.strokeStyle = "rgba(255,246,228,0.7)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    drawTrace(L, now, trace, rows);

    // Playhead
    ctx.strokeStyle = COLORS.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L.playX, rows.top - 2);
    ctx.lineTo(L.playX, rows.top + rows.h * 4);
    ctx.stroke();
    ctx.fillStyle = COLORS.playhead;
    ctx.beginPath();
    ctx.moveTo(L.playX, rows.top - 6);
    ctx.lineTo(L.playX - 5, rows.top + 4);
    ctx.lineTo(L.playX + 5, rows.top + 4);
    ctx.closePath();
    ctx.fill();

    if (playing && now < E.LEAD) {
      const beat = Math.min(3, Math.floor(now / E.BEAT));
      ctx.fillStyle = COLORS.cream;
      ctx.font = "bold 28px Songti TC, PMingLiU, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = 0.9;
      ctx.fillText(String(4 - beat), L.playX + 36, rows.top + rows.h * 2);
      ctx.globalAlpha = 1;
    }
  }

  function drawTrace(L, now, trace, rows) {
    if (!trace || !trace.length) return;
    const midY = function (lanes, fallback) {
      if (!lanes || !lanes.length) return fallback;
      let s = 0;
      for (let i = 0; i < lanes.length; i++) s += rows.top + rows.h * (lanes[i] + 0.5);
      return s / lanes.length;
    };

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

      const y0 = midY(a.lanes, rows.top + rows.h * 2);
      const y1 = midY(b.lanes, y0);

      if (kind === "double" && a.lanes.length >= 2) {
        ctx.strokeStyle = COLORS.dble;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        for (let k = 0; k < 2; k++) {
          const ya = rows.top + rows.h * (a.lanes[k] + 0.5) + (k ? 3 : -3);
          const yb = rows.top + rows.h * ((b.lanes[k] != null ? b.lanes[k] : a.lanes[k]) + 0.5) + (k ? 3 : -3);
          ctx.beginPath();
          ctx.moveTo(x0, ya);
          ctx.lineTo(Math.min(x1, L.playX), yb);
          ctx.stroke();
        }
        continue;
      }

      ctx.setLineDash(kind === "suka" ? [2, 4] : []);
      ctx.lineWidth = kind === "suka" ? 1.2 : kind === "click" ? 3 : 2.4;
      ctx.strokeStyle =
        kind === "gii" ? COLORS.gii :
        kind === "suka" ? COLORS.suka :
        kind === "wrong" ? COLORS.wrong :
        kind === "click" ? COLORS.click :
        COLORS.clean;

      ctx.beginPath();
      if (kind === "gii") {
        const steps = Math.max(2, Math.ceil(Math.abs(x1 - x0) / 3));
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const x = x0 + (Math.min(x1, L.playX) - x0) * u;
          const y = y0 + (y1 - y0) * u + Math.sin((a.t + u * 0.05) * 48) * 4.5;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        ctx.moveTo(x0, y0);
        ctx.lineTo(Math.min(x1, L.playX), y1);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawViolinPad(L, now) {
    const x = 0;
    const y = L.padTop;
    const w = cssW;
    const h = L.padH;

    const wood = ctx.createLinearGradient(0, y, 0, y + h);
    wood.addColorStop(0, "#24140e");
    wood.addColorStop(0.5, "#3a2214");
    wood.addColorStop(1, "#1a0e0a");
    ctx.fillStyle = wood;
    ctx.fillRect(x, y, w, h);

    // Instrument body, seen from above, neck to the left, E on top, G at the bottom.
    const cx = w * 0.58;
    const cy = y + h * 0.52;
    const bw = Math.min(w * 0.86, h * 1.35);
    const bh = h * 0.86;

    ctx.save();
    ctx.translate(cx, cy);
    drawBody(bw, bh);
    ctx.restore();

    // Four horizontal string lanes (E top → G bottom)
    const lanePad = h * 0.1;
    const laneArea = h - lanePad * 2;
    const laneH = laneArea / 4;
    const strX0 = w * 0.1;
    const strX1 = w * 0.92;

    for (let i = 0; i < 4; i++) {
      const sy = y + lanePad + laneH * (i + 0.5);
      const active = engine.lanes.indexOf(i) !== -1 && engine.kind !== "silent";
      ctx.strokeStyle = active ? "#ffe9a0" : COLORS.string;
      ctx.globalAlpha = active ? 1 : 0.7;
      ctx.lineWidth = active ? 3.2 : 2;
      ctx.beginPath();
      ctx.moveTo(strX0, sy);
      ctx.lineTo(strX1, sy);
      ctx.stroke();
      if (active) {
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = COLORS.gold;
        ctx.lineWidth = laneH * 0.7;
        ctx.beginPath();
        ctx.moveTo(strX0, sy);
        ctx.lineTo(strX1, sy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = active ? COLORS.gold : "rgba(246,236,216,0.4)";
      ctx.font = "12px PingFang HK, Noto Sans TC, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(E.LANE_NAMES[i], 10, sy);
    }

    // Pegbox / tail hints
    ctx.fillStyle = "rgba(42,22,12,0.9)";
    roundedRect(ctx, w * 0.02, y + h * 0.22, w * 0.08, h * 0.56, 8);
    ctx.fill();
    roundedRect(ctx, w * 0.9, y + h * 0.28, w * 0.08, h * 0.44, 6);
    ctx.fill();

    drawBow(L, w, y, h, lanePad, laneH, strX0, strX1);

    if (input.pointerDown && screen === "play") {
      ctx.fillStyle = "rgba(244,196,90,0.9)";
      ctx.beginPath();
      ctx.arc(input.lastX, input.lastY, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,246,228,0.8)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (screen === "play") drawPops(now);
    if (screen === "play" && showHint) drawHint(L);
  }

  function drawBody(bw, bh) {
    ctx.fillStyle = "#4a2a16";
    ctx.beginPath();
    // Upper / left bout and lower / right bout of a face-up violin.
    ctx.moveTo(-bw * 0.46, 0);
    ctx.bezierCurveTo(-bw * 0.46, -bh * 0.42, -bw * 0.12, -bh * 0.48, bw * 0.02, -bh * 0.28);
    ctx.bezierCurveTo(bw * 0.12, -bh * 0.16, bw * 0.14, -bh * 0.12, bw * 0.2, -bh * 0.18);
    ctx.bezierCurveTo(bw * 0.42, -bh * 0.38, bw * 0.5, -bh * 0.46, bw * 0.48, -bh * 0.08);
    ctx.bezierCurveTo(bw * 0.47, bh * 0.46, bw * 0.42, bh * 0.38, bw * 0.2, bh * 0.18);
    ctx.bezierCurveTo(bw * 0.14, bh * 0.12, bw * 0.12, bh * 0.16, bw * 0.02, bh * 0.28);
    ctx.bezierCurveTo(-bw * 0.12, bh * 0.48, -bw * 0.46, bh * 0.42, -bw * 0.46, 0);
    ctx.closePath();
    const grd = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
    grd.addColorStop(0, "#6a3d1c");
    grd.addColorStop(0.5, "#4a2814");
    grd.addColorStop(1, "#2e180c");
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.strokeStyle = "rgba(244,196,90,0.18)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // F-holes, original simple curls (not copied from any mark).
    ctx.strokeStyle = "rgba(12,8,6,0.75)";
    ctx.lineWidth = 2;
    fHole(bw * 0.22, -bh * 0.16, 1);
    fHole(bw * 0.22, bh * 0.16, -1);

    // Fingerboard
    ctx.fillStyle = "#1a1210";
    roundedRect(ctx, -bw * 0.5, -bh * 0.13, bw * 0.52, bh * 0.26, 4);
    ctx.fill();

    // Bridge
    ctx.fillStyle = "#d8c8a8";
    roundedRect(ctx, bw * 0.14, -bh * 0.2, 6, bh * 0.4, 1);
    ctx.fill();
  }

  function fHole(x, y, sign) {
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 18 * sign);
    ctx.quadraticCurveTo(x + 8, y - 8 * sign, x - 4, y);
    ctx.quadraticCurveTo(x - 14, y + 10 * sign, x + 6, y + 18 * sign);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - 8, y - 18 * sign, 3.2, 0, Math.PI * 2);
    ctx.arc(x + 4, y + 18 * sign, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(12,8,6,0.75)";
    ctx.fill();
  }

  function drawBow(L, w, y, h, lanePad, laneH, strX0, strX1) {
    const s = engine.s;
    // Contact sits in the middle of the strings; s=0 frog at contact, s=1 tip at contact.
    const contactX = strX0 + (strX1 - strX0) * 0.55;
    const bowLen = Math.min(h * 1.05, cssW * 0.7);
    // Bow is vertical. At s=0, frog (lower end) is at contact; as s grows, the stick slides
    // so the contact point moves from frog (bottom) toward the tip (top).
    const frogY = contactX; // unused; we use x for travel
    // Horizontal travel: frog-to-tip along X? No — strings run horizontally, bow is vertical,
    // travel is along the string = X. The stick itself is vertical.
    // Position the whole bow so the contact point along the hair maps to s.
    const hairTop = y + h * 0.04;
    const hairBot = y + h * 0.96;
    const hairLen = hairBot - hairTop;
    // Contact is at a fixed X, and along the hair: contactY is the average of active strings, or mid.
    let contactY = y + lanePad + laneH * 2;
    if (engine.lanes.length) {
      contactY = y + lanePad + laneH * (engine.lanes.reduce((a, b) => a + b, 0) / engine.lanes.length + 0.5);
    } else if (input.hadPad && input.padY != null) {
      contactY = y + input.padY * h;
    }

    // s=0: frog (bottom of stick) at contactY; s=1: tip (top) at contactY.
    const tipY = contactY - (1 - s) * hairLen;
    const frogAt = tipY + hairLen;
    const stickX = contactX + (s - 0.5) * 0; // stay on the contact X (travel is along string visually?)
    // Visual bow travel: shift the stick left-right so the player sees the bow move with the finger.
    // Map s to an X offset: s=0 (frog on strings) slightly right, s=1 slightly left? Brief: moving
    // right increases s (toward tip). So the bow slides right as s increases (frog goes right).
    const travel = (s - 0.5) * Math.min(w * 0.42, 160);
    const bx = contactX + travel;

    ctx.save();
    ctx.translate(bx, 0);
    ctx.strokeStyle = "rgba(216,200,168,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, tipY);
    ctx.lineTo(0, frogAt);
    ctx.stroke();

    // Stick
    ctx.strokeStyle = "#c4a36a";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(5, tipY - 6);
    ctx.lineTo(6, frogAt + 4);
    ctx.stroke();

    // Tip
    ctx.fillStyle = "#e8d4a4";
    roundedRect(ctx, -3, tipY - 14, 12, 16, 3);
    ctx.fill();

    // Frog
    ctx.fillStyle = "#1a1210";
    roundedRect(ctx, -10, frogAt - 6, 22, 28, 4);
    ctx.fill();
    ctx.fillStyle = "#8a5a2e";
    roundedRect(ctx, -6, frogAt + 4, 14, 10, 2);
    ctx.fill();

    // Contact glow
    if (engine.kind !== "silent" && engine.pointerDown) {
      ctx.fillStyle = "rgba(244,196,90,0.35)";
      ctx.beginPath();
      ctx.arc(0, contactY, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Remaining-bow meter
    const meterX = w - 18;
    const meterY = y + 16;
    const meterH = h - 32;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundedRect(ctx, meterX - 5, meterY, 10, meterH, 5);
    ctx.fill();
    const fillH = meterH * (1 - Math.abs(s - 0) /* remaining toward farther end not needed */);
    // Show position: marker at s (0 bottom = frog, 1 top = tip)
    const my = meterY + meterH * (1 - s);
    ctx.strokeStyle = "rgba(244,196,90,0.4)";
    ctx.lineWidth = 2;
    roundedRect(ctx, meterX - 5, meterY, 10, meterH, 5);
    ctx.stroke();
    ctx.fillStyle = engine.ranOut ? COLORS.gii : COLORS.gold;
    ctx.beginPath();
    ctx.arc(meterX, my, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPops(now) {
    const pops = engine.pops;
    for (let i = 0; i < pops.length; i++) {
      const p = pops[i];
      const age = engine.time - p.time;
      if (age < 0 || age > 0.9) continue;
      const u = age / 0.9;
      const L = layout();
      const x = cssW * 0.5;
      const y = L.padTop + 36 + (1 - u) * 18;
      ctx.globalAlpha = 1 - u;
      ctx.fillStyle = p.kind === "end" || p.kind === "click" ? COLORS.cream : COLORS.gold;
      ctx.font = "bold 28px Songti TC, PMingLiU, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.label, x, y);
      ctx.globalAlpha = 1;
    }
  }

  function drawHint(L) {
    const x = cssW * 0.5;
    const y = L.padTop + L.padH * 0.5;
    ctx.fillStyle = "rgba(8,6,16,0.62)";
    roundedRect(ctx, 24, y - 58, cssW - 48, 116, 16);
    ctx.fill();
    ctx.strokeStyle = "rgba(244,196,90,0.35)";
    ctx.stroke();
    ctx.fillStyle = COLORS.cream;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 20px PingFang HK, Noto Sans TC, sans-serif";
    ctx.fillText("上下揀弦，左右拉弓", x, y - 16);
    ctx.font = "15px PingFang HK, Noto Sans TC, sans-serif";
    ctx.fillStyle = "#e8d4a4";
    ctx.fillText("跟住拍子嚟；撳住就可以開始", x, y + 16);
  }

  function drawTraceCard(result) {
    const c = traceCtx;
    const w = traceCard.width;
    const h = traceCard.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#120a16";
    c.fillRect(0, 0, w, h);

    const top = 22;
    const rowH = (h - 36) / 4;
    const playX = 36;
    const span = E.SONG_END - E.LEAD;
    const px = (w - 52) / span;
    const now = E.SONG_END;

    c.fillStyle = "rgba(246,236,216,0.4)";
    c.font = "11px sans-serif";
    c.textAlign = "left";
    c.textBaseline = "middle";
    for (let i = 0; i < 4; i++) {
      c.fillStyle = i % 2 === 0 ? "rgba(255,246,228,0.04)" : "rgba(255,246,228,0.02)";
      c.fillRect(0, top + rowH * i, w, rowH);
      c.fillStyle = "rgba(246,236,216,0.45)";
      c.fillText(E.LANE_NAMES[i], 6, top + rowH * (i + 0.5));
    }

    function X(t) {
      return playX + (t - E.LEAD) * px;
    }

    for (let i = 0; i < E.NOTES.length; i++) {
      const n = E.NOTES[i];
      const x0 = X(n.start);
      const x1 = X(n.end);
      c.fillStyle = "rgba(232,196,90,0.55)";
      const rr = 4;
      const yy = top + rowH * n.lane + 4;
      const hh = rowH - 8;
      c.beginPath();
      c.moveTo(x0 + rr, yy);
      c.arcTo(x1, yy, x1, yy + hh, rr);
      c.arcTo(x1, yy + hh, x0, yy + hh, rr);
      c.arcTo(x0, yy + hh, x0, yy, rr);
      c.arcTo(x0, yy, x1, yy, rr);
      c.closePath();
      c.fill();
    }

    const fakeL = {
      playX: w,
      pxPerSec: px,
    };
    // Draw the recorded trace across the whole song (history of the take).
    const rows = { top: top, h: rowH };
    const trace = result.trace || [];
    for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1];
      const b = trace[i];
      if (a.t < E.LEAD - 0.05 || a.t > E.SONG_END + 0.05) continue;
      if (a.kind === "silent") continue;
      const x0 = X(a.t);
      const x1 = X(b.t);
      const mid = function (lanes) {
        if (!lanes || !lanes.length) return top + rowH * 2;
        let s = 0;
        for (let k = 0; k < lanes.length; k++) s += top + rowH * (lanes[k] + 0.5);
        return s / lanes.length;
      };
      if (a.kind === "double" && a.lanes.length >= 2) {
        c.strokeStyle = COLORS.dble;
        c.lineWidth = 1.6;
        c.setLineDash([]);
        for (let k = 0; k < 2; k++) {
          c.beginPath();
          c.moveTo(x0, top + rowH * (a.lanes[k] + 0.5) + (k ? 2 : -2));
          c.lineTo(x1, top + rowH * ((b.lanes[k] != null ? b.lanes[k] : a.lanes[k]) + 0.5) + (k ? 2 : -2));
          c.stroke();
        }
        continue;
      }
      c.setLineDash(a.kind === "suka" ? [2, 3] : []);
      c.lineWidth = a.kind === "suka" ? 1 : 1.8;
      c.strokeStyle =
        a.kind === "gii" ? COLORS.gii :
        a.kind === "suka" ? COLORS.suka :
        a.kind === "wrong" ? COLORS.wrong :
        a.kind === "click" ? COLORS.click :
        COLORS.clean;
      c.beginPath();
      if (a.kind === "gii") {
        const steps = Math.max(2, Math.ceil(Math.abs(x1 - x0) / 2));
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const x = x0 + (x1 - x0) * u;
          const y = mid(a.lanes) + Math.sin((a.t + u * 0.05) * 48) * 3;
          if (s === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
      } else {
        c.moveTo(x0, mid(a.lanes));
        c.lineTo(x1, mid(b.lanes));
      }
      c.stroke();
      c.setLineDash([]);
    }

    c.strokeStyle = "rgba(255,240,176,0.35)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(X(E.SONG_END), top);
    c.lineTo(X(E.SONG_END), top + rowH * 4);
    c.stroke();
  }

  function paintIdle() {
    const L = layout();
    drawBackground(performance.now() / 1000);
    drawStaff(L, 0, [], false);
    drawViolinPad(L, 0);
  }

  function loop(ts) {
    if (!lastFrame) lastFrame = ts;
    lastFrame = ts;
    const L = layout();

    if (screen === "play") {
      const t = nowT();
      let dt = t - engine.time;
      if (dt > 0.08) dt = 0.08;
      if (dt > 0) {
        engine.step(dt, consumeInput());
        if (engine.kind === "click" && !lastClickState) audio.playClick();
        lastClickState = engine.kind === "click";
        audio.update(engine);
        const live = engine.liveShown();
        el.hudScore.textContent = live == null ? "—" : live.toFixed(1);
        if (engine.finished || t >= E.RESULT_AT) {
          // Catch up to the end once, then settle on the result screen.
          finishPlay();
        }
      }
    } else {
      audio.stopVoices();
    }

    const now = screen === "play" ? engine.time : 0;
    drawBackground(performance.now() / 1000);
    drawStaff(L, now, screen === "play" ? engine.trace : (lastResult && screen === "result" ? [] : []), screen === "play");
    if (screen === "result") {
      // Staff stays decorative behind the overlay; pad still visible at the sides.
    }
    drawViolinPad(L, now);

    requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () {
    setTimeout(resize, 80);
  });

  setMuted(muted);
  resize();
  showScreen("title");
  requestAnimationFrame(loop);
})();
