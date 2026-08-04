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

// OpenF1's location feed only updates every ~15-40m of travel; the pipeline's
// 20 Hz resample lerps between updates, leaving perfectly straight fill
// segments in the trace. Through the tight Gerlach/Hugenholtz complex one
// such fill spans ~40m and rendered as an unrealistically straight racing
// line. Within the lap-meter ranges below, fill points are collapsed back to
// Max's real GPS vertices and re-curved through them with centripetal
// Catmull-Rom; every other meter of the lap is left untouched.
const REPAIR_RANGES: { fromM: number; toM: number }[] = [
  { fromM: 640, toM: 900 }, // Gerlach & Hugenholtz
];
const COLLINEAR_DEV_M = 0.06; // interior points this close to the chord are lerp fill
const DENSIFY_STEP_M = 2;
// A gap between real GPS vertices longer than this has genuinely missing
// shape (through Hugenholtz the feed skips the entire 39m hairpin arc), so
// the in-between is reconstructed along the track outline instead of guessed
// by the spline.
const GUIDE_GAP_M = 15;
const LAP_LENGTH_M = 4218;

interface TracePoint extends Point {
  d: number; // meters into lap
}

function collapseCollinearRuns(pts: Point[]): Point[] {
  const devFromChord = (a: Point, b: Point, p: Point) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return Math.abs((b.y - a.y) * (p.x - a.x) - (b.x - a.x) * (p.y - a.y)) / len;
  };
  const result: Point[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 2;
    while (j < pts.length) {
      let allOnChord = true;
      for (let k = i + 1; k < j; k++) {
        if (devFromChord(pts[i], pts[j], pts[k]) >= COLLINEAR_DEV_M) {
          allOnChord = false;
          break;
        }
      }
      if (!allOnChord) break;
      j++;
    }
    result.push(pts[j - 1]);
    i = j - 1;
  }
  return result;
}

// Centripetal Catmull-Rom (alpha 0.5) through sparse vertices: smooth, no
// cusps or overshoot at uneven spacing.
function densifyCentripetal(pts: Point[], stepM: number): Point[] {
  const knot = (a: Point, b: Point, prev: number) => prev + Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)) || prev + 1e-6;
  const dense: Point[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const t0 = 0;
    const t1 = knot(p0, p1, t0);
    const t2 = knot(p1, p2, t1);
    const t3 = knot(p2, p3, t2);
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(1, Math.ceil(segLen / stepM));
    for (let s = 1; s <= steps; s++) {
      const u = t1 + ((t2 - t1) * s) / steps;
      const lerp = (a: Point, b: Point, ta: number, tb: number): Point => {
        const w = tb - ta;
        // Degenerate knot interval (duplicate control points at the ends of a
        // slice): dividing by a fudged epsilon would break the weights'
        // partition of unity and emit points at the origin - return the
        // endpoint instead.
        if (w < 1e-9) return a;
        return {
          x: ((tb - u) / w) * a.x + ((u - ta) / w) * b.x,
          y: ((tb - u) / w) * a.y + ((u - ta) / w) * b.y,
        };
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      dense.push(lerp(b1, b2, t1, t2));
    }
  }
  return dense;
}

// Nearest outline point to `p`, seeded by lap distance (the outline is
// rotated so index 0 sits at start/finish): a bounded search around the seed
// keeps nearby parallel track sections (the pit straight runs close to
// Gerlach/Hugenholtz) from capturing the projection.
function projectOnOutline(outline: Point[], p: TracePoint): number {
  const n = outline.length;
  const seed = Math.round((((p.d % LAP_LENGTH_M) + LAP_LENGTH_M) % LAP_LENGTH_M) * (n / LAP_LENGTH_M));
  let bestJ = seed % n;
  let bestD = Infinity;
  for (let step = -25; step <= 25; step++) {
    const j = (seed + step + n) % n;
    const dist = Math.hypot(outline[j].x - p.x, outline[j].y - p.y);
    if (dist < bestD) {
      bestD = dist;
      bestJ = j;
    }
  }
  return bestJ;
}

