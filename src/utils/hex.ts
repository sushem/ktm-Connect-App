/**
 * Rendering raw bytes for the log.
 *
 * Reverse engineering a link means staring at what came back before anything
 * parses it, so the log needs the bytes both ways: hex for structure, ASCII for
 * the parts that turn out to be text.
 */

const MAX_BYTES = 48;

export function toHex(bytes: Uint8Array, limit = MAX_BYTES): string {
  return Array.from(bytes.subarray(0, limit))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join(' ');
}

/** Printable characters as themselves, everything else as a dot. */
export function toPrintable(bytes: Uint8Array, limit = MAX_BYTES): string {
  return Array.from(bytes.subarray(0, limit))
    .map(byte => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'))
    .join('');
}

export function hexPreview(bytes: Uint8Array, limit = MAX_BYTES): string {
  if (bytes.length === 0) {
    return '(empty)';
  }
  const truncated = bytes.length > limit ? ` …+${bytes.length - limit} more` : '';
  return `${bytes.length}B  ${toHex(bytes, limit)}  |${toPrintable(bytes, limit)}|${truncated}`;
}
