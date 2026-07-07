import type { DriverAcronym, PlayableCornerData } from '../types'
import { TEAM_LIVERY } from '../lib/teamLivery'
import { NumberBadge, Pill } from './Brand'
import { CornerTrack } from './CornerTrack'

interface StartScreenProps {
  corner: PlayableCornerData
  onStart: () => void
  onBack: () => void
}

const ACTION_LABEL: Record<'brake' | 'lift', string> = {
  brake: 'Druk op REM op het juiste moment.',
  lift: 'Druk op REM op het moment dat hij van het gas gaat.',
}

export function StartScreen({ corner, onStart, onBack }: StartScreenProps) {
  const livery = TEAM_LIVERY[corner.meta.driverAcronym as DriverAcronym]

  return (
    <div className="flex w-full flex-col items-center gap-4 text-center">
      <Pill className="gap-3 text-base sm:text-lg">
        <NumberBadge>{corner.meta.cornerNumber}</NumberBadge>
        {corner.meta.corner}
      </Pill>

      <p className="text-sm text-white/80 sm:text-base">
        <strong style={{ color: corner.meta.teamColor }}>{corner.meta.driverName}</strong> · {corner.meta.teamName}
      </p>

      <div className="h-[22rem] w-full overflow-hidden rounded-2xl bg-track-blue-dark/40 sm:h-[30rem] md:h-[38rem] lg:h-[42rem]">
        <CornerTrack samples={corner.samples} carPosition={{ x: corner.samples[0].x, y: corner.samples[0].y, heading: 0 }} livery={livery} />
      </div>

      <p className="text-sm text-white/90 sm:text-base">{ACTION_LABEL[corner.actionType]}</p>

      <button
        type="button"
        onClick={onStart}
        className="w-full max-w-sm rounded-full bg-white px-8 py-4 text-lg font-extrabold text-ink transition hover:scale-[1.02] active:scale-95 sm:text-xl"
      >
        Start de bocht
      </button>

      <button type="button" onClick={onBack} className="text-sm font-semibold text-white/70 underline underline-offset-4">
        Andere coureur of bocht kiezen
      </button>
    </div>
  )
}
