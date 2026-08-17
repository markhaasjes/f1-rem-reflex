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
// Bull kit), served from static.nos.nl rather than out of public/ - it is the
// exact URL used for og:image/twitter:image in index.html, so the embed and
// every social preview pull one artwork from one place, and swapping the art
// is a CDN upload rather than a redeploy. Width/height are the file's own
// 1200x675, declared so the frame does not reflow the article while the image
// loads; keep them in step with the file, and with the og:image dimensions.
// 16:9 is deliberate, since a social card crops to ~1.91:1 and a 4:3 version
// lost its top strip.
const POSTER_SRC = 'https://static.nos.nl/img/f1-zandvoort-rem-en-gas/thumb.webp';
const POSTER_WIDTH = 1200;
const POSTER_HEIGHT = 675;

export function EmbedPoster() {
  return (
    <a
      href={`${location.origin}${location.pathname}`}
      target="_top"
      rel="noopener"
      aria-label="Speel NOS Rem Reflex, rem jij net zo laat als Max Verstappen?"
      className="group block h-full w-full focus-ring focus-ring-inset focus-ring-white"
    >
      {/* object-contain over the brand-blue page: the whole artwork stays
          visible whatever height the host gives the frame, instead of being
          cropped or pushing the document into a scroll. The hover cue brightens
          rather than scales - scaling grew the image past the frame and the
          article got scrollbars. */}
      <img
        src={POSTER_SRC}
        width={POSTER_WIDTH}
        height={POSTER_HEIGHT}
        alt="Max Verstappen in Red Bull-pak naast het spel NOS Rem Reflex op een telefoon, met de kaart van Circuit Zandvoort."
        className="block h-full w-full object-contain transition-[filter] duration-200 group-hover:brightness-110"
      />
    </a>
  );
}
