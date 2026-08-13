# Development notes

Internal knowledge for extending this game: how the pieces fit together, the
non-obvious design decisions behind them, and what to watch out for when
adding features. The [README](../README.md) is the pitch; this is the
"how do I change X without breaking Y" reference.

## Mental model

Everything hangs off one fixture object (`ZandvoortFixture`, see
[types.ts](../src/types.ts)) loaded once at module scope in
[App.tsx](../src/App.tsx). It contains the full circuit geometry, Max
Verstappen's entire pole lap at 20 Hz, and the four game rounds — all in one
shared coordinate space (meters, north-up like Google Maps). There is no data
fetching, no loading state, and no backend anywhere in the app. Every module
is a pure function of `(fixture, t)` or `(fixture, playerInput)`; the only
side effects are `requestAnimationFrame`, `ResizeObserver` and the share
button (Web Share API / clipboard). Keep it that way: most new features fit
as a new pure function over the fixture.

The fixture is produced by
[scripts/build-game-fixture.mjs](../scripts/build-game-fixture.mjs) — see
"Data pipeline" below. Never hand-edit `src/data/zandvoort2025.json`; change
the script and re-run it.

## Game flow

The flow is a state machine in
[useCircuitGame.ts](../src/hooks/useCircuitGame.ts) plus a
camera owned by App ([useCameraFlight.ts](../src/hooks/useCameraFlight.ts)).
Game state and camera stay in lockstep because every transition handler in
App does both (e.g. `flyToRound(2)` + `camera.fly(...)`, with `game.arm` as
the flight-completion callback).

```
intro                overview map, all 14 corner badges, pulsing badge on the
  |                  next round's corner, hero strip, "Naar de Tarzanbocht"
  | startGame()      camera: overview -> round 0 box (1.7s)
  v
flying               "Onderweg naar de <bocht>..." — no interactive controls
  | camera done -> game.arm()
  v
ready                car waits at the window start; both pedals are live and
  |                  the gas pedal is ringed: "Houd GAS ingedrukt om te
  |                  starten" — the first gas press IS the start. On phones
  |                  the camera holds the corner overview, then dives onto
  |                  the car, so driving starts zoomed in (see Rendering)
  | setPedal('gas', true)
  v
running              rAF clock plays lap.samples from round.tStart to tEnd in
  |                  real time; the player HOLDS the pedals (pointer capture,
  |                  R/G/arrows) and every change of the combined state is
  |                  recorded as an InputTransition on the lap clock; the
  |                  trail behind the car is colored by the player's input
  | t >= tEnd        round is scored (scoreRound) and appended to results
  v
roundResult          Max's dashed zone line beside the player's solid line,
  |                  verdict banner, REM/LOS/GAS accuracy card
  | nextRound()      camera: corner -> overview (1.2s) -> hold -> next corner
  |                  (1.5s); back to `flying` above ... repeat for 4 rounds
  | showFinal()      after the last round: camera drifts back to overview
  v
finished             score card overlay: total /100, per-round breakdown,
                     "Deel je score" (Web Share / clipboard), "Nog een keer"
```

Separate from the state machine: when the URL carries `?s=<total>&r=<r0.r1.r2.r3>`
(a shared link), App renders a "Gedeelde score" landing card over the intro;
"Speel zelf" strips the params (`history.replaceState`) and restarts.

Things worth knowing before changing the flow:

- **Practice does not count.** The Tarzanbocht round (`practice: true`) is
  played and scored like any other and shown on the final card, but
  `totalScore` excludes practice rounds from the overall 0-100. During
  practice, Max's zones render as a wide colored corridor on the road.
- **Held pedals, one 3-state input.** REM! and GAS! are held, not tapped
  (pointer capture keeps a press alive when the finger drifts off; keyboard
  is keydown/keyup with auto-repeat ignored). The combined state is a single
  `PedalInput` — brake wins when both pedals are down — and only _changes_
  of that state are recorded (`InputTransition[]` on the lap clock), so a
  round's timeline stays a handful of entries.
- **A round starts on the first gas press.** There is no start button: on
  `ready`, `setPedal('gas', true)` flips the phase to `running` and opens
  the timeline at `round.tStart` with whatever the player is holding.
- **The timeline is mirrored in a ref** (`transitionsRef`) because a pedal
  change must read the up-to-date list immediately; never read the React
  state inside `setPedal()`.
- **A round always plays to `tEnd`.** There is no early exit and no crash
  state; touching nothing simply scores whatever share of the window
  'coast' happens to match.

## The fixture shape

