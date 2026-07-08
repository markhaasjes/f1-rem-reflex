import type { ScreenProjection } from './canvas';
import type { TeamLivery } from './teamLivery';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string,
  strokeWidth?: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth ?? 1;
    ctx.stroke();
  }
}

export interface CarDynamics {
  /** Current speed in km/h - drives the length/opacity of the motion streaks. */
  speedKph: number;
  /** Deceleration in km/h per second - drives brake-glow and tyre-smoke intensity. */
  decel: number;
  /** Whether the real telemetry has the brake pedal down at this instant. */
  braking: boolean;
}

export interface DrawCarOptions {
  x: number;
  y: number;
  headingDeg: number;
  livery: TeamLivery;
  sizeScale: number;
  projection: ScreenProjection;
  /** Optional speed/brake state; when supplied the car gets reactive dressing. */
  dynamics?: CarDynamics;
}

// Car-local centres of the four tyres, reused for the wheels and their glow.
const WHEEL_CENTERS = [
  { x: -8.75, y: -6.9 },
  { x: -8.75, y: 6.9 },
  { x: 8.25, y: -6.9 },
  { x: 8.25, y: 6.9 },
] as const;

// Warm brake-disc glow behind a wheel, drawn additively in car-local space.
// Intensity is the real deceleration mapped to 0..1 so the discs flare exactly
// when Max is hard on the pedal and fade as he trails off towards the apex.
function brakeGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, intensity: number) {
  const r = 3 + intensity * 4;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gradient.addColorStop(0, `rgba(255, 246, 214, ${0.9 * intensity})`);
  gradient.addColorStop(0.4, `rgba(255, 150, 30, ${0.75 * intensity})`);
  gradient.addColorStop(1, 'rgba(255, 60, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// Speed streaks + tyre smoke, drawn under the car in car-local space (nose
// pointing along +x): streaks grow with speed, smoke kicks up under braking.
function drawTrail(ctx: CanvasRenderingContext2D, speedFactor: number, brakeFactor: number) {
  if (speedFactor > 0.04) {
    const streakLen = 10 + speedFactor * 46;
    ctx.lineCap = 'round';
    for (const [offset, alpha] of [
      [-6.5, 0.28],
      [0, 0.4],
      [6.5, 0.28],
    ] as const) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * speedFactor})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-19, offset);
      ctx.lineTo(-19 - streakLen, offset);
      ctx.stroke();
    }
  }

  if (brakeFactor > 0.12) {
    ctx.fillStyle = `rgba(210, 210, 205, ${0.22 * brakeFactor})`;
    for (const [i, wy] of [-7, 7].entries()) {
      for (let p = 0; p < 3; p++) {
        const puff = 2.4 + p * 1.8;
        ctx.beginPath();
        ctx.arc(-13 - p * 4 - i, wy + (i === 0 ? -1 : 1) * p, puff * brakeFactor + 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// Same stylized top-down car as F1Car.tsx (nose toward +x), reusing the exact
// SVG path data - Canvas's Path2D constructor accepts SVG path syntax directly.
export function drawF1Car(ctx: CanvasRenderingContext2D, opts: DrawCarOptions) {
  const { x, y, headingDeg, livery, sizeScale, projection, dynamics } = opts;
  const [px, py] = projection.toScreen(x, y);
  const pixelScale = sizeScale * projection.scale;

  const speedFactor = dynamics ? Math.min(1, Math.max(0, dynamics.speedKph / 330)) : 0;
  const brakeFactor = dynamics?.braking ? Math.min(1, Math.max(0, dynamics.decel / 220)) : 0;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((headingDeg * Math.PI) / 180);
  ctx.scale(pixelScale, pixelScale);

  if (dynamics) drawTrail(ctx, speedFactor, brakeFactor);

  // rear wing
  roundRect(ctx, -19, -7.5, 3.2, 2.6, 0.6, livery.accent);
  roundRect(ctx, -19, 4.9, 3.2, 2.6, 0.6, livery.accent);
  roundRect(ctx, -18.5, -6, 4, 12, 1, livery.body, livery.accent, 0.6);

  // rear wheels
  roundRect(ctx, -11.5, -9, 5.5, 4.2, 1.4, '#111');
  roundRect(ctx, -11.5, 4.8, 5.5, 4.2, 1.4, '#111');

  // sidepods + engine cover
  ctx.fillStyle = livery.body;
  ctx.fill(new Path2D('M -15 -6 C -9 -7.5 -2 -7.5 3 -4.5 L 3 4.5 C -2 7.5 -9 7.5 -15 6 Z'));
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = livery.accent;
  ctx.fill(new Path2D('M -13 -5.2 C -9 -6 -4 -5.6 -1 -3.6 L -1 3.6 C -4 5.6 -9 6 -13 5.2 Z'));
  ctx.globalAlpha = 1;

  // front wheels
  roundRect(ctx, 5.5, -9, 5.5, 4.2, 1.4, '#111');
  roundRect(ctx, 5.5, 4.8, 5.5, 4.2, 1.4, '#111');

  // nose + cockpit
  ctx.fillStyle = livery.body;
  ctx.fill(new Path2D('M 3 -4.5 C 8 -4 12 -2.4 18 -0.8 L 18 0.8 C 12 2.4 8 4 3 4.5 Z'));
  ctx.fillStyle = livery.cockpit;
  ctx.fill(new Path2D('M 3 -1.6 C 5.5 -1.4 7 -0.8 7 0 C 7 0.8 5.5 1.4 3 1.6 Z'));
  ctx.strokeStyle = livery.highlight;
  ctx.lineWidth = 0.7;
  ctx.stroke(new Path2D('M 4.4 -2.4 C 6.4 -2.1 6.4 2.1 4.4 2.4'));

  // front wing
  roundRect(ctx, 15.5, -9, 3, 2.6, 0.6, livery.accent);
  roundRect(ctx, 15.5, 6.4, 3, 2.6, 0.6, livery.accent);
  roundRect(ctx, 15, -5.5, 4, 11, 1, livery.body, livery.accent, 0.6);
  ctx.globalAlpha = 0.9;
  roundRect(ctx, 17.2, -4.5, 1.4, 9, 0, livery.highlight);
  ctx.globalAlpha = 1;

  // brake-disc glow flares over the tyres, blended additively so it reads as light
  if (brakeFactor > 0.05) {
    ctx.globalCompositeOperation = 'lighter';
    for (const wheel of WHEEL_CENTERS) brakeGlow(ctx, wheel.x, wheel.y, brakeFactor);
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}
