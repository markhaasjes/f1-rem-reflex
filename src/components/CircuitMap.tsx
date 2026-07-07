import { useMemo } from 'react'
import type { CircuitCorner, CircuitData, OrientedPoint } from '../types'
import type { ViewBox } from '../lib/geometry'

interface CircuitMapProps {
  circuit: CircuitData
  viewBox: ViewBox
  onSelectCorner: (corner: CircuitCorner) => void
}

// Corners 2-12 sit close together; rotating the label through three positions
// means adjacent corners rarely land in the same spot.
const LABEL_POSITIONS = [
  { x: 22, y: 0, textAnchor: 'start' as const },
  { x: 0, y: 27, textAnchor: 'middle' as const },
  { x: -22, y: -18, textAnchor: 'end' as const },
]

function Grandstand({ x, y, headingDeg }: OrientedPoint) {
  return (
    <rect
      x={-12}
      y={-4.5}
      width={24}
      height={9}
      rx={1.5}
      fill="#dde1e8"
      stroke="#7d8390"
      strokeWidth={1}
      transform={`translate(${x} ${y}) rotate(${headingDeg})`}
    />
  )
}

function StartFinishLine({ x, y, headingDeg }: OrientedPoint) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${headingDeg + 90})`}>
      <line x1={-15} y1={0} x2={15} y2={0} stroke="white" strokeWidth={6} strokeLinecap="round" />
      <line x1={-15} y1={0} x2={15} y2={0} stroke="#111827" strokeWidth={6} strokeLinecap="round" strokeDasharray="3.2 3.2" />
    </g>
  )
}

export function CircuitMap({ circuit, viewBox, onSelectCorner }: CircuitMapProps) {
  const points = useMemo(() => circuit.trackOutline.map((p) => `${p.x},${p.y}`).join(' '), [circuit])

  return (
    <svg
      viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
      className="h-full w-full"
      role="img"
      aria-label={`Circuitkaart van ${circuit.meta.circuit} met alle veertien bochten`}
    >
      {circuit.grandstands.map((stand) => (
        <Grandstand key={`${stand.x}-${stand.y}`} {...stand} />
      ))}

      <polyline points={points} fill="none" stroke="#101d63" strokeWidth={20} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={points} fill="none" stroke="white" strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" />

      <StartFinishLine {...circuit.startFinish} />

      {circuit.corners.map((corner) => {
        const labelProps = LABEL_POSITIONS[corner.number % LABEL_POSITIONS.length]

        return (
          <g
            key={corner.number}
            transform={`translate(${corner.x} ${corner.y})`}
            className="cursor-pointer"
            onClick={() => onSelectCorner(corner)}
            role="button"
            tabIndex={0}
            aria-label={`Bocht ${corner.number}: ${corner.name}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelectCorner(corner)
            }}
          >
            <circle r={17} fill="#2f6fed" stroke="white" strokeWidth={3} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={17} fontWeight={800} fill="white">
              {corner.number}
            </text>
            <text
              {...labelProps}
              dominantBaseline="central"
              fontSize={12}
              fontWeight={700}
              fill="white"
              stroke="#0b1440"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {corner.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