```
meta           session/driver labels + lapStartT (t of the S/F crossing) etc.
trackOutline   1400 pts, official circuit centerline, closed loop, ~3m spacing
startFinish    { x, y, headingDeg }
corners[14]    { number, name, x, y, distanceM } - map badges + curb/gravel anchors
lap.samples    ~1670 x { t, x, y, distanceM, speedKph, throttle, brakeActive, gear }
               continuous 20 Hz, t=0 ten seconds BEFORE the lap starts
               (lead pad), distanceM rebased to meters-into-lap
rounds[4]      { id, label, cornerNumbers, practice, tStart, tEnd,
                 events: [{ type: 'brake'|'gas', t, distanceM, speedKph }],
                 bounds: {minX,minY,maxX,maxY} }  - the camera zoom box

Scoring no longer consumes rounds[].events - the hold-to-drive comparison
reads Max's phases straight from the telemetry channels. The events only
feed the "twee remzones" ready-screen copy these days (event count / 2 =
braking zones).
```

All coordinates live in one frame: the official geometry's, north-up
(y = south), meters. `t` is global across the whole file — a round is just a
`[tStart, tEnd]` window over `lap.samples`, and `rounds[].events[].t` indexes
into the same clock. That single shared frame/clock is what makes the camera
able to fly anywhere and the car able to drive any window with no
re-basing math anywhere in the app.

There is no schema validation on this JSON. If you regenerate it, sanity
check by playing a full game, not by reading the diff.

## Data pipeline (scripts/)

`node scripts/build-game-fixture.mjs` rebuilds the fixture from two sources:

1. **OpenF1** (free tier, historical only): `car_data` + `location` for VER's
   pole lap (session 9916, lap 17), resampled onto a uniform 20 Hz grid.
   Raw OpenF1 x/y are mirrored (`MIRROR_X`) to fix chirality.
2. **bacinger/f1-circuits GeoJSON**: the official Zandvoort centerline,
   projected to flat meters **north-up** — this is what makes the map match
   Google Maps orientation. The coarse control points are densified with
   **centripetal** Catmull-Rom (alpha 0.5): the uniform variant overshoots
   into cusps/loops at tight corners, which rendered as knots in the track
   edge at Kumhobocht and Arie Luyendijk and polluted the telemetry fit. The telemetry is fitted onto it with a
   similarity transform (complex Procrustes over 360 arc-length-resampled
   points, searching all index rotations). The old pipeline re-rotated the
   result to put Tarzan at the bottom; this script deliberately does not.

Round windows (`ROUND_DEFINITIONS`, meters-into-lap) were chosen by hand
against the printed telemetry timeline (`printTimeline` output) so each
window starts on a clean flat-out approach and ends after Max commits back
to full throttle. Target events are derived by `detectEvents`:

- a **brake** event opens at the first brake application; further brake
  re-applications merge into the same zone (Max trail-brakes through
  Gerlach into Hugenholtz — one zone, one target);
- a **gas** event closes the zone only at _sustained_ full throttle
  (>= 95% for 0.3s), so one-sample upshift blips don't count.

What the telemetry actually says about the four rounds (2025 pole lap):

| Round                         | Window (m into lap) | Events                                     |
| ----------------------------- | ------------------- | ------------------------------------------ |
| Tarzanbocht (practice)        | 90–480              | brake@232, gas@391                         |
| Gerlach & Hugenholtz (double) | 460–1010            | brake@614, gas@717, brake@741, gas@860     |
| Bocht 9 & 10 (double)         | 2030–2660           | brake@2141, gas@2287, brake@2357, gas@2530 |
| Hans Ernstbocht (chicane)     | 2700–3300           | brake@2972, gas@3172                       |

Gotchas encoded in the window choices: Gerlach+Hugenholtz is split into a
double via a per-round `gasSustainSamples: 1` override - Max touches full
throttle for a single 20 Hz sample between the two corners, which the default
0.3s sustain filter would (correctly) ignore elsewhere; Bocht 9 & 10 is the slow double after
Mastersbocht (8, the fast ~236 km/u right at ~2000m — do not confuse them);
Hans Ernst (11/12) is the chicane before Kumhobocht, taken as one deep
braking zone. The corner `expectedIntoLapM` anchors are calibrated against
the official F1 TV circuit map: its badge positions were projected into our
frame with a similarity transform anchored on corners 1 and 3, snapped to
the track, and cross-checked against curvature clusters and speed minima.
Two earlier anchor sets were wrong (hand-interpolated: up to 160m drift;
curvature-only: misnumbered the whole 7–13 sequence). If badges ever look
off again, redo the F1 TV projection — never nudge numbers by eye.

## Rendering (CircuitScene)

