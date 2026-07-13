import { useEffect, useMemo, useState } from 'react';
import { Pill } from './components/Brand';
import { CircuitMiniMap } from './components/CircuitMiniMap';
import { CornerScene } from './components/CornerScene';
import { HeroCar } from './components/HeroCar';
import { NOSLogo } from './components/NOSLogo';
import fixtureJson from './data/tarzanbocht.json';
import { PRACTICE_ROUNDS, useBrakeGame } from './hooks/useBrakeGame';
import { computeGasPoint, sampleAt } from './lib/corner';
import { combineResults, describeBrakeAttempt, describeGasAttempt } from './lib/scoring';
import type { TarzanFixture } from './types';

const fixture = fixtureJson as TarzanFixture;

const TONE_STYLES = {
  perfect: 'bg-emerald-500',
  good: 'bg-emerald-600',
  okay: 'bg-amber-500',
  bad: 'bg-red-600',
} as const;

// Every phase layer stays mounted in the same grid cell and crossfades, so
// the layout never jumps when the phase changes.
function stackLayer(visible: boolean, extra = '') {
  return `col-start-1 row-start-1 transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-1'} ${extra}`;
}

// A player mark phrased against Max's matching point, in whole metres plus the
// time gap in seconds - far more meaningful to a viewer than the raw speed.
// Positive delta = the player was later than Max.
function deltaSentence(
  distDeltaM: number,
  timeDeltaS: number,
  opts: { verb: string; suffix: string; perfect: string },
): string {
  const meters = Math.round(distDeltaM);
  const seconds = Math.abs(timeDeltaS).toFixed(2).replace('.', ','); // Dutch decimal comma
  if (meters === 0) return `${opts.perfect} (${seconds}s)`;
  const direction = meters > 0 ? 'laat' : 'vroeg';
  return `${opts.verb} ${Math.abs(meters)}m te ${direction}${opts.suffix} (${seconds}s)`;
}

