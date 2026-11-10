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

    saw.start();
    body.start();
    lfo.start();

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
        continue;
      }
      const freq = freqs[i];
      v.saw.frequency.setTargetAtTime(freq, t, 0.008);
      v.body.frequency.setTargetAtTime(freq * 0.5, t, 0.008);
      v.bp.frequency.setTargetAtTime(freq * 1.6, t, 0.01);
      v.lastFreq = freq;

      let oscLvl = 0.09;
      let noiseLvl = 0.03;
      let lp = 2600;
      let nFreq = 900;
      let nQ = 1.1;
      let lfoAmt = 0;

      if (kind === "gii") {
        oscLvl = 0.055;
        noiseLvl = 0.12;
        lp = 1400;
        nFreq = 420;
        nQ = 0.8;
        lfoAmt = 0.03;
        v.lfo.frequency.setTargetAtTime(7 + sp * 4, t, 0.02);
      } else if (kind === "suka") {
        oscLvl = 0.035;
        noiseLvl = 0.07;
        lp = 4200;
        nFreq = 2400;
        nQ = 0.6;
        lfoAmt = 0;
      } else if (kind === "click") {
        oscLvl = 0.04;
        noiseLvl = 0.2;
        lp = 1800;
        nFreq = 1500;
      } else if (kind === "wrong") {
        oscLvl = 0.08;
        noiseLvl = 0.04;
        lp = 2400;
      } else if (kind === "double") {
        oscLvl = 0.07;
        noiseLvl = 0.035;
      } else {
        // clean, with a little grit near the edges
        const edgeSlow = sp < 0.5 ? (0.5 - sp) / 0.5 : 0;
        const edgeFast = sp > 1.6 ? (sp - 1.6) / 1.0 : 0;
        oscLvl = 0.1;
        noiseLvl = 0.028 + edgeSlow * 0.05 + edgeFast * 0.03;
        lp = 2800 - edgeSlow * 800 + edgeFast * 800;
      }

      if (kind === "clean" || kind === "wrong" || kind === "double") {
        const mid = 0.7 + Math.min(1.4, sp) * 0.15;
        oscLvl *= mid;
      }

      ramps(v.oscGain.gain, oscLvl, t, 0.025);
      ramps(v.nGain.gain, noiseLvl, t, 0.025);
      v.lp.frequency.setTargetAtTime(lp, t, 0.02);
      v.nBp.frequency.setTargetAtTime(nFreq, t, 0.02);
      v.nBp.Q.setTargetAtTime(nQ, t, 0.02);
      ramps(v.lfoGain.gain, lfoAmt, t, 0.03);
    }
  };

  root.BowStarAudio = BowStarAudio;
})(typeof globalThis !== "undefined" ? globalThis : this);
