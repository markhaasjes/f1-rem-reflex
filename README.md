# NOS Rem Reflex

Proof of concept for a browser reflex game built on real Formula 1 telemetry
from [OpenF1](https://openf1.org). Pick any of Circuit Zandvoort's 14 corners
on the circuit map, zoom in, pick a driver, and watch their real onboard data
play back through that corner. Hit **REM!** at the moment you think the real
driver braked (or lifted, for corners taken almost flat-out): the result
screen compares your point to the real one, in meters and km/h.

This is a POC for a nos.nl feature around the Dutch Grand Prix, not
production code.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 (`@tailwindcss/vite`)
- Canvas 2D rendering (with `d3-shape` for path generation) instead of SVG:
  one draw pass per frame, devicePixelRatio capped at 2, so the animated
  corner view stays smooth on phones.
- No backend: telemetry is baked into static JSON fixtures at build time, so
  the running app never talks to OpenF1 directly. Per-driver telemetry is
  code-split and lazy-loaded on selection (~22 KB gzip per driver); the
  initial bundle stays under 90 KB gzip.
- The rendered track shape (overview and corners) is the official circuit
  centerline from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits)
  GeoJSON, with our OpenF1 telemetry fitted onto it (see below).

## Run it

```bash
npm install
npm run dev
```

## How the data works

`scripts/fetch-circuit-data.mjs` is a one-off data-prep script (not part of
the app bundle). It:

1. Pulls `car_data` and `location` from OpenF1 for one full qualifying lap
   (2025 Dutch GP) for each of four drivers: Verstappen, Hamilton, Antonelli,
   Norris. Location is in decimeters in the raw feed, divided by 10 to get
   meters.
2. Resamples every driver's lap onto a uniform 20 Hz grid.
3. Fetches the official track centerline (GeoJSON, `scripts/lib/geojson.mjs`),
   smooths it with a Catmull-Rom spline, and solves for the similarity
   transform (rotation + uniform scale + translation, via circular-offset
   search plus complex-number orthogonal Procrustes) that best fits one clean
   telemetry lap onto it (~10 m average residual). All driver telemetry is
   mapped into that frame, so cars drive on exactly the geometry that is
   rendered.
4. Uses Verstappen's pole lap as the **reference lap**: detects the 14 corners
   along it (a mix of real local speed-minima/heading-change detection and a
   few hand-tuned reference offsets for corners taken close to flat-out, see
   the comment above `CORNER_DEFINITIONS` in the script). The circuit outline
   and a per-corner `roadPath` slice of it go into `src/data/circuit.json`,
   so the zoomed-in corner view draws the same curve as the overview map.
5. For every driver and every one of the 14 corners, finds that driver's own
   closest point to the reference corner position, then slices out a
   corner-sized window (capped by distance so tightly-packed corners don't
   overlap) and detects the real ground-truth point in it: the first brake
   transition, or if the corner is taken flat-out, the first throttle lift, or
   if neither happens, marks the corner `actionType: 'none'`.
6. Writes one file per driver (`src/data/drivers/{VER,HAM,ANT,NOR}.json`),
   each containing all 14 corners.

Re-run it (after editing the driver/lap constants at the top) to regenerate
for a different session or set of drivers:

```bash
node scripts/fetch-circuit-data.mjs
```

Because OpenF1's free tier only serves **historical** data (real-time data
requires a paid subscription), this script must run after a session ends,
it can't drive a truly live in-race version of the game. The 2026 Zandvoort
weekend data can be swapped in the same way once each session finishes.

## Structure

```
scripts/fetch-circuit-data.mjs   data-prep script (network access, run manually)
scripts/lib/geojson.mjs          official-geometry fetch, spline smoothing, Procrustes fit
src/data/circuit.json            official track outline + the 14 named corners (with roadPath slices)
src/data/drivers/*.json          per-driver, per-corner telemetry (lazy-loaded chunks)
src/lib/canvas.ts                projection math + devicePixelRatio-aware canvas setup
src/lib/canvasTrack.ts           road/curb/grass/kerb/grandstand/startline drawing
src/lib/canvasCar.ts             canvas version of the stylized top-down car
src/lib/corner.ts                sampling/interpolation over a corner fixture
src/lib/geometry.ts              shared bounding-box math
src/lib/scoring.ts               Dutch-language result messaging
src/lib/teamLivery.ts            hand-picked team color palettes (no official logos)
src/hooks/useBrakeGame.ts        per-corner game state machine (ready/running/result)
src/hooks/useElementSize.ts      ResizeObserver hook driving canvas re-renders
src/components/CircuitView.tsx   full map + zoom, plus the mobile corner-name legend
src/components/CircuitMap.tsx    canvas overview map + accessible corner hit-targets
src/components/DriverSelect.tsx  pick VER/HAM/ANT/NOR for the chosen corner
src/components/CornerTrack.tsx   canvas corner view: grass run-off, curbs, car, pins
src/components/F1Car.tsx         SVG car (still used in the driver picker cards)
src/components/GameFlow.tsx      Start/Game/Result wiring for one corner+driver
src/components/FlatOutScreen.tsx shown instead of GameFlow when actionType is 'none'
```

## Known limitations (POC scope)

- Corner boundaries for the twisty middle sector (roughly corners 4-10) are
  partly interpolated rather than fully auto-detected, since several of those
  corners are taken close to flat-out and don't leave a clear brake/speed
  signature to detect automatically. See the comment in
  `scripts/fetch-circuit-data.mjs`.
- No leaderboard/persistence.
- Car illustrations are hand-built stylized SVGs with team-evocative color
  palettes, not official liveries or logos.
- Grandstand markers on the circuit map are curated, not from a real
  seating-plan data source (none is publicly available for a GPS-derived
  track shape) - positions loosely follow Circuit Zandvoort's public ticketing
  map (Tarzan-in, Main Grandstand, Arena, Eastside, etc.), anchored to our own
  detected corners. Cross-checked our overall track shape/length against the
  official circuit geometry in [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits)
  (the data source behind racingcircuitmap.com) - it lines up closely, but
  that dataset only has the track centerline, not grandstand positions.
