import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pill } from './components/Brand';
import { CircuitScene } from './components/CircuitScene';
import { HeroCar } from './components/HeroCar';
import { NOSLogo } from './components/NOSLogo';
import fixtureJson from './data/zandvoort2025.json';
import { boxFromBounds, useCameraFlight, type CamBox } from './hooks/useCameraFlight';
import { useCircuitGame } from './hooks/useCircuitGame';
import { positionAt, sampleAt } from './lib/corner';
import type { DrivingPhase } from './lib/phases';
import { PHASE_COLOR } from './lib/scene';
import {
  aggregatePhaseAccuracy,
  phasePercent,
  scoreRound,
  totalScore,
  totalScoreFromRoundScores,
  verdictForScore,
  type RoundResult,
} from './lib/scoring';
import { decodeRunToken, decodeShareToken, encodeRunToken } from './lib/shareToken';
import { loadScores, saveRun, type SavedRun, type SavedScores } from './lib/storage';
import { adviceForRound, adviceForRun } from './lib/tips';
import type { GamePhase, GameRound, InputTransition, ZandvoortFixture } from './types';

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

// Interactive states in the nos.nl style: warm-gray hover on light buttons,
// darker NOS red on red CTAs, 150ms ease transitions, scale press feedback,
// and a 2px offset focus outline (`.focus-ring` in index.css).
const BTN_BASE =
  'select-none touch-manipulation rounded-full font-extrabold shadow-lg transition-all duration-150 active:scale-95 focus-ring';
const BTN_LIGHT = `${BTN_BASE} focus-ring-dark bg-white text-ink hover:bg-[#f3f3f0] hover:scale-[1.02]`;
const BTN_RED = `${BTN_BASE} focus-ring-ink bg-[#e61f15] text-white hover:bg-[#ca1a11] hover:scale-[1.02]`;
const BTN_DARK = `${BTN_BASE} bg-ink text-white hover:bg-track-blue hover:scale-[1.02]`;

// The share link carries the sharer's whole run - per-round scores plus the
// pedal timelines, packed into one short opaque token (~80 characters, see
// lib/shareToken.ts) - so the landing card can redraw their racelines and
// accuracy bars without a backend. The total isn't carried at all; it is
// recomputed from the round scores like everywhere else.
function buildShareUrl(results: RoundResult[]): string {
  const token = encodeRunToken(
    results.map((result) => ({
      score: result.score,
      transitions: result.transitions.map((t) => ({ offsetS: t.t - result.round.tStart, input: t.input })),
    })),
  );
  return `${location.origin}${location.pathname}?r=${token}`;
}

/** One shared round on the local clock: the window plus the sharer's timeline. */
interface SharedRoundRun {
  round: GameRound;
  transitions: InputTransition[];
}

interface SharedScore {
  total: number;
  rounds: number[];
  /** The sharer's pedal timelines (run links only; legacy links carry none). */
  runs: SharedRoundRun[] | null;
}

// A score arriving via a shared link: ?r=<run token> (current) or
// ?d=<scores-only token> (legacy links from before the run token existed).
// Both carry a tamper check, so hand-editing the URL invalidates the link -
// it's then treated the same as no shared score.
function parseSharedScore(): SharedScore | null {
  const params = new URLSearchParams(location.search);

  const runToken = params.get('r');
  const decodedRun = runToken ? decodeRunToken(runToken) : null;
  if (decodedRun && decodedRun.length === fixture.rounds.length) {
    const runs = decodedRun.map((sharedRound, i) => {
      const round = fixture.rounds[i];
      return {
        round,
        transitions: sharedRound.transitions.map((t) => ({
          t: round.tStart + Math.min(t.offsetS, round.tEnd - round.tStart),
          input: t.input,
        })),
      };
    });
    const roundScores = decodedRun.map((sharedRound) => sharedRound.score);
    return { total: totalScoreFromRoundScores(fixture.rounds, roundScores), rounds: roundScores, runs };
  }

  const legacyToken = params.get('d');
  if (!legacyToken) return null;
  const roundScores = decodeShareToken(legacyToken);
  if (!roundScores || roundScores.length !== fixture.rounds.length) return null;
  return { total: totalScoreFromRoundScores(fixture.rounds, roundScores), rounds: roundScores, runs: null };
}

