export interface Point {
  x: number;
  y: number;
}

interface OrientedPoint extends Point {
  headingDeg: number;
}

export interface LapSample extends Point {
  t: number;
  distanceM: number;
  speedKph: number;
  brakeActive: boolean;
  throttle: number;
  gear: number;
}

interface CornerMarker extends Point {
  number: number;
  name: string;
  distanceM: number;
}

/** One of Max's brake/gas moments the player has to match. */
export interface TargetEvent {
  type: 'brake' | 'gas';
  t: number;
  distanceM: number;
  speedKph: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** One game round: a window of the lap around one corner (or a combination). */
export interface GameRound {
  id: string;
  label: string;
  cornerNumbers: number[];
  practice: boolean;
  tStart: number;
  tEnd: number;
  events: TargetEvent[];
  bounds: Bounds;
}

// The one baked fixture the whole app runs on: Max Verstappen's pole lap
// (2025 Dutch GP qualifying) over the full circuit, the official track
// geometry oriented north-up (like Google Maps), and the four game rounds.
// Produced by scripts/build-game-fixture.mjs.
export interface ZandvoortFixture {
  meta: {
    circuit: string;
    meetingName: string;
    year: number;
    sessionName: string;
    sessionKey: number;
    lapLengthM: number;
    driverNumber: number;
    driverName: string;
    driverAcronym: string;
    teamName: string;
    teamColor: string;
    lapNumber: number;
    lapDurationS: number;
    /** t of the start/finish crossing inside lap.samples. */
    lapStartT: number;
    lapStartDistanceM: number;
    source: string;
    trackOutlineSource: string;
  };
  trackOutline: Point[];
  startFinish: OrientedPoint;
  corners: CornerMarker[];
  lap: {
    samples: LapSample[];
  };
  rounds: GameRound[];
}

export type GamePhase = 'intro' | 'flying' | 'ready' | 'running' | 'roundResult' | 'finished';

/** A player press during a run, matched to a target event by order. */
export interface PlayerMark {
  type: 'brake' | 'gas';
  t: number;
  distanceM: number;
  speedKph: number;
}
