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
