import { useMemo, useRef, useState } from 'react'
import type { CircuitCorner, CircuitData } from '../types'
import { computeViewBox } from '../lib/geometry'
import { useElementSize } from '../hooks/useElementSize'
import { CircuitMap } from './CircuitMap'
import { NumberBadge } from './Brand'

interface CircuitViewProps {
  circuit: CircuitData
  onZoomComplete: (corner: CircuitCorner) => void
}

const ZOOM_SCALE = 4.5
const PADDING_M = 120 // extra room so corner-name labels near the edge don't clip
// Below this container width the inline corner names can't fit without
// colliding, so the map shows numbers only and a tappable legend lists the
// names underneath (like the classic NOS bochten-kaart graphic).
const INLINE_NAMES_MIN_WIDTH_PX = 600

export function CircuitView({ circuit, onZoomComplete }: CircuitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { width } = useElementSize(containerRef)
  const showInlineNames = width >= INLINE_NAMES_MIN_WIDTH_PX

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
    <div ref={containerRef} className="flex w-full flex-col gap-4">
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
          <CircuitMap circuit={circuit} viewBox={viewBox} showNames={showInlineNames} onSelectCorner={handleSelectCorner} />
        </div>
      </div>

      {!showInlineNames && (
        <div className="grid w-full grid-cols-2 gap-2">
          {circuit.corners.map((corner) => (
            <button
              key={corner.number}
              type="button"
              onClick={() => handleSelectCorner(corner)}
              className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-left text-sm font-extrabold text-ink transition active:scale-95"
            >
              <NumberBadge>{corner.number}</NumberBadge>
              <span className="truncate">{corner.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
