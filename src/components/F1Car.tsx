import type { TeamLivery } from '../lib/teamLivery'

interface F1CarProps {
  livery: TeamLivery
  size?: number
}

// Stylized top-down F1 car, nose pointing toward +x (heading 0deg), so it can
// be rotated directly with the same heading convention used across the app.
export function F1Car({ livery, size = 1 }: F1CarProps) {
  return (
    <g transform={`scale(${size})`}>
      {/* rear wing */}
      <rect x={-19} y={-7.5} width={3.2} height={2.6} rx={0.6} fill={livery.accent} />
      <rect x={-19} y={4.9} width={3.2} height={2.6} rx={0.6} fill={livery.accent} />
      <rect x={-18.5} y={-6} width={4} height={12} rx={1} fill={livery.body} stroke={livery.accent} strokeWidth={0.6} />

      {/* rear wheels */}
      <rect x={-11.5} y={-9} width={5.5} height={4.2} rx={1.4} fill="#111" />
      <rect x={-11.5} y={4.8} width={5.5} height={4.2} rx={1.4} fill="#111" />

      {/* sidepods + engine cover */}
      <path d="M -15 -6 C -9 -7.5 -2 -7.5 3 -4.5 L 3 4.5 C -2 7.5 -9 7.5 -15 6 Z" fill={livery.body} />
      <path d="M -13 -5.2 C -9 -6 -4 -5.6 -1 -3.6 L -1 3.6 C -4 5.6 -9 6 -13 5.2 Z" fill={livery.accent} opacity={0.85} />

      {/* front wheels */}
      <rect x={5.5} y={-9} width={5.5} height={4.2} rx={1.4} fill="#111" />
      <rect x={5.5} y={4.8} width={5.5} height={4.2} rx={1.4} fill="#111" />

      {/* nose + cockpit */}
      <path d="M 3 -4.5 C 8 -4 12 -2.4 18 -0.8 L 18 0.8 C 12 2.4 8 4 3 4.5 Z" fill={livery.body} />
      <path d="M 3 -1.6 C 5.5 -1.4 7 -0.8 7 0 C 7 0.8 5.5 1.4 3 1.6 Z" fill={livery.cockpit} />
      <path d="M 4.4 -2.4 C 6.4 -2.1 6.4 2.1 4.4 2.4" fill="none" stroke={livery.highlight} strokeWidth={0.7} />

      {/* front wing */}
      <rect x={15.5} y={-9} width={3} height={2.6} rx={0.6} fill={livery.accent} />
      <rect x={15.5} y={6.4} width={3} height={2.6} rx={0.6} fill={livery.accent} />
      <rect x={15} y={-5.5} width={4} height={11} rx={1} fill={livery.body} stroke={livery.accent} strokeWidth={0.6} />
      <rect x={17.2} y={-4.5} width={1.4} height={9} fill={livery.highlight} opacity={0.9} />
    </g>
  )
}
