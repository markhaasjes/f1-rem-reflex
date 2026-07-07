import type { DriverAcronym, PlayableCornerData } from '../types'
import { TEAM_LIVERY } from '../lib/teamLivery'
import { NumberBadge, Pill } from './Brand'
import { CornerTrack } from './CornerTrack'

interface StartScreenProps {
  corner: PlayableCornerData
  onStart: () => void
  onBack: () => void
}

const ACTION_VERB: Record<'brake' | 'lift', string> = {
  brake: 'zou remmen',
  lift: 'van het gas zou gaan',
}

export function StartScreen({ corner, onStart, onBack }: StartScreenProps) {
  const livery = TEAM_LIVERY[corner.meta.driverAcronym as DriverAcronym]

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <Pill className="gap-3 text-lg">
        <NumberBadge>{corner.meta.cornerNumber}</NumberBadge>
        {corner.meta.corner}
      </Pill>

      <div className="h-64 w-full overflow-hidden rounded-2xl bg-track-blue-dark/40">
        <CornerTrack samples={corner.samples} carPosition={{ x: corner.samples[0].x, y: corner.samples[0].y, heading: 0 }} livery={livery} />
      </div>

      <p className="text-balance text-white/90">
        Rijd jij op het juiste moment? Je ziet de echte rijlijn van{' '}
        <strong style={{ color: corner.meta.teamColor }}>{corner.meta.driverName}</strong> ({corner.meta.teamName}) tijdens zijn snelste
        ronde in de {corner.meta.sessionName.toLowerCase()} van de {corner.meta.meetingName} {corner.meta.year}. Druk op REM op het
        moment dat jij {ACTION_VERB[corner.actionType]} voor de {corner.meta.corner}.
      </p>

      <button
        type="button"
        onClick={onStart}
        className="w-full rounded-full bg-white px-8 py-4 text-lg font-extrabold text-ink transition hover:scale-[1.02] active:scale-95"
      >
        Start de bocht
      </button>

      <p className="text-xs text-white/60">Tip: druk op de spatiebalk of tik op de knop.</p>

      <button type="button" onClick={onBack} className="text-sm font-semibold text-white/70 underline underline-offset-4">
        Andere coureur of bocht kiezen
      </button>
    </div>
  )
}
