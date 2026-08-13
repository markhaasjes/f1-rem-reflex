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
//
// The poster is the designed promo art (NOS brand, phone mock, "bekijk" CTA,
// Max in Red Bull kit), resized to 1600px wide from the 6000px master kept in
// docs/art - crisp on a 2x display in an article column at ~170KB, where the
// master would have been 5.6MB. Width/height are declared so the frame does
// not reflow the article while the image loads.
const POSTER_SRC = '/images/nos-rem-reflex-share-zandvoort-max-verstappen.webp';
const POSTER_WIDTH = 1600;
const POSTER_HEIGHT = 1200;

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
        width={POSTER_WIDTH}
        height={POSTER_HEIGHT}
        alt="NOS Rem Reflex, rem jij net zo laat als Max Verstappen op Zandvoort?"
        className="block h-auto w-full transition-transform duration-200 group-hover:scale-[1.01]"
      />
    </a>
  );
}
