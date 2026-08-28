import {decodeDtc, parseDtcs, parsePidData, parseResponse} from '../elm327';

describe('parseResponse', () => {
  it('strips whitespace, the prompt and the search notice', () => {
    expect(parseResponse('SEARCHING...\r41 0C 1A F8\r\r>')).toEqual({lines: ['410C1AF8']});
  });

  it.each([
    ['NO DATA\r\r>', 'NO_DATA'],
    ['UNABLE TO CONNECT\r>', 'UNABLE_TO_CONNECT'],
    ['STOPPED\r>', 'STOPPED'],
    ['CAN ERROR\r>', 'BUS_ERROR'],
    ['?\r>', 'ERROR'],
  ])('reports %j as %s', (raw, error) => {
    expect(parseResponse(raw).error).toBe(error);
  });
});

describe('parsePidData', () => {
  it('returns the bytes after the service and PID echo', () => {
    expect(parsePidData(parseResponse('410C1AF8\r>'), '0C')).toEqual([0x1a, 0xf8]);
  });

  it('reassembles a multi-line CAN reply', () => {
    const response = parseResponse('0: 41 00 BE 1F\r1: A8 13\r>');
    expect(parsePidData(response, '00')).toEqual([0xbe, 0x1f, 0xa8, 0x13]);
  });

  it('returns null when the adapter reported an error', () => {
    expect(parsePidData(parseResponse('NO DATA\r>'), '0C')).toBeNull();
  });

  it('returns null when the reply is for a different PID', () => {
    expect(parsePidData(parseResponse('410D2A\r>'), '0C')).toBeNull();
  });
});

describe('trouble codes', () => {
  it.each([
    ['0143', 'P0143'],
    ['4321', 'C0321'],
    ['8123', 'B0123'],
    ['C123', 'U0123'],
  ])('decodes %s as %s', (raw, code) => {
    expect(decodeDtc(raw)).toBe(code);
  });

  it('rejects anything that is not four hex digits', () => {
    expect(decodeDtc('12G4')).toBeNull();
    expect(decodeDtc('123')).toBeNull();
  });

  it('reads a CAN reply that starts with a code count', () => {
    expect(parseDtcs(parseResponse('43 02 01 43 01 33\r>'))).toEqual(['P0143', 'P0133']);
  });

  it('reads a reply with no count byte and drops the empty slots', () => {
    expect(parseDtcs(parseResponse('43014301330000\r>'))).toEqual(['P0143', 'P0133']);
  });

  it('is empty when the ECU has nothing stored', () => {
    expect(parseDtcs(parseResponse('43 00 00 00 00 00 00\r>'))).toEqual([]);
  });
});
