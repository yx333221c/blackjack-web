/* eslint-disable */
// In-page driver for tools/soak.js. Evaluated as an expression body, so it
// must be a single async arrow invocation.
(async function () {
  var s = BJApp.state;
  var C = BJCore;
  var ROUNDS = __ROUNDS__;

  BJApp.setMotion(false);

  var bad = [];
  var settled = 0;
  var splits = 0;
  var doubles = 0;
  var ins = 0;
  var bjs = 0;
  var busts = 0;
  var surrenders = 0;
  var seenLevels = {};

  function domChecks(tag) {
    var txt = document.body.innerText;
    if (/NaN|undefined|\[object Object\]/.test(txt)) {
      bad.push(tag + ': placeholder text leaked into the UI');
    }
    var handNodes = document.querySelectorAll('#playerHands .hand').length;
    if (s.hands.length && handNodes !== s.hands.length) {
      bad.push(tag + ': rendered hands ' + handNodes + ' != state ' + s.hands.length);
    }
    var dealerNodes = document.querySelectorAll('#dealerCards .card').length;
    if (s.dealer.length && dealerNodes !== s.dealer.length) {
      bad.push(tag + ': rendered dealer cards ' + dealerNodes + ' != state ' + s.dealer.length);
    }
    var perHand = document.querySelectorAll('#playerHands .hand');
    for (var i = 0; i < perHand.length; i++) {
      var shown = perHand[i].querySelectorAll('.card').length;
      if (shown !== s.hands[i].cards.length) {
        bad.push(tag + ': hand ' + i + ' shows ' + shown + ' cards, state has ' + s.hands[i].cards.length);
      }
    }
    var betTxt = document.getElementById('betAmount').textContent.replace(/[^0-9]/g, '');
    var committed = s.hands.reduce(function (a, h) { return a + h.stake; }, 0);
    // The circle shows the felt stake only; insurance has its own well, so it
    // must NOT be added here or the same chips would be shown twice.
    if (s.phase === C.PHASE.SETTLED && committed && Number(betTxt) !== committed) {
      bad.push(tag + ': bet circle shows ' + betTxt + ' but ' + committed + ' was committed');
    }
  }

  for (var round = 0; round < ROUNDS; round++) {
    var lvl = C.LEVELS[round % C.LEVELS.length];
    C.setLevel(s, lvl.id);
    seenLevels[lvl.id] = (seenLevels[lvl.id] || 0) + 1;
    BJApp.sync();

    // Turn the surrender rule on for the last quarter of the run so the
    // opt-in path is exercised too.
    C.setRules(s, { surrender: round > ROUNDS * 0.75 });

    // Never bet more than the wallet holds; the UI disables those chips too.
    var want = Math.min(25 + (round % 4) * 25, s.bankroll);
    if (want < 1) {
      bad.push('round ' + round + ': nothing left to bet, bankroll ' + s.bankroll);
      break;
    }
    if (!C.placeBet(s, want)) {
      bad.push('round ' + round + ': bet ' + want + ' rejected at bankroll ' + s.bankroll);
      break;
    }
    if (!C.startRound(s)) {
      bad.push('round ' + round + ': startRound failed');
      break;
    }
    await BJApp.playEvents();
    domChecks('deal#' + round);

    var guard = 0;
    while (s.phase !== C.PHASE.SETTLED && guard++ < 40) {
      if (s.phase === C.PHASE.INSURANCE) {
        ins++;
        C.takeInsurance(s, round % 3 === 0);
        await BJApp.playEvents();
        continue;
      }
      var hand = C.activeHand(s);
      if (!hand) break;
      var mv = C.basicStrategy(hand, s.dealer[0], s.rules);
      var ok = false;
      if (mv === 'double' && C.canDouble(s)) { ok = C.double(s); if (ok) doubles++; }
      else if (mv === 'split' && C.canSplit(s)) { ok = C.split(s); if (ok) splits++; }
      else if (mv === 'surrender' && C.canSurrender(s)) { ok = C.surrender(s); if (ok) surrenders++; }
      else if (mv === 'hit') ok = C.hit(s);
      if (!ok) ok = C.stand(s);
      if (!ok) { bad.push('round ' + round + ': no action applied'); break; }
      await BJApp.playEvents();
      domChecks('act#' + round);
    }

    if (s.phase !== C.PHASE.SETTLED) {
      bad.push('round ' + round + ' stuck in phase ' + s.phase);
      break;
    }
    settled++;
    if (s.lastResult.hands.some(function (h) { return h.outcome === C.OUTCOME.BLACKJACK; })) bjs++;
    if (s.lastResult.hands.some(function (h) { return h.outcome === C.OUTCOME.BUST; })) busts++;
    if (!Number.isInteger(s.bankroll)) bad.push('fractional bankroll ' + s.bankroll);
    if (s.bankroll < 0) bad.push('negative bankroll ' + s.bankroll);
    domChecks('settle#' + round);

    // Go through the real path so the rebuy event is drained, not queued.
    BJApp.nextRound();
    await BJApp.playEvents();
    BJApp.sync();
  }

  var growth = {
    readLog: document.querySelectorAll('#readLog li').length,
    toasts: document.querySelectorAll('.toast').length,
    hands: document.querySelectorAll('#playerHands .hand').length,
    dealer: document.querySelectorAll('#dealerCards .card').length,
    pendingEvents: BJApp.state.events.length,
    stateLog: BJApp.state.log.length
  };

  return JSON.stringify({
    settled: settled,
    requested: ROUNDS,
    bad: bad,
    splits: splits,
    doubles: doubles,
    surrenders: surrenders,
    insuranceOffers: ins,
    blackjacks: bjs,
    busts: busts,
    bankroll: BJApp.state.bankroll,
    statsRounds: BJApp.state.stats.rounds,
    levelsSeen: seenLevels,
    growth: growth
  });
})();
