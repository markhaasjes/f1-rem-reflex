import { useMemo } from 'react'
import type { CircuitCorner, CircuitData } from '../types'
import type { ViewBox } from '../lib/geometry'

interface CircuitMapProps {
  circuit: CircuitData
  viewBox: ViewBox
  onSelectCorner: (corner: CircuitCorner) => void
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
      <polyline points={points} fill="none" stroke="#101d63" strokeWidth={20} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={points} fill="none" stroke="white" strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" />

      {circuit.corners.map((corner) => (
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
        </g>
      ))}
    </svg>
  )
}
