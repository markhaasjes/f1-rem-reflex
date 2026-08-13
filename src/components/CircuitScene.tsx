import { useEffect, useMemo, useRef } from 'react';
import { useElementSize } from '../hooks/useElementSize';
import { viewBoxFromCam, type CamBox } from '../hooks/useCameraFlight';
import { fitProjection, prepareCanvas, type ScreenProjection } from '../lib/canvas';
import { CAR_ART_LENGTH_UNITS, drawF1Car } from '../lib/canvasCar';
import { headingAt, positionAt, primePathModel, sampleAt } from '../lib/corner';
import { buildPhaseSegments } from '../lib/phases';
import { buildInputSegments } from '../lib/playerInput';
import {
  PHASE_COLOR,
  drawCornerBadge,
  drawCornerCurbs,
  drawGravelTrap,
  drawGreenSurroundings,
  drawMapLabel,
  drawPaddock,
  drawRibbon,
  drawDirectionArrow,
  drawSandBackground,
  drawSea,
  drawLakes,
  drawScaleBar,
  drawStartFinish,
  drawTrackRibbon,
  nearestIndex,
  offsetPathPoints,
  rotateOutline,
} from '../lib/scene';
import type { GamePhase, GameRound, InputTransition, PedalInput, ZandvoortFixture } from '../types';

