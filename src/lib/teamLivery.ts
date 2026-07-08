export interface TeamLivery {
  body: string;
  accent: string;
  highlight: string;
  cockpit: string;
}

// Colors evoking the real 2025 Red Bull livery (not exact hex matches, no
// logos/marks) - used for the top-down car in the scene and the hero car.
export const VERSTAPPEN_LIVERY: TeamLivery = {
  body: '#1B2A5B',
  accent: '#E10600',
  highlight: '#F2C744',
  cockpit: '#0A1230',
};
