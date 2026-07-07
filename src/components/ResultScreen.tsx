import type { BrakeAttempt, DriverAcronym, PlayableCornerData } from '../types'
import { sampleAt } from '../lib/corner'
import { describeAttempt } from '../lib/scoring'
import { TEAM_LIVERY } from '../lib/teamLivery'
import { CornerTrack } from './CornerTrack'

const TONE_STYLES = {
  perfect: 'bg-emerald-500',
  good: 'bg-emerald-600',
  okay: 'bg-amber-500',
  bad: 'bg-red-600',
} as const

interface ResultScreenProps {
  corner: PlayableCornerData
  playerAttempt: BrakeAttempt | null
  crashed: boolean
  onRetry: () => void
  onPickAnother: () => void
}

export function ResultScreen({ corner, playerAttempt, crashed, onRetry, onPickAnother }: ResultScreenProps) {
  const livery = TEAM_LIVERY[corner.meta.driverAcronym as DriverAcronym]
  const brakePos = sampleAt(corner.samples, corner.brakePoint.t)
  const apexPos = sampleAt(corner.samples, corner.apexPoint.t)
  const playerPos = playerAttempt ? sampleAt(corner.samples, playerAttempt.t) : null

  const deltaM = playerAttempt ? playerAttempt.distanceM - corner.brakePoint.distanceM : null
  const result = describeAttempt(deltaM, { actionType: corner.actionType, cornerName: corner.meta.corner })

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
      <div className={`w-full rounded-2xl px-5 py-4 ${TONE_STYLES[result.tone]}`}>
        <h2 className="text-xl font-extrabold text-white">{result.title}</h2>
        <p className="text-sm text-white/90">{result.detail}</p>
      </div>

      <div className="h-72 w-full overflow-hidden rounded-2xl bg-track-blue-dark/40">
        <CornerTrack
          samples={corner.samples}
          carPosition={null}
          livery={livery}
          apexMarker={apexPos}
          brakeMarker={brakePos}
          playerMarker={playerPos}
        />
      </div>

      <dl className="grid w-full grid-cols-2 gap-3 text-left">
        <div className="rounded-xl bg-white/10 px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-white/60">{corner.meta.driverAcronym} remde bij</dt>
          <dd className="text-lg font-bold tabular-nums">{corner.brakePoint.speedKph} km/h</dd>
        </div>
        <div className="rounded-xl bg-white/10 px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-white/60">Jij remde bij</dt>
          <dd className="text-lg font-bold tabular-nums">{crashed || !playerAttempt ? '—' : `${Math.round(playerAttempt.speedKph)} km/h`}</dd>
        </div>
      </dl>

      <p className="text-xs text-white/60">
        Databron: OpenF1.org — {corner.meta.meetingName} {corner.meta.year}, {corner.meta.sessionName}, ronde {corner.meta.lapNumber} van{' '}
        {corner.meta.driverName}.
      </p>

      <button
        type="button"
        onClick={onRetry}
        className="w-full rounded-full bg-white px-8 py-4 text-lg font-extrabold text-ink transition hover:scale-[1.02] active:scale-95"
      >
        Probeer opnieuw
      </button>
      <button type="button" onClick={onPickAnother} className="text-sm font-semibold text-white/70 underline underline-offset-4">
        Andere coureur of bocht kiezen
      </button>
    </div>
  )
}
