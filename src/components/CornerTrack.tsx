import { useEffect, useMemo, useRef } from 'react'
import type { CornerSample } from '../types'
import type { TeamLivery } from '../lib/teamLivery'
import { buildPhaseSegments, isVisiblePhase, type DrivingPhase, type VisiblePhaseSegment } from '../lib/phases'
import { computeViewBox } from '../lib/geometry'
import { fitProjection, prepareCanvas } from '../lib/canvas'
import { drawRoadSurface, drawSausageKerbs } from '../lib/canvasTrack'
import { drawF1Car } from '../lib/canvasCar'
import { useElementSize } from '../hooks/useElementSize'

interface MarkerPoint {
  x: number
  y: number
}

interface CornerTrackProps {
  /** The corner's slice of the official track geometry - same source as the circuit overview. */
  roadPath: MarkerPoint[]
  samples: CornerSample[]
  carPosition: { x: number; y: number; heading: number } | null
  livery: TeamLivery
  /** Reveal the coasting/braking/acceleration breakdown - only for screens with nothing left to guess. */
  showPhases?: boolean
  brakeMarker?: MarkerPoint | null
  playerMarker?: MarkerPoint | null
}

const PADDING_M = 35
const PHASE_LINE_WIDTH_M = 5.2

const PHASE_COLOR: Record<Exclude<DrivingPhase, 'flatout'>, string> = {
  coast: '#facc15',
  brake: '#ef4444',
  accel: '#22c55e',
}

const PHASE_LABEL: Record<Exclude<DrivingPhase, 'flatout'>, string> = {
  coast: 'Gas los',
  brake: 'Remmen',
  accel: 'Vol gas',
}

// 'accel' segments start at the apex, so bias their label toward the far end;
// 'coast'/'brake' segments end at the apex, so bias theirs toward the start.
// Keeps phase labels clear of the apex/result pins clustered around the apex.
const LABEL_DISTANCE_FRACTION: Record<Exclude<DrivingPhase, 'flatout'>, number> = {
  coast: 0.3,
  brake: 0.3,
  accel: 0.7,
}

function pointAtDistanceFraction(points: MarkerPoint[], fraction: number) {
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  }
  const target = cumulative.at(-1)! * fraction
  const index = cumulative.findIndex((d) => d >= target)
  return points[index === -1 ? points.length - 1 : index]
}

function nearestIndex(points: MarkerPoint[], target: MarkerPoint) {
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

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, label: string, textColor = 'white') {
  ctx.beginPath()
  ctx.arc(x, y, 5, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.strokeStyle = '#0b1440'
  ctx.lineWidth = 1.5
  ctx.fill()
  ctx.stroke()

  ctx.font = '800 12px Effra, "Helvetica Neue", Helvetica, Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.lineWidth = 3
  ctx.strokeStyle = '#0b1440'
  ctx.strokeText(label, x, y - 10)
  ctx.fillStyle = textColor
  ctx.fillText(label, x, y - 10)
}

export function CornerTrack({ roadPath, samples, carPosition, livery, showPhases = false, brakeMarker, playerMarker }: CornerTrackProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { width, height } = useElementSize(containerRef)

  const viewBox = useMemo(() => computeViewBox([...roadPath, ...samples], PADDING_M), [roadPath, samples])
  const projection = useMemo(() => (width > 0 && height > 0 ? fitProjection(viewBox, width, height) : null), [viewBox, width, height])

  const apexSample = useMemo(() => samples.reduce((min, s) => (s.speedKph < min.speedKph ? s : min), samples[0]), [samples])
  const phaseSegments = useMemo(
    () => (showPhases ? buildPhaseSegments(samples, apexSample.t).filter(isVisiblePhase) : []),
    [showPhases, samples, apexSample],
  )
  // Label only the longest run of each phase (skips tiny blips, e.g. a brief
  // throttle lift right before the apex) so labels don't pile up on top of
  // each other or the result pins.
  const labeledSegments = useMemo(() => {
    const longestByPhase = new Map<VisiblePhaseSegment['phase'], VisiblePhaseSegment>()
    for (const segment of phaseSegments) {
      const existing = longestByPhase.get(segment.phase)
      if (!existing || segment.points.length > existing.points.length) longestByPhase.set(segment.phase, segment)
    }
    return [...longestByPhase.values()].filter((segment) => segment.points.length >= 3)
  }, [phaseSegments])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !projection || width === 0 || height === 0) return
    const ctx = prepareCanvas(canvas, width, height)
    if (!ctx) return

    drawRoadSurface(ctx, roadPath, projection, { style: 'realistic' })
    drawSausageKerbs(ctx, roadPath, nearestIndex(roadPath, apexSample), projection)

    for (const segment of phaseSegments) {
      const screenPoints = segment.points.map((p) => projection.toScreen(p.x, p.y))
      ctx.beginPath()
      screenPoints.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.strokeStyle = PHASE_COLOR[segment.phase]
      ctx.lineWidth = PHASE_LINE_WIDTH_M * projection.scale
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    }

    for (const segment of labeledSegments) {
      const point = pointAtDistanceFraction(segment.points, LABEL_DISTANCE_FRACTION[segment.phase])
      const [x, y] = projection.toScreen(point.x, point.y)
      ctx.font = '700 11px Effra, "Helvetica Neue", Helvetica, Arial, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#0b1440'
      ctx.strokeText(PHASE_LABEL[segment.phase], x, y - 9)
      ctx.fillStyle = 'white'
      ctx.fillText(PHASE_LABEL[segment.phase], x, y - 9)
    }

    const [apexX, apexY] = projection.toScreen(apexSample.x, apexSample.y)
    drawPin(ctx, apexX, apexY, '#2f6fed', 'APEX', '#dbe6ff')
    if (brakeMarker) {
      const [x, y] = projection.toScreen(brakeMarker.x, brakeMarker.y)
      drawPin(ctx, x, y, '#22c55e', 'Rempunt')
    }
    if (playerMarker) {
      const [x, y] = projection.toScreen(playerMarker.x, playerMarker.y)
      drawPin(ctx, x, y, '#f59e0b', 'Jij')
    }

    if (carPosition) {
      drawF1Car(ctx, carPosition.x, carPosition.y, carPosition.heading, livery, 13 / 22, projection)
    }

    // scale bar
    const originX = viewBox.minX + 12
    const originY = viewBox.minY + viewBox.height - 14
    const [ox, oy] = projection.toScreen(originX, originY)
    const [ex] = projection.toScreen(originX + 50, originY)
    ctx.strokeStyle = 'white'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(ox, oy)
    ctx.lineTo(ex, oy)
    ctx.moveTo(ox, oy - 3)
    ctx.lineTo(ox, oy + 3)
    ctx.moveTo(ex, oy - 3)
    ctx.lineTo(ex, oy + 3)
    ctx.stroke()
    ctx.font = '400 9px Effra, "Helvetica Neue", Helvetica, Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = 'white'
    ctx.fillText('50 m', (ox + ex) / 2, oy - 6)
  }, [roadPath, samples, carPosition, livery, phaseSegments, labeledSegments, brakeMarker, playerMarker, apexSample, projection, width, height, viewBox])

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="sr-only">Bovenaanzicht van de bocht met de rijlijn en de raceauto</div>
    </div>
  )
}