[CircuitScene.tsx](../src/components/CircuitScene.tsx) is one `<canvas>`
running its **own rAF loop**: it reads the latest props from a ref so React
stays out of the hot path. The loop itself is cheap and always on, but the
scene **paints lazily**: every frame builds a snapshot string of everything
the drawing reads (camera box, size, dpr, phase, clock, timeline length,
fonts-loaded) and skips rasterizing when it matches the previous frame,
unless the phase is time-animated (`running` = the clock, `flying` = the
badge pulse). Painting unconditionally kept the main thread >50% busy on
completely idle screens. If you add any new time-based animation to the
canvas, either tie it to a phase in the `timeAnimated` check or put its
driver in the snapshot — otherwise it will freeze mid-cycle. Draw order,
back to front:

```
sand + dunes (world space) -> green corridor + striped infield -> paddock
  -> gravel traps (GRAVEL_CORNERS) -> track ribbon (white edge, dark asphalt,
  center sheen) -> red/white curbs at all 14 corners -> start/finish checker
  -> [practice ready/running] Max's dashed reference line
  -> [running] input-colored trail so far -> [result] Max's dashed line +
  the player's solid line -> pedal glow under the car
  -> car -> corner badges + labels (fade out as you zoom in) -> scale bar

Max's telemetry is a **dashed** phase-colored line one road-half beside the
driven line (`MAX_LINE_OFFSET_M`/`WIDTH_M`/`DASH_M` in CircuitScene, offset
via `offsetPathPoints`), the player's own line is solid on the driven line.
The dash pattern - not width, position or opacity - is what tells the two
apart, so both can stay thin and full-strength: matching stretches read as
two same-colored lines running together, a mismatch as two colors side by
side. `drawRibbon`'s `dashM` is in **meters** so dashes keep their
road-relative size at every zoom, and dashed ribbons switch to butt caps
(round caps grow each dash by half the line width at both ends and close
the gaps). Two earlier attempts are worth not repeating: a 6m
semi-transparent corridor on his racing line vanished under the player's
line, and tinting the whole asphalt band in his zone colors drowned the
map's own colors. Offsetting is geometry work, so the offset segments are
built once per fixture in a memo, never per frame. There are deliberately
no point markers (no "rem hier" pins, no Max/Jij dots on the road): the
zone colors say where braking starts and where the throttle opens, and the
on-map legend covers the colors plus the dashed-vs-solid distinction.
```

The sand decoration (dune patches, scrub, grass speckles) is a fixed field in
world meters (`SAND_FIELD`/`SAND_DECOR` in scene.ts), precomputed once and
projected per frame — an earlier screen-space version left the background
standing still while the camera moved, which broke the map illusion on the
phone chase cam and during zoom flights. Only the flat base sand color fills
in screen space, covering any zoom-out past the decorated field.

- **One scene, every zoom.** There are no separate overview/corner
  renderings: everything physical is specified in meters and multiplied by
  `projection.scale`, so the same draw calls hold up from the 4km overview
  to a 300m corner box. UI chrome (badges, pins, labels) stays in screen
  pixels and _fades out_ by scale (`badgeAlpha`) instead of scaling.
- **The camera is just a projection.** `useCameraFlight` animates a
  `CamBox {cx, cy, w, h}` (center linear, size in **log space** — that's
  what makes zoom rate feel constant); `fitProjection(viewBoxFromCam(box))`
  turns it into meter→pixel mapping per frame. Flights are step queues
  (`fly([{box, ms}, {ms: pause}, {box, ms}])`), giving the
  corner → overview → next corner two-stage move the user sees.
- **Chase cam on phones**: on non-`wide` viewports the zoom happens
  **before** the player drives. On `ready` the camera holds the corner
  overview for `CHASE_HOLD_MS` (2.5s, long enough to read the corner) and
  then eases down onto the parked car over `CHASE_DIVE_MS` (1.6s), so
  `running` starts already zoomed in and `follow(getTarget)` (7% of the
  remaining distance per frame) takes over with nothing to travel. Starting
  early is allowed: a gas press mid-storyboard flips the phase, and
  `chaseZoomedRef` tells `running` whether it still has ground to cover — if
  so it flies the rest in `CHASE_SNAP_MS` (0.65s) before following. Two
  earlier versions were worse: engaging the follow on the gas press (a
  snap-zoom that disoriented players) and running the hold+dive _during_ the
  first seconds of the lap (the player drove the opening blind). The effect must depend on the hook's **stable callbacks**, not
  the returned camera object — that object changes identity every animated
  frame, which would restart the flight per render and it would never land.
- **The outline is rotated at load** (`rotateOutline`) so index 0 sits at
  start/finish; corner slices for curbs/gravel then never wrap the closed
  loop's array boundary.
- **Deterministic decoration**: all speckles use seeded `mulberry32` PRNGs
  (per-corner seeds for gravel) — `Math.random()` would shimmer at 60fps.
  Grass stripes are drawn in world space for the same reason.
- **Corner handedness is automatic**: `outsideSignAt` (3-point cross
  product) puts gravel outside and curbs on the right sides for either
  corner direction; `interiorSign` (point-in-polygon probe) finds the
  infield for the paddock. No per-corner flip flags.
