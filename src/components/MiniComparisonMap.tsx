import { useMemo } from 'react';
import { primePathModel } from '../lib/corner';
import { buildPhaseSegments } from '../lib/phases';
import { buildInputSegments } from '../lib/playerInput';
import { PHASE_COLOR, offsetPathPoints, rotateOutline } from '../lib/scene';
import type { GameRound, InputTransition, Point, ZandvoortFixture } from '../types';

/** One shared round to draw: the window plus the sharer's pedal timeline. */
export interface SharedRoundRun {
  round: GameRound;
  transitions: InputTransition[];
}

// How far the sharer's line sits beside Max's, in world meters. At the
// full-circuit zoom of this card a realistic 4.5m offset would collapse into
// Max's line, so the mini map exaggerates it - schematic, like the diagram
// in the score explainer.
const SHARED_LINE_OFFSET_M = 14;
const OUTLINE_PAD_M = 30;
// Every n-th outline point is plenty for a card-sized ribbon and keeps the
// path string (and the DOM) an order of magnitude smaller.
const OUTLINE_DECIMATION = 3;

function pathFrom(points: Point[], close = false): string {
  const steps = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  return steps.join(' ') + (close ? ' Z' : '');
}

// The little circuit on the shared-score landing: the full track as a plain
// ribbon, and for every played window Max's phase-colored racing line with
// the sharer's line drawn parallel beside it - the same comparison the round
// result shows, shrunk to one static card-sized SVG. World meters go straight
// into the viewBox (the fixture is already north-up, y down like SVG);
// non-scaling strokes keep the lines crisp at any rendered size.
export function MiniComparisonMap({ fixture, runs }: { fixture: ZandvoortFixture; runs: SharedRoundRun[] }) {
  const map = useMemo(() => {
    const outline = rotateOutline(fixture.trackOutline, fixture.startFinish);
    primePathModel(fixture.lap.samples, outline);

    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    const minX = Math.min(...xs) - OUTLINE_PAD_M;
    const minY = Math.min(...ys) - OUTLINE_PAD_M;
    const viewBox = `${minX.toFixed(0)} ${minY.toFixed(0)} ${(Math.max(...xs) - minX + OUTLINE_PAD_M).toFixed(0)} ${(
      Math.max(...ys) - minY + OUTLINE_PAD_M
    ).toFixed(0)}`;

    const lines = runs.flatMap(({ round, transitions }) => [
      ...buildPhaseSegments(fixture.lap.samples, round.tStart, round.tEnd).map((segment) => ({
        d: pathFrom(segment.points),
        color: PHASE_COLOR[segment.phase],
        widthPx: 2.6,
      })),
      ...buildInputSegments(fixture.lap.samples, transitions, round.tStart, round.tEnd).map((segment) => ({
        d: pathFrom(offsetPathPoints(segment.points, SHARED_LINE_OFFSET_M)),
        color: PHASE_COLOR[segment.phase],
        widthPx: 2,
      })),
    ]);

    return {
      viewBox,
      outlinePath: pathFrom(outline.filter((_, i) => i % OUTLINE_DECIMATION === 0), true),
      lines,
    };
  }, [fixture, runs]);

  return (
    <svg
      viewBox={map.viewBox}
      role="img"
      aria-label="Kaart van Circuit Zandvoort met per bocht de lijn van Max naast die van de gedeelde ronde"
      className="h-auto w-full"
    >
      <path
        d={map.outlinePath}
        fill="none"
        stroke="#dddcd4"
        strokeWidth={6}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {map.lines.map((line, i) => (
        <path
          key={i}
          d={line.d}
          fill="none"
          stroke={line.color}
          strokeWidth={line.widthPx}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
