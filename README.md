# NOS Rem Reflex

Proof of concept for a browser reflex game built on real Formula 1 telemetry
from [OpenF1](https://openf1.org). You fly over Circuit Zandvoort like the
F1 TV race map, zoom into four corners of Max Verstappen's real pole lap,
and hit the **REM!** and **GAS!** pedals at the moments you think he braked
and got back on the throttle. Every brake/gas moment is scored by how close you are
to his real point (in meters); the final score is shareable via a link.

This is a POC for a nos.nl feature around the Dutch Grand Prix, not
production code.

## The game

1. **Overview**: the full circuit, oriented like Google Maps, drawn in the
   F1 TV map style (green surroundings, dark asphalt, corner badges).
2. **Tarzanbocht** — practice corner (does not count): one brake, one gas.
3. **Gerlach & Hugenholtz** — a double: brake, gas, brake, gas.
4. **Bocht 9 & 10** — the slow double after Mastersbocht.
5. **Hans Ernstbocht** — the chicane, one deep braking zone.
6. **Eindscore** — 0–100 across the three scoring corners, revealed with
   Max's real team radio (positive clip for a good score), plus a share link
   that renders the same score card for whoever opens it.

Between rounds the camera zooms back to the overview and flies to the next
corner — one continuous map, no separate per-corner artwork.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 (`@tailwindcss/vite`), Effra with Helvetica fallback
- One Canvas 2D scene for every zoom level (devicePixelRatio capped at 2),
  inline SVG for the hero car
- No backend and no runtime network calls: one baked fixture
  (`src/data/zandvoort2025.json`, ~385 KB raw) carries the circuit geometry,
  the full pole lap at 20 Hz and the four rounds.

## Run it

```bash
npm install
npm run dev
```

## Data provenance

`src/data/zandvoort2025.json` is produced by
`node scripts/build-game-fixture.mjs`, which fetches Max Verstappen's 2025
Dutch GP qualifying pole lap (lap 17) from OpenF1 (`car_data` + `location`,
resampled to 20 Hz) and fits it onto the official circuit centerline
([bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) GeoJSON,
projected north-up — which is why the map matches Google Maps orientation).
Max's brake/gas target events per round are derived from the brake and
throttle channels; the script prints a telemetry timeline per round window
so the boundaries can be sanity-checked by hand.

Because OpenF1's free tier only serves historical data, a fixture like this
can only be produced after a session ends. Fresh data can be swapped in by
updating the `DRIVER` lap reference in the script and re-running it.

## Structure

```
scripts/build-game-fixture.mjs   data pipeline: OpenF1 + official geometry -> the fixture
scripts/fetch-team-radio.mjs     downloads Max's team-radio mp3s for the score screen
scripts/analyze-race-line.mjs    diagnoses straight/faceted race-line corners (GPS data gaps)
scripts/lib/geojson.mjs          shared geometry helpers (fitting, resampling, smoothing)
src/data/zandvoort2025.json      the one fixture: circuit, full lap, rounds + target events
src/types.ts                     the fixture/game shape shared by every module
src/lib/canvas.ts                projection math + devicePixelRatio-aware canvas setup
src/lib/geometry.ts              the ViewBox type shared by canvas.ts and the camera
src/lib/scene.ts                 illustrated scene: sand, green corridor, paddock, track, curbs, gravel, badges
src/lib/canvasCar.ts             top-down car sprite, in team-evocative colors
src/lib/corner.ts                sampling/interpolation + GPS-stall-proof car motion
src/lib/phases.ts                flat/coast/brake segmentation of the driven line
src/lib/scoring.ts               per-event scores (0-100) + Dutch verdicts
src/lib/storage.ts               localStorage persistence for the last run + best run
src/lib/tips.ts                  turns a round's worst event into a Dutch coaching tip
src/lib/teamLivery.ts            hand-picked livery palette (no official marks)
src/hooks/useCircuitGame.ts      game state machine (intro/flying/ready/running/result/finished)
src/hooks/useCameraFlight.ts     animated camera box (log-space zoom, step queues)
src/hooks/useElementSize.ts      ResizeObserver hook
src/components/CircuitScene.tsx  the one canvas scene, own rAF loop, every zoom level
src/components/HeroCar.tsx       flat side-view car illustration for the intro
src/components/NOSLogo.tsx       NOS wordmark used in the app chrome
src/components/Brand.tsx         shared pill/badge chrome
src/App.tsx                      layout shell, flow wiring, share flow, copy
```

## Development notes

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers the internals for anyone
extending the game: the fixture data shape and pipeline, the detailed game
flow state machine, the camera system, the rendering pipeline, scoring, the
share-link format, and a prioritized list of extension points.

## Contributing

This README doubles as the guidelines for anyone — human or Claude Code —
working on this repo. Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) first
for how the pieces fit together; the rules below are about how to change them.

