import { useEffect, useMemo, useRef } from 'react'
import type { CircuitCorner, CircuitData } from '../types'
import type { ViewBox } from '../lib/geometry'
import { fitProjection, prepareCanvas } from '../lib/canvas'
import { drawGrandstand, drawRoadSurface, drawStartFinishLine } from '../lib/canvasTrack'
import { useElementSize } from '../hooks/useElementSize'

interface CircuitMapProps {
  circuit: CircuitData
  viewBox: ViewBox
  /** Draw corner names next to the badges - disabled on narrow screens where they can't fit. */
  showNames: boolean
  onSelectCorner: (corner: CircuitCorner) => void
}

interface LabelPosition {
  dx: number
  dy: number
  align: CanvasTextAlign
}

const LABEL_BELOW: LabelPosition = { dx: 0, dy: 27, align: 'center' }
const LABEL_ABOVE: LabelPosition = { dx: 0, dy: -25, align: 'center' }
const LABEL_RIGHT: LabelPosition = { dx: 22, dy: 0, align: 'left' }
const LABEL_LEFT: LabelPosition = { dx: -22, dy: 0, align: 'right' }

// Hand-placed per corner: the middle sector packs corners close together and
// several sit near the map edge, so a generic rotation scheme either clips or
// collides. Tuned against the rendered overview.
const LABEL_BY_CORNER: Record<number, LabelPosition> = {
  1: LABEL_BELOW,
  2: LABEL_BELOW,
  3: LABEL_ABOVE,
  4: LABEL_BELOW,
  5: LABEL_ABOVE,
  6: LABEL_BELOW,
  7: LABEL_BELOW,
  8: LABEL_BELOW,
  9: LABEL_RIGHT,
  10: LABEL_ABOVE,
  11: LABEL_RIGHT,
  12: LABEL_RIGHT,
  13: LABEL_RIGHT,
  14: LABEL_LEFT,
}

const BADGE_RADIUS_PX = 15
const HIT_TARGET_PX = 34

export function CircuitMap({ circuit, viewBox, showNames, onSelectCorner }: CircuitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { width, height } = useElementSize(containerRef)

  const projection = useMemo(() => (width > 0 && height > 0 ? fitProjection(viewBox, width, height) : null), [viewBox, width, height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !projection || width === 0 || height === 0) return
    const ctx = prepareCanvas(canvas, width, height)
    if (!ctx) return

    for (const stand of circuit.grandstands) drawGrandstand(ctx, stand, projection)
    drawRoadSurface(ctx, circuit.trackOutline, projection, { style: 'map' })
    drawStartFinishLine(ctx, circuit.startFinish, projection)

    for (const corner of circuit.corners) {
      const [px, py] = projection.toScreen(corner.x, corner.y)
      ctx.beginPath()
      ctx.arc(px, py, BADGE_RADIUS_PX, 0, Math.PI * 2)
      ctx.fillStyle = '#2f6fed'
      ctx.fill()
      ctx.strokeStyle = 'white'
      ctx.lineWidth = 3
      ctx.stroke()

      ctx.fillStyle = 'white'
      ctx.font = '800 15px Effra, "Helvetica Neue", Helvetica, Arial, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(corner.number), px, py + 1)

      if (showNames) {
        const label = LABEL_BY_CORNER[corner.number] ?? LABEL_BELOW
        ctx.font = '700 12px Effra, "Helvetica Neue", Helvetica, Arial, sans-serif'
        ctx.textAlign = label.align
        ctx.textBaseline = 'middle'
        ctx.lineWidth = 3
        ctx.strokeStyle = '#0b1440'
        ctx.fillStyle = 'white'
        ctx.strokeText(corner.name, px + label.dx, py + label.dy)
        ctx.fillText(corner.name, px + label.dx, py + label.dy)
      }
    }
  }, [circuit, projection, showNames, width, height])

  const buttons = useMemo(() => {
    if (!projection) return []
    return circuit.corners.map((corner) => {
      const [px, py] = projection.toScreen(corner.x, corner.y)
      return { corner, px, py }
    })
  }, [circuit, projection])

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="sr-only">Circuitkaart van {circuit.meta.circuit} met alle veertien bochten</div>
      {buttons.map(({ corner, px, py }) => (
        <button
          key={corner.number}
          type="button"
          onClick={() => onSelectCorner(corner)}
          aria-label={`Bocht ${corner.number}: ${corner.name}`}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          style={{ left: px, top: py, width: HIT_TARGET_PX, height: HIT_TARGET_PX }}
        />
      ))}
    </div>
  )
}
