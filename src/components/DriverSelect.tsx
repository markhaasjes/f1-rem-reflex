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
    <div className="flex w-full flex-col items-center gap-4 text-center">
      <Pill className="gap-3 text-base sm:text-lg">
        <NumberBadge>{corner.number}</NumberBadge>
        {corner.name}
      </Pill>

      <p className="text-sm text-white/80 sm:text-base">Kies een coureur:</p>

      <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {DRIVER_ORDER.map((acronym) => {
          const driver = DRIVERS[acronym].meta
          const livery = TEAM_LIVERY[acronym]
          return (
            <button
              key={acronym}
              type="button"
              onClick={() => onSelectDriver(acronym)}
              className="flex flex-col items-center gap-2 rounded-2xl border-2 border-transparent bg-white/10 p-3 transition hover:border-white/60 hover:bg-white/20 active:scale-95 sm:p-5"
            >
              <svg viewBox="-22 -12 44 24" className="h-12 w-20 sm:h-16 sm:w-28 md:h-20 md:w-36">
                <g transform="rotate(-90)">
                  <F1Car livery={livery} size={0.85} />
                </g>
              </svg>
              <span className="font-extrabold sm:text-lg">{driver.driverName}</span>
              <span className="text-xs text-white/70 sm:text-sm">{driver.teamName}</span>
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
