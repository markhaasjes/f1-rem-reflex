import { useEffect } from 'react'
import type { DriverAcronym, PlayableCornerData } from '../types'
import { headingAt, sampleAt } from '../lib/corner'
import { TEAM_LIVERY } from '../lib/teamLivery'
import { CornerTrack } from './CornerTrack'

interface GameScreenProps {
  corner: PlayableCornerData
  elapsedT: number
  onBrake: () => void
}

export function GameScreen({ corner, elapsedT, onBrake }: GameScreenProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault()
        onBrake()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBrake])

  const state = sampleAt(corner.samples, elapsedT)
  const heading = headingAt(corner.samples, elapsedT)
  const livery = TEAM_LIVERY[corner.meta.driverAcronym as DriverAcronym]

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5">
      <div className="flex w-full items-baseline justify-between px-2">
        <span className="text-4xl font-extrabold tabular-nums">{Math.round(state.speedKph)}</span>
        <span className="text-sm text-white/70">km/h</span>
      </div>

      <div className="h-72 w-full overflow-hidden rounded-2xl bg-track-blue-dark/40">
        <CornerTrack samples={corner.samples} carPosition={{ x: state.x, y: state.y, heading }} livery={livery} />
      </div>

      <button
        type="button"
        onClick={onBrake}
        className="w-full select-none rounded-full bg-red-600 px-8 py-6 text-2xl font-extrabold tracking-wide text-white shadow-lg transition active:scale-95"
      >
        REM!
      </button>
    </div>
  )
}
