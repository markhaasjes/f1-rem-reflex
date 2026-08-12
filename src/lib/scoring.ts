import { classifyAt, STEP_S, type DrivingPhase } from './phases';
import { inputAt, inputToPhase } from './playerInput';
import type { GameRound, InputTransition, LapSample, PedalInput } from '../types';

export type ResultTone = 'perfect' | 'good' | 'okay' | 'bad';

// Human reaction lag: a pedal state also counts as matched when it matches
// Max's phase this far to either side of t, so every zone boundary forgives
// a fraction of a second of being late (or anticipating) without rewarding a
// wrong pedal held through a whole zone.
const REACTION_GRACE_S = 0.2;

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
  zones: ZoneResult[];
  /** Match time per phase of Max's driving (totalS 0 = phase absent). */
  phaseAccuracy: Record<DrivingPhase, PhaseAccuracy>;
  /** 0-100: the share of the round the player's pedals matched Max. */
  score: number;
}

// Walks the round window on the same grid the ribbons render at and compares
// the player's pedal timeline against Max's telemetry moment by moment. The
// score is simply the matched share of time; zones and per-phase accuracy are
// the same comparison grouped two ways for the result UI and the tips.
export function scoreRound(round: GameRound, samples: LapSample[], transitions: InputTransition[]): RoundResult {
  const zones: ZoneResult[] = [];
  const phaseAccuracy: Record<DrivingPhase, PhaseAccuracy> = {
    flat: { matchedS: 0, totalS: 0 },
    coast: { matchedS: 0, totalS: 0 },
    brake: { matchedS: 0, totalS: 0 },
  };

  let matchedS = 0;
  let totalS = 0;
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
    totalS += STEP_S;
    phaseAccuracy[maxPhase].totalS += STEP_S;
    if (matched) {
      zone.matchedS += STEP_S;
      matchedS += STEP_S;
      phaseAccuracy[maxPhase].matchedS += STEP_S;
    } else if (zoneWrong) {
      zoneWrong[playerInput] += STEP_S;
    }
  }
  closeZone();

  const score = totalS === 0 ? 0 : Math.round((matchedS / totalS) * 100);
  return { round, zones, phaseAccuracy, score };
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
