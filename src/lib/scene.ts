import type { Point } from '../types';
import type { ScreenProjection } from './canvas';

// All widths in real meters; multiply by projection.scale when drawing.
export const ROAD_WIDTH_M = 13;
const EDGE_LINE_M = 1.6; // white edge line sticking out past the asphalt
const CURB_WIDTH_M = 2.8;
const CURB_EDGE_OFFSET_M = ROAD_WIDTH_M / 2 + 1.2;
const GRAVEL_FROM_M = ROAD_WIDTH_M / 2 + 3.5;
const GRAVEL_TO_M = GRAVEL_FROM_M + 26;
const GREEN_BAND_M = 110; // grass corridor around the track, F1 TV map style

// Sampled from the aerial/broadcast photos in docs/corners: medium-gray
// asphalt with a lighter worn line, paved beige-gray run-offs, khaki dune
// sand with olive scrub, muted grass banks. Curbs are white + NOS red
// (docs/colors.ts redNosRood) per design.
export const PALETTE = {
  sand: '#d8cdb2',
  sandLight: '#e4dbc6',
  sandSpeckle: '#b8ab8d',
  scrub: '#a3a077',
  grass: '#5f9558',
  grassStripe: '#568a4f',
  gravel: '#b5aea1',
  gravelSpeckle: '#8f887b',
  asphalt: '#53565c',
  asphaltLight: '#5f6268',
  paddock: '#aaa8a4',
  white: '#ffffff',
  curbRed: '#e61f15', // redNosRood
  water: '#8fb8d4',
  waterEdge: '#7aa6c4',
  beach: '#efe4c3',
};

