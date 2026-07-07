import type { DriverAcronym } from '../types'

export interface TeamLivery {
  body: string
  accent: string
  highlight: string
  cockpit: string
}

// Hand-picked colors evoking each team's real 2025 livery (not exact hex
// matches, no logos/marks) - used to render the stylized top-down cars.
export const TEAM_LIVERY: Record<DriverAcronym, TeamLivery> = {
  VER: { body: '#1B2A5B', accent: '#E10600', highlight: '#F2C744', cockpit: '#0A1230' },
  HAM: { body: '#E10600', accent: '#8C0000', highlight: '#FFFFFF', cockpit: '#2A0000' },
  ANT: { body: '#171D1B', accent: '#00D7B6', highlight: '#C6C6C6', cockpit: '#000000' },
  NOR: { body: '#FF8000', accent: '#0A2240', highlight: '#47C7FC', cockpit: '#1A1A1A' },
}
