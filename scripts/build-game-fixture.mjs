// Builds src/data/zandvoort2025.json: the one fixture for the full-circuit
// game flow. Fetches Max Verstappen's 2025 Dutch GP qualifying pole lap from
// OpenF1 (20 Hz car_data + location), fits it onto the official circuit
// geometry (bacinger/f1-circuits GeoJSON, projected north-up so the map is
// oriented like Google Maps), and emits:
//   - circuit: trackOutline (dense), startFinish, all 14 corner markers
//   - lap: the full continuous lap at 20 Hz in circuit coordinates
//   - rounds: the four game rounds (Tarzan practice, Hugenholtz, Bocht 9+10,
//     Hans Ernst), each with a sample window and Max's brake/gas target events
//     derived from the telemetry
//
// Run with: node scripts/build-game-fixture.mjs
// Derived from scripts/fetch-circuit-data.mjs (see git history at 9141182).

import { writeFile } from 'node:fs/promises';
import {
  applyTransform,
  fetchOfficialTrackOutline,
  fitSimilarityTransform,
  resampleByArcLength,
  smoothClosedCurve,
} from './lib/geojson.mjs';

const OPENF1_BASE = 'https://api.openf1.org/v1';
const SESSION_KEY = 9916; // 2025 Dutch Grand Prix - Qualifying
const SAMPLE_RATE_HZ = 20;
const LEAD_PAD_S = 10;
const TRAIL_PAD_S = 5;
const FIT_SAMPLE_COUNT = 360;
const OUTLINE_POINT_COUNT = 1400; // dense enough to stay smooth zoomed into a corner

// Max Verstappen's pole lap (validated in the original pipeline).
const DRIVER = {
  acronym: 'VER',
  driverNumber: 1,
  lapNumber: 17,
  lapStart: '2025-08-30T13:59:50.121+00:00',
  lapDurationS: 68.925,
};

// Meters-into-lap anchors per corner, calibrated against the official F1 TV
// circuit map: its 14 badge positions were projected into our coordinate
// frame with a similarity transform anchored on corners 1 and 3, snapped to
// the track, then cross-checked against curvature clusters and speed minima
// (e.g. badge 12 lands at 3121m where the telemetry bottoms out at 96 km/u).
// Two earlier sets were wrong: hand-interpolated anchors drifted up to 160m,
// and a curvature-only pass misnumbered the whole 7-13 sequence (it pinned
// "9/10" on what is really Mastersbocht). If badges ever look off again,
// redo the F1 TV projection - don't nudge numbers by eye.
const CORNER_DEFINITIONS = [
  { number: 1, name: 'Tarzanbocht', expectedIntoLapM: 329 },
  { number: 2, name: 'Gerlachbocht', expectedIntoLapM: 660 },
  { number: 3, name: 'Hugenholtzbocht', expectedIntoLapM: 810 },
  { number: 4, name: 'Hunserug', expectedIntoLapM: 1025 },
  { number: 5, name: 'Slotemakerbocht', expectedIntoLapM: 1204 },
  { number: 6, name: 'Bocht 6', expectedIntoLapM: 1394 },
  { number: 7, name: 'Scheivlak', expectedIntoLapM: 1620 },
  { number: 8, name: 'Mastersbocht', expectedIntoLapM: 2000 },
  { number: 9, name: 'Bocht 9', expectedIntoLapM: 2210 },
  { number: 10, name: 'Bocht 10', expectedIntoLapM: 2470 },
  { number: 11, name: 'Hans Ernst bocht (1)', expectedIntoLapM: 3040 },
  { number: 12, name: 'Hans Ernst bocht (2)', expectedIntoLapM: 3120 },
  { number: 13, name: 'Kumhobocht', expectedIntoLapM: 3430 },
  { number: 14, name: 'Arie Luyendijkbocht', expectedIntoLapM: 3740 },
];

