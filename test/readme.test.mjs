// The README is part of the deliverable: its example files must import, and its numbers must be the recorded ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFacilities, validateZones} from '../validate.mjs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const evidence = name => JSON.parse(readFileSync(new URL('../docs/evidence/' + name, import.meta.url), 'utf8'));
const plain = readme.replace(/(\d),(\d)/g, '$1$2');

test('the two minimal example files in the README are accepted by the validator', () => {
  const blocks = [...readme.matchAll(/^~~~json\n([\s\S]*?)\n~~~$/gm)].map(match => JSON.parse(match[1]));
  assert.equal(blocks.length, 2);
  const [facilities, zones] = [validateFacilities(blocks[0]), validateZones(blocks[1])];
  assert.deepEqual([facilities.problems, zones.problems], [[], []]);
  assert.deepEqual([facilities.features.length, zones.features.length], [1, 1]);
});

test('the numbers the README quotes are the ones in the evidence files', () => {
  const cross = evidence('crosscheck.json'), bench = evidence('benchmark.json'), access = evidence('accessibility.json');
  const quoted = [cross.polygons, cross.pairs, cross.covered_pairs, cross.boundary_cases, cross.hole_interior_pairs, cross.seed,
    cross.versions.shapely, cross.versions.geos, cross.versions.numpy, cross.versions.python, cross.versions.node,
    ...Object.values(cross.cases), bench.cpu.model, bench.cpu.logicalCores, bench.node, bench.scene.points, bench.scene.polygons,
    bench.scene.pointsInsideAtLeastOneZone, bench.indexedFullRun.medianMs, bench.indexedFullRun.runs, bench.indexedFullRun.pointsPerSecondAtMedian,
    bench.grid.buildMs, bench.grid.meanZonesShortlistedPerPoint, bench.grid.mostZonesShortlistedForOnePoint, bench.directScanSubset.points,
    bench.directScanSubset.directMedianMs, bench.directScanSubset.gridMedianMs, bench.directScanSubset.gridSpeedupAtMedian,
    access.axe, access.contrast.viewport_1280.lowestRatio, access.contrast.viewport_1280.textItemsMeasured, access.targets.viewport_1280.controlsMeasured];
  for (const value of quoted) assert.ok(plain.includes(String(value)), 'the README does not quote ' + value);
  const row = readFileSync(new URL('../docs/evidence/planar-gap.txt', import.meta.url), 'utf8').split('\n').find(line => line.startsWith(' 45 deg'));
  const [, , km5, , km100] = row.split('|').map(cell => cell.trim());
  assert.ok(plain.includes(km5 + ' apart for a 5 km edge'), 'the README does not quote ' + km5 + ' for 5 km');
  assert.ok(plain.includes(km100 + ' apart for a 100 km edge'), 'the README does not quote ' + km100 + ' for 100 km');
  assert.equal(access.views.every(view => view.violations === 0), true);
  assert.equal(access.views.length, 5);
  assert.equal(readme.split('\n')[0], '# Flood Exposure Atlas');
  assert.match(readme.split('\n')[2], /^\[!\[Tests\]\(.*\/workflows\/test\.yml\/badge\.svg\?branch=main\)\]\(.*\/workflows\/test\.yml\)$/);
  assert.equal(readme.trimEnd().split('\n').at(-1), '© 2026 muhammmmadziam1234-eng. All rights reserved, except the typeface in [fonts](fonts), which keeps its own licence.');
});
