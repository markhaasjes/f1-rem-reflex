import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pill } from './components/Brand';
import { CircuitScene } from './components/CircuitScene';
import { HeroCar } from './components/HeroCar';
import { NOSLogo } from './components/NOSLogo';
import fixtureJson from './data/zandvoort2025.json';
import { boxFromBounds, useCameraFlight, type CamBox } from './hooks/useCameraFlight';
import { useCircuitGame } from './hooks/useCircuitGame';
import { sampleAt } from './lib/corner';
import { combineResults, totalScore, type EventResult, type RoundResult } from './lib/scoring';
import type { GamePhase, ZandvoortFixture } from './types';

const fixture = fixtureJson as unknown as ZandvoortFixture;

const TONE_STYLES = {
  perfect: 'bg-emerald-500',
  good: 'bg-emerald-600',
  okay: 'bg-amber-500',
  bad: 'bg-red-600',
} as const;

const OVERVIEW_PAD_M = 90;
const ROUND_PAD_M = 55;

// Max's real team radio, played once on the final score screen (fetched by
// scripts/fetch-team-radio.mjs). The negative clip is optional: until a file
// exists at that path the weak-score result simply stays silent.
const RADIO_POSITIVE_SRC = '/audio/radio-positive.mp3';
const RADIO_NEGATIVE_SRC = '/audio/radio-negative.mp3';
const RADIO_POSITIVE_THRESHOLD = 60;

// Interactive states in the nos.nl style: warm-gray hover on light buttons,
// darker NOS red on red CTAs, 150ms ease transitions, scale press feedback,
// and a 2px offset focus outline (`.focus-ring` in index.css).
const BTN_BASE =
  'select-none touch-manipulation rounded-full font-extrabold shadow-lg transition-all duration-150 active:scale-95 focus-ring';
const BTN_LIGHT = `${BTN_BASE} bg-white text-ink hover:bg-[#f3f3f0] hover:scale-[1.02]`;
const BTN_RED = `${BTN_BASE} focus-ring-ink bg-[#e61e14] text-white hover:bg-[#ca1a11] hover:scale-[1.02]`;
const BTN_DARK = `${BTN_BASE} bg-ink text-white hover:bg-track-blue hover:scale-[1.02]`;

// A player mark phrased against Max's matching point. Positive delta = the
// player was later than Max. Dutch decimal comma.
function deltaSentence(distDeltaM: number, opts: { verb: string; suffix: string; perfect: string }): string {
  const meters = Math.round(distDeltaM);
  if (meters === 0) return opts.perfect;
  const direction = meters > 0 ? 'laat' : 'vroeg';
  return `${opts.verb} ${Math.abs(meters)}m te ${direction}${opts.suffix}`;
}

function buildShareUrl(total: number, results: RoundResult[]): string {
  const rounds = results.map((r) => r.score).join('.');
  return `${location.origin}${location.pathname}?s=${total}&r=${rounds}`;
}

// A score arriving via a shared link: ?s=<total>&r=<r0.r1.r2.r3>
function parseSharedScore(): { total: number; rounds: number[] } | null {
  const params = new URLSearchParams(location.search);
  const s = Number(params.get('s'));
  const rounds = (params.get('r') ?? '')
    .split('.')
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (!Number.isFinite(s) || rounds.length !== fixture.rounds.length) return null;
  return { total: Math.round(s), rounds: rounds.map(Math.round) };
}

function eventChipText(er: EventResult): string {
  const isBrake = er.event.type === 'brake';
  if (er.deltaM === null) return isBrake ? 'Niet geremd' : 'Geen gas gegeven';
  return deltaSentence(er.deltaM, {
    verb: isBrake ? 'Rem' : 'Gas',
    suffix: '',
    perfect: isBrake ? 'Rem: perfect!' : 'Gas: perfect!',
  });
}

function scoreSentence(total: number): string {
  if (total >= 90) return 'Wereldklasse - jij remt als Max zelf!';
  if (total >= 70) return 'Sterke ronde, bijna kwalificatie-waardig.';
  if (total >= 45) return 'Netjes! Maar Max rijdt nog wel even weg.';
  return 'De grindbak is goed gevuld vandaag.';
}

