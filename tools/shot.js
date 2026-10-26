'use strict';
/*
 * Dev-only screenshot / console harness driven over the Chrome DevTools
 * Protocol. No dependencies: Node 21+ ships a global WebSocket.
 *
 *   node tools/shot.js                      # boot shot only
 *   node tools/shot.js flow                 # betting -> deal -> settle shots
 *   node tools/shot.js flow --lang=en       # same flow in English
 *
 * It launches a headless Chrome on a throwaway profile, waits for the page to
 * be idle, prints every console error / exception, and writes PNGs into
 * _shots/. Nothing here ships with the game.
 */

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, '..', '_shots');
var PORT = 9333;
var PROFILE = path.join(OUT, 'chrome-profile');

var CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findChrome() {
  for (var i = 0; i < CHROME_CANDIDATES.length; i++) {
    if (fs.existsSync(CHROME_CANDIDATES[i])) return CHROME_CANDIDATES[i];
  }
  throw new Error('no Chrome/Edge found');
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function getJSON(url) {
  return new Promise(function (resolve, reject) {
    require('http').get(url, function (res) {
      var buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

var idSeq = 0;

function connect(wsUrl) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket(wsUrl);
    var pending = {};
    var events = [];
    ws.onopen = function () {
      resolve({
        ws: ws,
        send: function (method, params, sessionId) {
          return new Promise(function (res2, rej) {
            var id = ++idSeq;
            pending[id] = { res: res2, rej: rej };
            ws.send(JSON.stringify({ id: id, method: method, params: params || {}, sessionId: sessionId }));
          });
        },
        on: function (fn) { events.push(fn); }
      });
    };
    ws.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      if (msg.id && pending[msg.id]) {
        var p = pending[msg.id];
        delete pending[msg.id];
        if (msg.error) p.rej(new Error(msg.error.message));
        else p.res(msg.result);
        return;
      }
      events.forEach(function (fn) { fn(msg); });
    };
    ws.onerror = function (e) { reject(new Error('ws error: ' + (e.message || 'closed'))); };
  });
}

var problems = [];

async function main() {
  var args = process.argv.slice(2);
  var doFlow = args.indexOf('flow') !== -1;
  var lang = (args.join(' ').match(/--lang=(\w+)/) || [])[1] || 'zh';
  var mode = args[0] === 'flow' ? 'flow' : 'boot';
  var url = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?v=' + Date.now();

  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });

  var chrome = findChrome();
  var child = cp.spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE,
    '--window-size=1500,940',
    '--force-device-scale-factor=1',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ], { stdio: 'ignore' });

  var list;
  for (var tries = 0; tries < 60; tries++) {
    await sleep(300);
    try {
      list = await getJSON('http://127.0.0.1:' + PORT + '/json/version');
      break;
    } catch (e) {
      /* not up yet */
    }
  }
  if (!list) {
    child.kill();
    throw new Error('chrome never came up on port ' + PORT);
  }

  var browser = await connect(list.webSocketDebuggerUrl);
  var target = await browser.send('Target.createTarget', { url: 'about:blank' });
  var attach = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  var session = attach.sessionId;

  function send(method, params) {
    return browser.send(method, params, session);
  }

  browser.on(function (msg) {
    if (msg.sessionId !== session) return;
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].indexOf(msg.params.type) >= 0) {
      problems.push('console.' + msg.params.type + ': ' +
        msg.params.args.map(function (a) { return a.value === undefined ? a.description || a.type : a.value; }).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      var d = msg.params.exceptionDetails;
      problems.push('exception: ' + (d.exception && d.exception.description || d.text));
    }
    if (msg.method === 'Log.entryAdded' && ['error', 'warning'].indexOf(msg.params.entry.level) >= 0) {
      problems.push('log.' + msg.params.entry.level + ': ' + msg.params.entry.text +
        (msg.params.entry.url ? ' @ ' + msg.params.entry.url : ''));
    }
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  async function evalJs(expression, awaitPromise) {
    var res = await send('Runtime.evaluate', {
      expression: expression,
      returnByValue: true,
      awaitPromise: !!awaitPromise
    });
    if (res.exceptionDetails) {
      problems.push('eval failed: ' + expression.slice(0, 80) + ' -> ' +
        (res.exceptionDetails.exception && res.exceptionDetails.exception.description || res.exceptionDetails.text));
      return null;
    }
    return res.result && res.result.value;
  }

  async function shot(name) {
    var img = await send('Page.captureScreenshot', { format: 'png' });
    var file = path.join(OUT, 'bj-' + name + '.png');
    fs.writeFileSync(file, Buffer.from(img.data, 'base64'));
    console.log('  wrote ' + path.basename(file));
  }

  await send('Page.navigate', { url: url });
  await sleep(1600);

  if (lang !== 'zh') {
    await evalJs("(function(){document.getElementById('btnSettings').click();" +
      "var s=document.getElementById('setLang');s.value='" + lang + "';" +
      "s.dispatchEvent(new Event('change'));})();");
    await sleep(400);
  }

  console.log('mode=' + mode + ' lang=' + lang);

  var sanity = await evalJs("JSON.stringify({" +
    "hasCore: !!window.BJCore, hasApp: !!window.BJApp, hasI18N: !!window.I18N, hasSound: !!window.Sound," +
    "levelCards: document.querySelectorAll('.level').length," +
    "chipButtons: document.querySelectorAll('.chip-btn').length," +
    "dealDisabled: document.getElementById('btnDeal').disabled," +
    "bankroll: window.BJApp.state.bankroll," +
    "readEmpty: document.querySelector('.read-empty') ? true : false," +
    "horizOverflow: document.documentElement.scrollWidth > window.innerWidth + 2" +
    "})");
  console.log('  boot: ' + sanity);
  await shot('01-boot');

  if (mode === 'flow') {
    // A card factory that produces *valid* engine cards: rank must be one of
    // RANKS and suit one of SUITS, otherwise the engine would compute NaN.
    await evalJs("window.__mk = function (rank, suit) { return { id: rank + suit, rank: rank, suit: suit, red: suit === 'H' || suit === 'D' }; };");

    // 1. bet
    await evalJs("document.getElementById('btnAllIn').click()");
    await sleep(300);
    await evalJs("document.querySelectorAll('.chip-btn')[2].click()");
    await sleep(260);
    await shot('02-bet');

    // 2. deal + player turn
    await evalJs("document.getElementById('btnDeal').click()");
    await sleep(2600);
    var p1 = await evalJs("JSON.stringify({phase:window.BJApp.state.phase,player:window.BJApp.state.hands[0].cards.map(function(c){return c.rank}),dealer:window.BJApp.state.dealer.map(function(c){return c.hidden?'??':c.rank}),hint:document.getElementById('hintValue').textContent})");
    console.log('  after deal: ' + p1);
    await shot('03-player');

    // 3. hit once, then stand so the dealer algorithm runs
    await evalJs("document.getElementById('btnHit').click()");
    await sleep(1400);
    await evalJs("document.getElementById('btnStand').click()");
    await sleep(3000);
    var p2 = await evalJs("JSON.stringify({phase:window.BJApp.state.phase,net:window.BJApp.state.roundNet,dealer:window.BJApp.state.dealer.map(function(c){return c.rank}),decisions:window.BJApp.state.log.length,banner:document.getElementById('banner').textContent,readText:document.getElementById('readCurrent').textContent.replace(/\\s+/g,' ').trim().slice(0,90),logItems:[].map.call(document.querySelectorAll('#readLog li'),function(li){return li.textContent.replace(/\\s+/g,' ').trim()})})");
    console.log('  after settle: ' + p2);
    await shot('04-settle');

    // 4. switch opponent to the shark and replay a scripted round so the dealer
    //    algorithm definitely runs and the read panel fills with EV text.
    await evalJs("document.querySelectorAll('.level')[3].click()");
    await sleep(220);
    await shot('05-level-shark');
    await evalJs("(function(){var s=BJApp.state;" +
      "s.phase='betting';s.pendingBet=0;s.bankroll=900;s.hands=[];s.dealer=[];s.log=[];" +
      "s.shoe.cards=[__mk('10','S'),__mk('7','D'),__mk('8','H'),__mk('4','C')," +
      "__mk('5','S'),__mk('6','H'),__mk('K','D'),__mk('2','C')];" +
      "s.shoe.index=0;s.shoe.cutIndex=99;BJApp.sync();})()");
    await sleep(260);
    await evalJs("document.querySelectorAll('.chip-btn')[2].click()");
    await sleep(200);
    await evalJs("document.getElementById('btnDeal').click()");
    await sleep(2400);
    await evalJs("document.getElementById('btnStand').click()");
    await sleep(3200);
    var p3 = await evalJs("JSON.stringify({phase:BJApp.state.phase,level:BJApp.state.level," +
      "reasons:BJApp.state.log.map(function(l){return l.reasonKey})," +
      "readText:document.getElementById('readCurrent').textContent.replace(/\\s+/g,' ').trim()," +
      "logLines:[].map.call(document.querySelectorAll('#readLog li'),function(li){return li.textContent.replace(/\\s+/g,' ').trim()})})");
    console.log('  shark round: ' + p3);
    await shot('06-shark-round');

    // 5. read panel collapsed
    await evalJs("document.getElementById('btnReadToggle').click()");
    await sleep(200);
    await shot('07-read-collapsed');
    await evalJs("document.getElementById('btnReadToggle').click()");

    // 6. settings sheet
    await evalJs("document.getElementById('btnSettings').click()");
    await sleep(320);
    await shot('08-settings');
    await evalJs("document.getElementById('btnCloseSettings').click()");
    await sleep(220);

    // 7. help sheet
    await evalJs("document.getElementById('btnHelp').click()");
    await sleep(320);
    await shot('09-help');
    await evalJs("document.getElementById('btnCloseHelp').click()");
    await sleep(200);

    // 8. insurance prompt: dealer shows an ace, player has no natural
    await evalJs("(function(){var s=window.BJApp.state;" +
      "s.shoe.cards=[__mk('9','C'),__mk('A','H'),__mk('7','S'),__mk('5','D'),__mk('K','S'),__mk('3','D')];" +
      "s.shoe.index=0;s.shoe.cutIndex=99;" +
      "s.phase='betting';s.pendingBet=100;s.bankroll=900;s.hands=[];s.dealer=[];BJApp.sync();})()");
    await sleep(300);
    await evalJs("document.getElementById('btnDeal').click()");
    await sleep(1500);
    var ins = await evalJs("JSON.stringify({phase:BJApp.state.phase,modalOpen:!document.getElementById('sheetInsurance').hidden," +
      "dealerTotal:document.getElementById('dealerTotal').textContent," +
      "playerTotal:document.querySelector('.hand .total').textContent," +
      "yesBtn:document.getElementById('btnInsYes').textContent," +
      "noteHasTags:document.querySelector('.sheet-note').innerHTML.indexOf('<b>')>=0})");
    console.log('  insurance: ' + ins);
    await shot('10-insurance');
    await evalJs("document.getElementById('btnInsNo').click()");
    await sleep(2600);

    // 9. split screen: 8,8 against a dealer 10
    await evalJs("(function(){var s=window.BJApp.state;" +
      "s.phase='betting';s.pendingBet=100;s.bankroll=900;s.hands=[];s.dealer=[];" +
      "s.shoe.cards=[__mk('8','S'),__mk('10','D'),__mk('8','H'),__mk('6','C')," +
      "__mk('3','D'),__mk('9','H'),__mk('K','C'),__mk('7','S')];" +
      "s.shoe.index=0;s.shoe.cutIndex=99;BJApp.sync();})()");
    await sleep(260);
    await evalJs("document.getElementById('btnDeal').click()");
    await sleep(2200);
    var canSplit = await evalJs("JSON.stringify({split:BJApp.state.phase==='player'&&BJCore.canSplit(BJApp.state)})");
    console.log('  split check: ' + canSplit);
    await evalJs("document.getElementById('btnSplit').click()");
    await sleep(1600);
    await shot('11-split');
    await evalJs("document.getElementById('btnStand').click();document.getElementById('btnStand').click()");
    await sleep(3600);
    await shot('12-split-settle');
    var splitState = await evalJs("JSON.stringify({bet:document.getElementById('betAmount').textContent,hands:BJApp.state.hands.map(function(h){return h.stake}),net:BJApp.state.roundNet})");
    console.log('  split money: ' + splitState);

    // 10. narrow viewport
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    });
    await sleep(500);
    await shot('13-mobile');
    await send('Emulation.clearDeviceMetricsOverride');

    // 11. persistence across reload
    var before = await evalJs("(function(){var raw=localStorage.getItem('blackjack-web.save.v1');var o=JSON.parse(raw||'{}');return JSON.stringify({bytes:(raw||'').length, cards:o.shoe&&o.shoe.cards?o.shoe.cards.length:0, index:o.shoe&&o.shoe.index, keys:Object.keys(o)});})()");
    console.log('  save: ' + before);
    await send('Page.navigate', { url: url });
    await sleep(1800);
    var after = await evalJs("JSON.stringify({bankroll:BJApp.state.bankroll,rounds:BJApp.state.stats.rounds,level:BJApp.state.level,phase:BJApp.state.phase})");
    console.log('  after reload: ' + after);
    await shot('14-reloaded');

    var overflow = await evalJs("JSON.stringify({sw:document.documentElement.scrollWidth,iw:window.innerWidth,bh:document.body.scrollHeight,ih:window.innerHeight})");
    console.log('  geometry: ' + overflow);
  }

  console.log('\n--- console problems (' + problems.length + ') ---');
  problems.slice(0, 40).forEach(function (p) { console.log('  ' + p); });

  await browser.send('Target.closeTarget', { targetId: target.targetId });
  browser.ws.close();
  child.kill();
  process.exit(problems.length ? 1 : 0);
}

main().catch(function (e) {
  console.error('harness error: ' + e.message);
  process.exit(2);
});
