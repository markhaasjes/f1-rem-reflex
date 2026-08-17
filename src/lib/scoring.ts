import { classifyAt, STEP_S, type DrivingPhase } from './phases';
import { inputAt, inputToPhase } from './playerInput';
import type { GameRound, InputTransition, LapSample, PedalInput } from '../types';

export type ResultTone = 'perfect' | 'good' | 'okay' | 'bad';

// Human reaction lag: a pedal state also counts as matched when it matches
// Max's phase this far to either side of t, so every zone boundary forgives
// a fraction of a second of being late (or anticipating) without rewarding a
// wrong pedal held through a whole zone.
const REACTION_GRACE_S = 0.2;

// A phase must fill at least this much of the window to count toward the
// score average - guards against a future fixture where a one-blip phase
// would otherwise carry a third of a round's score.
const MIN_PHASE_S = 0.5;

// A second on the wrong pedal costs a little more than a right second earns.
// Straight 1:1 subtraction still left "hold the gas through the whole corner"
// with a positive GAS bar in the windows where Max happens to be flat out for
// more than half the time (Hugenholtz: 18%), which is exactly the free credit
// the penalty exists to remove. At 1.25 every single-pedal run bottoms out at
// 0 for that pedal in every corner, while a mirrored lap is untouched.
const WRONG_PEDAL_PENALTY = 1.25;

/** One contiguous stretch of the round where Max holds the same phase, with
 * how much of it the player's pedals agreed. */
export interface ZoneResult {
  phase: DrivingPhase;
  tStart: number;
  tEnd: number;
  matchFraction: number;
  /** What the player mostly did instead during the mismatched time. */
  wrongInput: PedalInput | null;
}

interface PhaseAccuracy {
  matchedS: number;
  totalS: number;
  /** Time the player held *this* pedal while Max was doing something else. */
  wrongS: number;
}

export interface RoundResult {
  round: GameRound;
  /** The pedal timeline this result was scored from (feeds the share link). */
  transitions: InputTransition[];
  zones: ZoneResult[];
  /** Match and mistake time per phase of Max's driving (totalS 0 = absent). */
  phaseAccuracy: Record<DrivingPhase, PhaseAccuracy>;
  /** 0-100: the average of the per-phase match percentages. */
  score: number;
}

/** A phase's score as the whole percentage the result card shows: the share of
 * Max's time on this pedal the player matched, *minus* the time they held the
 * pedal where Max did not. Without that second term the bar rewards holding one
 * pedal down: gas through a whole corner used to read GAS 100% (every flat-out
 * moment matched) while the player was demonstrably not driving the corner. */
export function phasePercent(accuracy: PhaseAccuracy): number {
  if (accuracy.totalS === 0) return 0;
  const net = accuracy.matchedS - WRONG_PEDAL_PENALTY * accuracy.wrongS;
  return Math.max(0, Math.min(100, Math.round((net / accuracy.totalS) * 100)));
}

