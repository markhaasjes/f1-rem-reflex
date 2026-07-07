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
- No backend: telemetry is baked into static JSON fixtures at build time, so
  the running app never talks to OpenF1 directly.

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
3. Uses Verstappen's pole lap as the **reference lap**: detects the 14 corners
   along it (a mix of real local speed-minima/heading-change detection and a
   few hand-tuned reference offsets for corners taken close to flat-out, see
   the comment above `CORNER_DEFINITIONS` in the script), and stores the whole
   lap as the circuit outline (`src/data/circuit.json`).
4. For every driver and every one of the 14 corners, finds that driver's own
   closest point to the reference corner position, then slices out a
   corner-sized window (capped by distance so tightly-packed corners don't
   overlap) and detects the real ground-truth point in it: the first brake
   transition, or if the corner is taken flat-out, the first throttle lift, or
   if neither happens, marks the corner `actionType: 'none'`.
5. Writes one file per driver (`src/data/drivers/{VER,HAM,ANT,NOR}.json`),
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
src/data/circuit.json            full track outline + the 14 named corners
src/data/drivers/*.json          per-driver, per-corner telemetry (no network at runtime)
src/lib/corner.ts                sampling/interpolation over a corner fixture
src/lib/geometry.ts              shared SVG viewBox math
src/lib/scoring.ts               Dutch-language result messaging
src/lib/teamLivery.ts            hand-picked team color palettes (no official logos)
src/hooks/useBrakeGame.ts        per-corner game state machine (ready/running/result)
src/components/CircuitView.tsx   full map + CSS-transform zoom into a chosen corner
src/components/CircuitMap.tsx    circuit outline + clickable numbered corner badges
src/components/DriverSelect.tsx  pick VER/HAM/ANT/NOR for the chosen corner
src/components/CornerTrack.tsx   the road/curb visual + animated car (SVG)
src/components/F1Car.tsx         stylized top-down car, colored by team livery
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
- Track shape is drawn directly from a driver's GPS trace, not an official
  circuit vector, so it's accurate to that lap, not a generic map.
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
