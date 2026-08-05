import { useEffect, useMemo, useRef } from 'react';
import { useElementSize } from '../hooks/useElementSize';
import { viewBoxFromCam, type CamBox } from '../hooks/useCameraFlight';
import { fitProjection, prepareCanvas } from '../lib/canvas';
import { CAR_ART_LENGTH_UNITS, drawF1Car } from '../lib/canvasCar';
import { headingAt, positionAt, primePathModel, sampleAt, smoothPathPoints } from '../lib/corner';
import { buildPhaseSegments, type DrivingPhase } from '../lib/phases';
import {
  drawCornerBadge,
  drawCornerCurbs,
  drawGravelTrap,
  drawGreenSurroundings,
  drawMapLabel,
  drawPaddock,
  drawPin,
  drawRibbon,
  drawDirectionArrow,
  drawSandBackground,
  drawSea,
  drawLakes,
  drawScaleBar,
  drawStartFinish,
  drawTrackRibbon,
  nearestIndex,
  rotateOutline,
} from '../lib/scene';
import type { GamePhase, GameRound, PlayerMark, ZandvoortFixture } from '../types';

interface CircuitSceneProps {
  fixture: ZandvoortFixture;
  camBox: CamBox;
  phase: GamePhase;
  round: GameRound;
  roundIndex: number;
  elapsedT: number;
  marks: PlayerMark[];
  /** Reveal Max's line, phase colors and brake/gas pins (round result). */
  showReference: boolean;
}

// The corner a round's name label anchors to: for combined rounds (e.g.
// Gerlach & Hugenholtz) that's the corner the round is named after, its last.
function lastRoundCorner(fixture: ZandvoortFixture, round: GameRound) {
  const lastCornerNumber = round.cornerNumbers.at(-1);
  return fixture.corners.find((c) => c.number === lastCornerNumber);
}

const CAR_SCALE = 13 / 22;
const CAR_MIN_LENGTH_PX = 15; // keep the car spottable at overview zoom

// Gravel traps per corner number, sized to match the real run-off areas as
// drawn on the official F1 TV circuit map (backM/fwdM = meters of trap
// before/after the apex along the track; side is picked automatically from
// the corner's curvature). Corners without an entry are bordered by grass.
const GRAVEL_TRAPS: Record<number, { backM: number; fwdM: number }> = {
  1: { backM: 95, fwdM: 85 }, // Tarzan: the big one at the end of the straight
  2: { backM: 35, fwdM: 45 }, // Gerlach
  3: { backM: 40, fwdM: 60 }, // Hugenholtz, outside of the banked hairpin
  7: { backM: 85, fwdM: 95 }, // Scheivlak: long strip through the dunes
  8: { backM: 70, fwdM: 90 }, // Mastersbocht
  9: { backM: 45, fwdM: 55 },
  10: { backM: 70, fwdM: 90 }, // the loop at the east end
  11: { backM: 45, fwdM: 70 }, // Hans Ernst chicane, outside
  13: { backM: 60, fwdM: 85 }, // Kumhobocht
  14: { backM: 45, fwdM: 60 }, // Arie Luyendijk banking entry
};

// Curb extents per corner number (meters before/after apex for the inside
// curb and past the apex for the outside exit curb), positioned against the
// aerial photos in docs/corners: long wrap-around curbs at the hairpins
// (Tarzan, Hugenholtz, the Bocht 10 loop, Kumho) and curbs along both edges
// through the Hans Ernst chicane.
const CURB_TUNING: Record<number, { backM: number; fwdInM: number; fwdOutM: number }> = {
  1: { backM: 75, fwdInM: 55, fwdOutM: 75 },
  3: { backM: 70, fwdInM: 50, fwdOutM: 70 },
  10: { backM: 65, fwdInM: 45, fwdOutM: 65 },
  11: { backM: 55, fwdInM: 60, fwdOutM: 65 },
  12: { backM: 55, fwdInM: 60, fwdOutM: 65 },
  13: { backM: 55, fwdInM: 40, fwdOutM: 60 },
};

// Screen-space offsets for the round name labels, so they clear each other on
// small (portrait) canvases - Gerlach & Hugenholtz and Hans Ernst sit close
// together on the map.
const LABEL_OFFSETS: Record<string, { dx: number; dy: number }> = {
  tarzan: { dx: 0, dy: 26 },
  hugenholtz: { dx: -6, dy: -20 },
  'bocht9-10': { dx: 10, dy: 28 },
  hansernst: { dx: 4, dy: 30 },
};

