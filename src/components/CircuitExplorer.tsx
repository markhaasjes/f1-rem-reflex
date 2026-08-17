import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useElementSize } from '../hooks/useElementSize';
import { viewBoxFromCam, type CamBox } from '../hooks/useCameraFlight';
import { fitProjection } from '../lib/canvas';
import { CircuitScene, type ResultLine } from './CircuitScene';
import { CompressIcon, LineModeToggle, MapControlButton, MinusIcon, PlusIcon, WholeCircuitIcon } from './MapControls';
import { MapLegend, activeLineLabel } from './MapLegend';
import type { Bounds, LineMode, ZandvoortFixture } from '../types';

// The results map at full size: every corner driven so far on one track, free
// to pan and zoom with a finger, a mouse, the keyboard or the on-screen
// buttons. It is deliberately a full-viewport overlay rather than the
// Fullscreen API - iOS Safari does not give an element true fullscreen on
// iPhone, and an overlay behaves the same everywhere.

const MIN_BOX_M = 120; // closest zoom: about one corner
const MAX_BOX_M = 6000; // furthest: the circuit with room around it
const ZOOM_STEP = 1.35; // per button press / keyboard press
const WHEEL_SENSITIVITY = 0.0015;
const KEY_PAN_FRACTION = 0.18; // of the visible width, per arrow press

function clampBox(box: CamBox, limits: Bounds): CamBox {
  const w = Math.min(MAX_BOX_M, Math.max(MIN_BOX_M, box.w));
  const h = Math.min(MAX_BOX_M, Math.max(MIN_BOX_M, box.h));
  // Keep the centre inside the circuit's own bounds so the map can never be
  // panned off into empty sand.
  return {
    w,
    h,
    cx: Math.min(limits.maxX, Math.max(limits.minX, box.cx)),
    cy: Math.min(limits.maxY, Math.max(limits.minY, box.cy)),
  };
}

interface CircuitExplorerProps {
  fixture: ZandvoortFixture;
  resultLines: ResultLine[];
  lineMode: LineMode;
  onLineModeChange: (mode: LineMode) => void;
  /** Where to start: the corner just driven, or the whole circuit. */
  initialBox: CamBox;
  /** The box the reset button returns to (the whole circuit). */
  overviewBox: CamBox;
  onClose: () => void;
  title: string;
}

