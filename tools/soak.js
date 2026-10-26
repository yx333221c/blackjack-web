'use strict';
/*
 * Dev-only soak harness: drives many real rounds through the DOM the way a
 * player would (engine actions + the real animation queue) and asserts the UI
 * never drifts out of sync with the engine.
 *
 *   node tools/soak.js [rounds]
 *
 * The in-page driver lives in soak-page.js so it stays readable; __ROUNDS__ is
 * the only value injected from the command line.
 */

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, '..', '_shots');
var PORT = 9334;
var ROUNDS = parseInt(process.argv[2] || '120', 10);

var CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(fs.existsSync)[0];
if (!CHROME) throw new Error('no browser found');

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function getJSON(url) {
  return new Promise(function (res, rej) {
    http.get(url, function (r) {
      var b = '';
      r.on('data', function (c) { b += c; });
      r.on('end', function () {
        try { res(JSON.parse(b)); } catch (e) { rej(e); }
      });
    }).on('error', rej);
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
          return new Promise(function (r2, j2) {
            var id = ++idSeq;
            pending[id] = { r: r2, j: j2 };
            ws.send(JSON.stringify({ id: id, method: method, params: params || {}, sessionId: sessionId }));
          });
        },
        on: function (fn) { events.push(fn); }
      });
    };
    ws.onmessage = function (ev) {
      var m = JSON.parse(ev.data);
      if (m.id && pending[m.id]) {
        var p = pending[m.id];
        delete pending[m.id];
        if (m.error) p.j(new Error(m.error.message));
        else p.r(m.result);
        return;
      }
      events.forEach(function (fn) { fn(m); });
    };
    ws.onerror = function () { reject(new Error('websocket failed')); };
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  var profile = path.join(OUT, 'chrome-soak');
  fs.rmSync(profile, { recursive: true, force: true });

  var child = cp.spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1400,900', '--autoplay-policy=no-user-gesture-required', 'about:blank'
  ], { stdio: 'ignore' });

  var list = null;
  for (var i = 0; i < 60 && !list; i++) {
    await sleep(300);
    try {
      list = await getJSON('http://127.0.0.1:' + PORT + '/json/version');
    } catch (e) { /* not listening yet */ }
  }
  if (!list) {
    child.kill();
    throw new Error('chrome did not start on port ' + PORT);
  }

  var problems = [];
  var browser = await connect(list.webSocketDebuggerUrl);
  var t = await browser.send('Target.createTarget', { url: 'about:blank' });
  var attach = await browser.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  var ss = attach.sessionId;
  var send = function (m, p) { return browser.send(m, p, ss); };

  browser.on(function (m) {
    if (m.sessionId !== ss) return;
    if (m.method === 'Runtime.exceptionThrown') {
      var d = m.params.exceptionDetails;
      problems.push('exception: ' + ((d.exception || {}).description || d.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problems.push('console.error: ' + m.params.args.map(function (a) {
        return a.value === undefined ? (a.description || a.type) : a.value;
      }).join(' '));
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');

  async function ev(expr) {
    var r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      problems.push('eval failed: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
      return null;
    }
    return r.result && r.result.value;
  }

  var url = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?soak=' + Date.now();
  await send('Page.navigate', { url: url });
  await sleep(1600);

  var driver = fs.readFileSync(path.join(__dirname, 'soak-page.js'), 'utf8')
    .replace('__ROUNDS__', String(ROUNDS));
  var result = await ev(driver);

  console.log('soak(' + ROUNDS + '): ' + result);
  var parsed = result ? JSON.parse(result) : { settled: 0, bad: ['driver returned nothing'] };
  if (parsed.bad && parsed.bad.length) {
    console.log('\nDRIFT / ERRORS (' + parsed.bad.length + '):');
    parsed.bad.slice(0, 20).forEach(function (b) { console.log('  - ' + b); });
  }
  console.log('\n--- page problems (' + problems.length + ') ---');
  problems.slice(0, 20).forEach(function (p) { console.log('  ' + p); });

  await browser.send('Target.closeTarget', { targetId: t.targetId });
  browser.ws.close();
  child.kill();

  var fail = parsed.settled !== ROUNDS || (parsed.bad && parsed.bad.length) || problems.length;
  console.log(fail ? '\nSOAK FAILED' : '\nSOAK CLEAN');
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) {
  console.error('harness error: ' + e.message);
  process.exit(2);
});
