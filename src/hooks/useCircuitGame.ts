import { useCallback, useEffect, useRef, useState } from 'react';
import { sampleAt } from '../lib/corner';
import { scoreRound, type RoundResult } from '../lib/scoring';
import type { GamePhase, PlayerMark, ZandvoortFixture } from '../types';

// Game flow: intro (circuit overview) -> per round: flying (camera moves to
// the corner) -> ready -> running -> roundResult -> ... -> finished.
// The camera itself is owned by App (useCameraFlight); this hook owns round
// progression, the run clock and the player's marks.
export function useCircuitGame(fixture: ZandvoortFixture) {
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [roundIndex, setRoundIndex] = useState(0);
  const round = fixture.rounds[roundIndex];

  // Global lap time (seconds into the telemetry window); runs from
  // round.tStart to round.tEnd while a round plays.
  const [elapsedT, setElapsedT] = useState(round.tStart);
  const [marks, setMarks] = useState<PlayerMark[]>([]);
  const [results, setResults] = useState<RoundResult[]>([]);

  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  // Synchronous mirror of marks so fast double presses within one frame read
  // the right count before React re-renders.
  const marksRef = useRef<PlayerMark[]>([]);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (phase !== 'running') return;

    startTimeRef.current = performance.now();

    const tick = (now: number) => {
      const t = round.tStart + (now - startTimeRef.current) / 1000;
      if (t >= round.tEnd) {
        setElapsedT(round.tEnd);
        stopLoop();
        setResults((prev) => [...prev, scoreRound(round, marksRef.current)]);
        setPhase('roundResult');
        return;
      }
      setElapsedT(t);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return stopLoop;
  }, [phase, round, stopLoop]);

  /** Camera flight toward `index` has started (from intro or a result). */
  const flyToRound = useCallback(
    (index: number) => {
      setRoundIndex(index);
      marksRef.current = [];
      setMarks([]);
      setElapsedT(fixture.rounds[index].tStart);
      setPhase('flying');
    },
    [fixture.rounds],
  );

  /** Camera arrived: show the round's ready screen. */
  const arm = useCallback(() => setPhase('ready'), []);

  const startRun = useCallback(() => {
    marksRef.current = [];
    setMarks([]);
    setElapsedT(round.tStart);
    setPhase('running');
  }, [round.tStart]);

  // Two pedals: each press is typed by the pedal (REM/GAS), and only the
  // pedal matching Max's next event registers - play-testing showed players
  // don't read instructions, so the game enforces the brake/gas order and the
  // UI disables the other pedal. Scoring pairs the k-th brake press with
  // Max's k-th brake event (same for gas), which alternation guarantees.
  const press = useCallback(
    (type: PlayerMark['type']) => {
      if (phase !== 'running') return;
      if (round.events[marksRef.current.length]?.type !== type) return;
      const t = Math.min(round.tStart + (performance.now() - startTimeRef.current) / 1000, round.tEnd);
      const state = sampleAt(fixture.lap.samples, t);
      const mark: PlayerMark = { type, t, distanceM: state.distanceM, speedKph: state.speedKph };
      marksRef.current = [...marksRef.current, mark];
      setMarks(marksRef.current);
    },
    [phase, round, fixture.lap.samples],
  );

  const finish = useCallback(() => setPhase('finished'), []);

  const restart = useCallback(() => {
    stopLoop();
    marksRef.current = [];
    setMarks([]);
    setResults([]);
    setRoundIndex(0);
    setElapsedT(fixture.rounds[0].tStart);
    setPhase('intro');
  }, [fixture.rounds, stopLoop]);

  const nextEvent = round.events[marks.length] ?? null;

  return {
    phase,
    roundIndex,
    round,
    elapsedT,
    marks,
    results,
    /** The event type the next press will answer (null once all are used). */
    nextEvent,
    flyToRound,
    arm,
    startRun,
    press,
    finish,
    restart,
  };
}