// Deterministic PRNG so decorative speckles land in the same spots on every
// redraw - random-per-frame would shimmer during the car/camera animation.
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unitNormalAt(points: Point[], index: number): Point {
  const a = points[Math.max(0, index - 1)];
  const b = points[Math.min(points.length - 1, index + 1)];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

// Which side of the path is the outside of the corner at `index`:
// +1/-1 multiplier for the unit normal, from the local curvature sign.
export function outsideSignAt(points: Point[], index: number): number {
  const i = Math.max(2, Math.min(points.length - 3, index));
  const before = points[i - 2];
  const at = points[i];
  const after = points[i + 2];
  const cross = (at.x - before.x) * (after.y - at.y) - (at.y - before.y) * (after.x - at.x);
  return cross >= 0 ? -1 : 1;
}

// Local radius of curvature (meters) and which normal side the curve's
// center lies on (+1/-1, matching unitNormalAt's orientation).
function localCurvature(points: Point[], i: number): { radiusM: number; centerSide: number } {
  const a = points[Math.max(0, i - 1)];
  const b = points[i];
  const c = points[Math.min(points.length - 1, i + 1)];
  const v1 = { x: b.x - a.x, y: b.y - a.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const cross = v1.x * v2.y - v1.y * v2.x;
  const l1 = Math.hypot(v1.x, v1.y) || 1;
  const l2 = Math.hypot(v2.x, v2.y) || 1;
  const angle = Math.abs(Math.asin(Math.max(-1, Math.min(1, cross / (l1 * l2)))));
  return { radiusM: angle > 1e-4 ? (l1 + l2) / 2 / angle : Infinity, centerSide: cross >= 0 ? 1 : -1 };
}

function offsetPolyline(points: Point[], from: number, to: number, offsetM: number, sign: number): Point[] {
  const result: Point[] = [];
  let prevBase: Point | null = null;
  for (let i = Math.max(0, from); i <= Math.min(points.length - 1, to); i++) {
    const n = unitNormalAt(points, i);
    const p = { x: points[i].x + n.x * offsetM * sign, y: points[i].y + n.y * offsetM * sign };
    // Offsetting toward the concave side of a tight bend folds the polyline
    // back on itself. Drop points whose offset segment runs against the base
    // direction or that bunch up closer than half the base spacing.
    if (prevBase && result.length > 0) {
      const prev = result.at(-1)!;
      const dot = (p.x - prev.x) * (points[i].x - prevBase.x) + (p.y - prev.y) * (points[i].y - prevBase.y);
      const baseStep = Math.hypot(points[i].x - prevBase.x, points[i].y - prevBase.y);
      if (dot <= 0 || Math.hypot(p.x - prev.x, p.y - prev.y) < baseStep * 0.5) continue;
    }
    result.push(p);
    prevBase = points[i];
  }
  return result;
}

// Like offsetPolyline, but splits into separate runs wherever the bend is
// tighter than the offset reaches (offsetting past the local center of
// curvature would put the line across the track - hairpin inside curbs).
// Connecting through such a stretch draws a bridge over the apex, so each
// side becomes its own run instead.
function offsetPolylineRuns(points: Point[], offsetM: number, sign: number): Point[][] {
  const runs: Point[][] = [];
  let current: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const { radiusM, centerSide } = localCurvature(points, i);
    if (centerSide === sign && radiusM < Math.abs(offsetM) * 1.6) {
      if (current.length > 1) runs.push(current);
      current = [];
      continue;
    }
    const n = unitNormalAt(points, i);
    current.push({ x: points[i].x + n.x * offsetM * sign, y: points[i].y + n.y * offsetM * sign });
  }
  if (current.length > 1) runs.push(current);
  return runs;
}

function tracePath(ctx: CanvasRenderingContext2D, points: Point[], projection: ScreenProjection, close = false) {
  ctx.beginPath();
  points.forEach((p, i) => {
    const [x, y] = projection.toScreen(p.x, p.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (close) ctx.closePath();
}

export function nearestIndex(points: Point[], target: Point): number {
  let best = 0;
  let bestDist = Infinity;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

// Rotates a closed outline so index 0 sits nearest `anchor`. Corner slices
// (curbs, gravel) never wrap the array boundary as long as the anchor is on a
// straight away from every sliced corner - we anchor at start/finish.
export function rotateOutline(outline: Point[], anchor: Point): Point[] {
  const start = nearestIndex(outline, anchor);
  return [...outline.slice(start), ...outline.slice(0, start)];
}

function pointInPolygon(polygon: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** +1/-1 normal multiplier that points into the interior of the closed outline. */
export function interiorSign(outline: Point[], index: number): number {
  const n = unitNormalAt(outline, index);
  const probe = { x: outline[index].x + n.x * 25, y: outline[index].y + n.y * 25 };
  return pointInPolygon(outline, probe) ? 1 : -1;
}

export function drawSandBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const rand = mulberry32(7);
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(0, 0, width, height);

  // lighter dune patches
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.ellipse(
      rand() * width,
      rand() * height,
      (0.12 + rand() * 0.16) * width,
      (0.08 + rand() * 0.1) * height,
      rand() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = PALETTE.sandLight;
    ctx.fill();
  }

  // olive dune scrub
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.ellipse(
      rand() * width,
      rand() * height,
      (0.05 + rand() * 0.09) * width,
      (0.04 + rand() * 0.06) * height,
      rand() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = PALETTE.scrub;
    ctx.globalAlpha = 0.35 + rand() * 0.2;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // speckle dashes
  ctx.fillStyle = PALETTE.sandSpeckle;
  for (let i = 0; i < 70; i++) {
    const x = rand() * width;
    const y = rand() * height;
    const w = 5 + rand() * 9;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI);
    ctx.beginPath();
    ctx.roundRect(-w / 2, -1.5, w, 3, 1.5);
    ctx.fill();
    ctx.restore();
  }
}

// The North Sea along the west edge with a beach strip, parallel to the main
// straight's tilt like on the satellite view (positions stylized closer so
// the water is visible at the overview zoom).
const COAST_X_AT_Y0 = -235; // waterline x where y = 0
const COAST_SLOPE = -0.25; // follows the coast's SSW-NNE direction
const BEACH_WIDTH_M = 70;

export function drawSea(ctx: CanvasRenderingContext2D, projection: ScreenProjection, height: number) {
  const coastAt = (y: number) => COAST_X_AT_Y0 + COAST_SLOPE * y;
  const [, yTop] = projection.toData(0, -60);
  const [, yBottom] = projection.toData(0, height + 60);

  const beach = [
    projection.toScreen(coastAt(yTop) + BEACH_WIDTH_M, yTop),
    projection.toScreen(coastAt(yBottom) + BEACH_WIDTH_M, yBottom),
    projection.toScreen(coastAt(yBottom), yBottom),
    projection.toScreen(coastAt(yTop), yTop),
  ];
  ctx.beginPath();
  beach.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = PALETTE.beach;
  ctx.fill();

  const [wTopX, wTopY] = projection.toScreen(coastAt(yTop), yTop);
  const [wBotX, wBotY] = projection.toScreen(coastAt(yBottom), yBottom);
  ctx.beginPath();
  ctx.moveTo(wTopX, wTopY);
  ctx.lineTo(wBotX, wBotY);
  ctx.lineTo(-60, height + 60);
  ctx.lineTo(-60, -60);
  ctx.closePath();
  ctx.fillStyle = PALETTE.water;
  ctx.fill();

  // two lines of surf just off the shore
  const s = projection.scale;
  for (const [offsetM, alpha] of [
    [10, 0.55],
    [24, 0.3],
  ] as const) {
    ctx.beginPath();
    const [ax, ay] = projection.toScreen(coastAt(yTop) - offsetM, yTop);
    const [bx, by] = projection.toScreen(coastAt(yBottom) - offsetM, yBottom);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = Math.max(1.2, 3.5 * s);
    ctx.setLineDash([26 * s, 14 * s]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// The dune lakes, with outlines traced from the satellite view: the curved
// pond enclosed by the eastern loop, the big kidney-shaped one and its
// neighbor in the south, and a small one in the NE dunes.
const LAKES: Point[][] = [
  [
    { x: 715, y: 105 },
    { x: 738, y: 72 },
    { x: 768, y: 54 },
    { x: 800, y: 58 },
    { x: 818, y: 78 },
    { x: 812, y: 102 },
    { x: 786, y: 118 },
    { x: 750, y: 122 },
    { x: 726, y: 118 },
  ],
  [
    { x: 245, y: 295 },
    { x: 262, y: 268 },
    { x: 295, y: 252 },
    { x: 340, y: 250 },
    { x: 362, y: 262 },
    { x: 355, y: 275 },
    { x: 378, y: 268 },
    { x: 408, y: 282 },
    { x: 418, y: 305 },
    { x: 405, y: 330 },
    { x: 372, y: 342 },
    { x: 345, y: 352 },
    { x: 305, y: 352 },
    { x: 268, y: 338 },
    { x: 250, y: 318 },
  ],
  [
    { x: 505, y: 300 },
    { x: 528, y: 278 },
    { x: 560, y: 268 },
    { x: 592, y: 276 },
    { x: 606, y: 294 },
    { x: 596, y: 314 },
    { x: 566, y: 323 },
    { x: 530, y: 318 },
  ],
  [
    { x: 722, y: -296 },
    { x: 742, y: -308 },
    { x: 763, y: -300 },
    { x: 762, y: -282 },
    { x: 740, y: -274 },
    { x: 724, y: -282 },
  ],
];

// Two rounds of closed-loop Chaikin corner-cutting turn the traced polygon
// into a natural-looking shoreline.
function chaikinClosed(points: Point[], rounds: number): Point[] {
  let pts = points;
  for (let r = 0; r < rounds; r++) {
    const out: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    pts = out;
  }
  return pts;
}

export function drawLakes(ctx: CanvasRenderingContext2D, projection: ScreenProjection) {
  const s = projection.scale;
  for (const lake of LAKES) {
    tracePath(ctx, chaikinClosed(lake, 2), projection, true);
    ctx.fillStyle = PALETTE.water;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, 2.5 * s);
    ctx.strokeStyle = PALETTE.waterEdge;
    ctx.stroke();
  }
}

// Red direction arrow beside start/finish, like the nos.nl circuit visual.
export function drawDirectionArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  headingDeg: number,
  projection: ScreenProjection,
  alpha: number,
) {
  if (alpha <= 0.01) return;
  const [sx, sy] = projection.toScreen(x, y);
  // sits just off the track, on the left of the driving direction
  const leftRad = ((headingDeg - 90) * Math.PI) / 180;
  const offset = 14 * projection.scale + 16;
  const cx = sx + Math.cos(leftRad) * offset;
  const cy = sy + Math.sin(leftRad) * offset;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#e61f15';
  ctx.strokeStyle = PALETTE.white;
  ctx.lineWidth = 2.5;
  ctx.fill();
  ctx.stroke();

  ctx.translate(cx, cy);
  ctx.rotate(((headingDeg + 90) * Math.PI) / 180);
  ctx.fillStyle = PALETTE.white;
  ctx.beginPath();
  ctx.moveTo(0, -6.5);
  ctx.lineTo(5, -0.5);
  ctx.lineTo(2, -0.5);
  ctx.lineTo(2, 6.5);
  ctx.lineTo(-2, 6.5);
  ctx.lineTo(-2, -0.5);
  ctx.lineTo(-5, -0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// The F1 TV-style green surroundings: a wide grass corridor along the track
// plus a striped fill of the whole infield. Stripes are in meters so they
// zoom with the camera instead of shimmering through it.
export function drawGreenSurroundings(ctx: CanvasRenderingContext2D, outline: Point[], projection: ScreenProjection) {
  const s = projection.scale;

  tracePath(ctx, outline, projection, true);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = GREEN_BAND_M * s;
  ctx.strokeStyle = PALETTE.grass;
  ctx.stroke();

  ctx.save();
  tracePath(ctx, outline, projection, true);
  ctx.fillStyle = PALETTE.grass;
  ctx.fill();
  ctx.clip();

  // mowing stripes, diagonal in world space
  ctx.strokeStyle = PALETTE.grassStripe;
  ctx.lineWidth = Math.max(1, 3 * s);
  const [x0, y0] = projection.toScreen(0, 0);
  const size = Math.max(ctx.canvas.width, ctx.canvas.height) * 2;
  const step = Math.max(6, 16 * s);
  const offset = ((x0 + y0) % step) - size;
  for (let d = offset; d < size; d += step) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d - size, size);
    ctx.stroke();
  }
  ctx.restore();
}

// Gray paddock block on the infield side of the start/finish straight,
// like the F1 TV map's pit complex.
export function drawPaddock(
  ctx: CanvasRenderingContext2D,
  outline: Point[],
  startFinishIndex: number,
  projection: ScreenProjection,
) {
  const sign = interiorSign(outline, startFinishIndex);
  const spacingM = 4218 / outline.length; // meters per outline point (approx)
  const back = Math.round(210 / spacingM);
  const fwd = Math.round(120 / spacingM);
  const from = Math.max(0, startFinishIndex - back);
  const to = Math.min(outline.length - 1, startFinishIndex + fwd);
  const near = offsetPolyline(outline, from, to, ROAD_WIDTH_M / 2 + 8, sign);
  const far = offsetPolyline(outline, from, to, ROAD_WIDTH_M / 2 + 75, sign);
  const polygon = [...near, ...far.reverse()];

  tracePath(ctx, polygon, projection, true);
  ctx.fillStyle = PALETTE.paddock;
  ctx.fill();

  // a few pit buildings
  const rand = mulberry32(41);
  ctx.fillStyle = '#9fa3a8';
  for (let i = 0; i < 5; i++) {
    const idx = from + Math.round(((i + 0.5) / 5) * (to - from));
    const n = unitNormalAt(outline, idx);
    const depth = 16 + rand() * 30;
    const p = outline[idx];
    const [x, y] = projection.toScreen(p.x + n.x * depth * sign, p.y + n.y * depth * sign);
    const w = (18 + rand() * 14) * projection.scale;
    const h = (10 + rand() * 8) * projection.scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(n.y, n.x) + Math.PI / 2);
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(2, h / 4));
    ctx.fill();
    ctx.restore();
  }
}

export function drawGravelTrap(
  ctx: CanvasRenderingContext2D,
  roadPath: Point[],
  apexIndex: number,
  projection: ScreenProjection,
  extent: { backM: number; fwdM: number },
) {
  const sign = outsideSignAt(roadPath, apexIndex);
  const spacingM = 4218 / roadPath.length;
  const from = Math.max(0, apexIndex - Math.round(extent.backM / spacingM));
  const to = Math.min(roadPath.length - 1, apexIndex + Math.round(extent.fwdM / spacingM));

  // Stroke an offset centerline instead of filling a near/far polygon: a
  // polygon's far edge self-intersects on tight hairpins (visible fold at
  // Kumhobocht), while a wide round-join stroke stays clean at any curvature.
  const centerline = offsetPolyline(roadPath, from, to, (GRAVEL_FROM_M + GRAVEL_TO_M) / 2, sign);
  tracePath(ctx, centerline, projection);
  ctx.strokeStyle = PALETTE.gravel;
  ctx.lineJoin = 'round';
  // butt caps: a round cap wraps past the apex on hairpins and shows up as a
  // detached gravel blob on the far side of the track
  ctx.lineCap = 'butt';
  ctx.lineWidth = (GRAVEL_TO_M - GRAVEL_FROM_M) * projection.scale;
  ctx.stroke();
  ctx.lineCap = 'round';

  // gravel speckles, seeded along the strip
  const rand = mulberry32(23 + apexIndex);
  ctx.fillStyle = PALETTE.gravelSpeckle;
  for (let i = 0; i < 70; i++) {
    const alongIndex = from + Math.floor(rand() * (to - from));
    const n = unitNormalAt(roadPath, alongIndex);
    const depth = GRAVEL_FROM_M + 2 + rand() * (GRAVEL_TO_M - GRAVEL_FROM_M - 4);
    const p = roadPath[alongIndex];
    const [x, y] = projection.toScreen(p.x + n.x * depth * sign, p.y + n.y * depth * sign);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.6, 1.4 * projection.scale * (0.6 + rand())), 0, Math.PI * 2);
    ctx.fill();
  }
}

// Dark asphalt ribbon with a bright white edge, like the F1 TV circuit map.
export function drawTrackRibbon(
  ctx: CanvasRenderingContext2D,
  outline: Point[],
  projection: ScreenProjection,
  close = true,
) {
  const s = projection.scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  tracePath(ctx, outline, projection, close);
  ctx.lineWidth = (ROAD_WIDTH_M + EDGE_LINE_M * 2) * s;
  ctx.strokeStyle = PALETTE.white;
  ctx.stroke();

  ctx.lineWidth = ROAD_WIDTH_M * s;
  ctx.strokeStyle = PALETTE.asphalt;
  ctx.stroke();

  // subtle worn racing-line sheen down the middle
  ctx.lineWidth = ROAD_WIDTH_M * 0.45 * s;
  ctx.strokeStyle = PALETTE.asphaltLight;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// Two rounds of Chaikin corner-cutting on a slice: quadruples the point count
// and rounds tight vertices, so curb offsets stay smooth on hairpin apexes
// where the raw ~3m outline spacing is too coarse.
function chaikinSlice(points: Point[], from: number, to: number): Point[] {
  let pts = points.slice(Math.max(0, from), Math.min(points.length - 1, to) + 1);
  for (let iter = 0; iter < 2; iter++) {
    const out: Point[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts.at(-1)!);
    pts = out;
  }
  return pts;
}

export function drawCurb(
  ctx: CanvasRenderingContext2D,
  roadPath: Point[],
  from: number,
  to: number,
  sign: number,
  projection: ScreenProjection,
) {
  const s = projection.scale;
  const dense = chaikinSlice(roadPath, from, to);
  for (const run of offsetPolylineRuns(dense, CURB_EDGE_OFFSET_M, sign)) {
    tracePath(ctx, run, projection);
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.lineWidth = CURB_WIDTH_M * s;
    ctx.strokeStyle = PALETTE.curbRed;
    ctx.stroke();
    ctx.setLineDash([3.5 * s, 3.5 * s]);
    ctx.strokeStyle = PALETTE.white;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export interface CurbExtent {
  /** meters of inside curb before the apex */
  backM: number;
  /** meters of inside curb past the apex */
  fwdInM: number;
  /** meters of outside (exit) curb past the apex */
  fwdOutM: number;
}

// Red/white curbs on both sides of a corner (inside apex + outside exit),
// with per-corner extents tuned against the docs/corners photos.
export function drawCornerCurbs(
  ctx: CanvasRenderingContext2D,
  outline: Point[],
  cornerIndex: number,
  projection: ScreenProjection,
  extent: CurbExtent = { backM: 55, fwdInM: 33, fwdOutM: 55 },
) {
  const spacingM = 4218 / outline.length;
  const toIdx = (m: number) => Math.round(m / spacingM);
  const outside = outsideSignAt(outline, cornerIndex);
  drawCurb(ctx, outline, cornerIndex - toIdx(extent.backM), cornerIndex + toIdx(extent.fwdInM), -outside, projection);
  drawCurb(ctx, outline, cornerIndex, cornerIndex + toIdx(extent.fwdOutM), outside, projection);
}

export function drawStartFinish(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  headingDeg: number,
  projection: ScreenProjection,
) {
  const s = projection.scale;
  const [px, py] = projection.toScreen(x, y);
  const cell = 1.7 * s;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(((headingDeg + 90) * Math.PI) / 180);
  const cols = Math.ceil((ROAD_WIDTH_M * s) / cell);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#1e1e1e' : PALETTE.white;
      ctx.fillRect((col - cols / 2) * cell, (row - 1.5) * cell, cell + 0.5, cell + 0.5);
    }
  }
  ctx.restore();
}

export function drawRibbon(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  projection: ScreenProjection,
  widthM = 4.6,
) {
  if (points.length < 2) return;
  tracePath(ctx, points, projection);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  ctx.lineWidth = widthM * projection.scale;
  ctx.strokeStyle = color;
  ctx.stroke();
}

// Corner-number badge in the NOS bochten-kaart style, fixed screen size.
// `minor` badges (corners the game never visits) render small and muted so
// the four playable corners carry the map.
export function drawCornerBadge(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  label: string,
  opts: { highlight?: boolean; minor?: boolean; alpha?: number; compact?: boolean } = {},
) {
  const { highlight = false, minor = false, alpha = 1, compact = false } = opts;
  if (alpha <= 0.01) return;
  const scale = compact ? 0.8 : 1;
  let r = 11;
  if (highlight) r = 14;
  else if (minor) r = 7;
  r *= scale;
  ctx.save();
  ctx.globalAlpha = minor ? alpha * 0.55 : alpha;
  ctx.beginPath();
  ctx.arc(screenX, screenY, r, 0, Math.PI * 2);
  // Black circle, white number, white ring - the NOS WK-stand graphic style.
  ctx.fillStyle = '#1e1e1e';
  ctx.strokeStyle = PALETTE.white;
  ctx.lineWidth = minor ? 1.5 : 2.5;
  ctx.fill();
  ctx.stroke();
  let fontPx = 12;
  if (highlight) fontPx = 15;
  else if (minor) fontPx = 9;
  ctx.font = `800 ${Math.round(fontPx * scale)}px Effra, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.white;
  ctx.fillText(label, screenX, screenY + 0.5);
  ctx.restore();
}

// White name label with a dark halo, offset from a badge.
export function drawMapLabel(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  label: string,
  alpha = 1,
  fontPx = 13,
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `800 ${fontPx}px Effra, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#0b1440';
  ctx.strokeText(label, screenX, screenY);
  ctx.fillStyle = PALETTE.white;
  ctx.fillText(label, screenX, screenY);
  ctx.restore();
}

export function drawPin(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  color: string,
  label: string,
  labelBelow = false,
) {
  ctx.beginPath();
  ctx.arc(screenX, screenY, 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = PALETTE.white;
  ctx.lineWidth = 2.5;
  ctx.fill();
  ctx.stroke();

  // Max's pins label above the dot, the player's below, so a well-timed mark
  // (player pin landing on Max's) doesn't stack the two labels illegibly.
  const labelY = labelBelow ? screenY + 20 : screenY - 12;
  ctx.font = "800 13px Effra, 'Helvetica Neue', Helvetica, Arial, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 4;
  ctx.strokeStyle = PALETTE.white;
  ctx.strokeText(label, screenX, labelY);
  ctx.fillStyle = color;
  ctx.fillText(label, screenX, labelY);
}

export function drawScaleBar(ctx: CanvasRenderingContext2D, projection: ScreenProjection, canvasHeight: number) {
  // pick a round meter length that lands between 40 and 110 px on screen
  const candidates = [25, 50, 100, 200, 500, 1000];
  const lengthM = candidates.find((m) => m * projection.scale >= 40 && m * projection.scale <= 110) ?? 50;
  const lengthPx = lengthM * projection.scale;
  if (lengthPx < 20 || lengthPx > 200) return;
  const x = 16;
  const y = canvasHeight - 18;
  ctx.strokeStyle = '#5b5648';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + lengthPx, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + lengthPx, y - 4);
  ctx.lineTo(x + lengthPx, y + 4);
  ctx.stroke();
  ctx.font = "700 11px Effra, 'Helvetica Neue', Helvetica, Arial, sans-serif";
  ctx.textAlign = 'center';
  ctx.fillStyle = '#5b5648';
  ctx.fillText(`${lengthM} m`, x + lengthPx / 2, y - 7);
}
