// What an article sees when the game is embedded in an iframe: a poster that
// links out to the standalone page, instead of a playable game squeezed into a
// content column. This mirrors the pattern NOS uses for its other games (a
// thumbnail in the frame, the game on its own page); the difference is that
// this app is both, deciding by frame context in main.tsx rather than shipping
// a separate embed document.
//
// `_top` rather than `_parent`: a CMS that wraps embeds in a frame of its own
// would otherwise load the game into that wrapper instead of the article page.
// The href drops any query string so a stale share token can never ride along.
const POSTER_SRC = '/images/share.png';

export function EmbedPoster() {
  return (
    <a
      href={`${location.origin}${location.pathname}`}
      target="_top"
      rel="noopener"
      aria-label="Speel NOS Rem Reflex, rem jij net zo laat als Max Verstappen?"
      className="group block focus-ring focus-ring-ink"
    >
      <img
        src={POSTER_SRC}
        alt="NOS Rem Reflex, rem jij net zo laat als Max Verstappen op Zandvoort?"
        className="block h-auto w-full transition-transform duration-200 group-hover:scale-[1.01]"
      />
    </a>
  );
}