// Walks the round window on the same grid the ribbons render at and compares
// the player's pedal timeline against Max's telemetry moment by moment.
//
// The score is the **geometric** mean of the three per-phase match percentages
// (the REM/LOS/GAS bars on the result card). Both simpler formulas hand out
// ~50 points for not playing:
//
//   - matched share of *time*: Max is flat out 40-55% of every window, so
//     holding the gas down and ignoring the corner scored ~51;
//   - arithmetic mean of the three phases: coasting is the *absence* of input,
//     so a player who touches nothing after the start collects a free 100% on
//     that phase and lands at ~48 (11 + 100 + 34) / 3.
//
// Multiplying instead of averaging means every phase has to be answered: one
// pedal you never use drags the whole round down, no matter how good the other
// two are, while a genuinely good run barely notices the difference
// (85/75/80 -> 80, 95/90/95 -> 93). The trade-off is that the player can no
// longer verify the score by averaging the bars in their head, so the explainer
// modal describes the rule in words instead.
//
// Each bar is itself net of its own mistakes (see `phasePercent`): the time on
// a pedal Max was not using is subtracted from that pedal's bar, so the lazy
// strategies now bottom out where they belong. Calibration against the fixture
// (scripted, see the verification workflow): mirroring Max's telemetry with
// 120ms lag **99**, 250ms **93**, 400ms **74**, and holding one pedal for the
// whole corner **0** - gas-only, brake-only and touch-nothing alike, with that
// pedal's bar reading 0 in every corner.
export function scoreRound(round: GameRound, samples: LapSample[], transitions: InputTransition[]): RoundResult {
  const zones: ZoneResult[] = [];
  const phaseAccuracy: Record<DrivingPhase, PhaseAccuracy> = {
    flat: { matchedS: 0, totalS: 0, wrongS: 0 },
    coast: { matchedS: 0, totalS: 0, wrongS: 0 },
    brake: { matchedS: 0, totalS: 0, wrongS: 0 },
  };

  let zone: { phase: DrivingPhase; tStart: number; tEnd: number; matchedS: number; totalS: number } | null = null;
  let zoneWrong: Record<PedalInput, number> | null = null;

  const closeZone = () => {
    if (!zone || !zoneWrong) return;
    const wrongEntries = (Object.entries(zoneWrong) as [PedalInput, number][]).filter(([, s]) => s > 0);
    wrongEntries.sort((a, b) => b[1] - a[1]);
    zones.push({
      phase: zone.phase,
      tStart: zone.tStart,
      tEnd: zone.tEnd,
      matchFraction: zone.totalS === 0 ? 1 : zone.matchedS / zone.totalS,
      wrongInput: wrongEntries[0]?.[0] ?? null,
    });
  };

  for (let t = round.tStart; t <= round.tEnd; t += STEP_S) {
    const maxPhase = classifyAt(samples, t);
    const playerInput = inputAt(transitions, t);
    const playerPhase = inputToPhase(playerInput);
    const matched =
      playerPhase === maxPhase ||
      playerPhase === classifyAt(samples, t - REACTION_GRACE_S) ||
      playerPhase === classifyAt(samples, t + REACTION_GRACE_S);

    if (!zone || zone.phase !== maxPhase) {
      closeZone();
      zone = { phase: maxPhase, tStart: t, tEnd: t, matchedS: 0, totalS: 0 };
      zoneWrong = { gas: 0, brake: 0, coast: 0 };
    }
    zone.tEnd = t;
    zone.totalS += STEP_S;
    phaseAccuracy[maxPhase].totalS += STEP_S;
    if (matched) {
      zone.matchedS += STEP_S;
      phaseAccuracy[maxPhase].matchedS += STEP_S;
    } else {
      // The mistake is charged to the pedal the player actually held, not to
      // the one they should have been on: "gas where Max brakes" has to cost
      // GAS points, otherwise gas-through-the-corner keeps a perfect GAS bar.
      phaseAccuracy[playerPhase].wrongS += STEP_S;
      if (zoneWrong) zoneWrong[playerInput] += STEP_S;
    }
  }
  closeZone();

  // Uses the same rounded percentages the bars show, so a 0% bar really does
  // zero the round - that is the point of the rule, not an edge case.
  const countedPhases = Object.values(phaseAccuracy).filter((accuracy) => accuracy.totalS >= MIN_PHASE_S);
  const product = countedPhases.reduce((factor, accuracy) => factor * (phasePercent(accuracy) / 100), 1);
  const score = countedPhases.length === 0 ? 0 : Math.round(100 * product ** (1 / countedPhases.length));
  return { round, transitions, zones, phaseAccuracy, score };
}

/** The whole run's match time per phase, summed over the scoring rounds -
 * the same rounds the total reflects (practice excluded). Feeds the overall
 * Rem/Los/Gas bars on the shared-score landing. */
export function aggregatePhaseAccuracy(results: RoundResult[]): Record<DrivingPhase, PhaseAccuracy> {
  const aggregate: Record<DrivingPhase, PhaseAccuracy> = {
    flat: { matchedS: 0, totalS: 0, wrongS: 0 },
    coast: { matchedS: 0, totalS: 0, wrongS: 0 },
    brake: { matchedS: 0, totalS: 0, wrongS: 0 },
  };
  for (const result of results) {
    if (result.round.practice) continue;
    for (const phase of Object.keys(aggregate) as DrivingPhase[]) {
      aggregate[phase].matchedS += result.phaseAccuracy[phase].matchedS;
      aggregate[phase].totalS += result.phaseAccuracy[phase].totalS;
      aggregate[phase].wrongS += result.phaseAccuracy[phase].wrongS;
    }
  }
  return aggregate;
}

const VERDICT_FALLBACK: [number, ResultTone, string] = [0, 'bad', 'Volgende keer beter.'];
const VERDICTS: [number, ResultTone, string][] = [
  [90, 'perfect', 'Wereldklasse!'],
  [72, 'good', 'Sterke bocht!'],
  [45, 'okay', 'Netjes gedaan.'],
  VERDICT_FALLBACK,
];

/** The round verdict banner: one headline for the matched share of the round. */
export function verdictForScore(score: number): { title: string; tone: ResultTone } {
  const [, tone, title] = VERDICTS.find(([threshold]) => score >= threshold) ?? VERDICT_FALLBACK;
  return { title, tone };
}

/** Overall 0-100: the average of the scoring rounds' (rounded) scores,
 * paired up by index with the round metadata that says which ones count.
 * Split out from `totalScore` so a shared-score link can recompute the same
 * total from the per-round scores it carries instead of trusting a total the
 * URL claims. */
export function totalScoreFromRoundScores(rounds: GameRound[], roundScores: number[]): number {
  let sum = 0;
  let count = 0;
  rounds.forEach((round, i) => {
    if (round.practice) return;
    sum += roundScores[i];
    count += 1;
  });
  return count === 0 ? 0 : Math.round(sum / count);
}

/** Overall 0-100: the average of the scoring rounds' (rounded) scores;
 * practice rounds are shown on the card but do not count. Averaging at the
 * round level keeps the total verifiable from the score card. */
export function totalScore(results: RoundResult[]): number {
  return totalScoreFromRoundScores(
    results.map((r) => r.round),
    results.map((r) => r.score),
  );
}
