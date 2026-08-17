import { classifyAt, STEP_S, type DrivingPhase } from './phases';
import { inputAt, inputToPhase } from './playerInput';
import type { GameRound, InputTransition, LapSample, PedalInput } from '../types';

export type ResultTone = 'perfect' | 'good' | 'okay' | 'bad';

// Human reaction lag: a pedal state also counts as matched when it matches
// Max's phase this far to either side of t, so every zone boundary forgives a
// fraction of a second of being late (or anticipating).
//
// The grace only applies near a pedal change the player actually made. Without
// that gate it forgives *Max's* transitions instead of the player's reaction to
// them, and hands out credit for pedals that were never touched: coasting
// through the whole corner used to score 20% on the brake bar, because for 0.2s
// on either side of every braking zone "coast" matched Max's neighbouring
// phase. Reaction time is a reaction to something; no pedal change, no grace.
const REACTION_GRACE_S = 0.2;

// A phase must fill at least this much of the window to count toward the
// score average - guards against a future fixture where a one-blip phase
// would otherwise carry a third of a round's score.
const MIN_PHASE_S = 0.5;

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
}

export interface RoundResult {
  round: GameRound;
  /** The pedal timeline this result was scored from (feeds the share link). */
  transitions: InputTransition[];
  zones: ZoneResult[];
  /** Match time per phase of Max's driving (totalS 0 = phase absent). */
  phaseAccuracy: Record<DrivingPhase, PhaseAccuracy>;
  /** 0-100: the average of the per-phase match percentages. */
  score: number;
}

/** A phase's score as the whole percentage the result card shows: of the time
 * Max spent on this pedal, how much of it the player was on it too. It reads
 * back as a plain sentence - "van de tijd dat Max remt, remde jij 0%" - which
 * is the whole point: a bar is a description of what the player did, and the
 * round score below is where doing only one of the three gets punished. */
export function phasePercent(accuracy: PhaseAccuracy): number {
  return accuracy.totalS === 0 ? 0 : Math.round((accuracy.matchedS / accuracy.totalS) * 100);
}

// Walks the round window on the same grid the ribbons render at and compares
// the player's pedal timeline against Max's telemetry moment by moment.
//
// The score is the **geometric** mean of the three per-phase match percentages
// (the Rem/Los/Gas bars on the result card). Both simpler formulas hand out
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
// That is also why the bars themselves need no penalty term: using the wrong
// pedal already costs the phase it was stolen from. Holding gas through the
// whole corner reads Gas 100% / Los 0% / Rem 0%, which is exactly what
// happened, and the round still scores 0 because two of the three are empty.
// Calibration against the fixture (scripted, see the verification workflow):
// mirroring Max's telemetry with 120ms lag **99**, 250ms **92**, 400ms **78**,
// and every single-pedal strategy **0** - gas-only, brake-only and
// touch-nothing alike.
export function scoreRound(round: GameRound, samples: LapSample[], transitions: InputTransition[]): RoundResult {
  const zones: ZoneResult[] = [];
  const phaseAccuracy: Record<DrivingPhase, PhaseAccuracy> = {
    flat: { matchedS: 0, totalS: 0 },
    coast: { matchedS: 0, totalS: 0 },
    brake: { matchedS: 0, totalS: 0 },
  };

  /** Did the player change pedal within the grace window of t? The grace
   * forgives a late or early reaction, so it needs a reaction to forgive. */
  const changedPedalNear = (t: number) =>
    transitions.some((transition) => Math.abs(transition.t - t) <= REACTION_GRACE_S);

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
      (changedPedalNear(t) &&
        (playerPhase === classifyAt(samples, t - REACTION_GRACE_S) ||
          playerPhase === classifyAt(samples, t + REACTION_GRACE_S)));

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
    } else if (zoneWrong) {
      zoneWrong[playerInput] += STEP_S;
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
    flat: { matchedS: 0, totalS: 0 },
    coast: { matchedS: 0, totalS: 0 },
    brake: { matchedS: 0, totalS: 0 },
  };
  for (const result of results) {
    if (result.round.practice) continue;
    for (const phase of Object.keys(aggregate) as DrivingPhase[]) {
      aggregate[phase].matchedS += result.phaseAccuracy[phase].matchedS;
      aggregate[phase].totalS += result.phaseAccuracy[phase].totalS;
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
