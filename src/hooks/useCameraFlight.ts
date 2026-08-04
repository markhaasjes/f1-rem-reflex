import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bounds } from '../types';
import type { ViewBox } from '../lib/geometry';

/** Camera box in world meters: center + size. Interpolates better than min/max. */
export interface CamBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export function boxFromBounds(bounds: Bounds, padM: number): CamBox {
  return {
    cx: (bounds.minX + bounds.maxX) / 2,
    cy: (bounds.minY + bounds.maxY) / 2,
    w: bounds.maxX - bounds.minX + padM * 2,
    h: bounds.maxY - bounds.minY + padM * 2,
  };
}

export function viewBoxFromCam(box: CamBox): ViewBox {
  return { minX: box.cx - box.w / 2, minY: box.cy - box.h / 2, width: box.w, height: box.h };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

// Center moves linearly, size moves in log space: a constant-feeling zoom rate
// whether flying 300m -> 4km (zoom out) or the reverse, which is what makes
// the overview <-> corner flights read as one smooth camera move.
function lerpBox(a: CamBox, b: CamBox, t: number): CamBox {
  return {
    cx: a.cx + (b.cx - a.cx) * t,
    cy: a.cy + (b.cy - a.cy) * t,
    w: Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w)) * t),
    h: Math.exp(Math.log(a.h) + (Math.log(b.h) - Math.log(a.h)) * t),
  };
}

export interface FlightStep {
  /** Target box; omit for a hold (pause) step. */
  box?: CamBox;
  ms: number;
}

// Animates a camera box through a queue of flight steps (fly / hold), driven
// by requestAnimationFrame. `fly` replaces any flight in progress.
export function useCameraFlight(initial: CamBox) {
  const [box, setBox] = useState<CamBox>(initial);
  const [flying, setFlying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const boxRef = useRef(initial);
  boxRef.current = box;

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const fly = useCallback(
    (steps: FlightStep[], onDone?: () => void) => {
      stop();
      setFlying(true);

      let stepIndex = 0;
      let stepStart = performance.now();
      let from = boxRef.current;

      const tick = (now: number) => {
        const step = steps[stepIndex];
        const t = Math.min((now - stepStart) / step.ms, 1);
        if (step.box) setBox(lerpBox(from, step.box, easeInOutCubic(t)));

        if (t >= 1) {
          if (step.box) from = step.box;
          stepIndex++;
          stepStart = now;
          if (stepIndex >= steps.length) {
            rafRef.current = null;
            setFlying(false);
            onDone?.();
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [stop],
  );

  const jumpTo = useCallback(
    (target: CamBox) => {
      stop();
      setFlying(false);
      setBox(target);
    },
    [stop],
  );

  return { box, flying, fly, jumpTo };
}
