/**
 * 弓弦星 — original Web Audio synthesis.
 * Bowed-string tone, piano accompaniment, count-in ticks.
 * No samples, no CDN.
 */
(function (root) {
  "use strict";

  function makeNoiseBuffer(ctx, seconds) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function ramps(param, value, t, attack) {
    param.cancelScheduledValues(t);
    const cur = param.value;
    param.setValueAtTime(cur, t);
    param.linearRampToValueAtTime(value, t + (attack || 0.02));
  }

  function BowStarAudio() {
    this.ctx = null;
    this.master = null;
    this.violinBus = null;
    this.accBus = null;
    this.voices = [];
    this.noiseBuf = null;
    this.unlocked = false;
    this.muted = false;
    this._accNodes = [];
  }

  BowStarAudio.prototype.setMuted = function (muted) {
    this.muted = !!muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
  };

  BowStarAudio.prototype.unlock = function () {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return Promise.resolve(false);
    if (!this.ctx) {
      const ctx = new AudioCtx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(ctx.destination);

      this.violinBus = ctx.createGain();
      this.violinBus.gain.value = 0.9;
      this.violinBus.connect(this.master);

      this.accBus = ctx.createGain();
      this.accBus.gain.value = 0.7;
      this.accBus.connect(this.master);

      this.noiseBuf = makeNoiseBuffer(ctx, 1.8);
      this.voices = [0, 1, 2, 3].map(function () {
        return createVoice(ctx);
      });
      this.voices.forEach((v) => v.out.connect(this.violinBus));
    }
    const ctx = this.ctx;
    const p = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    return p.then(() => {
      this.unlocked = true;
      this.setMuted(this.muted);
      return true;
    });
  };

  function createVoice(ctx) {
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    const body = ctx.createOscillator();
    body.type = "triangle";

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 6;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 80;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2800;
    lp.Q.value = 0.7;

    const oscGain = ctx.createGain();
    oscGain.gain.value = 0;

    saw.connect(hp);
    body.connect(hp);
    hp.connect(bp);
    bp.connect(lp);
    lp.connect(oscGain);

    const nSrc = ctx.createBufferSource();
    // buffer filled later
    const nBp = ctx.createBiquadFilter();
    nBp.type = "bandpass";
    nBp.frequency.value = 800;
    nBp.Q.value = 1.2;
    const nHp = ctx.createBiquadFilter();
    nHp.type = "highpass";
    nHp.frequency.value = 400;
    const nGain = ctx.createGain();
    nGain.gain.value = 0;
    nSrc.loop = true;

    const out = ctx.createGain();
    out.gain.value = 1;
    oscGain.connect(out);
    nGain.connect(out);

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 8;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0;
    lfo.connect(lfoGain);
    lfoGain.connect(oscGain.gain);

    // Slow pitch wander for 走音 (out-of-tune violin), summed with a static detune.
    const pitchLfo = ctx.createOscillator();
    pitchLfo.type = "sine";
    pitchLfo.frequency.value = 1.8;
    const pitchLfoGain = ctx.createGain();
    pitchLfoGain.gain.value = 0;
    pitchLfo.connect(pitchLfoGain);
    pitchLfoGain.connect(saw.detune);
    pitchLfoGain.connect(body.detune);

    saw.start();
    body.start();
    lfo.start();
    pitchLfo.start();

    return {
      saw: saw,
      body: body,
      bp: bp,
      hp: hp,
      lp: lp,
      oscGain: oscGain,
      nSrc: nSrc,
      nBp: nBp,
      nHp: nHp,
      nGain: nGain,
      lfo: lfo,
      lfoGain: lfoGain,
      pitchLfo: pitchLfo,
      pitchLfoGain: pitchLfoGain,
      out: out,
      startedNoise: false,
      lastFreq: 440,
    };
  }

  BowStarAudio.prototype._ensureNoise = function (voice) {
    if (voice.startedNoise || !this.noiseBuf) return;
    voice.nSrc.buffer = this.noiseBuf;
    voice.nSrc.connect(voice.nHp);
    voice.nHp.connect(voice.nBp);
    voice.nBp.connect(voice.nGain);
    try {
      voice.nSrc.start();
    } catch (e) {
      /* already started */
    }
    voice.startedNoise = true;
  };

  BowStarAudio.prototype.stopVoices = function () {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.voices.forEach((v) => {
      v.oscGain.gain.cancelScheduledValues(t);
      v.oscGain.gain.setTargetAtTime(0, t, 0.03);
      v.nGain.gain.cancelScheduledValues(t);
      v.nGain.gain.setTargetAtTime(0, t, 0.03);
      v.lfoGain.gain.setTargetAtTime(0, t, 0.03);
      v.pitchLfoGain.gain.setTargetAtTime(0, t, 0.03);
      v.saw.detune.setTargetAtTime(0, t, 0.03);
      v.body.detune.setTargetAtTime(0, t, 0.03);
    });
  };

  BowStarAudio.prototype.cancelAccompaniment = function () {
    this._accNodes.forEach((n) => {
      try {
        if (n.stop) n.stop();
      } catch (e) {}
      try {
        n.disconnect();
      } catch (e) {}
    });
    this._accNodes = [];
  };

  BowStarAudio.prototype.scheduleScore = function (startTime, Engine) {
    this.cancelAccompaniment();
    if (!this.ctx || this.ctx.state === "closed") return;
    const ctx = this.ctx;
    const dest = this.accBus;
    const nodes = this._accNodes;

    function noiseBurst(time, dur, freq, q, gain, hp) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      f.Q.value = q;
      const h = ctx.createBiquadFilter();
      h.type = "highpass";
      h.frequency.value = hp || 200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, Math.max(0, time - 0.001));
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      src.connect(h);
      h.connect(f);
      f.connect(g);
      g.connect(dest);
      src.start(time);
      src.stop(time + dur + 0.02);
      nodes.push(src, f, h, g);
    }

    const tickBurst = noiseBurst.bind(this);

    Engine.TICKS.forEach((tick) => {
      const time = startTime + tick.time;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = tick.accent ? 880 : 1320;
      const g = ctx.createGain();
      const peak = tick.accent ? 0.28 : 0.14;
      g.gain.setValueAtTime(0.0001, Math.max(0, time - 0.001));
      g.gain.exponentialRampToValueAtTime(peak, time + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, time + (tick.accent ? 0.12 : 0.07));
      osc.connect(g);
      g.connect(dest);
      osc.start(time);
      osc.stop(time + 0.16);
      nodes.push(osc, g);
      tickBurst(time, tick.accent ? 0.05 : 0.03, tick.accent ? 900 : 1400, 4, tick.accent ? 0.18 : 0.08, 300);
    });

    Engine.PIANO.forEach((ev) => {
      const time = startTime + ev.time;
      ev.freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        osc.type = ev.kind === "cadence" ? "triangle" : idx === 0 && ev.kind === "downbeat" ? "sine" : "triangle";
        osc.frequency.value = freq;
        const g = ctx.createGain();
        const isBass = ev.kind === "downbeat" && idx === 0;
        const peak = (isBass ? 0.22 : ev.kind === "cadence" ? 0.12 : ev.gain * (idx === 0 ? 0.12 : 0.08));
        const dur = ev.kind === "cadence" ? 1.1 : ev.kind === "downbeat" ? 0.85 : 0.4;
        g.gain.setValueAtTime(0.0001, Math.max(0, time - 0.001));
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = isBass ? 900 : 2400;
        osc.connect(lp);
        lp.connect(g);
        g.connect(dest);
        osc.start(time);
        osc.stop(time + dur + 0.05);
        nodes.push(osc, g, lp);
      });
    });
  };

  BowStarAudio.prototype.playClick = function () {
    if (!this.ctx || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1200;
    bp.Q.value = 2.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.violinBus);
    src.start(t);
    src.stop(t + 0.1);
  };

  /**
   * Off playing is 走音, not 沙聲: keep a bowed violin tone and sour the pitch.
   * Detune is audio-only (kind, speed, lane distance). Scoring is untouched.
   * Thresholds match engine.js (V_GII / V_LO / V_HI / V_SUKA) but are not used to rescore.
   */
  function zouYamFor(kind, sp, engine, voiceIndex) {
    const V_GII = 0.25;
    const V_LO = 0.36;
    const V_HI = 1.8;
    const V_SUKA = 2.4;
    let cents = 0;
    let wobble = 0;
    let wobbleHz = 1.8;

    if (kind === "gii") {
      const excess = Math.min(1, (V_GII - sp) / V_GII);
      cents = -(30 + excess * 16);
      wobble = 11 + excess * 7;
      wobbleHz = 1.35 + excess * 0.5;
    } else if (kind === "suka") {
      const excess = Math.min(1, (sp - V_SUKA) / 1.6);
      cents = 32 + excess * 16;
      wobble = 9 + excess * 6;
      wobbleHz = 2.0 + excess * 0.8;
    } else if (kind === "wrong") {
      const required = engine.currentNote ? engine.currentNote.lane : engine.lanes[0];
      const played = engine.lanes[voiceIndex] != null ? engine.lanes[voiceIndex] : engine.lanes[0];
      const laneOff = (played != null && required != null) ? played - required : 1;
      const dist = Math.max(1, Math.abs(laneOff));
      // Stay in the touched string's pitch family, but sour it so it is not a clean other note.
      cents = (laneOff >= 0 ? -30 : 30) + (dist > 1 ? (laneOff >= 0 ? -8 : 8) : 0);
      wobble = 9;
      wobbleHz = 1.7;
    } else if (kind === "double") {
      cents = voiceIndex === 0 ? -18 : 22;
      wobble = 6;
      wobbleHz = 1.6;
    } else if (kind === "click") {
      cents = -14;
      wobble = 5;
      wobbleHz = 2.4;
    } else if (kind === "clean") {
      const q = typeof engine.quality === "number" ? engine.quality : 1;
      if (q < 1) {
        if (sp < V_LO) cents = -16 * (1 - q);
        else if (sp > V_HI) cents = 16 * (1 - q);
        wobble = 5 * (1 - q);
        wobbleHz = 1.8;
      }
    }

    return { cents: cents, wobble: wobble, wobbleHz: wobbleHz };
  }

  BowStarAudio.prototype.update = function (engine) {
    if (!this.ctx || !this.voices.length) return;
    const t = this.ctx.currentTime;
    const kind = engine.kind;
    const freqs = engine.heardFreqs;
    const sounding = kind !== "silent" && freqs.length > 0;
    const sp = Math.abs(engine.v);

    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      this._ensureNoise(v);
      const on = sounding && i < freqs.length;
      if (!on) {
        ramps(v.oscGain.gain, 0, t, 0.03);
        ramps(v.nGain.gain, 0, t, 0.03);
        ramps(v.lfoGain.gain, 0, t, 0.03);
        ramps(v.pitchLfoGain.gain, 0, t, 0.03);
        v.saw.detune.setTargetAtTime(0, t, 0.03);
        v.body.detune.setTargetAtTime(0, t, 0.03);
        continue;
      }
      const freq = freqs[i];
      v.saw.frequency.setTargetAtTime(freq, t, 0.008);
      v.body.frequency.setTargetAtTime(freq * 0.5, t, 0.008);
      v.bp.frequency.setTargetAtTime(freq * 1.6, t, 0.01);
      v.lastFreq = freq;

      // Hair-like residual only. Off kinds used to raise noise (沙聲); they now stay tonal.
      let oscLvl = 0.09;
      let noiseLvl = 0.01;
      let lp = 2600;
      let nFreq = 800;
      let nQ = 1.2;
      const zy = zouYamFor(kind, sp, engine, i);

      if (kind === "gii") {
        oscLvl = 0.095;
        noiseLvl = 0.01;
        lp = 2000;
      } else if (kind === "suka") {
        oscLvl = 0.1;
        noiseLvl = 0.008;
        lp = 3000;
      } else if (kind === "click") {
        // Brief articulation comes from playClick(); do not scrape here.
        oscLvl = 0.085;
        noiseLvl = 0.012;
        lp = 2400;
      } else if (kind === "wrong") {
        oscLvl = 0.095;
        noiseLvl = 0.01;
        lp = 2600;
      } else if (kind === "double") {
        oscLvl = 0.08;
        noiseLvl = 0.01;
        lp = 2500;
      } else {
        // Clean mid-band stays in tune. Edge speeds lose the old sand and only sour slightly when quality < 1.
        oscLvl = 0.1;
        noiseLvl = 0.01;
        lp = 2800;
      }

      if (kind === "clean" || kind === "wrong" || kind === "double") {
        const mid = 0.7 + Math.min(1.4, sp) * 0.15;
        oscLvl *= mid;
      }

      v.saw.detune.setTargetAtTime(zy.cents, t, 0.03);
      // Mild inharmonic offset on the body when sour, so it is not a perfect octave.
      const bodyCents = zy.cents === 0 ? 0 : zy.cents + (zy.cents > 0 ? 6 : -6);
      v.body.detune.setTargetAtTime(bodyCents, t, 0.03);
      v.pitchLfo.frequency.setTargetAtTime(zy.wobbleHz, t, 0.05);
      ramps(v.pitchLfoGain.gain, zy.wobble, t, 0.04);

      ramps(v.oscGain.gain, oscLvl, t, 0.025);
      ramps(v.nGain.gain, noiseLvl, t, 0.025);
      v.lp.frequency.setTargetAtTime(lp, t, 0.02);
      v.nBp.frequency.setTargetAtTime(nFreq, t, 0.02);
      v.nBp.Q.setTargetAtTime(nQ, t, 0.02);
      ramps(v.lfoGain.gain, 0, t, 0.03);
    }
  };

  root.BowStarAudio = BowStarAudio;
})(typeof globalThis !== "undefined" ? globalThis : this);
