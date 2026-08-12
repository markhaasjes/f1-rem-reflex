import type { RoundResult, ZoneResult } from './scoring';

// Specific, actionable advice derived from the worst zone of a round -
// "je gaf nog gas waar Max al remt, rem eerder" teaches, "59/100" does not.
// (Dutch copy uses commas, never dashes - see the README copy rules.)

// A zone shorter than this is a blip (a one-beat lift between two corners);
// advice built on it would read as noise.
const MIN_ZONE_S = 0.5;

const ADVICE: Record<ZoneResult['phase'], Partial<Record<'gas' | 'brake' | 'coast', string>>> = {
  brake: {
    gas: 'je gaf nog gas waar Max al remt, rem eerder',
    coast: 'je liet alleen het gas los waar Max echt remt, trap het rempedaal in',
  },
  coast: {
    gas: 'je bleef op het gas waar Max het al loslaat, laat het gas eerder los',
    brake: 'je remde waar Max alleen uitrolt, laat daar beide pedalen los',
  },
  flat: {
    coast: 'je wachtte te lang met gas geven, ga eerder vol op het gas',
    brake: 'je remde waar Max vol op het gas staat, durf daar gas te geven',
  },
};

export function adviceForRound(result: RoundResult): string | null {
  const worst = result.zones
    .filter((zone) => zone.tEnd - zone.tStart >= MIN_ZONE_S && zone.wrongInput !== null)
    .sort((a, b) => a.matchFraction - b.matchFraction)[0];
  if (!worst || worst.matchFraction >= 0.85 || worst.wrongInput === null) return null;
  return ADVICE[worst.phase][worst.wrongInput] ?? null;
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
