import { useCallback, useEffect, useRef, useState } from 'react';
import { sampleAt } from '../lib/corner';
import type { BrakeAttempt, GamePhase, TarzanFixture } from '../types';

// The player gets one blind practice lap to find the braking feel, then a
// second lap that counts and reveals Max's real line.
export const PRACTICE_ROUNDS = 1;
export const TOTAL_ROUNDS = 2;

export function useBrakeGame(corner: TarzanFixture) {
  const [phase, setPhase] = useState<GamePhase>('ready');
  const [attempt, setAttempt] = useState(1);
  const [elapsedT, setElapsedT] = useState(0);
  // The player marks two points per lap: where they brake, then where they get
  // back on the gas. The run keeps playing after the brake until the gas mark.
  const [brakeAttempt, setBrakeAttempt] = useState<BrakeAttempt | null>(null);
  const [gasAttempt, setGasAttempt] = useState<BrakeAttempt | null>(null);
  const [crashed, setCrashed] = useState(false);

  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  // Synchronous mirrors of the two marks so a fast double-press reads the right
  // state before React has re-rendered.
  const brakeRef = useRef<BrakeAttempt | null>(null);
  const gasRef = useRef<BrakeAttempt | null>(null);

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
      const t = (now - startTimeRef.current) / 1000;
      if (t >= corner.durationS) {
        setElapsedT(corner.durationS);
        stopLoop();
        setCrashed(brakeRef.current === null); // never braked -> straight into the gravel
        setPhase('result');
        return;
      }
      setElapsedT(t);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return stopLoop;
  }, [phase, corner.durationS, stopLoop]);

  const beginRun = useCallback(() => {
    brakeRef.current = null;
    gasRef.current = null;
    setBrakeAttempt(null);
    setGasAttempt(null);
    setCrashed(false);
    setElapsedT(0);
    setPhase('running');
  }, []);

  // Launch the current lap from the ready screen.
  const start = beginRun;

  // Move from a finished practice lap to the ready screen of the next lap, so
  // the player deliberately launches each round instead of being dropped
  // straight into a 330 km/h approach.
  const nextAttempt = useCallback(() => {
    setAttempt((a) => Math.min(a + 1, TOTAL_ROUNDS));
    brakeRef.current = null;
    gasRef.current = null;
    setBrakeAttempt(null);
    setGasAttempt(null);
    setCrashed(false);
    setElapsedT(0);
    setPhase('ready');
  }, []);

  // One control for both marks: the first press brakes, the second gets on the
  // gas and ends the lap.
  const press = useCallback(() => {
    if (phase !== 'running') return;
    const t = Math.min((performance.now() - startTimeRef.current) / 1000, corner.durationS);
    const state = sampleAt(corner.samples, t);
    const mark: BrakeAttempt = { t, distanceM: state.distanceM, speedKph: state.speedKph };

    if (brakeRef.current === null) {
      brakeRef.current = mark;
      setBrakeAttempt(mark);
    } else if (gasRef.current === null) {
      gasRef.current = mark;
      setGasAttempt(mark);
      stopLoop();
      setPhase('result');
    }
  }, [phase, corner.durationS, corner.samples, stopLoop]);

  const reset = useCallback(() => {
    stopLoop();
    brakeRef.current = null;
    gasRef.current = null;
    setAttempt(1);
    setPhase('ready');
    setElapsedT(0);
    setBrakeAttempt(null);
    setGasAttempt(null);
    setCrashed(false);
  }, [stopLoop]);

  return {
    phase,
    attempt,
    isScoring: attempt > PRACTICE_ROUNDS,
    awaitingGas: phase === 'running' && brakeAttempt !== null,
    elapsedT,
    brakeAttempt,
    gasAttempt,
    crashed,
    start,
    press,
    nextAttempt,
    reset,
  };
}
