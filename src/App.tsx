import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pill } from './components/Brand';
import { CircuitScene } from './components/CircuitScene';
import { HeroCar } from './components/HeroCar';
import { NOSLogo } from './components/NOSLogo';
import fixtureJson from './data/zandvoort2025.json';
import { boxFromBounds, useCameraFlight, type CamBox } from './hooks/useCameraFlight';
import { useCircuitGame } from './hooks/useCircuitGame';
import { positionAt, sampleAt } from './lib/corner';
import {
  combineResults,
  totalScore,
  totalScoreFromRoundScores,
  type EventResult,
  type RoundResult,
} from './lib/scoring';
import { decodeShareToken, encodeShareToken } from './lib/shareToken';
import { loadScores, saveRun, type SavedRun, type SavedScores } from './lib/storage';
import { adviceForRound, adviceForRun } from './lib/tips';
import type { GamePhase, ZandvoortFixture } from './types';

const fixture = fixtureJson as unknown as ZandvoortFixture;

const TONE_STYLES = {
  perfect: 'bg-emerald-500',
  good: 'bg-emerald-600',
  okay: 'bg-amber-500',
  bad: 'bg-[#e61f15]',
} as const;

// Mirrors the `wide` Tailwind variant (landscape + >=48rem) for JS-side
// decisions like the mobile chase camera.
const WIDE_MEDIA_QUERY = '(orientation: landscape) and (min-width: 48rem)';

