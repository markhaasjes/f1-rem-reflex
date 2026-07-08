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
