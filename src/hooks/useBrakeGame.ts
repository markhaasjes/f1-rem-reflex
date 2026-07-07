import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrakeAttempt, GamePhase, TarzanFixture } from '../types'
import { sampleAt } from '../lib/corner'

export function useBrakeGame(corner: TarzanFixture) {
  const [phase, setPhase] = useState<GamePhase>('ready')
  const [elapsedT, setElapsedT] = useState(0)
  const [playerAttempt, setPlayerAttempt] = useState<BrakeAttempt | null>(null)
  const [crashed, setCrashed] = useState(false)

  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef(0)

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const finishWithAttempt = useCallback(
    (t: number | null) => {
      stopLoop()
      if (t === null) {
        setCrashed(true)
        setPlayerAttempt(null)
      } else {
        const state = sampleAt(corner.samples, t)
        setCrashed(false)
        setPlayerAttempt({ t, distanceM: state.distanceM, speedKph: state.speedKph })
      }
      setPhase('result')
    },
    [corner.samples, stopLoop],
  )

  useEffect(() => {
    if (phase !== 'running') return

    startTimeRef.current = performance.now()

    const tick = (now: number) => {
      const t = (now - startTimeRef.current) / 1000
      if (t >= corner.durationS) {
        setElapsedT(corner.durationS)
        finishWithAttempt(null)
        return
      }
      setElapsedT(t)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return stopLoop
  }, [phase, corner.durationS, finishWithAttempt, stopLoop])

  const start = useCallback(() => {
    setPlayerAttempt(null)
    setCrashed(false)
    setElapsedT(0)
    setPhase('running')
  }, [])

  const brake = useCallback(() => {
    if (phase !== 'running') return
    const t = (performance.now() - startTimeRef.current) / 1000
    finishWithAttempt(Math.min(t, corner.durationS))
  }, [phase, corner.durationS, finishWithAttempt])

  const reset = useCallback(() => {
    stopLoop()
    setPhase('ready')
    setElapsedT(0)
    setPlayerAttempt(null)
    setCrashed(false)
  }, [stopLoop])

  return { phase, elapsedT, playerAttempt, crashed, start, brake, reset }
}
