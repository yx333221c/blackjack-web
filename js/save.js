/*
 * Portable save codes.
 *
 * WHAT THIS IS: a compact, transferable, tamper-evident text form of a save.
 *   payload -> JSON -> UTF-8 bytes -> XOR keystream -> base64url, with a
 *   CRC32 of the plaintext prepended so a corrupted or edited code is caught
 *   instead of loading garbage.
 *
 * WHAT THIS IS NOT: encryption. There is no key hierarchy, no KDF and no
 * authenticated cipher — the XOR mask only stops casual peeking and casual
 * editing. Anyone who reads this file can undo it. It is labelled as
 * "obfuscated, not encrypted" in the UI, and that is the honest description.
 *
 * The shoe is stored as 6-bit indices into the canonical 52-card order
 * (suit-major, rank-minor), so 312 cards cost 234 bytes instead of ~14 KB of
 * JSON. That keeps the whole code short enough to paste into a chat.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.BJSave = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var MAGIC = 'BJ1';
  var CORE = null;
  function setCore(core) { CORE = core; }

  var DEFAULT_KEY = 'blackjack-web.save.v1';

  /* ---------------- base64url ---------------- */

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B64IDX = {};
  for (var b = 0; b < B64.length; b++) B64IDX[B64.charAt(b)] = b;

  function bytesToB64(bytes) {
    var out = '';
    var i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) +
        B64.charAt((n >> 6) & 63) + B64.charAt(n & 63);
    }
    var rem = bytes.length - i;
    if (rem === 1) {
      var n1 = bytes[i] << 16;
      out += B64.charAt((n1 >> 18) & 63) + B64.charAt((n1 >> 12) & 63);
    } else if (rem === 2) {
      var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64.charAt((n2 >> 18) & 63) + B64.charAt((n2 >> 12) & 63) + B64.charAt((n2 >> 6) & 63);
    }
    return out;
  }

  function b64ToBytes(str) {
    var clean = String(str).replace(/[^A-Za-z0-9\-_]/g, '');
    var bytes = [];
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < clean.length; i++) {
      var v = B64IDX[clean.charAt(i)];
      if (v === undefined) return null;
      buffer = (buffer << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 255);
      }
    }
    return bytes;
  }

  /* ---------------- utf-8 ---------------- */

  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
        var lo = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function fromUtf8(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length;) {
      var c = bytes[i++];
      if (c < 0x80) {
        s += String.fromCharCode(c);
      } else if (c >= 0xf0 && i + 2 < bytes.length) {
        var cp = ((c & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
        cp -= 0x10000;
        s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else if (c >= 0xe0 && i + 1 < bytes.length) {
        s += String.fromCharCode(((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
      } else if (i < bytes.length) {
        s += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
      }
    }
    return s;
  }

  /* ---------------- crc32 ---------------- */

  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
    return CRC_TABLE;
  }

  function crc32(bytes) {
    var table = crcTable();
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 255];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /* ---------------- keystream ---------------- */

  // FNV-1a over the passphrase, then xorshift32 as the stream generator.
  function keystream(length, passphrase) {
    var h = 0x811c9dc5;
    var src = String(passphrase || DEFAULT_KEY);
    for (var i = 0; i < src.length; i++) {
      h ^= src.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    var out = new Array(length);
    for (var j = 0; j < length; j++) {
      h ^= (h << 13); h >>>= 0;
      h ^= (h >>> 17);
      h ^= (h << 5); h >>>= 0;
      out[j] = h & 255;
    }
    return out;
  }

  function xorMask(bytes, pass) {
    var ks = keystream(bytes.length, pass);
    var out = new Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) out[i] = (bytes[i] ^ ks[i]) & 255;
    return out;
  }

  /* ---------------- shoe packing ---------------- */

  function canonicalOrder() {
    if (!CORE) throw new Error('BJSave.setCore() was not called');
    var list = [];
    for (var s = 0; s < CORE.SUITS.length; s++) {
      for (var r = 0; r < CORE.RANKS.length; r++) list.push(CORE.SUITS[s] + CORE.RANKS[r]);
    }
    return list;
  }

  // A real bit stream: symbols are 6 bits wide but bytes are 8, so they must
  // be packed across byte boundaries (312 cards -> 234 bytes, not 312).
  function BitWriter() {
    this.bits = [];
  }
  BitWriter.prototype.write = function (value, width) {
    for (var i = width - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  };
  BitWriter.prototype.bytes = function () {
    var out = [];
    var acc = 0;
    var n = 0;
    for (var i = 0; i < this.bits.length; i++) {
      acc = (acc << 1) | this.bits[i];
      if (++n === 8) {
        out.push(acc);
        acc = 0;
        n = 0;
      }
    }
    if (n) out.push((acc << (8 - n)) & 255); // zero-pad the tail
    return out;
  };

  function BitReader(bytes) {
    this.bits = [];
    for (var i = 0; i < bytes.length; i++) {
      for (var b = 7; b >= 0; b--) this.bits.push((bytes[i] >> b) & 1);
    }
    this.pos = 0;
  }
  BitReader.prototype.read = function (width) {
    var v = 0;
    for (var i = 0; i < width; i++) {
      if (this.pos >= this.bits.length) return null;
      v = (v << 1) | this.bits[this.pos++];
    }
    return v;
  };

  // 6 bits per card: 52 possible values fit, so a 6-deck shoe is 234 bytes.
  function packShoe(cards) {
    var order = canonicalOrder();
    var lookup = {};
    for (var i = 0; i < order.length; i++) lookup[order[i]] = i;
    var w = new BitWriter();
    for (var c = 0; c < cards.length; c++) {
      var key = cards[c].suit + cards[c].rank;
      var v = lookup[key];
      if (v === undefined) throw new Error('unencodable card ' + key);
      w.write(v, 6);
    }
    return bytesToB64(w.bytes());
  }

  /*
   * The engine's card ids embed a deck index (0S A, 1SA, ...), but shuffling
   * destroys any positional link to it. Ids are only used as DOM keys and for
   * uniqueness, so on the way back out we relabel by occurrence: the k-th copy
   * of a given suit+rank belongs to deck k. That is deterministic, keeps ids
   * unique, and preserves the exact rank/suit order of the shoe.
   */
  function unpackShoe(packed, expectedCount) {
    var order = canonicalOrder();
    var bytes = b64ToBytes(packed);
    if (!bytes) return null;
    var r = new BitReader(bytes);
    var seen = {};
    var cards = [];
    var limit = expectedCount > 0 ? expectedCount : Infinity;
    while (cards.length < limit) {
      var n = r.read(6);
      if (n === null) break;
      if (n >= order.length) return null;
      var suit = order[n].charAt(0);
      var rank = order[n].slice(1);
      var deck = seen[n] || 0;
      seen[n] = deck + 1;
      cards.push({
        id: deck + suit + rank,
        rank: rank,
        suit: suit,
        red: suit === 'H' || suit === 'D'
      });
    }
    return cards;
  }

  /* ---------------- payload <-> code ---------------- */

  /*
   * shapeOf accepts the output of core.serialize(), not the live state, so an
   * export taken mid-round folds the on-felt stake back into the bankroll the
   * same way a reload does. Encoding straight from `state` would silently
   * lose every chip currently on the table.
   */
  function shapeOf(save) {
    var shoe = save.shoe || {};
    var cards = shoe.cards || [];
    return {
      bankroll: save.bankroll,
      level: save.level,
      rules: save.rules,
      stats: save.stats,
      lastBet: save.lastBet || 0,
      pendingBet: save.pendingBet || 0,
      shoeIndex: shoe.index || 0,
      shoeCount: cards.length,
      shoe: packShoe(cards)
    };
  }

  /*
   * encode(save, passphrase) -> "BJ1.xxxx", where `save` is core.serialize().
   * Throws only on a structurally impossible state; anything else is data.
   */
  function encode(save, passphrase) {
    var payload = { v: 1, t: 'bj1', s: shapeOf(save) };
    var plain = utf8(JSON.stringify(payload));
    var crc = crc32(plain);
    var body = [
      (crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255
    ].concat(xorMask(plain, passphrase));
    return MAGIC + '.' + bytesToB64(body);
  }

  /*
   * decode(text, passphrase) -> { ok, save?, error? }
   * `save` is the plain object shape deserialize() already understands.
   */
  function decode(text, passphrase) {
    var raw = String(text || '').trim();
    if (!raw) return { ok: false, error: 'empty' };
    var dot = raw.indexOf('.');
    if (dot < 0) return { ok: false, error: 'format' };
    if (raw.slice(0, dot) !== MAGIC) return { ok: false, error: 'magic' };
    var body = b64ToBytes(raw.slice(dot + 1));
    if (!body || body.length < 5) return { ok: false, error: 'format' };
    var crc = ((body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]) >>> 0;
    var plain = xorMask(body.slice(4), passphrase);
    var json = fromUtf8(plain);
    if (crc32(plain) !== crc) return { ok: false, error: 'checksum' };
    var payload;
    try {
      payload = JSON.parse(json);
    } catch (e) {
      return { ok: false, error: 'json' };
    }
    if (!payload || payload.t !== 'bj1' || !payload.s) return { ok: false, error: 'shape' };
    var s = payload.s;
    if (typeof s.shoe !== 'string') return { ok: false, error: 'shape' };
    // The bit stream is zero-padded, so the reader needs the exact card count
    // or the padding would decode as a phantom card. The count is
    // attacker-editable, so it is bounded and the decoded length must match.
    // No "whole decks" rule: the engine reshuffles an exhausted shoe anyway,
    // so a short shoe is legal state and a file format should not enforce a
    // policy the game itself does not.
    var count = Math.round(Number(s.shoeCount));
    if (!isFinite(count) || count < 1 || count > 52 * 12) return { ok: false, error: 'shoe' };
    var cards = unpackShoe(s.shoe, count);
    if (!cards || cards.length !== count) return { ok: false, error: 'shoe' };
    return {
      ok: true,
      save: {
        version: 1,
        level: s.level,
        bankroll: s.bankroll,
        rules: s.rules,
        stats: s.stats,
        lastBet: s.lastBet,
        pendingBet: s.pendingBet,
        shoe: {
          cards: cards,
          index: s.shoeIndex,
          decks: Math.max(1, Math.round(cards.length / 52)),
          penetration: (s.rules && s.rules.penetration) || 0.7,
          cutIndex: Math.floor(cards.length * ((s.rules && s.rules.penetration) || 0.7))
        }
      }
    };
  }

  /* ---------------- human summary ---------------- */

  // A short line to show before importing, so the player knows what they are
  // about to overwrite.
  function summary(save) {
    if (!save) return '';
    var lvl = CORE ? CORE.levelById(save.level) : null;
    var name = lvl ? (lvl.zh || lvl.id) : String(save.level || '?');
    var st = save.stats || {};
    return [
      name,
      '$' + (save.bankroll || 0),
      (st.rounds || 0) + ' 局'
    ].join(' · ');
  }

  return {
    MAGIC: MAGIC,
    setCore: setCore,
    encode: encode,
    decode: decode,
    summary: summary,
    packShoe: packShoe,
    unpackShoe: unpackShoe,
    crc32: crc32,
    bytesToB64: bytesToB64,
    b64ToBytes: b64ToBytes,
    utf8: utf8,
    fromUtf8: fromUtf8
  };
});
