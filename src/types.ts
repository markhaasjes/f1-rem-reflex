export interface CornerSample {
  t: number
  x: number
  y: number
  distanceM: number
  speedKph: number
  brakeActive: boolean
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

export interface CornerData {
  meta: CornerMeta
  samples: CornerSample[]
  brakePoint: CornerPoint
  apexPoint: CornerPoint
  durationS: number
  totalDistanceM: number
}

export type GamePhase = 'ready' | 'running' | 'result'

export interface BrakeAttempt {
  t: number
  distanceM: number
  speedKph: number
}
