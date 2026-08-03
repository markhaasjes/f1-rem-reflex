import type { LapSample, Point } from '../types';

const SAMPLE_RATE_HZ = 20;

export interface InterpolatedState {
  x: number;
  y: number;
  distanceM: number;
  speedKph: number;
  throttle: number;
  brakeActive: boolean;
}

// Samples are baked onto a uniform 20 Hz grid, so we can index directly
// instead of scanning the array on every animation frame.
export function sampleAt(samples: LapSample[], t: number): InterpolatedState {
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
    throttle: lower.throttle + (upper.throttle - lower.throttle) * ratio,
    brakeActive: lower.brakeActive,
  };
}

// The raw x/y trace has GPS stalls - short stretches where the recorded
// position barely moves even though the speed channel still reads ~200 km/h -
// which make the car freeze and its heading spin if you drive it straight off
// the samples. So we drive the car along the *geometry* of the real racing
// line, but pace it with the *speed* channel: distance travelled = integral of
// speed, mapped onto the path by arc length. The line stays Max's real line;
// the motion becomes as smooth as the real speed trace.
interface PathModel {
  pts: { x: number; y: number }[];
  cumLen: number[]; // cumulative geometric arc length at each point
  travel: number[]; // speed-integrated distance at each sample, rescaled to the path length
  totalLen: number;
}

const MODEL_CACHE = new WeakMap<LapSample[], PathModel>();

// Points closer together than this (metres) are GPS jitter, not shape - drop
// them so they don't leave a kink the heading tangent would trip over.
const MIN_SEGMENT_M = 0.4;

// The GPS trace drifts laterally from the fitted track geometry (the
// similarity fit averages ~7m error, locally 10m+), so its lateral position
// is not trustworthy: kept raw it cuts across corners, clamped it glues to
// one track edge. Project the path fully onto the track centerline instead -
// the phase colors and pins carry the story; the line itself follows the
// road. The projection walks the closed outline monotonically (bounded
// look-ahead window) so nearby parallel track sections - the chicane legs,
// the pit straight - can never capture a point.
function projectToTrack(pts: Point[], outline: Point[]): Point[] {
  const n = outline.length;
  let gi = 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(outline[i].x - pts[0].x, outline[i].y - pts[0].y);
    if (d < best) {
      best = d;
      gi = i;
    }
  }

  const footOnSegment = (p: Point, a: Point, b: Point): Point => {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    return { x: a.x + abx * t, y: a.y + aby * t };
  };

  return pts.map((p) => {
    let bestJ = gi;
    let bestD = Infinity;
    for (let step = -10; step <= 60; step++) {
      const j = (gi + step + n) % n;
      const d = Math.hypot(outline[j].x - p.x, outline[j].y - p.y);
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    gi = bestJ;
    // exact foot point on the better of the two segments around the vertex
    const prev = outline[(bestJ - 1 + n) % n];
    const next = outline[(bestJ + 1) % n];
    const f1 = footOnSegment(p, prev, outline[bestJ]);
    const f2 = footOnSegment(p, outline[bestJ], next);
    return Math.hypot(f1.x - p.x, f1.y - p.y) <= Math.hypot(f2.x - p.x, f2.y - p.y) ? f1 : f2;
  });
}

