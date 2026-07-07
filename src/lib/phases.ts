import type { CornerSample } from '../types'

export type DrivingPhase = 'flatout' | 'coast' | 'brake' | 'accel'

export interface PhaseSegment {
  phase: DrivingPhase
  points: { x: number; y: number }[]
}

export type VisiblePhaseSegment = PhaseSegment & { phase: Exclude<DrivingPhase, 'flatout'> }

export function isVisiblePhase(segment: PhaseSegment): segment is VisiblePhaseSegment {
  return segment.phase !== 'flatout'
}

const COAST_THROTTLE_THRESHOLD = 95

function classifySample(sample: CornerSample, apexT: number): DrivingPhase {
  if (sample.t >= apexT) return 'accel'
  if (sample.brakeActive) return 'brake'
  if (sample.throttle < COAST_THROTTLE_THRESHOLD) return 'coast'
  return 'flatout'
}

// Groups samples into contiguous same-phase runs for rendering as separate
// colored polylines. Each new segment repeats the previous segment's last
// point so the colored lines connect with no visual gap at the boundary.
export function buildPhaseSegments(samples: CornerSample[], apexT: number): PhaseSegment[] {
  const segments: PhaseSegment[] = []
  let currentPhase: DrivingPhase | null = null
  let currentPoints: { x: number; y: number }[] = []

  for (const sample of samples) {
    const phase = classifySample(sample, apexT)
    if (phase !== currentPhase) {
      if (currentPhase !== null) {
        currentPoints.push({ x: sample.x, y: sample.y })
        segments.push({ phase: currentPhase, points: currentPoints })
      }
      currentPhase = phase
      currentPoints = [{ x: sample.x, y: sample.y }]
    } else {
      currentPoints.push({ x: sample.x, y: sample.y })
    }
  }
  if (currentPhase !== null) segments.push({ phase: currentPhase, points: currentPoints })

  return segments
}
