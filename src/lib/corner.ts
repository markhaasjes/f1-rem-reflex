import type { CornerSample } from '../types';

const SAMPLE_RATE_HZ = 20;

export interface InterpolatedState {
  x: number;
  y: number;
  distanceM: number;
  speedKph: number;
  brakeActive: boolean;
}

// Samples are baked onto a uniform 20 Hz grid, so we can index directly
// instead of scanning the array on every animation frame.
export function sampleAt(samples: CornerSample[], t: number): InterpolatedState {
  const clampedT = Math.min(Math.max(t, 0), samples.at(-1)!.t);
  const rawIndex = clampedT * SAMPLE_RATE_HZ;
  const lowerIndex = Math.floor(rawIndex);
  const upperIndex = Math.min(lowerIndex + 1, samples.length - 1);
  const ratio = rawIndex - lowerIndex;

  const lower = samples[lowerIndex];
  const upper = samples[upperIndex];

  return {
    x: lower.x + (upper.x - lower.x) * ratio,
    y: lower.y + (upper.y - lower.y) * ratio,
    distanceM: lower.distanceM + (upper.distanceM - lower.distanceM) * ratio,
    speedKph: lower.speedKph + (upper.speedKph - lower.speedKph) * ratio,
    brakeActive: lower.brakeActive,
  };
}

export function headingAt(samples: CornerSample[], t: number): number {
  const delta = 0.05;
  const a = sampleAt(samples, Math.max(t - delta, 0));
  const b = sampleAt(samples, Math.min(t + delta, samples.at(-1)!.t));
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}
