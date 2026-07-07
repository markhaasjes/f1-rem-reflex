import ver from './drivers/VER.json'
import ham from './drivers/HAM.json'
import ant from './drivers/ANT.json'
import nor from './drivers/NOR.json'
import type { DriverAcronym, DriverFile } from '../types'

export const DRIVER_ORDER: DriverAcronym[] = ['VER', 'HAM', 'ANT', 'NOR']

export const DRIVERS: Record<DriverAcronym, DriverFile> = {
  VER: ver as DriverFile,
  HAM: ham as DriverFile,
  ANT: ant as DriverFile,
  NOR: nor as DriverFile,
}
