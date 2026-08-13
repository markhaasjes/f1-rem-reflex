// Builds the article lead image: a data graphic of where Max Verstappen brakes
// on Circuit Zandvoort, drawn from the same fixture the game runs on, in the
// game's own palette. No stock photography and nothing invented - the coloured
// line IS his 2025 qualifying lap, so the picture and the game tell the same
// story.
//
//   node scripts/build-article-image.mjs
//
// Writes public/images/<OUT_NAME>.webp at 1600x900 (16:9, an article lead) via
// an SVG rendered in headless Chromium, then quantised with ImageMagick.
// Re-run it after a palette change; that is why it is a script and not a
// one-off export.
import { readFileSync, unlinkSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Playwright is not a dependency of this app (it is only ever used ad hoc for
// verification), so it is imported lazily with a usable error.
async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    console.error('This script renders the SVG in headless Chromium. Install it first:\n  npm i -D playwright');
    process.exit(1);
  }
}

const FIXTURE = new URL('../src/data/zandvoort2025.json', import.meta.url);
const OUT_NAME = 'waar-max-verstappen-remt-circuit-zandvoort-formule-1';
const OUT_WEBP = new URL(`../public/images/${OUT_NAME}.webp`, import.meta.url);
const TMP_PNG = new URL('./.article-image.png', import.meta.url);

const WIDTH = 1600;
const HEIGHT = 900;

// Same values the app uses (src/index.css theme + lib/scene.ts PHASE_COLOR).
const SURFACE = '#294cbd';
const HATCH = '#02118a';
const INK = '#1e1e1e';
const ASPHALT = '#53565c';
const EDGE = '#ffffff';
const PHASE_COLOR = { flat: '#12a37f', coast: '#f2a11c', brake: '#e61f15' };

const ROAD_WIDTH_M = 13;
const EDGE_LINE_M = 1.6;
const LINE_WIDTH_M = 9; // Max's phase line: wide enough to read at article size

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

/** brake > coast > flat, straight from the telemetry channels. */
function phaseOf(sample) {
  if (sample.brakeActive) return 'brake';
  if (sample.throttle < 95) return 'coast';
  return 'flat';
}

// The circuit sits on the right of the frame, the text block on the left, so
// the map is projected into a box rather than the whole canvas.
const MAP = { x: 640, y: 40, w: 930, h: 820 };
const xs = fixture.trackOutline.map((p) => p.x);
const ys = fixture.trackOutline.map((p) => p.y);
const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
const scale = Math.min(MAP.w / (bounds.maxX - bounds.minX), MAP.h / (bounds.maxY - bounds.minY));
const offsetX = MAP.x + (MAP.w - (bounds.maxX - bounds.minX) * scale) / 2;
const offsetY = MAP.y + (MAP.h - (bounds.maxY - bounds.minY) * scale) / 2;
const project = (p) => [offsetX + (p.x - bounds.minX) * scale, offsetY + (p.y - bounds.minY) * scale];
const toPath = (points, close = false) =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'}${project(p).map((v) => v.toFixed(1)).join(' ')}`).join(' ') +
  (close ? ' Z' : '');

// Max's lap split into contiguous same-phase runs; each run repeats the
// previous run's last point so the colours meet with no gap.
const lapSegments = [];
for (const sample of fixture.lap.samples) {
  const phase = phaseOf(sample);
  const current = lapSegments.at(-1);
  if (!current || current.phase !== phase) {
    if (current) current.points.push(sample);
    lapSegments.push({ phase, points: [sample] });
  } else {
    current.points.push(sample);
  }
}

const trackPath = toPath(fixture.trackOutline, true);
const lapPaths = lapSegments
  .filter((s) => s.points.length > 1)
  .map((s) => `<path d="${toPath(s.points)}" stroke="${PHASE_COLOR[s.phase]}" />`)
  .join('\n      ');

