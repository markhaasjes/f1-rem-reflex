// Diagnoses the race-line pathology that made Gerlach & Hugenholtz render as
// a straight line, anywhere on the lap. Run it when a corner's drawn line
// looks straight or faceted:
//
//   node scripts/analyze-race-line.mjs [fromM] [toM]     (default: whole lap)
//
// It reports, for the given meters-into-lap range:
//   1. collinear lerp-fill runs - OpenF1's location feed updates every
//      ~15-40m and the pipeline lerps in between, leaving perfectly straight
//      point chains that pass "dense data" checks but carry no shape;
//   2. data gaps between real GPS vertices (missing corner arcs);
//   3. stretches where the road curves but the trace stays straight - these
//      are the spots that render wrong, and the basis for the suggested
//      REPAIR_RANGES entry it prints at the end.
//
// The fix itself lives in src/lib/corner.ts (repairStraightFills): add the
// suggested { fromM, toM } to REPAIR_RANGES there and verify visually. See
// docs/DEVELOPMENT.md, "Repairing a race line with GPS data gaps".

import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../src/data/zandvoort2025.json', import.meta.url), 'utf8'));
const samples = fixture.lap.samples;
const fromM = Number(process.argv[2] ?? 0);
const toM = Number(process.argv[3] ?? fixture.meta.lapLengthM);

const LAP_LENGTH_M = 4218;
const MIN_SEGMENT_M = 0.4; // matches corner.ts
const COLLINEAR_DEV_M = 0.06; // matches corner.ts

// start/finish-rotated outline, same frame the app draws in
const rawOutline = fixture.trackOutline;
let sfIndex = 0;
let sfDist = Infinity;
rawOutline.forEach((p, i) => {
  const d = Math.hypot(p.x - fixture.startFinish.x, p.y - fixture.startFinish.y);
  if (d < sfDist) {
    sfDist = d;
    sfIndex = i;
  }
});
const outline = [...rawOutline.slice(sfIndex), ...rawOutline.slice(0, sfIndex)];
const n = outline.length;

// jitter-deduped trace, like buildModel
const kept = [{ x: samples[0].x, y: samples[0].y, d: samples[0].distanceM }];
for (let i = 1; i < samples.length - 1; i++) {
  const prev = kept.at(-1);
  if (Math.hypot(samples[i].x - prev.x, samples[i].y - prev.y) >= MIN_SEGMENT_M) {
    kept.push({ x: samples[i].x, y: samples[i].y, d: samples[i].distanceM });
  }
}
const inRange = kept.filter((p) => p.d >= fromM && p.d <= toM);
if (inRange.length < 5) {
  console.error(`only ${inRange.length} trace points in ${fromM}-${toM}m - widen the range`);
  process.exit(1);
}

const devFromChord = (a, b, p) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return Math.abs((b.y - a.y) * (p.x - a.x) - (b.x - a.x) * (p.y - a.y)) / len;
};

// --- 1. collinear lerp-fill runs ---
console.log(`\n=== ${fromM}-${toM}m ===`);
console.log('\n1. Collinear lerp-fill runs (straight point chains, no real shape):');
const realVertices = [inRange[0]];
{
  let i = 0;
  let found = 0;
  while (i < inRange.length - 1) {
    let j = i + 2;
    while (j < inRange.length) {
      let allOnChord = true;
      for (let k = i + 1; k < j; k++) {
        if (devFromChord(inRange[i], inRange[j], inRange[k]) >= COLLINEAR_DEV_M) {
          allOnChord = false;
          break;
        }
      }
      if (!allOnChord) break;
      j++;
    }
    const chord = Math.hypot(inRange[j - 1].x - inRange[i].x, inRange[j - 1].y - inRange[i].y);
    if (j - 1 - i >= 3 && chord >= 12) {
      console.log(
        `   ${inRange[i].d.toFixed(0)} -> ${inRange[j - 1].d.toFixed(0)}m: ${chord.toFixed(0)}m straight fill`,
      );
      found++;
    }
    realVertices.push(inRange[j - 1]);
    i = j - 1;
  }
  if (!found) console.log('   none');
}

// --- 2. data gaps between real vertices ---
console.log('\n2. Data gaps between real GPS vertices (missing arc shape):');
{
  let found = 0;
  for (let i = 1; i < realVertices.length; i++) {
    const gap = Math.hypot(realVertices[i].x - realVertices[i - 1].x, realVertices[i].y - realVertices[i - 1].y);
    if (gap > 15) {
      console.log(`   ${realVertices[i - 1].d.toFixed(0)} -> ${realVertices[i].d.toFixed(0)}m: ${gap.toFixed(0)}m gap`);
      found++;
    }
  }
  if (!found) console.log('   none');
}

// --- 3. road curves but trace doesn't ---
console.log('\n3. Road turns while the trace stays straight (renders wrong):');
const turnAt = (pts, i) => {
  const a = pts[Math.max(0, i - 1)];
  const b = pts[i];
  const c = pts[Math.min(pts.length - 1, i + 1)];
  const v1 = { x: b.x - a.x, y: b.y - a.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const arc = (Math.hypot(v1.x, v1.y) + Math.hypot(v2.x, v2.y)) / 2 || 1;
  return (Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y) * 180) / Math.PI / arc; // deg per meter
};
const problems = [];
for (let dm = fromM + 10; dm <= toM - 10; dm += 5) {
  // trace turn near dm
  let ti = 0;
  let best = Infinity;
  inRange.forEach((p, i) => {
    if (Math.abs(p.d - dm) < best) {
      best = Math.abs(p.d - dm);
      ti = i;
    }
  });
  const traceTurn = Math.abs(turnAt(inRange, ti));
  // road turn near dm (index seeded by lap distance)
  const j = Math.round((((dm % LAP_LENGTH_M) + LAP_LENGTH_M) % LAP_LENGTH_M) * (n / LAP_LENGTH_M)) % n;
  const roadTurn = Math.abs(turnAt(outline, j));
  if (roadTurn > 0.7 && traceTurn < roadTurn * 0.4) problems.push(dm);
}
if (problems.length === 0) {
  console.log('   none - the drawn line should match the road here');
} else {
  // group consecutive problem samples into spans
  const spans = [];
  let s = problems[0];
  let e = problems[0];
  for (const dm of problems.slice(1)) {
    if (dm - e <= 10) e = dm;
    else {
      spans.push([s, e]);
      s = dm;
      e = dm;
    }
  }
  spans.push([s, e]);
  for (const [a, b] of spans) console.log(`   ~${a.toFixed(0)}-${b.toFixed(0)}m`);
  const lo = Math.max(0, Math.floor((spans[0][0] - 60) / 10) * 10);
  const hi = Math.ceil((spans.at(-1)[1] + 60) / 10) * 10;
  console.log(`\n>>> suggested REPAIR_RANGES entry (src/lib/corner.ts):`);
  console.log(`    { fromM: ${lo}, toM: ${hi} },`);
  console.log(`    (trim the ends onto clean straights, then verify visually - see docs/DEVELOPMENT.md)`);
}
