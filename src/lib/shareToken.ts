import type { PedalInput } from '../types';

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

/** Decodes the legacy scores-only token (`?d=`). New links carry a full run
 * token (`?r=`, below); this stays so links shared before the switch keep
 * rendering a plain score card. Null for anything malformed or tampered. */
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

// --- Run token (`?r=`): the whole run in one short URL-safe string ---
//
// The receiving browser has the full fixture baked in, so the link only has
// to carry what the fixture cannot know: the sharer's pedal timeline (and
// their round scores, so the number on the landing card is exactly the one
// they saw, immune to quantization drift). Everything else - the accuracy
// bars, the mini raceline comparison - is recomputed from the timeline.
//
// Binary layout, then base64url:
//   [version][roundCount] per round: [score][timelineByteLen][bytes...]
//   [mac2 hi][mac2 lo]
// Timeline bytes: top 2 bits = code (0 coast, 1 gas, 2 brake, 3 = filler
// that only advances the clock), low 6 bits = 0.1s steps since the previous
// entry. Timelines are normalized before encoding (quantized to the grid,
// same-step entries collapsed to the last, consecutive same-input dropped),
// which also bounds a button-masher's round at ~140 bytes; a typical run is
// ~60 bytes -> an ~80 character token.

const RUN_TOKEN_VERSION = 1;
const RUN_STEP_S = 0.1;
const RUN_FILLER_STEPS = 63;
const RUN_MAX_ROUNDS = 8;
const RUN_MAX_TIMELINE_BYTES = 255;

const CODE_TO_INPUT: PedalInput[] = ['coast', 'gas', 'brake'];
const INPUT_TO_CODE: Record<PedalInput, number> = { coast: 0, gas: 1, brake: 2 };

export interface SharedRound {
  score: number;
  /** Pedal changes as offsets from the round start, seconds. */
  transitions: { offsetS: number; input: PedalInput }[];
}

function macBytes(payload: number[]): [number, number] {
  const h = Number.parseInt(hash(`${SALT}:${payload.join(',')}`), 36);
  return [(h >>> 8) & 0xff, h & 0xff];
}

export function encodeRunToken(rounds: SharedRound[]): string {
  const bytes: number[] = [RUN_TOKEN_VERSION, rounds.length];
  for (const round of rounds) {
    // normalize onto the grid: per step keep the last input, drop no-ops
    const steps = new Map<number, PedalInput>();
    for (const transition of round.transitions) {
      steps.set(Math.max(0, Math.round(transition.offsetS / RUN_STEP_S)), transition.input);
    }
    const timeline: number[] = [];
    let previousStep = 0;
    let previousInput: PedalInput | null = null;
    for (const [step, input] of [...steps.entries()].sort((a, b) => a[0] - b[0])) {
      if (input === previousInput) continue;
      let delta = step - previousStep;
      while (delta > RUN_FILLER_STEPS) {
        timeline.push(0xff);
        delta -= RUN_FILLER_STEPS;
      }
      timeline.push((INPUT_TO_CODE[input] << 6) | delta);
      previousStep = step;
      previousInput = input;
    }
    bytes.push(Math.max(0, Math.min(100, Math.round(round.score))));
    bytes.push(Math.min(timeline.length, RUN_MAX_TIMELINE_BYTES));
    bytes.push(...timeline.slice(0, RUN_MAX_TIMELINE_BYTES));
  }
  bytes.push(...macBytes(bytes));
  return toBase64Url(String.fromCharCode(...bytes));
}

/** Inverse of encodeRunToken; null for anything malformed or tampered. */
export function decodeRunToken(token: string): SharedRound[] | null {
  const raw = fromBase64Url(token);
  if (raw === null || raw.length < 4) return null;
  const bytes = [...raw].map((c) => c.charCodeAt(0));
  const payload = bytes.slice(0, -2);
  const [hi, lo] = bytes.slice(-2);
  const [expectedHi, expectedLo] = macBytes(payload);
  if (hi !== expectedHi || lo !== expectedLo) return null;
  if (payload[0] !== RUN_TOKEN_VERSION) return null;

  const roundCount = payload[1];
  if (roundCount < 1 || roundCount > RUN_MAX_ROUNDS) return null;
  const rounds: SharedRound[] = [];
  let i = 2;
  for (let r = 0; r < roundCount; r++) {
    if (i + 2 > payload.length) return null;
    const score = payload[i++];
    if (score > 100) return null;
    const timelineByteLen = payload[i++];
    if (i + timelineByteLen > payload.length) return null;
    const transitions: SharedRound['transitions'] = [];
    let step = 0;
    for (const byte of payload.slice(i, i + timelineByteLen)) {
      const code = byte >> 6;
      const delta = byte & 63;
      step += code === 3 ? RUN_FILLER_STEPS : delta;
      if (code !== 3) transitions.push({ offsetS: step * RUN_STEP_S, input: CODE_TO_INPUT[code] });
    }
    i += timelineByteLen;
    rounds.push({ score, transitions });
  }
  return i === payload.length ? rounds : null;
}
