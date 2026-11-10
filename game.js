/* 弓弦星 — original browser mini-game. Public-domain melody only. */
(function () {
  "use strict";

  var Q = 1;
  var H = 2;
  // Twinkle Twinkle Little Star, C major. Melody is public domain.
  var SONG = [
    ["C4", Q], ["C4", Q], ["G4", Q], ["G4", Q], ["A4", Q], ["A4", Q], ["G4", H],
    ["F4", Q], ["F4", Q], ["E4", Q], ["E4", Q], ["D4", Q], ["D4", Q], ["C4", H],
    ["G4", Q], ["G4", Q], ["F4", Q], ["F4", Q], ["E4", Q], ["E4", Q], ["D4", H],
    ["G4", Q], ["G4", Q], ["F4", Q], ["F4", Q], ["E4", Q], ["E4", Q], ["D4", H],
    ["C4", Q], ["C4", Q], ["G4", Q], ["G4", Q], ["A4", Q], ["A4", Q], ["G4", H],
    ["F4", Q], ["F4", Q], ["E4", Q], ["E4", Q], ["D4", Q], ["D4", Q], ["C4", H]
  ];

  var FREQ = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0 };
  var SOLFEGE = { C4: "Do", D4: "Re", E4: "Mi", F4: "Fa", G4: "Sol", A4: "La" };
  // Target string index: 0=G, 1=D, 2=A, 3=E (first-position style mapping)
  var NOTE_STRING = { C4: 0, D4: 1, E4: 1, F4: 1, G4: 1, A4: 2 };
  var STRING_META = [
    { id: "G", label: "G 弦", wood: "#b8862a" },
    { id: "D", label: "D 弦", wood: "#d8c07a" },
    { id: "A", label: "A 弦", wood: "#efe3b8" },
    { id: "E", label: "E 弦", wood: "#fff6dc" }
  ];

  var BEAT = 0.46; // seconds of successful bowing per quarter
  var BOW_LEN = 252; // pixels of travel frog→tip
  var IDLE_LIMIT = 3.2;
  var SPEED_SLOW = 72;
  var SPEED_GOOD_LO = 100;
  var SPEED_GOOD_HI = 230;
  var SPEED_FAST = 300;
  var MIN_MOVE = 28;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function qualityFromSpeed(px) {
    if (px < MIN_MOVE) return { q: -1, band: "still", counts: false };
    if (px < SPEED_SLOW) return { q: -1, band: "scratch", counts: true };
    if (px < SPEED_GOOD_LO) {
      var t = (px - SPEED_SLOW) / (SPEED_GOOD_LO - SPEED_SLOW);
      return { q: -1 + t, band: "rough", counts: true };
    }
    if (px <= SPEED_GOOD_HI) return { q: 0, band: "clean", counts: true };
    if (px < SPEED_FAST) {
      var u = (px - SPEED_GOOD_HI) / (SPEED_FAST - SPEED_GOOD_HI);
      return { q: u, band: "thin", counts: true };
    }
    return { q: 1, band: "squeak", counts: true };
  }

  function gradeFor(pct) {
    if (pct >= 85) return { name: "名演", blurb: "弓速穩、換弓準，星都啱晒。" };
    if (pct >= 50) return { name: "普通", blurb: "拉得完，不過仲有雜音同趕忙。" };
    return { name: "貓鬥架", blurb: "弦同弓各自為政，好熱鬧。" };
  }

  var canvas = document.getElementById("stage");
  var ctx = canvas.getContext("2d");
  var synth = new BowSynth();

  var els = {
    hud: document.getElementById("hud"),
    hudNote: document.getElementById("hud-note"),
    hudScore: document.getElementById("hud-score"),
    title: document.getElementById("screen-title"),
    result: document.getElementById("screen-result"),
    grade: document.getElementById("result-grade"),
    resultScore: document.getElementById("result-score"),
    breakdown: document.getElementById("result-break"),
    mute: document.getElementById("btn-mute"),
    muteTitle: document.getElementById("btn-mute-title"),
    start: document.getElementById("btn-start"),
    retry: document.getElementById("btn-retry"),
    home: document.getElementById("btn-home"),
    rotate: document.getElementById("rotate-hint")
  };

  var state = "title"; // title | play | result
  var muted = false;
  var W = 390;
  var H = 844;
  var layout = null;
  var stars = [];
  var sparks = [];

  var play = null;
  var pointer = { down: false, id: null, x: 0, y: 0, lastX: 0, lastT: 0 };
  var speedEma = 0;
  var flash = { text: "", color: "", t: 0 };
  var bowHintPulse = 0;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var w = window.innerWidth;
    var h = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w;
    H = h;
    layout = computeLayout(w, h);
    var landscape = w > h * 1.15;
    // Desktop landscape: still playable in a centred column; phones should rotate.
    var isCoarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (landscape && isCoarse && w < 1100) {
      els.rotate.classList.remove("hidden");
    } else {
      els.rotate.classList.add("hidden");
    }
  }

  function computeLayout(w, h) {
    // Reserve space for the HUD + notch
    var top = Math.max(86, Math.min(128, h * 0.13));
    var bottom = h - 18;
    var midX = w * 0.5;
    var bodyW = Math.min(w * 0.78, 340);
    var neckW = bodyW * 0.22;
    var bodyTop = top + h * 0.08;
    var bodyBot = bottom - 64;
    var bowY = lerp(bodyTop, bodyBot, 0.62);
    var bridgeY = bowY + Math.min(36, h * 0.04);
    var fbTop = bodyTop + 36;
    var nutY = fbTop + 10;
    var scrollY = bodyTop - 8;
    var stringGap = Math.min(28, bodyW * 0.085);
    var strings = [];
    for (var i = 0; i < 4; i++) {
      strings.push(midX + (i - 1.5) * stringGap);
    }
    return {
      midX: midX,
      bodyW: bodyW,
      neckW: neckW,
      bodyTop: bodyTop,
      bodyBot: bodyBot,
      bowY: bowY,
      bridgeY: bridgeY,
      fbTop: fbTop,
      nutY: nutY,
      scrollY: scrollY,
      strings: strings,
      stringGap: stringGap,
      hitSlop: Math.max(22, stringGap * 0.95),
      staffY: top + 8,
      meterY: bottom - 28
    };
  }

  function initStars() {
    stars = [];
    for (var i = 0; i < 48; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        r: 0.4 + Math.random() * 1.6,
        a: 0.25 + Math.random() * 0.7,
        p: Math.random() * Math.PI * 2,
        s: 0.4 + Math.random() * 1.2
      });
    }
  }

  function resetPlay() {
    play = {
      index: 0,
      filled: 0,
      idle: 0,
      bowPos: 0.32, // 0 frog, 1 tip; start near frog for a first down-bow
      bowDir: 0,
      bowEnded: false,
      touching: false,
      stringIdx: -1,
      stringLocked: false,
      grace: 0,
      begun: false,
      noteSamples: [],
      results: [],
      score: 0,
      maxScore: 0,
      cleanTime: 0,
      scratchTime: 0,
      squeakTime: 0,
      wrongs: 0,
      ends: 0,
      goodReverses: 0,
      skipped: false,
      lastReverseAt: -1,
      finished: false
    };
    for (var i = 0; i < SONG.length; i++) play.maxScore += 100 * SONG[i][1];
    speedEma = 0;
    sparks = [];
    flash.t = 0;
    updateHud();
  }

  function currentNote() {
    if (!play || play.index >= SONG.length) return null;
    var n = SONG[play.index];
    return {
      name: n[0],
      beats: n[1],
      need: n[1] * BEAT,
      freq: FREQ[n[0]],
      string: NOTE_STRING[n[0]],
      label: SOLFEGE[n[0]]
    };
  }

  function updateHud() {
    var n = currentNote();
    if (n) {
      els.hudNote.textContent = "目標 " + n.label + "（" + n.name.replace("4", "") + "）· " + STRING_META[n.string].label;
    } else {
      els.hudNote.textContent = "曲終";
    }
    var pct = play && play.maxScore ? Math.round((play.score / play.maxScore) * 100) : 0;
    els.hudScore.textContent = pct + " 分";
  }

  function setMuted(next) {
    muted = next;
    synth.setMuted(muted);
    els.mute.textContent = muted ? "靜" : "聲";
    els.muteTitle.textContent = muted ? "聲音：關" : "聲音：開";
    els.mute.setAttribute("aria-label", muted ? "開聲" : "靜音");
  }

  function showScreen(name) {
    state = name;
    els.title.classList.toggle("hidden", name !== "title");
    els.result.classList.toggle("hidden", name !== "result");
    els.hud.classList.toggle("hidden", name !== "play");
  }

  function startGame() {
    synth.resume();
    resetPlay();
    showScreen("play");
  }

  function finishGame() {
    if (play.finished) return;
    play.finished = true;
    synth.setBow({ active: false });
    var pct = play.maxScore ? (play.score / play.maxScore) * 100 : 0;
    var g = gradeFor(pct);
    els.grade.textContent = g.name;
    els.resultScore.textContent = Math.round(pct) + " / 100";
    var cleanPct = Math.round((play.cleanTime / Math.max(0.01, play.cleanTime + play.scratchTime + play.squeakTime)) * 100) || 0;
    var acc = SONG.length - play.wrongs;
    els.breakdown.innerHTML =
      "<li>準弦　" + acc + " / " + SONG.length + " 個音</li>" +
      "<li>乾淨弓速　約 " + cleanPct + "%</li>" +
      "<li>拉盡弓毛　" + play.ends + " 次</li>" +
      "<li>及時掉轉　" + play.goodReverses + " 次</li>" +
      "<li>" + g.blurb + "</li>";
    synth.chime(pct >= 50);
    showScreen("result");
  }

  function settleNote(reason) {
    var note = currentNote();
    if (!note || !play) return;
    var samples = play.noteSamples;
    var clean = 0, rough = 0, bad = 0, total = samples.length;
    for (var i = 0; i < total; i++) {
      var b = samples[i];
      if (b === "clean") clean++;
      else if (b === "rough" || b === "thin") rough++;
      else bad++;
    }
    var fill = clamp(play.filled / note.need, 0, 1);
    var qScore = 0;
    if (reason === "wrong" || reason === "timeout") {
      qScore = 0;
    } else if (reason === "ended" && fill < 0.5) {
      qScore = 18 * fill;
    } else if (total === 0) {
      qScore = 0;
    } else {
      qScore = (clean / total) * 100 + (rough / total) * 55 + (bad / total) * 12;
      qScore *= 0.65 + 0.35 * fill;
      if (reason === "ended") qScore *= 0.7;
    }
    qScore = clamp(qScore, 0, 100) * note.beats;
    play.score += qScore;
    play.results.push({ reason: reason, score: qScore, name: note.name });
    play.index += 1;
    play.filled = 0;
    play.idle = 0;
    play.noteSamples = [];
    play.skipped = reason === "wrong";
    play.grace = 0.55;
    play.stringLocked = false;
    if (pointer.down) play.stringIdx = nearestString(pointer.x, pointer.y);
    if (reason === "wrong") {
      flashIt("跳過", "#ff8a7a");
      synth.pluck(note.freq * 0.85, "bad");
      if (navigator.vibrate) navigator.vibrate(24);
    } else if (reason === "ended") {
      flashIt("弓盡", "#ffb070");
    } else if (reason === "ok") {
      var lastBand = samples.length ? samples[samples.length - 1] : "clean";
      if (lastBand === "clean") spawnSparks(layout.strings[note.string], layout.bowY, 10);
    }
    updateHud();
    if (play.index >= SONG.length) finishGame();
  }

  function flashIt(text, color) {
    flash.text = text;
    flash.color = color;
    flash.t = 0.7;
  }

  function spawnSparks(x, y, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = 30 + Math.random() * 90;
      sparks.push({
        x: x, y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 20,
        life: 0.4 + Math.random() * 0.4,
        age: 0,
        c: Math.random() < 0.5 ? "#f4c45a" : "#fff6e4"
      });
    }
  }

  function nearestString(x, y) {
    var L = layout;
    if (!L) return -1;
    // Accept touches near the bowing zone and along the fingerboard
    if (y < L.fbTop - 30 || y > L.bridgeY + 50) return -1;
    var best = -1, bestD = L.hitSlop + 8;
    for (var i = 0; i < 4; i++) {
      var d = Math.abs(x - L.strings[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function applyBowDelta(dx, dt) {
    if (!play || dt <= 0) return;
    var speed = Math.abs(dx) / dt;
    speedEma = speedEma * 0.65 + speed * 0.35;
    var moving = Math.abs(dx) > 0.15;
    if (!moving) return;

    var dir = dx > 0 ? 1 : -1;
    if (play.bowDir !== 0 && dir !== play.bowDir && !play.bowEnded) {
      // Reverse! Reward if remaining hair was getting short but not empty
      var remain = play.bowDir > 0 ? (1 - play.bowPos) : play.bowPos;
      if (remain < 0.38 && remain > 0.02) {
        play.goodReverses += 1;
        flashIt("掉轉", "#f4c45a");
        spawnSparks(layout.midX, layout.bowY, 6);
      }
      play.lastReverseAt = play.index;
    }
    play.bowDir = dir;

    var next = play.bowPos + (dx / BOW_LEN);
    if (next <= 0 || next >= 1) {
      play.bowPos = clamp(next, 0, 1);
      if (!play.bowEnded) {
        play.bowEnded = true;
        play.ends += 1;
      }
    } else {
      play.bowPos = next;
      play.bowEnded = false;
    }
  }

  var lastTs = 0;
  function tick(ts) {
    if (!lastTs) lastTs = ts;
    var dt = clamp((ts - lastTs) / 1000, 0, 0.05);
    lastTs = ts;
    update(dt);
    draw(ts / 1000);
    requestAnimationFrame(tick);
  }

  function update(dt) {
    bowHintPulse += dt;
    if (flash.t > 0) flash.t -= dt;
    for (var i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i];
      s.age += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 80 * dt;
      if (s.age >= s.life) sparks.splice(i, 1);
    }
    if (state !== "play" || !play) {
      synth.setBow({ active: false });
      return;
    }
    var note = currentNote();
    if (!note) {
      synth.setBow({ active: false });
      return;
    }

    var qual = qualityFromSpeed(speedEma);
    if (play.grace > 0) play.grace -= dt;
    var onTarget = play.touching && play.stringIdx === note.string;
    var onWrong = play.touching && play.stringIdx >= 0 && play.stringIdx !== note.string;
    var off = !play.touching || play.stringIdx < 0;

    if (off) {
      if (play.begun) play.idle += dt;
      speedEma *= 0.85;
      synth.setBow({ active: false });
      if (play.begun && play.idle > IDLE_LIMIT) settleNote("timeout");
      return;
    }

    // After a note change, allow the player to slide onto the next string.
    if (onWrong && play.grace > 0) {
      synth.setBow({ active: false });
      return;
    }

    if (onWrong) {
      play.wrongs += 1;
      synth.setBow({
        active: true,
        freq: note.freq,
        quality: 0.4,
        wrong: true,
        intensity: 0.5,
        ended: false
      });
      settleNote("wrong");
      return;
    }

    // on target string
    play.idle = 0;
    play.begun = true;
    play.stringLocked = true;
    play.grace = 0;
    var ended = play.bowEnded;
    var intensity = clamp(speedEma / 180, 0, 1);
    synth.setBow({
      active: play.touching && (qual.counts || ended),
      freq: note.freq,
      quality: ended ? -1 : qual.q,
      intensity: ended ? 0.7 : intensity,
      ended: ended,
      wrong: false
    });

    if (ended) {
      play.scratchTime += dt;
      play.noteSamples.push("scratch");
      // Running out mid-note: give a short grace, then settle as ended if still stuck
      play.filled += dt * 0.15;
      if (play.filled > note.need * 0.35 && play.bowEnded) {
        // don't auto-skip immediately; wait until they linger at the tip
        play.idle += dt;
        if (play.idle > 0.55) settleNote("ended");
      }
      return;
    }

    if (qual.counts) {
      var fillRate = 1;
      if (qual.band === "scratch") fillRate = 0.45;
      else if (qual.band === "rough" || qual.band === "thin") fillRate = 0.8;
      else if (qual.band === "squeak") fillRate = 0.5;
      play.filled += dt * fillRate;
      play.noteSamples.push(qual.band === "clean" ? "clean" : qual.band);
      if (qual.band === "clean") play.cleanTime += dt;
      else if (qual.band === "squeak" || qual.band === "scratch") play.scratchTime += dt;
      else play.squeakTime += dt;
      if (qual.band === "clean" && Math.random() < dt * 6) {
        spawnSparks(layout.strings[note.string], layout.bowY, 1);
      }
      if (play.filled >= note.need) settleNote("ok");
    } else {
      play.idle += dt;
      if (play.idle > IDLE_LIMIT) settleNote("timeout");
    }
  }

  // ---------- drawing ----------
  function draw(time) {
    var L = layout;
    if (!L) return;
    ctx.clearRect(0, 0, W, H);
    drawBackdrop(time);
    drawViolin(L, time);
    if (state === "play") {
      drawStaff(L);
      drawBow(L, time);
      drawMeter(L);
      drawPrompts(L, time);
    } else {
      drawBowRest(L, time);
    }
    drawSparks();
    if (state === "title") drawTitleOrnament(L, time);
  }

  function drawBackdrop(time) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1a1024");
    g.addColorStop(0.45, "#1c1020");
    g.addColorStop(1, "#120a10");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // vignette stage wash
    var rg = ctx.createRadialGradient(W * 0.5, H * 0.58, 20, W * 0.5, H * 0.55, H * 0.72);
    rg.addColorStop(0, "rgba(180, 90, 40, 0.16)");
    rg.addColorStop(0.5, "rgba(80, 30, 60, 0.08)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = 0.55 + 0.45 * Math.sin(time * s.s + s.p);
      ctx.beginPath();
      ctx.fillStyle = "rgba(255, 246, 228, " + (s.a * tw) + ")";
      ctx.arc(s.x * W, s.y * H * 0.55, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTitleOrnament(L, time) {
    // Soft constellation above the violin
    ctx.save();
    ctx.translate(L.midX, Math.max(48, L.bodyTop - 70));
    var pulse = 0.75 + 0.25 * Math.sin(time * 2);
    ctx.fillStyle = "rgba(244, 196, 90, " + pulse + ")";
    starPath(0, 0, 7, 16, 5);
    ctx.fill();
    ctx.restore();
  }

  function starPath(x, y, inner, outer, n) {
    ctx.beginPath();
    for (var i = 0; i < n * 2; i++) {
      var r = i % 2 === 0 ? outer : inner;
      var a = -Math.PI / 2 + (i * Math.PI) / n;
      var px = x + Math.cos(a) * r;
      var py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawViolin(L, time) {
    var x = L.midX;
    var top = L.scrollY;
    var bot = L.bodyBot;
    var bodyTop = lerp(L.bridgeY, bot, 0.04);
    ctx.save();

    // soft shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    violinBodyPath(x + 6, bodyTop + 8, bot + 8, L.bodyW);
    ctx.fill();

    // neck
    var nw = L.neckW;
    var neckGrad = ctx.createLinearGradient(x - nw, 0, x + nw, 0);
    neckGrad.addColorStop(0, "#3a2214");
    neckGrad.addColorStop(0.45, "#7a4a28");
    neckGrad.addColorStop(0.55, "#c08a52");
    neckGrad.addColorStop(1, "#3a2214");
    ctx.fillStyle = "#1a100c";
    roundRect(x - nw * 0.55, L.fbTop - 8, nw * 1.1, L.bridgeY - L.fbTop + 16, 6);
    ctx.fill();
    // fingerboard
    ctx.fillStyle = "#120c0a";
    roundRect(x - nw * 0.42, L.fbTop, nw * 0.84, L.bridgeY - L.fbTop + 4, 4);
    ctx.fill();
    // fingerboard sheen
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(x - nw * 0.12, L.fbTop + 8, 4, L.bridgeY - L.fbTop - 10);

    // scroll + pegbox
    drawScroll(x, top, nw);

    // body
    var wood = ctx.createLinearGradient(x - L.bodyW * 0.5, bodyTop, x + L.bodyW * 0.5, bot);
    wood.addColorStop(0, "#5a2c16");
    wood.addColorStop(0.35, "#a05a2c");
    wood.addColorStop(0.5, "#d09048");
    wood.addColorStop(0.65, "#8a4a24");
    wood.addColorStop(1, "#3e1c10");
    ctx.fillStyle = wood;
    ctx.strokeStyle = "rgba(40,16,8,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    violinBodyPath(x, bodyTop, bot, L.bodyW);
    ctx.fill();
    ctx.stroke();

    // varnish highlight
    ctx.save();
    ctx.beginPath();
    violinBodyPath(x, bodyTop, bot, L.bodyW);
    ctx.clip();
    var shine = ctx.createLinearGradient(x - 40, bodyTop, x + 80, bot);
    shine.addColorStop(0, "rgba(255,230,180,0.18)");
    shine.addColorStop(0.4, "rgba(255,200,120,0.04)");
    shine.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shine;
    ctx.fillRect(x - L.bodyW, bodyTop, L.bodyW * 2, bot - bodyTop);
    // f-holes
    ctx.fillStyle = "#120806";
    drawFHole(x - L.bodyW * 0.18, lerp(bodyTop, bot, 0.42), 1);
    drawFHole(x + L.bodyW * 0.18, lerp(bodyTop, bot, 0.42), -1);
    ctx.restore();

    // bridge
    ctx.fillStyle = "#e8d0a8";
    ctx.strokeStyle = "#5a3a18";
    ctx.lineWidth = 1;
    var bw = (L.strings[3] - L.strings[0]) + 16;
    ctx.beginPath();
    ctx.moveTo(x - bw / 2, L.bridgeY + 8);
    ctx.lineTo(x - bw / 2 + 3, L.bridgeY - 4);
    for (var i = 0; i < 4; i++) {
      ctx.lineTo(L.strings[i] - 2, L.bridgeY - 6);
      ctx.lineTo(L.strings[i], L.bridgeY - 10);
      ctx.lineTo(L.strings[i] + 2, L.bridgeY - 6);
    }
    ctx.lineTo(x + bw / 2 - 3, L.bridgeY - 4);
    ctx.lineTo(x + bw / 2, L.bridgeY + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // tailpiece + star inlay
    var ty = lerp(L.bridgeY, bot, 0.72);
    ctx.fillStyle = "#1a120e";
    roundRect(x - 18, ty, 36, Math.max(36, bot - ty - 16), 6);
    ctx.fill();
    ctx.fillStyle = "#f4c45a";
    starPath(x, ty + 18, 3, 7, 5);
    ctx.fill();

    // chinrest hint
    ctx.fillStyle = "#2a1c14";
    ctx.beginPath();
    ctx.ellipse(x + L.bodyW * 0.28, bot - 18, 22, 12, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // strings
    var note = state === "play" ? currentNote() : null;
    for (var s = 0; s < 4; s++) {
      var sx = L.strings[s];
      var target = note && note.string === s;
      var thick = [2.4, 1.9, 1.5, 1.15][s];
      if (target) {
        var glow = 0.45 + 0.35 * Math.sin(time * 5);
        ctx.strokeStyle = "rgba(244,196,90," + glow + ")";
        ctx.lineWidth = thick + 8;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(sx, L.nutY);
        ctx.lineTo(sx, L.bridgeY - 2);
        ctx.stroke();
      }
      var sg = ctx.createLinearGradient(sx, L.nutY, sx, bot - 20);
      sg.addColorStop(0, STRING_META[s].wood);
      sg.addColorStop(0.6, "#fff8e8");
      sg.addColorStop(1, "#b0a070");
      ctx.strokeStyle = sg;
      ctx.lineWidth = thick;
      ctx.beginPath();
      ctx.moveTo(sx, L.nutY);
      ctx.lineTo(sx, ty + 6);
      ctx.stroke();

      // string label near scroll
      ctx.fillStyle = target ? "#f4c45a" : "rgba(246,236,216,0.55)";
      ctx.font = "600 11px PingFang HK, Noto Sans TC, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(STRING_META[s].id, sx, L.nutY - 10);
    }

    // nut
    ctx.fillStyle = "#efe6d2";
    ctx.fillRect(x - nw * 0.42, L.nutY - 2, nw * 0.84, 4);

    ctx.restore();
  }

  function violinBodyPath(x, top, bot, w) {
    var h = bot - top;
    var u = top + h * 0.22; // upper bout bottom
    var waist = top + h * 0.42;
    var l = top + h * 0.55;
    ctx.moveTo(x, top + 6);
    ctx.bezierCurveTo(x + w * 0.18, top - 4, x + w * 0.46, top + h * 0.02, x + w * 0.44, u);
    ctx.bezierCurveTo(x + w * 0.42, waist - 10, x + w * 0.22, waist, x + w * 0.20, waist + 8);
    ctx.bezierCurveTo(x + w * 0.22, l, x + w * 0.52, l + 8, x + w * 0.50, bot - h * 0.18);
    ctx.bezierCurveTo(x + w * 0.48, bot + 8, x + w * 0.16, bot + 4, x, bot);
    ctx.bezierCurveTo(x - w * 0.16, bot + 4, x - w * 0.48, bot + 8, x - w * 0.50, bot - h * 0.18);
    ctx.bezierCurveTo(x - w * 0.52, l + 8, x - w * 0.22, l, x - w * 0.20, waist + 8);
    ctx.bezierCurveTo(x - w * 0.22, waist, x - w * 0.42, waist - 10, x - w * 0.44, u);
    ctx.bezierCurveTo(x - w * 0.46, top + h * 0.02, x - w * 0.18, top - 4, x, top + 6);
    ctx.closePath();
  }

  function drawFHole(cx, cy, dir) {
    ctx.beginPath();
    ctx.ellipse(cx, cy - 16, 5, 6, 0, 0, Math.PI * 2);
    ctx.ellipse(cx, cy + 18, 5, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + dir * 1, cy - 12);
    ctx.bezierCurveTo(cx + dir * 10, cy - 2, cx - dir * 8, cy + 6, cx + dir * 1, cy + 14);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#120806";
    ctx.stroke();
    ctx.fillRect(cx - 7, cy - 2, 14, 3);
  }

  function drawScroll(x, top, nw) {
    ctx.fillStyle = "#8a4e28";
    ctx.beginPath();
    ctx.moveTo(x - nw * 0.42, top + 44);
    ctx.lineTo(x - nw * 0.38, top + 18);
    ctx.quadraticCurveTo(x - 16, top - 2, x, top - 6);
    ctx.quadraticCurveTo(x + 16, top - 2, x + nw * 0.38, top + 18);
    ctx.lineTo(x + nw * 0.42, top + 44);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(40,16,8,0.5)";
    ctx.stroke();
    // spiral
    ctx.strokeStyle = "#d8a45a";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x + 1, top + 6, 7, 0.2, Math.PI * 1.7);
    ctx.stroke();
    ctx.fillStyle = "#3a2214";
    ctx.beginPath();
    ctx.arc(x + 1, top + 6, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // pegs
    ctx.fillStyle = "#2a1a12";
    ctx.beginPath();
    ctx.ellipse(x - nw * 0.55, top + 26, 7, 3.2, -0.3, 0, Math.PI * 2);
    ctx.ellipse(x + nw * 0.55, top + 22, 7, 3.2, 0.3, 0, Math.PI * 2);
    ctx.ellipse(x - nw * 0.55, top + 36, 7, 3.2, -0.3, 0, Math.PI * 2);
    ctx.ellipse(x + nw * 0.55, top + 32, 7, 3.2, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawStaff(L) {
    var y = L.staffY;
    var x0 = 18;
    var x1 = W - 18;
    ctx.fillStyle = "rgba(20,12,22,0.45)";
    roundRect(x0, y - 8, x1 - x0, 52, 10);
    ctx.fill();

    var start = play ? play.index : 0;
    var cx = 28;
    ctx.font = "600 11px PingFang HK, Noto Sans TC, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(246,236,216,0.55)";
    ctx.fillText("《一閃一閃》", x0 + 10, y + 6);

    var slot = Math.min(28, (x1 - 36 - 16) / 12);
    for (var i = 0; i < 12; i++) {
      var idx = start + i;
      var px = x0 + 16 + i * slot;
      var py = y + 28;
      if (idx >= SONG.length) {
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.arc(px + 8, py, 3, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      var name = SONG[idx][0];
      var beats = SONG[idx][1];
      var isCur = i === 0;
      var str = NOTE_STRING[name];
      ctx.save();
      ctx.translate(px + 8, py);
      if (isCur) {
        var p = play.filled / (currentNote() ? currentNote().need : 1);
        ctx.fillStyle = "rgba(244,196,90,0.25)";
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#f4c45a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(p, 0, 1));
        ctx.stroke();
      }
      ctx.fillStyle = isCur ? "#f4c45a" : "rgba(246,236,216,0.8)";
      starPath(0, 0, beats > 1 ? 4 : 3, beats > 1 ? 9 : 7, 5);
      ctx.fill();
      ctx.fillStyle = isCur ? "#fff6e4" : "rgba(246,236,216,0.55)";
      ctx.font = "600 8px PingFang HK, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(STRING_META[str].id, 0, 18);
      ctx.restore();
    }
  }

  function drawBow(L, time) {
    var pos = play ? play.bowPos : 0.32;
    var hairHalf = Math.min(W * 0.42, 160);
    // Contact stays on the target / current string at bowY.
    var note = currentNote();
    var contactX = L.midX;
    if (play && play.stringIdx >= 0) contactX = L.strings[play.stringIdx];
    else if (note) contactX = L.strings[note.string];

    // Bow translates so the contact point along the hair matches `pos`
    // frog at left of hair when pos=0, tip at right when pos=1? 
    // hair runs from frog (left) to tip (right). Contact at bowY, x=contactX.
    // The point along the hair at ratio `pos` should sit on contactX.
    var hairLen = hairHalf * 2;
    var bowLeft = contactX - pos * hairLen;
    var bowRight = bowLeft + hairLen;
    var y = L.bowY;
    var stickY = y - 7;

    ctx.save();
    // contact glow
    if (play && play.touching && play.stringIdx >= 0) {
      ctx.fillStyle = play.bowEnded ? "rgba(255,120,80,0.35)" : "rgba(244,196,90,0.3)";
      ctx.beginPath();
      ctx.arc(contactX, y, 14 + 3 * Math.sin(time * 8), 0, Math.PI * 2);
      ctx.fill();
    }

    // stick
    var stickGrad = ctx.createLinearGradient(bowLeft, 0, bowRight, 0);
    stickGrad.addColorStop(0, "#3a2416");
    stickGrad.addColorStop(0.2, "#8a5a32");
    stickGrad.addColorStop(0.8, "#6a3e22");
    stickGrad.addColorStop(1, "#2a1810");
    ctx.strokeStyle = stickGrad;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bowLeft - 10, stickY);
    ctx.lineTo(bowRight + 6, stickY);
    ctx.stroke();

    // hair
    ctx.strokeStyle = play && play.bowEnded ? "rgba(255,180,140,0.85)" : "rgba(255,246,228,0.85)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(bowLeft, y);
    ctx.lineTo(bowRight, y);
    ctx.stroke();
    // hair to stick at ends
    ctx.strokeStyle = "rgba(255,246,228,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bowLeft, y);
    ctx.lineTo(bowLeft, stickY);
    ctx.moveTo(bowRight, y);
    ctx.lineTo(bowRight, stickY);
    ctx.stroke();

    // frog (handle)
    ctx.fillStyle = "#1a120e";
    roundRect(bowLeft - 22, stickY - 8, 26, 22, 3);
    ctx.fill();
    ctx.fillStyle = "#c0a060";
    ctx.fillRect(bowLeft - 8, stickY - 4, 8, 14);
    // tip
    ctx.fillStyle = "#2a1c14";
    ctx.beginPath();
    ctx.moveTo(bowRight, stickY - 5);
    ctx.lineTo(bowRight + 16, stickY);
    ctx.lineTo(bowRight, stickY + 6);
    ctx.closePath();
    ctx.fill();

    // remaining length ticks on hair
    ctx.strokeStyle = "rgba(244,196,90,0.7)";
    ctx.lineWidth = 2;
    var remainLo = bowLeft;
    var remainHi = bowRight;
    if (play) {
      if (play.bowDir > 0) remainLo = contactX;
      else if (play.bowDir < 0) remainHi = contactX;
    }
    ctx.beginPath();
    ctx.moveTo(remainLo, y + 6);
    ctx.lineTo(remainHi, y + 6);
    ctx.stroke();

    ctx.restore();
  }

  function drawBowRest(L, time) {
    // Gentle idle bow on title/result
    var y = L.bowY;
    var mid = L.midX;
    var wobble = Math.sin(time * 0.7) * 10;
    var left = mid - 120 + wobble;
    var right = mid + 120 + wobble;
    ctx.strokeStyle = "#6a3e22";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(left - 8, y - 7);
    ctx.lineTo(right + 6, y - 7);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,246,228,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillStyle = "#1a120e";
    roundRect(left - 20, y - 15, 24, 20, 3);
    ctx.fill();
  }

  function drawMeter(L) {
    var x = 24;
    var y = L.meterY;
    var w = W - 48;
    ctx.font = "600 11px PingFang HK, Noto Sans TC, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(246,236,216,0.7)";
    ctx.fillText("弓毛", x, y - 8);

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(x, y, w, 8, 4);
    ctx.fill();

    var pos = play ? play.bowPos : 0.32;
    // Show used vs remaining in current direction
    var from, to, warn = false;
    if (!play || play.bowDir === 0) {
      from = 0; to = pos;
    } else if (play.bowDir > 0) {
      from = pos; to = 1;
      warn = (1 - pos) < 0.18;
    } else {
      from = 0; to = pos;
      warn = pos < 0.18;
    }
    ctx.fillStyle = play && play.bowEnded ? "#ff7a55" : (warn ? "#f4c45a" : "#e8c56a");
    var rx = x + from * w;
    var rw = Math.max(2, (to - from) * w);
    roundRect(rx, y, rw, 8, 4);
    ctx.fill();

    // frog/tip markers + contact
    ctx.fillStyle = "#fff6e4";
    ctx.beginPath();
    ctx.arc(x + pos * w, y + 4, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(246,236,216,0.45)";
    ctx.textAlign = "left";
    ctx.fillText("弓根", x, y + 22);
    ctx.textAlign = "right";
    ctx.fillText("弓尖", x + w, y + 22);

    if (play && (warn || play.bowEnded)) {
      ctx.textAlign = "center";
      ctx.fillStyle = play.bowEnded ? "#ff8a7a" : "#f4c45a";
      ctx.font = "700 13px PingFang HK, Noto Sans TC, sans-serif";
      ctx.fillText(play.bowEnded ? "拉盡咗，掉轉方向！" : "快要拉盡，準備掉轉", W / 2, y - 8);
    }
  }

  function drawPrompts(L, time) {
    var note = currentNote();
    if (!note) return;
    // Direction chevrons
    if (play && !play.bowEnded) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(bowHintPulse * 4);
      ctx.fillStyle = "#f4c45a";
      var cy = L.bowY - 28;
      var dir = play.bowDir === 0 ? 1 : play.bowDir;
      var cx = L.strings[note.string] + dir * 36;
      ctx.beginPath();
      if (dir > 0) {
        ctx.moveTo(cx - 8, cy - 8);
        ctx.lineTo(cx + 8, cy);
        ctx.lineTo(cx - 8, cy + 8);
      } else {
        ctx.moveTo(cx + 8, cy - 8);
        ctx.lineTo(cx - 8, cy);
        ctx.lineTo(cx + 8, cy + 8);
      }
      ctx.fill();
      ctx.restore();
    }

    // Finger hint before first touch
    if (play && !play.touching && play.index === 0 && play.filled === 0) {
      var sx = L.strings[note.string];
      ctx.fillStyle = "rgba(244,196,90,0.15)";
      ctx.beginPath();
      ctx.arc(sx, L.bowY, 26 + 4 * Math.sin(time * 4), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff6e4";
      ctx.font = "600 13px PingFang HK, Noto Sans TC, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("撳住發亮嘅弦，向右或向左拉", sx, L.bowY + 48);
    }

    if (flash.t > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(flash.t / 0.4, 0, 1);
      ctx.fillStyle = flash.color || "#f4c45a";
      ctx.font = "700 28px Songti TC, PMingLiU, serif";
      ctx.textAlign = "center";
      ctx.fillText(flash.text, L.midX, L.bowY - 52);
      ctx.restore();
    }

    // Speed caption
    if (play && play.touching && play.stringIdx === note.string) {
      var q = qualityFromSpeed(speedEma);
      var label = {
        still: "繼續拉……",
        scratch: "太慢 · 沙啞",
        rough: "稍慢",
        clean: "乾淨",
        thin: "稍快",
        squeak: "太快 · 尖聲"
      }[q.band];
      ctx.font = "600 14px PingFang HK, Noto Sans TC, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = q.band === "clean" ? "#f4c45a" : (q.band === "squeak" || q.band === "scratch" ? "#ff8a7a" : "#efe4ce");
      ctx.fillText(label, L.midX, L.fbTop - 18);
    }
  }

  function drawSparks() {
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i];
      var a = 1 - s.age / s.life;
      ctx.globalAlpha = a;
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- input ----------
  function onDown(e) {
    if (state !== "play") return;
    if (e.target && e.target.closest && e.target.closest("button")) return;
    pointer.down = true;
    pointer.id = e.pointerId;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.lastX = e.clientX;
    pointer.lastT = performance.now() / 1000;
    play.touching = true;
    play.stringIdx = nearestString(pointer.x, pointer.y);
    play.stringLocked = play.stringIdx >= 0 && play.grace <= 0;
    play.bowEnded = play.bowPos <= 0.001 || play.bowPos >= 0.999;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    synth.resume();
    if (e.cancelable) e.preventDefault();
  }

  function onMove(e) {
    if (!pointer.down || (pointer.id != null && e.pointerId !== pointer.id)) return;
    var t = performance.now() / 1000;
    var dt = Math.max(0.001, t - pointer.lastT);
    var dx = e.clientX - pointer.lastX;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (!play.stringLocked || play.grace > 0) {
      play.stringIdx = nearestString(pointer.x, pointer.y);
    }
    applyBowDelta(dx, dt);
    pointer.lastX = e.clientX;
    pointer.lastT = t;
    if (e.cancelable) e.preventDefault();
  }

  function onUp(e) {
    if (!pointer.down) return;
    if (pointer.id != null && e.pointerId !== pointer.id) return;
    pointer.down = false;
    pointer.id = null;
    if (play) {
      play.touching = false;
      play.stringIdx = -1;
    }
    speedEma *= 0.3;
    synth.setBow({ active: false });
  }

  canvas.addEventListener("pointerdown", onDown, { passive: false });
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp, { passive: false });
  window.addEventListener("pointercancel", onUp, { passive: false });

  els.start.addEventListener("click", function () { synth.resume(); startGame(); });
  els.retry.addEventListener("click", function () { synth.resume(); startGame(); });
  els.home.addEventListener("click", function () {
    synth.setBow({ active: false });
    showScreen("title");
  });
  els.mute.addEventListener("click", function () { setMuted(!muted); });
  els.muteTitle.addEventListener("click", function () { setMuted(!muted); });

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 80); });

  // Block default page scroll / pinch while playing
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener("touchmove", function (e) {
    if (state === "play") e.preventDefault();
  }, { passive: false });

  initStars();
  resize();
  showScreen("title");
  setMuted(false);
  requestAnimationFrame(tick);
})();