// Display config for the three driving phases, in pedal order: brake on the
// left like the REM pedal, full throttle on the right like the GAS pedal.
const PHASE_ROWS: { phase: DrivingPhase; label: string; sublabel: string; color: string }[] = [
  { phase: 'brake', label: 'REM', sublabel: 'remmen', color: '#e61f15' },
  { phase: 'coast', label: 'LOS', sublabel: 'uitrollen', color: '#f2a11c' },
  { phase: 'flat', label: 'GAS', sublabel: 'vol gas', color: '#10b981' },
];

// How well the player matched each of Max's three pedal states, as one card
// with an accuracy bar per phase: "van de tijd dat Max remt, zat jij X% ook
// op de rem". Phases Max never uses in the window are left out. Two layouts:
// `row` puts the three bars side by side (compact, for the phone deck),
// `stack` puts them under each other with bigger bars (the wide side panel -
// which also keeps the card narrower than the panel, so it can never force
// the panel to overflow sideways).
function accuracyRows(accuracy: RoundResult['phaseAccuracy']) {
  return PHASE_ROWS.map((row) => ({ ...row, percent: phasePercent(accuracy[row.phase]) })).filter(
    (row) => accuracy[row.phase].totalS > 0.1,
  );
}

// The stacked bars themselves, without card chrome: the wide round-result
// card and the shared-score landing both render these.
function AccuracyBarsStack({ accuracy }: { accuracy: RoundResult['phaseAccuracy'] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {accuracyRows(accuracy).map((row) => (
        <div key={row.phase}>
          <div className="flex items-baseline justify-between gap-2">
            <span>
              <span className="text-sm font-extrabold" style={{ color: row.color }}>
                {row.label}
              </span>
              <span className="ml-1.5 text-[11px] font-bold text-[#1e1e1e]/45">{row.sublabel}</span>
            </span>
            <span className="text-sm font-extrabold tabular-nums text-[#1e1e1e]">{row.percent}%</span>
          </div>
          <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-[#ececec]">
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${row.percent}%`, backgroundColor: row.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function RoundAccuracyCard({ result, layout }: { result: RoundResult; layout: 'row' | 'stack' }) {
  if (layout === 'stack') {
    return (
      <div className="w-full max-w-xs rounded-2xl bg-white px-4 py-3 text-left shadow-lg">
        <p className="text-[10px] font-extrabold uppercase tracking-wide text-[#1e1e1e]/50">Gelijk met Max</p>
        <div className="mt-1.5">
          <AccuracyBarsStack accuracy={result.phaseAccuracy} />
        </div>
      </div>
    );
  }

  const rows = accuracyRows(result.phaseAccuracy);
  return (
    <div className="rounded-2xl bg-white px-2.5 py-1.5 shadow-lg">
      <p className="text-left text-[9px] font-extrabold uppercase tracking-wide text-[#1e1e1e]/50">Gelijk met Max</p>
      <div className="flex gap-2.5">
        {rows.map((row) => (
          <div key={row.phase} className="w-20">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-extrabold" style={{ color: row.color }}>
                {row.label}
              </span>
              <span className="text-[10px] font-extrabold tabular-nums text-[#1e1e1e]">{row.percent}%</span>
            </div>
            <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#ececec]">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${row.percent}%`, backgroundColor: row.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The sim-racing pedal artwork (carbon face plate, metal pivot, spring on the
// throttle), modeled on real F1 pedal sets. Shared by the in-game pedal
// buttons and the intro explainer; `idPrefix` keeps the pattern/gradient defs
// unique per rendered instance.
function PedalArt({ variant, idPrefix, className }: { variant: 'brake' | 'gas'; idPrefix: string; className: string }) {
  const isBrake = variant === 'brake';
  const accent = isBrake ? '#e61f15' : '#10b981';
  const face = isBrake ? { x: 10, y: 26, w: 100, h: 72 } : { x: 24, y: 10, w: 72, h: 92 };
  const gripYs = isBrake ? [48, 62, 76] : [36, 52, 68, 84];
  const id = `${idPrefix}-${variant}`;

  return (
    <svg viewBox="0 0 120 200" aria-hidden="true" className={className}>
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
  );
}

// An in-game pedal button, held rather than tapped: pointer capture keeps the
// press alive until the finger/mouse actually lets go, even when it drifts off
// the button. While held the pedal tilts like the real thing and shows a
// colored ring; `highlight` marks the gas pedal as the way to start a round -
// a pulsing outline plus a bobbing "Houd ingedrukt!" callout, so a new player
// sees the start control without reading the deck copy.
function Pedal({
  variant,
  onHoldChange,
  held,
  highlight,
  buttonRef,
}: {
  variant: 'brake' | 'gas';
  onHoldChange: (pressed: boolean) => void;
  held: boolean;
  highlight: boolean;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const isBrake = variant === 'brake';
  const accent = isBrake ? '#e61f15' : '#10b981';

  return (
    <button
      ref={buttonRef}
      type="button"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onHoldChange(true);
      }}
      onPointerUp={() => onHoldChange(false)}
      onPointerCancel={() => onHoldChange(false)}
      onLostPointerCapture={() => onHoldChange(false)}
      onContextMenu={(event) => event.preventDefault()}
      aria-keyshortcuts={isBrake ? 'r arrowleft' : 'g arrowright'}
      aria-label={isBrake ? 'Rempedaal, houd ingedrukt (toets R)' : 'Gaspedaal, houd ingedrukt (toets G)'}
      aria-pressed={held}
      className={`group relative flex-1 select-none touch-manipulation rounded-2xl pb-1 pt-2 transition-all duration-150 focus-ring focus-ring-white hover:-translate-y-0.5 ${
        highlight && !held ? 'ring-4 ring-white/80' : ''
      } ${held ? `ring-4 ${isBrake ? 'ring-[#e61f15]' : 'ring-[#10b981]'}` : ''}`}
    >
      {highlight && !held && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-2xl ring-4 ring-white/80 [animation:pedal-pulse_1.6s_ease-out_infinite]"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-2 left-1/2 whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs font-extrabold text-[#1e1e1e] shadow-lg [animation:callout-bob_1.6s_ease-in-out_infinite] sm:text-sm"
          >
            Houd ingedrukt!
            <span className="absolute left-1/2 top-full -mt-1 h-2 w-2 -translate-x-1/2 rotate-45 bg-white" />
          </span>
        </>
      )}
      <PedalArt
        variant={variant}
        idPrefix="pedal"
        className={`mx-auto h-16 w-auto drop-shadow-[0_6px_10px_rgba(6,12,60,0.5)] transition-transform duration-100 sm:h-28 wide:h-[clamp(6rem,30vh,10rem)] ${
          held ? '[transform:perspective(360px)_rotateX(22deg)] origin-bottom' : ''
        }`}
      />
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

// The yellow TIP marker, shared by the ready-screen advice and the score card.
function TipBadge() {
  return (
    <span className="mr-1.5 rounded-full bg-[#ffc828] px-2 py-0.5 align-middle text-[10px] font-extrabold text-[#1e1e1e]">
      TIP
    </span>
  );
}

// The zone-match idea in one picture: Max's pedal zones and a player's slightly
// shifted attempt as two parallel bars on the same time axis, with the moments
// they disagree marked in red on the strip below. Illustrative proportions,
// deliberately not live data - the point is the mechanism, not this round.
const DIAGRAM_MAX_SEGMENTS = [
  { color: '#10b981', widthPct: 28 },
  { color: '#e61f15', widthPct: 26 },
  { color: '#f2a11c', widthPct: 14 },
  { color: '#10b981', widthPct: 32 },
];
const DIAGRAM_PLAYER_SEGMENTS = [
  { color: '#10b981', widthPct: 34 },
  { color: '#e61f15', widthPct: 22 },
  { color: '#f2a11c', widthPct: 6 },
  { color: '#10b981', widthPct: 38 },
];
// Where the two bars above disagree (player brakes late, releases early, ...).
// Marked in dark ink, NOT red: red already means "braking" one row up, and
// playtest feedback read the red marks as brake zones instead of mistakes.
const DIAGRAM_DIFF_STRIPS = [
  { leftPct: 28, widthPct: 6 },
  { leftPct: 54, widthPct: 2 },
  { leftPct: 62, widthPct: 6 },
];
const DIAGRAM_DIFF_COLOR = '#0b1440';

function DiagramZoneBar({ label, segments }: { label: string; segments: { color: string; widthPct: number }[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-right text-[11px] font-extrabold text-[#1e1e1e]/60">{label}</span>
      <div className="flex h-4 flex-1 overflow-hidden rounded-full">
        {segments.map((segment, i) => (
          <span key={i} style={{ width: `${segment.widthPct}%`, backgroundColor: segment.color }} />
        ))}
      </div>
    </div>
  );
}

function ScoreDiagram() {
  return (
    <div className="rounded-2xl bg-[#f3f3f0] p-3.5">
      <div className="flex flex-col gap-1.5">
        <DiagramZoneBar label="Max" segments={DIAGRAM_MAX_SEGMENTS} />
        <DiagramZoneBar label="Jij" segments={DIAGRAM_PLAYER_SEGMENTS} />
        <div className="flex items-center gap-2">
          <span className="w-8 shrink-0" />
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[#0b1440]/10">
            {DIAGRAM_DIFF_STRIPS.map((strip) => (
              <span
                key={strip.leftPct}
                className="absolute inset-y-0"
                style={{ left: `${strip.leftPct}%`, width: `${strip.widthPct}%`, backgroundColor: DIAGRAM_DIFF_COLOR }}
              />
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[11px] font-bold leading-snug text-[#1e1e1e]/60">
        <span className="font-extrabold text-emerald-600">Groen</span> = vol gas,{' '}
        <span className="font-extrabold text-[#c77b0a]">oranje</span> = uitrollen,{' '}
        <span className="font-extrabold text-[#e61f15]">rood</span> = remmen. De{' '}
        <span className="font-extrabold text-[#0b1440]">donkerblauwe</span> vakjes in de onderste strook markeren waar
        jij iets anders deed dan Max, daar verlies je punten.
      </p>
    </div>
  );
}

function scoreSentence(total: number): string {
  if (total >= 90) return 'Wereldklasse, jij remt als Max zelf!';
  if (total >= 70) return 'Sterke ronde, bijna kwalificatiewaardig.';
  if (total >= 45) return 'Netjes! Maar Max rijdt nog wel even weg.';
  return 'De grindbak is goed gevuld vandaag.';
}

function App() {
  const game = useCircuitGame(fixture);
  const { phase, round, roundIndex, elapsedT, transitions, results, heldInput } = game;

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
  // The sharer's overall REM/LOS/GAS bars, recomputed from the timelines in
  // the link (the displayed scores come from the token itself, so they always
  // match what the sharer saw).
  const sharedAccuracy = useMemo(() => {
    if (!shared?.runs) return null;
    return aggregatePhaseAccuracy(shared.runs.map((run) => scoreRound(run.round, fixture.lap.samples, run.transitions)));
  }, [shared]);
  // The player's history, persisted in localStorage (this game's "cookie"):
  // the last attempt and the best run. runContext freezes what the history
  // looked like BEFORE this run was saved, for the score-card comparison.
  const [savedScores, setSavedScores] = useState<SavedScores>(loadScores);
  const [runContext, setRunContext] = useState<{ previousLast: SavedRun | null; isNewBest: boolean } | null>(null);
  const [showShared, setShowShared] = useState(shared !== null);
  const [showScoreInfo, setShowScoreInfo] = useState(false);
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

  const showFinal = useCallback(() => {
    game.finish();
    camera.fly([{ box: overviewBox, ms: 1400 }]);
    const score = totalScore(game.results);

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
    setShowShared(false);
    setShowScoreInfo(false);
    setRunContext(null);
    history.replaceState(null, '', location.pathname);
    game.restart();
    camera.fly([{ box: overviewBox, ms: 900 }]);
  }, [game, camera, overviewBox]);

  // On phones the corner overview leaves the circuit small, so while running
  // the camera rides with the car at a tighter zoom; once the round is scored
  // it flies back out so the whole driven line is visible again. Wide layouts
  // keep the static corner framing.
  //
  // The chase cam does NOT engage on the gas press: that snap-zoom read as
  // disorienting in play-testing. Instead the corner overview holds for the
  // first seconds of the run, then one eased dive brings the camera to where
  // the car will be by the end of the dive, and only then the frame-by-frame
  // follow takes over (from a box it is already close to, so no jump).
  const CHASE_HOLD_MS = 2000;
  const CHASE_DIVE_MS = 1500;
  const isWide = useWideViewport();
  const elapsedTRef = useRef(elapsedT);
  elapsedTRef.current = elapsedT;
  // Depends on the hook's stable callbacks, NOT the camera object: that object
  // is rebuilt every frame while the camera moves, which would restart the
  // zoom-out flight on every render and it would never land.
  const { follow: cameraFollow, fly: cameraFly, jumpTo: cameraJumpTo } = camera;
  useEffect(() => {
    if (phase === 'running' && !isWide) {
      const round = fixture.rounds[roundIndex];
      const base = roundBoxes[roundIndex];
      const size = { w: Math.max(base.w * 0.55, 230), h: Math.max(base.h * 0.55, 230) };
      const diveT = Math.min(round.tStart + (CHASE_HOLD_MS + CHASE_DIVE_MS) / 1000, round.tEnd);
      const divePoint = positionAt(fixture.lap.samples, diveT);
      cameraFly([{ ms: CHASE_HOLD_MS }, { box: { cx: divePoint.x, cy: divePoint.y, ...size }, ms: CHASE_DIVE_MS }], () =>
        cameraFollow(() => {
          const p = positionAt(fixture.lap.samples, elapsedTRef.current);
          return { cx: p.x, cy: p.y, ...size };
        }),
      );
    } else if (phase === 'running' && isWide) {
      // rotated to landscape mid-run: drop the chase cam
      cameraJumpTo(roundBoxes[roundIndex]);
    } else if (phase === 'roundResult' && !isWide) {
      cameraFly([{ box: roundBoxes[roundIndex], ms: 900 }]);
    }
  }, [phase, isWide, cameraFollow, cameraFly, cameraJumpTo, roundBoxes, roundIndex]);

  // The keyboard drives the pedals like real ones: keydown presses, keyup
  // releases. R/ArrowLeft hold the brake, G/ArrowRight hold the gas (holding
  // gas on the ready screen is also what starts the round). Space only
  // navigates the flow (intro, next corner) and never touches a pedal -
  // play-testing showed a space-as-gas shortcut leaking into the next screen.
  // Auto-repeat keydowns are ignored so a held key is one press, and Space is
  // preventDefault-ed so a focused button never double-fires.
  useEffect(() => {
    const pedalForCode = (code: string): 'brake' | 'gas' | null => {
      if (code === 'KeyR' || code === 'ArrowLeft') return 'brake';
      if (code === 'KeyG' || code === 'ArrowRight') return 'gas';
      return null;
    };
    const pedalsLive = phase === 'ready' || phase === 'running';

    const onKeyDown = (event: KeyboardEvent) => {
      if (showShared) return;
      if (showScoreInfo) {
        if (event.code === 'Escape') setShowScoreInfo(false);
        return;
      }
      const pedal = pedalForCode(event.code);
      if (pedal && pedalsLive) {
        event.preventDefault();
        if (!event.repeat) game.setPedal(pedal, true);
        return;
      }
      if (event.code !== 'Space') return;
      event.preventDefault();
      if (event.repeat) return;
      if (phase === 'intro') startGame();
      else if (phase === 'roundResult') (isLastRound ? showFinal : nextRound)();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const pedal = pedalForCode(event.code);
      if (pedal) game.setPedal(pedal, false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [phase, showShared, showScoreInfo, game, startGame, nextRound, showFinal, isLastRound]);

  // Move keyboard focus along with the flow, so Tab/Enter always lands on the
  // primary action and screen-reader users follow the game without hunting.
  const introBtnRef = useRef<HTMLButtonElement>(null);
  const gasPedalRef = useRef<HTMLButtonElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const sharedBtnRef = useRef<HTMLButtonElement>(null);
  const scoreInfoOpenRef = useRef<HTMLButtonElement>(null);
  const scoreInfoCloseRef = useRef<HTMLButtonElement>(null);
  // Focus dives into the explainer when it opens and returns to the link that
  // opened it when it closes; the wasOpen ref keeps this from stealing the
  // score card's initial focus (which belongs to the share button).
  const scoreInfoWasOpenRef = useRef(false);
  useEffect(() => {
    if (showScoreInfo) {
      scoreInfoWasOpenRef.current = true;
      const id = setTimeout(() => scoreInfoCloseRef.current?.focus({ preventScroll: true }), 120);
      return () => clearTimeout(id);
    }
    if (scoreInfoWasOpenRef.current) {
      scoreInfoWasOpenRef.current = false;
      const id = setTimeout(() => scoreInfoOpenRef.current?.focus({ preventScroll: true }), 120);
      return () => clearTimeout(id);
    }
  }, [showScoreInfo]);

  useEffect(() => {
    const byPhase: Partial<Record<GamePhase, React.RefObject<HTMLButtonElement | null>>> = {
      intro: introBtnRef,
      ready: gasPedalRef,
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
    const text = `Ik scoorde ${total}/100 in NOS Rem Reflex, rem en geef jij gas zoals Max Verstappen op Zandvoort?`;
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
  // The color legend shows whenever phase-colored lines are on the map: the
  // practice corridor, the live trail, and the result comparison.
  const legendVisible = (round.practice && phase === 'ready') || phase === 'running' || showRoundResult;
  const verdict = showRoundResult ? verdictForScore(lastResult.score) : null;

  let roundLabel = '';
  if (phase !== 'intro' && phase !== 'finished') {
    roundLabel = round.practice ? `Oefenbocht · ${round.label}` : `Bocht ${scoringRoundNumber} van 3 · ${round.label}`;
  }

  const runningHint = round.practice
    ? 'Volg de kleuren op de baan: rood = remmen, oranje = los, groen = vol gas!'
    : 'Rem, rol uit en geef gas precies zoals Max!';

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
      <div className="bg-carbon flex h-svh flex-col items-center gap-3 overflow-hidden px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white sm:gap-4 sm:px-8 sm:pt-5 wide:px-10 wide:pt-20">
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
              transitions={transitions}
              heldInput={heldInput}
              showReference={phase === 'roundResult' || phase === 'finished'}
            />

            {/* live speed */}
            <div
              aria-hidden={liveSpeed === null}
              className={`absolute bottom-3 right-3 rounded-full bg-white/95 px-4 py-1.5 font-extrabold tabular-nums text-ink shadow transition-opacity duration-300 sm:text-lg ${liveSpeed === null ? 'opacity-0' : 'opacity-100'}`}
            >
              {liveSpeed ?? 0} km/u
            </div>

            {/* phase-color legend, shown whenever colored lines are on the
                map (above the scale bar in the bottom-left corner) */}
            <div
              aria-hidden={!legendVisible}
              className={`pointer-events-none absolute bottom-10 left-3 flex items-center gap-2.5 rounded-full bg-white/95 px-3 py-1.5 shadow transition-opacity duration-300 ${legendVisible ? 'opacity-100' : 'opacity-0'}`}
            >
              {PHASE_ROWS.map((row) => (
                <span key={row.phase} className="flex items-center gap-1">
                  {/* dots use the exact line colors from the map, not the UI accents */}
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PHASE_COLOR[row.phase] }} />
                  <span className="text-[10px] font-extrabold text-ink sm:text-xs">{row.sublabel}</span>
                </span>
              ))}
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

          </div>

          {/* info row */}
          {/* control panel: below the stage in portrait, right column on wide */}
          {/* overflow-x-clip: the panel scrolls vertically but must never pan
              sideways - its scrollbars are hidden, so a stray horizontal
              trackpad swipe would otherwise stick it scrolled and clip the
              pedals/buttons on the left */}
          <div className="scrollbar-hidden contents wide:flex wide:min-h-0 wide:flex-col wide:gap-[clamp(0.75rem,3vh,1.75rem)] wide:overflow-y-auto wide:overflow-x-clip wide:px-1.5">
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
                  <span className="text-sm font-extrabold text-ink sm:text-base">Houd</span>
                  <span className="rounded-full bg-emerald-500 px-3 py-0.5 text-sm font-extrabold text-white sm:text-base">
                    GAS
                  </span>
                  <span className="text-sm font-extrabold text-ink sm:text-base">ingedrukt om te starten</span>
                </div>
                {lastRoundAdvice ? (
                  <p className="text-xs font-bold text-white sm:text-base">
                    <TipBadge />
                    Vorige keer: {lastRoundAdvice}
                  </p>
                ) : (
                  <p className="text-xs font-bold text-white/85 sm:text-base">
                    {round.practice && 'Rijd de kleuren na: groen = vol gas, oranje = los, rood = remmen!'}
                    {!round.practice &&
                      (round.events.length / 2 === 1
                        ? 'Rem, rol uit en geef weer gas precies waar Max dat doet!'
                        : 'Een dubbele: twee remzones, en twee keer terug op het gas!')}
                  </p>
                )}
              </div>
              <p {...layer(phase === 'running', 'text-base font-extrabold sm:text-xl')}>{runningHint}</p>
              {/* round result: the compact bar card sits in this deck row on
                  portrait (between the stage and the next-corner button) and
                  as a stacked card in the side panel on wide */}
              <div {...layer(showRoundResult, 'flex w-full flex-col items-center justify-center')}>
                {lastResult && (
                  <>
                    <div className="wide:hidden">
                      <RoundAccuracyCard result={lastResult} layout="row" />
                    </div>
                    <div className="hidden w-full justify-center wide:flex">
                      <RoundAccuracyCard result={lastResult} layout="stack" />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* action row: the pedals are the controls from the moment a round
                is armed - holding GAS on the ready screen is what starts it */}
            <div className="grid h-24 place-items-center sm:h-44 wide:h-auto wide:min-h-[clamp(6rem,34vh,14rem)]">
              <div {...layer(phase === 'ready' || phase === 'running', 'flex w-full max-w-sm gap-4 wide:gap-6')}>
                <Pedal
                  variant="brake"
                  onHoldChange={(pressed) => game.setPedal('brake', pressed)}
                  held={heldInput === 'brake'}
                  highlight={false}
                />
                <Pedal
                  variant="gas"
                  onHoldChange={(pressed) => game.setPedal('gas', pressed)}
                  held={heldInput === 'gas'}
                  highlight={phase === 'ready'}
                  buttonRef={gasPedalRef}
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
              Toetsenbord: houd <kbd className="rounded bg-white/10 px-1.5 py-0.5">R</kbd> = rem ·{' '}
              <kbd className="rounded bg-white/10 px-1.5 py-0.5">G</kbd> = gas ·{' '}
              <kbd className="rounded bg-white/10 px-1.5 py-0.5">spatie</kbd> = verder
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
          <div className="m-auto w-full max-w-sm rounded-3xl bg-white p-6 text-center text-ink shadow-2xl sm:max-w-md sm:p-10">
            <HeroCar className="mx-auto h-9 w-auto sm:h-12" />
            <h1 id="intro-title" className="mt-4 text-xl font-normal leading-tight text-[#1e1e1e] sm:mt-5 sm:text-2xl">
              Rem jij net zo laat als <span className="font-extrabold">Max Verstappen</span>?
            </h1>
            <p className="mt-2 text-sm font-bold leading-snug text-ink/70 sm:mt-3 sm:text-base">
              Rijd zijn echte poleronde over Zandvoort. Eerst oefenen in de Tarzanbocht, daarna drie bochten voor de
              punten: houd gas en rem precies daar ingedrukt waar Max dat doet.
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
            {/* the two pedals the game is played with; keyboard hints join in
                on larger screens, touch players just see what to expect */}
            <div className="mt-4 rounded-2xl bg-[#f3f3f0] p-3.5 sm:mt-5 sm:p-5">
              <p className="text-left text-xs font-extrabold uppercase tracking-wide text-ink/50">Zo speel je</p>
              <p className="mt-2 text-left text-xs font-bold leading-snug text-ink/60 sm:text-sm">
                Houd een pedaal ingedrukt om gas te geven of te remmen, laat beide los om uit te rollen.
              </p>
              <div className="mt-2 flex items-end justify-center gap-10 sm:mt-3 sm:gap-14">
                <div className="flex flex-col items-center gap-1">
                  <PedalArt variant="brake" idPrefix="intro" className="h-14 w-auto sm:h-20" />
                  <span className="text-xs font-extrabold tracking-widest text-[#e61f15]">REM!</span>
                  <span aria-hidden="true" className="hidden gap-1 sm:flex">
                    <Key>R</Key>
                    <Key>&larr;</Key>
                  </span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <PedalArt variant="gas" idPrefix="intro" className="h-14 w-auto sm:h-20" />
                  <span className="text-xs font-extrabold tracking-widest text-emerald-600">GAS!</span>
                  <span aria-hidden="true" className="hidden gap-1 sm:flex">
                    <Key>G</Key>
                    <Key>&rarr;</Key>
                  </span>
                </div>
              </div>
              <p className="mt-3 hidden text-center text-xs font-bold text-ink/60 sm:block">
                <Key>spatie</Key> = verder
              </p>
            </div>
            <button
              ref={introBtnRef}
              type="button"
              onClick={startGame}
              className={`${BTN_RED} mt-5 w-full px-6 py-4 text-lg sm:mt-6`}
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
          inert={!(phase === 'finished' && !showShared) || showScoreInfo || undefined}
          className={`fixed inset-0 z-40 backdrop-carbon flex overflow-y-auto bg-ink/60 p-4 backdrop-blur-[2px] transition-all duration-700 ${phase === 'finished' && !showShared ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <div className="m-auto w-full max-w-sm rounded-3xl bg-white p-6 text-center text-ink shadow-2xl sm:max-w-md sm:p-10">
            <h2 id="final-title" className="text-sm font-extrabold uppercase tracking-wide text-[#e61f15]">
              Jouw eindscore
            </h2>
            <p className="text-6xl font-extrabold tabular-nums">{total}</p>
            <p className="mb-3 text-sm font-bold text-ink/60">van de 100 punten</p>
            <p className="mb-4 text-sm font-bold sm:mb-5">{scoreSentence(total)}</p>
            <ul className="mb-5 space-y-1 text-left text-sm font-bold sm:mb-6 sm:space-y-1.5">
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
              <div className="mb-3 grid grid-cols-2 gap-2 text-left sm:mb-4">
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
              <p className="mb-4 text-xs font-bold text-[#1e1e1e]/70 sm:mb-5">
                <TipBadge />
                In de <span className="font-extrabold">{improvementTip.round.label}</span>
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
            <button
              ref={scoreInfoOpenRef}
              type="button"
              onClick={() => setShowScoreInfo(true)}
              className="mx-auto mt-3 block rounded text-xs font-bold text-ink/60 underline underline-offset-2 transition-colors hover:text-ink focus-ring focus-ring-dark"
            >
              Hoe wordt je score berekend?
            </button>
          </div>
        </div>

        {/* score explanation + about-this-game disclaimer, opened from the
            final card; sits above it (z-50) with its own backdrop */}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="score-info-title"
          inert={!showScoreInfo || undefined}
          className={`fixed inset-0 z-50 backdrop-carbon flex overflow-y-auto bg-ink/70 p-4 backdrop-blur-[3px] transition-all duration-300 ${showScoreInfo ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <div className="m-auto w-full max-w-sm rounded-3xl bg-white p-6 text-left text-ink shadow-2xl sm:max-w-md sm:p-8">
            <h2 id="score-info-title" className="text-sm font-extrabold uppercase tracking-wide text-[#e61f15]">
              Zo werkt je score
            </h2>
            <div className="mt-3">
              <ScoreDiagram />
            </div>
            <ul className="mt-4 list-disc space-y-2 pl-4 text-sm font-bold leading-snug text-[#1e1e1e]/80">
              <li>
                Tijdens de bocht vergelijken we jouw pedalen 20 keer per seconde met de echte telemetrie van Max: remt
                hij, rolt hij uit of geeft hij vol gas.
              </li>
              <li>Reactietijd krijg je cadeau: zit je bij een overgang maximaal 0,2 seconde naast Max, dan telt dat gewoon als goed.</li>
              <li>
                Per pedaalstand krijg je zo een percentage, de drie balken op je bochtkaart. Je bochtscore is het
                gemiddelde van die drie, zo weegt de korte remzone net zo zwaar als het lange stuk vol gas.
              </li>
              <li>Je eindscore is het gemiddelde van de drie echte bochten, de oefenbocht telt niet mee.</li>
            </ul>
            <div className="mt-5 border-t border-ink/10 pt-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-[#1e1e1e]/50">Over dit spel</h3>
              <p className="mt-2 text-xs font-bold leading-snug text-[#1e1e1e]/70">
                Dit spel is gemaakt met hulp van AI (Claude). De rijdata is de echte poleronde van Max Verstappen:
                ronde {fixture.meta.lapNumber} uit de kwalificatie van de {fixture.meta.meetingName} {fixture.meta.year}
                , opgehaald via{' '}
                <a
                  href={fixture.meta.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-extrabold text-track-blue underline underline-offset-2 hover:text-ink"
                >
                  OpenF1
                </a>
                . De baanlayout komt uit de officiële circuitgeometrie van{' '}
                <a
                  href={fixture.meta.trackOutlineSource}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-extrabold text-track-blue underline underline-offset-2 hover:text-ink"
                >
                  f1-circuits
                </a>
                .
              </p>
            </div>
            <button
              ref={scoreInfoCloseRef}
              type="button"
              onClick={() => setShowScoreInfo(false)}
              className={`${BTN_RED} mt-5 w-full px-6 py-3`}
            >
              Terug naar je score
            </button>
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
          <div className="m-auto w-full max-w-sm rounded-3xl bg-white p-6 text-center text-ink shadow-2xl sm:max-w-md sm:p-8">
            <h2 id="shared-title" className="text-sm font-extrabold uppercase tracking-wide text-[#e61f15]">
              Gedeelde score
            </h2>
            <p className="text-6xl font-extrabold tabular-nums">{shared?.total}</p>
            <p className="mb-3 text-sm font-bold text-ink/60">van de 100 punten</p>
            {/* run links carry the sharer's pedal timelines: their overall
                accuracy bars are recomputed from them right here */}
            {sharedAccuracy && (
              <div className="mb-4 rounded-2xl bg-[#f3f3f0] px-4 py-3 text-left">
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-[#1e1e1e]/50">Gelijk met Max</p>
                <div className="mt-1.5">
                  <AccuracyBarsStack accuracy={sharedAccuracy} />
                </div>
              </div>
            )}
            <p className="mb-5 text-sm font-bold sm:mb-6">
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
