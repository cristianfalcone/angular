/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import * as i18n from './i18n_ast';

export function digestMessage(message: i18n.Message): string {
  return sha1(serializeNodes(message.nodes).join('') + `[${message.meaning}]`);
}

/**
 * Serialize the i18n ast to something xml-like in order to generate an UID.
 *
 * The visitor is also used in the i18n parser tests
 *
 * @internal
 */
class _SerializerVisitor implements i18n.Visitor {
  visitText(text: i18n.Text, context: any): any { return text.value; }

  visitContainer(container: i18n.Container, context: any): any {
    return `[${container.children.map(child => child.visit(this)).join(', ')}]`;
  }

  visitIcu(icu: i18n.Icu, context: any): any {
    const strCases =
        Object.keys(icu.cases).map((k: string) => `${k} {${icu.cases[k].visit(this)}}`);
    return `{${icu.expression}, ${icu.type}, ${strCases.join(', ')}}`;
  }

  visitTagPlaceholder(ph: i18n.TagPlaceholder, context: any): any {
    return ph.isVoid ?
        `<ph tag name="${ph.startName}"/>` :
        `<ph tag name="${ph.startName}">${ph.children.map(child => child.visit(this)).join(', ')}</ph name="${ph.closeName}">`;
  }

  visitPlaceholder(ph: i18n.Placeholder, context: any): any {
    return `<ph name="${ph.name}">${ph.value}</ph>`;
  }

  visitIcuPlaceholder(ph: i18n.IcuPlaceholder, context?: any): any {
    return `<ph icu name="${ph.name}">${ph.value.visit(this)}</ph>`;
  }
}

const serializerVisitor = new _SerializerVisitor();

export function serializeNodes(nodes: i18n.Node[]): string[] {
  return nodes.map(a => a.visit(serializerVisitor, null));
}

/**
 * Compute the SHA1 of the given string
 *
 * see http://csrc.nist.gov/publications/fips/fips180-4/fips-180-4.pdf
 *
 * WARNING: this function has not been designed not tested with security in mind.
 *          DO NOT USE IT IN A SECURITY SENSITIVE CONTEXT.
 */
