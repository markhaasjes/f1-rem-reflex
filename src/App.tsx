import { useState } from 'react'
import circuitJson from './data/circuit.json'
import { DRIVERS } from './data/drivers'
import type { CircuitCorner, CircuitData, CornerData, DriverAcronym } from './types'
import { CircuitView } from './components/CircuitView'
import { DriverSelect } from './components/DriverSelect'
import { FlatOutScreen } from './components/FlatOutScreen'
import { GameFlow } from './components/GameFlow'
import { NumberBadge, Pill } from './components/Brand'

const circuit = circuitJson as CircuitData

type AppPhase = 'circuit' | 'driverSelect' | 'game'

function App() {
  const [phase, setPhase] = useState<AppPhase>('circuit')
  const [selectedCorner, setSelectedCorner] = useState<CircuitCorner | null>(null)
  const [selectedDriver, setSelectedDriver] = useState<DriverAcronym | null>(null)

  function handleZoomComplete(corner: CircuitCorner) {
    setSelectedCorner(corner)
    setPhase('driverSelect')
  }

  function handleSelectDriver(acronym: DriverAcronym) {
    setSelectedDriver(acronym)
    setPhase('game')
  }

  function handleBackToCircuit() {
    setSelectedCorner(null)
    setSelectedDriver(null)
    setPhase('circuit')
  }

  function handleBackToDriverSelect() {
    setSelectedDriver(null)
    setPhase('driverSelect')
  }

  const cornerData: CornerData | null =
    selectedCorner && selectedDriver ? (DRIVERS[selectedDriver].corners[String(selectedCorner.number)] ?? null) : null

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-5 bg-track-blue px-3 py-5 text-white sm:gap-7 sm:px-6 sm:py-8">
      <Pill className="gap-3 text-sm sm:text-base">
        <NumberBadge>NOS</NumberBadge>
        RemReflex — {circuit.meta.circuit}
      </Pill>

      <div className="flex w-full max-w-md flex-col items-center gap-4 sm:max-w-xl md:max-w-3xl lg:max-w-5xl">
        {phase === 'circuit' && (
          <div className="flex w-full flex-col items-center gap-3 text-center">
            <p className="text-sm text-white/80 sm:text-base">Kies een bocht:</p>
            <CircuitView circuit={circuit} onZoomComplete={handleZoomComplete} />
          </div>
        )}

        {phase === 'driverSelect' && selectedCorner && (
          <DriverSelect corner={selectedCorner} onSelectDriver={handleSelectDriver} onBack={handleBackToCircuit} />
        )}

        {phase === 'game' && cornerData?.actionType === 'none' && (
          <FlatOutScreen corner={cornerData} onPickAnother={handleBackToDriverSelect} />
        )}
        {phase === 'game' && cornerData && cornerData.actionType !== 'none' && (
          <GameFlow key={`${selectedDriver}-${selectedCorner?.number}`} corner={cornerData} onPickAnother={handleBackToDriverSelect} />
        )}
      </div>
    </div>
  )
}

export default App
