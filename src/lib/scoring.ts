import type { CornerActionType } from '../types'

export type ResultTone = 'perfect' | 'good' | 'okay' | 'bad'

export interface ResultDescription {
  title: string
  detail: string
  tone: ResultTone
}

interface DescribeAttemptOptions {
  actionType: CornerActionType
  cornerName: string
}

const ACTION_WORD: Record<CornerActionType, string> = {
  brake: 'rempunt',
  lift: 'gaspunt',
  none: 'punt',
}

// deltaM: player's action distance minus the real driver's action distance.
// Positive = player acted later (further into the corner), negative = earlier.
export function describeAttempt(deltaM: number | null, { actionType, cornerName }: DescribeAttemptOptions): ResultDescription {
  const actionWord = ACTION_WORD[actionType]
  const actionVerb = actionType === 'lift' ? 'van het gas ging' : 'remde'

  if (deltaM === null) {
    return {
      title: actionType === 'lift' ? 'Je bent nooit van het gas gegaan!' : 'Je hebt niet geremd!',
      detail: `Zo ga je rechtdoor het grind in bij de ${cornerName}.`,
      tone: 'bad',
    }
  }

  const absDelta = Math.abs(deltaM)
  const late = deltaM > 0

  if (absDelta <= 3) {
    return { title: 'Perfect getimed!', detail: 'Zo rijdt een Formule 1-coureur.', tone: 'perfect' }
  }
  if (absDelta <= 10) {
    return {
      title: late ? `Heel dichtbij, iets te laat.` : `Heel dichtbij, iets te vroeg.`,
      detail: `Je zat maar ${absDelta.toFixed(1)} meter naast het echte ${actionWord}.`,
      tone: 'good',
    }
  }
  if (absDelta <= 25) {
    const lateAction = actionType === 'lift' ? 'van het gas' : 'geremd'
    return {
      title: late ? `Iets te laat ${lateAction}.` : `Iets te voorzichtig.`,
      detail: late ? `Nog iets langer scherp blijven voor het echte ${actionWord}.` : 'Je durfde het niet helemaal aan.',
      tone: 'okay',
    }
  }
  return {
    title: late ? 'Veel te laat!' : 'Veel te voorzichtig.',
    detail: late ? 'Dat werd een uitstapje door het grind.' : `Zo verlies je veel tijd - de coureur ${actionVerb} hier veel later.`,
    tone: 'bad',
  }
}