- **The car is an SVG image**: `drawF1Car` draws
  `public/images/auto-boven.svg` (nose toward +x, livery colors baked into
  the file) via `drawImage`, normalized to the same 37-unit footprint the old
  path-drawn sprite used. It is deliberately oversized (~22m) for
  readability; at overview zoom a minimum pixel length kicks in
  (`CAR_MIN_LENGTH_PX`), so it stays spottable when parked on the grid.
- **Ribbons are drawn from the smoothed car path**, never from raw samples:
  `buildSegments` (phases.ts) samples `positionAt` at 0.05s steps with a
  pluggable phase source — Max's telemetry (`buildPhaseSegments`) and the
  player's pedal timeline (`buildInputSegments`) render through the same
  machinery — so no drawn line carries the 20 Hz GPS jitter that used to
  show through slow corners.
- **Offset geometry self-protects on hairpins**: `offsetPolyline` prunes
  folded/bunched points, and curbs use `offsetPolylineRuns`, which _splits_
  the curb wherever the bend is tighter than the offset reaches instead of
  bridging a line across the apex. Gravel is a wide butt-capped stroke of an
  offset centerline (a filled near/far polygon self-intersects on hairpins).
- **Palette + curb realism come from photos**: `PALETTE` in scene.ts is
  sampled from the aerial/broadcast screenshots in `docs/corners` (medium-gray
  asphalt, paved beige-gray run-offs, khaki dunes with olive scrub, muted
  grass); the sea and the lakes are the brand blues (see
  [Brand palette](#brand-palette)); curbs are white + `redNosRood` from `docs/colors.ts`, with
  per-corner extents in `CURB_TUNING` (CircuitScene) positioned against those
  photos. Corner badges split into prominent (playable corners) and `minor`
  (everything else); round-label screen offsets live in `LABEL_OFFSETS` so
  they clear each other on narrow portrait canvases.
- **One stage corner, three tenants**: the HTML legend hugs the stage's
  bottom-left with the live speed badge stacked directly above it (positioned
  against the wrapper's top edge, so it can fade without leaving a gap and the
  stack holds whether the legend has one row or two), and the canvas scale bar
  draws in that same corner - so App passes `showScaleBar={!legendVisible}`
  and the bar simply yields while the legend is up. Moving the bar to the
  right instead does not work: on a landscape phone the stage is ~356px wide
  and the legend alone is 259px.
- **Visual QA per corner**: `?corner=N` starts the camera zoomed on corner N
  with the intro chrome hidden — used by the Playwright corner-snapshot sweep
  when comparing against the official F1 TV map.

### Why the car has two position models

`sampleAt()` ([corner.ts](../src/lib/corner.ts)) linearly interpolates the
20 Hz samples — it feeds _scoring_ (distance at the moment of a press) and
must track recorded telemetry exactly. `positionAt()`/`headingAt()` feed
_drawing_: OpenF1's GPS trace has stalls (x/y freezes while speed reads
200+ km/h) that make a linearly-driven car freeze and its heading spin. The
fix: build a jitter-filtered, Catmull-Rom-smoothed geometric path once per
samples array (WeakMap-cached, repaired per REPAIR_RANGES — next section),
integrate the speed channel into a travel curve rescaled to the path length,
and walk the car by arc length. `primePathModel(samples, outline)` must run
before first use so the repair has the road shape; CircuitScene does this in
its outline memo. If a future fixture makes the car jitter or spin, it's GPS
stalls again — look at `MIN_SEGMENT_M` before anything else.

### Repairing a race line with GPS data gaps (the Hugenholtz playbook)

Symptom: a corner's drawn line (driven ribbon / phase colors) renders as a
straight or faceted segment where the road clearly curves. Gerlach &
Hugenholtz had it worst; the machinery to fix it is generic and reusable.

**Why it happens** — three stacked causes, all diagnosed on real data:

1. OpenF1's location feed only updates every ~15–40m; the pipeline's 20 Hz
   resample lerps between updates, so the trace is chains of _perfectly
   collinear fill points_ — dense enough to pass any "missing data" check,
   but carrying no shape.
2. Some gaps skip an entire arc: through the Hugenholtz hairpin there are
   real vertices at 791m and 830m and _nothing_ in between — the whole 180°
   bowl is one 39m chord. No spline can invent that arc from neighbors; it
   needs the road's shape.
3. Subtler killers even after bridging along the road: Max's real ~5m
   outside-to-inside sweep, blended linearly, mathematically cancels road
   curvature (a changing lateral offset straightens a curve); and the
   official outline itself has a brief zero-curvature dip mid-bowl that the
   wide road band masks but a thin line exposes.

**The repair** (`repairStraightFills` in corner.ts) runs only inside
configured `REPAIR_RANGES` (meters into lap); every other meter of the lap
uses Max's trace untouched. Per range: collapse collinear fill back to the
real GPS vertices → thin jittery near-duplicates (`MIN_VERTEX_SPACING_M`)
→ re-express the slice on the outline's ~3m grid with per-vertex lateral
offsets, gaps filled by blending (`projectOnOutline` seeds by lap distance
so parallel track sections can't capture points) → low-pass the offset field
(`OFFSET_SMOOTH_WINDOW`, seams pinned) → even out the turn-angle profile
(`smoothTurnProfile`, `TURN_SMOOTH_WINDOW`, endpoints pinned via
rotation+scale) → densify with centripetal Catmull-Rom.

**To re-apply on another corner:**

1. `node scripts/analyze-race-line.mjs <fromM> <toM>` — it lists the
   collinear fills, the data gaps, the stretches where the road turns but
   the trace doesn't, and prints a suggested `REPAIR_RANGES` entry.
   Treat section 3 as _candidates_: it also flags corners that already look
   fine (a real racing line legitimately straightens corners); only repair
   what actually renders wrong.
2. Add the range to `REPAIR_RANGES` in [corner.ts](../src/lib/corner.ts),
   with both ends trimmed onto clean straights (the boundary points become
   the pinned seams).
3. Verify like the original fix: play the round and screenshot the result
   zoomed (`?corner=N` helps); check numerically if in doubt — the line's
   turn rate should track the road's through the corner, stay within the
   road half-width (6.5m) of the centerline, and stay within ~2m of Max's
   real vertices.

Tuning knobs, all in corner.ts: `COLLINEAR_DEV_M` (what counts as lerp
fill), `MIN_VERTEX_SPACING_M` (jitter thinning), `OFFSET_SMOOTH_WINDOW`
(how fast the line may drift across the road), `TURN_SMOOTH_WINDOW` (how
aggressively curvature dips get filled). One hard-won spline lesson lives in
`densifyCentripetal`: never fudge a degenerate knot interval with an epsilon
divisor — it breaks the weights' partition of unity and shoots points to the
origin; return the endpoint instead.

## Scoring

[scoring.ts](../src/lib/scoring.ts). The comparison is time-based: the round
window is walked on the same 0.05s grid the ribbons render at, and at every
step the player's pedal state (from the transition timeline) is compared
against Max's phase (`classifyAt`: brakeActive → brake, throttle < 95 →
coast, else flat).

- **Numeric**: the round score is the **geometric** mean of the three
  per-phase match percentages (the REM/LOS/GAS bars on the result card),
  rounded per phase first so a 0% bar really does zero the round. Both
  simpler formulas pay out ~50 for not playing, and both were shipped and
  rejected: the matched share of _time_ gave ~51 for holding the gas down
  (Max is flat out 40-55% of every window), and the _arithmetic_ mean gave
  ~48 for touching nothing after the start, because coasting is the absence
  of input and collects a free 100% on that phase. Multiplying instead of
  averaging means every phase has to be answered - one pedal you never use
  drags the whole round down however good the other two are. Calibration
  (scripted, see the verification workflow): mirroring Max's telemetry with
  120ms lag **100**, doing nothing **29**, holding gas only **14**. The
  trade-off is that the player can no longer verify the score by averaging
  the bars, so the explainer modal states the rule in words instead of
  arithmetic. A step counts as matched when the player's state matches Max's
  phase directly or 0.2s to either side (`REACTION_GRACE_S`), forgiving
  reaction lag at zone boundaries; phases shorter than `MIN_PHASE_S` in a
  window are left out. `totalScore` still averages the scoring rounds'
  rounded scores (equal round weight, practice excluded).
- **Zones**: the same walk is grouped into contiguous same-phase zones
  (`ZoneResult`: match fraction + the dominant wrong input) and into
  per-phase totals (`phaseAccuracy`), which feed the REM/LOS/GAS accuracy
  card and the tips.
- **History**: [storage.ts](../src/lib/storage.ts) persists the last attempt
  and the best run in localStorage (key `nos-rem-reflex:scores`); the intro
  shows the stored bests, the score card compares against them and tips the
  weakest corner of the current run.
- **Tips**: [tips.ts](../src/lib/tips.ts) turns a round's worst zone (≥0.5s
  long, match < 85%) into a specific Dutch instruction keyed on what the
  player mostly did instead ("je gaf nog gas waar Max al remt, rem eerder").
  The score card shows the weakest round's tip, and the per-round tips are
  saved with the run (`SavedRun.advice`) so the next play shows "Vorige
  keer: ..." on that corner's ready screen — the feedback loop that makes
  replaying feel like practicing.
