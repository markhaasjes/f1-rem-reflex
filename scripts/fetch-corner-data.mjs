// One-off data-prep script: pulls real OpenF1 telemetry for a single lap/corner
// and bakes it into a static JSON fixture the game plays back client-side.
// Run with: node scripts/fetch-corner-data.mjs

import { writeFile } from 'node:fs/promises'

const OPENF1_BASE = 'https://api.openf1.org/v1'

const SESSION_KEY = 9916 // 2025 Dutch Grand Prix - Qualifying
const DRIVER_NUMBER = 1 // Max Verstappen
const LAP_NUMBER = 17 // his fastest qualifying lap (68.925s)
const LAP_START = '2025-08-30T13:59:50.121+00:00'
const WINDOW_SECONDS = 10 // covers the Tarzanbocht braking zone with margin
const CORNER_END_SECONDS = 9.0 // trim before the next braking zone (Gerlachbocht) begins
const SAMPLE_RATE_HZ = 20
const OUTPUT_PATH = new URL('../src/data/tarzanbocht-2025.json', import.meta.url)

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.json()
}

function dateRangeQuery(startIso, endIso) {
  return `date%3E=${encodeURIComponent(startIso)}&date%3C=${encodeURIComponent(endIso)}`
}

// Holds the last known value for a step-valued field (brake, gear) at time t.
function stepValueAt(samples, key, t) {
  let value = samples[0][key]
  for (const sample of samples) {
    if (sample.t > t) break
    value = sample[key]
  }
  return value
}

// Linear interpolation for a smoothly varying numeric field at time t.
function lerpValueAt(samples, key, t) {
  if (t <= samples[0].t) return samples[0][key]
  const last = samples[samples.length - 1]
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

async function main() {
  const windowStart = new Date(LAP_START)
  const windowEnd = new Date(windowStart.getTime() + WINDOW_SECONDS * 1000)

  const [drivers, rawCarData, rawLocation] = await Promise.all([
    fetchJSON(`${OPENF1_BASE}/drivers?session_key=${SESSION_KEY}&driver_number=${DRIVER_NUMBER}`),
    fetchJSON(
      `${OPENF1_BASE}/car_data?session_key=${SESSION_KEY}&driver_number=${DRIVER_NUMBER}&${dateRangeQuery(windowStart.toISOString(), windowEnd.toISOString())}`,
    ),
    fetchJSON(
      `${OPENF1_BASE}/location?session_key=${SESSION_KEY}&driver_number=${DRIVER_NUMBER}&${dateRangeQuery(windowStart.toISOString(), windowEnd.toISOString())}`,
    ),
  ])

  const driver = drivers[0]
  const t0 = windowStart.getTime()

  const carData = rawCarData
    .map((s) => ({ t: (new Date(s.date).getTime() - t0) / 1000, speed: s.speed, brake: s.brake > 0 ? 1 : 0, gear: s.n_gear, throttle: s.throttle }))
    .sort((a, b) => a.t - b.t)

  const location = rawLocation
    .map((s) => ({ t: (new Date(s.date).getTime() - t0) / 1000, x: s.x / 10, y: s.y / 10 })) // decimeters -> meters
    .sort((a, b) => a.t - b.t)

  const stepCount = Math.round(CORNER_END_SECONDS * SAMPLE_RATE_HZ)
  const samples = []
  let cumulativeDistance = 0
  let prevPoint = null

  for (let i = 0; i <= stepCount; i++) {
    const t = i / SAMPLE_RATE_HZ
    const x = lerpValueAt(location, 'x', t)
    const y = lerpValueAt(location, 'y', t)
    if (prevPoint) {
      cumulativeDistance += Math.hypot(x - prevPoint.x, y - prevPoint.y)
    }
    prevPoint = { x, y }

    samples.push({
      t,
      x,
      y,
      distanceM: cumulativeDistance,
      speedKph: Math.round(lerpValueAt(carData, 'speed', t)),
      brakeActive: stepValueAt(carData, 'brake', t) === 1,
      gear: stepValueAt(carData, 'gear', t),
    })
  }

  const brakeSample = samples.find((s) => s.brakeActive)
  const apexSample = samples.reduce((min, s) => (s.speedKph < min.speedKph ? s : min), samples[0])

  if (!brakeSample) throw new Error('Could not find a brake point in the sampled window - check WINDOW_SECONDS/CORNER_END_SECONDS')

  const fixture = {
    meta: {
      corner: 'Tarzanbocht',
      cornerNumber: 1,
      circuit: 'Circuit Zandvoort',
      meetingName: 'Dutch Grand Prix',
      year: 2025,
      sessionName: 'Qualifying',
      sessionKey: SESSION_KEY,
      lapNumber: LAP_NUMBER,
      lapDurationS: 68.925,
      driverNumber: driver.driver_number,
      driverName: driver.full_name,
      driverAcronym: driver.name_acronym,
      teamName: driver.team_name,
      teamColor: `#${driver.team_colour}`,
      source: 'https://openf1.org',
      generatedFrom: {
        sessionKey: SESSION_KEY,
        driverNumber: DRIVER_NUMBER,
        lapStart: LAP_START,
        windowSeconds: WINDOW_SECONDS,
        cornerEndSeconds: CORNER_END_SECONDS,
        sampleRateHz: SAMPLE_RATE_HZ,
      },
    },
    samples,
    brakePoint: { t: brakeSample.t, distanceM: brakeSample.distanceM, speedKph: brakeSample.speedKph },
    apexPoint: { t: apexSample.t, distanceM: apexSample.distanceM, speedKph: apexSample.speedKph },
    durationS: samples.at(-1).t,
    totalDistanceM: samples.at(-1).distanceM,
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(fixture, null, 2))

  console.log(`Wrote ${OUTPUT_PATH.pathname}`)
  console.log(`Brake point: t=${brakeSample.t.toFixed(2)}s, ${brakeSample.speedKph} km/h, ${brakeSample.distanceM.toFixed(1)}m into window`)
  console.log(`Apex point: t=${apexSample.t.toFixed(2)}s, ${apexSample.speedKph} km/h, ${apexSample.distanceM.toFixed(1)}m into window`)
}

try {
  await main()
} catch (err) {
  console.error(err)
  process.exit(1)
}
