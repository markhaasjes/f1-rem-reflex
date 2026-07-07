// Data-prep script: builds the full-circuit outline, the 14 named corners,
// and per-driver/per-corner brake telemetry from OpenF1's historical API.
// Run with: node scripts/fetch-circuit-data.mjs
//
// Unlike a single-corner fixture, this script produces one file per driver
// covering their whole lap, sliced into corner-sized windows at runtime-shaped
// data (see src/types.ts CornerData) so the app never needs to fetch anything.

import { writeFile } from 'node:fs/promises'

const OPENF1_BASE = 'https://api.openf1.org/v1'
const SESSION_KEY = 9916 // 2025 Dutch Grand Prix - Qualifying
const SAMPLE_RATE_HZ = 20
const LEAD_PAD_S = 10 // seconds fetched before official lap start
const TRAIL_PAD_S = 5 // seconds fetched after official lap end

const REFERENCE_DRIVER = 'VER' // pole lap, used to define the circuit outline + corner positions

const DRIVERS = [
  { acronym: 'VER', driverNumber: 1, lapNumber: 17, lapStart: '2025-08-30T13:59:50.121+00:00', lapDurationS: 68.925 },
  { acronym: 'HAM', driverNumber: 44, lapNumber: 13, lapStart: '2025-08-30T13:32:28.195+00:00', lapDurationS: 69.261 },
  { acronym: 'ANT', driverNumber: 12, lapNumber: 11, lapStart: '2025-08-30T13:37:43.226+00:00', lapDurationS: 69.493 },
  { acronym: 'NOR', driverNumber: 4, lapNumber: 14, lapStart: '2025-08-30T13:49:42.729+00:00', lapDurationS: 68.674 },
]

// The circuit's 14 named corners, in track order. OpenF1 only exposes speed/
// position - it doesn't label corners - so corner boundaries can't be pulled
// from a single field. `expectedIntoLapM` are reference offsets (meters after
// the start/finish line) hand-tuned against VER's 2025 qualifying pole lap:
// most were confirmed against a real local speed-minimum or heading-change
// peak in that lap (see git history for the exploration); a few in the fast,
// closely-packed middle sector (4-10) fall back to even interpolation between
// the confirmed anchors on either side, since several of those corners are
// taken close to flat-out and don't leave a clear signature in speed alone.
const CORNER_DEFINITIONS = [
  { number: 1, name: 'Tarzanbocht', expectedIntoLapM: 329 },
  { number: 2, name: 'Gerlachbocht', expectedIntoLapM: 793 },
  { number: 3, name: 'Hugenholtzbocht', expectedIntoLapM: 965 },
  { number: 4, name: 'Hunserug', expectedIntoLapM: 1105 },
  { number: 5, name: 'Slotemakerbocht', expectedIntoLapM: 1228 },
  { number: 6, name: 'Bocht 6', expectedIntoLapM: 1419 },
  { number: 7, name: 'Scheivlak', expectedIntoLapM: 1579 },
  { number: 8, name: 'Mastersbocht', expectedIntoLapM: 1724 },
  { number: 9, name: 'Bocht 9', expectedIntoLapM: 1834 },
  { number: 10, name: 'CM.com bocht', expectedIntoLapM: 2044 },
  { number: 11, name: 'Hans Ernst bocht (1)', expectedIntoLapM: 2210 },
  { number: 12, name: 'Hans Ernst bocht (2)', expectedIntoLapM: 2452 },
  { number: 13, name: 'Bocht 13', expectedIntoLapM: 3097 },
  { number: 14, name: 'Arie Luyendijkbocht', expectedIntoLapM: 3420 },
]

const CORNER_SNAP_TOLERANCE_M = 80
const MAX_LOOKBACK_M = 260
const MAX_LOOKAHEAD_M = 130

const round = (n, decimals) => Math.round(n * 10 ** decimals) / 10 ** decimals

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// OpenF1's free tier is rate-limited (3 req/s, 30 req/min) - back off and retry on 429.
async function fetchJSON(url, attempt = 0) {
  const res = await fetch(url)
  if (res.status === 429) {
    if (attempt >= 5) throw new Error(`${url} -> HTTP 429 (out of retries)`)
    const backoffMs = 3000 * (attempt + 1)
    console.log(`  rate limited, retrying in ${backoffMs}ms...`)
    await sleep(backoffMs)
    return fetchJSON(url, attempt + 1)
  }
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.json()
}

