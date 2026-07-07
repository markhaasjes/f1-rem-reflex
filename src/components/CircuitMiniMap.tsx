import { useMemo } from "react";
import { computeViewBox } from "../lib/geometry";
import type { TarzanFixture } from "../types";

interface CircuitMiniMapProps {
  fixture: TarzanFixture;
}

const PADDING_M = 70;

// Schematic circuit map in the classic NOS bochten-kaart style: white track
// outline on brand blue, with a pulsing badge on the Tarzanbocht.
export function CircuitMiniMap({ fixture }: CircuitMiniMapProps) {
  const { outline, startFinish, corner } = fixture.map;
  const viewBox = useMemo(() => computeViewBox(outline, PADDING_M), [outline]);
  const points = useMemo(
    () => outline.map((p) => `${p.x},${p.y}`).join(" "),
    [outline],
  );

  return (
    <svg
      viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
      className="h-full w-full"
      role="img"
      aria-label={`Circuitkaart van ${fixture.meta.circuit} met de ${fixture.meta.corner} gemarkeerd`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="#101d63"
        strokeWidth={22}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={points}
        fill="none"
        stroke="white"
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <g
        transform={`translate(${startFinish.x} ${startFinish.y}) rotate(${startFinish.headingDeg + 90})`}
      >
        <line
          x1={-16}
          y1={0}
          x2={16}
          y2={0}
          stroke="white"
          strokeWidth={7}
          strokeLinecap="round"
        />
        <line
          x1={-16}
          y1={0}
          x2={16}
          y2={0}
          stroke="#111827"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray="3.5 3.5"
        />
      </g>

      <g transform={`translate(${corner.x} ${corner.y})`}>
        <circle r={30} fill="#2f6fed" opacity={0.5}>
          <animate
            attributeName="r"
            values="30;50;30"
            dur="2.2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.5;0;0.5"
            dur="2.2s"
            repeatCount="indefinite"
          />
        </circle>
        <circle r={30} fill="#2f6fed" stroke="white" strokeWidth={6} />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={32}
          fontWeight={800}
          fill="white"
        >
          {fixture.meta.cornerNumber}
        </text>
        <text
          x={0}
          y={66}
          textAnchor="middle"
          fontSize={34}
          fontWeight={800}
          fill="white"
          stroke="#0b1440"
          strokeWidth={7}
          paintOrder="stroke"
        >
          {fixture.meta.corner}
        </text>
      </g>
    </svg>
  );
}
