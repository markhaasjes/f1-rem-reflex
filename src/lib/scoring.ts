export type ResultTone = 'perfect' | 'good' | 'okay' | 'bad'

export interface ResultDescription {
  title: string
  detail: string
  tone: ResultTone
}

// deltaM: player's brake distance minus the real driver's brake distance.
// Positive = player braked later (further into the corner), negative = earlier.
export function describeAttempt(deltaM: number | null): ResultDescription {
  if (deltaM === null) {
    return {
      title: 'Je hebt niet geremd!',
      detail: 'Zo ga je rechtdoor het grind in bij de Tarzanbocht.',
      tone: 'bad',
    }
  }

  const absDelta = Math.abs(deltaM)
  const late = deltaM > 0

  if (absDelta <= 3) {
    return { title: 'Perfect getimed!', detail: 'Zo remt een Formule 1-coureur.', tone: 'perfect' }
  }
  if (absDelta <= 10) {
    return {
      title: late ? 'Heel dichtbij, iets te laat.' : 'Heel dichtbij, iets te vroeg.',
      detail: `Je zat maar ${absDelta.toFixed(1)} meter naast het echte rempunt.`,
      tone: 'good',
    }
  }
  if (absDelta <= 25) {
    return {
      title: late ? 'Iets te laat geremd.' : 'Iets te voorzichtig geremd.',
      detail: late ? 'Nog iets langer scherp blijven voor het echte rempunt.' : 'Je durfde het niet helemaal aan.',
      tone: 'okay',
    }
  }
  return {
    title: late ? 'Veel te laat!' : 'Veel te voorzichtig.',
    detail: late ? 'Dat werd een uitstapje door het grind.' : 'Zo verlies je veel tijd op de rechte stukken.',
    tone: 'bad',
  }
}