export function sha1(str: string): string {
  const utf8 = utf8Encode(str);
  const words32 = stringToWords32(utf8, Endian.Big);
  const len = utf8.length * 8;

  const w = new Array(80);
  let [a, b, c, d, e]: number[] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

  words32[len >> 5] |= 0x80 << (24 - len % 32);
  words32[((len + 64 >> 9) << 4) + 15] = len;

  for (let i = 0; i < words32.length; i += 16) {
    const [h0, h1, h2, h3, h4]: number[] = [a, b, c, d, e];

    for (let j = 0; j < 80; j++) {
      if (j < 16) {
        w[j] = words32[i + j];
      } else {
        w[j] = rol32(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      }

      const [f, k] = fk(j, b, c, d);
      const temp = [rol32(a, 5), f, e, k, w[j]].reduce(add32);
      [e, d, c, b, a] = [d, c, rol32(b, 30), a, temp];
    }

    [a, b, c, d, e] = [add32(a, h0), add32(b, h1), add32(c, h2), add32(d, h3), add32(e, h4)];
  }

  return byteStringToHexString(words32ToByteString([a, b, c, d, e]));
}

function fk(index: number, b: number, c: number, d: number): [number, number] {
  if (index < 20) {
    return [(b & c) | (~b & d), 0x5a827999];
  }

  if (index < 40) {
    return [b ^ c ^ d, 0x6ed9eba1];
  }

  if (index < 60) {
    return [(b & c) | (b & d) | (c & d), 0x8f1bbcdc];
  }

  return [b ^ c ^ d, 0xca62c1d6];
}

/**
 * Compute the fingerprint of the given string
 *
 * The output is 64 bit number encoded as a decimal string
 *
 * based on:
 * https://github.com/google/closure-compiler/blob/master/src/com/google/javascript/jscomp/GoogleJsMessageIdGenerator.java
 */
export function fingerprint(str: string): string {
  const utf8 = utf8Encode(str);

  let [hi, lo] = [hash32(utf8, 0), hash32(utf8, 102072)];

  if (hi == 0 && (lo == 0 || lo == 1)) {
    hi = hi ^ 0x130f9bef;
    lo = lo ^ -0x6b5f56d8;
  }

  hi = hi & 0x7fffffff;

  return byteStringToDecString(words32ToByteString([hi, lo]));
}

function hash32(str: string, c: number): number {
  let [a, b] = [0x9e3779b9, 0x9e3779b9];
  let i: number;

  const len = str.length;

  for (i = 0; i + 12 <= len; i += 12) {
    a = add32(a, wordAt(str, i, Endian.Little));
    b = add32(b, wordAt(str, i + 4, Endian.Little));
    c = add32(c, wordAt(str, i + 8, Endian.Little));
    [a, b, c] = mix([a, b, c]);
  }

  a = add32(a, wordAt(str, i, Endian.Little));
  b = add32(b, wordAt(str, i + 4, Endian.Little));
  // the first byte of c is reserved for the length
  c = add32(c, len);
  c = add32(c, wordAt(str, i + 8, Endian.Little) << 8);

  return mix([a, b, c])[2];
}

// clang-format off
function mix([a, b, c]: [number, number, number]): [number, number, number] {
  a = sub32(a, b); a = sub32(a, c); a ^= c >>> 13;
  b = sub32(b, c); b = sub32(b, a); b ^= a << 8;
  c = sub32(c, a); c = sub32(c, b); c ^= b >>> 13;
  a = sub32(a, b); a = sub32(a, c); a ^= c >>> 12;
  b = sub32(b, c); b = sub32(b, a); b ^= a << 16;
  c = sub32(c, a); c = sub32(c, b); c ^= b >>> 5;
  a = sub32(a, b); a = sub32(a, c); a ^= c >>> 3;
  b = sub32(b, c); b = sub32(b, a); b ^= a << 10;
  c = sub32(c, a); c = sub32(c, b); c ^= b >>> 15;
  return [a, b, c];
}
// clang-format on

// Utils

enum Endian {
  Little,
  Big,
}

function utf8Encode(str: string): string {
  let encoded: string = '';

  for (let index = 0; index < str.length; index++) {
    const codePoint = decodeSurrogatePairs(str, index);

    if (codePoint <= 0x7f) {
      encoded += String.fromCharCode(codePoint);
    } else if (codePoint <= 0x7ff) {
      encoded += String.fromCharCode(0xc0 | codePoint >>> 6, 0x80 | codePoint & 0x3f);
    } else if (codePoint <= 0xffff) {
      encoded += String.fromCharCode(
          0xe0 | codePoint >>> 12, 0x80 | codePoint >>> 6 & 0x3f, 0x80 | codePoint & 0x3f);
    } else if (codePoint <= 0x1fffff) {
      encoded += String.fromCharCode(
          0xf0 | codePoint >>> 18, 0x80 | codePoint >>> 12 & 0x3f, 0x80 | codePoint >>> 6 & 0x3f,
          0x80 | codePoint & 0x3f);
    }
  }

  return encoded;
}

// see https://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
function decodeSurrogatePairs(str: string, index: number): number {
  if (index < 0 || index >= str.length) {
    throw new Error(`index=${index} is out of range in "${str}"`);
  }

  const high = str.charCodeAt(index);

  if (high >= 0xd800 && high <= 0xdfff && str.length > index + 1) {
    const low = byteAt(str, index + 1);
    if (low >= 0xdc00 && low <= 0xdfff) {
      return (high - 0xd800) * 0x400 + low - 0xdc00 + 0x10000;
    }
  }

  return high;
}

function add32(a: number, b: number): number {
  const low = (a & 0xffff) + (b & 0xffff);
  const high = (a >> 16) + (b >> 16) + (low >> 16);
  return (high << 16) | (low & 0xffff);
}

function sub32(a: number, b: number): number {
  const low = (a & 0xffff) - (b & 0xffff);
  const high = (a >> 16) - (b >> 16) + (low >> 16);
  return (high << 16) | (low & 0xffff);
}

// Rotate a 32b number left `count` position
function rol32(a: number, count: number): number {
  return (a << count) | (a >>> (32 - count));
}

function stringToWords32(str: string, endian: Endian): number[] {
  const words32 = Array((str.length + 3) >>> 2);

  for (let i = 0; i < words32.length; i++) {
    words32[i] = wordAt(str, i * 4, endian);
  }

  return words32;
}

function byteAt(str: string, index: number): number {
  return index >= str.length ? 0 : str.charCodeAt(index) & 0xff;
}

function wordAt(str: string, index: number, endian: Endian): number {
  let word = 0;
  if (endian === Endian.Big) {
    for (let i = 0; i < 4; i++) {
      word += byteAt(str, index + i) << (24 - 8 * i);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      word += byteAt(str, index + i) << 8 * i;
    }
  }
  return word;
}

function words32ToByteString(words32: number[]): string {
  return words32.reduce((str, word) => str + word32ToByteString(word), '');
}

function word32ToByteString(word: number): string {
  let str = '';
  for (let i = 0; i < 4; i++) {
    str += String.fromCharCode((word >>> 8 * (3 - i)) & 0xff);
  }
  return str;
}

function byteStringToHexString(str: string): string {
  let hex: string = '';
  for (let i = 0; i < str.length; i++) {
    const b = byteAt(str, i);
    hex += (b >>> 4).toString(16) + (b & 0x0f).toString(16);
  }
  return hex.toLowerCase();
}

// based on http://www.danvk.org/hex2dec.html (JS can not handle more than 56b)
function byteStringToDecString(str: string): string {
  let decimal = '';
  let toThePower = '1';

  for (let i = str.length - 1; i >= 0; i--) {
    decimal = addBigInt(decimal, numberTimesBigInt(byteAt(str, i), toThePower));
    toThePower = numberTimesBigInt(256, toThePower);
  }

  return decimal.split('').reverse().join('');
}

function addBigInt(x: string, y: string): string {
  let sum = '';
  const len = Math.max(x.length, y.length);
  for (let i = 0, carry = 0; i < len || carry; i++) {
    const tmpSum = carry + +(x[i] || 0) + +(y[i] || 0);
    if (tmpSum >= 10) {
      carry = 1;
      sum += tmpSum - 10;
    } else {
      carry = 0;
      sum += tmpSum;
    }
  }

  return sum;
}

function numberTimesBigInt(num: number, b: string): string {
  let product = '';
  let bToThePower = b;
  for (; num !== 0; num = num >>> 1) {
    if (num & 1) product = addBigInt(product, bToThePower);
    bToThePower = addBigInt(bToThePower, bToThePower);
  }
  return product;
}
