import type { ViewBox } from './geometry';

export interface ScreenProjection {
  scale: number;
  toScreen(x: number, y: number): [number, number];
  toData(px: number, py: number): [number, number];
}

// Fits a data-space bounding box into a canvas area, preserving aspect ratio
// (like `object-fit: contain`), centered. `scale` converts real meters to
// screen pixels - use it for anything with a physical size (track width,
// grandstands); keep UI chrome (badges, labels) in fixed screen pixels.
export function fitProjection(bbox: ViewBox, canvasWidth: number, canvasHeight: number): ScreenProjection {
  const scale = Math.min(canvasWidth / bbox.width, canvasHeight / bbox.height);
  const offsetX = (canvasWidth - bbox.width * scale) / 2;
  const offsetY = (canvasHeight - bbox.height * scale) / 2;
  return {
    scale,
    toScreen: (x, y) => [offsetX + (x - bbox.minX) * scale, offsetY + (y - bbox.minY) * scale],
    toData: (px, py) => [bbox.minX + (px - offsetX) / scale, bbox.minY + (py - offsetY) / scale],
  };
}

const MAX_DEVICE_PIXEL_RATIO = 2; // caps backing-store size on high-DPI phones

// Sizes a canvas's backing store for crisp rendering at the container's CSS
// size, and resets the context transform to CSS-pixel coordinates so drawing
// code never has to think about devicePixelRatio.
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
  const targetWidth = Math.max(1, Math.round(cssWidth * dpr));
  const targetHeight = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  return ctx;
}