const PHASE_COLOR: Record<DrivingPhase, string> = {
  flat: '#12a37f',
  coast: '#f2a11c',
  brake: '#e61f15',
};

// The scene renders on its own requestAnimationFrame loop, reading the
// latest props from a ref: the camera, the run clock and the badge pulse all
// animate every frame anyway, and this keeps React out of the hot path.
export function CircuitScene(props: CircuitSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width, height } = useElementSize(containerRef);

  const propsRef = useRef(props);
  propsRef.current = props;
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  const { fixture } = props;

  // Rotate the closed outline so index 0 sits at start/finish (on a straight):
  // corner slices for curbs/gravel then never wrap the array boundary. Priming
  // the path model here (before the segments memo below) enables the
  // Gerlach/Hugenholtz data-gap repair, which needs the road shape.
  const outline = useMemo(() => {
    const rotated = rotateOutline(fixture.trackOutline, fixture.startFinish);
    primePathModel(fixture.lap.samples, rotated);
    return rotated;
  }, [fixture]);
  const cornerIndices = useMemo(() => fixture.corners.map((c) => nearestIndex(outline, c)), [fixture, outline]);
  // Corners the game visits get prominent badges; the rest render minor.
  const roundCornerNumbers = useMemo(() => new Set(fixture.rounds.flatMap((r) => r.cornerNumbers)), [fixture]);

  // Pre-split the whole lap into phase segments once; per round we clip by t.
  const roundSegments = useMemo(
    () =>
      fixture.rounds.map((round) =>
        buildPhaseSegments(fixture.lap.samples, round.tStart, round.tEnd).filter(
          (segment) => segment.points.length >= 2,
        ),
      ),
    [fixture],
  );

  useEffect(() => {
    let raf = 0;

    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      const { width: w, height: h } = sizeRef.current;
      const canvas = canvasRef.current;
      if (!canvas || w === 0 || h === 0) return;
      const ctx = prepareCanvas(canvas, w, h);
      if (!ctx) return;

      const { camBox, phase, round, roundIndex, elapsedT, marks, showReference } = propsRef.current;
      const projection = fitProjection(viewBoxFromCam(camBox), w, h);
      const samples = fixture.lap.samples;

      // --- environment ---
      drawSandBackground(ctx, projection, w, h);
      drawSea(ctx, projection, h);
      drawGreenSurroundings(ctx, outline, projection);
      drawPaddock(ctx, outline, 0, projection);
      drawLakes(ctx, projection);
      for (let i = 0; i < fixture.corners.length; i++) {
        const trap = GRAVEL_TRAPS[fixture.corners[i].number];
        if (trap) drawGravelTrap(ctx, outline, cornerIndices[i], projection, trap);
      }
      drawTrackRibbon(ctx, outline, projection);
      for (let i = 0; i < cornerIndices.length; i++) {
        drawCornerCurbs(ctx, outline, cornerIndices[i], projection, CURB_TUNING[fixture.corners[i].number]);
      }
      drawStartFinish(ctx, fixture.startFinish.x, fixture.startFinish.y, fixture.startFinish.headingDeg, projection);

      // --- practice coaching: pulsing markers where Max brakes and gets
      // back on the gas, so first-time players see what to do without
      // reading anything ---
      if (round.practice && (phase === 'ready' || phase === 'running')) {
        for (const event of round.events) {
          const s = sampleAt(samples, event.t);
          const [x, y] = projection.toScreen(s.x, s.y);
          const isBrake = event.type === 'brake';
          const color = isBrake ? '#e61f15' : '#0b7a43';
          const pulse = (now % 1400) / 1400;
          ctx.save();
          ctx.globalAlpha = 1 - pulse;
          ctx.beginPath();
          ctx.arc(x, y, 8 + pulse * 16, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
          drawPin(ctx, x, y, color, isBrake ? 'Rem hier!' : 'Gas hier!', !isBrake);
        }
      }

      // --- run/result overlays ---
      if (phase === 'running' && elapsedT > round.tStart) {
        drawRibbon(ctx, smoothPathPoints(samples, round.tStart, elapsedT), 'rgba(230, 31, 21, 0.85)', projection);
      }

      if (showReference) {
        for (const segment of roundSegments[roundIndex]) {
          drawRibbon(ctx, segment.points, PHASE_COLOR[segment.phase], projection);
        }
        // Pins are placed via the path model (not raw samples) so they sit on
        // the drawn line, also inside the repaired Gerlach/Hugenholtz stretch.
        for (const event of round.events) {
          const p = positionAt(samples, event.t);
          const [x, y] = projection.toScreen(p.x, p.y);
          drawPin(ctx, x, y, '#0b7a43', event.type === 'brake' ? 'Max rem' : 'Max gas');
        }
        for (const mark of marks) {
          const p = positionAt(samples, mark.t);
          const [x, y] = projection.toScreen(p.x, p.y);
          drawPin(ctx, x, y, '#1a2c8f', mark.type === 'brake' ? 'Jij rem' : 'Jij gas', true);
        }
      }

      // --- car ---
      // Parked on the grid during the intro, waiting at the window start while
      // the camera flies in / the round is armed, driving while running, and
      // resting at the window end on the result.
      let carT = round.tStart;
      if (phase === 'intro') carT = fixture.meta.lapStartT;
      else if (phase === 'running') carT = elapsedT;
      else if (phase === 'roundResult' || phase === 'finished') carT = round.tEnd;
      const carState = sampleAt(samples, carT);
      const carPos = positionAt(samples, carT);
      const minScale = CAR_MIN_LENGTH_PX / (CAR_ART_LENGTH_UNITS * projection.scale);
      drawF1Car(ctx, {
        x: carPos.x,
        y: carPos.y,
        headingDeg: headingAt(samples, carT),
        sizeScale: Math.max(CAR_SCALE, minScale),
        projection,
        dynamics: phase === 'running' ? { speedKph: carState.speedKph } : undefined,
      });

      // --- map chrome: corner badges + labels, fading out as we zoom in ---
      const compact = w < 520;
      // Fade on world zoom (camera box width in meters), not pixel scale:
      // the full-viewport stage renders the overview at a much larger pixel
      // scale than a phone does, and a scale threshold made badges vanish on
      // big screens. Fully visible at the ~1200m overview, gone below ~700m.
      const badgeAlpha = Math.max(0, Math.min(1, (camBox.w - 700) / 300));
      if (badgeAlpha > 0) {
        // Every corner of the upcoming round pulses, so a double (Gerlach &
        // Hugenholtz, Bocht 9 & 10) announces both its corners at once.
        const nextRound = fixture.rounds[roundIndex];
        const pulseCornerNumbers = new Set(phase === 'intro' || phase === 'flying' ? nextRound.cornerNumbers : []);
        fixture.corners.forEach((corner) => {
          const [x, y] = projection.toScreen(corner.x, corner.y);
          const isPulse = pulseCornerNumbers.has(corner.number);
          drawCornerBadge(ctx, x, y, String(corner.number), {
            highlight: isPulse,
            minor: !roundCornerNumbers.has(corner.number),
            alpha: badgeAlpha,
            compact,
          });
          if (isPulse) {
            const pulse = (now % 1600) / 1600;
            ctx.save();
            ctx.globalAlpha = badgeAlpha * (1 - pulse);
            ctx.beginPath();
            ctx.arc(x, y, 13 + pulse * 22, 0, Math.PI * 2);
            ctx.strokeStyle = '#e61f15';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();
          }
        });
        // name labels for the four game corners
        fixture.rounds.forEach((r) => {
          const corner = lastRoundCorner(fixture, r);
          if (!corner) return;
          const [x, y] = projection.toScreen(corner.x, corner.y);
          const offset = LABEL_OFFSETS[r.id] ?? { dx: 0, dy: 28 };
          drawMapLabel(ctx, x + offset.dx, y + offset.dy, r.label, badgeAlpha, compact ? 11 : 13);
        });
      }

      drawDirectionArrow(
        ctx,
        fixture.startFinish.x,
        fixture.startFinish.y,
        fixture.startFinish.headingDeg,
        projection,
        badgeAlpha,
      );

      drawScaleBar(ctx, projection, h);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [fixture, outline, cornerIndices, roundSegments, roundCornerNumbers]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="sr-only">
        Kaart van Circuit Zandvoort met de raceauto van Max Verstappen, ingezoomd op de actieve bocht
      </div>
    </div>
  );
}
