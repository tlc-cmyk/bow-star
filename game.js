/**
 * 弓弦星 — original canvas game shell: input, screens, loop.
 */
(function () {
  "use strict";

  const E = window.BowStarEngine;
  const R = window.BowStarRender;
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
  let lastFrame = 0;

  function safeTop() {
    return el.safe ? el.safe.offsetHeight : 0;
  }

  function pointerXY(ev) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ev.clientX - r.left,
      y: ev.clientY - r.top,
      width: r.width,
    };
  }

  function updatePadY(pointerY) {
    const L = R.layout(cssW, cssH, safeTop());
    input.padY = R.mapPadY(pointerY, L.padTop, L.padH);
  }

  function consumeInput() {
    const pack = {
      pointerDown: input.pointerDown,
      deltas: input.deltas.slice(),
      padY: input.pointerDown ? input.padY : null,
      canvasCssWidth: cssW,
    };
    input.deltas.length = 0;
    return pack;
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
    el.mute.classList.toggle("is-muted", muted);
    el.mute.setAttribute("aria-label", muted ? "開啟聲音" : "靜音");
    el.mute.setAttribute("title", muted ? "開啟聲音" : "靜音");
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

  function onPointerDown(ev) {
    if (screen !== "play" && screen !== "title") return;
    if (ev.target && ev.target.closest && ev.target.closest("button, .panel")) return;
    ev.preventDefault();
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch (err) {}
    const p = pointerXY(ev);
    input.pointerDown = true;
    input.id = ev.pointerId;
    input.lastX = p.x;
    input.lastY = p.y;
    input.deltas.length = 0;
    updatePadY(p.y);
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
      const p = pointerXY(evs[i]);
      input.deltas.push(p.x - input.lastX);
      input.lastX = p.x;
      input.lastY = p.y;
    }
    updatePadY(input.lastY);
  }

  function onPointerUp(ev) {
    if (ev.pointerId !== input.id) return;
    ev.preventDefault();
    input.pointerDown = false;
    input.id = null;
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
    input.padY = null;
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
    el.score.textContent = "演奏分 " + result.shown.toFixed(1) + "%";
    el.best.classList.toggle("hidden", !isNew || result.shown <= 0);
    if (result.shown >= 90) {
      el.sub.textContent = result.type === result.headline ? "" : result.type;
    } else {
      el.sub.textContent = "評級：" + result.grade;
    }
    R.paintTraceCard(traceCtx, result, traceCard.width, traceCard.height);
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

  function paintFrame() {
    const now = screen === "play" ? engine.time : 0;
    const live = screen === "play" ? engine.liveShown() : null;
    R.paint(ctx, {
      cssW: cssW,
      cssH: cssH,
      safeTop: safeTop(),
      now: now,
      playing: screen === "play",
      screen: screen,
      trace: screen === "play" ? engine.trace : [],
      engine: engine,
      input: input,
      showHint: screen === "play" && showHint,
      drawHud: false,
      hudScore: live == null ? "—" : live.toFixed(1) + "%",
    });
  }

  function loop(ts) {
    if (!lastFrame) lastFrame = ts;
    lastFrame = ts;

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
        el.hudScore.textContent = live == null ? "—" : live.toFixed(1) + "%";
        if (engine.finished || t >= E.RESULT_AT) {
          finishPlay();
        }
      }
    } else {
      audio.stopVoices();
    }

    paintFrame();
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
