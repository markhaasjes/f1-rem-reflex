import type { ScreenProjection } from './canvas';

interface CarDynamics {
  /** Current speed in km/h - drives the length/opacity of the motion streaks. */
  speedKph: number;
}

export interface DrawCarOptions {
  x: number;
  y: number;
  headingDeg: number;
  sizeScale: number;
  projection: ScreenProjection;
  /** Optional speed state; when supplied the car gets motion streaks. */
  dynamics?: CarDynamics;
}

// The top-down artwork: public/images/auto-boven.svg (nose toward +x, livery
// colors baked into the file). Drawn scaled to this many car-local units long,
// the same footprint the previous path-drawn sprite used, so the size math in
// CircuitScene (CAR_SCALE, CAR_MIN_LENGTH_PX) keeps meaning what it did.
export const CAR_ART_LENGTH_UNITS = 37;
const CAR_IMAGE_URL = '/images/auto-boven.svg';
const CAR_IMAGE_ASPECT = 102.67 / 278; // viewBox height / width

let carImage: HTMLImageElement | null = null;
function getCarImage(): HTMLImageElement {
  if (!carImage) {
    carImage = new Image();
    carImage.src = CAR_IMAGE_URL;
  }
  return carImage;
}

// Motion streaks trailing behind the car in car-local space (nose along +x),
// growing with speed to give the run a sense of pace.
function drawTrail(ctx: CanvasRenderingContext2D, speedFactor: number) {
  if (speedFactor <= 0.04) return;
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

export function drawF1Car(ctx: CanvasRenderingContext2D, opts: DrawCarOptions) {
  const { x, y, headingDeg, sizeScale, projection, dynamics } = opts;
  const [px, py] = projection.toScreen(x, y);
  const pixelScale = sizeScale * projection.scale;

  const speedFactor = dynamics ? Math.min(1, Math.max(0, dynamics.speedKph / 330)) : 0;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((headingDeg * Math.PI) / 180);
  ctx.scale(pixelScale, pixelScale);

  if (dynamics) drawTrail(ctx, speedFactor);

  // The image decodes within a frame or two of first use (same-origin, ~6 KB);
  // until then the car simply skips a frame instead of drawing a placeholder.
  const image = getCarImage();
  if (image.complete && image.naturalWidth > 0) {
    const drawWidth = CAR_ART_LENGTH_UNITS;
    const drawHeight = drawWidth * CAR_IMAGE_ASPECT;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  }

  ctx.restore();
}
