import type { PlayableCornerData } from '../types'
import { useBrakeGame } from '../hooks/useBrakeGame'
import { StartScreen } from './StartScreen'
import { GameScreen } from './GameScreen'
import { ResultScreen } from './ResultScreen'

interface GameFlowProps {
  corner: PlayableCornerData
  roadPath: { x: number; y: number }[]
  onPickAnother: () => void
}

export function GameFlow({ corner, roadPath, onPickAnother }: GameFlowProps) {
  const { phase, elapsedT, playerAttempt, crashed, start, brake, reset } = useBrakeGame(corner)

  if (phase === 'running') return <GameScreen corner={corner} roadPath={roadPath} elapsedT={elapsedT} onBrake={brake} />
  if (phase === 'result') {
    return <ResultScreen corner={corner} roadPath={roadPath} playerAttempt={playerAttempt} crashed={crashed} onRetry={reset} onPickAnother={onPickAnother} />
  }
  return <StartScreen corner={corner} roadPath={roadPath} onStart={start} onBack={onPickAnother} />
}
