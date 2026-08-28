/**
 * Parsing helpers for ELM327-style adapters (the clones sold as "OBD2 BLE"
 * dongles all speak this). The adapter is a line-oriented modem: you write an
 * AT command or an OBD request, it answers with lines of hex and then a '>'
 * prompt to say it is ready for the next one.
 */

export const PROMPT = '>';

/** Commands sent once after connecting, in order. */
export const INIT_COMMANDS = [
  'ATZ', // reset
  'ATE0', // echo off — otherwise every reply repeats the request
  'ATL0', // no line feeds
  'ATS0', // no spaces in responses
  'ATH0', // no CAN headers
  'ATSP0', // automatic protocol detection
];

export type ElmError = 'NO_DATA' | 'UNABLE_TO_CONNECT' | 'STOPPED' | 'BUS_ERROR' | 'ERROR';

export interface ElmResponse {
  /** Response lines with whitespace and the prompt stripped. */
  lines: string[];
  error?: ElmError;
}

const ERROR_PATTERNS: Array<[RegExp, ElmError]> = [
  [/NODATA/i, 'NO_DATA'],
  [/UNABLETOCONNECT/i, 'UNABLE_TO_CONNECT'],
  [/STOPPED/i, 'STOPPED'],
  [/BUS(INIT)?ERROR/i, 'BUS_ERROR'],
  [/CANERROR/i, 'BUS_ERROR'],
  [/^\?$/, 'ERROR'],
];

/** Turn one raw adapter response (everything up to the prompt) into lines. */
export function parseResponse(raw: string): ElmResponse {
  const lines = raw
    .replace(/>/g, '')
    .split(/[\r\n]+/)
    .map(line => line.replace(/\s+/g, '').toUpperCase())
    .filter(line => line.length > 0 && line !== 'SEARCHING...' && !line.startsWith('SEARCHING'));

  for (const line of lines) {
    for (const [pattern, error] of ERROR_PATTERNS) {
      if (pattern.test(line)) {
        return { lines, error };
      }
    }
  }
  return { lines };
}

/**
 * Pull the data bytes out of a service-01 reply.
 *
 * With headers off a reply looks like `410C1AF8`: the `41` marks a service-01
 * answer, `0C` echoes the PID, and the rest is data. CAN replies can arrive
 * multi-frame, with each line prefixed by a frame index (`0:`, `1:` …) or with
 * a leading byte count; we take the first line that carries our PID echo.
 */
export function parsePidData(response: ElmResponse, pid: string): number[] | null {
  if (response.error) {
    return null;
  }
  const echo = `41${pid.toUpperCase()}`;
  const joined = response.lines
    .map(line => line.replace(/^\d+:/, ''))
    .join('');
  const index = joined.indexOf(echo);
  if (index < 0) {
    return null;
  }
  const payload = joined.slice(index + echo.length);
  return hexToBytes(payload);
}

/** Decode a service-03 (stored trouble codes) reply into DTC strings. */
export function parseDtcs(response: ElmResponse): string[] {
  if (response.error) {
    return [];
  }
  const joined = response.lines.map(line => line.replace(/^\d+:/, '')).join('');
  const index = joined.indexOf('43');
  if (index < 0) {
    return [];
  }
  let body = joined.slice(index + 2);
  // Some adapters prefix the DTC list with a count byte; drop an odd nibble.
  if (body.length % 4 === 2) {
    body = body.slice(2);
  }
  const codes: string[] = [];
  for (let i = 0; i + 4 <= body.length; i += 4) {
    const code = decodeDtc(body.slice(i, i + 4));
    if (code && code !== 'P0000') {
      codes.push(code);
    }
  }
  return codes;
}

const DTC_PREFIX = ['P', 'C', 'B', 'U'];

export function decodeDtc(fourHex: string): string | null {
  if (!/^[0-9A-F]{4}$/i.test(fourHex)) {
    return null;
  }
  const value = parseInt(fourHex, 16);
  const prefix = DTC_PREFIX[(value >> 14) & 0x03];
  const digits = ((value >> 12) & 0x03).toString() + (value & 0x0fff).toString(16).toUpperCase().padStart(3, '0');
  return `${prefix}${digits}`;
}

export function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i + 2 <= clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
}

/** True once the adapter has sent its ready prompt. */
export function isComplete(buffer: string): boolean {
  return buffer.includes(PROMPT);
}
