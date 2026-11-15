// The committed evidence files are what the README quotes, so they are checked like any other output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = name => JSON.parse(readFileSync(new URL('../docs/evidence/' + name, import.meta.url), 'utf8'));

test('the Shapely cross-check recorded no disagreement over at least 200,000 polygon-point pairs', () => {
  const report = read('crosscheck.json');
  assert.equal(report.disagreements, 0);
  assert.deepEqual(report.first_disagreements, []);
  assert.deepEqual(report.disagreements_by_path, {contains: 0, analyze: 0, grid: 0});
  assert.ok(report.pairs >= 200000, 'pairs: ' + report.pairs);
  assert.ok(report.boundary_cases > 10000 && report.hole_interior_pairs > 1000, 'boundary and hole cases must be common');
  assert.equal(Object.values(report.pairs_by_kind).reduce((a, b) => a + b, 0), report.pairs);
});

test('every deliberately broken copy of the engine was caught by the cross-check', () => {
  const {mutants} = read('crosscheck-mutants.json');
  assert.ok(mutants.length >= 5);
  for (const m of mutants) assert.ok(m.caught && m.disagreements > 0, m.mutant);
});

test('the benchmark evidence records the machine and a grid result identical to the direct scan', () => {
  const b = read('benchmark.json');
  assert.match(b.node, /^v\d+\.\d+\.\d+$/);
  assert.ok(b.cpu.model.length > 3 && b.cpu.logicalCores >= 1);
  assert.equal(b.scene.points, 100000);
  assert.equal(b.scene.polygons, 2000);
  assert.equal(b.directScanSubset.identicalResults, true);
  assert.ok(b.indexedFullRun.runs >= 5 && b.indexedFullRun.medianMs > 0);
  assert.ok(b.directScanSubset.gridSpeedupAtMedian > 1);
  assert.ok(b.grid.meanZonesShortlistedPerPoint < b.grid.zonesWithoutTheGrid / 10, 'the grid must shortlist far fewer zones than a scan tests');
});

test('the coverage evidence shows at least 90% of lines for the engine and the validator', {skip: process.env.COVERAGE_RUN ? 'the coverage run applies the same gate itself' : false}, () => {
  const report = readFileSync(new URL('../docs/evidence/coverage.txt', import.meta.url), 'utf8');
  for (const file of ['geo.mjs', 'validate.mjs']) {
    const row = report.split('\n').find(line => line.startsWith(file + ' '));
    assert.ok(row, file + ' is missing from the coverage report');
    assert.ok(Number(row.split('|')[1]) >= 90, row);
  }
});