// The four game rounds. Windows are meters-into-lap ranges chosen by hand
// from the telemetry (see printTimeline below): each starts on a clean
// flat-out approach and ends once Max is fully back on the throttle.
const ROUND_DEFINITIONS = [
  { id: 'tarzan', label: 'Tarzanbocht', cornerNumbers: [1], practice: true, fromM: 90, toM: 480 },
  // Gerlach and Hugenholtz as a double: Max brakes for Gerlach (614m),
  // touches full throttle for an instant between the corners (~718m), then
  // brakes again for Hugenholtz (741m). gasSustainSamples: 1 lets that
  // single-sample throttle spike count so the round gets 2x brake + 2x gas.
  {
    id: 'hugenholtz',
    label: 'Gerlach & Hugenholtz',
    cornerNumbers: [2, 3],
    practice: false,
    fromM: 460,
    toM: 1010,
    gasSustainSamples: 1,
  },
  // Bocht 9 & 10, after Mastersbocht: a true double - brake/gas for 9,
  // brake/gas for 10 (the slow loop around the pond).
  { id: 'bocht9-10', label: 'Bocht 9 & 10', cornerNumbers: [9, 10], practice: false, fromM: 2030, toM: 2660 },
  // The Hans Ernst chicane: one deep braking zone (288 -> 96 km/u) through
  // both apexes, then back on the throttle toward Kumhobocht.
  { id: 'hansernst', label: 'Hans Ernstbocht', cornerNumbers: [11, 12], practice: false, fromM: 2700, toM: 3300 },
];