function dateRangeQuery(startIso, endIso) {
  return `date%3E=${encodeURIComponent(startIso)}&date%3C=${encodeURIComponent(endIso)}`
}

function stepValueAt(samples, key, t) {
  let value = samples[0][key]
  for (const sample of samples) {
    if (sample.t > t) break
    value = sample[key]
  }
  return value
}

function lerpValueAt(samples, key, t) {
  if (t <= samples[0].t) return samples[0][key]
  const last = samples.at(-1)
  if (t >= last.t) return last[key]
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]
    const b = samples[i + 1]
    if (t >= a.t && t <= b.t) {
      const ratio = (t - a.t) / (b.t - a.t)
      return a[key] + (b[key] - a[key]) * ratio
    }
  }
  return last[key]
}

async function fetchDriverLap(driver) {
  const start = new Date(driver.lapStart)
  const windowStart = new Date(start.getTime() - LEAD_PAD_S * 1000)
  const windowEnd = new Date(start.getTime() + driver.lapDurationS * 1000 + TRAIL_PAD_S * 1000)

  const [drivers, rawCarData, rawLocation] = await Promise.all([
    fetchJSON(`${OPENF1_BASE}/drivers?session_key=${SESSION_KEY}&driver_number=${driver.driverNumber}`),
    fetchJSON(
      `${OPENF1_BASE}/car_data?session_key=${SESSION_KEY}&driver_number=${driver.driverNumber}&${dateRangeQuery(windowStart.toISOString(), windowEnd.toISOString())}`,
    ),
    fetchJSON(
      `${OPENF1_BASE}/location?session_key=${SESSION_KEY}&driver_number=${driver.driverNumber}&${dateRangeQuery(windowStart.toISOString(), windowEnd.toISOString())}`,
    ),
  ])

  const t0 = windowStart.getTime()
  const carData = rawCarData
    .map((s) => ({ t: (new Date(s.date).getTime() - t0) / 1000, speed: s.speed, brake: s.brake > 0 ? 1 : 0, gear: s.n_gear, throttle: s.throttle }))
    .sort((a, b) => a.t - b.t)
  const location = rawLocation
    .map((s) => ({ t: (new Date(s.date).getTime() - t0) / 1000, x: s.x / 10, y: s.y / 10 }))
    .sort((a, b) => a.t - b.t)

  const endT = Math.min(carData.at(-1).t, location.at(-1).t)
  const stepCount = Math.floor(endT * SAMPLE_RATE_HZ)
  const samples = []
  let cumulativeDistance = 0
  let prevPoint = null

  for (let i = 0; i <= stepCount; i++) {
    const t = i / SAMPLE_RATE_HZ
    const x = lerpValueAt(location, 'x', t)
    const y = lerpValueAt(location, 'y', t)
    if (prevPoint) cumulativeDistance += Math.hypot(x - prevPoint.x, y - prevPoint.y)
    prevPoint = { x, y }

    samples.push({
      t,
      x,
      y,
      distanceM: cumulativeDistance,
      speedKph: Math.round(lerpValueAt(carData, 'speed', t)),
      throttle: Math.round(lerpValueAt(carData, 'throttle', t)),
      brakeActive: stepValueAt(carData, 'brake', t) === 1,
      gear: stepValueAt(carData, 'gear', t),
    })
  }

  const lapStartDistanceM = samples[Math.round(LEAD_PAD_S * SAMPLE_RATE_HZ)].distanceM
  const lapEndDistanceM = samples[Math.min(samples.length - 1, Math.round((LEAD_PAD_S + driver.lapDurationS) * SAMPLE_RATE_HZ))].distanceM

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
    lapLengthM: lapEndDistanceM - lapStartDistanceM,
  }
}

function headingAt(samples, i, span) {
  const a = samples[Math.max(0, i - span)]
  const b = samples[Math.min(samples.length - 1, i + span)]
  return Math.atan2(b.y - a.y, b.x - a.x)
}

function angleDiffDeg(a, b) {
  let d = a - b
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return (d * 180) / Math.PI
}

