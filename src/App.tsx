import { useEffect, useMemo } from 'react'
import fixtureJson from './data/tarzanbocht.json'
import type { TarzanFixture } from './types'
import { useBrakeGame } from './hooks/useBrakeGame'
import { sampleAt } from './lib/corner'
import { describeBrakeAttempt } from './lib/scoring'
import { CornerScene } from './components/CornerScene'
import { CircuitMiniMap } from './components/CircuitMiniMap'
import { HeroCar } from './components/HeroCar'
import { NumberBadge, Pill } from './components/Brand'

const fixture = fixtureJson as TarzanFixture

const TONE_STYLES = {
  perfect: 'bg-emerald-500',
  good: 'bg-emerald-600',
  okay: 'bg-amber-500',
  bad: 'bg-red-600',
} as const

// Every phase layer stays mounted in the same grid cell and crossfades, so
// the layout never jumps when the phase changes.
function stackLayer(visible: boolean, extra = '') {
  return `col-start-1 row-start-1 transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-1'} ${extra}`
}

function App() {
  const { phase, elapsedT, playerAttempt, crashed, start, brake, reset } = useBrakeGame(fixture)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      event.preventDefault()
      if (phase === 'ready') start()
      else if (phase === 'running') brake()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, start, brake])

  const liveSpeed = phase === 'running' ? Math.round(sampleAt(fixture.samples, elapsedT).speedKph) : null

  const result = useMemo(() => {
    if (phase !== 'result') return null
    const deltaM = playerAttempt ? playerAttempt.distanceM - fixture.brakePoint.distanceM : null
    return describeBrakeAttempt(deltaM)
  }, [phase, playerAttempt])

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-track-blue px-3 py-5 text-white sm:gap-6 sm:px-6">
      <Pill className="gap-3 text-sm sm:text-base">
        <NumberBadge>NOS</NumberBadge>
        Rem Reflex · {fixture.meta.circuit}
      </Pill>

      <main className="flex w-full max-w-md flex-col gap-3 sm:max-w-2xl lg:max-w-4xl">
        {/* Stage: fixed height, scene always mounted underneath, intro layer on top */}
        <div className="relative h-[24rem] w-full overflow-hidden rounded-3xl sm:h-[30rem] lg:h-[36rem]">
          <CornerScene
            fixture={fixture}
            phase={phase === 'ready' ? 'idle' : phase}
            elapsedT={elapsedT}
            playerAttempt={playerAttempt}
          />

          {/* live speed */}
          <div
            className={`absolute left-3 top-3 rounded-full bg-white/95 px-4 py-1.5 font-extrabold tabular-nums text-ink shadow transition-opacity duration-300 sm:text-lg ${liveSpeed === null ? 'opacity-0' : 'opacity-100'}`}
          >
            {liveSpeed ?? 0} km/u
          </div>

          {/* verdict banner */}
          <div
            className={`absolute inset-x-3 top-3 mx-auto max-w-md rounded-2xl px-5 py-3 text-center shadow-lg transition-all duration-500 ${result ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 -translate-y-2'} ${TONE_STYLES[result?.tone ?? 'okay']}`}
          >
            <h2 className="text-lg font-extrabold sm:text-xl">{result?.title}</h2>
            <p className="text-sm text-white/90">{result?.detail}</p>
          </div>

          {/* intro layer: circuit map + hero car */}
          <div
            className={`absolute -inset-px flex flex-col bg-track-blue transition-all duration-700 ease-in-out ${phase === 'ready' ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-150'}`}
          >
            <div className="relative min-h-0 flex-1 p-2">
              <CircuitMiniMap fixture={fixture} />
            </div>
            <div className="mx-3 mb-3 flex items-center gap-3 rounded-2xl bg-[#dbe7fb] p-3 sm:mx-6 sm:mb-5 sm:gap-5 sm:p-4">
              <HeroCar className="h-14 w-auto shrink-0 sm:h-20" />
              <p className="text-sm font-bold leading-snug text-ink sm:text-lg">
                Rem jij net zo laat als <span className="text-[#E10600]">Max Verstappen</span>? Dit is zijn echte poleronde door de
                Tarzanbocht.
              </p>
            </div>
          </div>
        </div>

        {/* info row: fixed height, layers crossfade */}
        <div className="grid h-12 place-items-center text-center sm:h-14">
          <p className={stackLayer(phase === 'ready', 'text-sm text-white/85 sm:text-lg')}>
            Kijk goed naar de bocht en druk op REM op het juiste moment.
          </p>
          <p className={stackLayer(phase === 'running', 'text-base font-extrabold sm:text-xl')}>Wachten... wachten...</p>
          <div className={stackLayer(phase === 'result', 'flex items-center justify-center gap-2 sm:gap-3')}>
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-ink sm:px-4 sm:text-base">
              Max remde bij {fixture.brakePoint.speedKph} km/u
            </span>
            <span className="rounded-full bg-badge-blue px-3 py-1.5 text-xs font-extrabold text-white sm:px-4 sm:text-base">
              Jij: {crashed || !playerAttempt ? 'niet geremd' : `${Math.round(playerAttempt.speedKph)} km/u`}
            </span>
          </div>
        </div>

        {/* action row: fixed height, layers crossfade */}
        <div className="grid h-20 place-items-center sm:h-24">
          <button
            type="button"
            onClick={start}
            className={stackLayer(
              phase === 'ready',
              'w-full max-w-sm select-none touch-manipulation rounded-full bg-white px-8 py-4 text-lg font-extrabold text-ink shadow-lg transition hover:scale-[1.02] active:scale-95 sm:text-xl',
            )}
          >
            Start de ronde
          </button>
          <button
            type="button"
            onClick={brake}
            className={stackLayer(
              phase === 'running',
              'w-full max-w-sm select-none touch-manipulation rounded-full bg-red-600 px-8 py-5 text-2xl font-extrabold tracking-wide shadow-lg active:scale-95 sm:text-3xl',
            )}
          >
            REM!
          </button>
          <div className={stackLayer(phase === 'result', 'flex w-full max-w-sm flex-col items-center gap-1.5')}>
            <button
              type="button"
              onClick={start}
              className="w-full select-none touch-manipulation rounded-full bg-white px-8 py-4 text-lg font-extrabold text-ink shadow-lg transition hover:scale-[1.02] active:scale-95 sm:text-xl"
            >
              Probeer opnieuw
            </button>
            <button type="button" onClick={reset} className="text-sm font-semibold text-white/70 underline underline-offset-4">
              Terug naar start
            </button>
          </div>
        </div>
      </main>

      <p className="text-center text-xs text-white/50">
        Echte data via OpenF1: {fixture.meta.sessionName} {fixture.meta.meetingName} {fixture.meta.year}, ronde {fixture.meta.lapNumber} van{' '}
        {fixture.meta.driverName}
      </p>
    </div>
  )
}

export default App