// The NOS wordmark, lifted from src/components/NOSLogo.tsx so the graphic
// cannot drift from the app's logo.
const NOS_LOGO = `<svg x="80" y="90" width="170" height="61" viewBox="0 0 115 41" fill="none">
      <path fill-rule="evenodd" clip-rule="evenodd" fill="#ffffff" d="M33.6749 39.321V0.976196H23.474V11.4389C23.474 14.5623 23.529 19.6557 23.802 21.353C22.9798 19.7654 19.5795 14.6704 17.8236 12.3165L9.37863 0.976196H0V39.321H10.2024V27.5999C10.2024 24.4765 10.1459 19.3815 9.8729 17.6842C10.8599 19.3815 14.1503 24.3119 15.8513 26.669L25.0086 39.321H33.6749Z"/>
      <path fill-rule="evenodd" clip-rule="evenodd" fill="#ffffff" d="M114.161 27.5425C114.161 20.3679 109.882 17.4105 100.228 15.1099C95.2935 13.9595 93.9237 13.3013 93.9237 11.8767C93.9237 10.5086 94.691 9.52122 97.8716 9.52122C101.765 9.52122 105.165 10.8377 108.567 13.1383L113.721 4.81176C109.662 1.96415 104.947 0.375 98.4208 0.375C89.1504 0.375 83.2819 5.24901 83.2819 12.4801C83.2819 20.1484 87.7256 22.6685 96.9944 24.8046C102.149 26.0098 103.519 26.8859 103.519 28.3089C103.519 30.119 102.314 30.7757 98.5306 30.7757C94.9655 30.7757 90.084 28.859 87.2863 26.9407L82.1317 35.2673C86.1361 37.8955 92.1129 39.9235 98.3093 39.9235C107.525 39.9235 114.161 36.3079 114.161 27.5425Z"/>
      <path fill-rule="evenodd" clip-rule="evenodd" fill="#E61E14" d="M59.128 29.9117C53.6847 29.9117 49.2724 25.5032 49.2724 20.0681C49.2724 14.6314 53.6847 10.2229 59.128 10.2229C64.5713 10.2229 68.9852 14.6314 68.9852 20.0681C68.9852 25.5032 64.5713 29.9117 59.128 29.9117ZM59.128 0C48.0328 0 39.037 8.98323 39.037 20.0681C39.037 31.1498 48.0328 40.1346 59.128 40.1346C70.2248 40.1346 79.2206 31.1498 79.2206 20.0681C79.2206 8.98323 70.2248 0 59.128 0Z"/>
    </svg>`;

// Sized for the worst case: an article lead scaled to a ~390px phone, where
// 1600px-wide artwork shrinks by 4x. Anything under ~40px here becomes
// unreadable there, which is why the credit and date lines that used to sit in
// the image moved to the figcaption instead.
const legendRow = (y, phase, label) => `
      <circle cx="98" cy="${y}" r="18" fill="${PHASE_COLOR[phase]}" />
      <text x="140" y="${y + 15}" fill="#ffffff" font-size="46" font-weight="700">${label}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Effra, 'Helvetica Neue', Helvetica, Arial, sans-serif">
    <defs>
      <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(115)">
        <rect width="8" height="8" fill="${SURFACE}" />
        <rect width="2" height="8" fill="${HATCH}" />
      </pattern>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#hatch)" />

    ${NOS_LOGO}

    <text x="80" y="290" fill="#ffffff" font-size="82" font-weight="800">Waar Max remt</text>
    <text x="80" y="378" fill="#ffffff" font-size="82" font-weight="800">op Zandvoort</text>
    <text x="80" y="440" fill="#ffffff" font-size="40" font-weight="700" opacity="0.85">Kwalificatieronde 2025</text>

    ${legendRow(600, 'brake', 'remmen')}
    ${legendRow(672, 'coast', 'uitrollen')}
    ${legendRow(744, 'flat', 'vol gas')}

    <g fill="none" stroke-linejoin="round" stroke-linecap="round">
      <path d="${trackPath}" stroke="${EDGE}" stroke-width="${(ROAD_WIDTH_M + EDGE_LINE_M * 2) * scale}" />
      <path d="${trackPath}" stroke="${ASPHALT}" stroke-width="${ROAD_WIDTH_M * scale}" />
      <g stroke-width="${LINE_WIDTH_M * scale}" opacity="0.95">
      ${lapPaths}
      </g>
    </g>
  </svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:${INK}}svg{display:block}</style>
<link rel="preconnect" href="https://static.nos.nl">
<style>@font-face{font-family:'Effra';src:url('https://static.nos.nl/fonts/effra/EffraBold.woff') format('woff');font-weight:700 900;font-display:block}</style>
</head><body>${svg}</body></html>`;

const chromium = await loadChromium();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: TMP_PNG.pathname });
await browser.close();

execFileSync('magick', [TMP_PNG.pathname, '-strip', '-quality', '88', OUT_WEBP.pathname]);
unlinkSync(TMP_PNG.pathname);

const { size } = statSync(OUT_WEBP.pathname);
console.log(`wrote public/images/${OUT_NAME}.webp (${WIDTH}x${HEIGHT}, ${Math.round(size / 1024)}KB)`);
