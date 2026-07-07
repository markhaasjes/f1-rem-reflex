import { useMemo, useRef, useState } from 'react'
import type { CircuitCorner, CircuitData } from '../types'
import { computeViewBox } from '../lib/geometry'
import { CircuitMap } from './CircuitMap'

interface CircuitViewProps {
  circuit: CircuitData
  onZoomComplete: (corner: CircuitCorner) => void
}

const ZOOM_SCALE = 4.5
const PADDING_M = 60

export function CircuitView({ circuit, onZoomComplete }: CircuitViewProps) {
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 })
  const [zoomed, setZoomed] = useState(false)
  const pendingCorner = useRef<CircuitCorner | null>(null)

  const viewBox = useMemo(() => computeViewBox(circuit.trackOutline, PADDING_M), [circuit])

  function handleSelectCorner(corner: CircuitCorner) {
    if (pendingCorner.current) return
    pendingCorner.current = corner
    const x = ((corner.x - viewBox.minX) / viewBox.width) * 100
    const y = ((corner.y - viewBox.minY) / viewBox.height) * 100
    setZoomOrigin({ x, y })
    requestAnimationFrame(() => requestAnimationFrame(() => setZoomed(true)))
  }

  function handleTransitionEnd() {
    if (zoomed && pendingCorner.current) {
      onZoomComplete(pendingCorner.current)
    }
  }

  return (
    <div className="h-[26rem] w-full overflow-hidden rounded-2xl bg-track-blue-dark/40 sm:h-[34rem] md:h-[42rem] lg:h-[46rem]">
      <div
        className="h-full w-full"
        style={{
          transform: zoomed ? `scale(${ZOOM_SCALE})` : 'scale(1)',
          transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
          transition: 'transform 900ms cubic-bezier(0.65, 0, 0.35, 1)',
        }}
        onTransitionEnd={handleTransitionEnd}
      >
        <CircuitMap circuit={circuit} viewBox={viewBox} onSelectCorner={handleSelectCorner} />
      </div>
    </div>
  )
}
