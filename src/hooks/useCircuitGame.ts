import { useCallback, useEffect, useRef, useState } from 'react';
import { scoreRound, type RoundResult } from '../lib/scoring';
import type { GamePhase, InputTransition, PedalInput, ZandvoortFixture } from '../types';

// Game flow: intro (circuit overview) -> per round: flying (camera moves to
// the corner) -> ready -> running -> roundResult -> ... -> finished.
// The camera itself is owned by App (useCameraFlight); this hook owns round
// progression, the run clock and the player's pedal timeline.
//
// The pedals are held, not tapped: the player keeps GAS or REM pressed and
// the hook records every change of the combined pedal state as a transition
// on the lap clock. A round starts the moment the player first presses GAS
// on the ready screen - the car pulls away with their foot already down.
export function useCircuitGame(fixture: ZandvoortFixture) {
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [roundIndex, setRoundIndex] = useState(0);
  const round = fixture.rounds[roundIndex];

  // Global lap time (seconds into the telemetry window); runs from
  // round.tStart to round.tEnd while a round plays.
  const [elapsedT, setElapsedT] = useState(round.tStart);
  const [transitions, setTransitions] = useState<InputTransition[]>([]);
  const [results, setResults] = useState<RoundResult[]>([]);
  // The combined pedal state right now, for the pedal art and live hints.
  const [heldInput, setHeldInput] = useState<PedalInput>('coast');

  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  // Synchronous mirrors: pedal changes must read the up-to-date timeline and
  // held state immediately, not after the next React render.
  const transitionsRef = useRef<InputTransition[]>([]);
  const heldRef = useRef({ gas: false, brake: false });

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
        setResults((prev) => [...prev, scoreRound(round, fixture.lap.samples, transitionsRef.current)]);
        setPhase('roundResult');
        return;
      }
      setElapsedT(t);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return stopLoop;
  }, [phase, round, fixture.lap.samples, stopLoop]);

  const resetPedals = useCallback(() => {
    heldRef.current = { gas: false, brake: false };
    setHeldInput('coast');
  }, []);

  /** Camera flight toward `index` has started (from intro or a result). */
  const flyToRound = useCallback(
    (index: number) => {
      setRoundIndex(index);
      transitionsRef.current = [];
      setTransitions([]);
      resetPedals();
      setElapsedT(fixture.rounds[index].tStart);
      setPhase('flying');
    },
    [fixture.rounds, resetPedals],
  );

  /** Camera arrived: show the round's ready screen. */
  const arm = useCallback(() => setPhase('ready'), []);

  // One handler for every input source (pointer, touch, keyboard): a pedal
  // went down or came up. Brake wins when both pedals are held - the 3-state
  // input model needs one answer and braking over throttle is the honest one.
  const setPedal = useCallback(
    (pedal: 'gas' | 'brake', pressed: boolean) => {
      if (heldRef.current[pedal] === pressed) return;
      heldRef.current[pedal] = pressed;
      let input: PedalInput = 'coast';
      if (heldRef.current.brake) input = 'brake';
      else if (heldRef.current.gas) input = 'gas';
      setHeldInput(input);

      if (phase === 'ready' && pedal === 'gas' && pressed) {
        // The first gas press IS the start: the run clock effect stamps
        // startTimeRef when the phase flips, and the timeline opens with the
        // player already on the pedal state they are holding right now.
        transitionsRef.current = [{ t: round.tStart, input }];
        setTransitions(transitionsRef.current);
        setElapsedT(round.tStart);
        setPhase('running');
        return;
      }
      if (phase !== 'running') return;

      const t = Math.min(round.tStart + (performance.now() - startTimeRef.current) / 1000, round.tEnd);
      const last = transitionsRef.current.at(-1);
      if (last?.input === input) return;
      transitionsRef.current = [...transitionsRef.current, { t, input }];
      setTransitions(transitionsRef.current);
    },
    [phase, round],
  );

  const finish = useCallback(() => setPhase('finished'), []);

  const restart = useCallback(() => {
    stopLoop();
    transitionsRef.current = [];
    setTransitions([]);
    resetPedals();
    setResults([]);
    setRoundIndex(0);
    setElapsedT(fixture.rounds[0].tStart);
    setPhase('intro');
  }, [fixture.rounds, stopLoop, resetPedals]);

  return {
    phase,
    roundIndex,
    round,
    elapsedT,
    transitions,
    results,
    heldInput,
    flyToRound,
    arm,
    setPedal,
    finish,
    restart,
  };
}
