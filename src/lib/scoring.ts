import type { GameRound, PlayerMark, TargetEvent } from '../types';

export type ResultTone = 'perfect' | 'good' | 'okay' | 'bad';

export interface ResultDescription {
  title: string;
  detail: string;
  tone: ResultTone;
}

// deltaM: player's brake distance minus Verstappen's. Positive = player
// braked later (deeper into the corner), negative = earlier. null = the
// player never braked at all.
function describeBrakeAttempt(deltaM: number | null): ResultDescription {
  if (deltaM === null) {
    return {
      title: 'Je hebt niet geremd!',
      detail: 'Zo ga je rechtdoor het grind in.',
      tone: 'bad',
    };
  }

  const absDelta = Math.abs(deltaM);
  const late = deltaM > 0;

  if (absDelta <= 3) {
    return { title: 'Perfect getimed!', detail: 'Zo remt een wereldkampioen.', tone: 'perfect' };
  }
  if (absDelta <= 10) {
    return {
      title: late ? 'Heel dichtbij, iets te laat.' : 'Heel dichtbij, iets te vroeg.',
      detail: `Je zat maar ${absDelta.toFixed(1)} meter naast het rempunt van Max.`,
      tone: 'good',
    };
  }
  if (absDelta <= 25) {
    return {
      title: late ? 'Iets te laat geremd.' : 'Iets te voorzichtig.',
      detail: late
        ? 'Nog iets langer wachten met remmen was sneller geweest, toch?'
        : 'Je durfde het niet helemaal aan.',
      tone: 'okay',
    };
  }
  return {
    title: late ? 'Veel te laat!' : 'Veel te voorzichtig.',
    detail: late ? 'Dat werd een uitstapje door het grind.' : `Max remde hier pas ${absDelta.toFixed(0)} meter later.`,
    tone: 'bad',
  };
}

// deltaM: player's throttle-on distance minus Verstappen's. Positive = player
// got back on the gas later (further round the corner), negative = earlier.
// null = the player never got on the gas.
function describeGasAttempt(deltaM: number | null): ResultDescription {
  if (deltaM === null) {
    return { title: 'Geen gas gegeven!', detail: 'Je bleef te lang van het gas af.', tone: 'bad' };
  }

  const absDelta = Math.abs(deltaM);
  const late = deltaM > 0;

  if (absDelta <= 5) {
    return { title: 'Perfect op het gas!', detail: 'Precies waar Max het gas intrapt.', tone: 'perfect' };
  }
  if (absDelta <= 14) {
    return {
      title: late ? 'Net te laat op het gas.' : 'Net te vroeg op het gas.',
      detail: `Je zat ${absDelta.toFixed(1)} meter naast het gaspunt van Max.`,
      tone: 'good',
    };
  }
  if (absDelta <= 30) {
    return {
      title: late ? 'Te laat op het gas.' : 'Te vroeg op het gas.',
      detail: late ? 'Eerder vol gas wint tijd op het rechte stuk.' : 'Zoveel gas en je glijdt wijd de bocht uit.',
      tone: 'okay',
    };
  }
  return {
    title: late ? 'Veel te laat vol gas.' : 'Veel te vroeg vol gas.',
    detail: late ? 'Zo laat Max je op het rechte stuk staan.' : 'Daar spin je zo de grindbak in.',
    tone: 'bad',
  };
}

const TONE_RANK: Record<ResultTone, number> = { perfect: 3, good: 2, okay: 1, bad: 0 };

const OVERALL_TITLE: Record<ResultTone, string> = {
  perfect: 'Wereldklasse!',
  good: 'Sterke bocht!',
  okay: 'Netjes gedaan.',
  bad: 'Volgende keer beter.',
};

// Combines several event verdicts into one headline, taking the weakest so
// the player sees the honest overall grade.
export function combineResults(descriptions: ResultDescription[]): { title: string; tone: ResultTone } {
  const tone = descriptions.reduce<ResultTone>(
    (worst, d) => (TONE_RANK[d.tone] < TONE_RANK[worst] ? d.tone : worst),
    'perfect',
  );
  return { title: OVERALL_TITLE[tone], tone };
}

// --- Numeric scoring across the whole game ---

/** 100 points within 2m of Max, linearly down to 0 at 50m. Missed event = 0. */
function scoreEvent(deltaM: number | null): number {
  if (deltaM === null) return 0;
  const absDelta = Math.abs(deltaM);
  if (absDelta <= 2) return 100;
  return Math.max(0, Math.round(100 - ((absDelta - 2) * 100) / 48));
}

export interface EventResult {
  event: TargetEvent;
  mark: PlayerMark | null;
  deltaM: number | null;
  score: number;
  description: ResultDescription;
}

export interface RoundResult {
  round: GameRound;
  eventResults: EventResult[];
  score: number;
}

// Marks pair to Max's events per pedal, in order: the k-th brake press
// answers Max's k-th brake event, the k-th gas press his k-th gas event.
// Unanswered events score 0.
export function scoreRound(round: GameRound, marks: PlayerMark[]): RoundResult {
  const byType: Record<PlayerMark['type'], PlayerMark[]> = {
    brake: marks.filter((m) => m.type === 'brake'),
    gas: marks.filter((m) => m.type === 'gas'),
  };
  const used: Record<PlayerMark['type'], number> = { brake: 0, gas: 0 };
  const eventResults = round.events.map((event) => {
    const mark = byType[event.type][used[event.type]++] ?? null;
    const deltaM = mark ? mark.distanceM - event.distanceM : null;
    const describe = event.type === 'brake' ? describeBrakeAttempt : describeGasAttempt;
    return { event, mark, deltaM, score: scoreEvent(deltaM), description: describe(deltaM) };
  });
  const score = Math.round(eventResults.reduce((sum, r) => sum + r.score, 0) / eventResults.length);
  return { round, eventResults, score };
}

/** Overall 0-100: the average of the scoring rounds' (rounded) scores;
 * practice rounds are shown on the card but do not count. Averaging at the
 * round level keeps the total verifiable from the score card - the earlier
 * event-weighted average (double corners counting twice as heavy) produced
 * totals that looked like calculation mistakes next to the listed rounds. */
export function totalScore(results: RoundResult[]): number {
  const scoring = results.filter((r) => !r.round.practice);
  if (scoring.length === 0) return 0;
  return Math.round(scoring.reduce((sum, r) => sum + r.score, 0) / scoring.length);
}
