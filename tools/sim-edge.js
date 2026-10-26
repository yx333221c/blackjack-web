'use strict';
/*
 * Calibrate the difficulty ladder.
 *
 * Measures the house edge of every dealer algorithm against a flat-bet
 * basic-strategy bot and prints the numbers to paste back into
 * LEVELS[*].edge / LEVELS[*].defer in js/core.js.
 *
 *   node tools/sim-edge.js                # default: 6000 rounds x 4 replicas
 *   node tools/sim-edge.js 20000          # longer run
 *   node tools/sim-edge.js 6000 --scan    # sweep the knobs instead
 *
 * Why paired: the opponents' coin flips run on state._decRng, a stream that is
 * separate from the shoe. Holding both seeds fixed means a sweep over `defer`
 * or `sloppiness` replays *the same cards*, so the difference between two rows
 * is purely the algorithm and not a lucky shuffle.
 */

var path = require('path');
var core = require(path.join(__dirname, '..', 'js', 'core.js'));

var ROUNDS = parseInt(process.argv[2] || '6000', 10);
var REPLICAS = 4;
var STAKE = 10;
var BASE_SHOE = 555;
var BASE_DEC = 999;

function simulate(levelId, rounds, shoeSeed, decSeed, knobs) {
  var level = core.levelById(levelId);
  var saved = {};
  if (knobs) {
    Object.keys(knobs).forEach(function (k) {
      saved[k] = level[k];
      level[k] = knobs[k];
    });
  }
  var g = core.createGame({ seed: shoeSeed, bankroll: 1e9, level: levelId, rng: core.makeRng(shoeSeed) });
  g._decRng = core.makeRng(decSeed);
  var net = 0;
  var dealerHits = 0;
  var dealerStands = 0;
  var deferred = 0;
  for (var i = 0; i < rounds; i++) {
    core.placeBet(g, STAKE);
    if (!core.startRound(g)) return { error: 'round ' + i + ' could not start' };
    var guard = 0;
    while (g.phase !== core.PHASE.SETTLED && guard++ < 80) {
      if (g.phase === core.PHASE.INSURANCE) {
        core.takeInsurance(g, false);
        continue;
      }
      if (g.phase !== core.PHASE.PLAYER) break;
      var move = core.basicStrategy(core.activeHand(g), g.dealer[0], g.rules);
      if (move === 'double' && core.double(g)) continue;
      if (move === 'split' && core.split(g)) continue;
      if (move === 'surrender' && core.surrender(g)) continue;
      if (move === 'hit' && core.hit(g)) continue;
      if (core.stand(g)) continue;
      break;
    }
    if (g.phase !== core.PHASE.SETTLED) return { error: 'round ' + i + ' stuck in ' + g.phase };
    net += g.roundNet;
    core.drainEvents(g).forEach(function (e) {
      if (e.type !== 'decision') return;
      if (e.action === 'hit') dealerHits++;
      else dealerStands++;
      if (e.deferred) deferred++;
    });
    core.nextRound(g);
  }
  Object.keys(saved).forEach(function (k) {
    level[k] = saved[k];
  });
  return {
    edge: -net / (rounds * STAKE),
    dealerHits: dealerHits,
    dealerStands: dealerStands,
    deferred: deferred
  };
}

function measure(levelId, replicas, rounds, knobs) {
  var sum = 0;
  var hits = 0;
  var stands = 0;
  var defer = 0;
  var n = 0;
  for (var r = 0; r < replicas; r++) {
    var res = simulate(levelId, rounds, BASE_SHOE + r * 7, BASE_DEC + r * 13, knobs);
    if (res.error) {
      console.log(levelId + ': ' + res.error);
      process.exitCode = 1;
      return null;
    }
    sum += res.edge;
    hits += res.dealerHits;
    stands += res.dealerStands;
    defer += res.deferred;
    n++;
  }
  return { edge: sum / n, hits: hits, stands: stands, deferred: defer };
}

function pct(v) {
  return (v * 100).toFixed(2) + '%';
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s + ' ' : s + new Array(n - s.length + 1).join(' ');
}

var scanning = process.argv.indexOf('--scan') !== -1;

if (scanning) {
  console.log('Knob sweep (identical cards in every row, ' + REPLICAS + ' replicas x ' + ROUNDS + ' rounds)\n');
  [0.12, 0.2, 0.25, 0.32, 0.42].forEach(function (k) {
    var m = measure('novice', REPLICAS, ROUNDS, { sloppiness: k });
    if (m) console.log('novice  sloppiness=' + pad(k, 5) + ' house edge ' + pct(m.edge));
  });
  console.log('');
  [0.5, 0.6, 0.7, 0.8].forEach(function (d) {
    var m = measure('sharp', REPLICAS, ROUNDS, { defer: d });
    if (m) console.log('sharp   defer=' + pad(d, 5) + ' house edge ' + pct(m.edge));
  });
  console.log('');
  [0.3, 0.4, 0.5, 0.6, 0.7].forEach(function (d) {
    var m = measure('shark', REPLICAS, ROUNDS, { defer: d });
    if (m) console.log('shark   defer=' + pad(d, 5) + ' house edge ' + pct(m.edge));
  });
} else {
  console.log(
    pad('level', 9) + pad('house edge', 13) + pad('documented', 13) + pad('delta', 10) +
      pad('dealer hit%', 12) + 'deferred'
  );
  console.log(new Array(70).join('-'));
  core.LEVELS.forEach(function (level) {
    var m = measure(level.id, REPLICAS, ROUNDS);
    if (!m) return;
    var total = m.hits + m.stands;
    console.log(
      pad(level.id, 9) +
        pad(pct(m.edge), 13) +
        pad(pct(level.edge), 13) +
        pad(((m.edge - level.edge) * 100).toFixed(2) + 'pp', 10) +
        pad(total ? pct(m.hits / total) : 'n/a', 12) +
        m.deferred
    );
  });
  console.log('\nIf a delta exceeds ~1.5pp, paste the measured value into js/core.js -> LEVELS[*].edge.');
}
