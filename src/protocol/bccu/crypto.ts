import aesjs from 'aes-js';
import {sha512} from 'js-sha512';

/**
 * The BCCU crypto, reimplemented from the Navigator Gen3 project
 * (github.com/Pavanayi1/KTM-Nav-GEN3, MIT), which derived it from two
 * independent implementations of the same protocol.
 *
 * Two planes, and they are framed differently:
 *
 * - **Control** (the handshake on AUTH_REQUEST / AUTH_REPLY) is a single raw
 *   AES-CBC block, 16 bytes, with no wrapper.
 * - **Data** (everything drawn on the display) is wrapped by `frame()` first:
 *   a random 16-byte prefix, the payload, random filler, and a trailing pad
 *   length — then encrypted.
 *
 * Doing it in JavaScript rather than natively is deliberate: it is the same on
 * both platforms, so unlike the old serial link this one can work on iOS.
 */

/** Random bytes. Backed by `react-native-get-random-values` on device. */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const source = (globalThis as {crypto?: {getRandomValues?: (a: Uint8Array) => void}}).crypto;
  if (source?.getRandomValues) {
    source.getRandomValues(out);
    return out;
  }
  // Only reachable if the polyfill is missing; a predictable nonce would
  // weaken the session, so refuse rather than quietly using Math.random.
  throw new Error('No secure random source available for the dashboard handshake');
}

export function aes(
  input: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  encrypt: boolean,
): Uint8Array {
  if (input.length % 16 !== 0) {
    throw new Error(`AES-CBC needs whole blocks, got ${input.length} bytes`);
  }
  // A CBC object carries its chaining state, so it cannot be reused.
  const cbc = new aesjs.ModeOfOperation.cbc(Array.from(key), Array.from(iv));
  const bytes = Array.from(input);
  return Uint8Array.from(encrypt ? cbc.encrypt(bytes) : cbc.decrypt(bytes));
}

/**
 * Wrap a data-plane payload: 16 random bytes, the payload, random filler, and
 * the pad length in the final byte. The result is always a whole number of
 * AES blocks.
 */
export function frame(data: Uint8Array, fill: (length: number) => Uint8Array = randomBytes): Uint8Array {
  const padLen = 16 - (data.length % 16);
  const total = data.length + 16 + padLen;
  const out = new Uint8Array(total);
  out.set(fill(16), 0);
  out.set(data, 16);

  const fillStart = 16 + data.length;
  const fillLen = total - 1 - fillStart;
  if (fillLen > 0) {
    out.set(fill(fillLen), fillStart);
  }
  out[total - 1] = padLen;
  return out;
}

export function unframe(data: Uint8Array): Uint8Array {
  if (data.length === 0) {
    return data;
  }
  const padLen = data[data.length - 1];
  const body = data.subarray(16);
  const end = Math.max(0, body.length - padLen);
  return body.slice(0, end);
}

export function encryptData(payload: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  return aes(frame(payload), key, iv, true);
}

export function decryptData(message: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  return unframe(aes(message, key, iv, false));
}

export function encryptControl(payload16: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  return aes(payload16, key, iv, true);
}

export function decryptControl(message: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  return aes(message, key, iv, false);
}

/**
 * A 16-byte handshake message: mostly random, with a marker at byte 2, the
 * command at byte 4 and a version at byte 6.
 */
export function buildControlMessage(
  command: number,
  fill: (length: number) => Uint8Array = randomBytes,
): Uint8Array {
  const msg = fill(16).slice(0, 16);
  msg[2] = 0xff;
  msg[4] = command & 0xff;
  msg[6] = 0x01;
  return msg;
}

/**
 * Interleave the bike's nonce with ours into the temporary IV and secret that
 * protect the rest of the handshake.
 */
export function computeTempIvAndSecret(
  m1: Uint8Array,
  m2: Uint8Array,
): {iv: Uint8Array; secret: Uint8Array} {
  const iv = new Uint8Array(16);
  const secret = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    iv[i] = m1[8 + i];
    iv[8 + i] = m2[i];
    secret[i] = m2[8 + i];
    secret[8 + i] = m1[i];
  }
  return {iv, secret};
}

/** Mirror bytes 8..16 of the challenge into a 16-byte palindrome. */
export function buildMirrored(decryptedChallenge: Uint8Array): Uint8Array {
  const tail = decryptedChallenge.subarray(8, 16);
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    out[i] = tail[i];
    out[15 - i] = tail[i];
  }
  return out;
}

/**
 * Derive the pool of 16 session keys the bike chooses from.
 *
 * Each of the four cyclic rotations of (challenge, mirrored, iv, secret) is
 * concatenated into 64 bytes and hashed; every SHA-512 digest yields four
 * 16-byte keys, in order.
 */
export function deriveSessionKeys(
  decryptedChallenge: Uint8Array,
  mirrored: Uint8Array,
  tempIv: Uint8Array,
  tempSecret: Uint8Array,
): Uint8Array[] {
  const base = [decryptedChallenge, mirrored, tempIv, tempSecret];
  const keys: Uint8Array[] = [];

  for (let rot = 0; rot < 4; rot++) {
    const buf = new Uint8Array(64);
    for (let slot = 0; slot < 4; slot++) {
      buf.set(base[(slot + rot) % 4], slot * 16);
    }
    const digest = new Uint8Array(sha512.arrayBuffer(buf));
    for (let chunk = 0; chunk < 4; chunk++) {
      keys.push(digest.slice(chunk * 16, chunk * 16 + 16));
    }
  }
  return keys;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
