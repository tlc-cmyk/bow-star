/**
 * 弓弦星 — play engine (pure logic, no DOM / no Web Audio).
 * Original implementation of the timed-performance rules.
 * Melodies are public-domain transcriptions with original accompaniment.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BowStarEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

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
    G: [98, 123.47, 146.83],
  };

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
  function D(s, b) {
    return [2, s, b == null ? 1 : b];
  }
  function G(s, b) {
    return [3, s, b == null ? 1 : b];
  }

  function clamp(x, a, b) {
    return x < a ? a : x > b ? b : x;
  }

  function buildNotes(tune, lead, beat) {
    const notes = [];
    let t = lead;
    for (let i = 0; i < tune.length; i++) {
      const lane = tune[i][0];
      const semi = tune[i][1];
      const beats = tune[i][2];
      const dur = beats * beat;
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

  function buildPianoEvents(chordSeq, cadence, lead, beat, songEnd) {
    const events = [];
    for (let i = 0; i < chordSeq.length; i++) {
      const name = chordSeq[i];
      const tones = CHORD_TONES[name];
      const t0 = lead + i * 2 * beat;
      events.push({
        time: t0,
        kind: "downbeat",
        freqs: [tones[0], tones[0] * 2, tones[1] * 2, tones[2] * 2],
        gain: 1,
      });
      events.push({
        time: t0 + beat,
        kind: "upbeat",
        freqs: [tones[1] * 4, tones[2] * 4],
        gain: 0.42,
      });
    }
    events.push({
      time: songEnd,
      kind: "cadence",
      freqs: cadence.slice(),
      gain: 0.85,
    });
    return events;
  }

  function buildTicks(beat) {
    const ticks = [];
    for (let i = 0; i < 4; i++) {
      ticks.push({ time: i * beat, accent: i === 0 });
    }
    return ticks;
  }

  function makeSong(spec) {
    const bpm = spec.bpm;
    const beat = 60 / bpm;
    const lead = 4 * beat;
    const notes = buildNotes(spec.tune, lead, beat);
    const songEnd = notes[notes.length - 1].end;
    const total = songEnd - lead;
    const resultAt = songEnd + TAIL;
    return {
      id: spec.id,
      title: spec.title,
      label: spec.label,
      key: spec.key,
      bpm: bpm,
      beat: beat,
      lead: lead,
      tune: spec.tune,
      notes: notes,
      songEnd: songEnd,
      total: total,
      resultAt: resultAt,
      piano: buildPianoEvents(spec.chordSeq, spec.cadence, lead, beat, songEnd),
      ticks: buildTicks(beat),
      chordSeq: spec.chordSeq,
      cadence: spec.cadence,
    };
  }

  const PHRASE1 = [A(0), A(0), E(0), E(0), E(2), E(2), E(0, 2)];
  const PHRASE2 = [A(5), A(5), A(4), A(4), A(2), A(2), A(0, 2)];
  const PHRASE3 = [E(0), E(0), A(5), A(5), A(4), A(4), A(2, 2)];
  const TWINKLE_TUNE = [].concat(PHRASE1, PHRASE2, PHRASE3, PHRASE3, PHRASE1, PHRASE2);

  const TIGER_PHRASE_A = [A(0), A(2), A(4), A(0), A(0), A(2), A(4), A(0)];
  const TIGER_PHRASE_B = [A(4), A(5), E(0, 2), A(4), A(5), E(0, 2)];
  const TIGER_PHRASE_C = [
    E(0, 0.5), E(2, 0.5), E(0, 0.5), A(5, 0.5), A(4), A(0),
    E(0, 0.5), E(2, 0.5), E(0, 0.5), A(5, 0.5), A(4), A(0),
  ];
  const TIGER_PHRASE_D = [A(0), E(0), A(0, 2), A(0), E(0), A(0, 2)];
  const TIGER_TUNE = [].concat(TIGER_PHRASE_A, TIGER_PHRASE_B, TIGER_PHRASE_C, TIGER_PHRASE_D);

  const JOY_A = [
    D(4), D(4), D(5), A(0),
    A(0), D(5), D(4), D(2),
    D(0), D(0), D(2), D(4),
    D(4), D(2), D(2, 2),
  ];
  const JOY_B = [
    D(4), D(4), D(5), A(0),
    A(0), D(5), D(4), D(2),
    D(0), D(0), D(2), D(4),
    D(2), D(0), D(0, 2),
  ];
  const JOY_C = [
    D(2), D(2), D(4), D(0),
    D(2), D(4), D(5), D(4),
    D(2), D(4), D(5), D(4),
    D(2), D(0), D(2, 2),
  ];
  const JOY_D = [
    D(4), D(4), D(5), A(0),
    A(0), D(5), D(4), D(2),
    D(0), D(0), D(2), D(4),
    D(2), D(0), D(0, 2),
  ];
  const JOY_TUNE = [].concat(JOY_A, JOY_B, JOY_C, JOY_D);

  const SONGS = [
    makeSong({
      id: "twinkle",
      title: "一閃一閃",
      label: "第一關　一閃一閃",
      key: "A",
      bpm: 104,
      tune: TWINKLE_TUNE,
      chordSeq: [
        "A", "A", "D", "A", "D", "A", "E", "A",
        "A", "D", "A", "E", "A", "D", "A", "E",
        "A", "A", "D", "A", "D", "A", "E", "A",
      ],
      cadence: [110, 220, 277.18, 329.63],
    }),
    makeSong({
      id: "tigers",
      title: "兩隻老虎",
      label: "第二關　兩隻老虎",
      key: "A",
      bpm: 108,
      tune: TIGER_TUNE,
      chordSeq: [
        "A", "A", "A", "A",
        "A", "A", "A", "E",
        "E", "A", "E", "A",
        "A", "E", "A", "A",
      ],
      cadence: [110, 220, 277.18, 329.63],
    }),
    makeSong({
      id: "joy",
      title: "歡樂頌",
      label: "第三關　歡樂頌",
      key: "D",
      bpm: 100,
      tune: JOY_TUNE,
      chordSeq: [
        "D", "D", "D", "A", "D", "D", "A", "A",
        "D", "D", "D", "A", "D", "D", "D", "D",
        "A", "A", "A", "D", "A", "A", "A", "A",
        "D", "D", "D", "A", "G", "D", "A", "D",
      ],
      cadence: [146.83, 293.66, 369.99, 440],
    }),
  ];

  const SONGS_BY_ID = {};
  for (let i = 0; i < SONGS.length; i++) SONGS_BY_ID[SONGS[i].id] = SONGS[i];

  let currentSong = SONGS[0];

  function getSong(id) {
    if (id && SONGS_BY_ID[id]) return SONGS_BY_ID[id];
    const n = Number(id);
    if (n >= 1 && n <= SONGS.length) return SONGS[n - 1];
    return SONGS[0];
  }

  function getCurrentSong() {
    return currentSong;
  }

  function nextSongId(id) {
    const cur = getSong(id);
    const i = SONGS.indexOf(cur);
    if (i >= 0 && i < SONGS.length - 1) return SONGS[i + 1].id;
    return null;
  }

  function syncExports(song) {
    currentSong = song;
    api.BPM = song.bpm;
    api.BEAT = song.beat;
    api.LEAD = song.lead;
    api.TOTAL = song.total;
    api.SONG_END = song.songEnd;
    api.RESULT_AT = song.resultAt;
    api.NOTES = song.notes;
    api.TUNE = song.tune;
    api.PIANO = song.piano;
    api.TICKS = song.ticks;
    return song;
  }

  function setSong(id) {
    return syncExports(getSong(id));
  }

  function resolveSong(song) {
    return song || currentSong;
  }

  function noteAt(t, song) {
    song = resolveSong(song);
    const notes = song.notes;
    if (t < song.lead || t >= song.songEnd) return null;
    let lo = 0;
    let hi = notes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const n = notes[mid];
      if (t < n.start) hi = mid - 1;
      else if (t >= n.end) lo = mid + 1;
      else return n;
    }
    return null;
  }

  function nearAnyNoteStart(t, window, song) {
    song = resolveSong(song);
    const notes = song.notes;
    for (let i = 0; i < notes.length; i++) {
      const d = t - notes[i].start;
      if (d >= -window && d <= window) return notes[i];
    }
    return null;
  }

  function graceNote(t, song) {
    song = resolveSong(song);
    const notes = song.notes;
    for (let i = 0; i < notes.length; i++) {
      const d = t - notes[i].start;
      if (d >= -GRACE_PRE && d <= GRACE_POST) return notes[i];
    }
    return null;
  }

  function lastNoteAt(t, song) {
    song = resolveSong(song);
    const notes = song.notes;
    if (t < song.lead) return null;
    if (t >= song.songEnd) return notes[notes.length - 1];
    const n = noteAt(t, song);
    if (n) return n;
    for (let i = notes.length - 1; i >= 0; i--) {
      if (notes[i].end <= t) return notes[i];
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

  function typeFor(shown, buckets, title) {
    if (shown >= 97) return title || "一閃一閃";
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

  function headlineFor(shown, buckets, title) {
    if (shown >= 90) return gradeFor(shown);
    return typeFor(shown, buckets, title);
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

  function PlayEngine(songId) {
    this.song = getSong(songId || (currentSong && currentSong.id) || "twinkle");
    this.reset();
  }

  PlayEngine.prototype.setSong = function (songId) {
    this.song = getSong(songId);
    setSong(this.song.id);
    this.reset();
    return this;
  };

  PlayEngine.prototype.reset = function () {
    if (!this.song) this.song = currentSong || getSong("twinkle");
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
    const song = this.song;
    if (t >= song.resultAt) this.finished = true;

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
      const near = nearAnyNoteStart(t, TURN_WINDOW, song);
      if (near) {
        // clean bow change
      } else if (noteAt(t, song)) {
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

    const cur = noteAt(t, song);
    this.currentNote = cur;
    const last = lastNoteAt(t, song);
    this.semi = cur ? cur.semi : last ? last.semi : 0;

    const kind = this._classify(t, pointerDown, ranOut, sp, lanes, cur);
    this.kind = kind;

    let q = 0;
    if (kind === "clean") {
      const g = graceNote(t, song);
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
    const song = this.song;
    const inClick = t < this.clickUntil;
    const g = graceNote(t, song);
    const stringOk =
      lanes.length === 0 ||
      (lanes.length === 1 && cur && lanes[0] === cur.lane) ||
      (lanes.length === 1 && !cur && g && lanes[0] === g.lane);

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

    const required = cur ? cur.lane : (lastNoteAt(t, song) ? lastNoteAt(t, song).lane : lanes[0]);
    if (cur && lanes[0] !== required) return "wrong";

    if (sp < V_GII) return "gii";
    if (sp > V_SUKA) return "suka";
    return "clean";
  };

  PlayEngine.prototype.liveShown = function () {
    if (this.time < this.song.lead || this.noteElapsed <= 1e-9) return null;
    const p = (this.sum / this.noteElapsed) * 100;
    return shownScore(p);
  };

  PlayEngine.prototype.finalShown = function () {
    const p = (this.sum / this.song.total) * 100;
    return shownScore(p);
  };

  PlayEngine.prototype.result = function () {
    const shown = this.finalShown();
    const title = this.song.title;
    const grade = gradeFor(shown);
    const type = typeFor(shown, this.buckets, title);
    const headline = headlineFor(shown, this.buckets, title);
    return {
      shown: shown,
      raw: (this.sum / this.song.total) * 100,
      grade: grade,
      type: type,
      headline: headline,
      buckets: Object.assign({}, this.buckets),
      sum: this.sum,
      total: this.song.total,
      endCount: this.endCount,
      trace: this.trace,
      song: this.song,
      title: title,
    };
  };

  const api = {
    TAIL: TAIL,
    V_STOP: V_STOP,
    V_GII: V_GII,
    V_LO: V_LO,
    V_HI: V_HI,
    V_SUKA: V_SUKA,
    LANE_NAMES: LANE_NAMES,
    OPEN_FREQ: OPEN_FREQ,
    TYPE_SOLO: TYPE_SOLO,
    POP_LABEL: POP_LABEL,
    SONGS: SONGS,
    clamp: clamp,
    A: A,
    E: E,
    D: D,
    G: G,
    lanesFromY: lanesFromY,
    warpScore: warpScore,
    shownScore: shownScore,
    gradeFor: gradeFor,
    typeFor: typeFor,
    headlineFor: headlineFor,
    noteAt: noteAt,
    lastNoteAt: lastNoteAt,
    graceNote: graceNote,
    bowPixelWidth: bowPixelWidth,
    getSong: getSong,
    setSong: setSong,
    getCurrentSong: getCurrentSong,
    nextSongId: nextSongId,
    PlayEngine: PlayEngine,
  };

  setSong("twinkle");
  return api;
});
