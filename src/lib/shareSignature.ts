// Shared-score links carry the per-round scores in the query string, and
// this game has no backend to check them against - so without anything
// extra, `?r=0.0.0` becomes `?r=100.100.100` in one edit. A signature over
// the round scores closes that trivial case: touch any digit in `r` and the
// signature no longer matches, so the link is treated as invalid instead of
// showing a claimed score. It is not tamper-proof - the salt ships in the
// client bundle, so anyone willing to read the source can still forge a
// valid one - it just stops "change a number in the address bar and share".
const SALT = 'nos-rem-reflex-share-v1';

// A small deterministic string hash (FNV-1a). Plenty for tamper-evidence:
// this isn't a security boundary, it only needs to be infeasible to
// reproduce by eyeballing the URL.
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function signRoundScores(roundScores: number[]): string {
  return hash(`${SALT}:${roundScores.join('.')}`);
}
