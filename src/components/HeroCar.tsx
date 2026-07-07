import { VERSTAPPEN_LIVERY } from '../lib/teamLivery'

// Flat-illustration side view of the car (nose to the left), in the style of
// the reference artwork: bold shapes, dark wheels with a brake-glow arc.
export function HeroCar({ className = '' }: { className?: string }) {
  const { body, accent, highlight, cockpit } = VERSTAPPEN_LIVERY
  return (
    <svg viewBox="0 0 240 96" className={className} role="img" aria-label="Illustratie van de raceauto van Max Verstappen">
      {/* shadow */}
      <ellipse cx={120} cy={86} rx={100} ry={6} fill="#0b1440" opacity={0.18} />

      {/* rear wing */}
      <rect x={196} y={22} width={26} height={8} rx={3} fill={accent} />
      <rect x={206} y={28} width={7} height={30} rx={3} fill={cockpit} />
      <rect x={192} y={52} width={34} height={7} rx={3.5} fill={body} />

      {/* floor + nose silhouette */}
      <path
        d={`M 12 70
            L 60 62
            C 84 58 96 50 116 46
            L 150 42
            C 170 40 190 46 200 58
            L 204 70
            C 204 76 198 78 190 78
            L 30 78
            C 18 78 12 76 12 70 Z`}
        fill={body}
      />
      {/* nose tip */}
      <path d="M 6 66 L 40 60 L 44 70 L 10 74 C 5 74 4 68 6 66 Z" fill={accent} />
      {/* engine cover accent sweep */}
      <path d="M 120 46 C 140 42 165 42 186 52 L 180 60 C 160 50 140 50 124 54 Z" fill={accent} />
      {/* halo + cockpit */}
      <path d="M 128 46 C 132 34 150 34 154 46 L 148 46 C 146 40 136 40 134 46 Z" fill={cockpit} />
      <circle cx={141} cy={44} r={7} fill={cockpit} />
      <rect x={112} y={52} width={10} height={4} rx={2} fill={highlight} />

      {/* wheels: rear, front, with brake-glow arcs */}
      <circle cx={178} cy={70} r={22} fill="#1c2230" />
      <circle cx={178} cy={70} r={9} fill="#2c3444" />
      <path d="M 178 56 A 14 14 0 0 1 191 66" fill="none" stroke="#f2811d" strokeWidth={4} strokeLinecap="round" />
      <circle cx={62} cy={72} r={19} fill="#1c2230" />
      <circle cx={62} cy={72} r={8} fill="#2c3444" />
      <path d="M 62 60 A 12 12 0 0 1 73 68" fill="none" stroke="#f2811d" strokeWidth={3.5} strokeLinecap="round" />
    </svg>
  )
}
