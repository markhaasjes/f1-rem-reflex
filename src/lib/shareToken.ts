// Shared-score links need to survive a browser address bar with no backend
// to check them against, so nothing here is a real secret: a determined
// reader of this file can always forge a token. What it does stop is a
// *casual* look at (or edit of) the URL: the per-round scores never appear
// as plain, human-readable numbers - they're bundled with a tamper check
// and packed into one opaque, URL-safe token instead of `?r=70.80.90.100`.
const SALT = 'nos-rem-reflex-share-v1';

// A small deterministic string hash (FNV-1a). Plenty for tamper-evidence:
// this isn't a security boundary, it only needs to be infeasible to
// reproduce by eyeballing the URL.
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// XORs every code point against a repeating keystream from the salt. The
// payload is plain ASCII (digits, dots, a base-36 hash, a separator), so
// every result stays under 128 - safe as a Latin1 byte for btoa/atob.
// Self-inverse: applying it twice with the same key returns the input.
function xorWithSalt(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    out += String.fromCodePoint(input.codePointAt(i)! ^ SALT.codePointAt(i % SALT.length)!);
  }
  return out;
}

function toBase64Url(binaryString: string): string {
  let out = btoa(binaryString).replaceAll('+', '-').replaceAll('/', '_');
  while (out.endsWith('=')) out = out.slice(0, -1);
  return out;
}

function fromBase64Url(token: string): string | null {
  try {
    let padded = token.replaceAll('-', '+').replaceAll('_', '/');
    while (padded.length % 4 !== 0) padded += '=';
    return atob(padded);
  } catch {
    return null;
  }
}

/** Packs the per-round scores into one opaque, URL-safe token: no plain
 * score numbers in the URL, and a tamper check baked in (see module doc). */
export function encodeShareToken(roundScores: number[]): string {
  const payload = roundScores.join('.');
  const mac = hash(`${SALT}:${payload}`);
  return toBase64Url(xorWithSalt(`${payload}|${mac}`));
}

/** Inverse of encodeShareToken; null for anything malformed or tampered. */
export function decodeShareToken(token: string): number[] | null {
  const raw = fromBase64Url(token);
  if (raw === null) return null;
  const decoded = xorWithSalt(raw);
  const separatorIndex = decoded.lastIndexOf('|');
  if (separatorIndex === -1) return null;
  const payload = decoded.slice(0, separatorIndex);
  const mac = decoded.slice(separatorIndex + 1);
  if (mac !== hash(`${SALT}:${payload}`)) return null;
  const roundScores = payload.split('.').map(Number);
  if (roundScores.some((n) => !Number.isFinite(n))) return null;
  return roundScores.map(Math.round);
}