- **Verbal (Dutch)**: `verdictForScore` buckets the round score into tones
  (≥90 perfect, ≥72 good, ≥45 okay, else bad) for the verdict banner.

## Accessibility

The game is fully keyboard-playable, with the keys behaving like pedals:
keydown presses, keyup releases, auto-repeat ignored. R/ArrowLeft hold the
brake, G/ArrowRight hold the gas (`aria-keyshortcuts` on the buttons).
Space only navigates the flow (intro, next corner) and never touches a
pedal — an earlier space-as-gas shortcut leaked presses into the next
screen; Enter activates the focused primary action. Space is
preventDefault-ed globally so a focused button never double-fires. On
`ready`, focus moves to the gas pedal. Three mechanisms keep Tab honest and
screen readers in sync:

- **`inert` on every hidden crossfade layer** (the `layer()` helper in
  App.tsx) - layers stay mounted for the fade animation, so without inert the
  invisible buttons would remain tabbable and invisible text would be read.
- **Focus follows the flow**: an effect moves focus to the primary action on
  each phase change (intro CTA -> start -> next -> share), so Tab/Enter always
  land somewhere sensible.
- **The info row is `aria-live="polite"`**, announcing hints and results;
  overlays are `role="dialog"` + `aria-modal` + `aria-labelledby`.

