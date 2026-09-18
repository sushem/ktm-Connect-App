import {
  aes,
  buildControlMessage,
  buildMirrored,
  computeTempIvAndSecret,
  decryptControl,
  decryptData,
  deriveSessionKeys,
  encryptControl,
  encryptData,
  frame,
  fromHex,
  toHex,
  unframe,
} from '../crypto';

/**
 * The expected values below were produced by running the reference Kotlin
 * implementation's algorithms through the JDK (AES/CBC/NoPadding and SHA-512),
 * so these are a cross-implementation check rather than a restatement of our
 * own output. A mismatch here means the bike will reject the handshake.
 */

/** Deterministic bytes, so vectors are reproducible on both sides. */
const seq = (length: number, start: number): Uint8Array =>
  Uint8Array.from({length}, (_, i) => (start + i * 7) & 0xff);

const KEY = seq(16, 1);
const IV = seq(16, 200);

describe('AES-CBC against the reference implementation', () => {
  it('encrypts a block to the same ciphertext', () => {
    expect(toHex(aes(seq(16, 50), KEY, IV, true))).toBe('a2c638bd921334a92581acc18467a44b');
  });

  it('round-trips', () => {
    const plain = seq(32, 11);
    expect(toHex(aes(aes(plain, KEY, IV, true), KEY, IV, false))).toBe(toHex(plain));
  });

  it('refuses a partial block rather than padding it silently', () => {
    expect(() => aes(seq(20, 0), KEY, IV, true)).toThrow(/whole blocks/);
  });
});

describe('handshake key agreement', () => {
  const m1 = seq(16, 3);
  const m2 = seq(16, 128);

  it('interleaves the two nonces the same way', () => {
    const {iv, secret} = computeTempIvAndSecret(m1, m2);
    expect(toHex(iv)).toBe('3b424950575e656c80878e959ca3aab1');
    expect(toHex(secret)).toBe('b8bfc6cdd4dbe2e9030a11181f262d34');
  });

  it('mirrors the challenge tail into a palindrome', () => {
    expect(toHex(buildMirrored(seq(16, 17)))).toBe('4950575e656c737a7a736c655e575049');
  });

  it('derives the same pool of sixteen session keys', () => {
    const {iv, secret} = computeTempIvAndSecret(m1, m2);
    const challenge = seq(16, 17);
    const keys = deriveSessionKeys(challenge, buildMirrored(challenge), iv, secret);

    expect(keys).toHaveLength(16);
    expect(keys.map(toHex)).toEqual([
      '9ecf1d041f4f08d53bea40383e200e63',
      '5c078f02e73e191622d93bd43773358e',
      '7c8aad574d4aadb4b97451a08d7600a0',
      '2815dcd9b68464a737d3c6f7baa59db6',
      '6652865713b8ebb603d53905113ee628',
      'b7cff17ae6de55a04c503001606604f8',
      '5c06941704bad083310a859608552a2b',
      '40d1d3606b4a115200e1df4b15623456',
      'd418fd3ef992020de5b2fbb21941b7ce',
      '6e1189ff78fc2c2c51647ac22c9ab883',
      '36630d6b2f2e21b5fb6debc29df60509',
      '5aeecd96b71764ddce21d1b3837fc0bd',
      'e46ce907db7d49743a2439d7f8d1128c',
      '63542d00a8dbd98666fc5ce89a6416c6',
      '6021d377b7448f88f1809dfe94618bb1',
      '017d0c06937a22d056e96710c9f192f6',
    ]);
  });
});

describe('data-plane framing', () => {
  /** Fixed filler, so the frame can be compared byte for byte. */
  const filler = (byte: number) => (length: number) => new Uint8Array(length).fill(byte);

  it('wraps a payload the same way the reference does', () => {
    const framed = frame(seq(5, 90), length => (length === 16 ? filler(0xaa)(16) : filler(0xbb)(length)));
    expect(toHex(framed)).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5a61686f76bbbbbbbbbbbbbbbbbbbb0b',
    );
  });

  it('encrypts a framed payload to the same ciphertext', () => {
    const framed = frame(seq(5, 90), length => (length === 16 ? filler(0xaa)(16) : filler(0xbb)(length)));
    expect(toHex(aes(framed, KEY, IV, true))).toBe(
      'f5a9b7cdf54e88bfa27914972ea6ee002c943cfbdc2db98a52b8861294addbce',
    );
  });

  it('always pads to whole blocks, including when the payload already fits', () => {
    expect(frame(new Uint8Array(0)).length % 16).toBe(0);
    expect(frame(seq(16, 0)).length).toBe(48);
    expect(frame(seq(1, 0)).length).toBe(32);
  });

  it('recovers the payload through a frame and encrypt round trip', () => {
    const payload = seq(37, 5);
    expect(toHex(unframe(frame(payload)))).toBe(toHex(payload));
    expect(toHex(decryptData(encryptData(payload, KEY, IV), KEY, IV))).toBe(toHex(payload));
  });
});

describe('control messages', () => {
  it('places the marker, command and version where the bike looks for them', () => {
    const msg = buildControlMessage(0x11, length => new Uint8Array(length).fill(0x99));
    expect(msg).toHaveLength(16);
    expect(msg[2]).toBe(0xff);
    expect(msg[4]).toBe(0x11);
    expect(msg[6]).toBe(0x01);
  });

  it('goes through raw AES with no framing, unlike data', () => {
    const msg = buildControlMessage(0, length => new Uint8Array(length).fill(0x42));
    const encrypted = encryptControl(msg, KEY, IV);

    expect(encrypted).toHaveLength(16);
    expect(toHex(decryptControl(encrypted, KEY, IV))).toBe(toHex(msg));
  });
});

describe('hex helpers', () => {
  it('round-trips', () => {
    expect(toHex(fromHex('00ff10ab'))).toBe('00ff10ab');
  });
});
