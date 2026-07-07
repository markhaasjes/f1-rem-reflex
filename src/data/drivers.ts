import type { DriverAcronym, DriverFile, DriverMeta } from '../types'

export const DRIVER_ORDER: DriverAcronym[] = ['VER', 'HAM', 'ANT', 'NOR']

// Static copy of each driver file's meta block, so the driver picker can
// render names/teams without downloading anyone's full telemetry.
export const DRIVER_META: Record<DriverAcronym, DriverMeta> = {
  VER: { driverNumber: 1, driverAcronym: 'VER', driverName: 'Max VERSTAPPEN', teamName: 'Red Bull Racing', teamColor: '#4781D7', lapNumber: 17, lapDurationS: 68.925 },
  HAM: { driverNumber: 44, driverAcronym: 'HAM', driverName: 'Lewis HAMILTON', teamName: 'Ferrari', teamColor: '#ED1131', lapNumber: 13, lapDurationS: 69.261 },
  ANT: { driverNumber: 12, driverAcronym: 'ANT', driverName: 'Kimi ANTONELLI', teamName: 'Mercedes', teamColor: '#00D7B6', lapNumber: 11, lapDurationS: 69.493 },
  NOR: { driverNumber: 4, driverAcronym: 'NOR', driverName: 'Lando NORRIS', teamName: 'McLaren', teamColor: '#F47600', lapNumber: 14, lapDurationS: 68.674 },
}

const cache = new Map<DriverAcronym, DriverFile>()

// Dynamic import so Vite splits each driver's ~250KB telemetry into its own
// chunk, fetched only when that driver is picked - keeps the initial payload
// small on mobile connections.
export async function loadDriver(acronym: DriverAcronym): Promise<DriverFile> {
  const cached = cache.get(acronym)
  if (cached) return cached

  let module: { default: unknown }
  switch (acronym) {
    case 'VER':
      module = await import('./drivers/VER.json')
      break
    case 'HAM':
      module = await import('./drivers/HAM.json')
      break
    case 'ANT':
      module = await import('./drivers/ANT.json')
      break
    case 'NOR':
      module = await import('./drivers/NOR.json')
      break
  }
  const file = module.default as DriverFile
  cache.set(acronym, file)
  return file
}