function buildModel(samples: LapSample[], trackOutline?: Point[]): PathModel {
  const raw = samples.map((s) => ({ x: s.x, y: s.y }));
  let pts = [raw[0]];
  for (let i = 1; i < raw.length - 1; i++) {
    const prev = pts.at(-1)!;
    if (Math.hypot(raw[i].x - prev.x, raw[i].y - prev.y) >= MIN_SEGMENT_M) pts.push(raw[i]);
  }
  pts.push(raw.at(-1)!);
  if (trackOutline) {
    const projected = projectToTrack(pts, trackOutline);
    // re-dedupe: laterally-moving raw points can collapse onto the same spot
    pts = [projected[0]];
    for (let i = 1; i < projected.length; i++) {
      const prev = pts.at(-1)!;
      if (Math.hypot(projected[i].x - prev.x, projected[i].y - prev.y) >= MIN_SEGMENT_M) pts.push(projected[i]);
    }
  }

  const cumLen = [0];
  for (let i = 1; i < pts.length; i++) {
    cumLen[i] = cumLen[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const totalLen = cumLen.at(-1)!;

  // Trapezoidal integral of speed (m/s) over the 20 Hz grid.
  const rawTravel = [0];
  const dt = 1 / SAMPLE_RATE_HZ;
  for (let i = 1; i < samples.length; i++) {
    const v0 = samples[i - 1].speedKph / 3.6;
    const v1 = samples[i].speedKph / 3.6;
    rawTravel[i] = rawTravel[i - 1] + ((v0 + v1) / 2) * dt;
  }
  // Rescale the speed integral so it spans exactly the geometric path length,
  // keeping the car's start and finish pinned to the real endpoints.
  const scale = rawTravel.at(-1)! > 0 ? totalLen / rawTravel.at(-1)! : 1;
  const travel = rawTravel.map((d) => d * scale);

  return { pts, cumLen, travel, totalLen };
}

function getModel(samples: LapSample[]): PathModel {
  let model = MODEL_CACHE.get(samples);
  if (!model) {
    model = buildModel(samples);
    MODEL_CACHE.set(samples, model);
  }
  return model;
}

// Builds (and caches) the path model with track-clamping enabled. Call once
// with the circuit outline before any positionAt/headingAt use, so the drawn
// line and the car stay on the rendered asphalt.
export function primePathModel(samples: LapSample[], trackOutline: Point[]): void {
  MODEL_CACHE.set(samples, buildModel(samples, trackOutline));
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, ratio: number): number {
  const t2 = ratio * ratio;
  const t3 = t2 * ratio;
  return 0.5 * (2 * p1 + (-p0 + p2) * ratio + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// Distance the car has travelled along the line at time t (metres).
function travelledAt(model: PathModel, samples: LapSample[], t: number): number {
  const clampedT = Math.min(Math.max(t, 0), samples.at(-1)!.t);
  const rawIndex = clampedT * SAMPLE_RATE_HZ;
  const lo = Math.floor(rawIndex);
  const hi = Math.min(lo + 1, model.travel.length - 1);
  const ratio = rawIndex - lo;
  return model.travel[lo] + (model.travel[hi] - model.travel[lo]) * ratio;
}

// Point at a given arc length along the geometric path, smoothed with
// Catmull-Rom through the four surrounding points.
function pointAtArc(model: PathModel, s: number): { x: number; y: number } {
  const { pts, cumLen } = model;
  const target = Math.min(Math.max(s, 0), model.totalLen);

  // Binary search for the segment containing `target`.
  let lo = 0;
  let hi = cumLen.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumLen[mid] <= target) lo = mid;
    else hi = mid;
  }
  const segLen = cumLen[hi] - cumLen[lo] || 1;
  const ratio = (target - cumLen[lo]) / segLen;

  const last = pts.length - 1;
  const p0 = pts[Math.max(0, lo - 1)];
  const p1 = pts[lo];
  const p2 = pts[Math.min(last, hi)];
  const p3 = pts[Math.min(last, hi + 1)];
  return {
    x: catmullRom(p0.x, p1.x, p2.x, p3.x, ratio),
    y: catmullRom(p0.y, p1.y, p2.y, p3.y, ratio),
  };
}

// Smooth visual position of the car, paced by the real speed trace. Only used
// for drawing - scalar telemetry (distance, speed) stays linear in sampleAt so
// the brake-scoring math keeps reading exact recorded values.
export function positionAt(samples: LapSample[], t: number): { x: number; y: number } {
  const model = getModel(samples);
  return pointAtArc(model, travelledAt(model, samples, t));
}

// Heading from the path tangent over a fixed arc-length window. Because the
// window is measured in metres along the line (not in noisy per-sample deltas)
// the nose stays steady even where the raw position data stalls.
export function headingAt(samples: LapSample[], t: number): number {
  const model = getModel(samples);
  const s = travelledAt(model, samples, t);
  const ds = 1.5;
  const a = pointAtArc(model, Math.max(s - ds, 0));
  const b = pointAtArc(model, Math.min(s + ds, model.totalLen));
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// Smoothed polyline for a stretch of the lap, sampled from the same
// jitter-filtered Catmull-Rom path model that drives the car - use this for
// drawing driven lines/ribbons instead of raw sample points, which carry
// visible 20 Hz GPS jitter through slow corners.
export function smoothPathPoints(samples: LapSample[], t0: number, t1: number, stepS = 0.05): Point[] {
  const points: Point[] = [];
  for (let t = t0; t < t1; t += stepS) points.push(positionAt(samples, t));
  points.push(positionAt(samples, t1));
  return points;
}
