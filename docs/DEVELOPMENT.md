# Development notes

Internal knowledge for extending this game: how the pieces fit together, the
non-obvious design decisions behind them, and what to watch out for when
adding features. The [README](../README.md) is the pitch and the file map;
this is the "how do I change X without breaking Y" reference.

## Mental model

Everything hangs off one fixture object (`TarzanFixture`, see
[types.ts](../src/types.ts)) loaded once at module scope in
[App.tsx](../src/App.tsx):

```ts
const fixture = fixtureJson as TarzanFixture;
```

There is no data fetching, no loading state, and no error state anywhere in
the app, because the fixture is a static JSON import baked into the bundle.
Every other module is a pure function of `(fixture, t)` or `(fixture,
playerInput)` — the game has no persistence and no side effects beyond
`requestAnimationFrame` and `ResizeObserver`. That constraint is what makes
the whole thing ~75 KB gzip and trivially static-hostable; keep it in mind
before reaching for a backend, a data-fetch, or global state for a new
feature — most things fit as a new pure function over the fixture instead.

## The fixture shape

```
meta          driver/session/circuit labels, all display-only
samples[]     20 Hz array: t, x, y, distanceM, speedKph, brakeActive, throttle, gear
brakePoint    { t, distanceM, speedKph } - Max's real brake point
apexPoint     { t, distanceM, speedKph } - used as the coast/brake -> accel cutover
durationS     length of the lap slice (6.8s for the Tarzanbocht)
totalDistanceM
roadPath[]    162-point centerline slice through the corner, for the scene's track/curb/gravel geometry
map           { outline[] (450pt full-circuit shape), startFinish (oriented point), corner (point) } - intro mini-map only
```

`samples` is the single source of truth for both the physics (distance/speed
scoring) and the visuals (car position/heading). `roadPath` is a _separate_,
smoother polyline used only for drawing track/curb/gravel — it does not need
to line up sample-for-sample with `samples`, only geometrically.

There is no schema validation on this JSON. If you hand-edit or regenerate
the fixture, a shape mistake will surface as a runtime NaN/undefined
somewhere in `corner.ts` or `scene.ts`, not a helpful error. Sanity-check a
new fixture by loading the app and watching the console, not by reading the
JSON diff.

### Why the car has two different position models

`sampleAt()` in [corner.ts](../src/lib/corner.ts) does plain linear
interpolation over `samples` — this feeds the _scoring_ math (distance/speed
at the moment of a brake/gas press) and must track the recorded telemetry
exactly.

