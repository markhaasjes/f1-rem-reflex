import { useEffect, useRef, useState } from 'react';
import type { LineMode } from '../types';

// Every control that floats over a map, shared by the game stage and the
// full-screen explorer so the two can never drift apart: same shapes, same
// icons, same corner. The stage shows a subset (line toggle + full screen),
// the explorer the whole set, but a button that exists in both keeps its
// position, so the player never has to look for it twice.

// Icons are drawn rather than typed: the text glyphs this replaces (+, -, x
// and the arrows) render at wildly different sizes per platform and left the
// circles looking empty. A stroked 24-unit box at ~55% of the button diameter
// gives every button the same optical weight.
function ControlIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[55%] w-[55%]"
    >
      {children}
    </svg>
  );
}

export function PlusIcon() {
  return (
    <ControlIcon>
      <path d="M12 5v14M5 12h14" />
    </ControlIcon>
  );
}

export function MinusIcon() {
  return (
    <ControlIcon>
      <path d="M5 12h14" />
    </ControlIcon>
  );
}

/** Arrows pushing outward: go to full screen. */
export function ExpandIcon() {
  return (
    <ControlIcon>
      <path d="M9 4H4v5M20 9V4h-5M15 20h5v-5M4 15v5h5" />
      <path d="M10 14l-6 6M14 10l6-6" />
    </ControlIcon>
  );
}

/** The same arrows pulled inward: leave full screen. */
export function CompressIcon() {
  return (
    <ControlIcon>
      <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />
      <path d="M4 20l5-5M20 4l-5 5" />
    </ControlIcon>
  );
}

/** A track loop framed by viewfinder corners: fit the whole circuit on screen.
 * The loop alone read as a toggle switch, the corners alone as the full-screen
 * button; together they say "frame all of this". */
export function WholeCircuitIcon() {
  return (
    <ControlIcon>
      <path d="M3 7.5V3h4.5M21 7.5V3h-4.5M3 16.5V21h4.5M21 16.5V21h-4.5" strokeWidth="2.2" />
      <path d="M9.5 15.5h-1a3 3 0 0 1 0-6h7a3 3 0 0 1 0 6h-3" strokeWidth="2.2" />
    </ControlIcon>
  );
}

/** A circular map control: fixed size, white pill over the map, big icon. */
export function MapControlButton({
  label,
  onClick,
  children,
  buttonRef,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-11 w-11 place-items-center rounded-full bg-white/95 text-ink shadow-lg transition-colors hover:bg-white focus-ring focus-ring-ink sm:h-12 sm:w-12"
    >
      {children}
    </button>
  );
}

/** Which line is on the track. Both sit on the same path, so this is a real
 * either/or: the active side is filled in and marked for screen readers. */
export function LineModeToggle({
  mode,
  onChange,
  hint = false,
}: {
  mode: LineMode;
  onChange: (mode: LineMode) => void;
  /** Show the one-off callout that explains what the toggle is for. */
  hint?: boolean;
}) {
  // The toggle is the only control that changes what the map *means*, and
  // nothing about two short names says "these swap the line". So the first
  // time it appears it announces itself, then gets out of the way: the callout
  // fades after a few seconds and never comes back for as long as this toggle
  // lives (the stage's toggle outlives the whole run), so it explains the
  // feature once instead of nagging after every corner.
  const explainedRef = useRef(false);
  const [calloutVisible, setCalloutVisible] = useState(false);
  useEffect(() => {
    if (!hint || explainedRef.current) {
      setCalloutVisible(false);
      return;
    }
    explainedRef.current = true;
    setCalloutVisible(true);
    const id = setTimeout(() => setCalloutVisible(false), 7000);
    return () => clearTimeout(id);
  }, [hint]);

  const option = (value: LineMode, label: string, title: string) => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => {
          setCalloutVisible(false);
          onChange(value);
        }}
        aria-pressed={active}
        title={title}
        className={`rounded-full px-3 py-1.5 text-sm font-bold transition-colors focus-ring focus-ring-ink sm:text-base ${
          active ? 'bg-ink text-white' : 'text-ink/70 hover:text-ink'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="relative">
      {calloutVisible && (
        <span
          aria-hidden="true"
          // Wraps rather than running off: the callout hangs above a toggle
          // that is itself near the right edge of a stage only ~356px wide on
          // a landscape phone, so a single nowrap line would leave the screen.
          className="pointer-events-none absolute bottom-full right-0 mb-2 w-max max-w-[13rem] rounded-2xl bg-white px-3 py-1.5 text-left text-sm font-bold leading-snug text-ink shadow-lg transition-opacity sm:text-base short:left-0 short:right-auto"
        >
          Wissel tussen jouw lijn en die van Max
          <span className="absolute right-6 top-full -mt-1 h-2 w-2 rotate-45 bg-white short:left-6 short:right-auto" />
        </span>
      )}
      <div
        role="group"
        aria-label="Welke lijn op de baan: die van Max of die van jou"
        className="flex items-center gap-1 rounded-full bg-white/95 p-1 shadow-lg"
      >
        {option('max', 'Max', 'Toon de lijn van Max')}
        {option('player', 'Jij', 'Toon jouw eigen lijn')}
      </div>
    </div>
  );
}