// Finds candidate corner locations in a reference lap: local speed minima
// (braking zones) and local heading-change peaks (direction changes, which
// catches corners taken close to flat-out that don't show up as speed dips).
function findCornerCandidates(samples) {
  const span = Math.round(0.4 * SAMPLE_RATE_HZ)
  const turnRate = samples.map((_, i) => Math.abs(angleDiffDeg(headingAt(samples, Math.min(i + span, samples.length - 1), span), headingAt(samples, Math.max(i - span, 0), span))))

  const indices = new Set()
  for (let i = 1; i < samples.length - 1; i++) {
    if (samples[i].speedKph <= samples[i - 1].speedKph && samples[i].speedKph <= samples[i + 1].speedKph) indices.add(i)
  }
  for (let i = 2; i < turnRate.length - 2; i++) {
    if (turnRate[i] >= turnRate[i - 1] && turnRate[i] >= turnRate[i + 1] && turnRate[i] > 3) indices.add(i)
  }
  return [...indices].sort((a, b) => a - b)
}

function buildCircuit(referenceLap) {
  const candidates = findCornerCandidates(referenceLap.samples)

  function snapNear(targetDistanceM) {
    let best = null
    let bestDiff = Infinity
    for (const idx of candidates) {
      const diff = Math.abs(referenceLap.samples[idx].distanceM - targetDistanceM)
      if (diff < bestDiff) {
        bestDiff = diff
        best = idx
      }
    }
    return bestDiff <= CORNER_SNAP_TOLERANCE_M ? best : null
  }

  const corners = CORNER_DEFINITIONS.map((def) => {
    const targetDistanceM = referenceLap.lapStartDistanceM + def.expectedIntoLapM
    const snapIndex = snapNear(targetDistanceM)
    const index = snapIndex ?? referenceLap.samples.findIndex((s) => s.distanceM >= targetDistanceM)
    const sample = referenceLap.samples[index]
    return { number: def.number, name: def.name, x: round(sample.x, 2), y: round(sample.y, 2), distanceM: round(sample.distanceM, 2) }
  })

  const trackOutline = referenceLap.samples
    .filter((_, i) => i % 2 === 0) // thin the outline for a smaller payload; plenty smooth at 10 Hz for a static map
    .map((s) => ({ x: round(s.x, 2), y: round(s.y, 2) }))

  return {
    meta: {
      circuit: 'Circuit Zandvoort',
      meetingName: 'Dutch Grand Prix',
      year: 2025,
      sessionName: 'Qualifying',
      sessionKey: SESSION_KEY,
      referenceDriver: REFERENCE_DRIVER,
      lapLengthM: referenceLap.lapLengthM,
      source: 'https://openf1.org',
    },
    trackOutline,
    corners,
  }
}

// Slices one driver's full lap down to a single corner: finds the point on
// their own racing line closest to the reference corner position, then walks
// backward/forward along their own samples (capped by distance, so it scales
// with how tightly packed the neighbouring corners are) to build a
// game-sized window, and locates the brake/lift point and apex within it.
function extractCornerForDriver(driverLap, corner, neighborGapsM) {
  const expectedDistanceM = driverLap.lapStartDistanceM + (corner.distanceM - (driverLap.referenceLapStartDistanceM ?? corner.distanceM))
  const searchRadiusM = 400
  let bestIndex = null
  let bestDist = Infinity
  for (let i = 0; i < driverLap.samples.length; i++) {
    const s = driverLap.samples[i]
    if (Math.abs(s.distanceM - expectedDistanceM) > searchRadiusM) continue
    const d = Math.hypot(s.x - corner.x, s.y - corner.y)
    if (d < bestDist) {
      bestDist = d
      bestIndex = i
    }
  }
  if (bestIndex === null) return null

  const apexDistanceM = driverLap.samples[bestIndex].distanceM
  const lookbackCapM = Math.min(MAX_LOOKBACK_M, neighborGapsM.before * 0.6)
  const lookaheadCapM = Math.min(MAX_LOOKAHEAD_M, neighborGapsM.after * 0.6)

  let startIndex = bestIndex
  while (startIndex > 0 && apexDistanceM - driverLap.samples[startIndex].distanceM < lookbackCapM) startIndex--
  let endIndex = bestIndex
  while (endIndex < driverLap.samples.length - 1 && driverLap.samples[endIndex].distanceM - apexDistanceM < lookaheadCapM) endIndex++

  const slice = driverLap.samples.slice(startIndex, endIndex + 1)
  const t0 = slice[0].t
  const distance0 = slice[0].distanceM
  const samples = slice.map((s) => ({
    t: round(s.t - t0, 3),
    x: round(s.x, 2),
    y: round(s.y, 2),
    distanceM: round(s.distanceM - distance0, 2),
    speedKph: s.speedKph,
    brakeActive: s.brakeActive,
    gear: s.gear,
  }))

  const apexSample = samples.reduce((min, s) => (s.speedKph < min.speedKph ? s : min), samples[0])
  const brakeSample = samples.find((s) => s.brakeActive)
  // Fall back to the first throttle lift for corners taken close to flat-out,
  // where no full-brake event occurs (e.g. Hunserug, Scheivlak).
  const liftSample = brakeSample ? null : slice.find((s, i) => i > 0 && s.throttle < 95 && slice[i - 1].throttle >= 95)
  const actionSample = brakeSample ?? (liftSample && { t: round(liftSample.t - t0, 3), distanceM: round(liftSample.distanceM - distance0, 2), speedKph: liftSample.speedKph })
  let actionType = 'none'
  if (brakeSample) actionType = 'brake'
  else if (liftSample) actionType = 'lift'

  return {
    meta: {
      corner: corner.name,
      cornerNumber: corner.number,
      circuit: 'Circuit Zandvoort',
      meetingName: 'Dutch Grand Prix',
      year: 2025,
      sessionName: 'Qualifying',
      sessionKey: SESSION_KEY,
      lapNumber: driverLap.lapNumber,
      lapDurationS: driverLap.lapDurationS,
      driverNumber: driverLap.driverNumber,
      driverName: driverLap.driverName,
      driverAcronym: driverLap.driverAcronym,
      teamName: driverLap.teamName,
      teamColor: driverLap.teamColor,
      source: 'https://openf1.org',
    },
    samples,
    actionType,
    brakePoint: actionSample ? { t: actionSample.t, distanceM: actionSample.distanceM, speedKph: actionSample.speedKph } : null,
    apexPoint: { t: apexSample.t, distanceM: apexSample.distanceM, speedKph: apexSample.speedKph },
    durationS: samples.at(-1).t,
    totalDistanceM: samples.at(-1).distanceM,
  }
}

