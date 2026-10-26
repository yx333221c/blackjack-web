/*
 * Rule-engine tests. Run with:  node test/core-test.js
 * Uses plain assertions so the repo stays dependency-free.
 */
'use strict';

var path = require('path');
var core = require(path.join(__dirname, '..', 'js', 'core.js'));

var passed = 0;
var failures = [];

function ok(cond, label) {
  if (cond) {
    passed++;
  } else {
    failures.push(label);
    console.error('FAIL  ' + label);
  }
}

function eq(actual, expected, label) {
  ok(actual === expected, label + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}

function near(actual, expected, label, tol) {
  var t = tol === undefined ? 1e-9 : tol;
  ok(Math.abs(actual - expected) <= t, label + '  (got ' + actual + ', want ~' + expected + ')');
}

// Build a card object from a compact "10s" / "Ah" style string.
function C(spec) {
  var rank = spec.slice(0, -1);
  var suit = { s: 'S', h: 'H', d: 'D', c: 'C' }[spec.slice(-1)];
  return { id: '0' + suit + rank, rank: rank, suit: suit, red: suit === 'H' || suit === 'D' };
}

function cardsOf() {
  return Array.prototype.slice.call(arguments).map(C);
}

// A game whose shoe is a scripted stack (first entry is drawn first).
function scriptedGame(stack, opts) {
  var g = core.createGame(opts || {});
  g.shoe.cards = stack.slice();
  g.shoe.index = 0;
  g.shoe.cutIndex = stack.length; // never reshuffle mid-test
  g.shoe.decks = Math.max(1, Math.round(stack.length / 52));
  return g;
}

// Put an arbitrary amount into the circle (the rack composes it from chips).
function bet(g, amount) {
  return core.placeBet(g, amount);
}

// Drive a live round to a settle without relying on strategy.
function playOut(g) {
  var guard = 0;
  while (g.phase !== core.PHASE.SETTLED && guard++ < 60) {
    if (g.phase === core.PHASE.INSURANCE) core.takeInsurance(g, false);
    else if (g.phase === core.PHASE.PLAYER) core.stand(g);
    else break;
  }
  return g;
}

/* ------------------------------------------------------------------ */
console.log('\n— hand values —');

eq(core.handValue(cardsOf('Ah')).total, 11, 'single ace is 11');
ok(core.handValue(cardsOf('Ah')).soft, 'single ace is soft');
eq(core.handValue(cardsOf('Ah', '10s')).total, 21, 'ace + ten is 21');
ok(core.handValue(cardsOf('Ah', '10s')).soft, 'ace + ten is soft 21');
eq(core.handValue(cardsOf('Ah', 'Ad', '9s')).total, 21, 'A+A+9 = 21');
eq(core.handValue(cardsOf('Ah', 'Ad', 'As', '9s')).total, 12, 'three aces + 9 = 12');
eq(core.handValue(cardsOf('9s', '8d', '6c')).total, 23, 'hard 23');
ok(core.handValue(cardsOf('9s', '8d', '6c')).bust, '23 busts');
eq(core.handValue(cardsOf('Ah', 'Ac', '5d', '9s')).total, 16, 'A+A+5+9 demotes both aces to 16');
eq(core.handValue([]).total, 0, 'empty hand is 0');
ok(core.isBlackjack(cardsOf('Ah', 'Ks')), 'A+K is a natural');
ok(!core.isBlackjack(cardsOf('10s', '5d', '6c')), 'three-card 21 is not a natural');
ok(core.samePair(cardsOf('8s', '8h')), 'pair by value across suits');
ok(core.samePair(cardsOf('Ks', '10h')), 'K+10 counts as a pair of tens');
ok(!core.samePair(cardsOf('8s', '9h')), '8+9 is not a pair');

console.log('\n— shoe —');

var shoe = core.buildShoe({ decks: 1 }, core.makeRng(7));
eq(shoe.cards.length, 52, 'one deck = 52 cards');
eq(core.shoeRemaining(shoe), 52, 'fresh shoe is full');
var comp = core.composition(shoe);
var sumP = comp.probs.reduce(function (a, b) { return a + b.p; }, 0);
near(sumP, 1, 'composition probabilities sum to 1');
eq(comp.probs.filter(function (p) { return p.value === 10; })[0].count, 16, 'one deck has sixteen 10-valued cards');
var drawn = core.draw(shoe);
ok(drawn && drawn.rank, 'draw returns a card');
eq(core.shoeRemaining(shoe), 51, 'draw advances the shoe');
ok(!core.needShuffle(shoe), 'fresh shoe does not need a shuffle');
var cutShoe = core.buildShoe({ decks: 6, penetration: 0.5 }, core.makeRng(3));
cutShoe.index = cutShoe.cutIndex;
ok(core.needShuffle(cutShoe), 'reaching the cut card triggers a shuffle');
var cnt = core.buildShoe({ decks: 1 }, function () { return 0.999; });
cnt.cards = cardsOf('2s', '3s', '4s', '5s', '6s', 'Ks', 'Qs', 'Js', '10s', 'Ah').concat(cnt.cards.slice(0, 42));
cnt.index = 0;
eq(core.runningCount(cnt), 5 - 5, 'Hi-Lo running count of a scripted stack');
eq(core.trueCount(core.buildShoe({ decks: 1 }, core.makeRng(2))), 0, 'true count is 0 on a fresh shoe');

// A dealt card is a copy: marking it face-down for one round must never stick
// to the shoe slot, or a later round would deal a face-down *up* card.
var leakShoe = core.buildShoe({ decks: 1 }, core.makeRng(31));
var first = core.draw(leakShoe);
first.hidden = true;
ok(leakShoe.cards[0].hidden === undefined, 'the shoe slot keeps no hidden flag');
var again = core.draw(leakShoe, core.makeRng(1));
ok(again !== leakShoe.cards[1], 'draw returns a copy, not the live slot');
var peek = core.draw(leakShoe);
ok(!peek.hidden, 'a later draw of the same slot is not flagged hidden');

console.log('\n— settlement —');

var h1 = core.createHand(100, 0);
h1.cards = cardsOf('Ah', 'Ks');
var r = core.settle(h1, cardsOf('10s', '9d', '2c'), {});
eq(r.outcome, core.OUTCOME.BLACKJACK, 'natural wins');
eq(r.net, 150, 'natural pays 3:2');
eq(r.returned, 250, 'natural returns stake + 3:2');

var hPush = core.createHand(100, 0);
hPush.cards = cardsOf('Ah', 'Ks');
eq(core.settle(hPush, cardsOf('Ac', 'Qd'), {}).outcome, core.OUTCOME.PUSH, 'natural vs natural pushes');
eq(core.settle(hPush, cardsOf('Ac', 'Qd'), {}).net, 0, 'natural vs natural returns the stake');

var splitBJ = core.createHand(100, 1);
splitBJ.cards = cardsOf('Ah', 'Ks');
splitBJ.fromSplit = true;
var splitRes = core.settle(splitBJ, cardsOf('10s', '7d', '2c'), {});
eq(splitRes.outcome, core.OUTCOME.WIN, 'a 21 rebuilt from a split is a plain 21, not a natural');
eq(splitRes.net, 100, 'split 21 pays 1:1, not 3:2');

var hBust = core.createHand(50, 0);
hBust.cards = cardsOf('10s', '9d', '5c');
eq(core.settle(hBust, cardsOf('9s', '9d'), {}).outcome, core.OUTCOME.BUST, 'bust loses even when the dealer busts');

var hWin = core.createHand(50, 0);
hWin.cards = cardsOf('10s', '9d');
eq(core.settle(hWin, cardsOf('10s', '8d', '5c'), {}).outcome, core.OUTCOME.WIN, 'dealer bust means a win');

var hLower = core.createHand(50, 0);
hLower.cards = cardsOf('10s', '7d');
eq(core.settle(hLower, cardsOf('10s', '9d'), {}).outcome, core.OUTCOME.LOSE, 'lower total loses');

var hSur = core.createHand(51, 0);
hSur.cards = cardsOf('10s', '6d');
hSur.surrendered = true;
var sur = core.settle(hSur, cardsOf('10s', '9d'), {});
eq(sur.outcome, core.OUTCOME.SURRENDER, 'surrender is its own outcome');
eq(sur.net, -25, 'surrender returns half (odd stake rounds down)');

console.log('\n— dealer algorithms (difficulty) —');

function decideFor(levelId, handCards, targets, opts) {
  var s = core.buildShoe({ decks: 1 }, (opts && opts.rng) || core.makeRng(11));
  // rng() === 1 means "never defer", so the level is forced to play its own
  // algorithm instead of falling back to house procedure by coin flip.
  return core.decideDealer(levelId, {
    cards: handCards,
    value: core.handValue(handCards),
    targets: targets || [{ total: 20, bust: false, bj: false, stake: 10 }],
    shoe: s,
    comp: core.composition(s),
    rules: (opts && opts.rules) || core.DEFAULT_RULES,
    rng: (opts && opts.rng) || function () { return 1; },
    trueCount: (opts && opts.trueCount) || 0
  });
}

// House: pure table policy.
eq(decideFor('house', cardsOf('10s', '6d')).action, 'hit', 'house draws on 16');
eq(decideFor('house', cardsOf('10s', '7d')).action, 'stand', 'house stands on 17');
eq(decideFor('house', cardsOf('Ah', '6d')).action, 'stand', 'S17: house stands on soft 17');
eq(
  decideFor('house', cardsOf('Ah', '6d'), null, { rules: { stopsOnSoft17: false } }).action,
  'hit',
  'H17: house hits soft 17'
);

// Sharp: chases a total it does not yet hold, holds a lead it already has.
var sharpBehind = decideFor('sharp', cardsOf('10s', '6d'), [{ total: 19, bust: false, bj: false, stake: 10 }]);
eq(sharpBehind.action, 'hit', 'sharp chases when behind your visible total');
eq(sharpBehind.reasonKey, 'sharp.belowFloor', 'sharp names the reason it pressed');
var sharpAhead = decideFor('sharp', cardsOf('10s', '7d'), [{ total: 16, bust: false, bj: false, stake: 10 }]);
eq(sharpAhead.action, 'stand', 'sharp holds a lead instead of gambling');
var sharpDead = decideFor('sharp', cardsOf('10s', '7d'), [{ total: 15, bust: true, bj: false, stake: 10 }]);
eq(sharpDead.reasonKey, 'sharp.wonAlready', 'sharp stops reasoning once every hand is dead');

// Shark: exact EV over the live composition.
var sharkDec = decideFor('shark', cardsOf('10s', '6d'), [{ total: 20, bust: false, bj: false, stake: 10 }]);
ok(sharkDec.params && sharkDec.params.stand && sharkDec.params.draw, 'shark quotes both EVs');
ok(sharkDec.action === 'hit' || sharkDec.action === 'stand', 'shark returns a legal action');
// Standing on 19 against your 20 is a certain loss, but an ace rescues it:
// the DP must find that and press.
var sharkPress = decideFor('shark', cardsOf('10s', '9h'), [{ total: 20, bust: false, bj: false, stake: 10 }]);
eq(sharkPress.action, 'hit', 'shark presses hard 19 when standing is a certain loss');
// Hard 20 against your 19 is a locked win; every card breaks it.
var sharkHold = decideFor('shark', cardsOf('10s', 'Kh'), [{ total: 19, bust: false, bj: false, stake: 10 }]);
eq(sharkHold.action, 'stand', 'shark never breaks a winning hard 20');
// Soft 20 against your 20: hitting turns a push into a likely loss.
var sharkPush = decideFor('shark', cardsOf('Ah', '9s'), [{ total: 20, bust: false, bj: false, stake: 10 }]);
eq(sharkPush.action, 'stand', 'shark takes the push rather than wrecking soft 20');

// Novice is the noisy one: over a seed sweep it must sometimes disobey the
// table policy in both directions.
var disobeyLow = 0;
var drawOn17 = 0;
for (var sIdx = 0; sIdx < 400; sIdx++) {
  var noisy = core.makeRng(sIdx + 1);
  if (decideFor('novice', cardsOf('10s', '6d'), null, { rng: noisy }).action === 'stand') disobeyLow++;
  if (decideFor('novice', cardsOf('10s', '7d'), null, { rng: noisy }).action === 'hit') drawOn17++;
}
ok(disobeyLow > 20 && disobeyLow < 380, 'novice stands on 16 sometimes (' + disobeyLow + '/400)');
ok(drawOn17 > 20 && drawOn17 < 380, 'novice hits on 17 sometimes (' + drawOn17 + '/400)');

eq(core.levelById('nope').id, 'house', 'unknown level id falls back to house');

console.log('\n— difficulty: same board, different algorithms —');

// One board where the four algorithms genuinely disagree: dealer 10,6 (16)
// against a player showing 20. rng=1 keeps every level on its own algorithm.
var ladderBoard = cardsOf('10s', '6d');
var ladderTargets = [{ total: 20, bust: false, bj: false, stake: 10 }];
var housePick = decideFor('house', ladderBoard, ladderTargets);
var sharpPick = decideFor('sharp', ladderBoard, ladderTargets);
var sharkPick = decideFor('shark', ladderBoard, ladderTargets);
eq(housePick.action, 'hit', 'house follows procedure and draws on 16');
eq(sharpPick.action, 'hit', 'sharp draws because it is behind your 20');
eq(sharpPick.reasonKey, 'sharp.belowFloor', 'sharp reports which rule fired');
ok(sharkPick.action === 'hit' || sharkPick.action === 'stand', 'shark answers with a legal action');
ok(sharkPick.params.stand !== sharkPick.params.draw, 'shark distinguishes the two EVs it compared');

// A board where the algorithms must split: dealer hard 20 against your 19.
// House procedure stands, sharp stands, the EV solver also stands — but the
// novice cannot resist over-drawing sometimes.
var hold20 = cardsOf('10s', 'Kh');
eq(decideFor('house', hold20, [{ total: 19, bust: false, bj: false, stake: 10 }]).action, 'stand', 'house holds 20');
eq(decideFor('sharp', hold20, [{ total: 19, bust: false, bj: false, stake: 10 }]).action, 'stand', 'sharp holds 20');
eq(decideFor('shark', hold20, [{ total: 19, bust: false, bj: false, stake: 10 }]).action, 'stand', 'shark holds 20');

// The same target with the sharp level fully deferring must produce house
// procedure, flagged as a fallback so the panel can say so honestly.
var deferring = decideFor('sharp', cardsOf('10s', '6d'), ladderTargets, { rng: function () { return 0.2; } });
eq(deferring.deferred, true, 'a deferred decision is marked as a fallback');
ok(deferring.reasonKey.indexOf('house.') === 0, 'the fallback quotes the table policy (' + deferring.reasonKey + ')');
var notDeferring = decideFor('sharp', cardsOf('10s', '6d'), ladderTargets, { rng: function () { return 0.99; } });
ok(!notDeferring.deferred, 'a committed decision carries no fallback flag');
ok(notDeferring.reasonKey.indexOf('sharp.') === 0, 'a committed decision quotes its own read');

// Soft 17 is where S17/H17 changes the answer for the policy levels.
var soft17 = cardsOf('Ah', '6d');
eq(decideFor('house', soft17, ladderTargets).action, 'stand', 'S17 house parks soft 17');
eq(
  decideFor('house', soft17, ladderTargets, { rules: { stopsOnSoft17: false } }).action,
  'hit',
  'H17 house draws on soft 17'
);

// A positive true count enriches tens in the shark's belief, so the same 16
// must look *worse* to draw when the count is high.
var lowCount = decideFor('shark', ladderBoard, ladderTargets, { trueCount: -3 });
var highCount = decideFor('shark', ladderBoard, ladderTargets, { trueCount: 3 });
ok(parseFloat(highCount.params.draw) <= parseFloat(lowCount.params.draw) + 1e-9,
  'a rich count lowers the shark draw EV (was ' + lowCount.params.draw + ' -> ' + highCount.params.draw + ')');
ok(lowCount.params.tc === '-3.0' && highCount.params.tc === '3.0', 'the panel shows the true count it used');

// Every level must carry the full bilingual metadata the UI renders.
core.LEVELS.forEach(function (l) {
  ['id', 'edge', 'zh', 'en', 'zhAlgo', 'enAlgo', 'zhBlurb', 'enBlurb', 'zhStyle', 'enStyle'].forEach(function (key) {
    ok(typeof l[key] === (key === 'edge' ? 'number' : 'string') && (key === 'edge' || l[key].length),
      l.id + ' defines ' + key);
  });
  ok(typeof l.decide === 'function', l.id + ' has a decide() algorithm');
});

// The documented ladder must be ordered hardest-last for the house.
eq(core.LEVELS.map(function (l) { return l.id; }).join(','), 'novice,house,sharp,shark', 'ladder order');
ok(core.LEVELS[0].edge < core.LEVELS[1].edge, 'novice edge < house edge');
ok(core.LEVELS[1].edge < core.LEVELS[2].edge, 'house edge < sharp edge');
ok(core.LEVELS[2].edge < core.LEVELS[3].edge, 'sharp edge < shark edge');

// beliefFor() must stay a distribution over exactly the eleven card values.
var belief = core.countedComposition ? core.countedComposition(2) : null;
if (belief) {
  near(belief.probs.reduce(function (a, b) { return a + b.p; }, 0), 1, 'counted belief sums to 1');
}

console.log('\n— basic strategy —');

function hint(cards, upRank, rules) {
  var h = core.createHand(10, 0);
  h.cards = cards;
  return core.basicStrategy(h, { rank: upRank, suit: 'S', red: false }, rules || core.DEFAULT_RULES);
}
eq(hint(cardsOf('Ah', 'Ad'), '6'), 'split', 'A,A vs 6 -> split');
eq(hint(cardsOf('10s', 'Kd'), '6'), 'stand', '10,10 vs 6 -> stand');
eq(hint(cardsOf('8s', '8d'), '10'), 'split', '8,8 vs 10 -> split');
eq(hint(cardsOf('5s', '6d'), '6'), 'double', '11 vs 6 -> double');
eq(hint(cardsOf('10s', '6d'), '10'), 'hit', '16 vs 10 -> hit (no surrender configured)');
eq(
  hint(cardsOf('10s', '6d'), '10', { surrender: true, decks: 6 }),
  'surrender',
  '16 vs 10 -> surrender when the table allows it'
);
eq(hint(cardsOf('Ah', '7d'), '3'), 'double', 'soft 18 vs 3 -> double');
eq(hint(cardsOf('10s', '2d'), '2'), 'hit', '12 vs 2 -> hit');
eq(hint(cardsOf('10s', '2d'), '4'), 'stand', '12 vs 4 -> stand');

console.log('\n— round flow —');

// Deal order is player, dealer, player, dealer(hole) — so the scripted stack is
// interleaved, not four-then-four.

// Player 20 vs dealer 19: player stands, house policy stands at 19.
var g1 = scriptedGame([
  C('10s'), // player card 1
  C('9d'), // dealer up
  C('Kh'), // player card 2
  C('10d') // dealer hole -> 19
], { bankroll: 500 });
core.addChip(g1, 100);
eq(g1.pendingBet, 100, 'chip moves into the bet circle');
core.addChip(g1, 5);
eq(g1.pendingBet, 105, 'chips stack');
core.removeChip(g1, 5);
eq(g1.pendingBet, 100, 'chip removal');
eq(g1.bankroll, 500, 'bankroll untouched until the round starts');
core.startRound(g1);
eq(g1.phase, core.PHASE.PLAYER, 'round enters the player phase');
eq(g1.bankroll, 400, 'stake leaves the bankroll at deal time');
eq(g1.hands[0].cards.length, 2, 'player got two cards');
eq(g1.dealer.length, 2, 'dealer got two cards');
ok(g1.dealer[1].hidden, 'dealer hole card starts hidden');
core.stand(g1);
eq(g1.phase, core.PHASE.SETTLED, 'standing ends the round once the dealer plays');
eq(g1.dealer[1].hidden, false, 'the hole card is revealed');
eq(core.handValue(g1.dealer).total, 19, 'dealer sits on 19');
eq(g1.lastResult.net, 100, 'player 20 beats dealer 19');
eq(g1.bankroll, 600, 'win returns stake + profit');
eq(g1.stats.wins, 1, 'stats: one win');
eq(g1.stats.rounds, 1, 'stats: one round');
eq(g1.log.length, 1, 'the dealer logged exactly one decision');
eq(g1.log[0].reasonKey, 'house.at17', 'the panel reason names the table policy');

// Bust keeps the stake in the house.
var g2 = scriptedGame([C('10s'), C('9d'), C('9h'), C('10c'), C('5s')], { bankroll: 200 });
bet(g2, 50);
core.startRound(g2);
core.hit(g2);
eq(g2.hands[0].busted, true, 'hitting past 21 busts the hand');
eq(g2.phase, core.PHASE.SETTLED, 'bust auto-advances to the dealer');
eq(g2.lastResult.net, -50, 'bust loses the stake');
eq(g2.bankroll, 150, 'bust pays nothing back');

// Natural pays 3:2, settles instantly and never runs the dealer algorithm.
var g3 = scriptedGame([C('Ah'), C('9d'), C('Ks'), C('10c'), C('5s')], { bankroll: 200, level: 'house' });
core.addChip(g3, 100);
core.startRound(g3);
eq(g3.phase, core.PHASE.SETTLED, 'player natural settles instantly');
eq(g3.lastResult.net, 150, 'natural pays 3:2');
eq(g3.stats.blackjacks, 1, 'stats: natural counted');
eq(g3.log.length, 0, 'natural round runs no dealer algorithm');

// A 21 rebuilt from a split is a plain 21, never a natural (see settle above).

// Dealer natural, insurance taken: the 2:1 pay hedge cancels the loss.
var g4 = scriptedGame([C('9c'), C('Ad'), C('7s'), C('Kh'), C('5d')], { bankroll: 300 });
core.addChip(g4, 100);
core.startRound(g4);
eq(g4.phase, core.PHASE.INSURANCE, 'dealer ace offers insurance');
core.takeInsurance(g4, true);
eq(g4.insurance.stake, 50, 'insurance costs half the hand');
eq(g4.phase, core.PHASE.SETTLED, 'dealer natural settles the round');
eq(g4.insurance.net, 100, 'insurance pays 2:1');
eq(g4.lastResult.net, 0, 'insurance win offsets the natural: a perfect hedge');
eq(g4.bankroll, 300, 'hedged round returns the bankroll to even');

// Dealer ace with no insurance: a player natural still wins.
var g5 = scriptedGame([C('Ah'), C('Ad'), C('Ks'), C('9c'), C('7s')], { bankroll: 300 });
core.addChip(g5, 100);
core.startRound(g5);
core.takeInsurance(g5, false);
eq(g5.phase, core.PHASE.SETTLED, 'declining insurance still resolves the natural board');
eq(g5.lastResult.net, 150, 'natural beats the non-natural ace board');
eq(g5.bankroll, 450, 'natural payout lands in the bankroll');

// Insurance loses when the dealer does not hold a natural.
var g6 = scriptedGame([C('10s'), C('Ad'), C('Kh'), C('8c'), C('2d')], { bankroll: 300 });
bet(g6, 100);
core.startRound(g6);
core.takeInsurance(g6, true);
eq(g6.phase, core.PHASE.PLAYER, 'no dealer natural -> play continues');
eq(g6.insurance.net, -50, 'a failed insurance keeps only the premium');
core.stand(g6);
eq(core.handValue(g6.dealer).total, 19, 'the dealer settles on soft 19');
eq(g6.lastResult.hands[0].outcome, core.OUTCOME.WIN, 'the hand itself is won');
eq(g6.lastResult.net, 50, 'win of 100 minus the 50 insurance loss nets 50');
eq(g6.bankroll, 350, 'the bankroll reflects hand + insurance together');

// Split flow: 8,8 against a dealer 10.
var g7 = scriptedGame(
  [C('8s'), C('10c'), C('8d'), C('6h'), C('Ah'), C('3s'), C('7c'), C('2d')],
  { bankroll: 400 }
);
core.addChip(g7, 100);
core.startRound(g7);
ok(core.canSplit(g7), 'pair of eights is splittable');
core.split(g7);
eq(g7.hands.length, 2, 'split creates a second hand');
eq(g7.bankroll, 200, 'second hand is staked');
eq(g7.hands[0].stake, 100, 'hand one keeps its stake');
eq(g7.hands[1].stake, 100, 'hand two carries an equal stake');
eq(g7.hands[1].fromSplit, true, 'hand two is flagged as a split');
eq(g7.hands[0].fromSplit, true, 'the original hand is flagged as a split too');
eq(core.handValue(g7.hands[0].cards).total, 19, 'hand one picks up an ace for 19');
eq(core.handValue(g7.hands[1].cards).total, 11, 'hand two picks up a three for 11');
eq(g7.active, 0, 'play continues on the original hand');
core.stand(g7);
eq(g7.active, 1, 'turn moves to the split hand');
core.stand(g7);
eq(g7.phase, core.PHASE.SETTLED, 'both hands played -> dealer turn -> settle');
eq(g7.dealer.length, 3, 'the house drew once on 16');
eq(g7.lastResult.hands.length, 2, 'result reports every hand');
eq(g7.lastResult.net, 200, 'the dealer busted: both split hands win');

// Split aces get exactly one card each and can never be a natural.
var g8 = scriptedGame([C('Ah'), C('5c'), C('Ad'), C('6h'), C('7s'), C('8d'), C('9c'), C('2s')], {
  bankroll: 400
});
core.addChip(g8, 100);
core.startRound(g8);
core.split(g8);
eq(g8.phase, core.PHASE.SETTLED, 'split aces close both hands and go straight to the dealer');
eq(g8.hands[0].cards.length, 2, 'first ace hand holds exactly two cards');
eq(g8.hands[1].cards.length, 2, 'second ace hand holds exactly two cards');
eq(core.handValue(g8.hands[0].cards).total, 18, 'A+7 is 18 after the forced stand');
ok(!g8.lastResult.hands.some(function (x) { return x.outcome === core.OUTCOME.BLACKJACK; }),
  'split aces never count as a natural');

// Double: stake doubles, exactly one card, hand closes.
var g9 = scriptedGame([C('6s'), C('10c'), C('5d'), C('9h'), C('10h')], { bankroll: 300 });
bet(g9, 50);
core.startRound(g9);
eq(g9.bankroll, 250, 'the opening stake leaves the bankroll');
ok(core.canDouble(g9), '11 vs 10 is double-eligible');
core.double(g9); // settles synchronously: extra stake, one card, dealer plays
eq(g9.hands[0].stake, 100, 'double doubles the stake');
eq(g9.hands[0].cards.length, 3, 'double draws exactly one card');
eq(core.handValue(g9.hands[0].cards).total, 21, 'the double card makes 21');
eq(g9.phase, core.PHASE.SETTLED, 'the hand closes after the double card');
eq(g9.lastResult.hands[0].outcome, core.OUTCOME.WIN, 'a doubled 21 is a plain 21, not a natural');
eq(g9.lastResult.net, 100, 'doubled 21 beats a dealer 19');
// 300 wallet - 50 stake - 50 extra - 19 dealer nothing + 200 returned = 400.
eq(g9.bankroll, 400, 'both halves of the doubled stake come back with profit');

// Doubling into a bust costs the whole doubled stake. Note that an 11 can
// never bust on a single card, so this board starts on a hard 15.
var g9b = scriptedGame([C('10s'), C('10c'), C('5d'), C('9h'), C('Kd')], { bankroll: 300 });
bet(g9b, 50);
core.startRound(g9b);
eq(core.handValue(g9b.hands[0].cards).total, 15, 'the board starts on a hard 15');
ok(core.canDouble(g9b), 'a hard 15 may still double by the rules');
core.double(g9b);
ok(g9b.hands[0].busted, 'the double card busted the hand');
eq(core.handValue(g9b.hands[0].cards).total, 25, '15 + a ten busts at 25');
eq(g9b.lastResult.net, -100, 'a doubled bust loses both halves');
eq(g9b.bankroll, 200, 'nothing comes back after a doubled bust');

// Surrender is opt-in and costs half the stake.
var g10 = scriptedGame([C('10s'), C('9d'), C('6d'), C('10h'), C('5s')], {
  bankroll: 300,
  rules: { surrender: true }
});
core.addChip(g10, 100);
core.startRound(g10);
ok(core.canSurrender(g10), 'early surrender is offered when the rule is on');
core.surrender(g10);
eq(g10.lastResult.net, -50, 'surrender costs half the stake');
eq(g10.bankroll, 250, 'half the stake comes back');

// A table without the surrender rule refuses it.
var g10b = scriptedGame([C('10s'), C('9d'), C('6d'), C('10h')], { bankroll: 300 });
core.addChip(g10b, 100);
core.startRound(g10b);
eq(core.canSurrender(g10b), false, 'surrender is unavailable by default');
eq(core.surrender(g10b), false, 'surrender is refused when the rule is off');

// Guard rails: illegal actions are refused.
var g11 = scriptedGame([C('Ah'), C('9d'), C('Ks'), C('7c'), C('5s')], { bankroll: 100 });
eq(core.hit(g11), false, 'cannot hit before betting');
eq(core.startRound(g11), false, 'cannot start with an empty bet circle');
core.addChip(g11, 100);
eq(core.addChip(g11, 5), false, 'a chip richer than the bankroll is refused');
eq(g11.pendingBet, 100, 'the refused chip did not land');
core.startRound(g11);
eq(g11.phase, core.PHASE.SETTLED, 'a natural board settles without player input');
eq(core.stand(g11), false, 'cannot act after the round settled');
eq(g11.bankroll, 250, 'the natural paid out');
eq(core.nextRound(g11), true, 'nextRound reopens betting');
eq(g11.phase, core.PHASE.BETTING, 'phase returns to betting');
eq(g11.pendingBet, 0, 'bet circle clears');
eq(core.replayBet(g11), true, 'replayBet re-bets the previous stake');
eq(g11.pendingBet, 100, 'replayed amount matches the last bet');

// Rebuy when the bankroll hits zero.
var g12 = scriptedGame([C('10s'), C('9d'), C('9h'), C('10c'), C('5s')], { bankroll: 100 });
core.addChip(g12, 100);
core.startRound(g12);
core.hit(g12);
eq(g12.bankroll, 0, 'losing the whole bankroll leaves zero');
eq(g12.lastResult.bankrupt, true, 'round result flags bankruptcy');
eq(core.drainEvents(g12).filter(function (e) { return e.type === 'broke'; }).length, 1, 'a broke event is emitted');
core.nextRound(g12);
eq(g12.bankroll, 1000, 'rebuy restores the bankroll for the next round');

// Level switching and the cut card.
var g13 = core.createGame({ seed: 5 });
eq(core.setLevel(g13, 'shark'), 'shark', 'setLevel applies');
eq(core.setLevel(g13, 'bogus'), 'house', 'setLevel falls back on a bad id');
eq(core.clearBet(g13), false, 'clearBet on an empty circle is a no-op');
g13.rules.penetration = 0.95;
g13.shoe = core.buildShoe(g13.rules, g13._rng);
g13.shoe.index = g13.shoe.cards.length;
core.addChip(g13, 25);
core.startRound(g13);
var shuffleEvents = core.drainEvents(g13).filter(function (e) { return e.type === 'shuffle'; });
ok(shuffleEvents.length >= 1, 'an exhausted shoe is rebuilt before dealing');
ok(core.shoeRemaining(g13.shoe) > 0, 'the fresh shoe has cards');

// Events are queued for the UI and drained exactly once.
var g14e = scriptedGame([C('Ah'), C('9d'), C('Ks'), C('10c')], { bankroll: 100 });
bet(g14e, 10);
core.startRound(g14e);
var q1 = core.drainEvents(g14e);
ok(q1.length > 0, 'events are queued during a round');
eq(core.drainEvents(g14e).length, 0, 'draining empties the queue');
ok(q1.filter(function (e) { return e.type === 'deal'; }).length >= 4, 'four deal events');

console.log('\n— persistence —');

// A finished session round-trips exactly.
var g14 = core.createGame({ seed: 99, bankroll: 777, level: 'sharp' });
bet(g14, 25);
core.startRound(g14);
playOut(g14);
eq(g14.phase, core.PHASE.SETTLED, 'the scripted round reached a settle');
var snap = core.serialize(g14);
var g15 = core.deserialize(JSON.parse(JSON.stringify(snap)));
eq(g15.bankroll, g14.bankroll, 'bankroll survives a reload');
eq(g15.level, 'sharp', 'level survives a reload');
eq(g15.stats.rounds, 1, 'stats survive a reload');
eq(g15.shoe.index, snap.shoe.index, 'shoe position survives a reload');
eq(g15.lastBet, 25, 'the last wager is remembered for replay');
eq(g15.phase, core.PHASE.BETTING, 'a reload resumes at a legal phase');

// An in-flight round never costs the player money on reload: the stake that is
// still on the felt is folded back into the bankroll.
var g16 = core.createGame({ seed: 1234, bankroll: 500 });
bet(g16, 100);
core.startRound(g16);
eq(g16.bankroll, 400, 'the stake leaves the bankroll mid-round');
var mid = core.serialize(g16);
eq(mid.bankroll, 500, 'serializing refunds the live stake');
eq(mid.pendingBet, 0, 'a live bet circle is not carried across a reload');
var g17 = core.deserialize(mid);
eq(g17.bankroll, 500, 'the resumed bankroll is whole');
eq(g17.hands.length, 0, 'the abandoned round is gone');
eq(g17.phase, core.PHASE.BETTING, 'the resumed phase is betting');

// Betting-chip state round-trips while the player is still at the felt.
var g18 = core.createGame({ seed: 7, bankroll: 200 });
bet(g18, 75);
var pre = core.deserialize(core.serialize(g18));
eq(pre.pendingBet, 75, 'an unfinished bet circle survives a reload');
eq(pre.bankroll, 200, 'the wallet is untouched before the deal');

eq(core.deserialize(null).bankroll, 1000, 'deserialize(null) yields a fresh game');
eq(core.deserialize({ bankroll: 'nope' }).bankroll, 1000, 'a garbage bankroll is ignored');
eq(core.deserialize({ bankroll: -50 }).bankroll, 1000, 'a negative bankroll is ignored');
eq(core.deserialize({ level: 'bogus' }).level, 'house', 'a garbage level falls back');
eq(core.deserialize({ stats: null }).stats.rounds, 0, 'missing stats stay empty');

// A flat-bet basic-strategy bot: the reference opponent the difficulty ladder
// is calibrated against. Returns net loss per round for measurement.
function selfPlay(levelId, rounds, seed) {
  var g = core.createGame({ seed: seed, bankroll: 10000000, level: levelId, rng: core.makeRng(seed) });
  var totalNet = 0;
  var stuck = 0;
  for (var round = 0; round < rounds; round++) {
    bet(g, 10);
    if (!core.startRound(g)) {
      failures.push('could not start round ' + round + ' at level ' + levelId);
      break;
    }
    var guard = 0;
    while (g.phase !== core.PHASE.SETTLED && guard++ < 60) {
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
    if (g.phase !== core.PHASE.SETTLED) {
      stuck++;
      break;
    }
    totalNet += g.roundNet;
    if (g.bankroll % 1 !== 0) {
      failures.push('fractional bankroll at level ' + levelId);
      break;
    }
    core.nextRound(g);
  }
  return { net: totalNet, rounds: rounds, stuck: stuck, stats: g.stats };
}

console.log('\n— self play sanity —');

var SAMPLES = 12000;
var edges = {};
var levels = core.LEVELS.map(function (l) { return l.id; });
levels.forEach(function (id) {
  var run = selfPlay(id, SAMPLES, 4242);
  eq(run.stuck, 0, 'every round settles at level ' + id);
  edges[id] = -run.net / (run.rounds * 10);
});

console.log('  measured house edge against a basic-strategy bot (' + SAMPLES + ' rounds each):');
levels.forEach(function (id) {
  console.log('    ' + id + ': ' + (edges[id] * 100).toFixed(2) + '%');
});
ok(edges.novice < edges.house, 'novice is worse for the house than standard policy');
ok(edges.house < edges.sharp, 'floor reader is tougher than the house');
ok(edges.sharp < edges.shark, 'the DP shark is the toughest opponent');
ok(edges.house > -0.02 && edges.house < 0.03, 'the house level reproduces the real ~0.5% edge');
ok(core.levelById('novice').edge < 0, 'novice is documented as beatable');
ok(core.levelById('shark').edge > 0, 'shark is documented as the sharpest opponent');

// Stats must stay internally consistent over a long session.
var longRun = selfPlay('shark', 300, 88);
eq(longRun.stats.rounds, 300, 'every settled round is counted');
eq(longRun.stats.wins + longRun.stats.losses + longRun.stats.pushes, 300, 'win/lose/push partition is exhaustive');

/* ------------------------------------------------------------------ */

console.log('\n================================');
console.log('  ' + passed + ' assertions passed');
if (failures.length) {
  console.log('  ' + failures.length + ' FAILED');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
console.log('  all good');
