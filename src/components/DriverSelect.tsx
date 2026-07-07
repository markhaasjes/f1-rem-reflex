import type { CircuitCorner, DriverAcronym } from '../types'
import { DRIVERS, DRIVER_ORDER } from '../data/drivers'
import { TEAM_LIVERY } from '../lib/teamLivery'
import { F1Car } from './F1Car'
import { NumberBadge, Pill } from './Brand'

interface DriverSelectProps {
  corner: CircuitCorner
  onSelectDriver: (acronym: DriverAcronym) => void
  onBack: () => void
}

export function DriverSelect({ corner, onSelectDriver, onBack }: DriverSelectProps) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <Pill className="gap-3 text-lg">
        <NumberBadge>{corner.number}</NumberBadge>
        {corner.name}
      </Pill>

      <p className="text-white/90">Kies een coureur en rijd zijn echte ronde uit qualificatie 2025 door deze bocht.</p>

      <div className="grid w-full grid-cols-2 gap-3">
        {DRIVER_ORDER.map((acronym) => {
          const driver = DRIVERS[acronym].meta
          const livery = TEAM_LIVERY[acronym]
          return (
            <button
              key={acronym}
              type="button"
              onClick={() => onSelectDriver(acronym)}
              className="flex flex-col items-center gap-2 rounded-2xl border-2 border-transparent bg-white/10 p-4 transition hover:border-white/60 hover:bg-white/20 active:scale-95"
            >
              <svg viewBox="-22 -12 44 24" className="h-10 w-16">
                <g transform="rotate(-90)">
                  <F1Car livery={livery} size={0.85} />
                </g>
              </svg>
              <span className="font-extrabold">{driver.driverName}</span>
              <span className="text-xs text-white/70">{driver.teamName}</span>
            </button>
          )
        })}
      </div>

      <button type="button" onClick={onBack} className="text-sm font-semibold text-white/70 underline underline-offset-4">
        Terug naar circuitkaart
      </button>
    </div>
  )
}
