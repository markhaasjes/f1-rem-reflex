export interface Point {
  x: number;
  y: number;
}

export interface OrientedPoint extends Point {
  headingDeg: number;
}

export interface CornerSample extends Point {
  t: number;
  distanceM: number;
  speedKph: number;
  brakeActive: boolean;
  throttle: number;
  gear: number;
}

export interface CornerPoint {
  t: number;
  distanceM: number;
  speedKph: number;
}

// The one baked fixture the whole app runs on: Max Verstappen's pole lap
// through the Tarzanbocht (2025 Dutch GP qualifying), plus the schematic
// circuit outline for the intro map. See README for how it was produced.
export interface TarzanFixture {
  meta: {
    corner: string;
    cornerNumber: number;
    circuit: string;
    meetingName: string;
    year: number;
    sessionName: string;
    lapNumber: number;
    driverNumber: number;
    driverName: string;
    driverAcronym: string;
    teamName: string;
    teamColor: string;
    source: string;
  };
  samples: CornerSample[];
  brakePoint: CornerPoint;
  apexPoint: CornerPoint;
  durationS: number;
  totalDistanceM: number;
  /** Slice of the track centerline through the corner - what the scene draws. */
  roadPath: Point[];
  /** Schematic full-circuit geometry for the intro map. */
  map: {
    outline: Point[];
    startFinish: OrientedPoint;
    corner: Point;
  };
}

export type GamePhase = 'ready' | 'running' | 'result';

export interface BrakeAttempt {
  t: number;
  distanceM: number;
  speedKph: number;
}
