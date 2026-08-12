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

/** One of Max's reference moments: where a braking zone opens ('brake') and
 * where he commits back to sustained full throttle ('gas'). The hold-to-drive
 * gameplay scores against the full telemetry; these only feed the per-round
 * zone-count copy (event count / 2 = braking zones). */
interface TargetEvent {
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

/** What the player's pedals say at a moment: gas held, brake held, or neither. */
export type PedalInput = 'gas' | 'brake' | 'coast';

/** One change of the player's pedal state during a run, on the lap clock. */
export interface InputTransition {
  t: number;
  input: PedalInput;
}
