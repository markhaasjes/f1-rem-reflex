# NOS Rem Reflex

Proof of concept for a browser reflex game built on real Formula 1 telemetry
from [OpenF1](https://openf1.org). You watch Max Verstappen's real pole lap
approach the Tarzanbocht at Circuit Zandvoort and hit **REM!** at the moment
you think he braked. The result screen compares your brake point to the real
one, in meters and km/u, on top of his actual coast/brake/throttle phases.

This is a POC for a nos.nl feature around the Dutch Grand Prix, not
production code.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 (`@tailwindcss/vite`), Effra with Helvetica fallback
- Canvas 2D for the corner scene (devicePixelRatio capped at 2), inline SVG
  for the intro circuit map and the hero car illustration
- No backend and no runtime network calls: one baked telemetry fixture
  (`src/data/tarzanbocht.json`, ~60 KB) drives everything. Total bundle is
  ~75 KB gzip.

## Run it

```bash
npm install
npm run dev
```

## How it works

The whole app is one screen with three phases (intro, running, result). All
phase layers stay mounted in fixed-height regions and crossfade, so the
layout never jumps. The corner scene is an illustrated flat-style rendering
of the real geometry: sand dunes (it is Zandvoort), a striped grass infield,
a gravel trap on the outside of the hairpin, gray/white checkered track
edging and red/white curbs at the apex and exit.

During the run the car is driven by Verstappen's real 20 Hz telemetry
(position, speed, brake, throttle) from his fastest lap in 2025 Dutch GP
qualifying (lap 17, pole). The result screen colors his driven line by what
he was actually doing: throttle lift (Gas los), braking (Remmen), back to
full throttle (Vol gas).

## Data provenance

`src/data/tarzanbocht.json` is a frozen extract of a larger dataset built on
an earlier branch: OpenF1 `car_data` + `location` for four drivers' fastest
2025 qualifying laps, resampled to 20 Hz, aligned onto the official circuit
geometry, and sliced per corner. The full pipeline (fetch scripts, corner
detection, geometry fitting) lives in git history up to commit `9141182`;
this branch keeps only the single corner/driver the game needs.

Because OpenF1's free tier only serves historical data (real-time requires a
paid subscription), a fixture like this can only be produced after a session
ends. Fresh 2026 Zandvoort data can be swapped in the same way once each
session finishes.

## Structure

```
src/data/tarzanbocht.json        the one fixture: samples, brake/apex points, road path, circuit map
src/lib/canvas.ts                projection math + devicePixelRatio-aware canvas setup
src/lib/scene.ts                 illustrated scene drawing: sand, grass, gravel, track, curbs, ribbons
src/lib/canvasCar.ts             top-down car for the scene, in team-evocative colors
src/lib/corner.ts                sampling/interpolation over the fixture
src/lib/phases.ts                coast/brake/accel segmentation of the driven line
src/lib/scoring.ts               Dutch-language verdicts by brake-point delta
src/lib/teamLivery.ts            hand-picked livery palette (no official marks)
src/hooks/useBrakeGame.ts        game state machine (ready/running/result)
src/hooks/useElementSize.ts      ResizeObserver hook driving canvas re-renders
src/components/CornerScene.tsx   the canvas stage for all three phases
src/components/CircuitMiniMap.tsx schematic circuit map with the pulsing corner badge
src/components/HeroCar.tsx       flat side-view car illustration for the intro
src/components/Brand.tsx         shared pill/badge chrome
src/App.tsx                      layout shell, phase transitions, copy
```

## Known limitations (POC scope)

- One corner, one driver, by design.
- No leaderboard/persistence.
- Scenery (dunes, gravel shape, grass) is illustrative, not surveyed; the
  track line itself is real geometry.
- Car illustrations are hand-built with team-evocative colors, not official
  liveries or logos.
