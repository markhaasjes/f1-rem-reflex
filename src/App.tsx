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
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-track-blue px-4 py-10 text-white">
      <Pill className="gap-3">
        <NumberBadge>NOS</NumberBadge>
        RemReflex — {circuit.meta.circuit}
      </Pill>

      {phase === 'circuit' && (
        <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
          <p className="text-white/90">Kies een bocht op de circuitkaart om 'm uit te proberen.</p>
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
  )
}

export default App