function useWideViewport(): boolean {
  const [isWide, setIsWide] = useState(() => matchMedia(WIDE_MEDIA_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(WIDE_MEDIA_QUERY);
    const onChange = () => setIsWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isWide;
}

const OVERVIEW_PAD_M = 90;
const OVERVIEW_SEA_PAD_M = 190;
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
const BTN_LIGHT = `${BTN_BASE} focus-ring-dark bg-white text-ink hover:bg-[#f3f3f0] hover:scale-[1.02]`;
const BTN_RED = `${BTN_BASE} focus-ring-ink bg-[#e61f15] text-white hover:bg-[#ca1a11] hover:scale-[1.02]`;
const BTN_DARK = `${BTN_BASE} bg-ink text-white hover:bg-track-blue hover:scale-[1.02]`;

// The total isn't carried in the URL at all, and the per-round scores are
// packed into one opaque token rather than sitting in the URL as plain,
// readable numbers - see lib/shareToken.ts.
function buildShareUrl(results: RoundResult[]): string {
  const token = encodeShareToken(results.map((r) => r.score));
  return `${location.origin}${location.pathname}?d=${token}`;
}

// A score arriving via a shared link: ?d=<encodeShareToken output>. The
// token's tamper check must match, so hand-editing it (or forging one
// without reading lib/shareToken.ts) invalidates the link - it's then
// treated the same as no shared score.
function parseSharedScore(): { total: number; rounds: number[] } | null {
  const token = new URLSearchParams(location.search).get('d');
  if (!token) return null;
  const roundScores = decodeShareToken(token);
  if (!roundScores || roundScores.length !== fixture.rounds.length) return null;
  return { total: totalScoreFromRoundScores(fixture.rounds, roundScores), rounds: roundScores };
}

// How far the gauge scale reaches on either side of Max's point.
const GAUGE_RANGE_M = 25;

const TONE_DOT: Record<EventResult['description']['tone'], string> = {
  perfect: '#10b981',
  good: '#22c55e',
  okay: '#f59e0b',
  bad: '#e61f15',
};

// One brake/gas moment, visualized: a gauge with Max's point as the center
// tick and the player's press as a colored dot early (left) or late (right)
// of it, with the distance and time gaps spelled out.
function EventResultCard({ er }: { er: EventResult }) {
  const isBrake = er.event.type === 'brake';
  const label = isBrake ? 'REM' : 'GAS';
  const accent = isBrake ? '#e61f15' : '#10b981';

  if (er.deltaM === null || er.mark === null) {
    return (
      <div className="w-40 rounded-2xl bg-white px-3 py-2 text-left shadow-lg sm:w-44">
        <span className="text-xs font-extrabold" style={{ color: accent }}>
          {label}
        </span>
        <p className="text-xs font-extrabold text-[#1e1e1e]">{isBrake ? 'Niet geremd' : 'Geen gas gegeven'}</p>
      </div>
    );
  }

  const late = er.deltaM > 0;
  const meters = Math.abs(Math.round(er.deltaM));
  let deltaLabel = 'perfect!';
  if (meters > 0) {
    deltaLabel = `${meters}m ${late ? 'te laat' : 'te vroeg'}`;
  }
  const seconds = Math.abs(er.mark.t - er.event.t)
    .toFixed(2)
    .replace('.', ',');
  const dotPercent = 50 + (Math.max(-GAUGE_RANGE_M, Math.min(GAUGE_RANGE_M, er.deltaM)) / GAUGE_RANGE_M) * 50;

  return (
    <div className="w-40 rounded-2xl bg-white px-3 pb-2 pt-1.5 shadow-lg sm:w-44">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-extrabold" style={{ color: accent }}>
          {label}
        </span>
        <span className="text-xs font-extrabold text-[#1e1e1e]">{deltaLabel}</span>
      </div>
      <div className="relative mt-1.5 h-2 rounded-full bg-[#ececec]">
        <span className="absolute left-1/2 top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-[#1e1e1e]/50" />
        <span
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${dotPercent}%`, backgroundColor: TONE_DOT[er.description.tone] }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-[#1e1e1e]/45">
        <span>te vroeg</span>
        <span className="text-[11px] font-extrabold tabular-nums text-[#1e1e1e]/75">{seconds}s</span>
        <span>te laat</span>
      </div>
    </div>
  );
}

// A sim-racing style pedal (carbon face plate, metal pivot, spring on the
// throttle), modeled on real F1 pedal sets. Pressing tilts the pedal like the
// real thing; the pedal Max needs next gets a white ring.
function Pedal({
  variant,
  onPress,
  disabled,
  highlight,
}: {
  variant: 'brake' | 'gas';
  onPress: () => void;
  disabled: boolean;
  highlight: boolean;
}) {
  const isBrake = variant === 'brake';
  const accent = isBrake ? '#e61f15' : '#10b981';
  const face = isBrake ? { x: 10, y: 26, w: 100, h: 72 } : { x: 24, y: 10, w: 72, h: 92 };
  const gripYs = isBrake ? [48, 62, 76] : [36, 52, 68, 84];
  const id = `pedal-${variant}`;

  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-keyshortcuts={isBrake ? 'r arrowleft' : 'g arrowright'}
      aria-label={isBrake ? 'Rempedaal (toets R)' : 'Gaspedaal (toets G)'}
      className={`group flex-1 select-none touch-manipulation rounded-2xl pb-1 pt-2 transition-all duration-150 focus-ring focus-ring-white ${
        disabled ? 'opacity-50 saturate-50' : 'hover:-translate-y-0.5'
      } ${highlight ? 'ring-4 ring-white/80' : ''}`}
    >
      <svg
        viewBox="0 0 120 200"
        aria-hidden="true"
        className={`mx-auto h-16 w-auto drop-shadow-[0_6px_10px_rgba(6,12,60,0.5)] transition-transform duration-100 sm:h-28 wide:h-[clamp(6rem,30vh,10rem)] ${
          disabled ? '' : 'group-active:[transform:perspective(360px)_rotateX(22deg)] group-active:origin-bottom'
        }`}
      >
        <defs>
          <pattern id={`${id}-carbon`} width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#1e1f24" />
            <rect width="3" height="3" fill="#2a2b31" />
            <rect x="3" y="3" width="3" height="3" fill="#2a2b31" />
          </pattern>
          <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#b9bcc4" />
            <stop offset="0.5" stopColor="#eef0f4" />
            <stop offset="1" stopColor="#8f939c" />
          </linearGradient>
        </defs>

        {/* base bracket */}
        <rect x="26" y="178" width="68" height="16" rx="4" fill="#26272c" />
        <rect x="26" y="178" width="68" height="4" rx="2" fill="#3a3b42" />
        <circle cx="37" cy="186" r="2.6" fill={`url(#${id}-metal)`} />
        <circle cx="83" cy="186" r="2.6" fill={`url(#${id}-metal)`} />

        {/* throttle spring + linkage, like the real assembly */}
        {!isBrake && (
          <g>
            <rect x="99" y="112" width="5" height="54" rx="2.5" fill={`url(#${id}-metal)`} />
            <path
              d="M 96 118 h 11 M 95 126 h 13 M 94 134 h 15 M 95 142 h 13 M 96 150 h 11 M 97 158 h 9"
              stroke="#6b6e77"
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            />
          </g>
        )}

        {/* arm */}
        <path
          d={isBrake ? 'M 46 92 L 74 92 L 80 180 L 40 180 Z' : 'M 49 98 L 71 98 L 77 180 L 43 180 Z'}
          fill={`url(#${id}-carbon)`}
          stroke="#111216"
          strokeWidth="2"
        />
        {/* pivot */}
        <circle cx="60" cy={isBrake ? 132 : 136} r="8" fill={`url(#${id}-metal)`} stroke="#43454c" strokeWidth="1.5" />
        <circle cx="60" cy={isBrake ? 132 : 136} r="3" fill="#565962" />

        {/* face plate */}
        <rect
          x={face.x}
          y={face.y}
          width={face.w}
          height={face.h}
          rx="10"
          fill={`url(#${id}-carbon)`}
          stroke="#0d0e12"
          strokeWidth="2.5"
        />
        {/* accent strip along the top edge */}
        <rect x={face.x + 7} y={face.y + 6} width={face.w - 14} height="5" rx="2.5" fill={accent} />
        {/* grip bars */}
        {gripYs.map((y) => (
          <rect key={y} x={face.x + 12} y={y} width={face.w - 24} height="6" rx="3" fill="#3b3d45" />
        ))}
        {/* corner bolts */}
        {[
          [face.x + 9, face.y + 9],
          [face.x + face.w - 9, face.y + 9],
          [face.x + 9, face.y + face.h - 9],
          [face.x + face.w - 9, face.y + face.h - 9],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" fill={`url(#${id}-metal)`} stroke="#43454c" />
        ))}
      </svg>
      <span
        className="mt-1 block text-center text-xs font-extrabold tracking-widest sm:text-sm wide:text-base"
        style={{ color: accent }}
      >
        {isBrake ? 'REM!' : 'GAS!'}
      </span>
      <span aria-hidden="true" className="mt-1 hidden items-center justify-center gap-1 sm:flex">
        <Key>{isBrake ? 'R' : 'G'}</Key>
        <Key>{isBrake ? '\u2190' : '\u2192'}</Key>
      </span>
    </button>
  );
}

// Circular Dutch flag, like the country flags in the NOS GP graphics.
function DutchFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 60" aria-hidden="true" className={className}>
      <circle cx="30" cy="30" r="30" fill="#ffffff" />
      <clipPath id="flag-clip">
        <circle cx="30" cy="30" r="26" />
      </clipPath>
      <g clipPath="url(#flag-clip)">
        <rect x="4" y="4" width="52" height="17.4" fill="#ae1c28" />
        <rect x="4" y="21.4" width="52" height="17.4" fill="#ffffff" />
        <rect x="4" y="38.8" width="52" height="17.4" fill="#21468b" />
      </g>
    </svg>
  );
}

