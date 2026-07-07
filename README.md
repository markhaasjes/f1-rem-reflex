# RemReflex

Proof of concept for a browser reflex game built on real Formula 1 telemetry
from [OpenF1](https://openf1.org). You watch a real driver's onboard data
play back through the Tarzanbocht at Circuit Zandvoort, and have to hit
**REM!** at the moment you think the real driver braked. The result screen
compares your brake point to the real one, in meters and km/h.

This is a POC for a nos.nl feature around the Dutch Grand Prix — not
production code.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 (`@tailwindcss/vite`)
- No backend: telemetry is baked into a static JSON fixture at build time,
  so the running app never talks to OpenF1 directly.

## Run it

```bash
npm install
npm run dev
```

## How the data works

`scripts/fetch-corner-data.mjs` is a one-off data-prep script (not part of
the app bundle). It:

1. Pulls `car_data` and `location` from the OpenF1 free/historical API for
   one lap of one driver, in a fixed time window.
2. Resamples both onto a uniform 20 Hz grid and merges them (location is in
   decimeters in the raw feed — divided by 10 to get meters).
3. Detects the real brake point (first `brake` transition) and the apex
   (minimum speed) in that window.
4. Writes the result to `src/data/tarzanbocht-2025.json`.

The current fixture is Max Verstappen's fastest lap (lap 17, pole position)
in qualifying for the 2025 Dutch Grand Prix — chosen because it's a clean,
single push lap with no traffic. Re-run the script (after editing the
constants at the top) to regenerate it for a different session, driver, or
corner:

```bash
node scripts/fetch-corner-data.mjs
```

Because OpenF1's free tier only serves **historical** data (real-time data
requires a paid subscription), this script must run after a session ends —
it can't drive a truly live in-race version of the game. The 2026 Zandvoort
weekend data can be swapped in the same way once each session finishes.

## Structure

```
scripts/fetch-corner-data.mjs   data-prep script (network access, run manually)
src/data/*.json                 baked telemetry fixtures (no network at runtime)
src/lib/corner.ts               sampling/interpolation over the fixture
src/lib/scoring.ts              Dutch-language result messaging
src/hooks/useBrakeGame.ts       game state machine (ready/running/result)
src/components/                 CornerTrack (SVG), Start/Game/Result screens
```

## Known limitations (POC scope)

- Single corner (Tarzanbocht), single driver/lap.
- No leaderboard/persistence.
- Track shape is drawn directly from the driver's GPS trace, not an
  official circuit vector — it's accurate to that lap, not a generic map.
