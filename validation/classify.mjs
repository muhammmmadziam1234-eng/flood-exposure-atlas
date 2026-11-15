// Classifies every point of every case with the real engine and writes the answers for validation/crosscheck.py.
// Usage: node validation/classify.mjs cases.json results.json
// Each case gets three answers, as strings of 0 and 1 (1 = covered):
//   contains: the exact point-in-polygon predicate
//   analyze:  the public spatial join with its default grid index (a one-zone scene)
//   grid:     zoneIndex with the case's own cell size, then the exact predicate
import {readFileSync, writeFileSync} from 'node:fs';
import {contains, analyze, zoneIndex} from '../geo.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node validation/classify.mjs cases.json results.json');
  process.exit(2);
}
const {cases} = JSON.parse(readFileSync(input, 'utf8'));
const bits = flags => flags.map(flag => flag ? '1' : '0').join('');
const results = cases.map(({geometry, points, gridStep}) => {
  const zone = {type: 'Feature', geometry, properties: {name: 'Zone', level: 'high'}};
  const sites = {type: 'FeatureCollection', features: points.map((coordinates, i) =>
    ({type: 'Feature', geometry: {type: 'Point', coordinates}, properties: {id: String(i), name: String(i), category: 'case'}}))};
  const candidates = zoneIndex([zone], gridStep);
  return {
    contains: bits(points.map(p => contains(p, geometry))),
    analyze: bits(analyze(sites, {type: 'FeatureCollection', features: [zone]}).features.map(f => f.properties.exposure !== 'outside')),
    grid: bits(points.map(p => candidates(p).some(z => contains(p, z.geometry))))
  };
});
writeFileSync(output, JSON.stringify({node: process.version, results}));
