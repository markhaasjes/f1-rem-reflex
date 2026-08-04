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
const MIN_VERTEX_SPACING_M = 7;
const LAP_LENGTH_M = 4218;
// Half-width, in ~3m outline-grid anchors, of the moving average applied to
// the lateral-offset field inside a repair range (so ~33m full window).
const OFFSET_SMOOTH_WINDOW = 5;
// Half-width, in segments, of the moving average applied to the turn-angle
// profile inside a repair range (~24m full window).
const TURN_SMOOTH_WINDOW = 4;

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

// Evens out the curvature profile of a polyline. The official outline has a
// brief zero-curvature dip in the middle of the Hugenholtz bowl (the real
// corner is one continuous arc); the wide road band masks it, but the thin
// race line exposes it as a straight facet. Smoothing the per-segment turn
// angles fills such dips, and the rebuilt polyline is pinned back onto both
// endpoints with a tiny rotation+scale about the start, so the seams stay on
// measured data.
function smoothTurnProfile(pts: Point[], window: number): Point[] {
  if (pts.length < 4) return pts;
  const headings: number[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    headings.push(Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x));
    lengths.push(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y));
  }
  const turns: number[] = [0];
  for (let i = 1; i < headings.length; i++) {
    let t = headings[i] - headings[i - 1];
    while (t > Math.PI) t -= 2 * Math.PI;
    while (t < -Math.PI) t += 2 * Math.PI;
    turns.push(t);
  }
  const smoothTurns = turns.map((_, i) => {
    const w = Math.min(window, i, turns.length - 1 - i);
    let sum = 0;
    for (let k = i - w; k <= i + w; k++) sum += turns[k];
    return sum / (2 * w + 1);
  });

  const rebuilt: Point[] = [pts[0]];
  let heading = headings[0];
  for (let i = 0; i < lengths.length; i++) {
    if (i > 0) heading += smoothTurns[i];
    rebuilt.push({
      x: rebuilt[i].x + Math.cos(heading) * lengths[i],
      y: rebuilt[i].y + Math.sin(heading) * lengths[i],
    });
  }

  // pin the rebuilt end back onto the measured end point
  const startPt = pts[0];
  const target = pts.at(-1)!;
  const got = rebuilt.at(-1)!;
  const va = { x: target.x - startPt.x, y: target.y - startPt.y };
  const vb = { x: got.x - startPt.x, y: got.y - startPt.y };
  const rot = Math.atan2(va.y, va.x) - Math.atan2(vb.y, vb.x);
  const scale = Math.hypot(va.x, va.y) / (Math.hypot(vb.x, vb.y) || 1);
  const cos = Math.cos(rot) * scale;
  const sin = Math.sin(rot) * scale;
  return rebuilt.map((p) => ({
    x: startPt.x + (p.x - startPt.x) * cos - (p.y - startPt.y) * sin,
    y: startPt.y + (p.x - startPt.x) * sin + (p.y - startPt.y) * cos,
  }));
}

// Replaces kept[start..end] (a repair range plus one shared boundary point on
// each side, for tangent continuity) with the reconstruction:
//
//   1. collapse lerp fill to Max's real GPS vertices and thin jittery
//      near-duplicates;
//   2. re-express the whole slice on the track outline's ~3m grid: every
//      vertex becomes (outline anchor, lateral offset), gaps get
//      linearly-blended offsets;
//   3. low-pass the offset field (endpoints pinned). This is what makes the
//      hairpin genuinely curved: Max sweeps ~5m from the outside to the
//      inside of the corner, and blending that swing linearly per segment
//      visibly straightens the arc - smoothing the offsets lets the road's
//      curvature dominate while his line still drifts out-to-in;
//   4. re-curve with centripetal Catmull-Rom.
function repairStraightFills(kept: TracePoint[], outline: Point[]): Point[] {
  const n = outline.length;
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
    const collapsed = collapseCollinearRuns(kept.slice(start - 1, sliceEnd)) as TracePoint[];
    // Thin near-duplicate vertices: real GPS points 2-5m apart carry ~1m of
    // lateral jitter, which the spline turns into a visible wobble.
    const sparse: TracePoint[] = [collapsed[0]];
    for (let i = 1; i < collapsed.length - 1; i++) {
      const prev = sparse.at(-1)!;
      if (Math.hypot(collapsed[i].x - prev.x, collapsed[i].y - prev.y) >= MIN_VERTEX_SPACING_M) {
        sparse.push(collapsed[i]);
      }
    }
    sparse.push(collapsed.at(-1)!);

    // Anchor every vertex to the outline grid and fill the gaps with
    // linearly-blended offsets, one anchor per outline point.
    const anchors: { j: number; off: Point }[] = [];
    const pushAnchor = (j: number, off: Point) => {
      if (anchors.length === 0 || anchors.at(-1)!.j !== j) anchors.push({ j, off });
    };
    let prevJ = projectOnOutline(outline, sparse[0]);
    pushAnchor(prevJ, { x: sparse[0].x - outline[prevJ].x, y: sparse[0].y - outline[prevJ].y });
    for (let i = 1; i < sparse.length; i++) {
      const j = projectOnOutline(outline, sparse[i]);
      const off = { x: sparse[i].x - outline[j].x, y: sparse[i].y - outline[j].y };
      const stepCount = (j - prevJ + n) % n;
      if (stepCount >= 2 && stepCount <= 60) {
        const prevOff = anchors.at(-1)!.off;
        for (let s = 1; s < stepCount; s++) {
          const f = s / stepCount;
          pushAnchor((prevJ + s) % n, {
            x: prevOff.x * (1 - f) + off.x * f,
            y: prevOff.y * (1 - f) + off.y * f,
          });
        }
      }
      pushAnchor(j, off);
      prevJ = j;
    }

    // Low-pass the offset field with a tapered moving average: full window in
    // the interior, shrinking to zero at the ends so the seams stay pinned to
    // the measured boundary points.
    const smoothedOffsets = anchors.map((_, i) => {
      const w = Math.min(OFFSET_SMOOTH_WINDOW, i, anchors.length - 1 - i);
      let sx = 0;
      let sy = 0;
      for (let k = i - w; k <= i + w; k++) {
        sx += anchors[k].off.x;
        sy += anchors[k].off.y;
      }
      return { x: sx / (2 * w + 1), y: sy / (2 * w + 1) };
    });
    const bridged = anchors.map((a, i) => ({
      x: outline[a.j].x + smoothedOffsets[i].x,
      y: outline[a.j].y + smoothedOffsets[i].y,
    }));

    const shaped = smoothTurnProfile(bridged, TURN_SMOOTH_WINDOW);
    const curved = densifyCentripetal(shaped, DENSIFY_STEP_M);
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
