/**
 * Framing for the KTM MY RIDE serial link.
 *
 * Every message on the RFCOMM socket is:
 *
 *   +--------+--------+--------+--------+--------+============+
 *   |          length (uint32, BE)      |  type  |  payload   |
 *   +--------+--------+--------+--------+--------+============+
 *
 * `length` counts the type byte plus the payload, so it is `payload + 1`.
 * `type` is 0x01 for the UTF-8 JSON messages the dashboard understands.
 */

export const FRAME_TYPE_JSON = 0x01;
export const FRAME_HEADER_BYTES = 5;

/** Largest frame we will accept while decoding, as a guard against garbage. */
export const MAX_FRAME_BYTES = 64 * 1024;

export function encodeFrame(payload: string, type: number = FRAME_TYPE_JSON): Uint8Array {
  const body = utf8Encode(payload);
  const length = body.length + 1;
  const frame = new Uint8Array(FRAME_HEADER_BYTES + body.length);
  frame[0] = (length >>> 24) & 0xff;
  frame[1] = (length >>> 16) & 0xff;
  frame[2] = (length >>> 8) & 0xff;
  frame[3] = length & 0xff;
  frame[4] = type & 0xff;
  frame.set(body, FRAME_HEADER_BYTES);
  return frame;
}

export interface DecodedFrame {
  type: number;
  payload: string;
}

export interface DecodeResult {
  frames: DecodedFrame[];
  /** Bytes that did not form a complete frame yet; feed them back in later. */
  rest: Uint8Array;
}

/**
 * Pull as many whole frames as possible out of `buffer`. The dashboard is
 * mostly a sink, but it does acknowledge some messages, and a stream decoder
 * keeps us honest if a firmware revision starts talking back.
 */
export function decodeFrames(buffer: Uint8Array): DecodeResult {
  const frames: DecodedFrame[] = [];
  let offset = 0;

  while (buffer.length - offset >= FRAME_HEADER_BYTES) {
    const length =
      ((buffer[offset] << 24) |
        (buffer[offset + 1] << 16) |
        (buffer[offset + 2] << 8) |
        buffer[offset + 3]) >>>
      0;

    if (length < 1 || length > MAX_FRAME_BYTES) {
      throw new Error(`Invalid KTM frame length: ${length}`);
    }
    const total = 4 + length;
    if (buffer.length - offset < total) {
      break;
    }
    const type = buffer[offset + 4];
    const body = buffer.slice(offset + FRAME_HEADER_BYTES, offset + total);
    frames.push({ type, payload: utf8Decode(body) });
    offset += total;
  }

  return { frames, rest: buffer.slice(offset) };
}

type EncoderCtor = new () => {encode(input: string): Uint8Array};
type DecoderCtor = new (label?: string) => {decode(input: Uint8Array): string};

const globals = globalThis as unknown as {
  TextEncoder?: EncoderCtor;
  TextDecoder?: DecoderCtor;
};

export function utf8Encode(value: string): Uint8Array {
  // Hermes ships TextEncoder on current React Native, but the fallback keeps
  // this module usable under bare Node (tests) and older runtimes.
  if (globals.TextEncoder) {
    return new globals.TextEncoder().encode(value);
  }
  const out: number[] = [];
  for (let i = 0; i < value.length; i++) {
    let c = value.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
      i++;
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  if (globals.TextDecoder) {
    return new globals.TextDecoder('utf-8').decode(bytes);
  }
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      const cp =
        (((b & 0x07) << 18) |
          ((bytes[i + 1] & 0x3f) << 12) |
          ((bytes[i + 2] & 0x3f) << 6) |
          (bytes[i + 3] & 0x3f)) -
        0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      i += 4;
    }
  }
  return out;
}

/** Base64 is the wire format `react-native-bluetooth-classic` uses for binary writes. */
export function toBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : alphabet[b2 & 0x3f];
  }
  return out;
}

export function fromBase64(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (alphabet.indexOf(clean[i]) << 18) |
      (alphabet.indexOf(clean[i + 1]) << 12) |
      ((clean[i + 2] ? alphabet.indexOf(clean[i + 2]) : 0) << 6) |
      (clean[i + 3] ? alphabet.indexOf(clean[i + 3]) : 0);
    out[p++] = (n >> 16) & 0xff;
    if (clean[i + 2]) {
      out[p++] = (n >> 8) & 0xff;
    }
    if (clean[i + 3]) {
      out[p++] = n & 0xff;
    }
  }
  return out.slice(0, p);
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