Buttons share nos.nl-style interactive states (`BTN_*` constants + the
`.focus-ring` utilities in index.css): 2px solid focus outline with 2px
offset - NOS red on light surfaces, ink on red CTAs, white on the pedals -
warm-gray/darker-red hover backgrounds, 150ms transitions, scale press
feedback. A held pedal tilts (the same perspective transform the old
`:active` state used) and shows a ring in its accent color; pointer capture
plus `onLostPointerCapture` guarantees a press can never stick.

## Brand palette

The whole app runs on three brand colors plus neutrals, declared as Tailwind
theme tokens in [index.css](../src/index.css):

| Token             | Value     | Used for                                                   |
| ----------------- | --------- | ---------------------------------------------------------- |
| `light-blue`      | `#3ca0ff` | the page surface, water                                    |
| `track-blue`      | `#284bbe` | the hatch lines on it, modal scrims, links, the car livery |
| `ink`             | `#1e1e1e` | all text, dark buttons, shadows, illustration outlines     |
| (NOS red, inline) | `#e61f15` | CTAs, curbs, the brake signal color                        |

Rules that keep it that way:

- **No third blue and no second black.** `ink` used to be a navy (`#0b1440`)
  and the hatch a darker blue (`#001189`); both are gone. A darker or lighter
  shade is expressed with **alpha over these colors**, never a new hex — the
  hatch is translucent light blue, the water is `rgba(60,160,255,0.72)` so the
  lakes stop out-glowing the car, and the pedal artwork's greys were
  re-neutralized so `#1e1e1e` is the darkest tone in it.
- **The page surface is dark, so page-level chrome is white, never ink.**
  White on `track-blue` is 7.3:1; ink would be 2.3:1. Translucency is fine
  here but has a floor: `white/85` is 5.8:1 and `white/75` 4.9:1 (both pass),
  while the `white/40` the keyboard hint used to carry was 2.5:1, and a
  `white/15` pill with `white/90` text (the old practice label) only 4.4:1 -
  that label is now an `ink/25` pill with white text at 9.3:1, still reading
  as secondary. Text on other surfaces states its own color: white on NOS red
  (4.6:1), ink on white cards (16.7:1), `track-blue` links on white (7.3:1).
  Only the hatch lines are allowed below AA (2.0:1) because they are texture,
  not text. **The surface has flipped once already** (light blue base with
  sport-blue lines), so if it flips again, re-check every `text-white*` and
  `text-ink*` on the page against the numbers above - contrast is the whole
  reason those two sets exist.
- **Scrims are blue, not black.** A `#1e1e1e` wash over the brand blue reads
  as slate grey; the modal backdrops use `bg-track-blue/80..85` instead.
- **Deliberate exceptions**, all outside the brand system: the Dutch flag
  keeps its official `#ae1c28`/`#21468b` (recoloring a national flag would be
  wrong), the scenery greys/sands/greens stay photo-sampled (see the
  Rendering section), and brake/coast/throttle keep their signal colors
  (`PHASE_COLOR`: red, amber, green) because they encode data, not brand.

## Layout invariants (portrait / landscape)

- **Portrait deck never resizes.** The info row and the action row under the
  stage have _fixed_ heights per breakpoint (`h-20`/`h-24` etc.), so the
  canvas doesn't jump when phases swap content (ready chips ↔ running hint ↔
  result). The round-result cards therefore overlay the **stage** on portrait
  (`wide:hidden` absolute layer at its bottom edge) instead of living in the
  deck; the deck copy of the cards is `hidden` + `wide:flex`.
