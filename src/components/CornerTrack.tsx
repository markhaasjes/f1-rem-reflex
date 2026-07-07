import { useMemo } from 'react'
import type { CornerSample } from '../types'
import type { TeamLivery } from '../lib/teamLivery'
import { buildPhaseSegments, isVisiblePhase, type DrivingPhase, type VisiblePhaseSegment } from '../lib/phases'
import { F1Car } from './F1Car'

interface MarkerPoint {
  x: number
  y: number
}

interface CornerTrackProps {
  samples: CornerSample[]
  carPosition: { x: number; y: number; heading: number } | null
  livery: TeamLivery
  /** Reveal the coasting/braking/acceleration breakdown - only for screens with nothing left to guess. */
  showPhases?: boolean
  brakeMarker?: MarkerPoint | null
  playerMarker?: MarkerPoint | null
}

const PADDING_M = 35
const ROAD_WIDTH_M = 13
const CURB_WIDTH_M = 18
const PHASE_LINE_WIDTH_M = ROAD_WIDTH_M * 0.4

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

function pointAtDistanceFraction(points: { x: number; y: number }[], fraction: number) {
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  }
  const target = cumulative.at(-1)! * fraction
  const index = cumulative.findIndex((d) => d >= target)
  return points[index === -1 ? points.length - 1 : index]
}

function Pin({ x, y, color, label, textColor = 'white', fontSize = 9 }: MarkerPoint & { color: string; label: string; textColor?: string; fontSize?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={4.5} fill={color} stroke="#0b1440" strokeWidth={1.5} />
      <text
        x={0}
        y={-9}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight={800}
        fill={textColor}
        stroke="#0b1440"
        strokeWidth={2.5}
        paintOrder="stroke"
      >
        {label}
      </text>
    </g>
  )
}

export function CornerTrack({ samples, carPosition, livery, showPhases = false, brakeMarker, playerMarker }: CornerTrackProps) {
  const viewBox = useMemo(() => {
    const xs = samples.map((s) => s.x)
    const ys = samples.map((s) => s.y)
    const minX = Math.min(...xs) - PADDING_M
    const minY = Math.min(...ys) - PADDING_M
    const width = Math.max(...xs) - Math.min(...xs) + PADDING_M * 2
    const height = Math.max(...ys) - Math.min(...ys) + PADDING_M * 2
    return { minX, minY, width, height }
  }, [samples])

  const points = useMemo(() => samples.map((s) => `${s.x},${s.y}`).join(' '), [samples])
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

  const carScale = ROAD_WIDTH_M / 22
  const scaleBarOrigin = { x: viewBox.minX + 12, y: viewBox.minY + viewBox.height - 14 }

  return (
    <svg
      viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
      className="h-full w-full"
      role="img"
      aria-label="Bovenaanzicht van de bocht met de rijlijn en de raceauto"
    >
      {/* checkered curb peeking out on both edges */}
      <polyline points={points} fill="none" stroke="#c81e2c" strokeWidth={CURB_WIDTH_M} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={points} fill="none" stroke="#f5f4ef" strokeWidth={CURB_WIDTH_M} strokeDasharray="9 9" strokeLinejoin="round" />

      {/* asphalt road surface */}
      <polyline points={points} fill="none" stroke="#e9e5d6" strokeWidth={ROAD_WIDTH_M} strokeLinecap="round" strokeLinejoin="round" />

      {phaseSegments.map((segment) => (
        <polyline
          key={`${segment.phase}-${segment.points[0].x}-${segment.points[0].y}`}
          points={segment.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={PHASE_COLOR[segment.phase]}
          strokeWidth={PHASE_LINE_WIDTH_M}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}

      {labeledSegments.map((segment) => {
        const label = pointAtDistanceFraction(segment.points, LABEL_DISTANCE_FRACTION[segment.phase])
        return (
          <text
            key={`${segment.phase}-label-${segment.points[0].x}-${segment.points[0].y}`}
            x={label.x}
            y={label.y - 8}
            textAnchor="middle"
            fontSize={8}
            fontWeight={700}
            fill="white"
            stroke="#0b1440"
            strokeWidth={2}
            paintOrder="stroke"
          >
            {PHASE_LABEL[segment.phase]}
          </text>
        )
      })}

      <Pin x={apexSample.x} y={apexSample.y} color="#2f6fed" label="APEX" textColor="#dbe6ff" fontSize={12} />
      {brakeMarker && <Pin {...brakeMarker} color="#22c55e" label="Rempunt" />}
      {playerMarker && <Pin {...playerMarker} color="#f59e0b" label="Jij" />}

      {carPosition && (
        <g transform={`translate(${carPosition.x} ${carPosition.y}) rotate(${carPosition.heading})`}>
          <F1Car livery={livery} size={carScale} />
        </g>
      )}

      <g transform={`translate(${scaleBarOrigin.x} ${scaleBarOrigin.y})`}>
        <line x1={0} y1={0} x2={50} y2={0} stroke="white" strokeWidth={1.5} />
        <line x1={0} y1={-3} x2={0} y2={3} stroke="white" strokeWidth={1.5} />
        <line x1={50} y1={-3} x2={50} y2={3} stroke="white" strokeWidth={1.5} />
        <text x={25} y={-6} textAnchor="middle" fontSize={9} fill="white">
          50 m
        </text>
      </g>
    </svg>
  )
}
