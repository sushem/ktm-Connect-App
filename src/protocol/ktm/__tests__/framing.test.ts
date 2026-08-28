import {
  concatBytes,
  decodeFrames,
  encodeFrame,
  fromBase64,
  toBase64,
  utf8Decode,
  utf8Encode,
} from '../framing';

describe('KTM frame encoding', () => {
  it('prefixes the payload with a big-endian length that counts the type byte', () => {
    const frame = encodeFrame('hi');
    expect(Array.from(frame)).toEqual([0, 0, 0, 3, 1, 0x68, 0x69]);
  });

  it('encodes lengths above one byte correctly', () => {
    const payload = 'x'.repeat(300);
    const frame = encodeFrame(payload);
    expect(Array.from(frame.slice(0, 5))).toEqual([0, 0, 1, 45, 1]);
    expect(frame.length).toBe(305);
  });

  it('round-trips multi-byte UTF-8', () => {
    const payload = JSON.stringify({road: 'Großglockner Hochalpenstraße'});
    const {frames, rest} = decodeFrames(encodeFrame(payload));
    expect(frames).toEqual([{type: 1, payload}]);
    expect(rest.length).toBe(0);
  });

  it('decodes several frames from one buffer and keeps the remainder', () => {
    const buffer = concatBytes(
      concatBytes(encodeFrame('one'), encodeFrame('two')),
      encodeFrame('three').slice(0, 4),
    );
    const {frames, rest} = decodeFrames(buffer);
    expect(frames.map(f => f.payload)).toEqual(['one', 'two']);
    expect(rest.length).toBe(4);
  });

  it('waits for the rest of a partial frame instead of guessing', () => {
    const whole = encodeFrame('partial');
    const {frames, rest} = decodeFrames(whole.slice(0, whole.length - 2));
    expect(frames).toEqual([]);
    expect(rest.length).toBe(whole.length - 2);
  });

  it('rejects a nonsense length rather than allocating for it', () => {
    const bogus = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 1, 0x41]);
    expect(() => decodeFrames(bogus)).toThrow(/Invalid KTM frame length/);
  });
});

describe('base64 and utf-8 helpers', () => {
  it.each([[[]], [[0]], [[1, 2]], [[1, 2, 3]], [[255, 254, 253, 0, 17]]])(
    'round-trips %j through base64',
    bytes => {
      expect(Array.from(fromBase64(toBase64(Uint8Array.from(bytes))))).toEqual(bytes);
    },
  );

  it('pads the tail the way every other base64 encoder does', () => {
    expect(toBase64(Uint8Array.from([0, 1, 2, 250, 128, 64, 32]))).toBe('AAEC+oBAIA==');
    expect(toBase64(Uint8Array.from([1]))).toBe('AQ==');
    expect(toBase64(Uint8Array.from([1, 2]))).toBe('AQI=');
  });

  it('round-trips text through the utf-8 helpers', () => {
    const text = 'Ålesund → Åre, 21 °C';
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });
});
