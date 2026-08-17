// URLs for files served straight out of public/, which Vite copies to the build
// root untouched - no hashing, no import graph, so a literal '/images/x.svg' in
// the source survives into the bundle as-is.
//
// That literal breaks the moment the app is not at the domain root. The build
// uses base './' (vite.config.ts) so it can live under any path, and it ships to
// app.nos.nl/sport/f1-zandvoort-rem-en-gas/index.html - where a root-relative
// '/images/x.svg' asks app.nos.nl/images/x.svg and 404s. Vite rewrites the
// references it can see in index.html, but not strings inside components.
//
// So prefix with BASE_URL, which is exactly that './' - resolved by the browser
// against the document, which is the deployed directory. Relative paths only:
// no leading slash, or the join would put the slash back.
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}