// Fills a long data gap between two real vertices by walking the track
// outline from one to the other, blending Max's real lateral offset at the
// start into his offset at the end - the reconstructed stretch follows the
// road's curvature while staying anchored to the measured endpoints.
function guidePointsBetween(outline: Point[], a: TracePoint, b: TracePoint): Point[] {
  const n = outline.length;
  const ja = projectOnOutline(outline, a);
  const jb = projectOnOutline(outline, b);
  const stepCount = (jb - ja + n) % n;
  if (stepCount < 2 || stepCount > 60) return []; // degenerate projection: keep the chord
  const offA = { x: a.x - outline[ja].x, y: a.y - outline[ja].y };
  const offB = { x: b.x - outline[jb].x, y: b.y - outline[jb].y };
  const points: Point[] = [];
  for (let s = 1; s < stepCount; s++) {
    const j = (ja + s) % n;
    const f = s / stepCount;
    points.push({
      x: outline[j].x + offA.x * (1 - f) + offB.x * f,
      y: outline[j].y + offA.y * (1 - f) + offB.y * f,
    });
  }
  return points;
}

// Replaces kept[start..end] (a repair range plus one shared boundary point on
// each side, for tangent continuity) with the reconstruction: collapse lerp
// fill to real vertices, bridge long data gaps along the track outline, then
// re-curve the result with centripetal Catmull-Rom.
function repairStraightFills(kept: TracePoint[], outline: Point[]): Point[] {
  const spans = REPAIR_RANGES.map((range) => {
    const start = kept.findIndex((p) => p.d >= range.fromM);
    let end = start;
    while (end < kept.length && kept[end].d <= range.toM) end++;
    return { start, end };
  }).filter((s) => s.start > 0 && s.end - s.start >= 4);

  const result: Point[] = [...kept];
  // splice from the back so earlier spans' indices stay valid
  for (const { start, end } of spans.toReversed()) {
    const sliceEnd = Math.min(end + 1, kept.length);
    const sparse = collapseCollinearRuns(kept.slice(start - 1, sliceEnd)) as TracePoint[];
    const bridged: Point[] = [sparse[0]];
    for (let i = 1; i < sparse.length; i++) {
      const gap = Math.hypot(sparse[i].x - sparse[i - 1].x, sparse[i].y - sparse[i - 1].y);
      if (gap > GUIDE_GAP_M && Number.isFinite(sparse[i - 1].d) && Number.isFinite(sparse[i].d)) {
        bridged.push(...guidePointsBetween(outline, sparse[i - 1], sparse[i]));
      }
      bridged.push(sparse[i]);
    }
    const curved = densifyCentripetal(bridged, DENSIFY_STEP_M);
    result.splice(start - 1, sliceEnd - (start - 1), ...curved);
  }
  return result;
}

function buildModel(samples: LapSample[], trackOutline?: Point[]): PathModel {
  const kept: TracePoint[] = [{ x: samples[0].x, y: samples[0].y, d: samples[0].distanceM }];
  for (let i = 1; i < samples.length - 1; i++) {
    const prev = kept.at(-1)!;
    if (Math.hypot(samples[i].x - prev.x, samples[i].y - prev.y) >= MIN_SEGMENT_M) {
      kept.push({ x: samples[i].x, y: samples[i].y, d: samples[i].distanceM });
    }
  }
  const lastSample = samples.at(-1)!;
  kept.push({ x: lastSample.x, y: lastSample.y, d: lastSample.distanceM });

  // Without the outline (not primed yet) the trace is used as-is.
  const pts = trackOutline ? repairStraightFills(kept, trackOutline) : kept;

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

// Builds (and caches) the path model with the Gerlach/Hugenholtz repair
// enabled. Call once with the S/F-rotated circuit outline before any
// positionAt/headingAt use (CircuitScene does this in a memo).
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
