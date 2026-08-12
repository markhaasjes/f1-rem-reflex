import { buildSegments, type DrivingPhase, type PhaseSegment } from './phases';
import type { InputTransition, LapSample, PedalInput } from '../types';

// The player's pedal timeline is recorded as transitions (edge events on the
// lap clock), not per-frame samples: it stays tiny, and reading the state at
// any t is a simple scan over a handful of entries.

/** The player's pedal state at t: the last transition at or before t. */
export function inputAt(transitions: InputTransition[], t: number): PedalInput {
  let input: PedalInput = 'coast';
  for (const transition of transitions) {
    if (transition.t > t) break;
    input = transition.input;
  }
  return input;
}

/** The player's input expressed as a driving phase, so it renders and scores
 * through the same three-color machinery as Max's telemetry. */
export function inputToPhase(input: PedalInput): DrivingPhase {
  if (input === 'gas') return 'flat';
  if (input === 'brake') return 'brake';
  return 'coast';
}

/** The player's driven window as colored polyline segments (their pedal
 * timeline over Max's path), for the live trail and the result comparison. */
export function buildInputSegments(
  samples: LapSample[],
  transitions: InputTransition[],
  tStart: number,
  tEnd: number,
): PhaseSegment[] {
  return buildSegments(samples, tStart, tEnd, (t) => inputToPhase(inputAt(transitions, t)));
}