- **Type floor: 14px on phones, 16px from `sm:` up.** Nothing renders below
  that anywhere, canvas labels included (map names 14px on a compact canvas
  and 17px otherwise, scale bar 16px). Dense or secondary chrome takes the
  14px step (`text-sm sm:text-base`): the legend, the round label, the stage
  practice badge, the accuracy bars' eyebrow/sublabels, the score card's round
  list and stat tiles, keycaps and section eyebrows. Primary copy keeps 16px
  everywhere: the deck hints, the intro paragraph, the explainer bullets and
  the score sentence. The floor is a floor, so where 16px genuinely did not
  fit the copy shortened rather than shrank, and some of that survives at
  14px because it also reads better: the legend uses `rem/los/gas` and
  `Max/jij` on phones (full words from `sm:`), the round label drops the
  corner name below 360px where it slid under the NOS badge (smaller there
  too), and the "Houd ingedrukt!" callout stays `sm:`-only because on phones
  it collided with the hint line and the pill above the pedals says the same
  thing. Corner-number badges are map pins rather than text and stay sized to
  their circles. Measured, not eyeballed: a probe walks every text node and
  reports the smallest rendered size (14px at 320/390, 16px at 1280).
- **The practice round marks the stage, not just the deck.** A yellow
  `OEFENBOCHT · telt niet mee` badge sits at the stage's top-left for the
  whole practice round: the deck label alone was missed because the player is
  looking at the circuit.
- **Controls are sized by their label.** `BTN_BASE` carries
  `mx-auto block w-fit max-w-full`, so every button hugs its text (the pill's
  rounded end starts right after the label) and still cannot outgrow a narrow
  phone. The verdict banner does the same with `w-fit` inside `inset-x-3`.
  Deliberately still full width: the accuracy **bars** (they are meters, the
  fill length is the data), the modal cards, and the two pedals (a hugged
  pedal would shrink the touch target that the whole game runs on). A pill
  that could wrap mid-phrase gets `whitespace-nowrap` plus room to sit on one
  line — see the "nieuw record!" badge, which stacks its stat tiles below
  360px rather than breaking in half.
- **The NOS badge outranks the modals.** It sits at `z-[60]`, above every
  dialog layer (`z-40`, score explainer `z-50`), so a backdrop never dims or
  blurs the brand, plus `pointer-events-none` so it can't swallow a click.
  The dialog containers therefore carry `pt-16 sm:pt-4`: a card taller than
  the viewport starts at the padding edge (auto margins resolve to 0 with
  negative free space), which on narrow phones put it straight under the
  badge. 64px clears the 52px badge; from `sm:` up the centered card is
  always right of it, so the normal `p-4` returns. Verified down to 320x568
  on the intro, final and explainer cards.
- **The wide side panel scrolls, never clips.** The panel is a flex column
  with `wide:overflow-y-auto` and _no_ `justify-center` (centering an
  overflowing flex container makes both ends unreachable), and the info row
  keeps `min-height: auto` so it can't shrink below its content — on a
  landscape phone that shrink is exactly what made the CTA overlap the
  result cards. The panel also carries `.scrollbar-hidden` (index.css):
  sub-pixel text heights leave it 1px "scrollable" on desktop, which macOS
  with always-visible scrollbars renders as a full useless track.
