export interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export function computeViewBox(points: { x: number; y: number }[], paddingM: number): ViewBox {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - paddingM;
  const minY = Math.min(...ys) - paddingM;
  const width = Math.max(...xs) - Math.min(...xs) + paddingM * 2;
  const height = Math.max(...ys) - Math.min(...ys) + paddingM * 2;
  return { minX, minY, width, height };
}
