/*
 * Blackjack rules engine — pure logic, no DOM, injectable RNG.
 * UMD-ish: `module.exports` under node (so `node test/core-test.js` works),
 * `window.BJCore` in the browser.
 *
 * Layout
 *   1. constants
 *   2. helpers
 *   3. shoe / card data
 *   4. hand evaluation
 *   5. settlement
 *   6. OPPONENT ALGORITHMS  <- the difficulty feature lives here
 *   7. player basic strategy (hint badge)
 *   8. game state machine
 *   9. persistence
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.BJCore = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. constants
   * ------------------------------------------------------------------ */

  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var SUITS = ['S', 'H', 'D', 'C'];
  var SUIT_GLYPH = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
  var RED = { H: true, D: true };

  var DEFAULT_RULES = {
    decks: 6,
    penetration: 0.7, // fraction of the shoe dealt before a reshuffle
    stopsOnSoft17: true, // house rule: true = S17, false = H17
    doubleAfterSplit: true,
    maxSplits: 3, // live hands after splits = maxSplits + 1
    surrender: false, // early surrender (half back)
    blackjackPayout: 1.5, // 3:2
    insurancePayout: 2, // 2:1
    dealerPeeks: true, // US hole-card peek
    dealOrder: 'oneByOne' // 'oneByOne' | 'twoAtOnce' (visual only)
  };

  var PHASE = {
    BETTING: 'betting',
    INSURANCE: 'insurance',
    PLAYER: 'player',
    DEALER: 'dealer',
    SETTLED: 'settled'
  };

  var OUTCOME = {
    WIN: 'win',
    LOSE: 'lose',
    PUSH: 'push',
    BLACKJACK: 'blackjack',
    BUST: 'bust',
    SURRENDER: 'surrender'
  };

  var CHIP_VALUES = [1, 5, 25, 100, 500];

  /* ------------------------------------------------------------------ *
   * 2. helpers
   * ------------------------------------------------------------------ */

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function fmt(n, digits) {
    return Number(n).toFixed(digits === undefined ? 2 : digits);
  }

  // Deterministic mulberry32, used by tests and by the "seeded shoe" option.
  function makeRng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a += 0x6d2b79f5;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rankToValue(rank) {
    if (rank === 'A') return 11;
    if (rank === 'K' || rank === 'Q' || rank === 'J' || rank === '10') return 10;
    return parseInt(rank, 10);
  }

  /* ------------------------------------------------------------------ *
   * 3. shoe (plain data, JSON-safe so it can be persisted)
   * ------------------------------------------------------------------ */

  function buildShoe(rules, rng) {
    var cfg = assign({}, DEFAULT_RULES, rules || {});
    var pick = rng || Math.random;
    var cards = [];
    var decks = Math.max(1, Math.round(cfg.decks));
    for (var d = 0; d < decks; d++) {
      for (var s = 0; s < SUITS.length; s++) {
        for (var r = 0; r < RANKS.length; r++) {
          cards.push({ id: d + SUITS[s] + RANKS[r], rank: RANKS[r], suit: SUITS[s], red: !!RED[SUITS[s]] });
        }
      }
    }
    for (var i = cards.length - 1; i > 0; i--) {
      var j = Math.floor(pick() * (i + 1));
      var t = cards[i];
      cards[i] = cards[j];
      cards[j] = t;
    }
    return {
      cards: cards,
      index: 0,
      decks: decks,
      penetration: cfg.penetration,
      cutIndex: Math.floor(cards.length * clamp(cfg.penetration, 0.3, 0.95))
    };
  }

  function shoeRemaining(shoe) {
    return Math.max(0, shoe.cards.length - shoe.index);
  }

  function needShuffle(shoe) {
    return shoe.index >= shoe.cutIndex;
  }

  function draw(shoe, rng) {
    if (shoe.index >= shoe.cards.length) {
      var fresh = buildShoe({ decks: shoe.decks, penetration: shoe.penetration }, rng);
      shoe.cards = fresh.cards;
      shoe.index = 0;
      shoe.cutIndex = fresh.cutIndex;
    }
    return shoe.cards[shoe.index++];
  }

  // Live card-value distribution of the un dealt part of the shoe. Only the
  // engine internals (and the count-blind heuristic levels) may use it; a real
  // dealer never sees the upcoming cards, so the algorithms below mostly use
  // the two estimators instead.
  function composition(shoe) {
    var counts = {};
    var total = 0;
    for (var i = shoe.index; i < shoe.cards.length; i++) {
      var v = rankToValue(shoe.cards[i].rank);
      counts[v] = (counts[v] || 0) + 1;
      total++;
    }
    var probs = [];
    for (var value = 1; value <= 11; value++) {
      probs.push({ value: value, count: counts[value] || 0, p: total ? (counts[value] || 0) / total : 0 });
    }
    return { total: total, probs: probs, exact: true };
  }

  // Card distribution of an infinitely deep fresh shoe: the only thing a
  // dealer at the table can honestly reason about.
  function infiniteComposition() {
    var weights = {};
    for (var v = 2; v <= 10; v++) weights[v] = v === 10 ? 4 / 13 : 1 / 13;
    weights[11] = 1 / 13;
    var probs = [];
    for (var value = 1; value <= 11; value++) {
      probs.push({ value: value, count: 0, p: weights[value] || 0 });
    }
    return { total: Infinity, probs: probs, exact: false };
  }

  // Hi-Lo count translated into a card distribution. A positive true count
  // enriches tens and aces and thins the small cards — that is what a counter
  // is actually looking at, without peeking at the shoe.
  function countedComposition(trueCount) {
    var raw = typeof trueCount === 'number' && isFinite(trueCount) ? trueCount : 0;
    var tc = clamp(raw, -8, 8);
    var tilt = clamp(tc * 0.022, -0.25, 0.25);
    var probs = [];
    var sum = 0;
    for (var value = 1; value <= 11; value++) {
      var base = value === 10 ? 4 / 13 : value === 11 ? 1 / 13 : 1 / 13;
      var p = base;
      if (value === 10 || value === 11) p = base * (1 + tilt);
      else if (value <= 6) p = base * (1 - tilt / 2);
      probs.push({ value: value, count: 0, p: Math.max(0, p) });
      sum += Math.max(0, p);
    }
    for (var i = 0; i < probs.length; i++) probs[i].p = sum ? probs[i].p / sum : 0;
    return { total: Infinity, probs: probs, exact: false, trueCount: tc };
  }

  // Hi-Lo running count of everything already dealt from this shoe.
  function runningCount(shoe) {
    var c = 0;
    for (var i = 0; i < shoe.index; i++) {
      var v = rankToValue(shoe.cards[i].rank);
      if (v === 11 || v === 10) c -= 1;
      else if (v >= 2 && v <= 6) c += 1;
    }
    return c;
  }

  function trueCount(shoe) {
    var decksLeft = Math.max(0.25, shoeRemaining(shoe) / 52);
    return runningCount(shoe) / decksLeft;
  }

  /* ------------------------------------------------------------------ *
   * 4. hand evaluation
   * ------------------------------------------------------------------ */

  // Add a card to a (total, acesAsEleven) pair; demote aces past 21.
  function step(total, soft, value) {
    var t = total + value;
    var s = soft + (value === 11 ? 1 : 0);
    while (t > 21 && s > 0) {
      t -= 10;
      s -= 1;
    }
    return { total: t, soft: s, bust: t > 21 };
  }

  function handValue(cards) {
    var list = cards || [];
    var total = 0;
    var soft = 0;
    for (var i = 0; i < list.length; i++) {
      var st = step(total, soft, rankToValue(list[i].rank));
      total = st.total;
      soft = st.soft;
    }
    return { total: total, soft: soft, bust: total > 21 };
  }

  function isBlackjack(cards) {
    return (cards || []).length === 2 && handValue(cards).total === 21;
  }

  function samePair(cards) {
    if ((cards || []).length !== 2) return false;
    return rankToValue(cards[0].rank) === rankToValue(cards[1].rank);
  }

  /* ------------------------------------------------------------------ *
   * 5. settlement
   * ------------------------------------------------------------------ */

  // `returned` is what goes back to the bankroll; the stake was already taken
  // out when the round started, so `net` is the true profit of the hand.
  function settle(hand, dealerCards, rules) {
    var cfg = assign({}, DEFAULT_RULES, rules || {});
    var stake = hand.stake || 0;
    var pv = handValue(hand.cards);
    var dv = handValue(dealerCards);
    var playerBJ = !hand.fromSplit && isBlackjack(hand.cards);
    var dealerBJ = isBlackjack(dealerCards);

    if (hand.surrendered) {
      var loss = Math.floor(stake / 2);
      return { outcome: OUTCOME.SURRENDER, net: -loss, returned: stake - loss, label: 'surrender' };
    }
    if (playerBJ && dealerBJ) return { outcome: OUTCOME.PUSH, net: 0, returned: stake, label: 'pushBJ' };
    if (dealerBJ) return { outcome: OUTCOME.LOSE, net: -stake, returned: 0, label: 'dealerBJ' };
    if (playerBJ) {
      var win = Math.round(stake * cfg.blackjackPayout);
      return { outcome: OUTCOME.BLACKJACK, net: win, returned: stake + win, label: 'blackjack' };
    }
    if (pv.bust) return { outcome: OUTCOME.BUST, net: -stake, returned: 0, label: 'bust' };
    if (dv.bust) return { outcome: OUTCOME.WIN, net: stake, returned: stake * 2, label: 'dealerBust' };
    if (pv.total > dv.total) return { outcome: OUTCOME.WIN, net: stake, returned: stake * 2, label: 'higher' };
    if (pv.total < dv.total) return { outcome: OUTCOME.LOSE, net: -stake, returned: 0, label: 'lower' };
    return { outcome: OUTCOME.PUSH, net: 0, returned: stake, label: 'push' };
  }

  /* ------------------------------------------------------------------ *
   * 6. OPPONENT ALGORITHMS — the difficulty ladder
   *
   * Each level is a different decision algorithm for the dealer's draw/stand
   * call: decide(ctx) -> { action, reasonKey, params }. `reasonKey` + `params`
   * are rendered verbatim in the "对手思路 / Opponent's read" panel, so you can
   * watch *which* algorithm is thinking and why it committed.
   *
   * `edge` is the measured house advantage against a basic-strategy player;
   * regenerate the numbers with `node tools/sim-edge.js`.
   * ------------------------------------------------------------------ */

  function playerTargets(hands) {
    var list = hands || [];
    var targets = [];
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      if (h.surrendered) continue;
      var v = handValue(h.cards);
      targets.push({
        total: v.total,
        bust: v.bust,
        bj: !h.fromSplit && isBlackjack(h.cards),
        stake: h.stake || 1
      });
    }
    return targets;
  }

  // House value (per unit of stake) of one settled hand. +1 wins, -1 loses.
  // A player blackjack costs the house 1.5 units.
  function outcomeFor(dealerTotal, target) {
    if (target.bust) return 1;
    if (dealerTotal > 21) return -1;
    if (target.bj) return -1.5;
    if (dealerTotal > target.total) return 1;
    if (dealerTotal < target.total) return -1;
    return 0;
  }

  // Stake-weighted value of standing on `dealerTotal`.
  function standValue(dealerTotal, targets) {
    var sum = 0;
    var weight = 0;
    for (var i = 0; i < targets.length; i++) {
      var w = targets[i].stake || 1;
      sum += w * outcomeFor(dealerTotal, targets[i]);
      weight += w;
    }
    return weight ? sum / weight : 0;
  }

  // Backward induction over the live composition: the best house value
  // reachable from (total, soft) within `depth` further cards.
  function bestEV(total, soft, probs, targets, depth, memo) {
    var key = total + '/' + soft + '/' + depth;
    if (memo[key] !== undefined) return memo[key];
    var value = total > 21 ? -1 : standValue(total, targets);
    if (depth > 0 && total <= 21) {
      var hit = 0;
      for (var i = 0; i < probs.length; i++) {
        var pr = probs[i];
        if (!pr.p) continue;
        var st = step(total, soft, pr.value);
        hit += pr.p * (st.bust ? -1 : bestEV(st.total, st.soft, probs, targets, depth - 1, memo));
      }
      if (hit > value) value = hit;
    }
    memo[key] = value;
    return value;
  }

  // Expected house value of taking exactly one more card and then playing well.
  function hitEV(total, soft, probs, targets, depth, memo) {
    memo = memo || {};
    var hit = 0;
    for (var i = 0; i < probs.length; i++) {
      var pr = probs[i];
      if (!pr.p) continue;
      var st = step(total, soft, pr.value);
      hit += pr.p * (st.bust ? -1 : bestEV(st.total, st.soft, probs, targets, depth - 1, memo));
    }
    return hit;
  }

  function bustChance(total, soft, comp) {
    var p = 0;
    for (var i = 0; i < comp.probs.length; i++) {
      var pr = comp.probs[i];
      if (pr.p && step(total, soft, pr.value).bust) p += pr.p;
    }
    return p;
  }

  // What a dealer may actually know at the table: every card already played is
  // face up (only its own hole card is not), so a Hi-Lo count is legitimate
  // information — but the *order* of the remaining shoe is not. The smart
  // levels therefore reason over a counted *belief*, never over ctx.comp.
  function beliefFor(ctx) {
    return countedComposition(ctx.trueCount);
  }

  // The house policy, reused as the fallback an advanced level defers to.
  function tablePolicy(ctx) {
    var t = ctx.value.total;
    var soft = ctx.value.soft;
    if (t > 21) return { action: 'stand', reasonKey: 'house.bust' };
    if (t < 17) return { action: 'hit', reasonKey: 'house.below17', params: { t: t } };
    if (soft && t === 17) {
      return ctx.rules.stopsOnSoft17
        ? { action: 'stand', reasonKey: 'house.soft17S', params: { t: t } }
        : { action: 'hit', reasonKey: 'house.soft17H', params: { t: t } };
    }
    return { action: 'stand', reasonKey: 'house.at17', params: { t: t } };
  }

  // A dealer that always plays its optimal read is *far* stronger than the
  // table policy — never breaking a winning hand is worth over 10%. `defer`
  // is the probability that it shrugs and follows house procedure instead; it
  // is the volume knob that keeps the top of the ladder sharp but beatable.
  function maybeDefer(ctx, defer) {
    if (!(defer > 0) || ctx.rng() >= defer) return null;
    var fallback = tablePolicy(ctx);
    fallback.deferred = true; // the panel labels this as "fell back to procedure"
    return fallback;
  }

  var LEVELS = [
    {
      id: 'novice',
      index: 0,
      edge: -0.049,
      zh: '新手荷官',
      en: 'Trainee',
      zhAlgo: '随机噪声 + 记错的定式',
      enAlgo: 'Noisy rule recall',
      zhBlurb: '刚上岗：规则记不全，软牌最容易搞混，偶尔手抖多抽一张。',
      enBlurb: 'New on the floor: misremembers the table policy, confuses soft totals, shaky hands.',
      zhStyle: '纯概率型 · 内置失误率',
      enStyle: 'Stochastic · ships with an error rate',
      // Explicit error budget; recalibrate with `node tools/sim-edge.js --scan`.
      sloppiness: 0.12,
      decide: function (ctx) {
        var t = ctx.value.total;
        var soft = ctx.value.soft;
        var k = ctx.level.sloppiness === undefined ? 0.42 : ctx.level.sloppiness;
        var r = ctx.rng();
        if (t > 21) return { action: 'stand', reasonKey: 'novice.bust' };
        // Mistake 1: misreading a soft total as a hard one.
        if (soft && t >= 18) {
          return r < k
            ? { action: 'hit', reasonKey: 'novice.softConfused', params: { t: t } }
            : { action: 'stand', reasonKey: 'novice.softOk', params: { t: t } };
        }
        // Mistake 2: confusion at soft 17 (S17 vs H17), coin-flip territory.
        if (soft && t === 17) {
          return r < k
            ? { action: ctx.rules.stopsOnSoft17 ? 'hit' : 'stand', reasonKey: 'novice.policyMixup', params: { t: t } }
            : { action: ctx.rules.stopsOnSoft17 ? 'stand' : 'hit', reasonKey: 'novice.policyOk', params: { t: t } };
        }
        // Mistake 3: fear — parking a hard hand below 17.
        if (t < 17) {
          return r < k / 2
            ? { action: 'stand', reasonKey: 'novice.tooScared', params: { t: t } }
            : { action: 'hit', reasonKey: 'novice.mustDraw', params: { t: t } };
        }
        // Mistake 4: over-eager — drawing on a finished hard total.
        if (r < k / 2.5) return { action: 'hit', reasonKey: 'novice.overdraw', params: { t: t } };
        return { action: 'stand', reasonKey: 'novice.ruleGuess', params: { t: t } };
      }
    },
    {
      id: 'house',
      index: 1,
      edge: 0.01,
      zh: '标准庄',
      en: 'The House',
      zhAlgo: '固定阈值定式（S17 / H17）',
      enAlgo: 'Fixed table policy (S17 / H17)',
      zhBlurb: '赌场标准流程：不足 17 必抽，17 及以上按桌规停牌。零情绪，零失误。',
      enBlurb: 'House procedure: draw below 17, stand at or above per the table policy. No emotion, no error.',
      zhStyle: '规则型 · 与牌面无关',
      enStyle: 'Deterministic · ignores your hand',
      decide: tablePolicy
    },
    {
      id: 'sharp',
      index: 2,
      edge: 0.034,
      zh: '老练读牌',
      en: 'Floor Reader',
      zhAlgo: '目标点数追踪 + 爆牌风险预算',
      enAlgo: 'Target tracking + bust-risk budget',
      zhBlurb: '盯着你已亮出的点数：落后就追，但爆牌概率超过预算就宁可让你赢小的。',
      enBlurb: 'Reads your visible total and chases it, but stops when bust risk breaks its budget.',
      zhStyle: '启发式 · 读你的牌与剩牌结构',
      enStyle: 'Heuristic · reads your cards and the count',
      defer: 0.8,
      decide: function (ctx) {
        var t = ctx.value.total;
        var soft = ctx.value.soft;
        if (t > 21) return { action: 'stand', reasonKey: 'sharp.bust' };
        var deferred = maybeDefer(ctx, ctx.level.defer || 0);
        if (deferred) return deferred;
        var belief = beliefFor(ctx);
        var alive = ctx.targets.filter(function (x) { return !x.bust; });
        if (!alive.length) {
          // Every hand already busted: the round is won, so just play the rubber.
          return t < 17
            ? { action: 'hit', reasonKey: 'sharp.deadRubber', params: { t: t } }
            : { action: 'stand', reasonKey: 'sharp.wonAlready', params: { t: t } };
        }
        var need = 0;
        for (var i = 0; i < alive.length; i++) need = Math.max(need, alive[i].total);
        var risk = bustChance(t, soft, belief);
        var pct = fmt(risk * 100, 0);

        // Already ahead: never risk a winning total.
        if (t > need) return { action: 'stand', reasonKey: 'sharp.holdLead', params: { t: t, need: need } };

        // Tied: standing is a push, so only press while the chase is cheap.
        if (t === need) {
          return risk <= 0.34
            ? { action: 'hit', reasonKey: 'sharp.breakTie', params: { t: t, need: need, risk: pct } }
            : { action: 'stand', reasonKey: 'sharp.takePush', params: { t: t, need: need, risk: pct } };
        }

        // Behind: standing is a guaranteed loss, so gamble unless the draw is
        // basically hopeless (t = 20 chasing 21 still has the ace).
        if (risk >= 0.9) return { action: 'stand', reasonKey: 'sharp.givenUp', params: { t: t, need: need, risk: pct } };
        return {
          action: 'hit',
          reasonKey: t < 17 ? 'sharp.belowFloor' : 'sharp.chase',
          params: { t: t, need: need, risk: pct }
        };
      }
    },
    {
      id: 'shark',
      index: 3,
      edge: 0.050,
      zh: '算牌鲨鱼',
      en: 'Shoe Shark',
      zhAlgo: 'Hi-Lo 真数 + 信念分布上的动态规划',
      enAlgo: 'Hi-Lo true count + DP over its belief distribution',
      zhBlurb: '按已出牌维护 Hi-Lo 真数，把真数折成剩牌信念分布，再解抽/停的期望值差。',
      enBlurb: 'Keeps a Hi-Lo true count, folds it into a belief distribution over the remaining cards, then solves the exact draw/stand EV gap.',
      zhStyle: '最优化 · 只用它该知道的信息',
      enStyle: 'Optimal · uses only information it may legally have',
      defer: 0.6,
      decide: function (ctx) {
        var t = ctx.value.total;
        var soft = ctx.value.soft;
        if (t > 21) return { action: 'stand', reasonKey: 'shark.bust' };
        if (!ctx.targets.length) return { action: 'stand', reasonKey: 'shark.nothingToBeat' };
        var deferred = maybeDefer(ctx, ctx.level.defer || 0);
        if (deferred) return deferred;
        var belief = beliefFor(ctx);
        var stand = standValue(t, ctx.targets);
        var draw = hitEV(t, soft, belief.probs, ctx.targets, 7, {});
        var params = { stand: fmt(stand, 3), draw: fmt(draw, 3), tc: fmt(ctx.trueCount, 1) };
        if (draw > stand + 0.0005) return { action: 'hit', reasonKey: 'shark.hitWins', params: params };
        if (stand > draw + 0.0005) return { action: 'stand', reasonKey: 'shark.standWins', params: params };
        return { action: soft ? 'hit' : 'stand', reasonKey: 'shark.tie', params: params };
      }
    }
  ];

  function levelById(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i];
    return LEVELS[1];
  }

  // Build the context every algorithm sees, then ask it for one decision.
  function decideDealer(level, ctx) {
    var lvl = typeof level === 'string' ? levelById(level) : level || LEVELS[1];
    var comp = ctx.comp || composition(ctx.shoe);
    var value = ctx.value || handValue(ctx.cards);
    var full = {
      cards: ctx.cards,
      level: lvl,
      value: value,
      targets: ctx.targets || [],
      comp: comp,
      probs: comp.probs,
      shoe: ctx.shoe,
      rules: assign({}, DEFAULT_RULES, ctx.rules || {}),
      rng: ctx.rng || Math.random,
      trueCount: ctx.trueCount === undefined && ctx.shoe ? trueCount(ctx.shoe) : ctx.trueCount,
      history: ctx.history || []
    };
    var d = lvl.decide(full) || { action: 'stand', reasonKey: 'house.at17', params: { t: value.total } };
    d.level = lvl.id;
    d.total = value.total;
    d.soft = value.soft;
    return d;
  }

  /* ------------------------------------------------------------------ *
   * 7. player basic strategy (the hint badge)
   * ------------------------------------------------------------------ */

  function upIdx(rank) {
    var v = rankToValue(rank);
    return v === 11 ? 9 : clamp(v - 2, 0, 8); // 0..8 = dealer 2..10, 9 = dealer A
  }

  // Multi-deck S17 basic strategy. Returns a move string; unavailable moves
  // degrade to their fallback so the caller can always act on the result.
  function basicStrategy(hand, dealerUp, rules) {
    var cfg = assign({}, DEFAULT_RULES, rules || {});
    var cards = hand.cards || [];
    var v = handValue(cards);
    var canDouble = cards.length === 2 && (!hand.fromSplit || cfg.doubleAfterSplit);
    var canSplit = cards.length === 2 && samePair(cards) && (hand.splits || 0) < cfg.maxSplits;
    var i = upIdx(dealerUp && dealerUp.rank);
    var D = canDouble ? 'double' : 'hit';
    var DS = canDouble ? 'double' : 'stand';
    var H = 'hit';
    var S = 'stand';
    var R = cfg.surrender ? 'surrender' : H;

    if (v.total === 21) return S;

    // --- pairs (split index 9 = dealer ace) ---
    if (canSplit) {
      var pv = rankToValue(cards[0].rank);
      if (pv === 11) return 'split'; // A,A
      if (pv === 10) return S; // never split tens
      if (pv === 9) return i <= 4 || i === 6 || i === 7 ? 'split' : S; // 9,9 vs 2-6,8,9
      if (pv === 8) return 'split'; // 8,8 always
      if (pv === 7) return i <= 5 ? 'split' : H; // 7,7 vs 2-7
      if (pv === 6) return i <= 4 ? 'split' : H; // 6,6 vs 2-6
      if (pv === 5) return i <= 7 ? D : H; // 5,5 plays like a hard 10
      if (pv === 4) return i === 3 || i === 4 ? 'split' : H; // 4,4 vs 5-6
      if (pv === 3 || pv === 2) return i <= 5 ? 'split' : H; // 2,2 / 3,3 vs 2-7
    }

    // --- soft totals ---
    if (v.soft) {
      if (v.total >= 19) return S;
      if (v.total === 18) {
        if (i <= 4) return DS; // A,7 vs 2-6: double, else stand
        if (i <= 6) return S; // vs 7,8
        if (i <= 8) return H; // vs 9,10
        return R; // vs A
      }
      if (v.total === 17) return i >= 1 && i <= 4 ? D : H; // A,6 vs 3-6
      if (v.total === 16 || v.total === 15) return i >= 2 && i <= 4 ? D : H; // vs 4-6
      if (v.total === 14 || v.total === 13) return i >= 3 && i <= 4 ? D : H; // vs 5-6
      return H; // A,2 / A,3 and below
    }

    // --- hard totals ---
    if (v.total >= 17) return S;
    if (v.total === 16) return i <= 4 ? S : i >= 7 ? R : H; // stand 2-6, surrender 9-10
    if (v.total === 15) return i <= 4 ? S : i === 8 ? R : H; // stand 2-6, surrender vs 10
    if (v.total === 14) return i <= 5 ? S : H; // stand 2-7
    if (v.total === 13) return i <= 4 ? S : H; // stand 2-6
    if (v.total === 12) return i >= 2 && i <= 4 ? S : H; // stand vs 4,5,6 only
    if (v.total === 11) return i === 9 ? H : D; // double everything except an ace
    if (v.total === 10) return i <= 7 ? D : H; // double vs 2-9
    if (v.total === 9) return i >= 1 && i <= 4 ? D : H; // double vs 3-6
    return H; // 8 and below
  }

  /* ------------------------------------------------------------------ *
   * 8. game state machine
   * ------------------------------------------------------------------ */

  function createHand(stake, index) {
    return {
      id: 'h' + index,
      cards: [],
      stake: stake,
      fromSplit: false,
      doubled: false,
      surrendered: false,
      stood: false,
      finished: false,
      busted: false,
      splits: 0,
      result: null
    };
  }

  function createGame(options) {
    var o = options || {};
    var state = {
      version: 1,
      rules: assign({}, DEFAULT_RULES, o.rules || {}),
      level: levelById(o.level).id,
      bankroll: o.bankroll === undefined ? 1000 : o.bankroll,
      bet: 0,
      lastBet: 0,
      pendingBet: 0,
      shoe: null,
      hands: [],
      active: 0,
      dealer: [],
      phase: PHASE.BETTING,
      insurance: null, // { stake, net, resolved }
      offeredInsurance: false,
      log: [], // dealer decisions of the current round -> 对手思路 panel
      events: [], // transient animation queue consumed by the UI layer
      stats: o.stats || { rounds: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, net: 0, streak: 0, bestStreak: 0, worstStreak: 0 },
      roundNet: 0,
      lastResult: null,
      _rng: typeof o.rng === 'function' ? o.rng : makeRng(o.seed || ((Date.now() & 0x7fffffff) >>> 0)),
      // A separate stream for the opponents' coin flips. Keeping their noise
      // out of the shoe stream means a calibration sweep over `defer` sees the
      // exact same cards each time, so levels are compared pairwise instead of
      // accidentally re-dealing the shoe.
      _decRng: makeRng(((o.seed || 1) ^ 0x9e3779b9) >>> 0)
    };
    state.shoe = buildShoe(state.rules, state._rng);
    pushEvent(state, { type: 'shuffle' });
    return state;
  }

  function pushEvent(state, ev) {
    state.events.push(ev);
    return ev;
  }

  function drainEvents(state) {
    var out = state.events;
    state.events = [];
    return out;
  }

  function pushLog(state, entry) {
    state.log.push(entry);
    if (state.log.length > 60) state.log.shift();
    return entry;
  }

  function activeHand(state) {
    return state.hands[state.active] || null;
  }

  /* --- betting ------------------------------------------------------ */

  function largestChipUpTo(amount) {
    var best = 0;
    for (var i = 0; i < CHIP_VALUES.length; i++) if (CHIP_VALUES[i] <= amount) best = CHIP_VALUES[i];
    return best;
  }

  function addChip(state, value) {
    if (state.phase !== PHASE.BETTING) return false;
    if (CHIP_VALUES.indexOf(value) === -1) return false;
    if (value > state.bankroll - state.pendingBet) return false;
    state.pendingBet += value;
    pushEvent(state, { type: 'chip', value: value, total: state.pendingBet });
    return true;
  }

  function removeChip(state, value) {
    if (state.phase !== PHASE.BETTING) return false;
    var v = value === undefined ? state.pendingBet : Math.min(value, state.pendingBet);
    if (v <= 0) return false;
    state.pendingBet -= v;
    pushEvent(state, { type: 'chipRemove', value: v, total: state.pendingBet });
    return true;
  }

  function clearBet(state) {
    return removeChip(state, state.pendingBet);
  }

  function maxBet(state) {
    var room = state.bankroll - state.pendingBet;
    while (room >= 1) {
      var take = largestChipUpTo(room);
      if (!take) break;
      addChip(state, take);
      room -= take;
    }
    return state.pendingBet;
  }

  // Compose an arbitrary amount out of the chip rack (greedy, largest first).
  function placeBet(state, amount) {
    var left = Math.floor(amount || 0);
    while (left >= 1) {
      var take = largestChipUpTo(Math.min(left, state.bankroll - state.pendingBet));
      if (!take) return false;
      addChip(state, take);
      left -= take;
    }
    return state.pendingBet === Math.floor(amount);
  }

  function replayBet(state) {
    if (state.phase !== PHASE.BETTING || state.lastBet <= 0) return false;
    state.pendingBet = 0;
    return placeBet(state, Math.min(state.lastBet, state.bankroll));
  }

  // Add one more unit of the previous wager on top of what is already down.
  function raiseBet(state) {
    if (state.phase !== PHASE.BETTING) return false;
    var base = state.lastBet || state.pendingBet;
    if (base <= 0) return maxBet(state) > 0;
    return placeBet(state, state.pendingBet + Math.min(base, state.bankroll - state.pendingBet));
  }

  /* --- dealing ------------------------------------------------------ */

  function startRound(state) {
    if (state.phase !== PHASE.BETTING || state.pendingBet <= 0) return false;
    if (needShuffle(state.shoe)) {
      state.shoe = buildShoe(state.rules, state._rng);
      pushEvent(state, { type: 'shuffle' });
    }
    state.bet = state.pendingBet;
    state.lastBet = state.pendingBet;
    state.pendingBet = 0;
    state.bankroll -= state.bet;
    state.hands = [createHand(state.bet, 0)];
    state.active = 0;
    state.dealer = [];
    state.insurance = null;
    state.offeredInsurance = false;
    state.roundNet = 0;
    state.lastResult = null;
    state.log = [];
    state.phase = PHASE.PLAYER;

    var order = state.rules.dealOrder === 'twoAtOnce'
      ? ['player', 'player', 'dealer', 'dealer']
      : ['player', 'dealer', 'player', 'dealer'];
    for (var i = 0; i < order.length; i++) {
      var toPlayer = order[i] === 'player';
      var card = draw(state.shoe, state._rng);
      var hole = !toPlayer && i === order.length - 1;
      if (hole) card.hidden = true;
      var bucket = toPlayer ? state.hands[0].cards : state.dealer;
      bucket.push(card);
      pushEvent(state, {
        type: 'deal',
        card: card,
        to: toPlayer ? 'player' : 'dealer',
        hole: hole,
        hand: toPlayer ? 0 : undefined,
        index: bucket.length - 1
      });
    }

    if (state.dealer[0].rank === 'A') {
      state.offeredInsurance = true;
      state.phase = PHASE.INSURANCE;
      pushEvent(state, { type: 'insuranceOffer' });
    } else {
      checkNaturals(state);
    }
    return true;
  }

  function takeInsurance(state, accept) {
    if (state.phase !== PHASE.INSURANCE) return false;
    var cost = Math.floor(state.hands[0].stake / 2);
    if (accept && cost > 0 && state.bankroll >= cost) {
      state.bankroll -= cost;
      state.insurance = { stake: cost, net: 0, resolved: false };
      pushEvent(state, { type: 'insuranceBuy', stake: cost });
    } else {
      pushEvent(state, { type: 'insuranceDecline' });
    }
    state.phase = PHASE.PLAYER;
    checkNaturals(state);
    return true;
  }

  function resolveInsurance(state, dealerBJ) {
    if (!state.insurance || state.insurance.resolved) return 0;
    var ins = state.insurance;
    if (dealerBJ) {
      var win = Math.round(ins.stake * state.rules.insurancePayout);
      state.bankroll += ins.stake + win; // return the premium, pay 2:1
      ins.net = win;
      state.roundNet += win;
      pushEvent(state, { type: 'insuranceWin', stake: ins.stake, win: win });
    } else {
      ins.net = -ins.stake; // premium was already taken from the bankroll
      state.roundNet += ins.net;
      pushEvent(state, { type: 'insuranceLose', stake: ins.stake });
    }
    ins.resolved = true;
    return ins.net;
  }

  function checkNaturals(state) {
    var dealerBJ = state.rules.dealerPeeks ? isBlackjack(state.dealer) : false;
    var playerBJ = isBlackjack(state.hands[0].cards);
    if (state.offeredInsurance) resolveInsurance(state, dealerBJ);
    if (playerBJ || dealerBJ) {
      finishRound(state);
      return true;
    }
    pushEvent(state, { type: 'turn', hand: 0 });
    return false;
  }

  /* --- player actions ----------------------------------------------- */

  function canAct(state) {
    var h = activeHand(state);
    return state.phase === PHASE.PLAYER && !!h && !h.finished;
  }

  function hit(state) {
    if (!canAct(state)) return false;
    var h = activeHand(state);
    var card = draw(state.shoe, state._rng);
    h.cards.push(card);
    pushEvent(state, { type: 'deal', card: card, to: 'player', hand: state.active, index: h.cards.length - 1 });
    var v = handValue(h.cards);
    if (v.bust) {
      h.finished = true;
      h.busted = true;
      pushEvent(state, { type: 'bust', hand: state.active, total: v.total });
      advance(state);
    } else if (v.total === 21) {
      h.stood = true;
      h.finished = true;
      pushEvent(state, { type: 'autoStand', hand: state.active, total: 21 });
      advance(state);
    }
    return true;
  }

  function stand(state) {
    if (!canAct(state)) return false;
    var h = activeHand(state);
    h.stood = true;
    h.finished = true;
    pushEvent(state, { type: 'stand', hand: state.active, total: handValue(h.cards).total });
    advance(state);
    return true;
  }

  function canDouble(state) {
    var h = activeHand(state);
    if (!canAct(state) || h.cards.length !== 2) return false;
    if (h.fromSplit && !state.rules.doubleAfterSplit) return false;
    if (isBlackjack(h.cards)) return false;
    return state.bankroll >= h.stake;
  }

  function double(state) {
    if (!canDouble(state)) return false;
    var h = activeHand(state);
    state.bankroll -= h.stake;
    h.stake *= 2;
    h.doubled = true;
    pushEvent(state, { type: 'double', hand: state.active, stake: h.stake });
    var card = draw(state.shoe, state._rng);
    h.cards.push(card);
    pushEvent(state, { type: 'deal', card: card, to: 'player', hand: state.active, index: h.cards.length - 1 });
    h.stood = true;
    h.finished = true;
    if (handValue(h.cards).bust) {
      h.busted = true;
      pushEvent(state, { type: 'bust', hand: state.active, total: handValue(h.cards).total });
    }
    advance(state);
    return true;
  }

  function canSplit(state) {
    var h = activeHand(state);
    if (!canAct(state) || !samePair(h.cards)) return false;
    if (h.splits >= state.rules.maxSplits || state.hands.length >= state.rules.maxSplits + 1) return false;
    return state.bankroll >= h.stake;
  }

  function split(state) {
    if (!canSplit(state)) return false;
    var h = activeHand(state);
    var ace = rankToValue(h.cards[0].rank) === 11;
    state.bankroll -= h.stake;
    var moved = h.cards.pop();
    var twin = createHand(h.stake, state.hands.length);
    twin.fromSplit = true;
    twin.splits = h.splits + 1;
    twin.cards = [moved];
    // Both halves of a split are "split hands": a 21 built from them is a plain
    // 21, never a natural, so it pays 1:1 rather than 3:2.
    h.fromSplit = true;
    h.splits += 1;
    state.hands.push(twin);

    var card = draw(state.shoe, state._rng);
    h.cards.push(card);
    pushEvent(state, { type: 'deal', card: card, to: 'player', hand: state.active, index: h.cards.length - 1 });
    var card2 = draw(state.shoe, state._rng);
    twin.cards.push(card2);
    pushEvent(state, { type: 'split', hand: state.active, created: twin.id });
    pushEvent(state, { type: 'deal', card: card2, to: 'player', hand: state.hands.length - 1, index: 1 });

    if (ace) {
      // Split aces get exactly one card each, then the round plays out.
      h.stood = true;
      h.finished = true;
      twin.stood = true;
      twin.finished = true;
      pushEvent(state, { type: 'splitAcesLocked' });
      advance(state);
    } else {
      pushEvent(state, { type: 'turn', hand: state.active });
    }
    return true;
  }

  function canSurrender(state) {
    var h = activeHand(state);
    return !!(state.rules.surrender && canAct(state) && h.cards.length === 2 && !h.fromSplit);
  }

  function surrender(state) {
    if (!canSurrender(state)) return false;
    var h = activeHand(state);
    h.surrendered = true;
    h.finished = true;
    pushEvent(state, { type: 'surrender', hand: state.active });
    advance(state);
    return true;
  }

  function advance(state) {
    for (var i = state.active; i < state.hands.length; i++) {
      if (!state.hands[i].finished) {
        state.active = i;
        pushEvent(state, { type: 'turn', hand: i });
        return;
      }
    }
    for (var j = 0; j < state.hands.length; j++) {
      if (!state.hands[j].finished) {
        state.active = j;
        pushEvent(state, { type: 'turn', hand: j });
        return;
      }
    }
    dealerTurn(state);
  }

  /* --- dealer turn -------------------------------------------------- */

  function dealerTurn(state) {
    state.phase = PHASE.DEALER;
    state.active = -1;
    var level = levelById(state.level);
    var hole = state.dealer[1];
    if (hole && hole.hidden) {
      hole.hidden = false;
      pushEvent(state, { type: 'reveal', card: hole });
    }
    // With a dealer natural the round is already decided by the peek; skip the
    // algorithm entirely so the panel does not show a pointless "hit".
    if (state.rules.dealerPeeks && isBlackjack(state.dealer)) {
      pushEvent(state, { type: 'decision', level: level.id, action: 'stand', total: 21, reasonKey: 'house.natural', params: { t: 21 } });
      finishRound(state);
      return true;
    }
    var guard = 0;
    while (guard++ < 30) {
      var value = handValue(state.dealer);
      var decision = decideDealer(level, {
        cards: state.dealer,
        value: value,
        targets: playerTargets(state.hands),
        shoe: state.shoe,
        comp: composition(state.shoe),
        rules: state.rules,
        rng: state._decRng,
        trueCount: trueCount(state.shoe),
        history: state.log
      });
      pushLog(state, {
        kind: 'dealer',
        level: level.id,
        action: decision.action,
        total: decision.total,
        reasonKey: decision.reasonKey,
        deferred: !!decision.deferred,
        params: decision.params || {}
      });
      pushEvent(state, {
        type: 'decision',
        level: level.id,
        action: decision.action,
        total: decision.total,
        reasonKey: decision.reasonKey,
        deferred: !!decision.deferred,
        params: decision.params || {}
      });
      if (decision.action !== 'hit') break;
      var card = draw(state.shoe, state._rng);
      state.dealer.push(card);
      pushEvent(state, { type: 'deal', card: card, to: 'dealer', index: state.dealer.length - 1 });
    }
    finishRound(state);
    return true;
  }

  function finishRound(state) {
    if (state.offeredInsurance && state.insurance && !state.insurance.resolved) {
      resolveInsurance(state, isBlackjack(state.dealer));
    }
    var dealerBJ = isBlackjack(state.dealer);
    var totalNet = state.roundNet;
    var anyBJ = false;
    var returned = 0;
    var results = [];

    for (var i = 0; i < state.hands.length; i++) {
      var h = state.hands[i];
      var r = settle(h, state.dealer, state.rules);
      h.result = r;
      h.finished = true;
      totalNet += r.net;
      returned += r.returned;
      if (r.outcome === OUTCOME.BLACKJACK) anyBJ = true;
      results.push({
        hand: h.id,
        outcome: r.outcome,
        label: r.label,
        net: r.net,
        stake: h.stake,
        total: handValue(h.cards).total,
        cards: h.cards.length
      });
    }

    state.bankroll += returned;
    var s = state.stats;
    s.rounds += 1;
    s.net += totalNet;
    if (totalNet > 0) {
      s.wins += 1;
      s.streak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
    } else if (totalNet < 0) {
      s.losses += 1;
      s.streak -= 1;
      s.worstStreak = Math.min(s.worstStreak, s.streak);
    } else {
      s.pushes += 1;
      s.streak = 0;
    }
    if (anyBJ) s.blackjacks += 1;

    state.roundNet = totalNet;
    state.lastResult = {
      net: totalNet,
      hands: results,
      insurance: state.insurance ? assign({}, state.insurance) : null,
      dealerBJ: dealerBJ,
      level: state.level,
      bankrupt: state.bankroll <= 0
    };
    state.phase = PHASE.SETTLED;
    pushEvent(state, { type: 'settle', net: totalNet, returned: returned, results: results });
    if (state.bankroll <= 0) pushEvent(state, { type: 'broke' });
    return true;
  }

  function nextRound(state) {
    if (state.phase !== PHASE.SETTLED) return false;
    if (state.bankroll <= 0) {
      pushEvent(state, { type: 'rebuy', amount: 1000 });
      state.bankroll = 1000;
    }
    state.hands = [];
    state.dealer = [];
    state.active = 0;
    state.bet = 0;
    state.pendingBet = 0;
    state.insurance = null;
    state.offeredInsurance = false;
    state.lastResult = null;
    state.log = [];
    state.phase = PHASE.BETTING;
    return true;
  }

  function setLevel(state, id) {
    state.level = levelById(id).id;
    pushEvent(state, { type: 'level', level: state.level });
    return state.level;
  }

  function setRules(state, patch) {
    state.rules = assign({}, DEFAULT_RULES, state.rules || {}, patch || {});
    return state.rules;
  }

  /* ------------------------------------------------------------------ *
   * 9. persistence
   * ------------------------------------------------------------------ */

  function serialize(state) {
    // Money that is currently committed on the felt is folded back into the
    // bankroll: a reload abandons the in-flight round rather than eating its
    // stake, which is what a player walking away from a real table gets.
    var committed = 0;
    var live =
      state.phase === PHASE.PLAYER || state.phase === PHASE.INSURANCE || state.phase === PHASE.DEALER;
    if (live) {
      for (var i = 0; i < state.hands.length; i++) committed += state.hands[i].stake || 0;
      if (state.insurance && !state.insurance.resolved) committed += state.insurance.stake || 0;
    }
    return {
      version: state.version,
      level: state.level,
      bankroll: state.bankroll + committed,
      rules: state.rules,
      stats: state.stats,
      pendingBet: state.phase === PHASE.BETTING ? state.pendingBet : 0,
      lastBet: state.lastBet,
      bet: 0,
      shoe: {
        cards: state.shoe.cards,
        index: state.shoe.index,
        decks: state.shoe.decks,
        penetration: state.shoe.penetration,
        cutIndex: state.shoe.cutIndex
      }
    };
  }

  function deserialize(data, options) {
    var state = createGame(options || {});
    if (!data || typeof data !== 'object') return state;
    if (data.level) state.level = levelById(data.level).id;
    // Money / stats / rules / shoe position survive; a half-played round does
    // not, so the resumed phase is always a legal one.
    if (typeof data.bankroll === 'number' && isFinite(data.bankroll) && data.bankroll >= 0) {
      state.bankroll = Math.round(data.bankroll);
    }
    if (data.rules) state.rules = assign({}, DEFAULT_RULES, data.rules);
    if (data.stats) state.stats = assign({}, state.stats, data.stats);
    if (data.shoe && Array.isArray(data.shoe.cards) && data.shoe.cards.length) {
      state.shoe = {
        cards: data.shoe.cards,
        index: clamp(data.shoe.index || 0, 0, data.shoe.cards.length),
        decks: data.shoe.decks || state.shoe.decks,
        penetration: data.shoe.penetration || state.shoe.penetration,
        cutIndex: clamp(data.shoe.cutIndex || state.shoe.cutIndex, 0, data.shoe.cards.length)
      };
    }
    state.lastBet = typeof data.lastBet === 'number' && data.lastBet > 0 ? data.lastBet : 0;
    state.pendingBet = typeof data.pendingBet === 'number' && data.pendingBet > 0 ? data.pendingBet : 0;
    state.pendingBet = Math.min(state.pendingBet, state.bankroll);
    return state;
  }

  /* ------------------------------------------------------------------ *
   * exports
   * ------------------------------------------------------------------ */

  return {
    RANKS: RANKS,
    SUITS: SUITS,
    SUIT_GLYPH: SUIT_GLYPH,
    CHIP_VALUES: CHIP_VALUES,
    PHASE: PHASE,
    OUTCOME: OUTCOME,
    LEVELS: LEVELS,
    DEFAULT_RULES: DEFAULT_RULES,

    assign: assign,
    clamp: clamp,
    fmt: fmt,
    makeRng: makeRng,
    rankToValue: rankToValue,
    step: step,

    buildShoe: buildShoe,
    draw: draw,
    shoeRemaining: shoeRemaining,
    needShuffle: needShuffle,
    composition: composition,
    infiniteComposition: infiniteComposition,
    countedComposition: countedComposition,
    runningCount: runningCount,
    trueCount: trueCount,

    handValue: handValue,
    isBlackjack: isBlackjack,
    samePair: samePair,
    settle: settle,
    outcomeFor: outcomeFor,
    bustChance: bustChance,
    standValue: standValue,
    bestEV: bestEV,
    hitEV: hitEV,

    levelById: levelById,
    decideDealer: decideDealer,
    playerTargets: playerTargets,
    basicStrategy: basicStrategy,

    createGame: createGame,
    createHand: createHand,
    serialize: serialize,
    deserialize: deserialize,
    drainEvents: drainEvents,
    addChip: addChip,
    removeChip: removeChip,
    clearBet: clearBet,
    maxBet: maxBet,
    placeBet: placeBet,
    replayBet: replayBet,
    startRound: startRound,
    takeInsurance: takeInsurance,
    hit: hit,
    stand: stand,
    double: double,
    canDouble: canDouble,
    split: split,
    canSplit: canSplit,
    surrender: surrender,
    canSurrender: canSurrender,
    canAct: canAct,
    activeHand: activeHand,
    advance: advance,
    dealerTurn: dealerTurn,
    finishRound: finishRound,
    nextRound: nextRound,
    setLevel: setLevel,
    setRules: setRules
  };
});
