import { positionAt, sampleAt } from './corner';
import type { LapSample, Point } from '../types';

export type DrivingPhase = 'flat' | 'coast' | 'brake';

export interface PhaseSegment {
  phase: DrivingPhase;
  points: Point[];
}

const COAST_THROTTLE_THRESHOLD = 95;
export const STEP_S = 0.05;

/** Max's driving phase at t, straight from the telemetry channels. */
export function classifyAt(samples: LapSample[], t: number): DrivingPhase {
  const s = sampleAt(samples, t);
  if (s.brakeActive) return 'brake';
  if (s.throttle < COAST_THROTTLE_THRESHOLD) return 'coast';
  return 'flat';
}

// Splits a window of the lap into contiguous same-phase runs for rendering as
// colored polylines (flat = vol gas, coast = gas los, brake = remmen). Both
// the phase source and the geometry are pluggable: Max's telemetry and the
// player's pedal timeline render through the same machinery, on the smoothed
// car path or re-expressed on the road centerline. Each new segment repeats
// the previous segment's last point so the colors connect with no visual gap.
export function buildSegments(
  tStart: number,
  tEnd: number,
  phaseAt: (t: number) => DrivingPhase,
  pointAt: (t: number) => Point,
): PhaseSegment[] {
  const segments: PhaseSegment[] = [];
  let currentPhase: DrivingPhase | null = null;
  let currentPoints: Point[] = [];

  for (let t = tStart; t <= tEnd; t += STEP_S) {
    const point = pointAt(t);
    const phase = phaseAt(t);
    if (phase !== currentPhase) {
      if (currentPhase !== null) {
        currentPoints.push(point);
        segments.push({ phase: currentPhase, points: currentPoints });
      }
      currentPhase = phase;
      currentPoints = [point];
    } else {
      currentPoints.push(point);
    }
  }
  if (currentPhase !== null) segments.push({ phase: currentPhase, points: currentPoints });

  return segments;
}

/** Max's phases along his smoothed driven line. */
export function buildPhaseSegments(samples: LapSample[], tStart: number, tEnd: number): PhaseSegment[] {
  return buildSegments(
    tStart,
    tEnd,
    (t) => classifyAt(samples, t),
    (t) => positionAt(samples, t),
  );
}