async function main() {
  console.log('Fetching driver laps...')
  const driverLaps = {}
  for (const driver of DRIVERS) {
    driverLaps[driver.acronym] = await fetchDriverLap(driver)
    console.log(`  ${driver.acronym}: ${driverLaps[driver.acronym].samples.length} samples, lap length ${driverLaps[driver.acronym].lapLengthM.toFixed(0)}m`)
  }

  const referenceLap = driverLaps[REFERENCE_DRIVER]
  const circuit = buildCircuit(referenceLap)
  console.log('Detected corners:')
  circuit.corners.forEach((c) => console.log(`  ${c.number}. ${c.name} @ ${c.distanceM.toFixed(0)}m`))

  for (const lap of Object.values(driverLaps)) {
    lap.referenceLapStartDistanceM = referenceLap.lapStartDistanceM
  }

  await writeFile(new URL('../src/data/circuit.json', import.meta.url), JSON.stringify(circuit, null, 2))
  console.log('Wrote src/data/circuit.json')

  for (const driver of DRIVERS) {
    const driverLap = driverLaps[driver.acronym]
    const corners = {}
    circuit.corners.forEach((corner, i) => {
      const prev = circuit.corners[i - 1]
      const next = circuit.corners[i + 1]
      const gapBefore = prev ? corner.distanceM - prev.distanceM : corner.distanceM - (circuit.corners.at(-1).distanceM - referenceLap.lapLengthM)
      const gapAfter = next ? next.distanceM - corner.distanceM : circuit.corners[0].distanceM + referenceLap.lapLengthM - corner.distanceM
      const result = extractCornerForDriver(driverLap, corner, { before: gapBefore, after: gapAfter })
      if (result) corners[corner.number] = result
    })

    const output = {
      meta: {
        driverNumber: driverLap.driverNumber,
        driverAcronym: driverLap.driverAcronym,
        driverName: driverLap.driverName,
        teamName: driverLap.teamName,
        teamColor: driverLap.teamColor,
        lapNumber: driverLap.lapNumber,
        lapDurationS: driverLap.lapDurationS,
      },
      corners,
    }
    await writeFile(new URL(`../src/data/drivers/${driver.acronym}.json`, import.meta.url), JSON.stringify(output, null, 2))
    console.log(`Wrote src/data/drivers/${driver.acronym}.json (${Object.keys(corners).length} corners)`)
  }
}

try {
  await main()
} catch (err) {
  console.error(err)
  process.exit(1)
}
