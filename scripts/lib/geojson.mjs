// Fetches Circuit Zandvoort's official track centerline from the open
// bacinger/f1-circuits GeoJSON dataset (the same source racingcircuitmap.com
// is built on) and provides the geometry needed to align our OpenF1
// telemetry-derived track shape onto it.

const GEOJSON_URL = 'https://raw.githubusercontent.com/bacinger/f1-circuits/master/circuits/nl-1948.geojson'
const EARTH_RADIUS_M = 6371000

// Projects [lon, lat] to local flat meters (equirectangular, centered on the
// track's mean latitude - accurate enough for a ~4km circuit) with y
// increasing southward, to match the app's screen/SVG y-down convention.
function projectLonLat([lon, lat], lon0, lat0) {
  const x = (lon - lon0) * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos((lat0 * Math.PI) / 180)
  const y = -(lat - lat0) * (Math.PI / 180) * EARTH_RADIUS_M
  return { x, y }
}

export async function fetchOfficialTrackOutline() {
  const res = await fetch(GEOJSON_URL)
  if (!res.ok) throw new Error(`${GEOJSON_URL} -> HTTP ${res.status}`)
  const geojson = await res.json()
  const coords = geojson.features[0].geometry.coordinates
  const lat0 = coords.reduce((sum, [, lat]) => sum + lat, 0) / coords.length
  const lon0 = coords[0][0]
  const points = coords.map((c) => projectLonLat(c, lon0, lat0))
  // GeoJSON LineString repeats the first point at the end to close the loop.
  if (points.length > 1 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y) points.pop()
  return points
}

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  }
}

// Smooths a coarse closed polyline (e.g. 119 hand-digitized points) into a
// dense curve via Catmull-Rom spline interpolation between each control
// point, so it renders as a smooth line instead of a faceted one.
export function smoothClosedCurve(points, samplesPerSegment) {
  const n = points.length
  const dense = []
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]
    for (let s = 0; s < samplesPerSegment; s++) {
      dense.push(catmullRomPoint(p0, p1, p2, p3, s / samplesPerSegment))
    }
  }
  return dense
}

// Resamples a closed curve to `n` points evenly spaced by arc length.
export function resampleByArcLength(points, n) {
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  }
  const total = cumulative.at(-1)
  const result = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total
    while (j < cumulative.length - 2 && cumulative[j + 1] < target) j++
    const segLen = cumulative[j + 1] - cumulative[j]
    const t = segLen > 0 ? (target - cumulative[j]) / segLen : 0
    result.push({
      x: points[j].x + (points[j + 1].x - points[j].x) * t,
      y: points[j].y + (points[j + 1].y - points[j].y) * t,
    })
  }
  return { points: result, totalLength: total }
}

export function shoelaceArea(points) {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum
}

// Finds the best 2D similarity transform (rotation + uniform scale +
// translation, no reflection) mapping `source` onto `target`, both closed
// loops of N evenly-arc-length-spaced points around the same physical track.
// Uses the complex-number form of orthogonal Procrustes: since neither curve
// has a known common start point, it searches every rotation of the index
// alignment and keeps the lowest-residual fit.
export function fitSimilarityTransform(source, target) {
  const n = source.length
  const meanSource = source.reduce((acc, p) => ({ x: acc.x + p.x / n, y: acc.y + p.y / n }), { x: 0, y: 0 })

  function fitAtOffset(offset) {
    let meanTarget = { x: 0, y: 0 }
    for (let i = 0; i < n; i++) {
      const t = target[(i + offset) % n]
      meanTarget.x += t.x / n
      meanTarget.y += t.y / n
    }
    let sumReal = 0
    let sumImag = 0
    let sumSourceSq = 0
    for (let i = 0; i < n; i++) {
      const p = { x: source[i].x - meanSource.x, y: source[i].y - meanSource.y }
      const t = target[(i + offset) % n]
      const tc = { x: t.x - meanTarget.x, y: t.y - meanTarget.y }
      // k = sum(T * conj(P)) / sum(|P|^2), applied as P' = k*P + translation
      sumReal += tc.x * p.x + tc.y * p.y
      sumImag += tc.y * p.x - tc.x * p.y
      sumSourceSq += p.x * p.x + p.y * p.y
    }
    const kx = sumReal / sumSourceSq
    const ky = sumImag / sumSourceSq
    const tx = meanTarget.x - (kx * meanSource.x - ky * meanSource.y)
    const ty = meanTarget.y - (ky * meanSource.x + kx * meanSource.y)

    let totalError = 0
    for (let i = 0; i < n; i++) {
      const p = source[i]
      const t = target[(i + offset) % n]
      const px = kx * p.x - ky * p.y + tx
      const py = ky * p.x + kx * p.y + ty
      totalError += Math.hypot(px - t.x, py - t.y)
    }
    return { kx, ky, tx, ty, avgErrorM: totalError / n, offset }
  }

  let best = null
  for (let offset = 0; offset < n; offset++) {
    const fit = fitAtOffset(offset)
    if (!best || fit.avgErrorM < best.avgErrorM) best = fit
  }
  return best
}

export function applyTransform(point, transform) {
  const { kx, ky, tx, ty } = transform
  return { x: kx * point.x - ky * point.y + tx, y: ky * point.x + kx * point.y + ty }
}
