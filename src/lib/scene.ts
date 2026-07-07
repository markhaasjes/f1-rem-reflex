import type { Point } from '../types'
import type { ScreenProjection } from './canvas'

// All widths in real meters; multiply by projection.scale when drawing.
export const ROAD_WIDTH_M = 13
const CHECKER_BAND_M = 6 // sticks out 3m beyond each track edge
const CURB_WIDTH_M = 2.8
const CURB_EDGE_OFFSET_M = ROAD_WIDTH_M / 2 + 1.2
const GRAVEL_FROM_M = ROAD_WIDTH_M / 2 + 3.5
const GRAVEL_TO_M = GRAVEL_FROM_M + 26

export const PALETTE = {
  sand: '#eddbb6',
  sandLight: '#f5e9cf',
  sandSpeckle: '#d9c193',
  grass: '#55a55c',
  grassStripe: '#4b9752',
  gravel: '#dcc9a2',
  gravelSpeckle: '#b9a173',
  asphalt: '#ece7db',
  checker: '#b9b6ae',
  curbRed: '#d92b3a',
  white: '#ffffff',
}

// Deterministic PRNG so decorative speckles land in the same spots on every
// redraw - random-per-frame would shimmer during the car animation.
function mulberry32(seed: number) {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function unitNormalAt(points: Point[], index: number): Point {
  const a = points[Math.max(0, index - 1)]
  const b = points[Math.min(points.length - 1, index + 1)]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
}

// Which side of the path is the outside of the corner at `index`:
// +1/-1 multiplier for the unit normal, from the local curvature sign.
export function outsideSignAt(points: Point[], index: number): number {
  const i = Math.max(2, Math.min(points.length - 3, index))
  const before = points[i - 2]
  const at = points[i]
  const after = points[i + 2]
  const cross = (at.x - before.x) * (after.y - at.y) - (at.y - before.y) * (after.x - at.x)
  return cross >= 0 ? -1 : 1
}

function offsetPolyline(points: Point[], from: number, to: number, offsetM: number, sign: number): Point[] {
  const result: Point[] = []
  for (let i = Math.max(0, from); i <= Math.min(points.length - 1, to); i++) {
    const n = unitNormalAt(points, i)
    result.push({ x: points[i].x + n.x * offsetM * sign, y: points[i].y + n.y * offsetM * sign })
  }
  return result
}

function tracePath(ctx: CanvasRenderingContext2D, points: Point[], projection: ScreenProjection, close = false) {
  ctx.beginPath()
  points.forEach((p, i) => {
    const [x, y] = projection.toScreen(p.x, p.y)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  if (close) ctx.closePath()
}

export function nearestIndex(points: Point[], target: Point): number {
  let best = 0
  let bestDist = Infinity
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - target.x, p.y - target.y)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  return best
}

export function drawSandBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const rand = mulberry32(7)
  ctx.fillStyle = PALETTE.sand
  ctx.fillRect(0, 0, width, height)

  // lighter dune patches
  for (let i = 0; i < 5; i++) {
    ctx.beginPath()
    ctx.ellipse(rand() * width, rand() * height, (0.12 + rand() * 0.16) * width, (0.08 + rand() * 0.1) * height, rand() * Math.PI, 0, Math.PI * 2)
    ctx.fillStyle = PALETTE.sandLight
    ctx.fill()
  }

  // speckle dashes
  ctx.fillStyle = PALETTE.sandSpeckle
  for (let i = 0; i < 70; i++) {
    const x = rand() * width
    const y = rand() * height
    const w = 5 + rand() * 9
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rand() * Math.PI)
    ctx.beginPath()
    ctx.roundRect(-w / 2, -1.5, w, 3, 1.5)
    ctx.fill()
    ctx.restore()
  }
}

