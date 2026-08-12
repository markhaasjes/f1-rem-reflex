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

// The car advances monotonically, so each lookup only scans a short stretch
// ahead of the previous hit instead of the whole ~1400-point outline.
function nearestOutlineIndex(outline: Point[], p: Point, hint: number): number {
  const from = hint < 0 ? 0 : Math.max(0, hint - 5);
  const to = hint < 0 ? outline.length - 1 : Math.min(outline.length - 1, hint + 40);
  let best = from;
  let bestDist = Infinity;
  for (let i = from; i <= to; i++) {
    const d = (outline[i].x - p.x) ** 2 + (outline[i].y - p.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Max's phases re-expressed on the road centerline, for tinting the whole
 * asphalt band in his zone colors: the geometry snaps each moment's car
 * position to the nearest outline vertex (~3m spacing), so the tint follows
 * the road exactly and can never overhang the edges the way his real racing
 * line would at an apex. */
export function buildRoadZoneSegments(
  samples: LapSample[],
  outline: Point[],
  tStart: number,
  tEnd: number,
): PhaseSegment[] {
  let lastIndex = -1;
  return buildSegments(
    tStart,
    tEnd,
    (t) => classifyAt(samples, t),
    (t) => {
      lastIndex = nearestOutlineIndex(outline, positionAt(samples, t), lastIndex);
      return outline[lastIndex];
    },
  );
}
