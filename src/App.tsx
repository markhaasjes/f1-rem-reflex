import cornerDataJson from './data/tarzanbocht-2025.json'
import type { CornerData } from './types'
import { useBrakeGame } from './hooks/useBrakeGame'
import { StartScreen } from './components/StartScreen'
import { GameScreen } from './components/GameScreen'
import { ResultScreen } from './components/ResultScreen'
import { NumberBadge, Pill } from './components/Brand'

const corner = cornerDataJson as CornerData

function App() {
  const { phase, elapsedT, playerAttempt, crashed, start, brake, reset } = useBrakeGame(corner)

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-track-blue px-4 py-10 text-white">
      <Pill className="gap-3">
        <NumberBadge>NOS</NumberBadge>
        RemReflex — Circuit Zandvoort
      </Pill>

      {phase === 'ready' && <StartScreen corner={corner} onStart={start} />}
      {phase === 'running' && <GameScreen corner={corner} elapsedT={elapsedT} onBrake={brake} />}
      {phase === 'result' && <ResultScreen corner={corner} playerAttempt={playerAttempt} crashed={crashed} onRetry={reset} />}
    </div>
  )
}

export default App