- **...vertically only.** The panel also carries `wide:overflow-x-clip`:
  `overflow-y: auto` silently makes the x-axis scrollable too, and with the
  scrollbars hidden a stray horizontal trackpad swipe left the panel stuck
  side-scrolled, clipping the pedals/CTA on the left. `clip` forbids all
  horizontal scrolling. Keep every panel child narrower than the panel
  (that's also why the wide accuracy card stacks its bars).

## Share flow

No backend: the whole run travels in the URL (`?r=<run token>`, typically
50-80 characters). The token packs, per round, the score plus the pedal
timeline quantized to 0.1s — one byte per pedal change (2 bits state, 6
bits time delta), see the byte layout in
[shareToken.ts](../src/lib/shareToken.ts). The receiving browser has the
full fixture baked in, so the landing card recomputes the sharer's overall
REM/LOS/GAS accuracy bars from the timeline (an earlier iteration also drew
their racelines on a mini SVG circuit; playtesting cut it — the bars carry
the message). The displayed scores come from the token itself, not from the
recompute, so the number on the card always matches what the sharer saw
(quantizing the timeline can shift a recomputed score by a point). Legacy
scores-only links (`?d=`) still decode into a plain card without visuals.
`share()` tries `navigator.share`, falls back to clipboard + a "Link
gekopieerd!" flash. Both token forms carry a tamper check and validate
against `fixture.rounds.length`, so malformed links fall through to the
normal game. Anyone who reads shareToken.ts can still forge a run — it's a
social share, not a leaderboard; don't build trust on it.

## Extension points, roughly in order of effort

- **Tune a round window or add a round**: edit `ROUND_DEFINITIONS` in the
  build script, re-run it, and check the printed timeline + events. The app
  adapts to any number of rounds and any (alternating) event count; only the
  "Bocht N van 3" copy in App.tsx assumes three scoring rounds.
- **New driver**: add a `DRIVER` entry (lap start timestamp + duration from
  OpenF1's `laps` endpoint), emit a second fixture, add a picker. The livery
  colors are baked into the car SVGs (`public/images/auto-zij.svg` and
  `auto-boven.svg`), so a second driver needs recolored copies of those.
- **Different circuit**: the pipeline generalizes (another f1-circuits
  GeoJSON + session key + corner anchors), but `CORNER_DEFINITIONS`
  meters-into-lap anchors are hand-tuned per circuit — budget time with the
  timeline printout.
- **Leaderboard/persistence**: would be the app's first backend/storage.
  Keep it out of `useCircuitGame`; wrap it around the `results` array at
  `finished`.
- **Ghost car / duel mode**: everything needed (full lap, one clock) is in
  the fixture already — a second `drawF1Car` at a time-shifted `t` is the
  core of it.

## Working with the hero/share art

- Both car illustrations live in `public/images` with the livery colors baked
  into the files: `auto-zij.svg` (side view, faces right in the file;
  [HeroCar.tsx](../src/components/HeroCar.tsx) mirrors it with a CSS
  transform because the game convention is nose-left) and `auto-boven.svg`
  (top-down, nose toward +x, drawn onto the canvas by `drawF1Car`). When
  swapping or recoloring either: keep explicit `width`/`height` attributes on
  the root `<svg>` (canvas `drawImage` of an SVG without them is unreliable
  across browsers), recolor by fill only, and verify by screenshotting the
  rendered app, not the raw file.
- `public/images/share.png` is flat art: `magick -strip -colors 64 PNG8:`
  gives ~80% size reduction with no visible loss; compare candidates before
  going lower (32 colors banded on the car shading).

## Verification workflow

For any change to the flow or scene: drive the real app, don't trust the
build. The pattern that works (see the session scratchpad's
`playthrough.mjs`): start `npm run dev`, script Playwright to play all four
rounds with **held keys** — derive Max's phase spans from the fixture's
telemetry channels (`brakeActive` / `throttle < 95`), start each round with
`keyboard.down('KeyG')`, then walk the spans with `keyboard.down`/`up` on
KeyR/KeyG about 120ms late (inside the 0.2s scoring grace) — screenshot
each phase, and look at the screenshots. A telemetry-mirroring run must
score 100 on every round; the two lazy strategies are part of the suite,
because they are what the scoring rules exist to punish: `STRATEGY=fullgas`
(hold gas, never brake) must land near 14 and `STRATEGY=nothing` (release
everything after the mandatory start press) near 29. If any of the three
drifts, the reaction grace, the geometric mean or the transition recording
broke. Two traps: layered UI
keeps hidden buttons in the DOM (`opacity-0` + `pointer-events-none`), so
Playwright's `visible` check passes early — gate on _clickability_, not
visibility (and match the pedals by `aria-label`, their text is just
"REM!"/"GAS!"); and Space advances the flow on `roundResult`, so drive the
pedals with KeyG/KeyR only and release every key at `tEnd`.

Hard-won additions to that pattern:

- **Drive the flow by state, not by sleeps.** Blind `waitForTimeout` +
  `Enter` chains desync after a few rounds (one missed press shifts every
  later one). Wait for the phase's button to leave its `inert` layer
  (`!btn.closest('[inert]')`), then click it.
- **Test mobile at three viewports**: 390×844 (portrait), 844×390
  (landscape phone), and a desktop size. For the no-jump guarantee, compare
  `getBoundingClientRect()` of the stage and the pedal deck across
  ready/running/result — they must be pixel-identical.
- **Screenshots race the 500ms layer crossfade**: a probe that fires the
  moment a phase flips captures mid-fade frames; settle ~800ms before
  screenshotting.
- **Seed localStorage to test persistence UI** (`nos-rem-reflex:scores`
  with a `SavedRun`) instead of playing a full prior game — but get the
  round ids from the fixture (`tarzan`, `hugenholtz`, `bocht9-10`,
  `hansernst`), don't guess them.

## Deployment (Vercel)

Still a 100%-static SPA — no functions, so Vercel's runtime dials (Fluid
Compute, Function CPU/Region, Cold Start Prevention) are inert; don't tune
them. `vercel.json` has the SPA rewrite + cache headers: hashed `/assets/*`
immutable for a year, `/images/*` 1 hour (`must-revalidate`) so replacing an
image under the same filename propagates fast. Skew Protection (Project
Settings) is worth enabling so an open tab doesn't 404 on old chunk hashes
after a redeploy. Node version (`.nvmrc`) only affects the build.
