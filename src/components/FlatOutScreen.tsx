import { useEffect, useRef, useState } from 'react'
import type { DriverAcronym, CornerData } from '../types'
import { sampleAt, headingAt } from '../lib/corner'
import { TEAM_LIVERY } from '../lib/teamLivery'
import { NumberBadge, Pill } from './Brand'
import { CornerTrack } from './CornerTrack'

interface FlatOutScreenProps {
  corner: Extract<CornerData, { actionType: 'none' }>
  onPickAnother: () => void
}

// Some corners (Hunserug, Scheivlak, ...) are taken close to flat-out - there's
// no real brake/lift point to guess, so instead of a reflex game this just
// auto-plays the real lap through the corner as a small fact card.
export function FlatOutScreen({ corner, onPickAnother }: FlatOutScreenProps) {
  const [elapsedT, setElapsedT] = useState(0)
  const rafRef = useRef<number | null>(null)
  const livery = TEAM_LIVERY[corner.meta.driverAcronym as DriverAcronym]
  const minSpeed = Math.min(...corner.samples.map((s) => s.speedKph))

  useEffect(() => {
    const startTime = performance.now()
    const tick = (now: number) => {
      const t = (now - startTime) / 1000
      if (t >= corner.durationS) {
        setElapsedT(0)
        rafRef.current = requestAnimationFrame(() => {
          const restart = performance.now()
          const loop = (n: number) => {
            const rt = (n - restart) / 1000
            setElapsedT(Math.min(rt, corner.durationS))
            if (rt < corner.durationS) rafRef.current = requestAnimationFrame(loop)
          }
          rafRef.current = requestAnimationFrame(loop)
        })
        return
      }
      setElapsedT(t)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [corner])

  const state = sampleAt(corner.samples, elapsedT)
  const heading = headingAt(corner.samples, elapsedT)

  return (
    <div className="flex w-full flex-col items-center gap-4 text-center">
      <Pill className="gap-3 text-base sm:text-lg">
        <NumberBadge>{corner.meta.cornerNumber}</NumberBadge>
        {corner.meta.corner}
      </Pill>

      <p className="text-sm text-white/80 sm:text-base">
        <strong style={{ color: corner.meta.teamColor }}>{corner.meta.driverName}</strong> — bijna vol gas, niet lager dan{' '}
        <strong>{minSpeed} km/h</strong>
      </p>

      <div className="h-[22rem] w-full overflow-hidden rounded-2xl bg-track-blue-dark/40 sm:h-[30rem] md:h-[38rem] lg:h-[42rem]">
        <CornerTrack samples={corner.samples} carPosition={{ x: state.x, y: state.y, heading }} livery={livery} />
      </div>

      <button
        type="button"
        onClick={onPickAnother}
        className="w-full max-w-sm rounded-full bg-white px-8 py-4 text-lg font-extrabold text-ink transition hover:scale-[1.02] active:scale-95 sm:text-xl"
      >
        Kies een andere bocht
      </button>
    </div>
  )
}
