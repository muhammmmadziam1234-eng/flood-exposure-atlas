// Benchmark for the grid index.
//   npm run benchmark              6,000 points x 1,000 polygons, grid against direct scan (about a second)
//   npm run benchmark -- --large   100,000 points x 2,000 polygons with the grid, plus a direct-scan comparison on a
//                                  2,000-point subset; writes docs/evidence/benchmark.json (or --out FILE)
// Both modes check that the grid and the direct scan return identical results. The timings are single-process
// wall-clock numbers from one machine; the evidence file records that machine.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import {dirname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {analyze, zoneIndex} from './geo.mjs';

const collection = features => ({type: 'FeatureCollection', features});
const time = fn => { const start = performance.now(); const value = fn(); return {ms: performance.now() - start, value}; };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = (n, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

function quick() {
  const points = [], zones = [];
  for (let y = 0; y < 25; y++) for (let x = 0; x < 40; x++) {
    const lon = 79 + x * .006, lat = 7 + y * .006, d = .002;
    const ring = [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
    zones.push({type: 'Feature', geometry: {type: 'Polygon', coordinates: [ring]}, properties: {name: 'Zone ' + zones.length, level: 'moderate'}});
    for (let i = 0; i < 6; i++)
      points.push({type: 'Feature', geometry: {type: 'Point', coordinates: [lon + i * .001, lat + i * .0007]}, properties: {id: 'S' + points.length}});
  }
  const direct = time(() => analyze(collection(points), collection(zones), {indexed: false}));
  const grid = time(() => analyze(collection(points), collection(zones)));
  assert.deepEqual(grid.value, direct.value);
  console.log(points.length + ' points, ' + zones.length + ' polygons. Indexed and direct outputs match.');
  console.log('Direct: ' + direct.ms.toFixed(1) + ' ms | grid: ' + grid.ms.toFixed(1) + ' ms (single run, illustrative).');
}

const SEED = 20261115, POINTS = 100000, POLYGONS = 2000, SUBSET = 2000;
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Irregular polygons (6 to 12 vertices, 0.2 to 1.3 km across) scattered over a 0.5 degree square, and uniform points.
function largeScene() {
  const r = mulberry32(SEED), west = 79.2, south = 6.7, span = 0.5, zones = [];
  let vertices = 0;
  for (let i = 0; i < POLYGONS; i++) {
    const cx = west + r() * span, cy = south + r() * span, radius = 0.001 + r() * 0.0055, n = 6 + Math.floor(r() * 7);
    const ring = Array.from({length: n}, () => r() * 2 * Math.PI).sort((a, b) => a - b)
      .map(angle => { const d = radius * (0.5 + 0.5 * r()); return [+(cx + d * Math.cos(angle)).toFixed(6), +(cy + d * Math.sin(angle)).toFixed(6)]; });
    ring.push(ring[0]);
    vertices += ring.length;
    zones.push({type: 'Feature', geometry: {type: 'Polygon', coordinates: [ring]}, properties: {name: 'Zone ' + i, level: ['low', 'moderate', 'high'][i % 3]}});
  }
  const points = Array.from({length: POINTS}, (_, i) => ({type: 'Feature',
    geometry: {type: 'Point', coordinates: [+(west + r() * span).toFixed(6), +(south + r() * span).toFixed(6)]}, properties: {id: 'P' + i, name: 'P' + i, category: 'benchmark'}}));
  return {zones: collection(zones), points: collection(points), vertices};
}

async function large(outFile) {
  const {zones, points, vertices} = largeScene();
  const index = zoneIndex(zones.features), build = time(() => zoneIndex(zones.features));
  let shortlisted = 0, most = 0;
  for (const p of points.features) { const n = index(p.geometry.coordinates).length; shortlisted += n; most = Math.max(most, n); }

  const runs = Array.from({length: 5}, () => time(() => analyze(points, zones)));
  const full = runs.at(-1).value;
  const covered = full.features.filter(f => f.properties.exposure !== 'outside').length;

  const subset = collection(points.features.slice(0, SUBSET));
  const directRuns = Array.from({length: 3}, () => time(() => analyze(subset, zones, {indexed: false})));
  const gridRuns = Array.from({length: 3}, () => time(() => analyze(subset, zones)));
  assert.deepEqual(gridRuns[0].value, directRuns[0].value, 'grid and direct scan must agree on the subset');
  assert.deepEqual(full.features.slice(0, SUBSET), gridRuns[0].value.features, 'the full run must agree with the subset run');

  const report = {
    script: 'benchmark.mjs --large',
    node: process.version, v8: process.versions.v8, platform: os.platform() + ' ' + os.arch(),
    cpu: {model: os.cpus()[0].model, logicalCores: os.cpus().length},
    seed: SEED,
    scene: {points: POINTS, polygons: POLYGONS, polygonVertices: vertices, pointsInsideAtLeastOneZone: covered,
      note: 'Irregular polygons 0.2 to 1.3 km across scattered over a 0.5 degree square; uniform random points in the same square.'},
    grid: {cellSizeDegrees: 0.006, buildMs: round(build.ms), meanZonesShortlistedPerPoint: round(shortlisted / POINTS, 2), mostZonesShortlistedForOnePoint: most,
      zonesWithoutTheGrid: POLYGONS},
    indexedFullRun: {runs: runs.length, msPerRun: runs.map(run => round(run.ms)), medianMs: round(median(runs.map(run => run.ms))),
      pointsPerSecondAtMedian: Math.round(POINTS / (median(runs.map(run => run.ms)) / 1000)),
      includes: 'building the grid, classifying every point, and creating the result objects'},
    directScanSubset: {points: SUBSET, directRuns: directRuns.length, directMsPerRun: directRuns.map(run => round(run.ms)), directMedianMs: round(median(directRuns.map(run => run.ms))),
      gridMsPerRun: gridRuns.map(run => round(run.ms)), gridMedianMs: round(median(gridRuns.map(run => run.ms))),
      gridSpeedupAtMedian: round(median(directRuns.map(run => run.ms)) / median(gridRuns.map(run => run.ms))), identicalResults: true},
    caveat: 'One machine, one process, wall-clock time after the first run has warmed the code up. Other machines will differ.'
  };
  await mkdir(dirname(outFile), {recursive: true});
  await writeFile(outFile, JSON.stringify(report, null, 2) + '\n');
  console.log(POINTS.toLocaleString('en-US') + ' points x ' + POLYGONS.toLocaleString('en-US') + ' polygons, grid: median ' + report.indexedFullRun.medianMs + ' ms over ' + runs.length + ' runs');
  console.log('Subset of ' + SUBSET + ' points: direct scan median ' + report.directScanSubset.directMedianMs + ' ms, grid ' + report.directScanSubset.gridMedianMs + ' ms (identical results)');
  console.log('Measured on ' + report.cpu.model + ', Node ' + process.version + '. Wrote ' + outFile);
}

const args = process.argv.slice(2);
if (args.includes('--large')) {
  const at = args.indexOf('--out');
  await large(at >= 0 ? args[at + 1] : fileURLToPath(new URL('./docs/evidence/benchmark.json', import.meta.url)));
} else quick();
