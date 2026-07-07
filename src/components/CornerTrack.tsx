import { useMemo } from 'react'
import type { CornerSample } from '../types'

interface MarkerPoint {
  x: number
  y: number
}

interface CornerTrackProps {
  samples: CornerSample[]
  carPosition: { x: number; y: number; heading: number } | null
  teamColor: string
  brakeMarker?: MarkerPoint | null
  playerMarker?: MarkerPoint | null
  apexMarker?: MarkerPoint | null
}

const PADDING_M = 35

function Pin({ x, y, color, label }: MarkerPoint & { color: string; label: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={4.5} fill={color} stroke="white" strokeWidth={1.5} />
      <text
        x={0}
        y={-9}
        textAnchor="middle"
        fontSize={9}
        fontWeight={700}
        fill="white"
        stroke="#0b1440"
        strokeWidth={2.5}
        paintOrder="stroke"
      >
        {label}
      </text>
    </g>
  )
}

export function CornerTrack({ samples, carPosition, teamColor, brakeMarker, playerMarker, apexMarker }: CornerTrackProps) {
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

  const scaleBarOrigin = { x: viewBox.minX + 12, y: viewBox.minY + viewBox.height - 14 }

  return (
    <svg
      viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
      className="h-full w-full"
      role="img"
      aria-label="Bovenaanzicht van de Tarzanbocht met de baanlijn en de raceauto"
    >
      <polyline points={points} fill="none" stroke="#101d63" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={points} fill="none" stroke="white" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={points} fill="none" stroke="#c7d2fe" strokeWidth={1} strokeDasharray="3 4" strokeLinecap="round" opacity={0.7} />

      {apexMarker && <Pin {...apexMarker} color="#facc15" label="Apex" />}
      {brakeMarker && <Pin {...brakeMarker} color="#22c55e" label="Rempunt" />}
      {playerMarker && <Pin {...playerMarker} color="#ef4444" label="Jij" />}

      {carPosition && (
        <g transform={`translate(${carPosition.x} ${carPosition.y}) rotate(${carPosition.heading})`}>
          <path d="M -9 6 L 9 6 L 12 0 L 9 -6 L -9 -6 L -12 0 Z" fill={teamColor} stroke="white" strokeWidth={1.8} />
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