### Rules and information for contributing

- **No backend, no runtime network calls.** This is a static SPA by design
  (see [Stack](#stack)); don't reach for an API route or a server to solve a
  problem — find the client-side or build-time answer instead.
- **Never hand-edit `src/data/zandvoort2025.json`.** It's generated by
  `scripts/build-game-fixture.mjs`. Change the script (or its constants,
  e.g. `ROUND_DEFINITIONS`/`CORNER_DEFINITIONS`) and re-run it.
- **Verify by playing the game, not just by building it.** `tsc`/`oxlint`
  catch type and lint errors, not broken feel or a facet in a race line. For
  flow or rendering changes, run `npm run dev` and click through the affected
  rounds (or drive them with Playwright); for race-line/geometry work, follow
  the verification criteria in the
  [Hugenholtz playbook](docs/DEVELOPMENT.md#repairing-a-race-line-with-gps-data-gaps-the-hugenholtz-playbook).
- **User-facing copy is Dutch; code, comments, docs and commit messages are
  English.** Keep new UI strings consistent with the existing verdict/copy
  tone in [scoring.ts](src/lib/scoring.ts) and [App.tsx](src/App.tsx).
- **Commit messages explain why, not just what.** Follow the existing
  `type: short summary` subject style (`feat`, `fix`, `polish`, `docs`,
  `chore`, `revert`) with a body that gives the reasoning and, where it
  applies, the measurement that proves the fix (see recent history with
  `git log`).
- **Update [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** alongside any change
  to the game flow, fixture shape, rendering pipeline or scoring — it's the
  "how do I change X without breaking Y" reference and goes stale fast
  otherwise.

### Code style

- Focus on writing readable, maintainable code. All variables must have
  self-explanatory/evident names. Don't use abbreviations unless variable or
  filenames would become way too long. (Exception: the established
  unit-suffix convention in this codebase — `deltaM`/`distanceM` for meters,
  `tStart`/`tEnd`/`STEP_S` for seconds — is a domain convention, not an
  abbreviation to avoid.)
- Prefer the functional programming paradigm unless this would have a
  negative effect on readability and maintainability. Concretely, in this
  codebase that means: plain functions over classes (there are none in
  `src/`), and modules/hooks that stay pure functions of `(fixture, t)` or
  `(fixture, playerInput)` with side effects isolated to
  `requestAnimationFrame`, `ResizeObserver` and the share button.
- Use named exports and `export function foo(...)` declarations for
  functions and components, reserving `export default` for the app root
  ([App.tsx](src/App.tsx)). Use `const` only for simple values/objects
  (e.g. `ROAD_WIDTH_M`, `PALETTE`).
- Prefer `interface` for object shapes and `type` for unions/aliases,
  matching the existing files.
- Only comment on the non-obvious: a hidden constraint, an invariant, or the
  reasoning behind a workaround — not what the code already says through
  naming. See [phases.ts](src/lib/phases.ts) or [scoring.ts](src/lib/scoring.ts)
  for the level of comment this codebase expects.
- Formatting and basic correctness are enforced by Prettier
  (single quotes, trailing commas, 120-column width — see
  [.prettierrc](.prettierrc)) and oxlint ([.oxlintrc.json](.oxlintrc.json));
  run `npm run lint` before committing. `npm run knip` ([knip.json](knip.json))
  catches dead files, unused exports and unused dependencies — the CLI
  scripts in `scripts/` are configured as entry points since nothing in
  `src/` imports them.

## Known limitations (POC scope)

- One driver, four fixed corner windows, by design.
- No leaderboard/persistence; the share link encodes the score in the URL
  and is trivially forgeable (social share, not a competition).
- Scenery (dunes, green corridor, paddock block, gravel shapes) is
  illustrative, not surveyed; the track line itself is official geometry and
  the driven line is real telemetry.
- Car illustrations are hand-built with team-evocative colors, not official
  liveries or logos.