interface CircuitSceneProps {
  fixture: ZandvoortFixture;
  camBox: CamBox;
  phase: GamePhase;
  round: GameRound;
  roundIndex: number;
  elapsedT: number;
  /** The player's recorded pedal timeline for the current round. */
  transitions: InputTransition[];
  /** The combined pedal state held right now (colors the live car glow). */
  heldInput: PedalInput;
  /** Reveal the Max-vs-player comparison ribbons (round result). */
  showReference: boolean;
  /** Draw the scale bar. False while the HTML legend/speed badge own that
   * corner, so the two can never overlap on a narrow stage. */
  showScaleBar: boolean;
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

// Max's reference line runs one road-half beside the driven line, thinner and
// dashed: the dash pattern is what separates his line from the player's solid
// one at a glance, without needing labels on the map.
const MAX_LINE_OFFSET_M = 4.6;
const MAX_LINE_WIDTH_M = 2.2;
const MAX_LINE_DASH_M: [number, number] = [5, 3.5];

// The glow disc under the car while driving, colored by the held pedal.
const GLOW_RADIUS_M = 9;
const GLOW_MIN_RADIUS_PX = 16;
const GLOW_COLOR: Record<'gas' | 'brake', string> = {
  gas: 'rgba(18, 163, 127, 0.35)',
  brake: 'rgba(230, 31, 21, 0.4)',
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

  // Max's reference line per round: his phase-colored line shifted one
  // road-half aside, so it runs beside the player's line instead of under it.
  // Offsetting is geometry work, so it happens once here, not per frame.
  const maxReferenceSegments = useMemo(
    () =>
      fixture.rounds.map((round) =>
        buildPhaseSegments(fixture.lap.samples, round.tStart, round.tEnd)
          .map((segment) => ({ phase: segment.phase, points: offsetPathPoints(segment.points, MAX_LINE_OFFSET_M) }))
          .filter((segment) => segment.points.length >= 2),
      ),
    [fixture],
  );

  // Redraws happen lazily: the rAF loop keeps running (cheap), but the scene
  // - sand field, corridor, track, curbs, everything - is only rasterized
  // when something visible changed. Painting unconditionally at 60fps kept
  // the main thread >50% busy on completely idle screens (intro, ready,
  // result), which users noticed as a hot browser. The snapshot covers every
  // input the drawing reads; 'running' and 'flying' are time-animated (the
  // clock / the badge pulse) and always paint. Fonts load async, so the
  // loaded-flag is part of the snapshot - otherwise an early static frame
  // would keep fallback-font labels until the next change.
  const fontsLoadedRef = useRef(false);
  useEffect(() => {
    document.fonts?.ready.then(() => {
      fontsLoadedRef.current = true;
    });
  }, []);
  const lastSnapshotRef = useRef('');

  useEffect(() => {
    let raf = 0;

    const drawMaxReference = (ctx: CanvasRenderingContext2D, projection: ScreenProjection, roundIndex: number) => {
      for (const segment of maxReferenceSegments[roundIndex]) {
        drawRibbon(ctx, segment.points, PHASE_COLOR[segment.phase], projection, MAX_LINE_WIDTH_M, MAX_LINE_DASH_M);
      }
    };

    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      const { width: w, height: h } = sizeRef.current;
      const canvas = canvasRef.current;
      if (!canvas || w === 0 || h === 0) return;

      const { camBox, phase, round, roundIndex, elapsedT, transitions, heldInput, showReference, showScaleBar } =
        propsRef.current;
      const timeAnimated = phase === 'running' || phase === 'flying';
      const snapshot = [
        camBox.cx,
        camBox.cy,
        camBox.w,
        camBox.h,
        w,
        h,
        devicePixelRatio,
        phase,
        roundIndex,
        elapsedT,
        transitions.length,
        heldInput,
        showReference,
        showScaleBar,
        fontsLoadedRef.current,
      ].join('|');
      if (!timeAnimated && snapshot === lastSnapshotRef.current) return;
      lastSnapshotRef.current = snapshot;

      const ctx = prepareCanvas(canvas, w, h);
      if (!ctx) return;
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

      // --- practice coaching: Max's dashed reference line runs beside the
      // player's, so first-time players see what to match without reading
      // anything (the zone colors say where to brake and where to get back
      // on the gas - no point markers needed) ---
      if (round.practice && (phase === 'ready' || phase === 'running')) {
        drawMaxReference(ctx, projection, roundIndex);
      }

      // --- live trail: the driven line so far, colored by what the player's
      // pedals said at each moment (green = gas, amber = los, red = remmen) ---
      if (phase === 'running' && elapsedT > round.tStart) {
        for (const segment of buildInputSegments(samples, transitions, round.tStart, elapsedT)) {
          drawRibbon(ctx, segment.points, PHASE_COLOR[segment.phase], projection);
        }
      }

      // --- result comparison: Max's dashed line beside the player's solid
      // one (same pairing the practice round teaches with), so matching
      // stretches read as two same-colored lines running together and a
      // mismatch shows as two different colors side by side ---
      if (showReference) {
        drawMaxReference(ctx, projection, roundIndex);
        for (const segment of buildInputSegments(samples, transitions, round.tStart, round.tEnd)) {
          drawRibbon(ctx, segment.points, PHASE_COLOR[segment.phase], projection);
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
      // Immediate pedal feedback at the car itself: a colored glow under it
      // while the player is on the gas or the brake (nothing while coasting).
      if (phase === 'running' && heldInput !== 'coast') {
        const [glowX, glowY] = projection.toScreen(carPos.x, carPos.y);
        ctx.beginPath();
        ctx.arc(glowX, glowY, Math.max(GLOW_RADIUS_M * projection.scale, GLOW_MIN_RADIUS_PX), 0, Math.PI * 2);
        ctx.fillStyle = GLOW_COLOR[heldInput];
        ctx.fill();
      }
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
        // Every corner of the upcoming round pulses during the flight toward
        // it, so a double (Gerlach & Hugenholtz, Bocht 9 & 10) announces both
        // its corners at once. Only while flying: a pulse on the (modal-
        // covered) intro map would force the idle screen to repaint at 60fps,
        // defeating the lazy-redraw snapshot above.
        const nextRound = fixture.rounds[roundIndex];
        const pulseCornerNumbers = new Set(phase === 'flying' ? nextRound.cornerNumbers : []);
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
          drawMapLabel(ctx, x + offset.dx, y + offset.dy, r.label, badgeAlpha, compact ? 14 : 17);
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

      if (showScaleBar) drawScaleBar(ctx, projection, h);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [fixture, outline, cornerIndices, maxReferenceSegments, roundCornerNumbers]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="sr-only">
        Kaart van Circuit Zandvoort met de raceauto van Max Verstappen, ingezoomd op de actieve bocht
      </div>
    </div>
  );
}
