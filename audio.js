/* Original Web Audio bow timbre. No sampled assets. */
(function (global) {
  "use strict";

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function BowSynth() {
    this.ctx = null;
    this.master = null;
    this.comp = null;
    this.muted = false;
    this._muteGain = null;
    this._voice = null;
    this._started = false;
  }

  BowSynth.prototype._ensure = function () {
    if (this.ctx) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    var ctx = new Ctx();
    var mute = ctx.createGain();
    mute.gain.value = this.muted ? 0 : 1;
    var master = ctx.createGain();
    master.gain.value = 0.22;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.12;
    master.connect(comp);
    comp.connect(mute);
    mute.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.comp = comp;
    this._muteGain = mute;
  };

  BowSynth.prototype.resume = function () {
    this._ensure();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  };

  BowSynth.prototype.setMuted = function (muted) {
    this.muted = !!muted;
    if (this._muteGain && this.ctx) {
      this._muteGain.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.03);
    }
  };

  BowSynth.prototype._buildVoice = function () {
    var ctx = this.ctx;
    var voice = {};

    voice.oscA = ctx.createOscillator();
    voice.oscB = ctx.createOscillator();
    voice.oscC = ctx.createOscillator();
    voice.oscA.type = "sawtooth";
    voice.oscB.type = "triangle";
    voice.oscC.type = "square";

    voice.freqA = ctx.createGain(); // just holders for detune control via osc
    voice.gainA = ctx.createGain();
    voice.gainB = ctx.createGain();
    voice.gainC = ctx.createGain();
    voice.gainA.gain.value = 0;
    voice.gainB.gain.value = 0;
    voice.gainC.gain.value = 0;

    voice.lp = ctx.createBiquadFilter();
    voice.lp.type = "lowpass";
    voice.lp.frequency.value = 1800;
    voice.lp.Q.value = 0.7;

    voice.bp = ctx.createBiquadFilter();
    voice.bp.type = "bandpass";
    voice.bp.frequency.value = 900;
    voice.bp.Q.value = 1.1;

    voice.hp = ctx.createBiquadFilter();
    voice.hp.type = "highpass";
    voice.hp.frequency.value = 180;
    voice.hp.Q.value = 0.5;

    voice.body = ctx.createBiquadFilter();
    voice.body.type = "peaking";
    voice.body.frequency.value = 700;
    voice.body.Q.value = 1.4;
    voice.body.gain.value = 4;

    // Scratch / bow noise
    var nLen = 2 * ctx.sampleRate;
    var buf = ctx.createBuffer(1, nLen, ctx.sampleRate);
    var data = buf.getChannelData(0);
    var brown = 0;
    for (var i = 0; i < nLen; i++) {
      var white = Math.random() * 2 - 1;
      brown = clamp(brown + white * 0.02, -1, 1);
      data[i] = white * 0.55 + brown * 0.45;
    }
    voice.noise = ctx.createBufferSource();
    voice.noise.buffer = buf;
    voice.noise.loop = true;
    voice.noiseGain = ctx.createGain();
    voice.noiseGain.gain.value = 0;
    voice.noiseBp = ctx.createBiquadFilter();
    voice.noiseBp.type = "bandpass";
    voice.noiseBp.frequency.value = 800;
    voice.noiseBp.Q.value = 0.8;
    voice.noiseHp = ctx.createBiquadFilter();
    voice.noiseHp.type = "highpass";
    voice.noiseHp.frequency.value = 400;

    // Flutter LFO for scratchy slow bows
    voice.lfo = ctx.createOscillator();
    voice.lfo.type = "sine";
    voice.lfo.frequency.value = 5.5;
    voice.lfoGain = ctx.createGain();
    voice.lfoGain.gain.value = 0;
    voice.amp = ctx.createGain();
    voice.amp.gain.value = 0;

    voice.oscA.connect(voice.gainA);
    voice.oscB.connect(voice.gainB);
    voice.oscC.connect(voice.gainC);
    voice.gainA.connect(voice.lp);
    voice.gainB.connect(voice.lp);
    voice.gainC.connect(voice.hp);
    voice.lp.connect(voice.body);
    voice.hp.connect(voice.body);
    voice.body.connect(voice.bp);
    voice.bp.connect(voice.amp);

    voice.noise.connect(voice.noiseHp);
    voice.noiseHp.connect(voice.noiseBp);
    voice.noiseBp.connect(voice.noiseGain);
    voice.noiseGain.connect(voice.amp);

    voice.lfo.connect(voice.lfoGain);
    voice.lfoGain.connect(voice.amp.gain);

    voice.amp.connect(this.master);

    var t = ctx.currentTime;
    voice.oscA.start(t);
    voice.oscB.start(t);
    voice.oscC.start(t);
    voice.noise.start(t);
    voice.lfo.start(t);
    this._started = true;
    return voice;
  };

  BowSynth.prototype._voiceReady = function () {
    this._ensure();
    if (!this.ctx) return null;
    if (!this._voice) this._voice = this._buildVoice();
    return this._voice;
  };

  /**
   * Update the sounding bow.
   * opts: {
   *   active: bool,
   *   freq: number,
   *   quality: -1 (slow) .. 0 (clean) .. +1 (fast),
   *   ended: bool (bow hair ran out),
   *   wrong: bool,
   *   intensity: 0..1 bow speed magnitude scaled
   * }
   */
  BowSynth.prototype.setBow = function (opts) {
    var voice = this._voiceReady();
    if (!voice) return;
    var ctx = this.ctx;
    var t = ctx.currentTime;
    var atk = 0.04;

    if (!opts || !opts.active) {
      voice.amp.gain.setTargetAtTime(0, t, 0.05);
      voice.noiseGain.gain.setTargetAtTime(0, t, 0.04);
      voice.lfoGain.gain.setTargetAtTime(0, t, 0.04);
      return;
    }

    var freq = Math.max(80, opts.freq || 261.63);
    var q = clamp(opts.quality || 0, -1, 1);
    var intensity = clamp(opts.intensity == null ? 0.6 : opts.intensity, 0, 1);

    voice.oscA.frequency.setTargetAtTime(freq, t, 0.02);
    voice.oscB.frequency.setTargetAtTime(freq * 1.003, t, 0.02);
    voice.oscC.frequency.setTargetAtTime(freq * 2.01, t, 0.02);

    var clean = 1 - Math.abs(q);
    var slow = q < 0 ? -q : 0;
    var fast = q > 0 ? q : 0;

    if (opts.ended) {
      voice.gainA.gain.setTargetAtTime(0.08, t, atk);
      voice.gainB.gain.setTargetAtTime(0.02, t, atk);
      voice.gainC.gain.setTargetAtTime(0.04, t, atk);
      voice.lp.frequency.setTargetAtTime(700, t, atk);
      voice.bp.frequency.setTargetAtTime(500, t, atk);
      voice.noiseBp.frequency.setTargetAtTime(600, t, atk);
      voice.noiseGain.gain.setTargetAtTime(0.55, t, 0.02);
      voice.lfo.frequency.setTargetAtTime(14, t, 0.03);
      voice.lfoGain.gain.setTargetAtTime(0.08, t, 0.03);
      voice.amp.gain.setTargetAtTime(0.55 * intensity + 0.2, t, 0.03);
      return;
    }

    if (opts.wrong) {
      voice.oscA.frequency.setTargetAtTime(freq * 1.12, t, 0.01);
      voice.oscB.frequency.setTargetAtTime(freq * 0.81, t, 0.01);
      voice.gainA.gain.setTargetAtTime(0.2, t, atk);
      voice.gainB.gain.setTargetAtTime(0.08, t, atk);
      voice.gainC.gain.setTargetAtTime(0.15, t, atk);
      voice.lp.frequency.setTargetAtTime(2400, t, atk);
      voice.noiseGain.gain.setTargetAtTime(0.22, t, atk);
      voice.amp.gain.setTargetAtTime(0.35, t, 0.02);
      return;
    }

    // Mix: clean prefers triangle body; slow adds noise; fast adds thin high partials
    voice.gainA.gain.setTargetAtTime(0.18 + fast * 0.22 + clean * 0.12, t, atk);
    voice.gainB.gain.setTargetAtTime(0.28 + clean * 0.22 - fast * 0.18, t, atk);
    voice.gainC.gain.setTargetAtTime(0.02 + fast * 0.16, t, atk);

    voice.lp.frequency.setTargetAtTime(1100 + clean * 1400 + fast * 2200 - slow * 500, t, atk);
    voice.lp.Q.setTargetAtTime(0.6 + fast * 0.8, t, atk);
    voice.bp.frequency.setTargetAtTime(freq * (1.6 + clean * 0.6), t, atk);
    voice.bp.Q.setTargetAtTime(0.9 + clean * 0.5, t, atk);
    voice.hp.frequency.setTargetAtTime(140 + fast * 900, t, atk);
    voice.body.frequency.setTargetAtTime(500 + clean * 400, t, atk);
    voice.body.gain.setTargetAtTime(5 * clean - fast * 3, t, atk);

    voice.noiseBp.frequency.setTargetAtTime(500 + slow * 400 + fast * 2400, t, atk);
    voice.noiseBp.Q.setTargetAtTime(0.7 + slow * 0.6, t, atk);
    voice.noiseGain.gain.setTargetAtTime(slow * 0.42 + fast * 0.08, t, atk);

    voice.lfo.frequency.setTargetAtTime(4 + slow * 8, t, 0.05);
    voice.lfoGain.gain.setTargetAtTime(slow * 0.045, t, 0.05);

    var amp = (0.18 + intensity * 0.55) * (0.75 + clean * 0.25);
    if (fast > 0.6) amp *= 0.72;
    voice.amp.gain.setTargetAtTime(amp, t, 0.035);
  };

  BowSynth.prototype.pluck = function (freq, kind) {
    this._ensure();
    if (!this.ctx) return;
    var ctx = this.ctx;
    var t = ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    var f = ctx.createBiquadFilter();
    o.type = kind === "bad" ? "square" : "triangle";
    o.frequency.value = freq || 400;
    f.type = "lowpass";
    f.frequency.value = kind === "bad" ? 1200 : 2200;
    g.gain.setValueAtTime(kind === "bad" ? 0.12 : 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "bad" ? 0.18 : 0.28));
    o.connect(f);
    f.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  };

  BowSynth.prototype.chime = function (ok) {
    this._ensure();
    if (!this.ctx) return;
    var ctx = this.ctx;
    var t = ctx.currentTime;
    var freqs = ok ? [523.25, 659.25, 783.99] : [196, 185, 147];
    for (var i = 0; i < freqs.length; i++) {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freqs[i];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.02 + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7 + i * 0.08);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 1);
    }
  };

  global.BowSynth = BowSynth;
})(window);
