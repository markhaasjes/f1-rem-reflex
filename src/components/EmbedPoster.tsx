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
// The poster is the designed promo art (phone mock, "bekijk" CTA, Max in Red
// Bull kit), resized to 1600x900 from the 8000px master kept in docs/art -
// crisp on a 2x display in an article column at ~160KB, where the master would
// have been 6.3MB. Width/height are declared so the frame does not reflow the
// article while the image loads. The same file is the og:image (index.html),
// so the embed and every social preview show one artwork; 16:9 is deliberate,
// since a social card crops to ~1.91:1 and a 4:3 version lost its top strip.
const POSTER_SRC = '/images/nos-rem-reflex-spel-max-verstappen-zandvoort-formule-1.webp';
const POSTER_WIDTH = 1600;
const POSTER_HEIGHT = 900;

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
        alt="Max Verstappen in Red Bull-pak naast het spel NOS Rem Reflex op een telefoon, met de kaart van Circuit Zandvoort."
        className="block h-auto w-full transition-transform duration-200 group-hover:scale-[1.01]"
      />
    </a>
  );
}
