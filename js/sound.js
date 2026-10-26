/*
 * Tiny WebAudio synth: card flicks, chip clacks, felt thuds and a two-note
 * blackjack fanfare. No samples, no assets, ~4 KB.
 * The context is created lazily on the first gesture so autoplay policy is
 * never violated.
 */
(function (global) {
  'use strict';

  var ctx = null;
  var enabled = true;
  var master = null;

  function ensure() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  function env(node, peak, attack, decay, at) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    node.connect(g);
    g.connect(master);
    return g;
  }

  // Filtered noise burst: the sound of a card sliding across felt.
  function noise(dur, cutoff, peak, q, at) {
    if (!ctx) return;
    var t = at || now();
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      // Taper the tail by hand so the burst sounds like a swipe, not a hiss.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.7);
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = cutoff;
    bp.Q.value = q || 0.9;
    src.connect(bp);
    env(bp, peak, 0.006, dur, t);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  function tone(freq, dur, peak, type, at, glideTo) {
    if (!ctx) return;
    var t = at || now();
    var osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur * 0.9);
    env(osc, peak, 0.012, dur, t);
    osc.start(t);
    osc.stop(t + dur + 0.04);
  }

  var Sound = {
    available: function () {
      return !!(global.AudioContext || global.webkitAudioContext);
    },

    setEnabled: function (v) {
      enabled = !!v;
      if (enabled) ensure();
      return enabled;
    },

    isEnabled: function () {
      return enabled;
    },

    // Must be called from a user gesture before any sound can be heard.
    unlock: function () {
      if (!enabled) return false;
      var c = ensure();
      if (c && c.state === 'suspended' && c.resume) c.resume();
      return !!c;
    },

    deal: function (high) {
      if (!enabled || !ensure()) return;
      noise(0.12, high ? 3200 : 2100, 0.22, 1.1);
    },

    flip: function () {
      if (!enabled || !ensure()) return;
      noise(0.17, 1500, 0.3, 0.7);
      tone(360, 0.07, 0.05, 'triangle', now() + 0.03, 520);
    },

    chip: function (value) {
      if (!enabled || !ensure()) return;
      var base = value >= 500 ? 780 : value >= 100 ? 980 : value >= 25 ? 1240 : 1600;
      tone(base, 0.05, 0.14, 'square');
      noise(0.05, base * 1.6, 0.1, 2.2, now() + 0.005);
    },

    shuffle: function () {
      if (!enabled || !ensure()) return;
      // A riffle: a fast train of short clicks with a rising low-pass.
      for (var i = 0; i < 14; i++) {
        noise(0.05, 900 + i * 240, 0.09, 1.4, now() + i * 0.026);
      }
      tone(180, 0.12, 0.1, 'sine', now() + 0.4, 120);
    },

    win: function () {
      if (!enabled || !ensure()) return;
      var t = now();
      tone(523.25, 0.16, 0.14, 'triangle', t);
      tone(784, 0.22, 0.14, 'triangle', t + 0.09);
    },

    blackjack: function () {
      if (!enabled || !ensure()) return;
      var t = now();
      tone(523.25, 0.14, 0.16, 'triangle', t);
      tone(659.25, 0.14, 0.16, 'triangle', t + 0.1);
      tone(783.99, 0.16, 0.16, 'triangle', t + 0.2);
      tone(1046.5, 0.42, 0.18, 'triangle', t + 0.3);
      noise(0.3, 4200, 0.08, 1.2, t + 0.3);
    },

    lose: function () {
      if (!enabled || !ensure()) return;
      var t = now();
      tone(300, 0.2, 0.12, 'sine', t, 170);
      tone(150, 0.26, 0.1, 'sine', t + 0.12, 96);
    },

    push: function () {
      if (!enabled || !ensure()) return;
      tone(420, 0.16, 0.1, 'sine');
    },

    bust: function () {
      if (!enabled || !ensure()) return;
      var t = now();
      tone(200, 0.28, 0.16, 'sawtooth', t, 70);
      noise(0.2, 500, 0.14, 0.8, t);
    },

    click: function () {
      if (!enabled || !ensure()) return;
      tone(1400, 0.03, 0.07, 'square');
    },

    error: function () {
      if (!enabled || !ensure()) return;
      tone(220, 0.09, 0.1, 'square');
      tone(180, 0.09, 0.09, 'square', now() + 0.08);
    },

    decide: function (hit) {
      if (!enabled || !ensure()) return;
      // A soft marimba tick when the opponent commits to a line.
      tone(hit ? 660 : 440, 0.09, 0.06, 'sine');
    }
  };

  global.Sound = Sound;
})(typeof window !== 'undefined' ? window : globalThis);
