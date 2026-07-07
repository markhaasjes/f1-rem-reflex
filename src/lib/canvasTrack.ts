import { line as d3line } from 'd3-shape'
import type { ScreenProjection } from './canvas'
import type { OrientedPoint } from '../types'

const ROAD_WIDTH_M = 13
const CURB_WIDTH_M = 18
const RUNOFF_WIDTH_M = 60

let grassPattern: CanvasPattern | null = null

// Real grass banking is mowed in straight stripes regardless of track
// curvature, so a fixed canvas-space tile (not path-following) is accurate,
// not just an easy shortcut.
function getGrassPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (grassPattern) return grassPattern
  const size = 16
  const tile = document.createElement('canvas')
  tile.width = size
  tile.height = size
  const tileCtx = tile.getContext('2d')!
  tileCtx.fillStyle = '#3f9e4d'
  tileCtx.fillRect(0, 0, size, size)
  tileCtx.fillStyle = '#388f45'
  tileCtx.fillRect(0, 0, size, size / 2)
  grassPattern = ctx.createPattern(tile, 'repeat')!
  return grassPattern
}

function toScreenPath(points: { x: number; y: number }[], projection: ScreenProjection): Path2D {
  const screenPoints: [number, number][] = points.map((p) => projection.toScreen(p.x, p.y))
  const generator = d3line()
  return new Path2D(generator(screenPoints) ?? '')
}

interface RoadStyleOptions {
  /**
   * 'map': schematic white-on-navy line for the circuit overview.
   * 'realistic': grass run-off, red/white curbs and dark asphalt for the
   * zoomed-in corner - same geometry, more detail.
   */
  style: 'map' | 'realistic'
}

export function drawRoadSurface(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], projection: ScreenProjection, { style }: RoadStyleOptions) {
  const path = toScreenPath(points, projection)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (style === 'map') {
    ctx.lineWidth = 20 * projection.scale
    ctx.strokeStyle = '#101d63'
    ctx.stroke(path)
    ctx.lineWidth = 13 * projection.scale
    ctx.strokeStyle = 'white'
    ctx.stroke(path)
    return
  }

  ctx.lineWidth = RUNOFF_WIDTH_M * projection.scale
  ctx.strokeStyle = getGrassPattern(ctx)
  ctx.stroke(path)

  // checkered curb: solid red base, white dashes on top
  ctx.setLineDash([])
  ctx.lineWidth = CURB_WIDTH_M * projection.scale
  ctx.strokeStyle = '#c81e2c'
  ctx.stroke(path)
  ctx.setLineDash([9 * projection.scale, 9 * projection.scale])
  ctx.strokeStyle = '#f5f4ef'
  ctx.stroke(path)
  ctx.setLineDash([])

  // asphalt with a faint worn racing-line sheen
  ctx.lineWidth = ROAD_WIDTH_M * projection.scale
  ctx.strokeStyle = '#55524c'
  ctx.stroke(path)
  ctx.lineWidth = ROAD_WIDTH_M * 0.12 * projection.scale
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.stroke(path)
}

// Orange "sausage" kerbs clustered at the apex, offset toward the outside of
// the corner (determined by the curvature sign right at the apex).
export function drawSausageKerbs(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], apexIndex: number, projection: ScreenProjection) {
  const n = points.length
  if (n < 5) return
  const clampedApex = Math.max(2, Math.min(n - 3, apexIndex))

  const before = points[clampedApex - 2]
  const at = points[clampedApex]
  const after = points[clampedApex + 2]
  const tangentBefore = { x: at.x - before.x, y: at.y - before.y }
  const tangentAfter = { x: after.x - at.x, y: after.y - at.y }
  const cross = tangentBefore.x * tangentAfter.y - tangentBefore.y * tangentAfter.x
  const turnSign = cross >= 0 ? 1 : -1

  const offsetM = (CURB_WIDTH_M + 6) / 2

  for (let i = clampedApex - 2; i <= clampedApex + 2; i++) {
    const idx = Math.max(1, Math.min(n - 2, i))
    const a = points[idx - 1]
    const b = points[idx + 1]
    const p = points[idx]
    const tangentLen = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = (-(b.y - a.y) / tangentLen) * turnSign
    const ny = ((b.x - a.x) / tangentLen) * turnSign
    const headingRad = Math.atan2(b.y - a.y, b.x - a.x)
    const [px, py] = projection.toScreen(p.x + nx * offsetM, p.y + ny * offsetM)

    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(headingRad)
    const length = 7 * projection.scale
    const width = 2.6 * projection.scale
    ctx.fillStyle = '#f2811d'
    ctx.beginPath()
    ctx.roundRect(-length / 2, -width / 2, length, width, width / 2)
    ctx.fill()
    ctx.restore()
  }
}

export function drawGrandstand(ctx: CanvasRenderingContext2D, stand: OrientedPoint, projection: ScreenProjection) {
  const [px, py] = projection.toScreen(stand.x, stand.y)
  const s = projection.scale
  ctx.save()
  ctx.translate(px, py)
  ctx.rotate((stand.headingDeg * Math.PI) / 180)

  ctx.fillStyle = '#F2C230'
  ctx.strokeStyle = '#8a6d1a'
  ctx.lineWidth = 1.4 * s
  ctx.beginPath()
  ctx.roundRect(-13 * s, -5.5 * s, 26 * s, 11 * s, 2 * s)
  ctx.fill()
  ctx.stroke()

  ctx.strokeStyle = '#c99f1c'
  ctx.lineWidth = 0.8 * s
  ctx.beginPath()
  ctx.moveTo(-11 * s, -1.8 * s)
  ctx.lineTo(11 * s, -1.8 * s)
  ctx.moveTo(-11 * s, 1.8 * s)
  ctx.lineTo(11 * s, 1.8 * s)
  ctx.stroke()
  ctx.restore()
}

export function drawStartFinishLine(ctx: CanvasRenderingContext2D, point: OrientedPoint, projection: ScreenProjection) {
  const [px, py] = projection.toScreen(point.x, point.y)
  const s = projection.scale
  ctx.save()
  ctx.translate(px, py)
  ctx.rotate(((point.headingDeg + 90) * Math.PI) / 180)
  ctx.lineCap = 'round'

  ctx.strokeStyle = 'white'
  ctx.lineWidth = 6 * s
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(-15 * s, 0)
  ctx.lineTo(15 * s, 0)
  ctx.stroke()

  ctx.strokeStyle = '#111827'
  ctx.setLineDash([3.2 * s, 3.2 * s])
  ctx.beginPath()
  ctx.moveTo(-15 * s, 0)
  ctx.lineTo(15 * s, 0)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}
