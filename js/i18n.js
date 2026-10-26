/*
 * i18n: every user-visible string lives here.
 * zh is the default; en is the alternative. `data-i18n` swaps textContent and
 * `data-i18n-html` swaps innerHTML (used where a string carries <b> emphasis).
 */
(function (global) {
  'use strict';

  var DICT = {
    zh: {
      'app.name': '二十一点',
      'app.sub': 'Blackjack · 暖桌版',
      bankroll: '余额',
      dealer: '庄家',
      player: '你',
      hand: '第 {n} 手',
      'felt.print': 'BLACKJACK PAYS 3 TO 2 · 庄家必须停牌于 17',
      'felt.insurance': '保险 2 赔 1',
      'bet.circle': '下注区',
      insurance: {
        well: '保险',
        title: '庄家明牌是 A · 要买保险吗？',
        body: '保险花费当前下注的一半。若庄家真的是黑杰克，保险赔 2:1。',
        note: '提示：不数牌的话，保险的期望值是<b>负的</b>（约 −8%），标准打法是拒绝。',
        yes: '买保险 {n}',
        no: '不买',
        won: '保险命中：庄家黑杰克，赔付 {n}',
        lost: '保险落空：庄家不是黑杰克，−{n}'
      },
      tool: {
        sound: '音效',
        soundOff: '静音',
        help: '帮助',
        save: '存档',
        settings: '设置'
      },
      save: {
        title: '存档码 · 导出 / 导入',
        exportTab: '导出',
        importTab: '导入',
        exportHint: '复制下面这段存档码即可转移进度：余额、战绩、桌规与整只牌靴都会带走。',
        importHint: '粘贴存档码。若原存档设了口令，这里要填同一个口令。',
        pass: '口令（可选）',
        passPh: '留空则仅做混淆',
        pastePh: 'BJ1.……',
        warn: '说明：存档码经过混淆与校验，<b>不是密码学加密</b>。它能防止误改和随便偷看，但有心人仍可还原。口令只用于生成混淆密钥，请务必自行记住。',
        copy: '复制存档码',
        copied: '存档码已复制',
        copyFailed: '复制失败，请手动选中文本',
        download: '下载 .txt',
        fromFile: '读取文件',
        apply: '导入并覆盖',
        needCode: '请先粘贴存档码',
        imported: '已导入 · {s}',
        rejected: '存档码无效：{e}',
        confirmOverwrite: '当前进度（{now}）将被替换为：\n{s}\n\n确定导入？',
        errors: {
          empty: '内容为空',
          format: '格式不对',
          magic: '不是本游戏的存档码',
          checksum: '校验失败 · 口令错误或文本被改动',
          json: '内容损坏',
          shape: '字段缺失',
          shoe: '牌靴数据无效'
        },
        preview: '存档内容：{s}',
        now: '当前：{s}'
      },
      level: {
        title: '对手难度',
        hint: '每一档都是一套<b>不同的抽牌算法</b>，它每一步怎么想的，都会逐条写进「对手思路」。',
        edge: '对玩家 {n}',
        edgeGood: '玩家优势 {n}',
        edgeBad: '庄家优势 {n}',
        changed: '对手换成「{l}」：{a}'
      },
      read: {
        title: '对手思路',
        empty: '开局后这里会逐条显示庄家的决策理由。',
        waiting: '等庄家行动…',
        who: '{l} · 第 {n} 步',
        fallback: '退回桌规',
        yourBest: '你的最优：{m}',
        thinking: '正在决策…',
        roundStart: '新一局开始 · 对手：{l}'
      },
      stats: {
        title: '战绩',
        rounds: '局数',
        wl: '胜 / 负 / 平',
        bj: '黑杰克',
        net: '累计盈亏',
        streak: '连胜 / 连败',
        winRate: '胜率',
        reset: '清零战绩',
        reseted: '战绩已清零'
      },
      act: {
        deal: '发牌',
        hit: '要牌',
        stand: '停牌',
        double: '加倍',
        split: '分牌',
        surrender: '认输',
        next: '下一局'
      },
      move: {
        hit: '要牌',
        stand: '停牌',
        double: '加倍',
        split: '分牌',
        surrender: '认输'
      },
      bet: {
        clear: '撤注',
        repeat: '重复',
        raise: '加注',
        allin: '全押',
        need: '请先放入筹码',
        tooSmall: '余额不够这一注'
      },
      hint: { caption: '建议', off: '关' },
      banner: {
        blackjack: '黑杰克！',
        win: '你赢了',
        lose: '庄家赢',
        push: '平局',
        bust: '爆牌',
        surrender: '已认输',
        dealerBj: '庄家黑杰克',
        insurance: '保险命中',
        reshuffle: '洗牌'
      },
      toast: {
        rebuy: '余额见底 · 已补码 $1,000',
        noSplit: '现在不能分牌',
        noDouble: '现在不能加倍',
        noSurrender: '本桌未开启认输',
        locked: '庄家明牌是 A，先决定保险',
        bankrupt: '筹码输光 · 点下一局免费补码',
        saved: '已存档',
        cleared: '存档已清空，刷新后重开',
        motionOff: '动画已关闭',
        motionOn: '动画已开启',
        soundOn: '音效已开启',
        soundOff: '音效已关闭'
      },
      settings: {
        title: '桌台设置',
        lang: '语言',
        decks: '副数',
        penetration: '切牌深度',
        soft17: '软 17 停牌（S17）',
        das: '分牌后可加倍',
        surrender: '允许提前认输',
        dealOrder: '发牌方式',
        dealOne: '轮流一张',
        dealTwo: '各发两张',
        hints: '显示策略建议',
        motion: '动画',
        sound: '音效',
        close: '完成',
        resetAll: '重置存档',
        confirmReset: '确定清空余额、战绩与设置？'
      },
      help: {
        title: '玩法与快捷键',
        rulesH: '规则',
        rules:
          '<li>目标：手牌点数尽量接近 21 且不超过，赢过庄家。</li>' +
          '<li>A 计 1 或 11；J / Q / K 计 10。</li>' +
          '<li>黑杰克（两张牌成 21）赔 3:2。</li>' +
          '<li>分牌、加倍、保险、可选提前认输。</li>',
        levelH: '对手算法',
        levels:
          '<li>新手荷官：随机失误，软牌常搞混。</li>' +
          '<li>标准庄：固定 17 定式，零失误。</li>' +
          '<li>老练读牌：追你的点数，按爆牌风险收敛。</li>' +
          '<li>算牌鲨鱼：真数 + 动态规划解期望值。</li>',
        keysH: '快捷键',
        close: '知道了'
      },
      key: {
        deal: '发牌 / 下一局',
        chips: '放筹码',
        undo: '撤最后枚筹码',
        insurance: '保险：接受 / 拒绝',
        mute: '静音',
        close: '关闭弹层',
        help: '帮助'
      },
      reason: {
        'novice.bust': '已经爆了，只能停下（好像是这样？）',
        'novice.softConfused': '软 {t}… 我记得要再抽一张吧',
        'novice.softOk': '软 {t}，这次我记得该停了',
        'novice.policyMixup': '软 17… S17 还是 H17 来着？',
        'novice.policyOk': '软 17，按桌规处理',
        'novice.tooScared': '只有 {t}，但我不敢抽了',
        'novice.mustDraw': '才 {t}，必须继续抽',
        'novice.overdraw': '{t} 了还手痒多抽一张',
        'novice.ruleGuess': '应该是 17 就停… 吧，{t}',
        'house.bust': '爆牌，停牌',
        'house.below17': '{t} < 17 · 桌规要求抽牌',
        'house.soft17S': '软 17 · 本桌 S17，停牌',
        'house.soft17H': '软 17 · 本桌 H17，继续抽',
        'house.at17': '已到 {t} · 桌规停牌',
        'house.natural': '已成黑杰克，无需行动',
        'sharp.bust': '爆牌，停牌',
        'sharp.deadRubber': '你已爆牌 · 走完流程，{t}',
        'sharp.wonAlready': '这局我赢了 · 停在 {t}，不多事',
        'sharp.holdLead': '我 {t} > 你的 {need} · 保住领先',
        'sharp.breakTie': '平手 {t} · 爆牌概率 {risk}% 可接受，加注',
        'sharp.takePush': '平手 {t} · 抽牌爆率 {risk}% 太高，收平局',
        'sharp.givenUp': '{t} 追 {need} · 爆率 {risk}% 已无意义',
        'sharp.belowFloor': '落后（{t} vs 你的 {need}）· 先补到 17，爆率 {risk}%',
        'sharp.chase': '落后（{t} vs 你的 {need}）· 停牌必输，赌这一张，爆率 {risk}%',
        'shark.bust': '爆牌，停牌',
        'shark.nothingToBeat': '无有效对手手牌 · 停牌',
        'shark.hitWins': '停牌 EV {stand} vs 抽牌 EV {draw} · 真数 {tc} → 抽',
        'shark.standWins': '停牌 EV {stand} vs 抽牌 EV {draw} · 真数 {tc} → 停',
        'shark.tie': '两条 EV 打平（{stand}）· 软牌倾向抽'
      },
      outcome: {
        blackjack: '黑杰克 3:2',
        win: '赢',
        lose: '输',
        push: '平',
        bust: '爆牌',
        surrender: '认输',
        dealerBJ: '庄家黑杰克',
        pushBJ: '双方黑杰克',
        dealerBust: '庄家爆牌',
        higher: '点数较大',
        lower: '点数较小'
      }
    },

    en: {
      'app.name': 'Blackjack',
      'app.sub': '二十一点 · warm table',
      bankroll: 'Bankroll',
      dealer: 'Dealer',
      player: 'You',
      hand: 'Hand {n}',
      'felt.print': 'BLACKJACK PAYS 3 TO 2 · DEALER MUST STAND ON 17',
      'felt.insurance': 'Insurance pays 2 to 1',
      'bet.circle': 'Bet spot',
      insurance: {
        well: 'Insurance',
        title: 'Dealer shows an Ace · take insurance?',
        body: 'Insurance costs half of your current bet and pays 2:1 if the dealer has a blackjack.',
        note: 'Unless you are counting, insurance is a <b>negative-expectation</b> side bet (about −8%). Basic strategy says no.',
        yes: 'Insure {n}',
        no: 'No thanks',
        won: 'Insurance hit: dealer blackjack, +{n}',
        lost: 'Insurance missed: no dealer blackjack, −{n}'
      },
      tool: {
        sound: 'Sound',
        soundOff: 'Muted',
        help: 'Help',
        save: 'Save',
        settings: 'Table'
      },
      save: {
        title: 'Save code · export / import',
        exportTab: 'Export',
        importTab: 'Import',
        exportHint: 'Copy the code below to move your progress: bankroll, stats, table rules and the whole shoe come with it.',
        importHint: 'Paste a save code. If it was made with a passphrase, enter the same one here.',
        pass: 'Passphrase (optional)',
        passPh: 'leave blank to only obfuscate',
        pastePh: 'BJ1.……',
        warn: 'The code is obfuscated and checksummed, <b>not cryptographically encrypted</b>. It stops casual peeking and accidental edits; a determined reader can still undo it. A passphrase only seeds the obfuscation key — remember it yourself.',
        copy: 'Copy code',
        copied: 'Save code copied',
        copyFailed: 'Copy failed, select the text manually',
        download: 'Download .txt',
        fromFile: 'Load file',
        apply: 'Import & overwrite',
        needCode: 'Paste a save code first',
        imported: 'Imported · {s}',
        rejected: 'Invalid save code: {e}',
        confirmOverwrite: 'Current progress ({now}) will be replaced by:\n{s}\n\nImport?',
        errors: {
          empty: 'nothing to read',
          format: 'wrong format',
          magic: 'not a save code from this game',
          checksum: 'checksum failed · wrong passphrase or edited text',
          json: 'payload is corrupt',
          shape: 'missing fields',
          shoe: 'shoe data is invalid'
        },
        preview: 'Save contains: {s}',
        now: 'now: {s}'
      },
      level: {
        title: 'Opponent',
        hint: 'Each difficulty is a <b>different draw algorithm</b>. Its reasoning streams below, in the read panel.',
        edge: 'vs player {n}',
        edgeGood: 'Player edge {n}',
        edgeBad: 'House edge {n}',
        changed: 'Opponent switched to "{l}": {a}'
      },
      read: {
        title: "Opponent's read",
        empty: 'Once the round starts the dealer explains every decision here.',
        waiting: 'Waiting for the dealer…',
        who: '{l} · step {n}',
        fallback: 'fell back to procedure',
        yourBest: 'Your best: {m}',
        thinking: 'Thinking…',
        roundStart: 'New round · opponent: {l}'
      },
      stats: {
        title: 'Session',
        rounds: 'Rounds',
        wl: 'W / L / P',
        bj: 'Blackjacks',
        net: 'Net',
        streak: 'Streak',
        winRate: 'Win rate',
        reset: 'Clear stats',
        reseted: 'Stats cleared'
      },
      act: {
        deal: 'Deal',
        hit: 'Hit',
        stand: 'Stand',
        double: 'Double',
        split: 'Split',
        surrender: 'Surrender',
        next: 'Next round'
      },
      move: {
        hit: 'hit',
        stand: 'stand',
        double: 'double',
        split: 'split',
        surrender: 'surrender'
      },
      bet: {
        clear: 'Clear',
        repeat: 'Repeat',
        raise: 'Raise',
        allin: 'All in',
        need: 'Put a chip in the circle first',
        tooSmall: 'Not enough bankroll for that bet'
      },
      hint: { caption: 'Hint', off: 'off' },
      banner: {
        blackjack: 'Blackjack!',
        win: 'You win',
        lose: 'Dealer wins',
        push: 'Push',
        bust: 'Bust',
        surrender: 'Surrendered',
        dealerBj: 'Dealer blackjack',
        insurance: 'Insurance paid',
        reshuffle: 'Shuffle'
      },
      toast: {
        rebuy: 'Out of chips · $1,000 comped',
        noSplit: 'Cannot split right now',
        noDouble: 'Cannot double right now',
        noSurrender: 'This table does not offer surrender',
        locked: 'Dealer shows an Ace · settle insurance first',
        bankrupt: 'Bankroll gone · press Next round for a free rebuy',
        saved: 'Saved',
        cleared: 'Save cleared, reload for a fresh table',
        motionOff: 'Motion off',
        motionOn: 'Motion on',
        soundOn: 'Sound on',
        soundOff: 'Sound off'
      },
      settings: {
        title: 'Table settings',
        lang: 'Language',
        decks: 'Decks',
        penetration: 'Shoe penetration',
        soft17: 'Dealer stands on soft 17 (S17)',
        das: 'Double after split',
        surrender: 'Allow early surrender',
        dealOrder: 'Deal order',
        dealOne: 'Round robin',
        dealTwo: 'Two at once',
        hints: 'Show strategy hint',
        motion: 'Animation',
        sound: 'Sound',
        close: 'Done',
        resetAll: 'Reset save',
        confirmReset: 'Clear bankroll, stats and settings?'
      },
      help: {
        title: 'Rules & shortcuts',
        rulesH: 'Rules',
        rules:
          '<li>Get closer to 21 than the dealer without going over.</li>' +
          '<li>Ace is 1 or 11; J / Q / K are 10.</li>' +
          '<li>Blackjack pays 3:2.</li>' +
          '<li>Split, double, insurance and optional early surrender.</li>',
        levelH: 'Opponent algorithms',
        levels:
          '<li>Trainee: random blunders, confuses soft totals.</li>' +
          '<li>The House: fixed 17 policy, zero error.</li>' +
          '<li>Floor Reader: chases your total inside a bust budget.</li>' +
          '<li>Shoe Shark: true count plus dynamic programming.</li>',
        keysH: 'Shortcuts',
        close: 'Got it'
      },
      key: {
        deal: 'Deal / next round',
        chips: 'Place a chip',
        undo: 'Remove last chip',
        insurance: 'Insurance: yes / no',
        mute: 'Mute',
        close: 'Close overlay',
        help: 'Help'
      },
      reason: {
        'novice.bust': 'I am over 21, so… stop? (I think)',
        'novice.softConfused': 'Soft {t}… I remember hitting here',
        'novice.softOk': 'Soft {t}, and this time I remember to stop',
        'novice.policyMixup': 'Soft 17… was it S17 or H17?',
        'novice.policyOk': 'Soft 17, handled by the book',
        'novice.tooScared': 'Only {t}, but I am too scared to draw',
        'novice.mustDraw': 'Just {t}, I have to keep drawing',
        'novice.overdraw': 'On {t} my hand itched and I drew again',
        'novice.ruleGuess': 'Stand at 17… probably. I am on {t}',
        'house.bust': 'Bust. Standing.',
        'house.below17': '{t} < 17 · table policy forces a draw',
        'house.soft17S': 'Soft 17 · this table is S17, stand',
        'house.soft17H': 'Soft 17 · this table is H17, draw',
        'house.at17': 'Reached {t} · table policy stands',
        'house.natural': 'Blackjack already, nothing to decide',
        'sharp.bust': 'Bust. Standing.',
        'sharp.deadRubber': 'You busted · playing it out at {t}',
        'sharp.wonAlready': 'This one is mine · holding {t}',
        'sharp.holdLead': 'I have {t} > your {need} · keep the lead',
        'sharp.breakTie': 'Tied at {t} · bust risk {risk}% is affordable, press',
        'sharp.takePush': 'Tied at {t} · {risk}% bust risk too high, take the push',
        'sharp.givenUp': '{t} chasing {need} · {risk}% bust, pointless',
        'sharp.belowFloor': 'Behind ({t} vs your {need}) · fill to 17 first, {risk}% bust',
        'sharp.chase': 'Behind ({t} vs your {need}) · standing loses, gamble, {risk}% bust',
        'shark.bust': 'Bust. Standing.',
        'shark.nothingToBeat': 'No live hand to beat · stand',
        'shark.hitWins': 'stand EV {stand} vs draw EV {draw} · true count {tc} → draw',
        'shark.standWins': 'stand EV {stand} vs draw EV {draw} · true count {tc} → stand',
        'shark.tie': 'Both lines are {stand} · soft totals favour a draw'
      },
      outcome: {
        blackjack: 'Blackjack 3:2',
        win: 'Win',
        lose: 'Lose',
        push: 'Push',
        bust: 'Bust',
        surrender: 'Surrender',
        dealerBJ: 'Dealer blackjack',
        pushBJ: 'Both blackjack',
        dealerBust: 'Dealer bust',
        higher: 'Higher total',
        lower: 'Lower total'
      }
    }
  };

  function hasOwn(obj, key) {
    return obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
  }

  /*
   * Keys are dotted, but some leaf keys contain a dot themselves — the reason
   * table is keyed by "house.below17", "novice.softConfused" and so on, so a
   * naive split would look for table.reason.house.below17 and miss. At every
   * level we therefore try the single segment first and then the whole
   * remaining path as one literal key.
   */
  function lookup(lang, key) {
    var table = DICT[lang];
    if (!table) return undefined;
    if (hasOwn(table, key)) return table[key];
    var parts = String(key).split('.');
    var node = table;
    for (var i = 0; i < parts.length; i++) {
      if (!node || typeof node !== 'object') return undefined;
      if (hasOwn(node, parts[i])) {
        node = node[parts[i]];
        continue;
      }
      var joined = parts.slice(i).join('.');
      if (hasOwn(node, joined)) return node[joined];
      return undefined;
    }
    return typeof node === 'string' ? node : undefined;
  }

  function interpolate(str, params) {
    if (typeof str !== 'string' || !params) return str;
    return str.replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m;
    });
  }

  var I18N = {
    langs: ['zh', 'en'],
    lang: 'zh',
    dict: DICT,

    set: function (lang) {
      I18N.lang = DICT[lang] ? lang : 'zh';
      if (typeof document !== 'undefined') {
        document.documentElement.lang = I18N.lang === 'zh' ? 'zh-CN' : 'en';
      }
      return I18N.lang;
    },

    /* t('level.title') or t('hand', {n: 2}); falls back to zh, then to the key. */
    t: function (key, params) {
      var v = lookup(I18N.lang, key);
      if (v === undefined) v = lookup('zh', key);
      if (v === undefined) return key;
      return interpolate(v, params);
    },

    /* Raw (uninterpolated) string, for templates the caller must format. */
    raw: function (key) {
      return lookup(I18N.lang, key) || lookup('zh', key) || key;
    },

    /* Level metadata comes from core.js, which stores both languages. */
    levelField: function (level, name) {
      var suffix = I18N.lang === 'en' ? 'En' : 'Zh';
      var key = name + suffix;
      if (level && level[key] !== undefined) return level[key];
      return level ? level[name + 'Zh'] : '';
    },

    reason: function (key, params) {
      var v = lookup(I18N.lang, 'reason.' + key);
      if (v === undefined) v = lookup('zh', 'reason.' + key);
      if (v === undefined) return key;
      return interpolate(v, params);
    },

    outcome: function (label) {
      return I18N.t('outcome.' + label);
    },

    /* Swap every [data-i18n] node in the document. */
    applyTo: function (root) {
      if (typeof document === 'undefined') return;
      var scope = root || document;
      Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n]'), function (el) {
        var v = lookup(I18N.lang, el.getAttribute('data-i18n'));
        if (typeof v === 'string') el.textContent = v;
      });
      Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-html]'), function (el) {
        var v = lookup(I18N.lang, el.getAttribute('data-i18n-html'));
        if (typeof v === 'string') el.innerHTML = v;
      });
      Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-title]'), function (el) {
        var v = lookup(I18N.lang, el.getAttribute('data-i18n-title'));
        if (typeof v === 'string') el.setAttribute('title', v);
      });
      Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-ph]'), function (el) {
        var v = lookup(I18N.lang, el.getAttribute('data-i18n-ph'));
        if (typeof v === 'string') el.setAttribute('placeholder', v);
      });
    },

    money: function (n) {
      var neg = n < 0;
      var s = Math.abs(Math.round(n)).toLocaleString(I18N.lang === 'zh' ? 'zh-CN' : 'en-US');
      return (neg ? '−' : '') + '$' + s;
    },

    signed: function (n) {
      if (n === 0) return I18N.money(0);
      var s = I18N.money(Math.abs(n));
      return (n > 0 ? '+' : '−') + s;
    }
  };

  global.I18N = I18N;
})(typeof window !== 'undefined' ? window : globalThis);
