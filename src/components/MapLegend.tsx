import { PHASE_COLOR } from '../lib/scene';
import type { DrivingPhase } from '../lib/phases';

// The key to every coloured line on the map, shared by the game stage and the
// full-screen explorer so the two can never drift apart. Sized down hard on
// phones, where the full-size card covered a third of a corner.
//
// It shrinks by *stage* size, not by viewport size, and those two come apart on
// a landscape phone: 844px wide counts as a roomy screen, but half of it is the
// control panel, which leaves a 356px stage that the roomy legend fills to the
// edge - together with the controls beside it, it pushed them off screen
// entirely. `short:` marks that case and hands back the phone-sized legend.
const COMPACT_TEXT = 'sm:hidden short:inline';
const ROOMY_TEXT = 'hidden sm:inline short:hidden';

const PHASES: { phase: DrivingPhase; short: string; full: string }[] = [
  { phase: 'brake', short: 'rem', full: 'remmen' },
  { phase: 'coast', short: 'los', full: 'uitrollen' },
  { phase: 'flat', short: 'gas', full: 'vol gas' },
];

export function MapLegend({
  activeLine,
}: {
  /** Which line is currently drawn, spelled out. Null while no result line is
   * on the map (a scoring round in progress), when the row is left off. */
  activeLine: { short: string; full: string } | null;
}) {
  return (
    // Right-aligned: the legend lives at the bottom-right of every map, under
    // the control stack, and its rows line up with the buttons above it.
    <div className="flex flex-col items-end gap-0.5 rounded-lg bg-white/95 px-2 py-1 shadow sm:gap-1.5 sm:rounded-2xl sm:px-4 sm:py-2.5 short:gap-0.5 short:rounded-lg short:px-2 short:py-1">
      <div className="flex items-center gap-1.5 sm:gap-3 short:gap-1.5">
        {PHASES.map((row) => (
          <span key={row.phase} className="flex items-center gap-1">
            {/* dots use the exact line colours from the map, not the UI accents */}
            <span
              className="h-1.5 w-1.5 rounded-full sm:h-3.5 sm:w-3.5 short:h-1.5 short:w-1.5"
              style={{ backgroundColor: PHASE_COLOR[row.phase] }}
            />
            <span className="text-sm font-extrabold leading-tight text-ink sm:text-base short:text-sm">
              <span className={COMPACT_TEXT}>{row.short}</span>
              <span className={ROOMY_TEXT}>{row.full}</span>
            </span>
          </span>
        ))}
      </div>
      {activeLine && (
        // Max's line and the player's share one position and one style, so the
        // only way to tell them apart is to say which one is up.
        <div className="flex items-center gap-1.5 border-t border-ink/10 pt-0.5 sm:gap-3 sm:pt-1.5 short:gap-1.5 short:pt-0.5">
          <span
            className="h-1 w-4 rounded-full sm:h-1.5 sm:w-8 short:h-1 short:w-4"
            style={{ backgroundColor: PHASE_COLOR.flat }}
          />
          <span className="text-sm font-extrabold leading-tight text-ink sm:text-base short:text-sm">
            <span className={COMPACT_TEXT}>{activeLine.short}</span>
            <span className={ROOMY_TEXT}>{activeLine.full}</span>
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