const MIRROR_X = true; // fix OpenF1 chirality before the similarity fit
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJSON(url, attempt = 0) {
  const res = await fetch(url);
  if (res.status === 429) {
    if (attempt >= 5) throw new Error(`${url} -> HTTP 429 (out of retries)`);
    const backoffMs = 3000 * (attempt + 1);
    console.log(`  rate limited, retrying in ${backoffMs}ms...`);
    await sleep(backoffMs);
    return fetchJSON(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function dateRangeQuery(startIso, endIso) {
  return `date%3E=${encodeURIComponent(startIso)}&date%3C=${encodeURIComponent(endIso)}`;
}

function stepValueAt(samples, key, t) {
  let value = samples[0][key];
  for (const sample of samples) {
    if (sample.t > t) break;
    value = sample[key];
  }
  return value;
}

function lerpValueAt(samples, key, t) {
  if (t <= samples[0].t) return samples[0][key];
  const last = samples.at(-1);
  if (t >= last.t) return last[key];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (t >= a.t && t <= b.t) {
      const ratio = (t - a.t) / (b.t - a.t);
      return a[key] + (b[key] - a[key]) * ratio;
    }
  }
  return last[key];
}

async function fetchDriverLap(driver) {
  const start = new Date(driver.lapStart);
  const windowStart = new Date(start.getTime() - LEAD_PAD_S * 1000);
  const windowEnd = new Date(start.getTime() + driver.lapDurationS * 1000 + TRAIL_PAD_S * 1000);

  const [drivers, rawCarData, rawLocation] = await Promise.all([
    fetchJSON(`${OPENF1_BASE}/drivers?session_key=${SESSION_KEY}&driver_number=${driver.driverNumber}`),
    fetchJSON(
      `${OPENF1_BASE}/car_data?session_key=${SESSION_KEY}&driver_number=${driver.driverNumber}&${dateRangeQuery(windowStart.toISOString(), windowEnd.toISOString())}`,
    ),
    fetchJSON(
      `${OPENF1_BASE}/location?session_key=${SESSION_KEY}&driver_number=${driver.driverNumber}&${dateRangeQuery(windowStart.toISOString(), windowEnd.toISOString())}`,
    ),
  ]);

  const t0 = windowStart.getTime();
  const carData = rawCarData
    .map((s) => ({
      t: (new Date(s.date).getTime() - t0) / 1000,
      speed: s.speed,
      brake: s.brake > 0 ? 1 : 0,
      gear: s.n_gear,
      throttle: s.throttle,
    }))
    .sort((a, b) => a.t - b.t);
  const location = rawLocation
    .map((s) => ({
      t: (new Date(s.date).getTime() - t0) / 1000,
      x: MIRROR_X ? -s.x / 10 : s.x / 10,
      y: s.y / 10,
    }))
    .sort((a, b) => a.t - b.t);

  const endT = Math.min(carData.at(-1).t, location.at(-1).t);
  const stepCount = Math.floor(endT * SAMPLE_RATE_HZ);
  const samples = [];
  let cumulativeDistance = 0;
  let prevPoint = null;

  for (let i = 0; i <= stepCount; i++) {
    const t = i / SAMPLE_RATE_HZ;
    const x = lerpValueAt(location, 'x', t);
    const y = lerpValueAt(location, 'y', t);
    if (prevPoint) cumulativeDistance += Math.hypot(x - prevPoint.x, y - prevPoint.y);
    prevPoint = { x, y };

    samples.push({
      t,
      x,
      y,
      distanceM: cumulativeDistance,
      speedKph: Math.round(lerpValueAt(carData, 'speed', t)),
      throttle: Math.round(lerpValueAt(carData, 'throttle', t)),
      brakeActive: stepValueAt(carData, 'brake', t) === 1,
      gear: stepValueAt(carData, 'gear', t),
    });
  }

  const lapStartDistanceM = samples[Math.round(LEAD_PAD_S * SAMPLE_RATE_HZ)].distanceM;
  const lapEndIndex = Math.min(samples.length - 1, Math.round((LEAD_PAD_S + driver.lapDurationS) * SAMPLE_RATE_HZ));
  const lapLengthM = samples[lapEndIndex].distanceM - lapStartDistanceM;

  return {
    driverNumber: driver.driverNumber,
    driverAcronym: driver.acronym,
    driverName: drivers[0].full_name,
    teamName: drivers[0].team_name,
    teamColor: `#${drivers[0].team_colour}`,
    lapNumber: driver.lapNumber,
    lapDurationS: driver.lapDurationS,
    samples,
    lapStartDistanceM,
    lapLengthM,
  };
}

function headingAt(samples, i, span) {
  const a = samples[Math.max(0, i - span)];
  const b = samples[Math.min(samples.length - 1, i + span)];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// Alternating brake/gas target events within a window. A braking zone opens
// at the first brake application and only closes at the next SUSTAINED full
// throttle (>= 95% held for GAS_SUSTAIN_SAMPLES), so trail-brake
// re-applications (Gerlach -> Hugenholtz) merge into one zone and one-sample
// upshift blips don't count as a gas moment.
const GAS_SUSTAIN_SAMPLES = 6; // 0.3s at 20 Hz

function detectEvents(samples, fromM, toM, gasSustainSamples = GAS_SUSTAIN_SAMPLES) {
  const inWindow = samples.filter((s) => s.distanceM >= fromM && s.distanceM <= toM);
  const events = [];
  let braking = false;
  for (let i = 1; i < inWindow.length; i++) {
    const prev = inWindow[i - 1];
    const cur = inWindow[i];
    if (!braking && cur.brakeActive && !prev.brakeActive) {
      events.push({ type: 'brake', t: cur.t, distanceM: cur.distanceM, speedKph: cur.speedKph });
      braking = true;
    } else if (braking && !cur.brakeActive && cur.throttle >= 95 && prev.throttle < 95) {
      const sustained = inWindow.slice(i, i + gasSustainSamples).filter((s) => s.throttle >= 95 && !s.brakeActive);
      if (sustained.length < gasSustainSamples) continue;
      events.push({ type: 'gas', t: cur.t, distanceM: cur.distanceM, speedKph: cur.speedKph });
      braking = false;
    }
  }
  return events;
}

// Debug view of a telemetry stretch so round windows can be sanity-checked.
function printTimeline(samples, fromM, toM, label) {
  console.log(`\n--- ${label} (${fromM}-${toM}m) ---`);
  let prevState = '';
  for (const s of samples) {
    if (s.distanceM < fromM || s.distanceM > toM) continue;
    const state = s.brakeActive ? 'BRAKE' : s.throttle >= 95 ? 'FLAT' : `thr ${s.throttle}`;
    if (state !== prevState) {
      console.log(
        `  ${s.distanceM.toFixed(0).padStart(5)}m t=${s.t.toFixed(2).padStart(6)} ${s.speedKph} km/u ${state}`,
      );
      prevState = state;
    }
  }
}

async function main() {
  console.log('Fetching VER pole lap...');
  const lap = await fetchDriverLap(DRIVER);
  console.log(`  ${lap.samples.length} samples, lap length ${lap.lapLengthM.toFixed(0)}m`);

  console.log('Fetching official track geometry...');
  const officialRaw = await fetchOfficialTrackOutline();
  const officialSmooth = smoothClosedCurve(officialRaw, 15);
  const { points: officialForFit } = resampleByArcLength(officialSmooth, FIT_SAMPLE_COUNT);

  const oneLapPoints = lap.samples
    .filter((s) => s.distanceM >= lap.lapStartDistanceM && s.distanceM < lap.lapStartDistanceM + lap.lapLengthM)
    .map((s) => ({ x: s.x, y: s.y }));
  const { points: telemetryForFit } = resampleByArcLength(oneLapPoints, FIT_SAMPLE_COUNT);

  // Fit telemetry onto the official geometry and keep that frame as-is: the
  // GeoJSON projection is north-up (y = south), so the map ends up oriented
  // exactly like Google Maps. (The old pipeline re-rotated to put Tarzan at
  // the bottom - deliberately NOT done here.)
  const transform = fitSimilarityTransform(telemetryForFit, officialForFit);
  const rotationDeg = (Math.atan2(transform.ky, transform.kx) * 180) / Math.PI;
  console.log(`  fit: rotation=${rotationDeg.toFixed(1)}deg avgError=${transform.avgErrorM.toFixed(1)}m`);

  for (const sample of lap.samples) {
    const p = applyTransform(sample, transform);
    sample.x = p.x;
    sample.y = p.y;
  }

  const { points: trackOutline } = resampleByArcLength(officialSmooth, OUTLINE_POINT_COUNT);

  // Corner markers, snapped onto the fitted lap by meters-into-lap anchors.
  const corners = CORNER_DEFINITIONS.map((def) => {
    const targetM = lap.lapStartDistanceM + def.expectedIntoLapM;
    const sample = lap.samples.reduce((best, s) =>
      Math.abs(s.distanceM - targetM) < Math.abs(best.distanceM - targetM) ? s : best,
    );
    return {
      number: def.number,
      name: def.name,
      x: round2(sample.x),
      y: round2(sample.y),
      distanceM: round2(sample.distanceM - lap.lapStartDistanceM),
    };
  });
  corners.forEach((c) => console.log(`  ${c.number}. ${c.name} @ ${c.distanceM.toFixed(0)}m`));

  const startFinishIndex = Math.round(LEAD_PAD_S * SAMPLE_RATE_HZ);
  const sf = lap.samples[startFinishIndex];
  const startFinish = {
    x: round2(sf.x),
    y: round2(sf.y),
    headingDeg: round2((headingAt(lap.samples, startFinishIndex, 4) * 180) / Math.PI),
  };

  // Round windows + Max's target events (distances rebased to meters-into-lap).
  const rounds = ROUND_DEFINITIONS.map((def) => {
    const fromM = lap.lapStartDistanceM + def.fromM;
    const toM = lap.lapStartDistanceM + def.toM;
    printTimeline(lap.samples, fromM, toM, def.label);
    const events = detectEvents(lap.samples, fromM, toM, def.gasSustainSamples).map((e) => ({
      type: e.type,
      t: round3(e.t),
      distanceM: round2(e.distanceM - lap.lapStartDistanceM),
      speedKph: e.speedKph,
    }));
    console.log(
      `  events: ${events.map((e) => `${e.type}@${e.distanceM.toFixed(0)}m`).join(', ') || 'NONE - window needs tuning'}`,
    );

    const windowSamples = lap.samples.filter((s) => s.distanceM >= fromM && s.distanceM <= toM);
    const xs = windowSamples.map((s) => s.x);
    const ys = windowSamples.map((s) => s.y);
    return {
      id: def.id,
      label: def.label,
      cornerNumbers: def.cornerNumbers,
      practice: def.practice,
      tStart: round3(windowSamples[0].t),
      tEnd: round3(windowSamples.at(-1).t),
      events,
      bounds: {
        minX: round2(Math.min(...xs)),
        minY: round2(Math.min(...ys)),
        maxX: round2(Math.max(...xs)),
        maxY: round2(Math.max(...ys)),
      },
    };
  });

  const fixture = {
    meta: {
      circuit: 'Circuit Zandvoort',
      meetingName: 'Dutch Grand Prix',
      year: 2025,
      sessionName: 'Qualifying',
      sessionKey: SESSION_KEY,
      lapLengthM: round2(lap.lapLengthM),
      driverNumber: lap.driverNumber,
      driverName: lap.driverName,
      driverAcronym: lap.driverAcronym,
      teamName: lap.teamName,
      teamColor: lap.teamColor,
      lapNumber: lap.lapNumber,
      lapDurationS: lap.lapDurationS,
      lapStartT: LEAD_PAD_S,
      lapStartDistanceM: round2(lap.lapStartDistanceM),
      source: 'https://openf1.org',
      trackOutlineSource: 'https://github.com/bacinger/f1-circuits',
    },
    trackOutline: trackOutline.map((p) => ({ x: round2(p.x), y: round2(p.y) })),
    startFinish,
    corners,
    lap: {
      samples: lap.samples.map((s) => ({
        t: round3(s.t),
        x: round2(s.x),
        y: round2(s.y),
        distanceM: round2(s.distanceM - lap.lapStartDistanceM),
        speedKph: s.speedKph,
        throttle: s.throttle,
        brakeActive: s.brakeActive,
        gear: s.gear,
      })),
    },
    rounds,
  };

  await writeFile(new URL('../src/data/zandvoort2025.json', import.meta.url), JSON.stringify(fixture));
  const kb = (JSON.stringify(fixture).length / 1024).toFixed(0);
  console.log(`\nWrote src/data/zandvoort2025.json (${kb} KB)`);
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
