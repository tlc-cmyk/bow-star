/**
 * 弓弦星 — play engine (pure logic, no DOM / no Web Audio).
 * Original implementation of the timed-performance rules.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BowStarEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BPM = 104;
  const BEAT = 60 / BPM;
  const LEAD = 4 * BEAT;
  const TAIL = 0.35;

  const V_STOP = 0.05;
  const V_GII = 0.25;
  const V_LO = 0.36;
  const V_HI = 1.8;
  const V_SUKA = 2.4;

  const SPEED_TAU = 0.04;
  const TURN_WINDOW = 0.22;
  const CLICK_DUR = 0.08;
  const GRACE_PRE = 0.07;
  const GRACE_POST = 0.09;
  const BAND_BORDER = 0.08;
  const POP_HOLD = 0.14;
  const POP_COOLDOWN = 0.85;

  const LANE_NAMES = ["E", "A", "D", "G"];
  const OPEN_FREQ = [659.26, 440, 293.66, 196];

  const CHORD_TONES = {
    A: [110, 138.59, 164.81],
    D: [146.83, 185, 220],
    E: [82.41, 103.83, 123.47],
  };
  const CHORD_SEQ = [
    "A", "A", "D", "A", "D", "A", "E", "A",
    "A", "D", "A", "E", "A", "D", "A", "E",
    "A", "A", "D", "A", "D", "A", "E", "A",
  ];
  const CADENCE = [110, 220, 277.18, 329.63];

  const WARP = [
    [0, 0],
    [60, 60],
    [70, 78],
    [78, 89],
    [86, 95],
    [90.5, 99],
    [95, 100],
    [100, 100],
  ];

  const FAULT_ORDER = ["gii", "suka", "wrong", "double", "click", "silent"];

  const TYPE_SOLO = {
    gii: "鋸木",
    suka: "漏風",
    wrong: "隔籬弦",
    double: "雙弦",
    click: "打嗝",
    silent: "無聲",
  };

  const TYPE_COMBO = {
    "gii+suka": "快慢亂套",
    "gii+wrong": "錯弦硬鋸",
    "gii+double": "雙弦硬鋸",
    "gii+click": "鋸住頓弓",
    "gii+silent": "鋸完就停",
    "suka+wrong": "錯弦飄弓",
    "suka+double": "雙弦漏風",
    "suka+click": "飄住頓弓",
    "suka+silent": "一飄就停",
    "wrong+double": "弦都揀亂",
    "wrong+click": "跳音頓弓",
    "wrong+silent": "搵弦唔到",
    "double+click": "雙弦頓弓",
    "double+silent": "疊住又停",
    "click+silent": "一頓就停",
  };

  const POP_LABEL = {
    gii: "太慢",
    suka: "太快",
    wrong: "錯弦",
    double: "雙弦",
    click: "嘎",
    end: "弓盡",
  };

  const GRADES = [
    { min: 97, name: "神技" },
    { min: 90, name: "名演" },
    { min: 75, name: "發表會" },
    { min: 50, name: "練習緊" },
    { min: 25, name: "滋擾街坊" },
    { min: 0, name: "噪音" },
  ];

  function A(s, b) {
    return [1, s, b == null ? 1 : b];
  }
  function E(s, b) {
    return [0, s, b == null ? 1 : b];
  }

  const PHRASE1 = [A(0), A(0), E(0), E(0), E(2), E(2), E(0, 2)];
  const PHRASE2 = [A(5), A(5), A(4), A(4), A(2), A(2), A(0, 2)];
  const PHRASE3 = [E(0), E(0), A(5), A(5), A(4), A(4), A(2, 2)];
  const TUNE = [].concat(PHRASE1, PHRASE2, PHRASE3, PHRASE3, PHRASE1, PHRASE2);

  function clamp(x, a, b) {
    return x < a ? a : x > b ? b : x;
  }

  function buildNotes() {
    const notes = [];
    let t = LEAD;
    for (let i = 0; i < TUNE.length; i++) {
      const lane = TUNE[i][0];
      const semi = TUNE[i][1];
      const beats = TUNE[i][2];
      const dur = beats * BEAT;
      notes.push({
        index: i,
        lane: lane,
        semi: semi,
        beats: beats,
        start: t,
        end: t + dur,
        dur: dur,
      });
      t += dur;
    }
    return notes;
  }

  function buildPianoEvents(songEnd) {
    const events = [];
    for (let i = 0; i < CHORD_SEQ.length; i++) {
      const name = CHORD_SEQ[i];
      const tones = CHORD_TONES[name];
      const t0 = LEAD + i * 2 * BEAT;
      events.push({
        time: t0,
        kind: "downbeat",
        freqs: [tones[0], tones[0] * 2, tones[1] * 2, tones[2] * 2],
        gain: 1,
      });
      events.push({
        time: t0 + BEAT,
        kind: "upbeat",
        freqs: [tones[1] * 4, tones[2] * 4],
        gain: 0.42,
      });
    }
    events.push({
      time: songEnd,
      kind: "cadence",
      freqs: CADENCE.slice(),
      gain: 0.85,
    });
    return events;
  }

  function buildTicks() {
    const ticks = [];
    for (let i = 0; i < 4; i++) {
      ticks.push({ time: i * BEAT, accent: i === 0 });
    }
    return ticks;
  }

  const NOTES = buildNotes();
  const SONG_END = NOTES[NOTES.length - 1].end;
  const RESULT_AT = SONG_END + TAIL;
  const TOTAL = SONG_END - LEAD;
  const PIANO = buildPianoEvents(SONG_END);
  const TICKS = buildTicks();

  function noteAt(t) {
    if (t < LEAD || t >= SONG_END) return null;
    // Notes tile [LEAD, SONG_END) with no gaps.
    let lo = 0;
    let hi = NOTES.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const n = NOTES[mid];
      if (t < n.start) hi = mid - 1;
      else if (t >= n.end) lo = mid + 1;
      else return n;
    }
    return null;
  }

  function nearAnyNoteStart(t, window) {
    for (let i = 0; i < NOTES.length; i++) {
      const d = t - NOTES[i].start;
      if (d >= -window && d <= window) return NOTES[i];
    }
    return null;
  }

  function graceNote(t) {
    for (let i = 0; i < NOTES.length; i++) {
      const d = t - NOTES[i].start;
      if (d >= -GRACE_PRE && d <= GRACE_POST) return NOTES[i];
    }
    return null;
  }

  function lastNoteAt(t) {
    if (t < LEAD) return null;
    if (t >= SONG_END) return NOTES[NOTES.length - 1];
    const n = noteAt(t);
    if (n) return n;
    for (let i = NOTES.length - 1; i >= 0; i--) {
      if (NOTES[i].end <= t) return NOTES[i];
    }
    return null;
  }

  function lanesFromY(y) {
    if (y == null || Number.isNaN(y)) return [];
    const x = clamp(y, 0, 1) * 4;
    const hit = [];
    for (let b = 1; b <= 3; b++) {
      if (Math.abs(x - b) <= BAND_BORDER) {
        hit.push(b - 1, b);
      }
    }
    if (hit.length) {
      const uniq = [];
      for (let i = 0; i < hit.length; i++) {
        if (uniq.indexOf(hit[i]) === -1) uniq.push(hit[i]);
      }
      uniq.sort(function (a, b) { return a - b; });
      return uniq;
    }
    if (x >= 4) return [3];
    return [Math.min(3, Math.max(0, Math.floor(x)))];
  }

  function warpScore(p) {
    const x = clamp(p, 0, 100);
    for (let i = 1; i < WARP.length; i++) {
      if (x <= WARP[i][0]) {
        const x0 = WARP[i - 1][0];
        const y0 = WARP[i - 1][1];
        const x1 = WARP[i][0];
        const y1 = WARP[i][1];
        const u = (x - x0) / (x1 - x0);
        return y0 + u * (y1 - y0);
      }
    }
    return 100;
  }

  function shownScore(p) {
    return Math.round(warpScore(p) * 10) / 10;
  }

  function gradeFor(shown) {
    for (let i = 0; i < GRADES.length; i++) {
      if (shown >= GRADES[i].min) return GRADES[i].name;
    }
    return "噪音";
  }

  function typeFor(shown, buckets) {
    if (shown >= 97) return "一閃一閃";
    if (shown >= 90) return "乾淨";
    const ranked = FAULT_ORDER.slice().sort(function (a, b) {
      const dt = (buckets[b] || 0) - (buckets[a] || 0);
      if (dt !== 0) return dt;
      return FAULT_ORDER.indexOf(a) - FAULT_ORDER.indexOf(b);
    });
    const a = ranked[0];
    const b = ranked[1];
    const ta = buckets[a] || 0;
    const tb = buckets[b] || 0;
    if (tb < ta * 0.5) return TYPE_SOLO[a];
    const key = FAULT_ORDER.indexOf(a) < FAULT_ORDER.indexOf(b)
      ? a + "+" + b
      : b + "+" + a;
    return TYPE_COMBO[key] || TYPE_SOLO[a] + "・" + TYPE_SOLO[b];
  }

  function headlineFor(shown, buckets) {
    if (shown >= 90) return gradeFor(shown);
    return typeFor(shown, buckets);
  }

  function bowPixelWidth(canvasCssWidth) {
    return Math.min(320, Math.max(1, canvasCssWidth) * 0.8);
  }

  function emptyBuckets() {
    return {
      clean: 0,
      gii: 0,
      suka: 0,
      wrong: 0,
      double: 0,
      click: 0,
      silent: 0,
    };
  }

  function PlayEngine() {
    this.reset();
  }

  PlayEngine.prototype.reset = function () {
    this.time = 0;
    this.s = 0.5;
    this.v = 0;
    this.dir = 0;
    this.ranOut = false;
    this.endCount = 0;
    this.clickUntil = -1;
    this.pointerDown = false;
    this.lanes = [];
    this.kind = "silent";
    this.quality = 0;
    this.sum = 0;
    this.noteElapsed = 0;
    this.buckets = emptyBuckets();
    this.pops = [];
    this._faultAge = 0;
    this._faultKind = null;
    this._popCool = 0;
    this._lastEndPopAt = -99;
    this.trace = [];
    this.finished = false;
    this.semi = 0;
    this.currentNote = null;
    this.heardFreqs = [];
  };

  PlayEngine.prototype._emitPop = function (kind, immediate) {
    const now = this.time;
    if (this._popCool > 0 && !immediate) return;
    if (immediate && now - this._lastEndPopAt < 0.35 && (kind === "end" || kind === "click")) {
      return;
    }
    const label = POP_LABEL[kind];
    if (!label) return;
    this.pops.push({ time: now, kind: kind, label: label });
    this._popCool = POP_COOLDOWN;
    if (kind === "end" || kind === "click") this._lastEndPopAt = now;
  };

  PlayEngine.prototype._updatePops = function (dt, kind, inNote, justEnded, justClicked) {
    if (this._popCool > 0) this._popCool -= dt;
    if (justClicked) this._emitPop("click", true);
    if (justEnded && inNote) this._emitPop("end", true);

    const continuous = kind === "gii" || kind === "suka" || kind === "wrong" || kind === "double";
    if (inNote && continuous) {
      if (this._faultKind === kind) this._faultAge += dt;
      else {
        this._faultKind = kind;
        this._faultAge = dt;
      }
      if (this._faultAge >= POP_HOLD) {
        this._emitPop(kind, false);
        this._faultAge = 0;
      }
    } else {
      this._faultKind = null;
      this._faultAge = 0;
    }
  };

  PlayEngine.prototype.step = function (dt, input) {
    if (dt < 0) dt = 0;
    if (dt > 0.08) dt = 0.08;
    this.time += dt;
    const t = this.time;
    if (t >= RESULT_AT) this.finished = true;

    input = input || {};
    const pointerDown = !!input.pointerDown;
    this.pointerDown = pointerDown;

    const width = input.canvasCssWidth || 360;
    const px = bowPixelWidth(width);
    let ds = 0;
    if (pointerDown) {
      const deltas = input.deltas;
      if (deltas && deltas.length) {
        for (let i = 0; i < deltas.length; i++) ds += deltas[i] / px;
      } else if (typeof input.deltaX === "number") {
        ds += input.deltaX / px;
      } else if (typeof input.ds === "number") {
        ds += input.ds;
      }
    }

    const prevS = this.s;
    let ranOut = false;
    let next = clamp(prevS + ds, 0, 1);
    // Only "bow ran out" if we were already at an end and still pushing that way.
    if ((prevS <= 0 && ds < 0) || (prevS >= 1 && ds > 0)) {
      ranOut = true;
      next = prevS <= 0 ? 0 : 1;
    }

    const justEnded = ranOut && !this.ranOut;
    if (justEnded) this.endCount += 1;
    this.ranOut = ranOut;
    this.s = next;

    const travelled = this.s - prevS;
    const vRaw = ranOut ? 0 : (dt > 1e-6 ? travelled / dt : 0);
    const alpha = 1 - Math.exp(-dt / SPEED_TAU);
    this.v = this.v + alpha * (vRaw - this.v);
    const sp = Math.abs(this.v);

    const newDir = sp > V_STOP ? (this.v < 0 ? -1 : 1) : 0;
    let justClicked = false;
    if (this.dir !== 0 && newDir !== 0 && newDir !== this.dir) {
      const near = nearAnyNoteStart(t, TURN_WINDOW);
      if (near) {
        // clean bow change
      } else if (noteAt(t)) {
        this.clickUntil = t + CLICK_DUR;
        justClicked = true;
      }
    }
    if (newDir !== 0) this.dir = newDir;

    let lanes = [];
    if (pointerDown && input.padY != null && input.padY !== false) {
      lanes = lanesFromY(input.padY);
    }
    this.lanes = lanes;

    const cur = noteAt(t);
    this.currentNote = cur;
    const last = lastNoteAt(t);
    this.semi = cur ? cur.semi : last ? last.semi : 0;

    const kind = this._classify(t, pointerDown, ranOut, sp, lanes, cur);
    this.kind = kind;

    let q = 0;
    if (kind === "clean") {
      const g = graceNote(t);
      if (g && sp < V_LO) {
        q = 1;
      } else if (sp >= V_LO && sp <= V_HI) {
        q = 1;
      } else if (sp >= V_GII && sp < V_LO) {
        q = 0.5 + 0.5 * (sp - V_GII) / (V_LO - V_GII);
      } else if (sp > V_HI && sp <= V_SUKA) {
        q = 1 - 0.5 * (sp - V_HI) / (V_SUKA - V_HI);
      } else {
        q = 1;
      }
    }
    this.quality = q;

    if (cur) {
      this.noteElapsed += dt;
      this.sum += q * dt;
      if (kind === "clean") {
        this.buckets.clean += q * dt;
        if (q < 1) {
          if (sp < V_LO) this.buckets.gii += (1 - q) * dt;
          else this.buckets.suka += (1 - q) * dt;
        }
      } else {
        this.buckets[kind] = (this.buckets[kind] || 0) + dt;
      }
    }

    this._updatePops(dt, kind, !!cur, justEnded, justClicked);

    this.heardFreqs = [];
    if (kind !== "silent" && lanes.length) {
      for (let i = 0; i < lanes.length; i++) {
        this.heardFreqs.push(OPEN_FREQ[lanes[i]] * Math.pow(2, this.semi / 12));
      }
    }

    if (this.trace.length === 0 || t - this.trace[this.trace.length - 1].t >= 1 / 90) {
      this.trace.push({
        t: t,
        kind: kind,
        lanes: lanes.slice(),
        q: q,
        s: this.s,
        sp: sp,
      });
    }

    return this;
  };

  PlayEngine.prototype._classify = function (t, pointerDown, ranOut, sp, lanes, cur) {
    const inClick = t < this.clickUntil;
    const g = graceNote(t);
    const stringOk =
      lanes.length === 0 ||
      (lanes.length === 1 && cur && lanes[0] === cur.lane) ||
      (lanes.length === 1 && !cur && g && lanes[0] === g.lane);

    // Grace: slow (or briefly still) at a note boundary, not on a wrong string.
    const canGrace =
      pointerDown &&
      !ranOut &&
      !inClick &&
      sp < V_LO &&
      g &&
      (lanes.length === 0 || (lanes.length === 1 && lanes[0] === g.lane));

    if (!pointerDown || ranOut) return "silent";
    if (sp <= V_STOP && !canGrace) return "silent";
    if (inClick) return "click";
    if (canGrace && stringOk) return "clean";
    if (lanes.length === 0) return "silent";
    if (lanes.length >= 2) return "double";

    const required = cur ? cur.lane : (lastNoteAt(t) ? lastNoteAt(t).lane : lanes[0]);
    if (cur && lanes[0] !== required) return "wrong";

    if (sp < V_GII) return "gii";
    if (sp > V_SUKA) return "suka";
    return "clean";
  };

  PlayEngine.prototype.liveShown = function () {
    if (this.time < LEAD || this.noteElapsed <= 1e-9) return null;
    const p = (this.sum / this.noteElapsed) * 100;
    return shownScore(p);
  };

  PlayEngine.prototype.finalShown = function () {
    const p = (this.sum / TOTAL) * 100;
    return shownScore(p);
  };

  PlayEngine.prototype.result = function () {
    const shown = this.finalShown();
    const grade = gradeFor(shown);
    const type = typeFor(shown, this.buckets);
    const headline = headlineFor(shown, this.buckets);
    return {
      shown: shown,
      raw: (this.sum / TOTAL) * 100,
      grade: grade,
      type: type,
      headline: headline,
      buckets: Object.assign({}, this.buckets),
      sum: this.sum,
      total: TOTAL,
      endCount: this.endCount,
      trace: this.trace,
    };
  };

  return {
    BPM: BPM,
    BEAT: BEAT,
    LEAD: LEAD,
    TAIL: TAIL,
    TOTAL: TOTAL,
    SONG_END: SONG_END,
    RESULT_AT: RESULT_AT,
    V_STOP: V_STOP,
    V_GII: V_GII,
    V_LO: V_LO,
    V_HI: V_HI,
    V_SUKA: V_SUKA,
    LANE_NAMES: LANE_NAMES,
    OPEN_FREQ: OPEN_FREQ,
    NOTES: NOTES,
    TUNE: TUNE,
    PIANO: PIANO,
    TICKS: TICKS,
    TYPE_SOLO: TYPE_SOLO,
    POP_LABEL: POP_LABEL,
    clamp: clamp,
    A: A,
    E: E,
    lanesFromY: lanesFromY,
    warpScore: warpScore,
    shownScore: shownScore,
    gradeFor: gradeFor,
    typeFor: typeFor,
    headlineFor: headlineFor,
    noteAt: noteAt,
    lastNoteAt: lastNoteAt,
    bowPixelWidth: bowPixelWidth,
    PlayEngine: PlayEngine,
  };
});
