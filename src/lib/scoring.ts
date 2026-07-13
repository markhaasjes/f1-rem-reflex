export type ResultTone = 'perfect' | 'good' | 'okay' | 'bad';

export interface ResultDescription {
  title: string;
  detail: string;
  tone: ResultTone;
}

// deltaM: player's brake distance minus Verstappen's. Positive = player
// braked later (deeper into the corner), negative = earlier. null = the
// player never braked at all.
export function describeBrakeAttempt(deltaM: number | null): ResultDescription {
  if (deltaM === null) {
    return {
      title: 'Je hebt niet geremd!',
      detail: 'Zo ga je rechtdoor het grind in bij de Tarzanbocht.',
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
export function describeGasAttempt(deltaM: number | null): ResultDescription {
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
  perfect: 'Wereldklasse ronde!',
  good: 'Sterke bocht!',
  okay: 'Netjes gedaan.',
  bad: 'Volgende keer beter.',
};

// Combines the brake and gas verdicts into one headline, taking the weaker of
// the two so the player sees the honest overall grade.
export function combineResults(brake: ResultDescription, gas: ResultDescription): { title: string; tone: ResultTone } {
  const tone = TONE_RANK[brake.tone] <= TONE_RANK[gas.tone] ? brake.tone : gas.tone;
  return { title: OVERALL_TITLE[tone], tone };
}
