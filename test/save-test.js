'use strict';
/*
 * Portable save-code tests. Run with: node test/save-test.js
 */

var path = require('path');
var core = require(path.join(__dirname, '..', 'js', 'core.js'));
var save = require(path.join(__dirname, '..', 'js', 'save.js'));

save.setCore(core);

var passed = 0;
var failures = [];

function ok(cond, label) {
  if (cond) passed++;
  else { failures.push(label); console.error('FAIL  ' + label); }
}
function eq(a, b, label) {
  ok(a === b, label + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}

function sampleGame(opts) {
  var g = core.createGame(Object.assign({ seed: 4242, bankroll: 1337, level: 'shark' }, opts || {}));
  core.placeBet(g, 75);
  core.startRound(g);
  return g;
}

console.log('\n— base64url —');

var bytes = [0, 1, 127, 128, 255, 63, 64, 200];
var enc = save.bytesToB64(bytes);
ok(/^[A-Za-z0-9\-_]+$/.test(enc), 'encoded text is url-safe (no + / = )');
eq(JSON.stringify(save.b64ToBytes(enc)), JSON.stringify(bytes), 'base64url round-trips');
[0, 1, 2].forEach(function (rem) {
  var b = [10, 20, 30, 40].slice(0, 4 - rem);
  eq(JSON.stringify(save.b64ToBytes(save.bytesToB64(b))), JSON.stringify(b), 'base64 handles a ' + b.length + '-byte tail');
});
eq(save.b64ToBytes('!!!').length, 0, 'stray characters are dropped, not decoded');

console.log('\n— utf-8 —');

['abc', '中文', '🂡 ace', 'a中b🎩c'].forEach(function (str) {
  eq(save.fromUtf8(save.utf8(str)), str, 'utf-8 round-trip: ' + JSON.stringify(str));
});
eq(save.utf8('a').length, 1, 'ascii is one byte');
eq(save.utf8('中').length, 3, 'cjk is three bytes');
eq(save.utf8('🂡').length, 4, 'astral is four bytes');

console.log('\n— crc32 —');

eq(save.crc32([]), 0, 'crc of nothing is 0');
eq(save.crc32(save.utf8('123456789')), 0xcbf43926, 'crc32 matches the check value for "123456789"');
ok(save.crc32(save.utf8('a')) !== save.crc32(save.utf8('b')), 'crc distinguishes inputs');

console.log('\n— shoe packing —');

var shoe = core.buildShoe({ decks: 6 }, core.makeRng(7));
var packed = save.packShoe(shoe.cards);
eq(packed.length, 312, 'a 6-deck shoe packs to 312 characters');
var unpacked = save.unpackShoe(packed);
eq(unpacked.length, shoe.cards.length, 'unpacked shoe has every card');
var same = shoe.cards.every(function (c, i) {
  return unpacked[i].rank === c.rank && unpacked[i].suit === c.suit && unpacked[i].red === c.red;
});
ok(same, 'packing preserves the exact card order');
var ids = {};
var dup = unpacked.filter(function (c) { return ids[c.id] ? true : (ids[c.id] = true, false); });
eq(dup.length, 0, 'unpacked card ids stay unique across the shoe');
for (var d = 0; d < 6; d++) {
  eq(unpacked.filter(function (c) { return c.id.charAt(0) == d; }).length, 52, 'deck ' + d + ' holds 52 cards');
}
ok(packed.length * 1 < JSON.stringify(shoe.cards).length / 20, 'packed form is far smaller than JSON');

console.log('\n— encode / decode —');

var g = sampleGame();
var code = save.encode(g);
ok(code.indexOf('BJ1.') === 0, 'code carries the magic prefix');
ok(/^[A-Za-z0-9\-_.]+$/.test(code), 'code is safe to paste anywhere');
console.log('  code length: ' + code.length + ' chars (JSON save was ' +
  JSON.stringify(core.serialize(g)).length + ' bytes)');

var out = save.decode(code);
ok(out.ok, 'decodes without error');
eq(out.save.bankroll, g.bankroll, 'bankroll survives the round trip');
eq(out.save.level, 'shark', 'level survives the round trip');
eq(out.save.stats.rounds, g.stats.rounds, 'stats survive the round trip');
eq(out.save.shoe.cards.length, 312, 'the whole shoe comes back');
eq(out.save.shoe.index, g.shoe.index, 'the shoe position comes back');
eq(out.save.rules.decks, 6, 'rules come back');

// The decoded object must be usable by deserialize() as-is.
var restored = core.deserialize(out.save);
eq(restored.bankroll, g.bankroll, 'deserialize() accepts the imported save');
eq(restored.level, 'shark', 'imported level applies');
eq(restored.shoe.cards.length, 312, 'imported shoe is live');
eq(core.shoeRemaining(restored.shoe), core.shoeRemaining(g.shoe), 'imported shoe has the same cards left');
eq(restored.shoe.cards[restored.shoe.index].rank, g.shoe.cards[g.shoe.index].rank, 'the next card to be dealt matches');
eq(restored.phase, core.PHASE.BETTING, 'an import never resumes mid-round');

console.log('\n— passphrase —');

var secret = save.encode(g, 'my-key');
ok(save.decode(secret, 'my-key').ok, 'the right key opens it');
var wrong = save.decode(secret, 'other-key');
ok(!wrong.ok, 'a wrong key does not open it');
eq(wrong.error, 'checksum', 'a wrong key is reported as a checksum failure, not garbage');
ok(save.encode(g, 'my-key') !== save.encode(g, 'other'), 'different keys produce different text');
ok(save.encode(g).indexOf(save.encode(g, 'x').slice(4, 24)) === -1, 'the default key is not the empty key');

console.log('\n— tamper evidence —');

var base = save.encode(sampleGame());
function mutate(str, fn) {
  var arr = str.split('');
  var i = str.length - 8;
  arr[i] = fn(str.charAt(i));
  return arr.join('');
}
ok(!save.decode(mutate(base, function (c) { return c === 'A' ? 'B' : 'A'; })).ok, 'a flipped character is rejected');
ok(save.decode(base.slice(0, -4)).error, 'a truncated code is rejected');
eq(save.decode('no-dot-here').error, 'format', 'a code with no separator is rejected');
eq(save.decode('XXX.' + base.slice(4)).error, 'magic', 'a foreign prefix is rejected');
eq(save.decode('').error, 'empty', 'an empty string is rejected');
eq(save.decode('   ').error, 'empty', 'whitespace is rejected');
eq(save.decode('BJ1.%%%').error, 'format', 'non-base64 noise is rejected');

// A code that decodes but carries nonsense must not crash the loader.
var forged = save.encode(sampleGame());
var forgedOut = save.decode(forged);
forgedOut.save.bankroll = 'not-a-number';
ok(core.deserialize(forgedOut.save).bankroll >= 0, 'a forged bankroll is refused by the loader');
forgedOut.save.shoe.cards = [{ rank: 'Ah', suit: 'H' }];
ok(core.deserialize(forgedOut.save).shoe.cards.length === 312 ||
  core.deserialize(forgedOut.save).shoe.cards.length % 13 === 0, 'a forged shoe falls back to a real one');

console.log('\n— summary —');

ok(save.summary(out.save).length > 0, 'summary is non-empty');
ok(save.summary(out.save).indexOf('$') >= 0 && /\d/.test(save.summary(out.save)),
  'summary mentions the bankroll: ' + save.summary(out.save));
eq(save.summary(null), '', 'summary(null) is empty');

console.log('\n— every rule set round-trips —');

[1, 2, 4, 6, 8].forEach(function (decks) {
  var gg = sampleGame({ rules: { decks: decks } });
  var rt = save.decode(save.encode(gg));
  ok(rt.ok, decks + ' decks encodes');
  eq(rt.save.shoe.cards.length, decks * 52, decks + ' decks keeps the right shoe size');
  var applied = core.deserialize(rt.save);
  eq(applied.rules.decks, decks, decks + ' decks restores the rule');
  eq(core.shoeRemaining(applied.shoe), decks * 52 - gg.shoe.index, decks + ' decks restores the position');
});

console.log('\n— mid-round export keeps every chip —');

// Chips on the felt must not vanish when exporting during a round.
var live = sampleGame();
var walletBefore = live.bankroll;
eq(live.bankroll, 1337 - 75, 'the stake has left the wallet mid-round');
var midCode = save.encode(core.serialize(live));
var mid = save.decode(midCode);
ok(mid.ok, 'a mid-round code decodes');
eq(mid.save.bankroll, 1337, 'exporting mid-round refunds the on-felt stake');
ok(mid.save.bankroll > walletBefore, 'the imported wallet is whole, not short');
eq(mid.save.shoe.index, live.shoe.index, 'the dealt position is still captured');

// A split with money spread over two hands is also fully accounted for.
var splitG = core.createGame({ seed: 8181, bankroll: 400 });
splitG.shoe.cards = [
  { id: '0S8', rank: '8', suit: 'S', red: false },
  { id: '1D10', rank: '10', suit: 'D', red: true },
  { id: '2H8', rank: '8', suit: 'H', red: true },
  { id: '3C6', rank: '6', suit: 'C', red: false },
  { id: '4D3', rank: '3', suit: 'D', red: true },
  { id: '5HK', rank: 'K', suit: 'H', red: true },
  { id: '6CS', rank: '9', suit: 'C', red: false },
  { id: '7S7', rank: '7', suit: 'S', red: false }
].concat(splitG.shoe.cards);
splitG.shoe.index = 0;
splitG.shoe.cutIndex = 999;
core.placeBet(splitG, 100);
core.startRound(splitG);
core.split(splitG);
eq(splitG.bankroll, 200, 'both split hands are staked (400 - 100 - 100)');
var splitSave = core.serialize(splitG);
eq(splitSave.bankroll, 400, 'serializing refunds both committed stakes');
var splitCode = save.decode(save.encode(splitSave));
ok(splitCode.ok, 'a split-round code decodes');
eq(splitCode.save.bankroll, 400, 'no chips are lost across a split export');

// A short, non-multiple-of-52 shoe is legal engine state (draw() reshuffles
// when exhausted), so the format must not reject it.
var tiny = core.createGame({ seed: 3, bankroll: 50 });
tiny.shoe.cards = core.buildShoe({ decks: 1 }, core.makeRng(4)).cards.slice(0, 8);
tiny.shoe.cutIndex = 8;
var tinyOut = save.decode(save.encode(core.serialize(tiny)));
ok(tinyOut.ok, 'a 8-card shoe round-trips: ' + (tinyOut.error || 'ok'));
eq(tinyOut.save.shoe.cards.length, 8, 'the short shoe keeps its exact length');

console.log('\n================================');
console.log('  ' + passed + ' assertions passed');
if (failures.length) {
  console.log('  ' + failures.length + ' FAILED');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
console.log('  all good');