// The hairpin's enclosed interior, filled as striped mowed grass.
export function drawGrassInfield(ctx: CanvasRenderingContext2D, roadPath: Point[], projection: ScreenProjection) {
  ctx.save()
  tracePath(ctx, roadPath, projection, true)
  ctx.fillStyle = PALETTE.grass
  ctx.fill()
  ctx.clip()

  ctx.strokeStyle = PALETTE.grassStripe
  ctx.lineWidth = 8
  const size = Math.max(ctx.canvas.width, ctx.canvas.height)
  for (let d = -size; d < size * 2; d += 22) {
    ctx.beginPath()
    ctx.moveTo(d, 0)
    ctx.lineTo(d - size, size)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawGravelTrap(ctx: CanvasRenderingContext2D, roadPath: Point[], apexIndex: number, projection: ScreenProjection) {
  const sign = outsideSignAt(roadPath, apexIndex)
  const from = Math.max(0, apexIndex - 34)
  const to = Math.min(roadPath.length - 1, apexIndex + 26)
  const near = offsetPolyline(roadPath, from, to, GRAVEL_FROM_M, sign)
  const far = offsetPolyline(roadPath, from, to, GRAVEL_TO_M, sign)
  const polygon = [...near, ...far.reverse()]

  tracePath(ctx, polygon, projection, true)
  ctx.fillStyle = PALETTE.gravel
  ctx.fill()
  ctx.strokeStyle = PALETTE.gravel
  ctx.lineJoin = 'round'
  ctx.lineWidth = 10 * projection.scale
  ctx.stroke()

  // gravel speckles, seeded along the strip
  const rand = mulberry32(23)
  ctx.fillStyle = PALETTE.gravelSpeckle
  for (let i = 0; i < 110; i++) {
    const alongIndex = from + Math.floor(rand() * (to - from))
    const n = unitNormalAt(roadPath, alongIndex)
    const depth = GRAVEL_FROM_M + 2 + rand() * (GRAVEL_TO_M - GRAVEL_FROM_M - 4)
    const p = roadPath[alongIndex]
    const [x, y] = projection.toScreen(p.x + n.x * depth * sign, p.y + n.y * depth * sign)
    ctx.beginPath()
    ctx.arc(x, y, Math.max(1, 1.4 * projection.scale * (0.6 + rand())), 0, Math.PI * 2)
    ctx.fill()
  }
}

export function drawTrackRibbon(ctx: CanvasRenderingContext2D, roadPath: Point[], projection: ScreenProjection) {
  const s = projection.scale
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // alternating gray/white checker band along both edges
  tracePath(ctx, roadPath, projection)
  ctx.setLineDash([])
  ctx.lineWidth = (ROAD_WIDTH_M + CHECKER_BAND_M) * s
  ctx.strokeStyle = PALETTE.checker
  ctx.stroke()
  ctx.setLineDash([8 * s, 8 * s])
  ctx.strokeStyle = PALETTE.white
  ctx.stroke()
  ctx.setLineDash([])

  // asphalt
  ctx.lineWidth = ROAD_WIDTH_M * s
  ctx.strokeStyle = PALETTE.asphalt
  ctx.stroke()
}

export function drawCurb(ctx: CanvasRenderingContext2D, roadPath: Point[], from: number, to: number, sign: number, projection: ScreenProjection) {
  const s = projection.scale
  const line = offsetPolyline(roadPath, from, to, CURB_EDGE_OFFSET_M, sign)
  tracePath(ctx, line, projection)
  ctx.lineCap = 'round'
  ctx.setLineDash([])
  ctx.lineWidth = CURB_WIDTH_M * s
  ctx.strokeStyle = PALETTE.curbRed
  ctx.stroke()
  ctx.setLineDash([3.5 * s, 3.5 * s])
  ctx.strokeStyle = PALETTE.white
  ctx.stroke()
  ctx.setLineDash([])
}

export function drawDashedGuide(ctx: CanvasRenderingContext2D, points: Point[], projection: ScreenProjection) {
  const s = projection.scale
  tracePath(ctx, points, projection)
  ctx.lineCap = 'round'
  ctx.setLineDash([4 * s, 6 * s])
  ctx.lineWidth = 1.6 * s
  ctx.strokeStyle = 'rgba(120, 116, 105, 0.55)'
  ctx.stroke()
  ctx.setLineDash([])
}

export function drawRibbon(ctx: CanvasRenderingContext2D, points: Point[], color: string, projection: ScreenProjection, widthM = 4.6) {
  if (points.length < 2) return
  tracePath(ctx, points, projection)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash([])
  ctx.lineWidth = widthM * projection.scale
  ctx.strokeStyle = color
  ctx.stroke()
}

export function drawPin(ctx: CanvasRenderingContext2D, screenX: number, screenY: number, color: string, label: string) {
  ctx.beginPath()
  ctx.arc(screenX, screenY, 6, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.strokeStyle = PALETTE.white
  ctx.lineWidth = 2.5
  ctx.fill()
  ctx.stroke()

  ctx.font = "800 13px Effra, 'Helvetica Neue', Helvetica, Arial, sans-serif"
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.lineWidth = 4
  ctx.strokeStyle = PALETTE.white
  ctx.strokeText(label, screenX, screenY - 12)
  ctx.fillStyle = color
  ctx.fillText(label, screenX, screenY - 12)
}

export function drawPhaseLabel(ctx: CanvasRenderingContext2D, screenX: number, screenY: number, color: string, label: string) {
  ctx.font = "800 13px Effra, 'Helvetica Neue', Helvetica, Arial, sans-serif"
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.lineWidth = 4
  ctx.strokeStyle = PALETTE.white
  ctx.strokeText(label, screenX, screenY)
  ctx.fillStyle = color
  ctx.fillText(label, screenX, screenY)
}

export function drawScaleBar(ctx: CanvasRenderingContext2D, projection: ScreenProjection, canvasHeight: number) {
  const lengthPx = 50 * projection.scale
  const x = 16
  const y = canvasHeight - 18
  ctx.strokeStyle = '#5b5648'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + lengthPx, y)
  ctx.moveTo(x, y - 4)
  ctx.lineTo(x, y + 4)
  ctx.moveTo(x + lengthPx, y - 4)
  ctx.lineTo(x + lengthPx, y + 4)
  ctx.stroke()
  ctx.font = "700 11px Effra, 'Helvetica Neue', Helvetica, Arial, sans-serif"
  ctx.textAlign = 'center'
  ctx.fillStyle = '#5b5648'
  ctx.fillText('50 m', x + lengthPx / 2, y - 7)
}
