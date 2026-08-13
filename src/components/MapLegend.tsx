import { PHASE_COLOR } from '../lib/scene';
import type { DrivingPhase } from '../lib/phases';

// The key to every coloured line on the map, shared by the game stage and the
// full-screen explorer so the two can never drift apart. Sized down hard on
// phones, where the full-size card covered a third of a corner.

const PHASES: { phase: DrivingPhase; short: string; full: string }[] = [
  { phase: 'brake', short: 'rem', full: 'remmen' },
  { phase: 'coast', short: 'los', full: 'uitrollen' },
  { phase: 'flat', short: 'gas', full: 'vol gas' },
];

export function MapLegend({
  activeLine,
  align = 'end',
}: {
  /** Which line is currently drawn, spelled out. Null while no result line is
   * on the map (a scoring round in progress), when the row is left off. */
  activeLine: { short: string; full: string } | null;
  align?: 'start' | 'end';
}) {
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-lg bg-white/95 px-2 py-1 shadow sm:gap-1.5 sm:rounded-2xl sm:px-4 sm:py-2.5 ${
        align === 'end' ? 'items-end' : 'items-start'
      }`}
    >
      <div className="flex items-center gap-1.5 sm:gap-3">
        {PHASES.map((row) => (
          <span key={row.phase} className="flex items-center gap-1">
            {/* dots use the exact line colours from the map, not the UI accents */}
            <span
              className="h-1.5 w-1.5 rounded-full sm:h-3.5 sm:w-3.5"
              style={{ backgroundColor: PHASE_COLOR[row.phase] }}
            />
            <span className="text-sm font-extrabold leading-tight text-ink sm:text-base">
              <span className="sm:hidden">{row.short}</span>
              <span className="hidden sm:inline">{row.full}</span>
            </span>
          </span>
        ))}
      </div>
      {activeLine && (
        // Max's line and the player's share one position and one style, so the
        // only way to tell them apart is to say which one is up.
        <div className="flex items-center gap-1.5 border-t border-ink/10 pt-0.5 sm:gap-3 sm:pt-1.5">
          <span className="h-1 w-4 rounded-full sm:h-1.5 sm:w-8" style={{ backgroundColor: PHASE_COLOR.flat }} />
          <span className="text-sm font-extrabold leading-tight text-ink sm:text-base">
            <span className="sm:hidden">{activeLine.short}</span>
            <span className="hidden sm:inline">{activeLine.full}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** What the legend should say about the line on the map right now. */
export function activeLineLabel(showingResults: boolean, lineMode: 'max' | 'player', practiceGuide: boolean) {
  if (showingResults) {
    return lineMode === 'max'
      ? { short: 'nu: Max', full: 'op de baan: lijn van Max' }
      : { short: 'nu: jij', full: 'op de baan: jouw lijn' };
  }
  // The practice guide draws Max's line; the trail behind the car is obviously
  // the player's own, so it needs no entry.
  return practiceGuide ? { short: 'Max', full: 'lijn van Max' } : null;
}
