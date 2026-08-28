import {PID_BY_CODE, decodeSupportMask} from '../pids';

describe('PID decoders', () => {
  it('decodes engine speed as quarter revolutions', () => {
    expect(PID_BY_CODE['0C'].decode([0x1a, 0xf8])).toBeCloseTo(1726, 5);
  });

  it('decodes vehicle speed straight from the byte', () => {
    expect(PID_BY_CODE['0D'].decode([0x64])).toBe(100);
  });

  it('offsets temperatures by 40 degrees', () => {
    expect(PID_BY_CODE['05'].decode([0x00])).toBe(-40);
    expect(PID_BY_CODE['05'].decode([0x7b])).toBe(83);
  });

  it('decodes control module voltage in millivolts', () => {
    expect(PID_BY_CODE['42'].decode([0x35, 0xd4])).toBeCloseTo(13.78, 2);
  });

  it('scales percentages to 0-100', () => {
    expect(PID_BY_CODE['11'].decode([0xff])).toBe(100);
    expect(PID_BY_CODE['11'].decode([0x80])).toBeCloseTo(50.2, 1);
  });
});

describe('decodeSupportMask', () => {
  it('lists the PIDs whose bits are set, most significant first', () => {
    // 0x80000000 sets only bit 1, which stands for PID 01.
    expect(decodeSupportMask(0x00, [0x80, 0x00, 0x00, 0x00])).toEqual(['01']);
  });

  it('reads a realistic mask', () => {
    const supported = decodeSupportMask(0x00, [0xbe, 0x1f, 0xa8, 0x13]);
    expect(supported).toContain('0C');
    expect(supported).toContain('0D');
    expect(supported).not.toContain('02');
  });

  it('offsets by the base PID for the higher ranges', () => {
    expect(decodeSupportMask(0x20, [0x80, 0x00, 0x00, 0x00])).toEqual(['21']);
    expect(decodeSupportMask(0x40, [0x00, 0x00, 0x00, 0x01])).toEqual(['60']);
  });
});
