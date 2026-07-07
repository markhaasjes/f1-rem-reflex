export interface CornerSample {
  t: number
  x: number
  y: number
  distanceM: number
  speedKph: number
  brakeActive: boolean
  throttle: number
  gear: number
}

export interface CornerPoint {
  t: number
  distanceM: number
  speedKph: number
}

export interface CornerMeta {
  corner: string
  cornerNumber: number
  circuit: string
  meetingName: string
  year: number
  sessionName: string
  sessionKey: number
  lapNumber: number
  lapDurationS: number
  driverNumber: number
  driverName: string
  driverAcronym: string
  teamName: string
  teamColor: string
  source: string
}

// Most corners have a real brake point. A few flat-out kinks (e.g. Hunserug)
// have no brake event at all - 'lift' falls back to the throttle-lift point,
// 'none' means the driver never came off full throttle in this window.
export type CornerActionType = 'brake' | 'lift' | 'none'

interface CornerDataBase {
  meta: CornerMeta
  samples: CornerSample[]
  apexPoint: CornerPoint
  durationS: number
  totalDistanceM: number
}

// Discriminated on actionType so 'none' corners (no brake/lift event at all)
// are typed with brakePoint: null, and the game screens can't accidentally
// render a reflex challenge for a corner with no ground-truth point.
export type CornerData =
  | (CornerDataBase & { actionType: 'brake' | 'lift'; brakePoint: CornerPoint })
  | (CornerDataBase & { actionType: 'none'; brakePoint: null })

// The reflex game only makes sense for corners with a real ground-truth
// point - App.tsx routes 'none' corners to a separate flat-out screen instead.
export type PlayableCornerData = Extract<CornerData, { actionType: 'brake' | 'lift' }>

export type DriverAcronym = 'VER' | 'HAM' | 'ANT' | 'NOR'

export interface DriverMeta {
  driverNumber: number
  driverAcronym: DriverAcronym
  driverName: string
  teamName: string
  teamColor: string
  lapNumber: number
  lapDurationS: number
}

export interface DriverFile {
  meta: DriverMeta
  corners: Record<string, CornerData>
}

export interface CircuitCorner {
  number: number
  name: string
  x: number
  y: number
  distanceM: number
}

export interface OrientedPoint {
  x: number
  y: number
  headingDeg: number
}

export interface CircuitData {
  meta: {
    circuit: string
    meetingName: string
    year: number
    sessionName: string
    sessionKey: number
    referenceDriver: string
    lapLengthM: number
    source: string
  }
  trackOutline: { x: number; y: number }[]
  startFinish: OrientedPoint
  grandstands: OrientedPoint[]
  corners: CircuitCorner[]
}

export type GamePhase = 'ready' | 'running' | 'result'

export interface BrakeAttempt {
  t: number
  distanceM: number
  speedKph: number
}

export type AppPhase = 'circuit' | 'zooming' | 'driverSelect' | 'game'