// Event header in the NOS GP-graphic style (flag, white title pill, dark
// sub-pill). Lives in the control panel on wide screens.
function EventCard({ roundLabel }: { roundLabel: string }) {
  return (
    <div className="hidden flex-col items-center gap-3 wide:flex">
      <DutchFlag className="h-14 w-14 drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)]" />
      <div className="rounded-full bg-white px-7 py-2 text-xl font-extrabold text-[#1e1e1e] shadow-lg xl:text-2xl">
        Circuit Zandvoort
      </div>
      <div
        className={`rounded-full bg-[#1e1e1e] px-5 py-1.5 text-sm font-extrabold text-white shadow transition-opacity ${roundLabel ? 'opacity-100' : 'opacity-0'}`}
      >
        {roundLabel || '\u00b7'}
      </div>
    </div>
  );
}

// Visual keycap for the keyboard explainer in the intro modal.
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block min-w-7 rounded-md border border-ink/15 bg-white px-1.5 py-0.5 text-center text-xs font-extrabold text-ink shadow-[0_2px_0_rgba(11,20,64,0.15)]">
      {children}
    </kbd>
  );
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
    // extra room on the west so the sea and beach show at the overview,
    // like the satellite view with the coast on the left edge
    return boxFromBounds(
      {
        minX: Math.min(...xs) - OVERVIEW_SEA_PAD_M,
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      },
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
  // The player's history, persisted in localStorage (this game's "cookie"):
  // the last attempt and the best run. runContext freezes what the history
  // looked like BEFORE this run was saved, for the score-card comparison.
  const [savedScores, setSavedScores] = useState<SavedScores>(loadScores);
  const [runContext, setRunContext] = useState<{ previousLast: SavedRun | null; isNewBest: boolean } | null>(null);
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

    const previous = loadScores();
    const run: SavedRun = {
      total: score,
      rounds: Object.fromEntries(game.results.map((r) => [r.round.id, r.score])),
      advice: adviceForRun(game.results),
      date: new Date().toISOString(),
    };
    setSavedScores(saveRun(run));
    setRunContext({
      previousLast: previous.last,
      isNewBest: !previous.best || score > previous.best.total,
    });
  }, [game, camera, overviewBox]);

  const restart = useCallback(() => {
    stopRadio();
    setShowShared(false);
    setRunContext(null);
    history.replaceState(null, '', location.pathname);
    game.restart();
    camera.fly([{ box: overviewBox, ms: 900 }]);
  }, [game, camera, overviewBox, stopRadio]);

  // On phones the corner overview leaves the circuit small, so while running
  // the camera rides with the car at a tighter zoom; once the round is scored
  // it flies back out so the whole driven line is visible again. Wide layouts
  // keep the static corner framing.
  const isWide = useWideViewport();
  const elapsedTRef = useRef(elapsedT);
  elapsedTRef.current = elapsedT;
  // Depends on the hook's stable callbacks, NOT the camera object: that object
  // is rebuilt every frame while the camera moves, which would restart the
  // zoom-out flight on every render and it would never land.
  const { follow: cameraFollow, fly: cameraFly, jumpTo: cameraJumpTo } = camera;
  useEffect(() => {
    if (phase === 'running' && !isWide) {
      const base = roundBoxes[roundIndex];
      const size = { w: Math.max(base.w * 0.55, 230), h: Math.max(base.h * 0.55, 230) };
      cameraFollow(() => {
        const p = positionAt(fixture.lap.samples, elapsedTRef.current);
        return { cx: p.x, cy: p.y, ...size };
      });
    } else if (phase === 'running' && isWide) {
      // rotated to landscape mid-run: drop the chase cam
      cameraJumpTo(roundBoxes[roundIndex]);
    } else if (phase === 'roundResult' && !isWide) {
      cameraFly([{ box: roundBoxes[roundIndex], ms: 900 }]);
    }
  }, [phase, isWide, cameraFollow, cameraFly, cameraJumpTo, roundBoxes, roundIndex]);

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
  // What went wrong at this corner last time, shown while the round is armed.
  const lastRoundAdvice = savedScores.last?.advice?.[round.id] ?? null;
  // The corner with the most points left on the table this run.
  const improvementTip =
    phase === 'finished'
      ? results
          .filter((r) => !r.round.practice)
          .reduce<RoundResult | null>((weakest, r) => {
            if (!weakest || r.score < weakest.score) return r;
            return weakest;
          }, null)
      : null;

  const share = useCallback(async () => {
    const url = buildShareUrl(results);
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

  // Crossfading layers stay mounted for the animation, so hidden ones must be
  // `inert`: otherwise invisible buttons stay in the Tab order and invisible
  // text keeps getting read by screen readers.
  const layer = (visible: boolean, extra = '') => ({
    className: `col-start-1 row-start-1 transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-1'} ${extra}`,
    inert: !visible || undefined,
  });

  return (
    <>
      <div className="absolute top-0 left-4 z-10 sm:left-8 wide:left-10">
        <div className="bg-white px-[18px] pt-[12px] pb-[15px] rounded-b-[10px] shadow-[0_6px_24px_rgba(6,12,60,0.45)] inline-block">
          <NOSLogo className="w-12 h-auto text-white fill-current" />
        </div>
      </div>
      <div className="bg-carbon flex h-svh flex-col items-center gap-3 overflow-hidden px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white sm:gap-4 sm:px-8 sm:pt-5 wide:px-10">
        <Pill className="gap-3 text-sm wide:hidden sm:text-base">{fixture.meta.circuit}</Pill>

        <div
          className={`rounded-full px-4 py-1 text-xs font-extrabold tracking-wide transition-opacity wide:hidden sm:text-sm ${roundLabel ? 'opacity-100' : 'opacity-0'} ${round?.practice ? 'bg-white/15 text-white/90' : 'bg-[#e61f15] text-white'}`}
        >
          {roundLabel || '·'}
        </div>

        <main className="flex min-h-0 w-full max-w-md flex-1 flex-col gap-3 sm:max-w-2xl lg:max-w-4xl wide:grid wide:w-full wide:max-w-none wide:grid-cols-[minmax(0,1fr)_minmax(19rem,24rem)] wide:items-stretch wide:gap-6">
          {/* Stage */}
          <div className="relative min-h-[13rem] w-full flex-1 overflow-hidden rounded-3xl wide:h-full wide:min-h-[22rem]">
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
              className={`absolute bottom-3 right-3 rounded-full bg-white/95 px-4 py-1.5 font-extrabold tabular-nums text-ink shadow transition-opacity duration-300 sm:text-lg ${liveSpeed === null ? 'opacity-0' : 'opacity-100'}`}
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

            {/* round result: on portrait the cards overlay the stage, so the deck below never changes height */}
            <div
              inert={!showRoundResult || undefined}
              className={`absolute inset-x-2 bottom-2 flex flex-wrap items-center justify-center gap-2 transition-all duration-500 wide:hidden ${showRoundResult ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'}`}
            >
              {lastResult?.eventResults.map((er) => (
                <EventResultCard key={er.event.t} er={er} />
              ))}
            </div>
          </div>

          {/* info row */}
          {/* control panel: below the stage in portrait, right column on wide */}
          <div className="scrollbar-hidden contents wide:flex wide:min-h-0 wide:flex-col wide:gap-[clamp(0.75rem,3vh,1.75rem)] wide:overflow-y-auto wide:px-1.5">
            <EventCard roundLabel={roundLabel} />
            <div
              aria-live="polite"
              className="grid h-20 place-items-center py-1 text-center sm:h-24 wide:h-auto wide:flex-1"
            >
              <p {...layer(phase === 'flying', 'text-sm font-extrabold text-white/85 sm:text-lg')}>
                Onderweg naar de {round.label}...
              </p>
              <div {...layer(phase === 'ready', 'flex flex-col items-center gap-3')}>
                <div className="flex items-center gap-2 rounded-full bg-white px-4 py-1.5 shadow-lg">
                  <span className="rounded-full bg-[#e61f15] px-3 py-0.5 text-sm font-extrabold text-white sm:text-base">
                    {round.events.length / 2}&times; REM
                  </span>
                  <span className="font-extrabold text-ink/40">&middot;</span>
                  <span className="rounded-full bg-emerald-500 px-3 py-0.5 text-sm font-extrabold text-white sm:text-base">
                    {round.events.length / 2}&times; GAS
                  </span>
                </div>
                {lastRoundAdvice ? (
                  <p className="text-xs font-bold text-white sm:text-base">
                    <span className="mr-1.5 rounded-full bg-[#ffc828] px-2 py-0.5 align-middle text-[10px] font-extrabold text-[#1e1e1e]">
                      TIP
                    </span>
                    Vorige keer: {lastRoundAdvice}
                  </p>
                ) : (
                  <p className="text-xs font-bold text-white/85 sm:text-base">
                    {round.practice && 'Rem bij het rode punt en geef weer gas bij het groene punt!'}
                    {!round.practice &&
                      (round.events.length / 2 === 1
                        ? 'Let op de bocht en druk op het juiste moment!'
                        : 'Een dubbele: let goed op waar Max remt en weer gas geeft!')}
                  </p>
                )}
              </div>
              <p {...layer(phase === 'running', 'text-base font-extrabold sm:text-xl')}>{runningHint}</p>
              <div {...layer(showRoundResult, 'hidden flex-wrap items-center justify-center gap-2 wide:flex sm:gap-3')}>
                {lastResult?.eventResults.map((er) => (
                  <EventResultCard key={er.event.t} er={er} />
                ))}
              </div>
            </div>

            {/* action row */}
            <div className="grid h-24 place-items-center sm:h-44 wide:h-auto wide:min-h-[clamp(6rem,34vh,14rem)]">
              <button
                {...layer(phase === 'ready', `${BTN_LIGHT} w-full max-w-sm px-8 py-4 text-lg sm:text-xl`)}
                ref={startBtnRef}
                type="button"
                onClick={game.startRun}
              >
                {round.practice ? 'Start de oefenbocht' : `Start bocht ${scoringRoundNumber}`}
              </button>
              <div {...layer(phase === 'running', 'flex w-full max-w-sm gap-4 wide:gap-6')}>
                <Pedal
                  variant="brake"
                  onPress={() => game.press('brake')}
                  disabled={nextEvent?.type !== 'brake'}
                  highlight={phase === 'running' && nextEvent?.type === 'brake'}
                />
                <Pedal
                  variant="gas"
                  onPress={() => game.press('gas')}
                  disabled={nextEvent?.type !== 'gas'}
                  highlight={phase === 'running' && nextEvent?.type === 'gas'}
                />
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
          </div>
        </main>

        {/* intro modal */}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="intro-title"
          inert={!(phase === 'intro' && !hideIntroChrome) || undefined}
          className={`fixed inset-0 z-40 backdrop-carbon flex overflow-y-auto bg-ink/70 p-4 backdrop-blur-[3px] transition-all duration-500 ${phase === 'intro' && !hideIntroChrome ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <div className="m-auto w-full max-w-sm rounded-3xl bg-white p-6 text-center text-ink shadow-2xl sm:p-7">
            <HeroCar className="mx-auto h-9 w-auto sm:h-11" />
            <h1 id="intro-title" className="mt-4 text-xl font-normal leading-tight text-[#1e1e1e] sm:text-2xl">
              Rem jij net zo laat als <span className="font-extrabold">Max Verstappen</span>?
            </h1>
            <p className="mt-2 text-sm font-bold leading-snug text-ink/70 sm:text-base">
              Rijd zijn echte poleronde over Zandvoort. Eerst oefenen in de Tarzanbocht, daarna drie bochten voor de
              punten: rem en geef weer gas op precies het juiste moment.
            </p>
            {savedScores.best && (
              <p className="mt-3 text-sm font-extrabold text-[#1e1e1e]">
                Jouw beste score: <span className="tabular-nums text-[#e61f15]">{savedScores.best.total}</span>
                {savedScores.last && savedScores.last.total !== savedScores.best.total && (
                  <span className="text-[#1e1e1e]/60">
                    {' '}
                    &middot; vorige poging: <span className="tabular-nums">{savedScores.last.total}</span>
                  </span>
                )}
              </p>
            )}
            {/* keyboard explainer: desktop only - most players are on touch */}
            <div className="mt-4 hidden rounded-2xl bg-[#f3f3f0] p-3.5 text-left sm:block">
              <p className="text-xs font-extrabold uppercase tracking-wide text-ink/50">Speel met je toetsenbord</p>
              <dl className="mt-2 flex flex-col gap-1.5 text-sm font-bold text-ink/80">
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[#e61f15]" />
                    Remmen
                  </dt>
                  <dd className="flex gap-1">
                    <Key>R</Key>
                    <Key>&larr;</Key>
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    Gas geven
                  </dt>
                  <dd className="flex gap-1">
                    <Key>G</Key>
                    <Key>&rarr;</Key>
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-badge-blue" />
                    Verder / actie
                  </dt>
                  <dd>
                    <Key>spatie</Key>
                  </dd>
                </div>
              </dl>
            </div>
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
          className={`fixed inset-0 z-40 backdrop-carbon flex overflow-y-auto bg-ink/60 p-4 backdrop-blur-[2px] transition-all duration-700 ${phase === 'finished' && !showShared ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <div className="m-auto w-full max-w-sm rounded-3xl bg-white p-6 text-center text-ink shadow-2xl">
            <h2 id="final-title" className="text-sm font-extrabold uppercase tracking-wide text-[#e61f15]">
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
                  <span className={`tabular-nums ${r.round.practice ? 'text-ink/50' : ''}`}>{r.score}/100</span>
                </li>
              ))}
            </ul>
            {runContext && savedScores.best && (
              <div className="mb-3 grid grid-cols-2 gap-2 text-left">
                <div className="rounded-2xl bg-[#f3f3f0] px-3 py-2">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-[#1e1e1e]/50">Beste score</p>
                  <p className="text-xl font-extrabold tabular-nums text-[#1e1e1e]">
                    {savedScores.best.total}
                    {runContext.isNewBest && (
                      <span className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 align-middle text-[10px] font-extrabold text-white">
                        nieuw record!
                      </span>
                    )}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#f3f3f0] px-3 py-2">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-[#1e1e1e]/50">Vorige poging</p>
                  <p className="text-xl font-extrabold tabular-nums text-[#1e1e1e]">
                    {runContext.previousLast ? runContext.previousLast.total : '\u2014'}
                  </p>
                </div>
              </div>
            )}
            {improvementTip && (
              <p className="mb-4 text-xs font-bold text-[#1e1e1e]/70">
                Tip: in de <span className="font-extrabold">{improvementTip.round.label}</span>
                {adviceForRound(improvementTip)
                  ? `: ${adviceForRound(improvementTip)} (${improvementTip.score}/100).`
                  : ` valt de meeste winst te halen (${improvementTip.score}/100).`}
              </p>
            )}
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
          className={`fixed inset-0 z-40 backdrop-carbon flex overflow-y-auto bg-ink/60 p-4 backdrop-blur-[2px] transition-all duration-500 ${showShared ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <div className="m-auto w-full max-w-sm rounded-3xl bg-white p-6 text-center text-ink shadow-2xl">
            <h2 id="shared-title" className="text-sm font-extrabold uppercase tracking-wide text-[#e61f15]">
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
    </>
  );
}

export default App;
