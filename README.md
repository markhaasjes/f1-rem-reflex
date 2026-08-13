# NOS Rem Reflex

Proof of concept for a browser reflex game built on real Formula 1 telemetry
from [OpenF1](https://openf1.org). You fly over Circuit Zandvoort like the
F1 TV race map, zoom into four corners of Max Verstappen's real pole lap,
and drive them with held pedals: keep **GAS!** pressed where Max is flat
out, release everything where he coasts, and hold **REM!** through his
braking zones. Your pedal timeline is compared against his real telemetry
moment by moment; per pedal state you get a matched percentage and the three
are multiplied into the corner score, so you have to answer all three: one
pedal you never use drags the corner down however good the rest is. The final score is shareable
via a link, and the score card explains the whole calculation, including
an AI-assistance and data-provenance disclaimer.

This is a POC for a nos.nl feature around the Dutch Grand Prix, not
production code.

## The game

1. **Overview**: the full circuit, oriented like Google Maps, drawn in the
   F1 TV map style (green surroundings, dark asphalt, corner badges).
2. **Tarzanbocht** — practice corner (does not count): Max's brake, coast
   and full-throttle zones run alongside you as a dashed colored line, so
   you can see the telemetry you have to match.
3. **Gerlach & Hugenholtz** — a double: two braking zones, two returns to
   throttle.
4. **Bocht 9 & 10** — the slow double after Mastersbocht.
5. **Hans Ernstbocht** — the chicane, one deep braking zone.
6. **Eindscore** — 0–100 across the three scoring corners, plus a share link
   that carries your whole run (~80 characters): whoever opens it sees your
   overall REM/LOS/GAS accuracy bars rebuilt from your actual pedal work.

Each corner starts the moment you first hold the gas pedal on the ready
screen; while driving, the trail behind the car is colored by your own
input, and the result view runs Max's dashed zone line beside your solid
one, plus a REM/LOS/GAS accuracy card and an on-map legend.

Between rounds the camera zooms back to the overview and flies to the next
corner — one continuous map, no separate per-corner artwork.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 (`@tailwindcss/vite`), Effra with Helvetica fallback
- One Canvas 2D scene for every zoom level (devicePixelRatio capped at 2),
  inline SVG for the hero car
- Playable on its own page only: embedded in an iframe the app renders a
  poster that links out (see
  [Embedded in an article](docs/DEVELOPMENT.md#embedded-in-an-article-iframe))
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
scripts/analyze-race-line.mjs    diagnoses straight/faceted race-line corners (GPS data gaps)
scripts/lib/geojson.mjs          shared geometry helpers (fitting, resampling, smoothing)
src/data/zandvoort2025.json      the one fixture: circuit, full lap, rounds + target events
src/types.ts                     the fixture/game shape shared by every module
src/lib/canvas.ts                projection math + devicePixelRatio-aware canvas setup
src/lib/geometry.ts              the ViewBox type shared by canvas.ts and the camera
src/lib/scene.ts                 illustrated scene: sand, green corridor, paddock, track, curbs, gravel, badges
src/lib/canvasCar.ts             draws the top-down car SVG (public/images/auto-boven.svg) on the canvas
src/lib/corner.ts                sampling/interpolation + GPS-stall-proof car motion
src/lib/phases.ts                flat/coast/brake segmentation (Max's telemetry or any phase source)
src/lib/playerInput.ts           the player's pedal timeline: state lookup + colored segments
src/lib/scoring.ts               zone-match scoring (0-100 share matched) + Dutch verdicts
src/lib/storage.ts               localStorage persistence for the last run + best run
src/lib/tips.ts                  turns a round's worst zone into a Dutch coaching tip
src/hooks/useCircuitGame.ts      game state machine (intro/flying/ready/running/result/finished)
src/hooks/useCameraFlight.ts     animated camera box (log-space zoom, step queues)
src/hooks/useElementSize.ts      ResizeObserver hook
src/components/CircuitScene.tsx  the one canvas scene, own rAF loop (lazy repaint), every zoom level
src/components/EmbedPoster.tsx   what an iframe gets instead of the game: poster linking out to the page
docs/art/                        image masters (the served copies in public/images are derivatives)
src/components/HeroCar.tsx       side-view car for the intro (public/images/auto-zij.svg)
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
- **A short brand palette, no ad-hoc colors.** `#294cbd` is the page surface,
  `#02118a` the hatch lines on it, `#3ca0ff` water and livery accents; black is
  only `#1e1e1e`; red stays NOS red. The surface is dark, so page-level chrome
  is white, and every translucent variant has a measured contrast floor - see
  [Brand palette](docs/DEVELOPMENT.md#brand-palette) before changing either. The full rule, including the deliberate
  exceptions (the Dutch flag's official colors, the photo-sampled scenery
  greys, the brake/coast/throttle signal colors), lives in
  [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#brand-palette).
- **Type floor: 14px on phones, 16px from `sm:` up.** Dense chrome takes the
  14px step; primary copy stays 16px everywhere. See
  [the layout notes](docs/DEVELOPMENT.md#layout-invariants-portrait--landscape)
  before shrinking anything.
- **Pills, badges and buttons hug their label.** They are sized by their
  content (`BTN_BASE` carries `w-fit`), never stretched to the container, so
  the rounded end starts right after the text. Progress bars, cards and the
  pedals are the exceptions: those are meant to fill their width.
- **User-facing copy is Dutch; code, comments, docs and commit messages are
  English.** Keep new UI strings consistent with the existing verdict/copy
  tone in [scoring.ts](src/lib/scoring.ts) and [App.tsx](src/App.tsx). Never
  use a dash (`-`) as a pause in Dutch copy; use a comma instead.
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
- No leaderboard/persistence; the share link encodes the whole run in the
  URL and is forgeable by anyone who reads the token code (social share,
  not a competition).
- Scenery (dunes, green corridor, paddock block, gravel shapes) is
  illustrative, not surveyed; the track line itself is official geometry and
  the driven line is real telemetry.
- Car illustrations are hand-built with team-evocative colors, not official
  liveries or logos.
