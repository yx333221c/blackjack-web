/*
 * UI layer: rendering, event playback, input, persistence.
 *
 * Two render paths, deliberately:
 *   sync()      - rebuild the table from state. Idempotent, no animation
 *                 classes. Used on boot, after a round settles, and whenever
 *                 rules/level/language change.
 *   applyEvent()- incremental DOM work for one engine event. Used only while
 *                 an animation queue drains, so cards fly in one by one.
 * The queue is always followed by a sync(), so any drift in the incremental
 * path is corrected at the end of a round.
 */
(function (global) {
  'use strict';

  var C = global.BJCore;
  var T = global.I18N;
  var S = global.Sound;

  var SAVE_KEY = 'blackjack-web.save.v1';
  var UI_KEY = 'blackjack-web.ui.v1';

  var el = {};
  var state = null;
  var ui = { lang: 'zh', hints: true, motion: true, sound: true };
  var playing = false;
  var roundFlash = null; // timer handle for the +/− wallet badge

  /* ------------------------------------------------------------------ *
   * boot helpers
   * ------------------------------------------------------------------ */

  var IDS = [
    'bankroll', 'roundDelta', 'roundDeltaValue', 'btnSound', 'btnHelp', 'btnSettings',
    'dealerBadge', 'dealerCards', 'dealerTotal', 'shoe', 'shoeCount', 'banner',
    'playerHands', 'betRing', 'betStack', 'betAmount', 'insuranceWell', 'insuranceChips',
    'levelList', 'readBody', 'readCurrent', 'readLog', 'btnReadToggle',
    'stRounds', 'stWL', 'stBJ', 'stNet', 'stStreak', 'btnResetStats', 'chipRack',
    'btnClearBet', 'btnRepeat', 'btnRaise', 'btnAllIn', 'hintSlot', 'hintValue', 'actions',
    'btnDeal', 'btnHit', 'btnStand', 'btnDouble', 'btnSplit', 'btnSurrender', 'btnNext',
    'scrim', 'sheetInsurance', 'insuranceCopy', 'btnInsNo', 'btnInsYes',
    'sheetSettings', 'setLang', 'setDecks', 'setPenetration', 'outPenetration', 'setSoft17',
    'setDas', 'setSurrender', 'setDealOrder', 'setHints', 'setMotion', 'setSound',
    'btnResetAll', 'btnCloseSettings', 'sheetHelp', 'btnCloseHelp', 'toastRail', 'felt'
  ];

  function cacheEls() {
    IDS.forEach(function (id) {
      el[id] = document.getElementById(id);
      if (!el[id]) throw new Error('missing element #' + id);
    });
  }

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function loadUI() {
    try {
      var d = JSON.parse(global.localStorage.getItem(UI_KEY) || 'null');
      if (d && typeof d === 'object') {
        ui.lang = T.langs.indexOf(d.lang) >= 0 ? d.lang : 'zh';
        ui.hints = d.hints !== false;
        ui.sound = d.sound !== false;
        ui.motion = d.motion !== false;
      }
    } catch (e) {
      /* storage unavailable: defaults are fine */
    }
    if (prefersReducedMotion()) ui.motion = false;
    T.set(ui.lang);
    S.setEnabled(ui.sound);
  }

  function saveUI() {
    try {
      global.localStorage.setItem(UI_KEY, JSON.stringify(ui));
    } catch (e) {
      /* ignore */
    }
  }

  function loadGame() {
    var saved = null;
    try {
      saved = JSON.parse(global.localStorage.getItem(SAVE_KEY) || 'null');
    } catch (e) {
      saved = null;
    }
    state = C.deserialize(saved, { level: 'house' });
  }

  function saveGame() {
    try {
      global.localStorage.setItem(SAVE_KEY, JSON.stringify(C.serialize(state)));
    } catch (e) {
      /* ignore quota */
    }
  }

  /* ------------------------------------------------------------------ *
   * tiny view helpers
   * ------------------------------------------------------------------ */

  function money(n) {
    return T.money(n);
  }

  function glyph(card) {
    return C.SUIT_GLYPH[card.suit] || card.suit;
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      if (!ui.motion || ms <= 0) {
        resolve();
        return;
      }
      global.setTimeout(resolve, ms);
    });
  }

  function toast(msg, ms) {
    if (!msg) return;
    var node = document.createElement('div');
    node.className = 'toast';
    node.textContent = msg;
    el.toastRail.appendChild(node);
    global.setTimeout(function () {
      node.classList.add('out');
      global.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 320);
    }, ms || 2200);
    while (el.toastRail.children.length > 3) {
      el.toastRail.removeChild(el.toastRail.firstChild);
    }
  }

  function shake(node) {
    if (!node || !ui.motion) return;
    node.classList.remove('kicked');
    void node.offsetWidth; // restart the animation
    node.classList.add('kicked');
  }

  function chipStack(amount) {
    var left = Math.max(0, Math.floor(amount));
    var out = [];
    var vals = C.CHIP_VALUES;
    for (var i = vals.length - 1; i >= 0; i--) {
      while (left >= vals[i] && out.length < 24) {
        out.push(vals[i]);
        left -= vals[i];
      }
    }
    return out;
  }

  function fillChips(container, amount) {
    container.innerHTML = '';
    chipStack(amount).forEach(function (v, i) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.v = v;
      chip.textContent = v;
      chip.style.transform =
        'translate(-50%, calc(-50% - ' + i * 3 + 'px)) rotate(' + ((i % 3) - 1) * 5 + 'deg)';
      container.appendChild(chip);
    });
  }

  function totalText(v) {
    if (!v.count) return '';
    if (v.bust) return v.total + ' ✗';
    if (v.soft && v.total <= 21 && v.total - 10 >= 2) return v.total - 10 + ' / ' + v.total;
    return String(v.total);
  }

  function valueOf(cards) {
    var v = C.handValue(cards);
    return { total: v.total, soft: v.soft, bust: v.bust, count: cards.length };
  }

  /* ------------------------------------------------------------------ *
   * cards
   * ------------------------------------------------------------------ */

  function cardNode(card, hidden) {
    var node = document.createElement('div');
    node.className = 'card ' + (card.red ? 'red' : 'black');
    node.dataset.id = card.id;
    if (hidden) {
      node.classList.add('back');
      return node;
    }
    node.innerHTML =
      '<span class="corner tl"><span class="r">' + card.rank + '</span>' +
      '<span class="s">' + glyph(card) + '</span></span>' +
      '<span class="pip">' + glyph(card) + '</span>' +
      '<span class="corner br"><span class="r">' + card.rank + '</span>' +
      '<span class="s">' + glyph(card) + '</span></span>';
    return node;
  }

  // Offset the entry animation so cards appear to come out of the shoe.
  function aimFromShoe(node) {
    if (!ui.motion || !el.shoe) return;
    var from = el.shoe.getBoundingClientRect();
    var to = node.getBoundingClientRect();
    if (!to.width) return;
    node.style.setProperty('--fx', from.left + from.width / 2 - (to.left + to.width / 2) + 'px');
    node.style.setProperty('--fy', from.top + from.height / 2 - (to.top + to.height / 2) + 'px');
    node.style.setProperty('--fr', '-14deg');
  }

  function appendCard(container, card, hidden, animate) {
    var node = cardNode(card, hidden);
    if (animate && ui.motion) {
      node.classList.add('arrive');
      container.appendChild(node);
      aimFromShoe(node);
    } else {
      container.appendChild(node);
    }
    return node;
  }

  /* ------------------------------------------------------------------ *
   * render: static chrome (levels, chips, stats)
   * ------------------------------------------------------------------ */

  function renderChipRack() {
    if (el.chipRack.childElementCount) return;
    C.CHIP_VALUES.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn';
      b.dataset.v = v;
      b.textContent = v;
      b.setAttribute('aria-label', T.money(v));
      b.addEventListener('click', function () {
        placeChip(v);
      });
      el.chipRack.appendChild(b);
    });
  }

  function renderLevels() {
    el.levelList.innerHTML = '';
    C.LEVELS.forEach(function (level) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'level';
      b.dataset.level = level.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.level === level.id));

      var top = document.createElement('div');
      top.className = 'level-top';
      var nm = document.createElement('span');
      nm.className = 'level-name';
      nm.textContent = T.levelField(level, 'name');
      var alg = document.createElement('span');
      alg.className = 'level-algo';
      alg.textContent = T.levelField(level, 'algo');
      top.appendChild(nm);
      top.appendChild(alg);

      var blurb = document.createElement('div');
      blurb.className = 'level-blurb';
      blurb.textContent = T.levelField(level, 'blurb');

      var meta = document.createElement('div');
      meta.className = 'level-meta';
      var edge = document.createElement('span');
      var pctv = Math.abs(level.edge * 100).toFixed(1) + '%';
      edge.className = 'level-edge ' + (level.edge < 0 ? 'good' : level.edge > 0.02 ? 'bad' : '');
      edge.textContent = level.edge < 0
        ? T.t('level.edgeGood', { n: pctv })
        : T.t('level.edgeBad', { n: pctv });
      var style = document.createElement('span');
      style.className = 'level-style';
      style.textContent = T.levelField(level, 'style');
      meta.appendChild(edge);
      meta.appendChild(style);

      b.appendChild(top);
      b.appendChild(blurb);
      b.appendChild(meta);
      b.addEventListener('click', function () {
        chooseLevel(level.id);
      });
      el.levelList.appendChild(b);
    });
  }

  function renderStats() {
    var s = state.stats;
    el.stRounds.textContent = s.rounds;
    el.stWL.textContent = s.wins + ' / ' + s.losses + ' / ' + s.pushes;
    el.stBJ.textContent = s.blackjacks;
    el.stNet.textContent = T.signed(s.net);
    el.stNet.className = s.net > 0 ? 'up' : s.net < 0 ? 'down' : '';
    el.stStreak.textContent = (s.bestStreak || 0) + ' / ' + Math.abs(s.worstStreak || 0);
  }

  /* ------------------------------------------------------------------ *
   * render: table
   * ------------------------------------------------------------------ */

  function renderWallet() {
    el.bankroll.textContent = money(state.bankroll);
    el.shoeCount.textContent = C.shoeRemaining(state.shoe);
  }

  function flashRoundDelta(net) {
    global.clearTimeout(roundFlash);
    if (!net) {
      el.roundDelta.hidden = true;
      return;
    }
    el.roundDelta.hidden = false;
    el.roundDelta.className = 'wallet-round ' + (net > 0 ? 'up' : 'down');
    el.roundDeltaValue.textContent = T.signed(net);
    roundFlash = global.setTimeout(function () {
      el.roundDelta.hidden = true;
    }, 3600);
  }

  function renderBet() {
    var amount;
    if (state.phase === C.PHASE.BETTING) {
      amount = state.pendingBet;
    } else {
      // Mid-round the circle shows everything actually committed, which after
      // a split or a double is more than the opening bet.
      amount = state.hands.reduce(function (sum, h) { return sum + (h.stake || 0); }, 0);
      if (state.insurance && state.insurance.stake) amount += state.insurance.stake;
      if (!amount) amount = state.bet;
    }
    el.betAmount.textContent = money(amount);
    fillChips(el.betStack, amount);
    el.betRing.classList.toggle('empty', amount <= 0);
  }

  function renderInsuranceWell() {
    var ins = state.insurance;
    var show = !!(state.offeredInsurance && ins && ins.stake > 0);
    el.insuranceWell.hidden = !show;
    if (!show) {
      el.insuranceChips.innerHTML = '';
      return;
    }
    fillChips(el.insuranceChips, ins.stake);
  }

  function dealerKnownValue() {
    var hidden = state.dealer.some(function (c) { return c.hidden; });
    if (!hidden) return valueOf(state.dealer);
    return valueOf(state.dealer.filter(function (c) { return !c.hidden; }));
  }

  function dealerTone() {
    if (state.phase !== C.PHASE.SETTLED || !state.lastResult) return '';
    if (C.isBlackjack(state.dealer)) return 'bj';
    var net = state.lastResult.net;
    if (net > 0) return 'win';
    if (net < 0) return 'lose';
    return 'push';
  }

  function renderDealerCards() {
    el.dealerCards.innerHTML = '';
    state.dealer.forEach(function (card) {
      el.dealerCards.appendChild(cardNode(card, !!card.hidden));
    });
    var v = dealerKnownValue();
    var hidden = state.dealer.some(function (c) { return c.hidden; });
    el.dealerTotal.hidden = !state.dealer.length;
    el.dealerTotal.textContent = totalText(v) + (hidden && state.dealer.length ? ' +?' : '');
    el.dealerTotal.className = 'total total-dealer ' + dealerTone();
  }

  function handWrap(index) {
    var node = el.playerHands.children[index];
    if (node) return node;
    node = document.createElement('div');
    node.className = 'hand';
    node.dataset.hand = index;
    node.innerHTML =
      '<div class="cards player-cards"></div>' +
      '<div class="hand-meta"><span class="hand-name"></span><span class="hand-stake"></span></div>' +
      '<div class="total"></div>';
    el.playerHands.appendChild(node);
    return node;
  }

  // Rebuild wrappers (and, when asked, their cards) from state.
  function renderHands(rebuildCards) {
    if (state.hands.length !== el.playerHands.childElementCount) rebuildCards = true;
    if (rebuildCards) el.playerHands.innerHTML = '';
    state.hands.forEach(function (hand, idx) {
      var wrap = handWrap(idx);
      var cards = wrap.querySelector('.player-cards');
      if (rebuildCards || cards.childElementCount !== hand.cards.length) {
        cards.innerHTML = '';
        hand.cards.forEach(function (card) {
          cards.appendChild(cardNode(card, false));
        });
      }
      wrap.querySelector('.hand-name').textContent =
        state.hands.length > 1 ? T.t('hand', { n: idx + 1 }) : T.t('player');
      var stake = wrap.querySelector('.hand-stake');
      stake.textContent = money(hand.stake) + (hand.doubled ? ' ×2' : '');

      var v = valueOf(hand.cards);
      var total = wrap.querySelector('.total');
      total.className = 'total';
      if (hand.surrendered) {
        total.textContent = T.t('move.surrender');
        total.classList.add('push');
      } else {
        total.textContent = totalText(v);
        if (hand.result) {
          total.classList.add(
            hand.result.outcome === C.OUTCOME.BLACKJACK ? 'bj' :
              hand.result.outcome === C.OUTCOME.PUSH ? 'push' :
                hand.result.net > 0 ? 'win' : 'lose'
          );
        } else if (v.bust) {
          total.classList.add('lose');
        }
      }
      wrap.classList.toggle('active', state.phase === C.PHASE.PLAYER && idx === state.active && !playing);
      wrap.classList.toggle('dimmed', state.phase === C.PHASE.PLAYER && idx !== state.active && !playing);
    });
    // Drop wrappers for hands that no longer exist (new round).
    while (el.playerHands.childElementCount > state.hands.length) {
      el.playerHands.removeChild(el.playerHands.lastChild);
    }
  }

  function renderBadge() {
    var level = C.levelById(state.level);
    el.dealerBadge.textContent = T.levelField(level, 'name');
    el.dealerBadge.title = T.levelField(level, 'algo');
  }

  function renderHint() {
    var show = ui.hints && state.phase === C.PHASE.PLAYER && !playing && state.dealer.length;
    el.hintSlot.hidden = !show;
    if (!show) return;
    var hand = C.activeHand(state);
    if (!hand || !hand.cards.length) {
      el.hintSlot.hidden = true;
      return;
    }
    var move = C.basicStrategy(hand, state.dealer[0], state.rules);
    if (move === 'double' && !C.canDouble(state)) move = 'hit';
    if (move === 'split' && !C.canSplit(state)) move = 'hit';
    if (move === 'surrender' && !C.canSurrender(state)) move = 'hit';
    el.hintValue.textContent = T.t('move.' + move);
  }

  function renderControls() {
    var p = state.phase;
    var betting = p === C.PHASE.BETTING && !playing;
    var acting = p === C.PHASE.PLAYER && !playing;
    var room = state.bankroll - state.pendingBet;

    Array.prototype.forEach.call(el.chipRack.children, function (b) {
      b.disabled = !betting || Number(b.dataset.v) > room;
    });
    el.btnClearBet.disabled = !betting || state.pendingBet <= 0;
    el.btnRepeat.disabled = !betting || !state.lastBet;
    el.btnRaise.disabled = !betting || !state.lastBet;
    el.btnAllIn.disabled = !betting || room <= 0;
    el.btnDeal.hidden = p === C.PHASE.SETTLED;
    el.btnDeal.disabled = !betting || state.pendingBet <= 0;

    el.btnHit.disabled = !acting;
    el.btnStand.disabled = !acting;
    el.btnDouble.disabled = !acting || !C.canDouble(state);
    el.btnSplit.disabled = !acting || !C.canSplit(state);
    el.btnSurrender.hidden = !state.rules.surrender;
    el.btnSurrender.disabled = !acting || !C.canSurrender(state);

    el.btnNext.hidden = p !== C.PHASE.SETTLED;
    el.btnNext.disabled = playing;
  }

  /* ------------------------------------------------------------------ *
   * render: opponent read panel
   * ------------------------------------------------------------------ */

  function decisionLine(entry, ordinal) {
    var li = document.createElement('li');
    var n = document.createElement('b');
    n.textContent = ordinal;
    var act = document.createElement('em');
    act.textContent = T.t('move.' + entry.action);
    var txt = document.createElement('span');
    txt.textContent = T.reason(entry.reasonKey, entry.params);
    li.appendChild(n);
    li.appendChild(act);
    li.appendChild(txt);
    if (entry.deferred) {
      // Say so plainly: this level chose to ignore its own read this once.
      var tag = document.createElement('span');
      tag.className = 'log-fallback';
      tag.textContent = T.t('read.fallback');
      li.appendChild(tag);
    }
    return li;
  }

  function paintReadCurrent(entry) {
    var who = C.levelById(entry.level || state.level);
    el.readCurrent.innerHTML =
      '<div class="read-who"><span class="dot"></span>' +
      T.t('read.who', { l: T.levelField(who, 'name'), n: entry.n || 1 }) +
      (entry.deferred ? ' · ' + T.t('read.fallback') : '') +
      '</div>' +
      '<div class="read-line">' + T.reason(entry.reasonKey, entry.params) + '</div>' +
      '<div class="read-moves">' +
      '<span class="read-move ' + entry.action + '">' + T.t('move.' + entry.action) + '</span>' +
      '<span class="read-tag">' + entry.total + '</span>' +
      '</div>';
    el.readCurrent.dataset.key = entry.reasonKey + '|' + entry.total + '|' + (entry.n || 0);
  }

  function renderRead() {
    var logs = state.log.filter(function (x) { return x.kind === 'dealer'; });
    el.readLog.innerHTML = '';
    logs.forEach(function (entry, i) {
      el.readLog.appendChild(decisionLine(entry, i + 1));
    });
    el.readLog.hidden = logs.length === 0;

    if (!logs.length) {
      if (playing || state.phase === C.PHASE.DEALER) {
        var who = C.levelById(state.level);
        el.readCurrent.innerHTML =
          '<div class="read-who"><span class="dot"></span>' +
          T.t('read.who', { l: T.levelField(who, 'name'), n: 1 }) + '</div>' +
          '<div class="read-line">' + T.t('read.thinking') + '</div>';
        el.readCurrent.dataset.key = 'thinking';
      } else {
        el.readCurrent.innerHTML = '<span class="read-empty">' + T.t('read.empty') + '</span>';
        el.readCurrent.dataset.key = 'empty';
      }
      return;
    }
    var last = logs[logs.length - 1];
    last = Object.assign({}, last, { n: logs.length });
    paintReadCurrent(last);
  }

  /* ------------------------------------------------------------------ *
   * sync = one idempotent pass over everything
   * ------------------------------------------------------------------ */

  function sync() {
    renderWallet();
    renderBet();
    renderInsuranceWell();
    renderDealerCards();
    renderHands(true);
    renderBadge();
    renderStats();
    renderHint();
    renderControls();
    renderRead();
  }

  /* ------------------------------------------------------------------ *
   * banner
   * ------------------------------------------------------------------ */

  function showBanner(text, tone) {
    el.banner.textContent = text || '';
    el.banner.className = 'banner';
    if (!text) return;
    void el.banner.offsetWidth;
    el.banner.classList.add('show');
    if (tone) el.banner.classList.add(tone);
  }

  function bannerFor(result) {
    if (!result) return null;
    var hands = result.hands;
    if (result.dealerBJ && hands.every(function (h) { return h.outcome !== C.OUTCOME.PUSH; })) {
      return { text: T.t('banner.dealerBj'), tone: 'lose' };
    }
    if (hands.length === 1) {
      var h = hands[0];
      if (h.outcome === C.OUTCOME.BLACKJACK) return { text: T.t('banner.blackjack'), tone: 'gold' };
      if (h.outcome === C.OUTCOME.BUST) return { text: T.t('banner.bust'), tone: 'lose' };
      if (h.outcome === C.OUTCOME.SURRENDER) return { text: T.t('banner.surrender'), tone: '' };
      if (h.label === 'pushBJ') return { text: T.t('banner.push'), tone: '' };
      if (h.outcome === C.OUTCOME.WIN) {
        return {
          text: h.label === 'dealerBust'
            ? T.t('banner.win') + ' · ' + T.t('outcome.dealerBust')
            : T.t('banner.win'),
          tone: 'win'
        };
      }
      if (h.outcome === C.OUTCOME.PUSH) return { text: T.t('banner.push'), tone: '' };
      return { text: T.t('banner.lose'), tone: 'lose' };
    }
    var wins = hands.filter(function (x) { return x.net > 0; }).length;
    var losses = hands.filter(function (x) { return x.net < 0; }).length;
    if (result.net > 0) return { text: T.t('banner.win') + ' (' + wins + '/' + hands.length + ')', tone: 'win' };
    if (result.net < 0 && losses) return { text: T.t('banner.lose'), tone: 'lose' };
    if (result.net < 0) return { text: T.t('banner.lose'), tone: 'lose' };
    return { text: T.t('banner.push'), tone: '' };
  }

  /* ------------------------------------------------------------------ *
   * event playback
   * ------------------------------------------------------------------ */

  var BEAT = {
    shuffle: 640,
    deal: 230,
    reveal: 340,
    decision: 300,
    split: 260,
    bust: 260,
    autoStand: 160,
    stand: 160,
    double: 200,
    insuranceOffer: 40,
    settle: 100,
    chip: 30
  };

  function beat(type) {
    return ui.motion ? BEAT[type] || 60 : 0;
  }

  function playerCardsEl(handIndex) {
    var wrap = handWrap(handIndex || 0);
    return wrap.querySelector('.player-cards');
  }

  function applyEvent(ev) {
    switch (ev.type) {
      case 'shuffle':
        shake(el.shoe);
        S.shuffle();
        showBanner(T.t('banner.reshuffle'), '');
        break;

      case 'deal': {
        var container = ev.to === 'dealer' ? el.dealerCards : playerCardsEl(ev.hand);
        appendCard(container, ev.card, !!ev.hole, true);
        S.deal(ev.to === 'dealer');
        if (ev.to === 'dealer') {
          var v = dealerKnownValue();
          el.dealerTotal.hidden = false;
          el.dealerTotal.textContent = totalText(v) + (v.count < state.dealer.length ? ' +?' : '');
        } else {
          var hv = valueOf(state.hands[ev.hand || 0].cards);
          var wrap = handWrap(ev.hand || 0);
          var total = wrap.querySelector('.total');
          total.textContent = totalText(hv);
          total.className = 'total' + (hv.bust ? ' lose' : '');
        }
        el.shoeCount.textContent = C.shoeRemaining(state.shoe);
        break;
      }

      case 'reveal': {
        var nodes = el.dealerCards.children;
        var target = nodes[ev.index === undefined ? 1 : ev.index];
        var delay = ui.motion ? 170 : 0;
        if (target) {
          target.classList.add('flip');
          global.setTimeout(function () {
            var fresh = cardNode(ev.card, false);
            fresh.classList.add('flip');
            if (target.parentNode) target.parentNode.replaceChild(fresh, target);
            var v2 = dealerKnownValue();
            el.dealerTotal.textContent = totalText(v2);
          }, delay);
        }
        S.flip();
        break;
      }

      case 'decision': {
        var logs = state.log.filter(function (x) { return x.kind === 'dealer'; });
        var entry = logs[logs.length - 1];
        if (entry) {
          paintReadCurrent(Object.assign({}, entry, { n: logs.length }));
          el.readLog.hidden = false;
          el.readLog.appendChild(decisionLine(entry, logs.length));
          el.readLog.scrollTop = el.readLog.scrollHeight;
        }
        S.decide(ev.action === 'hit');
        break;
      }

      case 'bust':
        S.bust();
        break;

      case 'autoStand':
      case 'stand':
        break;

      case 'double':
        S.chip(100);
        renderHands(false);
        renderBet();
        break;

      case 'split':
        renderHands(true);
        renderBet();
        S.chip(25);
        break;

      case 'surrender':
        S.push();
        break;

      case 'insuranceBuy':
        S.chip(5);
        renderInsuranceWell();
        renderBet();
        break;

      case 'insuranceWin':
        toast(T.t('insurance.won', { n: money(ev.win) }), 2600);
        S.win();
        break;

      case 'insuranceLose':
        toast(T.t('insurance.lost', { n: money(ev.stake) }), 2400);
        break;

      case 'insuranceOffer':
        openInsurance();
        break;

      case 'settle': {
        var b = bannerFor(state.lastResult);
        showBanner(b && b.text, b && b.tone);
        if (ev.net > 0 && state.lastResult && state.lastResult.hands.some(function (h) { return h.outcome === C.OUTCOME.BLACKJACK; })) {
          S.blackjack();
        } else if (ev.net > 0) {
          S.win();
        } else if (ev.net < 0) {
          S.lose();
        } else {
          S.push();
        }
        renderWallet();
        renderHands(true);
        renderDealerCards();
        renderStats();
        flashRoundDelta(ev.net);
        break;
      }

      case 'broke':
        toast(T.t('toast.bankrupt'), 3200);
        break;

      case 'rebuy':
        toast(T.t('toast.rebuy'), 3000);
        S.chip(500);
        break;

      case 'chip':
      case 'chipRemove':
        renderBet();
        renderWallet();
        break;

      case 'turn':
        renderHands(false);
        break;

      case 'level':
        renderBadge();
        break;

      default:
        break;
    }
    return Promise.resolve();
  }

  function playEvents() {
    var events = C.drainEvents(state);
    if (!events.length) {
      sync();
      return Promise.resolve();
    }
    playing = true;
    renderControls();
    var chain = events.reduce(function (p, ev) {
      return p
        .then(function () { return applyEvent(ev); })
        .then(function () { return wait(beat(ev.type)); });
    }, Promise.resolve());
    return chain.then(function () {
      playing = false;
      sync();
      saveGame();
    }, function (err) {
      playing = false;
      sync();
      global.setTimeout(function () { throw err; }, 0);
    });
  }

  /* ------------------------------------------------------------------ *
   * actions
   * ------------------------------------------------------------------ */

  function placeChip(value) {
    if (playing) return;
    if (state.phase !== C.PHASE.BETTING) {
      if (state.phase === C.PHASE.INSURANCE) toast(T.t('toast.locked'));
      return;
    }
    if (!C.addChip(state, value)) {
      S.error();
      toast(T.t('bet.tooSmall'));
      return;
    }
    S.chip(value);
    renderBet();
    renderWallet();
    renderControls();
    saveGame();
  }

  function dealClick() {
    if (playing || state.phase !== C.PHASE.BETTING) return;
    if (state.pendingBet <= 0) {
      S.error();
      toast(T.t('bet.need'));
      return;
    }
    S.unlock();
    S.click();
    if (C.startRound(state)) playEvents();
  }

  function nextClick() {
    if (playing || state.phase !== C.PHASE.SETTLED) return;
    S.click();
    el.banner.className = 'banner';
    el.roundDelta.hidden = true;
    if (C.nextRound(state)) playEvents();
  }

  function doAction(name) {
    if (playing || state.phase !== C.PHASE.PLAYER) return;
    var map = {
      hit: C.hit,
      stand: C.stand,
      double: C.double,
      split: C.split,
      surrender: C.surrender
    };
    var fn = map[name];
    if (!fn) return;
    if (!fn(state)) {
      S.error();
      if (name === 'split') toast(T.t('toast.noSplit'));
      else if (name === 'double') toast(T.t('toast.noDouble'));
      else if (name === 'surrender') toast(T.t('toast.noSurrender'));
      return;
    }
    playEvents();
  }

  function chooseLevel(id) {
    if (playing) return;
    var before = state.level;
    C.setLevel(state, id);
    if (before !== id) {
      var level = C.levelById(id);
      toast(T.t('level.changed', { l: T.levelField(level, 'name'), a: T.levelField(level, 'algo') }), 2800);
      S.click();
    }
    renderLevels();
    renderBadge();
    saveGame();
  }

  /* ------------------------------------------------------------------ *
   * overlays
   * ------------------------------------------------------------------ */

  function openSheet(node) {
    el.scrim.hidden = false;
    node.hidden = false;
    var focusable = node.querySelector('button:not(:disabled)');
    if (focusable) focusable.focus();
  }

  function closeSheet(node) {
    node.hidden = true;
    if (!openSheetName()) el.scrim.hidden = true;
  }

  function openSheetName() {
    var found = null;
    ['sheetInsurance', 'sheetSettings', 'sheetHelp'].forEach(function (k) {
      if (!el[k].hidden) found = k;
    });
    return found;
  }

  function openInsurance() {
    var cost = C.halfStake(state.bet);
    el.insuranceCopy.textContent = T.t('insurance.body');
    el.btnInsYes.textContent = T.t('insurance.yes', { n: money(cost) });
    el.btnInsYes.disabled = cost <= 0 || state.bankroll < cost;
    renderInsuranceWell();
    openSheet(el.sheetInsurance);
  }

  function answerInsurance(accept) {
    if (state.phase !== C.PHASE.INSURANCE) return;
    closeSheet(el.sheetInsurance);
    if (C.takeInsurance(state, accept)) playEvents();
  }

  function closeAllSheets() {
    var wasInsurance = !el.sheetInsurance.hidden;
    ['sheetInsurance', 'sheetSettings', 'sheetHelp'].forEach(function (k) {
      el[k].hidden = true;
    });
    el.scrim.hidden = true;
    // Dismissing the insurance prompt is a decline: never leave the round hung.
    if (wasInsurance) answerInsurance(false);
  }

  /* ------------------------------------------------------------------ *
   * settings
   * ------------------------------------------------------------------ */

  function syncSettingsForm() {
    el.setLang.value = ui.lang;
    el.setDecks.value = String(state.rules.decks);
    el.setPenetration.value = String(Math.round(state.rules.penetration * 100));
    el.outPenetration.textContent = Math.round(state.rules.penetration * 100) + '%';
    el.setSoft17.checked = !!state.rules.stopsOnSoft17;
    el.setDas.checked = !!state.rules.doubleAfterSplit;
    el.setSurrender.checked = !!state.rules.surrender;
    el.setDealOrder.value = state.rules.dealOrder;
    el.setHints.checked = ui.hints;
    el.setMotion.checked = ui.motion;
    el.setSound.checked = ui.sound;
  }

  function applySettings() {
    var patch = {
      decks: Number(el.setDecks.value),
      penetration: Number(el.setPenetration.value) / 100,
      stopsOnSoft17: el.setSoft17.checked,
      doubleAfterSplit: el.setDas.checked,
      surrender: el.setSurrender.checked,
      dealOrder: el.setDealOrder.value
    };
    var shoeChanged = patch.decks !== state.rules.decks || patch.penetration !== state.rules.penetration;
    C.setRules(state, patch);
    // A shoe change only makes sense between rounds.
    if (shoeChanged && state.phase === C.PHASE.BETTING && !state.hands.length) {
      state.shoe = C.buildShoe(state.rules, state._rng);
      shake(el.shoe);
    }
    var langChanged = ui.lang !== el.setLang.value;
    ui.hints = el.setHints.checked;
    ui.sound = el.setSound.checked;
    ui.motion = el.setMotion.checked;
    ui.lang = el.setLang.value;

    T.set(ui.lang);
    S.setEnabled(ui.sound);
    document.body.classList.toggle('no-motion', !ui.motion);
    if (langChanged) {
      T.applyTo(document);
      renderLevels();
      renderChipRackLabels();
    }
    saveUI();
    saveGame();
    sync();
    el.btnSound.setAttribute('aria-pressed', String(ui.sound));
    el.btnSound.querySelector('.tool-label').textContent =
      ui.sound ? T.t('tool.sound') : T.t('tool.soundOff');
  }

  function renderChipRackLabels() {
    Array.prototype.forEach.call(el.chipRack.children, function (b) {
      b.setAttribute('aria-label', T.money(Number(b.dataset.v)));
    });
  }

  function hardReset() {
    if (!global.confirm(T.t('settings.confirmReset'))) return;
    try {
      global.localStorage.removeItem(SAVE_KEY);
      global.localStorage.removeItem(UI_KEY);
    } catch (e) {
      /* ignore */
    }
    state = C.createGame({ level: 'house', bankroll: 1000, rules: C.DEFAULT_RULES });
    ui.hints = true;
    ui.motion = !prefersReducedMotion();
    ui.sound = true;
    T.set(ui.lang);
    S.setEnabled(ui.sound);
    document.body.classList.toggle('no-motion', !ui.motion);
    closeSheet(el.sheetSettings);
    saveUI();
    T.applyTo(document);
    renderLevels();
    sync();
    toast(T.t('toast.cleared'), 2600);
  }

  function toggleSound() {
    ui.sound = !ui.sound;
    S.setEnabled(ui.sound);
    el.btnSound.setAttribute('aria-pressed', String(ui.sound));
    el.btnSound.querySelector('.tool-label').textContent =
      ui.sound ? T.t('tool.sound') : T.t('tool.soundOff');
    if (ui.sound) S.unlock();
    el.setSound.checked = ui.sound;
    saveUI();
    toast(ui.sound ? T.t('toast.soundOn') : T.t('toast.soundOff'), 1400);
  }

  /* ------------------------------------------------------------------ *
   * betting convenience
   * ------------------------------------------------------------------ */

  function betOp(fn, chipValue) {
    if (playing || state.phase !== C.PHASE.BETTING) return;
    if (fn(state)) {
      S.chip(chipValue || 25);
      renderBet();
      renderWallet();
      renderControls();
      saveGame();
    } else {
      S.error();
    }
  }

  /* ------------------------------------------------------------------ *
   * keyboard
   * ------------------------------------------------------------------ */

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      var k = e.key.toLowerCase();

      if (k === 'escape') {
        if (openSheetName()) {
          e.preventDefault();
          closeAllSheets();
        }
        return;
      }
      if (k === 'f1') {
        e.preventDefault();
        if (el.sheetHelp.hidden) openSheet(el.sheetHelp);
        else closeSheet(el.sheetHelp);
        return;
      }

      if (state.phase === C.PHASE.INSURANCE && !el.sheetInsurance.hidden) {
        if (k === 'i') {
          e.preventDefault();
          answerInsurance(true);
        } else if (k === 'n' || k === 'enter' || k === ' ') {
          e.preventDefault();
          answerInsurance(false);
        }
        return;
      }

      if (openSheetName()) return;

      if (k >= '1' && k <= '5') {
        e.preventDefault();
        placeChip(C.CHIP_VALUES[Number(k) - 1]);
        return;
      }

      switch (k) {
        case ' ':
        case 'enter':
          e.preventDefault();
          if (state.phase === C.PHASE.SETTLED) nextClick();
          else if (state.phase === C.PHASE.PLAYER) doAction('hit');
          else dealClick();
          break;
        case 'h':
          e.preventDefault();
          doAction('hit');
          break;
        case 's':
          e.preventDefault();
          doAction('stand');
          break;
        case 'd':
          e.preventDefault();
          doAction('double');
          break;
        case 'p':
          e.preventDefault();
          doAction('split');
          break;
        case 'u':
          e.preventDefault();
          doAction('surrender');
          break;
        case 'backspace':
          e.preventDefault();
          betOp(function (g) { return C.removeChip(g, undefined); }, 1);
          break;
        case 'a':
          e.preventDefault();
          betOp(C.maxBet, 500);
          break;
        case 'r':
          e.preventDefault();
          betOp(C.replayBet, 25);
          break;
        case 'l':
          e.preventDefault();
          betOp(C.raiseBet, 25);
          break;
        case 'm':
          e.preventDefault();
          toggleSound();
          break;
        case 'c':
          e.preventDefault();
          betOp(C.clearBet, 1);
          break;
        default:
          break;
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * wiring
   * ------------------------------------------------------------------ */

  function bindUi() {
    el.btnDeal.addEventListener('click', dealClick);
    el.btnNext.addEventListener('click', nextClick);
    el.btnHit.addEventListener('click', function () { doAction('hit'); });
    el.btnStand.addEventListener('click', function () { doAction('stand'); });
    el.btnDouble.addEventListener('click', function () { doAction('double'); });
    el.btnSplit.addEventListener('click', function () { doAction('split'); });
    el.btnSurrender.addEventListener('click', function () { doAction('surrender'); });

    el.btnClearBet.addEventListener('click', function () { betOp(C.clearBet, 1); });
    el.btnAllIn.addEventListener('click', function () { betOp(C.maxBet, 500); });
    el.btnRepeat.addEventListener('click', function () { betOp(C.replayBet, 25); });
    el.btnRaise.addEventListener('click', function () { betOp(C.raiseBet, 25); });

    el.btnInsYes.addEventListener('click', function () { answerInsurance(true); });
    el.btnInsNo.addEventListener('click', function () { answerInsurance(false); });

    el.btnSound.addEventListener('click', toggleSound);
    el.btnHelp.addEventListener('click', function () {
      S.unlock();
      openSheet(el.sheetHelp);
    });
    el.btnCloseHelp.addEventListener('click', function () { closeSheet(el.sheetHelp); });
    el.btnSettings.addEventListener('click', function () {
      syncSettingsForm();
      openSheet(el.sheetSettings);
    });
    el.btnCloseSettings.addEventListener('click', function () {
      applySettings();
      closeSheet(el.sheetSettings);
    });
    el.btnResetStats.addEventListener('click', function () {
      state.stats = C.emptyStats();
      saveGame();
      renderStats();
      toast(T.t('stats.reseted'), 1600);
    });

    el.btnResetAll.addEventListener('click', hardReset);
    el.scrim.addEventListener('click', closeAllSheets);

    ['setLang', 'setDecks', 'setPenetration', 'setSoft17', 'setDas', 'setSurrender',
      'setDealOrder', 'setHints', 'setMotion', 'setSound'].forEach(function (id) {
      var node = el[id];
      node.addEventListener(node.type === 'range' ? 'input' : 'change', function () {
        if (id === 'setPenetration') el.outPenetration.textContent = node.value + '%';
        applySettings();
      });
    });

    el.btnReadToggle.addEventListener('click', function () {
      var collapsed = el.readBody.parentNode.classList.toggle('collapsed');
      el.btnReadToggle.textContent = collapsed ? '▸' : '▾';
      el.btnReadToggle.setAttribute('aria-expanded', String(!collapsed));
    });

    // Browsers only let us start an AudioContext from a gesture.
    global.addEventListener('pointerdown', function once() {
      S.unlock();
      global.removeEventListener('pointerdown', once);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) saveGame();
    });
    global.addEventListener('pagehide', saveGame);
  }

  /* ------------------------------------------------------------------ *
   * start
   * ------------------------------------------------------------------ */

  function start() {
    cacheEls();
    loadUI();
    loadGame();
    document.body.classList.toggle('no-motion', !ui.motion);
    el.btnSound.setAttribute('aria-pressed', String(ui.sound));
    el.btnSound.querySelector('.tool-label').textContent =
      ui.sound ? T.t('tool.sound') : T.t('tool.soundOff');
    renderChipRack();
    renderLevels();
    bindUi();
    bindKeys();
    T.applyTo(document);
    renderChipRackLabels();
    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  global.BJApp = {
    get state() { return state; },
    sync: sync,
    playEvents: playEvents
  };
})(window);