`positionAt()`/`headingAt()` feed the _drawing_ of the car and do something
more involved: OpenF1's GPS trace has short stalls where recorded x/y barely
move while the speed channel still reads ~200 km/h, which makes a
linearly-interpolated car visually freeze and its heading spin. The fix
(discovered the hard way, see commit `2be865c`) is to decouple shape from
pace: build a smoothed geometric path from `samples.x/y` (dropping points
closer than `MIN_SEGMENT_M = 0.4`m as GPS jitter, then Catmull-Rom through
what's left), separately integrate the speed channel into a travelled-distance
curve, rescale that curve to span exactly the geometric path length, and walk
the car along the path by arc length using the rescaled travel curve. The
model is cached per `samples` array in a `WeakMap` (`MODEL_CACHE`) since
building it involves a binary-searchable cumulative-length table.

**If you add a new corner/driver fixture and the car looks jittery or spins
its heading**, this is almost certainly GPS-stall data again — check
`MIN_SEGMENT_M` before assuming something else broke.

## Game state machine

[useBrakeGame.ts](../src/hooks/useBrakeGame.ts) is the only place game
progression logic lives. Phases: `ready -> running -> result -> ready (or
back to running for the next round)`.

Key details worth knowing before changing round structure:

- **`PRACTICE_ROUNDS = 1`, `TOTAL_ROUNDS = 2`** — one blind practice lap,
  then one scoring lap. `attempt` counts from 1. `isScoring = attempt >
PRACTICE_ROUNDS`. Changing these two constants is the intended way to add
  more practice laps; nothing else needs to change, because `isScoring` and
  `roundLabel` in App.tsx are already derived from them.
- **One button does two jobs.** `press()` is wired to both the REM! button
  and Space. The _first_ press of a running lap sets the brake mark; the
  _second_ sets the gas mark and ends the lap. There's no separate "gas"
  control — this was a deliberate simplification (see commit history around
  `feature/practice-rounds`) so the player only ever has one thing to react
  to at a time.
- **Refs mirror state synchronously.** `brakeRef`/`gasRef` exist because two
  presses can land within the same frame (fast double-tap), and reading
  `brakeAttempt` (state) inside `press()` before React re-renders would miss
  the first mark. Any new "did the player already do X" check inside a
  frame-scale callback should follow the same ref-mirror pattern, not trust
  React state alone.
- **Never braking still ends the lap.** The animation loop's own timeout
  (`t >= corner.durationS`) sets `crashed = true` if `brakeRef.current` is
  still null — this is what produces "je hebt niet geremd, het grind in".
  There's no separate crash-detection system to hook into.

## Rendering pipeline (CornerScene)

[CornerScene.tsx](../src/components/CornerScene.tsx) is a single `<canvas>`
redrawn from scratch every relevant state change (not a persistent scene
graph). Draw order matters and is layered back-to-front in one effect:

```
sand background -> grass infield (clipped to roadPath) -> gravel trap
  -> track ribbon (checker + asphalt) -> apex/exit curbs
  -> [running] player's driven line so far
  -> [result] Max's phase-colored line + pins (scoring lap only) + player's pins
  -> car sprite (+ motion streaks if running)
  -> scale bar
```

- **Projection**: `fitProjection()` in [canvas.ts](../src/lib/canvas.ts) maps
  real-world meters to canvas pixels once per resize, `object-fit: contain`
  style, via `computeViewBox(roadPath + samples, 30m padding)`. Anything with
  a physical size (track width, curb width, car length) is defined in meters
  and multiplied by `projection.scale`; UI chrome (labels, pin dots) stays in
  fixed screen pixels. Keep new drawing code on the correct side of that
  line, or it will resize incorrectly on different screen sizes.
- **DPR handling**: `prepareCanvas()` caps `devicePixelRatio` at 2 and resets
  the context transform so all drawing code writes CSS-pixel coordinates.
  Never read `canvas.width`/`canvas.height` directly in drawing code — use
  the CSS `width`/`height` from `useElementSize`.
- **Deterministic speckle**: sand/gravel speckle decoration uses a seeded
  `mulberry32` PRNG (fixed seeds `7` and `23`), not `Math.random()` — a
  redraw must not visually shimmer while the car animates. If you add more
  decorative noise, seed it too.
- **Phase segmentation**: [phases.ts](../src/lib/phases.ts) turns the
  telemetry into `coast`/`brake`/`accel` runs by throttle/brake-active/apex-t
  thresholds (`COAST_THROTTLE_THRESHOLD = 95`, apex cutover for `accel`).
  This only classifies Max's real line for the reference overlay — it never
  touches the player's own marks.
- **Outside-of-corner sign**: `outsideSignAt()` in
  [scene.ts](../src/lib/scene.ts) uses a 3-point cross product on the
  roadPath to decide which side is "outside" at a given index, so gravel and
  curbs land on the correct side automatically for corners of either
  handedness. This means a new corner fixture with an opposite-direction
  turn should Just Work without a manual flip flag.

The top-down car in `canvasCar.ts` and the intro's flat side-view car in
[HeroCar.tsx](../src/components/HeroCar.tsx) are drawn independently (Canvas
Path2D vs. inline SVG) and are not kept in sync on purpose — they're
different art styles for different contexts (in-scene sprite vs. hero
illustration), both driven by the same `VERSTAPPEN_LIVERY` palette in
[teamLivery.ts](../src/lib/teamLivery.ts) so a livery change only needs to
happen in one place.

## Scoring

[scoring.ts](../src/lib/scoring.ts) buckets the _distance_ delta (not time
delta — meters is the more meaningful yardstick to a viewer, per the
README) between the player's mark and Max's, at fixed thresholds (3/10/25m
for braking, 5/14/30m for the gas point — asymmetric because braking has a
tighter real-world tolerance than throttle application). `combineResults()`
takes the worse of the two tones so the headline verdict is honest. If you
add a third markable point (e.g. turn-in), follow this same pattern: a pure
`describeXAttempt(deltaM | null)` function returning `{title, detail, tone}`,
folded into `combineResults` by extending `TONE_RANK` comparison to N
descriptions instead of two.

## Extension points, roughly in order of effort

- **New driver on the same corner**: swap `VERSTAPPEN_LIVERY` for a
  per-driver livery and add a driver picker; the fixture's `meta.teamColor`
  is already per-driver, `teamLivery.ts` is the only hardcoded one.
- **New corner, same driver**: needs a new fixture JSON with the same shape
  (see "Data provenance" in the README for how `tarzanbocht.json` was
  produced) and a fixture-selector one level above `useBrakeGame`. Everything
  downstream is corner-agnostic already — no corner-specific logic exists
  outside the fixture itself, `outsideSignAt` handles handedness, and
  `computeViewBox` handles framing.
- **More rounds / different practice structure**: change
  `PRACTICE_ROUNDS`/`TOTAL_ROUNDS` in `useBrakeGame.ts`; see the state
  machine notes above.
- **Leaderboard/persistence**: currently the entire app has zero storage of
  any kind (no localStorage, no backend). Adding this means introducing the
  project's first side effect and first async state — do it as an isolated
  hook, not inline in `useBrakeGame`, so the core game logic stays pure and
  testable.
- **A third markable point (e.g. turn-in point)**: extend `BrakeAttempt`
  handling in `useBrakeGame.ts` (currently hardcoded to exactly two presses
  via `brakeRef`/`gasRef`) to a small ordered list instead, and add a matching
  `describeXAttempt` in `scoring.ts`.

## Working with SVG hero art (lessons from this session)

`HeroCar.tsx` is a hand-colored recreation of a Noun Project line-icon
(nose-left convention for the game, but source icons are usually drawn
facing right). Workflow used twice now for swapping in a new source icon:

1. **Never trust the source `viewBox`.** Noun Project icons often ship a
   viewBox far larger than the actual artwork (e.g. `0 0 100 125` for art
   that only occupies `y 40–60`). Measure the _real_ bounding box instead of
   guessing:
   ```js
   // via Playwright, with the Noun Project attribution <text> elements stripped first
   const svg = page.querySelector('svg');
   const g = svg.querySelector('g') ?? svg; // some icons wrap paths in <g>, some don't
   const box = g.getBBox(); // { x, y, width, height }
   ```
   Set the component's `viewBox` from that box (plus a hair of margin) or the
   car renders tiny and off-center inside its container.
2. **Check facing direction before recoloring.** If the source faces the
   wrong way for this game's nose-left convention, wrap the paths in a single
   `<g transform="translate(<viewBoxWidth> 0) scale(-1 1)">` rather than
   editing every path's coordinates by hand.
3. **Recolor by fill, not by replacing path data.** Keep the original path
   `d` strings verbatim and only change `fill`/`stroke` per shape to the
   livery palette (`body`, `accent`, `cockpit` from `teamLivery.ts`) — this
   keeps the diff reviewable against the source icon and makes swapping the
   palette later a one-line change.
4. **Always verify by screenshotting the actual rendered app**, not just the
   raw SVG file — cropped/zoomed on the hero car region. A viewBox that looks
   fine as a standalone file can still clip when the component's container
   has a different aspect ratio: run `npm run dev`, screenshot the page with
   Playwright, crop to the region of interest with ImageMagick, then look at
   it.

## Working with the share/OG image

`public/images/share.png` is flat vector-style art (solid fills, no photo
gradients), which makes PNG palette reduction a safe, large win with zero
visible loss:

```bash
magick share.png -strip -colors 64 PNG8:share.png   # ~212KB -> ~45KB on this file
```

Always visually diff a couple of color-count candidates (64 vs 32 vs original)
before picking one — flat art degrades gracefully down to a point, then
bands visibly on soft shadows/gradients. 64 colors was clean on this image;
32 introduced faint banding on the car's shading.

## Deployment (Vercel)

This is a 100%-static SPA — no `/api` directory, no serverless/edge
functions, `Function Invocations` in the Vercel dashboard is always 0. That
means most of Vercel's per-project runtime dials (Fluid Compute, Function
CPU, Function Region, Cold Start Prevention) are inert here; don't spend
time tuning them. What actually matters for this project:

- **`vercel.json`** carries an explicit SPA rewrite (`/(.*) -> /index.html`)
  plus `Cache-Control` headers: hashed `/assets/*` (Vite's content-hashed JS/
  CSS) are `immutable, max-age=31536000` since a change always produces a new
  filename; `/images/*` are capped at 1 hour (`max-age=3600,
must-revalidate`) specifically so replacing an image under the same
  filename (like `share.png`) propagates quickly instead of being cached for
  a year.
- **Skew Protection** is worth enabling in Project Settings for a
  content-hashed SPA: without it, a user with an old tab open after a
  redeploy can request a chunk hash that no longer exists on the CDN and hit
  a blank screen.
- **Node version** (`.nvmrc`, currently `v24.17.0`) only affects the build
  step, not runtime — there's no server runtime to version.
