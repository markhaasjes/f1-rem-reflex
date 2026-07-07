import { useState } from 'react'
import circuitJson from './data/circuit.json'
import { loadDriver } from './data/drivers'
import type { CircuitCorner, CircuitData, CornerData, DriverAcronym, DriverFile } from './types'
import { CircuitView } from './components/CircuitView'
import { DriverSelect } from './components/DriverSelect'
import { FlatOutScreen } from './components/FlatOutScreen'
import { GameFlow } from './components/GameFlow'
import { NumberBadge, Pill } from './components/Brand'

const circuit = circuitJson as CircuitData

type AppPhase = 'circuit' | 'driverSelect' | 'loadingDriver' | 'game'

function App() {
  const [phase, setPhase] = useState<AppPhase>('circuit')
  const [selectedCorner, setSelectedCorner] = useState<CircuitCorner | null>(null)
  const [selectedDriver, setSelectedDriver] = useState<DriverAcronym | null>(null)
  const [driverFile, setDriverFile] = useState<DriverFile | null>(null)

  function handleZoomComplete(corner: CircuitCorner) {
    setSelectedCorner(corner)
    setPhase('driverSelect')
  }

  async function handleSelectDriver(acronym: DriverAcronym) {
    setSelectedDriver(acronym)
    setPhase('loadingDriver')
    try {
      const file = await loadDriver(acronym)
      setDriverFile(file)
      setPhase('game')
    } catch {
      // network hiccup on the chunk fetch - drop back to the picker so the user can retry
      setSelectedDriver(null)
      setPhase('driverSelect')
    }
  }

  function handleBackToCircuit() {
    setSelectedCorner(null)
    setSelectedDriver(null)
    setDriverFile(null)
    setPhase('circuit')
  }

  function handleBackToDriverSelect() {
    setSelectedDriver(null)
    setDriverFile(null)
    setPhase('driverSelect')
  }

  const cornerData: CornerData | null =
    selectedCorner && driverFile ? (driverFile.corners[String(selectedCorner.number)] ?? null) : null
  const roadPath = selectedCorner?.roadPath ?? null

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-5 bg-track-blue px-3 py-5 text-white sm:gap-7 sm:px-6 sm:py-8">
      <Pill className="gap-3 text-sm sm:text-base">
        <NumberBadge>NOS</NumberBadge>
        Rem Reflex · {circuit.meta.circuit}
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

        {phase === 'loadingDriver' && <p className="text-sm text-white/80 sm:text-base">Rondedata laden...</p>}

        {phase === 'game' && cornerData?.actionType === 'none' && roadPath && (
          <FlatOutScreen corner={cornerData} roadPath={roadPath} onPickAnother={handleBackToDriverSelect} />
        )}
        {phase === 'game' && cornerData && cornerData.actionType !== 'none' && roadPath && (
          <GameFlow key={`${selectedDriver}-${selectedCorner?.number}`} corner={cornerData} roadPath={roadPath} onPickAnother={handleBackToDriverSelect} />
        )}
      </div>
    </div>
  )
}

export default App
