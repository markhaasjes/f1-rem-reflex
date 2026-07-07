import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { BrakeAttempt, TarzanFixture } from '../types'
import { computeViewBox } from '../lib/geometry'
import { fitProjection, prepareCanvas } from '../lib/canvas'
import { headingAt, sampleAt } from '../lib/corner'
import { buildPhaseSegments, isVisiblePhase, type DrivingPhase } from '../lib/phases'
import { VERSTAPPEN_LIVERY } from '../lib/teamLivery'
import { drawF1Car } from '../lib/canvasCar'
import { useElementSize } from '../hooks/useElementSize'
import {
  drawCurb,
  drawDashedGuide,
  drawGrassInfield,
  drawGravelTrap,
  drawPhaseLabel,
  drawPin,
  drawRibbon,
  drawSandBackground,
  drawScaleBar,
  drawTrackRibbon,
  nearestIndex,
  outsideSignAt,
} from '../lib/scene'

export type ScenePhase = 'idle' | 'running' | 'result'

interface CornerSceneProps {
  fixture: TarzanFixture
  phase: ScenePhase
  elapsedT: number
  playerAttempt: BrakeAttempt | null
}

const PADDING_M = 30
const CAR_SCALE = 13 / 22

const PHASE_COLOR: Record<Exclude<DrivingPhase, 'flatout'>, string> = {
  coast: '#f2a11c',
  brake: '#e10600',
  accel: '#12a37f',
}

const PHASE_LABEL_TEXT: Record<Exclude<DrivingPhase, 'flatout'>, string> = {
  coast: 'Gas los',
  brake: 'Remmen',
  accel: 'Vol gas',
}

export function CornerScene({ fixture, phase, elapsedT, playerAttempt }: CornerSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { width, height } = useElementSize(containerRef)

  const viewBox = useMemo(() => computeViewBox([...fixture.roadPath, ...fixture.samples], PADDING_M), [fixture])
  const projection = useMemo(() => (width > 0 && height > 0 ? fitProjection(viewBox, width, height) : null), [viewBox, width, height])

  const apexRoadIndex = useMemo(() => {
    const apexSample = sampleAt(fixture.samples, fixture.apexPoint.t)
    return nearestIndex(fixture.roadPath, apexSample)
  }, [fixture])

  const phaseSegments = useMemo(() => buildPhaseSegments(fixture.samples, fixture.apexPoint.t).filter(isVisiblePhase), [fixture])

  const drawResultOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, projection: NonNullable<ReturnType<typeof fitProjection>>) => {
      for (const segment of phaseSegments) {
        drawRibbon(ctx, segment.points, PHASE_COLOR[segment.phase], projection)
      }
      for (const segment of phaseSegments) {
        if (segment.points.length < 4) continue
        const mid = segment.points[Math.floor(segment.points.length / 2)]
        const [mx, my] = projection.toScreen(mid.x, mid.y)
        drawPhaseLabel(ctx, mx, my - 14, PHASE_COLOR[segment.phase], PHASE_LABEL_TEXT[segment.phase])
      }

      const brakeState = sampleAt(fixture.samples, fixture.brakePoint.t)
      const [bx, by] = projection.toScreen(brakeState.x, brakeState.y)
      drawPin(ctx, bx, by, '#0b7a43', 'Max remt')

      if (playerAttempt) {
        const playerState = sampleAt(fixture.samples, playerAttempt.t)
        const [px, py] = projection.toScreen(playerState.x, playerState.y)
        drawPin(ctx, px, py, '#1a2c8f', 'Jij')
      }
    },
    [fixture, phaseSegments, playerAttempt],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !projection || width === 0 || height === 0) return
    const ctx = prepareCanvas(canvas, width, height)
    if (!ctx) return

    // environment
    drawSandBackground(ctx, width, height)
    drawGrassInfield(ctx, fixture.roadPath, projection)
    drawGravelTrap(ctx, fixture.roadPath, apexRoadIndex, projection)
    drawTrackRibbon(ctx, fixture.roadPath, projection)
    const outside = outsideSignAt(fixture.roadPath, apexRoadIndex)
    drawCurb(ctx, fixture.roadPath, apexRoadIndex - 16, apexRoadIndex + 8, -outside, projection) // inside apex curb
    drawCurb(ctx, fixture.roadPath, apexRoadIndex + 8, apexRoadIndex + 30, outside, projection) // exit curb

    if (phase !== 'result') {
      drawDashedGuide(ctx, fixture.samples, projection)
    }

    if (phase === 'running') {
      const driven = fixture.samples.filter((s) => s.t <= elapsedT)
      drawRibbon(ctx, driven, 'rgba(225, 6, 0, 0.75)', projection)
    }

    if (phase === 'result') {
      drawResultOverlay(ctx, projection)
    }

    // idle/running: car follows the lap; result: car sits at the corner exit
    let carT = 0
    if (phase === 'running') carT = elapsedT
    else if (phase === 'result') carT = fixture.durationS
    const carState = sampleAt(fixture.samples, carT)
    const carHeading = headingAt(fixture.samples, carT)
    drawF1Car(ctx, carState.x, carState.y, carHeading, VERSTAPPEN_LIVERY, CAR_SCALE, projection)

    drawScaleBar(ctx, projection, height)
  }, [fixture, phase, elapsedT, projection, width, height, apexRoadIndex, drawResultOverlay])

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="sr-only">Bovenaanzicht van de Tarzanbocht met zand, grind, gras en de raceauto van Max Verstappen</div>
    </div>
  )
}
