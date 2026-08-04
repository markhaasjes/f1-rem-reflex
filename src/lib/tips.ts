import type { RoundResult } from './scoring';

// Specific, actionable advice derived from the worst moment of a round -
// "je remde 18m te laat - rem iets eerder" teaches, "59/100" does not.
export function adviceForRound(result: RoundResult): string | null {
  const worst = [...result.eventResults].sort((a, b) => a.score - b.score)[0];
  if (!worst || worst.score >= 90) return null;

  const isBrake = worst.event.type === 'brake';
  if (worst.deltaM === null) {
    return isBrake
      ? 'je remde hier niet - druk op het rempedaal zodra je het rempunt nadert'
      : 'je gaf hier geen gas - trap het gaspedaal in zodra de bocht opent';
  }

  const late = worst.deltaM > 0;
  const meters = Math.abs(Math.round(worst.deltaM));
  if (isBrake) {
    return late
      ? `je remde ${meters}m te laat - rem iets eerder`
      : `je remde ${meters}m te vroeg - durf later te remmen`;
  }
  return late
    ? `je gaf ${meters}m te laat gas - ga eerder op het gas na de apex`
    : `je gaf ${meters}m te vroeg gas - wacht tot de bocht echt opent`;
}

/** Advice per round id, for persisting alongside a finished run. */
export function adviceForRun(results: RoundResult[]): Record<string, string> {
  const advice: Record<string, string> = {};
  for (const result of results) {
    const tip = adviceForRound(result);
    if (tip) advice[result.round.id] = tip;
  }
  return advice;
}
