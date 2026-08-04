export interface SavedRun {
  total: number;
  /** Per-round scores keyed by round id. */
  rounds: Record<string, number>;
  /** Per-round improvement advice keyed by round id (see lib/tips.ts). */
  advice: Record<string, string>;
  date: string;
}

export interface SavedScores {
  best: SavedRun | null;
  last: SavedRun | null;
}

const STORAGE_KEY = 'nos-rem-reflex:scores';

// localStorage plays the role of a cookie here: persistent and local to the
// player's browser, never sent anywhere (the game has no backend).
export function loadScores(): SavedScores {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { best: null, last: null };
    const parsed = JSON.parse(raw) as Partial<SavedScores>;
    return { best: parsed.best ?? null, last: parsed.last ?? null };
  } catch {
    return { best: null, last: null };
  }
}

/** Stores the finished run as the last attempt and, when it beats (or is the
 * first) recorded total, as the best run. Returns the updated snapshot. */
export function saveRun(run: SavedRun): SavedScores {
  const current = loadScores();
  const updated: SavedScores = {
    last: run,
    best: current.best && current.best.total >= run.total ? current.best : run,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // storage blocked or full: the game simply plays without memory
  }
  return updated;
}