function App() {
  const game = useCircuitGame(fixture);
  const { phase, round, roundIndex, elapsedT, marks, results, nextEvent } = game;

  const overviewBox = useMemo<CamBox>(() => {
    const xs = fixture.trackOutline.map((p) => p.x);
    const ys = fixture.trackOutline.map((p) => p.y);
    return boxFromBounds(
      { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
      OVERVIEW_PAD_M,
    );
  }, []);
  const roundBoxes = useMemo<CamBox[]>(() => fixture.rounds.map((r) => boxFromBounds(r.bounds, ROUND_PAD_M)), []);

  // Visual-QA hook: ?corner=N starts the camera zoomed on corner N with the
  // intro chrome hidden, so Playwright can snapshot every corner in isolation.
  const debugCornerBox = useMemo<CamBox | null>(() => {
    const n = Number(new URLSearchParams(location.search).get('corner'));
    const corner = fixture.corners.find((c) => c.number === n);
    if (!corner) return null;
    return boxFromBounds({ minX: corner.x - 130, minY: corner.y - 130, maxX: corner.x + 130, maxY: corner.y + 130 }, 0);
  }, []);

  const camera = useCameraFlight(debugCornerBox ?? overviewBox);
  const [shared] = useState(parseSharedScore);
  const [showShared, setShowShared] = useState(shared !== null);
  const [copied, setCopied] = useState(false);
  const hideIntroChrome = showShared || debugCornerBox !== null;

  const isLastRound = roundIndex === fixture.rounds.length - 1;
  const scoringRoundNumber = fixture.rounds.filter((r, i) => i <= roundIndex && !r.practice).length;

  // --- flow handlers: game state + camera flight stay in lockstep ---
  const startGame = useCallback(() => {
    game.flyToRound(0);
    camera.fly([{ box: roundBoxes[0], ms: 1700 }], game.arm);
  }, [game, camera, roundBoxes]);

  const nextRound = useCallback(() => {
    const next = roundIndex + 1;
    game.flyToRound(next);
    camera.fly([{ box: overviewBox, ms: 1200 }, { ms: 300 }, { box: roundBoxes[next], ms: 1500 }], game.arm);
  }, [game, camera, roundIndex, overviewBox, roundBoxes]);

  // Max's real radio on the score reveal. Launched from the same click that
  // finishes the game, so autoplay policies treat it as user-initiated; a
  // missing file (negative clip pending) or blocked playback just stays quiet.
  const radioRef = useRef<HTMLAudioElement | null>(null);
  const stopRadio = useCallback(() => {
    radioRef.current?.pause();
    radioRef.current = null;
  }, []);

  const showFinal = useCallback(() => {
    game.finish();
    camera.fly([{ box: overviewBox, ms: 1400 }]);
    const score = totalScore(game.results);
    const audio = new Audio(score >= RADIO_POSITIVE_THRESHOLD ? RADIO_POSITIVE_SRC : RADIO_NEGATIVE_SRC);
    radioRef.current = audio;
    audio.play().catch(() => {});
  }, [game, camera, overviewBox]);

  const restart = useCallback(() => {
    stopRadio();
    setShowShared(false);
    history.replaceState(null, '', location.pathname);
    game.restart();
    camera.fly([{ box: overviewBox, ms: 900 }]);
  }, [game, camera, overviewBox, stopRadio]);

  // Space advances the flow; while running it presses the pedal Max needs
  // next. R/ArrowLeft and G/ArrowRight hit a specific pedal (like the
  // on-screen buttons). Space is preventDefault-ed, so a focused button never
  // double-fires; Enter activates the focused button natively.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (showShared) return;
      if (phase === 'running' && (event.code === 'KeyR' || event.code === 'ArrowLeft')) {
        event.preventDefault();
        game.press('brake');
        return;
      }
      if (phase === 'running' && (event.code === 'KeyG' || event.code === 'ArrowRight')) {
        event.preventDefault();
        game.press('gas');
        return;
      }
      if (event.code !== 'Space') return;
      event.preventDefault();
      if (phase === 'intro') startGame();
      else if (phase === 'ready') game.startRun();
      else if (phase === 'running' && nextEvent) game.press(nextEvent.type);
      else if (phase === 'roundResult') (isLastRound ? showFinal : nextRound)();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, showShared, game, nextEvent, startGame, nextRound, showFinal, isLastRound]);

  // Move keyboard focus along with the flow, so Tab/Enter always lands on the
  // primary action and screen-reader users follow the game without hunting.
  const introBtnRef = useRef<HTMLButtonElement>(null);
  const startBtnRef = useRef<HTMLButtonElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const sharedBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const byPhase: Partial<Record<GamePhase, React.RefObject<HTMLButtonElement | null>>> = {
      intro: introBtnRef,
      ready: startBtnRef,
      roundResult: nextBtnRef,
      finished: shareBtnRef,
    };
    const target = showShared ? sharedBtnRef : byPhase[phase];
    if (!target) return;
    // wait for the crossfade layer to become non-inert before focusing
    const id = setTimeout(() => target.current?.focus({ preventScroll: true }), 120);
    return () => clearTimeout(id);
  }, [phase, showShared]);

  const total = totalScore(results);

  const share = useCallback(async () => {
    const url = buildShareUrl(total, results);
    const text = `Ik scoorde ${total}/100 in NOS Rem Reflex - rem jij net zo laat als Max Verstappen op Zandvoort?`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'NOS Rem Reflex', text, url });
        return;
      }
    } catch {
      /* fall through to clipboard */
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [total, results]);

  // --- derived display state ---
  const liveSpeed = phase === 'running' ? Math.round(sampleAt(fixture.lap.samples, elapsedT).speedKph) : null;
  const lastResult = results.at(-1) ?? null;
  const showRoundResult = phase === 'roundResult' && lastResult !== null;
  const verdict = showRoundResult ? combineResults(lastResult.eventResults.map((r) => r.description)) : null;

  let roundLabel = '';
  if (phase !== 'intro' && phase !== 'finished') {
    roundLabel = round.practice ? `Oefenbocht · ${round.label}` : `Bocht ${scoringRoundNumber} van 3 · ${round.label}`;
  }

  let runningHint = 'Uitrijden...';
  if (nextEvent?.type === 'brake') runningHint = 'Wachten... rem op het juiste moment';
  else if (nextEvent?.type === 'gas') runningHint = 'Nu weer op het gas!';

  // A pedal dims (and truly disables) once the player has used it as often as
  // Max does this round.
  const pedalLeft = (type: 'brake' | 'gas') =>
    round.events.filter((e) => e.type === type).length - marks.filter((m) => m.type === type).length;
  const pedalClass = (type: 'brake' | 'gas', color: string) =>
    `flex-1 select-none touch-manipulation rounded-full px-4 py-5 text-2xl font-extrabold tracking-wide shadow-lg transition-all duration-150 hover:brightness-110 active:scale-95 focus-ring focus-ring-white sm:text-3xl ${color} ${
      phase === 'running' && pedalLeft(type) === 0 ? 'opacity-30' : ''
    } ${phase === 'running' && nextEvent?.type === type ? 'ring-4 ring-white/80' : ''}`;

  // Crossfading layers stay mounted for the animation, so hidden ones must be
  // `inert`: otherwise invisible buttons stay in the Tab order and invisible
  // text keeps getting read by screen readers.
  const layer = (visible: boolean, extra = '') => ({
    className: `col-start-1 row-start-1 transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-1'} ${extra}`,
    inert: !visible || undefined,
  });

  return (
    <>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-3 sm:px-6">
        <div className="bg-white px-[18px] pt-[12px] pb-[15px] rounded-b-[10px] shadow-[0_6px_24px_rgba(6,12,60,0.45)] inline-block">
          <NOSLogo className="w-12 h-auto text-white fill-current" />
        </div>
      </div>
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-track-blue px-3 py-5 text-white sm:gap-6 sm:px-6">
        <Pill className="gap-3 text-sm sm:text-base">{fixture.meta.circuit}</Pill>

        <div
          className={`rounded-full px-4 py-1 text-xs font-extrabold tracking-wide transition-opacity sm:text-sm ${roundLabel ? 'opacity-100' : 'opacity-0'} ${round?.practice ? 'bg-white/15 text-white/90' : 'bg-red-600 text-white'}`}
        >
          {roundLabel || '·'}
        </div>

        <main className="flex w-full max-w-md flex-col gap-3 sm:max-w-2xl lg:max-w-4xl">
          {/* Stage */}
          <div className="relative h-[24rem] w-full overflow-hidden rounded-3xl sm:h-[30rem] lg:h-[36rem]">
            <CircuitScene
              fixture={fixture}
              camBox={camera.box}
              phase={phase}
              round={round}
              roundIndex={roundIndex}
              elapsedT={elapsedT}
              marks={marks}
              showReference={phase === 'roundResult' || phase === 'finished'}
            />

            {/* live speed */}
            <div
              aria-hidden={liveSpeed === null}
              className={`absolute left-3 top-3 rounded-full bg-white/95 px-4 py-1.5 font-extrabold tabular-nums text-ink shadow transition-opacity duration-300 sm:text-lg ${liveSpeed === null ? 'opacity-0' : 'opacity-100'}`}
            >
              {liveSpeed ?? 0} km/u
            </div>

            {/* verdict banner (round result) */}
            <div
              inert={!verdict || undefined}
              className={`absolute inset-x-3 top-3 mx-auto max-w-md rounded-2xl px-5 py-3 text-center shadow-lg transition-all duration-500 ${verdict ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 -translate-y-2'} ${TONE_STYLES[verdict?.tone ?? 'okay']}`}
            >
              <h2 className="text-lg font-extrabold sm:text-xl">{verdict?.title}</h2>
              {lastResult && (
                <p className="text-sm text-white/90">
                  {round.practice ? 'Oefenbocht' : round.label}:{' '}
                  <span className="font-extrabold">{lastResult.score}</span>
                  /100 punten
                </p>
              )}
            </div>

            {/* intro modal */}
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="intro-title"
              inert={!(phase === 'intro' && !hideIntroChrome) || undefined}
              className={`absolute inset-0 grid place-items-center bg-ink/70 p-4 backdrop-blur-[3px] transition-all duration-500 ${phase === 'intro' && !hideIntroChrome ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            >
              <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center text-ink shadow-2xl sm:p-7">
                <HeroCar className="mx-auto h-9 w-auto sm:h-11" />
                <h1 id="intro-title" className="mt-4 text-xl font-extrabold leading-tight sm:text-2xl">
                  Rem jij net zo laat als <span className="text-[#e61e14]">Max Verstappen</span>?
                </h1>
                <p className="mt-2 text-sm font-bold leading-snug text-ink/70 sm:text-base">
                  Rijd zijn echte poleronde over Zandvoort. Eerst oefenen in de Tarzanbocht, daarna drie bochten voor de
                  punten: rem en geef weer gas op precies het juiste moment.
                </p>
                <button
                  ref={introBtnRef}
                  type="button"
                  onClick={startGame}
                  className={`${BTN_RED} mt-5 w-full px-6 py-4 text-lg`}
                >
                  Naar de Tarzanbocht
                </button>
              </div>
            </div>

            {/* final score card */}
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="final-title"
              inert={!(phase === 'finished' && !showShared) || undefined}
              className={`absolute inset-0 grid place-items-center bg-ink/60 backdrop-blur-[2px] transition-all duration-700 ${phase === 'finished' && !showShared ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            >
              <div className="mx-4 w-full max-w-sm rounded-3xl bg-white p-6 text-center text-ink shadow-2xl">
                <h2 id="final-title" className="text-sm font-extrabold uppercase tracking-wide text-[#e61e14]">
                  Jouw eindscore
                </h2>
                <p className="text-6xl font-extrabold tabular-nums">{total}</p>
                <p className="mb-3 text-sm font-bold text-ink/60">van de 100 punten</p>
                <p className="mb-4 text-sm font-bold">{scoreSentence(total)}</p>
                <ul className="mb-5 space-y-1 text-left text-sm font-bold">
                  {results.map((r) => (
                    <li key={r.round.id} className="flex justify-between gap-3">
                      <span className={r.round.practice ? 'text-ink/50' : ''}>
                        {r.round.practice ? `${r.round.label} (oefening, telt niet mee)` : r.round.label}
                      </span>
                      <span className="tabular-nums">{r.score}/100</span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col gap-2">
                  <button ref={shareBtnRef} type="button" onClick={share} className={`${BTN_RED} w-full px-6 py-3`}>
                    {copied ? 'Link gekopieerd!' : 'Deel je score'}
                  </button>
                  <button type="button" onClick={restart} className={`${BTN_DARK} w-full px-6 py-3`}>
                    Nog een keer
                  </button>
                </div>
              </div>
            </div>

            {/* shared-score landing (opened via a share link) */}
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="shared-title"
              inert={!showShared || undefined}
              className={`absolute inset-0 grid place-items-center bg-ink/60 backdrop-blur-[2px] transition-all duration-500 ${showShared ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            >
              <div className="mx-4 w-full max-w-sm rounded-3xl bg-white p-6 text-center text-ink shadow-2xl">
                <h2 id="shared-title" className="text-sm font-extrabold uppercase tracking-wide text-[#e61e14]">
                  Gedeelde score
                </h2>
                <p className="text-6xl font-extrabold tabular-nums">{shared?.total}</p>
                <p className="mb-3 text-sm font-bold text-ink/60">van de 100 punten</p>
                <p className="mb-5 text-sm font-bold">
                  Iemand daagt je uit: rem jij net zo laat als Max Verstappen op Zandvoort?
                </p>
                <button ref={sharedBtnRef} type="button" onClick={restart} className={`${BTN_RED} w-full px-6 py-3`}>
                  Speel zelf
                </button>
              </div>
            </div>
          </div>

          {/* info row */}
          <div aria-live="polite" className="grid min-h-14 place-items-center py-1 text-center sm:min-h-16">
            <p {...layer(phase === 'flying', 'text-sm font-extrabold text-white/85 sm:text-lg')}>
              Onderweg naar de {round.label}...
            </p>
            <div {...layer(phase === 'ready', 'flex flex-col items-center gap-1.5')}>
              <div className="flex items-center gap-2 rounded-full bg-white px-4 py-1.5 shadow-lg">
                <span className="rounded-full bg-[#e61e14] px-3 py-0.5 text-sm font-extrabold text-white sm:text-base">
                  {round.events.length / 2}&times; REM
                </span>
                <span className="font-extrabold text-ink/40">&middot;</span>
                <span className="rounded-full bg-emerald-500 px-3 py-0.5 text-sm font-extrabold text-white sm:text-base">
                  {round.events.length / 2}&times; GAS
                </span>
              </div>
              <p className="text-sm font-bold text-white/85 sm:text-base">
                {round.events.length / 2 === 1
                  ? 'Let op de bocht en druk op het juiste moment!'
                  : 'Een dubbele: let goed op waar Max remt en weer gas geeft!'}
              </p>
            </div>
            <p {...layer(phase === 'running', 'text-base font-extrabold sm:text-xl')}>{runningHint}</p>
            <div {...layer(showRoundResult, 'flex flex-wrap items-center justify-center gap-2 sm:gap-3')}>
              {lastResult?.eventResults.map((er) => (
                <span
                  key={er.event.t}
                  className="rounded-full bg-badge-blue px-3 py-1.5 text-xs font-extrabold text-white sm:px-4 sm:text-sm"
                >
                  {eventChipText(er)}
                </span>
              ))}
            </div>
          </div>

          {/* action row */}
          <div className="grid h-20 place-items-center sm:h-24">
            <button
              {...layer(phase === 'ready', `${BTN_LIGHT} w-full max-w-sm px-8 py-4 text-lg sm:text-xl`)}
              ref={startBtnRef}
              type="button"
              onClick={game.startRun}
            >
              {round.practice ? 'Start de oefenbocht' : `Start bocht ${scoringRoundNumber}`}
            </button>
            <div {...layer(phase === 'running', 'flex w-full max-w-sm gap-3')}>
              <button
                type="button"
                onClick={() => game.press('brake')}
                disabled={phase === 'running' && pedalLeft('brake') === 0}
                aria-keyshortcuts="r arrowleft"
                className={pedalClass('brake', 'bg-red-600')}
              >
                REM!
              </button>
              <button
                type="button"
                onClick={() => game.press('gas')}
                disabled={phase === 'running' && pedalLeft('gas') === 0}
                aria-keyshortcuts="g arrowright"
                className={pedalClass('gas', 'bg-emerald-500')}
              >
                GAS!
              </button>
            </div>
            <button
              {...layer(showRoundResult, `${BTN_LIGHT} w-full max-w-sm px-8 py-4 text-lg sm:text-xl`)}
              ref={nextBtnRef}
              type="button"
              onClick={isLastRound ? showFinal : nextRound}
            >
              {isLastRound ? 'Bekijk je eindscore' : 'Naar de volgende bocht'}
            </button>
          </div>

          {/* keyboard hint (pointer-fine devices only) */}
          <p className="hidden text-center text-xs font-bold text-white/40 sm:block">
            Toetsenbord: <kbd className="rounded bg-white/10 px-1.5 py-0.5">spatie</kbd> = actie ·{' '}
            <kbd className="rounded bg-white/10 px-1.5 py-0.5">R</kbd> = rem ·{' '}
            <kbd className="rounded bg-white/10 px-1.5 py-0.5">G</kbd> = gas
          </p>
        </main>

        <p className="text-center text-xs text-white/50">
          Echte data via OpenF1: {fixture.meta.sessionName} {fixture.meta.meetingName} {fixture.meta.year}, ronde{' '}
          {fixture.meta.lapNumber} van {fixture.meta.driverName}
        </p>
      </div>
    </>
  );
}

export default App;