function App() {
  const {
    phase,
    attempt,
    isScoring,
    awaitingGas,
    elapsedT,
    brakeAttempt,
    gasAttempt,
    crashed,
    start,
    press,
    nextAttempt,
    reset,
  } = useBrakeGame(fixture);

  const gasPoint = useMemo(() => computeGasPoint(fixture.samples, fixture.apexPoint.t), []);

  // The intro (circuit map + hero) is its own step: the player first goes "to
  // the track", then presses Start to actually launch the lap - so the car
  // never takes off the instant they leave the intro.
  const [introDismissed, setIntroDismissed] = useState(false);
  const showIntro = phase === 'ready' && attempt === 1 && !introDismissed;

  const backToStart = () => {
    setIntroDismissed(false);
    reset();
  };

  const roundLabel = isScoring ? 'Scoreronde · dit telt' : `Oefenronde ${attempt} van ${PRACTICE_ROUNDS}`;
  const showVerdict = phase === 'result' && isScoring;

  let resultButtonLabel = 'Volgende oefenronde';
  if (isScoring) resultButtonLabel = 'Nog een keer';
  else if (attempt >= PRACTICE_ROUNDS) resultButtonLabel = 'Naar de scoreronde';

  let readyButtonLabel = 'Start de oefenronde';
  if (showIntro) readyButtonLabel = 'Naar de baan';
  else if (isScoring) readyButtonLabel = 'Start de scoreronde';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      if (phase === 'ready') {
        if (showIntro) setIntroDismissed(true);
        else start();
      } else if (phase === 'running') press();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, showIntro, start, press]);

  const liveSpeed = phase === 'running' ? Math.round(sampleAt(fixture.samples, elapsedT).speedKph) : null;

  // Result chips: metres + seconds from Max's point on the scoring lap (a real
  // yardstick), the player's own speed on the blind practice laps.
  let brakeMark = '';
  if (brakeAttempt) {
    brakeMark = isScoring
      ? deltaSentence(brakeAttempt.distanceM - fixture.brakePoint.distanceM, brakeAttempt.t - fixture.brakePoint.t, {
          verb: 'Jij remde',
          suffix: '',
          perfect: 'Jij remde precies op het rempunt',
        })
      : `Jij rem: ${Math.round(brakeAttempt.speedKph)} km/u`;
  }
  let gasMark = isScoring ? 'Jij ging niet op het gas' : 'Jij gas: geen gas';
  if (gasAttempt) {
    gasMark = isScoring
      ? deltaSentence(gasAttempt.distanceM - gasPoint.distanceM, gasAttempt.t - gasPoint.t, {
          verb: 'Jij ging',
          suffix: ' op het gas',
          perfect: 'Jij ging precies op het gas',
        })
      : `Jij gas: ${Math.round(gasAttempt.speedKph)} km/u`;
  }

  const verdict = useMemo(() => {
    if (phase !== 'result') return null;
    const brakeDelta = brakeAttempt ? brakeAttempt.distanceM - fixture.brakePoint.distanceM : null;
    const gasDelta = gasAttempt ? gasAttempt.distanceM - gasPoint.distanceM : null;
    const brakeDesc = describeBrakeAttempt(brakeDelta);
    const gasDesc = describeGasAttempt(gasDelta);
    return { brakeDesc, gasDesc, overall: combineResults(brakeDesc, gasDesc) };
  }, [phase, brakeAttempt, gasAttempt, gasPoint]);

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
          className={`rounded-full px-4 py-1 text-xs font-extrabold tracking-wide sm:text-sm ${isScoring ? 'bg-red-600 text-white' : 'bg-white/15 text-white/90'}`}
        >
          {roundLabel}
        </div>

        <main className="flex w-full max-w-md flex-col gap-3 sm:max-w-2xl lg:max-w-4xl">
          {/* Stage: fixed height, scene always mounted underneath, intro layer on top */}
          <div className="relative h-[24rem] w-full overflow-hidden rounded-3xl sm:h-[30rem] lg:h-[36rem]">
            <CornerScene
              fixture={fixture}
              phase={phase === 'ready' ? 'idle' : phase}
              elapsedT={elapsedT}
              gasPoint={gasPoint}
              brakeAttempt={brakeAttempt}
              gasAttempt={gasAttempt}
              showReference={isScoring}
            />

            {/* live speed */}
            <div
              className={`absolute left-3 top-3 rounded-full bg-white/95 px-4 py-1.5 font-extrabold tabular-nums text-ink shadow transition-opacity duration-300 sm:text-lg ${liveSpeed === null ? 'opacity-0' : 'opacity-100'}`}
            >
              {liveSpeed ?? 0} km/u
            </div>

            {/* verdict banner */}
            <div
              className={`absolute inset-x-3 top-3 mx-auto max-w-md rounded-2xl px-5 py-3 text-center shadow-lg transition-all duration-500 ${showVerdict ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 -translate-y-2'} ${TONE_STYLES[verdict?.overall.tone ?? 'okay']}`}
            >
              <h2 className="text-lg font-extrabold sm:text-xl">{verdict?.overall.title}</h2>
              <p className="text-sm text-white/90">
                <span className="font-extrabold">Rem:</span> {verdict?.brakeDesc.title}
              </p>
              <p className="text-sm text-white/90">
                <span className="font-extrabold">Gas:</span> {verdict?.gasDesc.title}
              </p>
            </div>

            {/* intro layer: circuit map + hero car */}
            <div
              className={`absolute -inset-px flex flex-col bg-track-blue transition-all duration-700 ease-in-out ${showIntro ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-150'}`}
            >
              <div className="relative min-h-0 flex-1 p-2">
                <CircuitMiniMap fixture={fixture} />
              </div>
              <div className="mx-3 mb-3 flex items-center gap-3 rounded-2xl bg-[#dbe7fb] p-3 sm:mx-6 sm:mb-5 sm:gap-5 sm:p-4">
                <HeroCar className="h-14 w-auto shrink-0 sm:h-20" />
                <p className="text-sm font-bold leading-snug text-ink sm:text-lg">
                  Rem jij net zo laat als <span className="text-[#E10600]">Max Verstappen</span>? Dit is zijn echte
                  poleronde door de Tarzanbocht.
                </p>
              </div>
            </div>
          </div>

          {/* info row: min-height so the result sentences can wrap without the
              layout jumping between phases */}
          <div className="grid min-h-14 place-items-center py-1 text-center sm:min-h-16">
            <p className={stackLayer(phase === 'ready', 'text-sm text-white/85 sm:text-lg')}>
              Vind het rempunt én het gaspunt. Rem, en geef daarna weer gas op het juiste moment.
            </p>
            <p className={stackLayer(phase === 'running', 'text-base font-extrabold sm:text-xl')}>
              {awaitingGas ? 'Nu weer op het gas!' : 'Remmen... wachten...'}
            </p>
            <div
              className={stackLayer(phase === 'result', 'flex flex-wrap items-center justify-center gap-2 sm:gap-3')}
            >
              {crashed || !brakeAttempt ? (
                <span className="rounded-full bg-badge-blue px-3 py-1.5 text-xs font-extrabold text-white sm:px-4 sm:text-base">
                  Jij: niet geremd
                </span>
              ) : (
                <>
                  <span className="rounded-full bg-badge-blue px-3 py-1.5 text-xs font-extrabold text-white sm:px-4 sm:text-base">
                    {brakeMark}
                  </span>
                  <span className="rounded-full bg-badge-blue px-3 py-1.5 text-xs font-extrabold text-white sm:px-4 sm:text-base">
                    {gasMark}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* action row: fixed height, layers crossfade */}
          <div className="grid h-20 place-items-center sm:h-24">
            <button
              type="button"
              onClick={showIntro ? () => setIntroDismissed(true) : start}
              className={stackLayer(
                phase === 'ready',
                'w-full max-w-sm select-none touch-manipulation rounded-full bg-white px-8 py-4 text-lg font-extrabold text-ink shadow-lg transition hover:scale-[1.02] active:scale-95 sm:text-xl',
              )}
            >
              {readyButtonLabel}
            </button>
            <button
              type="button"
              onClick={press}
              className={stackLayer(
                phase === 'running',
                `w-full max-w-sm select-none touch-manipulation rounded-full px-8 py-5 text-2xl font-extrabold tracking-wide shadow-lg active:scale-95 sm:text-3xl ${awaitingGas ? 'bg-emerald-500' : 'bg-red-600'}`,
              )}
            >
              {awaitingGas ? 'VOL GAS!' : 'REM!'}
            </button>
            <div className={stackLayer(phase === 'result', 'flex w-full max-w-sm flex-col items-center gap-1.5')}>
              <button
                type="button"
                onClick={isScoring ? backToStart : nextAttempt}
                className="w-full select-none touch-manipulation rounded-full bg-white px-8 py-4 text-lg font-extrabold text-ink shadow-lg transition hover:scale-[1.02] active:scale-95 sm:text-xl"
              >
                {resultButtonLabel}
              </button>
              {/* Always rendered (invisible on the scoring lap) so the primary
                  button keeps the same position across every result screen. */}
              <button
                type="button"
                onClick={backToStart}
                aria-hidden={isScoring}
                tabIndex={isScoring ? -1 : undefined}
                className={`text-sm font-semibold text-white/70 underline underline-offset-4 ${isScoring ? 'invisible' : ''}`}
              >
                Terug naar start
              </button>
            </div>
          </div>
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