export function CircuitExplorer({
  fixture,
  resultLines,
  lineMode,
  onLineModeChange,
  initialBox,
  overviewBox,
  onClose,
  title,
}: CircuitExplorerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { width, height } = useElementSize(stageRef);
  const [box, setBox] = useState<CamBox>(initialBox);

  const limits = useMemo<Bounds>(() => {
    const xs = fixture.trackOutline.map((p) => p.x);
    const ys = fixture.trackOutline.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }, [fixture]);

  const update = useCallback((next: (current: CamBox) => CamBox) => setBox((c) => clampBox(next(c), limits)), [limits]);

  /** Zoom by `factor`, keeping the world point under (px, py) where it is.
   * Without the anchor, pinching and wheeling both drift the map away from
   * whatever the user is actually looking at. */
  const zoomAt = useCallback(
    (factor: number, px?: number, py?: number) =>
      update((current) => {
        const zoomed = { ...current, w: current.w * factor, h: current.h * factor };
        const clamped = clampBox(zoomed, limits);
        if (px === undefined || py === undefined || width === 0 || height === 0) return clamped;
        const before = fitProjection(viewBoxFromCam(current), width, height).toData(px, py);
        const after = fitProjection(viewBoxFromCam(clamped), width, height).toData(px, py);
        return { ...clamped, cx: clamped.cx + (before[0] - after[0]), cy: clamped.cy + (before[1] - after[1]) };
      }),
    [update, limits, width, height],
  );

  const panByPixels = useCallback(
    (dxPx: number, dyPx: number) =>
      update((current) => {
        if (width === 0 || height === 0) return current;
        const { scale } = fitProjection(viewBoxFromCam(current), width, height);
        return { ...current, cx: current.cx - dxPx / scale, cy: current.cy - dyPx / scale };
      }),
    [update, width, height],
  );

  // Pointers are tracked by id so one finger pans and two pinch, with the mouse
  // falling out of the same code path (a single pointer dragging).
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; midX: number; midY: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent) => {
    // Capture keeps a drag alive when the finger leaves the stage, but it
    // throws if the pointer is not active (a synthetic event, or one already
    // released) - and a failed capture must not abort the drag.
    try {
      (event.target as Element).setPointerCapture?.(event.pointerId);
    } catch {
      /* dragging still works without capture */
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinchRef.current = null;
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId)!;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const stage = stageRef.current?.getBoundingClientRect();
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const pinch = pinchRef.current;
      if (pinch && pinch.distance > 0 && distance > 0 && stage) {
        zoomAt(pinch.distance / distance, midX - stage.left, midY - stage.top);
        panByPixels(midX - pinch.midX, midY - pinch.midY);
      }
      pinchRef.current = { distance, midX, midY };
      return;
    }
    panByPixels(event.clientX - previous.x, event.clientY - previous.y);
  };

  const endPointer = (event: React.PointerEvent) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
  };

  // Wheel zoom has to be non-passive to be preventable, so it is bound by hand
  // rather than through onWheel (React attaches wheel listeners passively).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomAt(Math.exp(event.deltaY * WHEEL_SENSITIVITY), event.clientX - rect.left, event.clientY - rect.top);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const panStep = () => box.w * KEY_PAN_FRACTION;
      const actions: Record<string, () => void> = {
        Escape: onClose,
        ArrowLeft: () => update((c) => ({ ...c, cx: c.cx - panStep() })),
        ArrowRight: () => update((c) => ({ ...c, cx: c.cx + panStep() })),
        ArrowUp: () => update((c) => ({ ...c, cy: c.cy - panStep() })),
        ArrowDown: () => update((c) => ({ ...c, cy: c.cy + panStep() })),
        Equal: () => zoomAt(1 / ZOOM_STEP),
        NumpadAdd: () => zoomAt(1 / ZOOM_STEP),
        Minus: () => zoomAt(ZOOM_STEP),
        NumpadSubtract: () => zoomAt(ZOOM_STEP),
        Digit0: () => setBox(overviewBox),
        KeyM: () => onLineModeChange('max'),
        KeyJ: () => onLineModeChange('player'),
      };
      const action = actions[event.code];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [box.w, update, zoomAt, onClose, overviewBox, onLineModeChange]);

  useEffect(() => {
    const id = setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 80);
    return () => clearTimeout(id);
  }, []);

  const lastRound = resultLines.at(-1)?.round ?? fixture.rounds[0];

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-carbon">
      {/* The stage starts below the NOS badge (which stays on top at z-[60])
          so the brand is never covered by the map. */}
      <div ref={stageRef} className="relative min-h-0 flex-1 touch-none overscroll-none">
        <div
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        >
          <CircuitScene
            fixture={fixture}
            camBox={box}
            phase="finished"
            round={lastRound}
            roundIndex={Math.max(0, fixture.rounds.indexOf(lastRound))}
            elapsedT={lastRound.tEnd}
            transitions={[]}
            heldInput="coast"
            resultLines={resultLines}
            lineMode={lineMode}
            showScoreBadges
            showScaleBar
          />
        </div>

        {/* One chrome for both maps (see MAP_CHROME in App.tsx): controls stack
            up from the bottom-right corner with the legend under them, the
            explanatory text sits top-left under the NOS badge, and the canvas
            keeps the bottom-left for its scale bar. Every button the game stage
            also has (the line toggle, the full-screen button) is in exactly the
            place it is there. */}
        <div className="pointer-events-none absolute inset-0">
          {/* Top-right, opposite the NOS badge: it is the one thing here that
              is read rather than operated, so it stays clear of the badge on
              the left and of the control column below it. */}
          <p className="absolute right-3 top-3 max-w-[16rem] rounded-lg bg-ink/75 px-2 py-1 text-right text-sm text-white sm:right-4 sm:top-4 sm:max-w-[30rem] sm:text-base">
            <span className="sm:hidden">Sleep om te bewegen, knijp om te zoomen.</span>
            <span className="hidden sm:inline">
              Sleep om te bewegen, scroll of <kbd className="rounded bg-white/15 px-1.5">+</kbd>
              <kbd className="ml-1 rounded bg-white/15 px-1.5">&minus;</kbd> om te zoomen, pijltjes om te pannen,{' '}
              <kbd className="rounded bg-white/15 px-1.5">0</kbd> voor het hele circuit.
            </span>
          </p>

          {/* On a landscape phone the five buttons plus the legend do not fit
              in one column, so the legend steps beside them (same corner, one
              row) exactly like it does on the game stage. */}
          <div className="absolute bottom-2 right-2 flex flex-col items-end gap-2 sm:bottom-3 sm:right-3 short:flex-row-reverse">
            <div className="pointer-events-auto flex flex-col items-end gap-2">
              <LineModeToggle mode={lineMode} onChange={onLineModeChange} />
              <MapControlButton label="Inzoomen" onClick={() => zoomAt(1 / ZOOM_STEP)}>
                <PlusIcon />
              </MapControlButton>
              <MapControlButton label="Uitzoomen" onClick={() => zoomAt(ZOOM_STEP)}>
                <MinusIcon />
              </MapControlButton>
              <MapControlButton label="Hele circuit tonen" onClick={() => setBox(overviewBox)}>
                <WholeCircuitIcon />
              </MapControlButton>
              {/* Same slot, same size as the button that opened this view, so
                  full screen is one button that toggles rather than two that
                  have to be found separately. */}
              <MapControlButton label="Volledig scherm sluiten" onClick={onClose} buttonRef={closeRef}>
                <CompressIcon />
              </MapControlButton>
            </div>
            <MapLegend activeLine={activeLineLabel(true, lineMode, false)} />
          </div>
        </div>
      </div>
    </div>
  );
}
