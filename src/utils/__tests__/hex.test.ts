import {hexPreview, toHex, toPrintable} from '../hex';

describe('hex preview', () => {
  const bytes = Uint8Array.from([0x00, 0x00, 0x00, 0x0a, 0x01, 0x7b, 0x22, 0x61, 0x22, 0x7d]);

  it('renders bytes as padded hex', () => {
    expect(toHex(bytes)).toBe('00 00 00 0a 01 7b 22 61 22 7d');
  });

  it('shows printable characters and hides the rest', () => {
    expect(toPrintable(bytes)).toBe('.....{"a"}');
  });

  it('leads with the length so a short read is obvious', () => {
    expect(hexPreview(bytes)).toBe('10B  00 00 00 0a 01 7b 22 61 22 7d  |.....{"a"}|');
  });

  it('truncates a long chunk and says how much it left out', () => {
    const long = new Uint8Array(60).fill(0x41);
    expect(hexPreview(long, 4)).toBe('60B  41 41 41 41  |AAAA| …+56 more');
  });

  it('says so rather than rendering nothing', () => {
    expect(hexPreview(new Uint8Array(0))).toBe('(empty)');
  });
});
