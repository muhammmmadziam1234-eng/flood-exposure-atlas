// The example files in sample/ are what the README tells people to try, so they are checked like code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFacilities, validateZones} from '../validate.mjs';
import {analyze} from '../geo.mjs';

const load = name => JSON.parse(readFileSync(new URL('../sample/' + name + '.geojson', import.meta.url), 'utf8'));

test('the example zones and facilities import without a problem and cover every exposure level', () => {
  const zones = validateZones(load('zones')), sites = validateFacilities(load('facilities'));
  assert.deepEqual([zones.problems, sites.problems], [[], []]);
  assert.deepEqual([zones.features.length, sites.features.length], [3, 12]);
  const exposures = analyze({type: 'FeatureCollection', features: sites.features}, {type: 'FeatureCollection', features: zones.features})
    .features.map(f => f.properties.exposure);
  for (const level of ['high', 'moderate', 'low', 'outside']) assert.ok(exposures.includes(level), level + ' missing from ' + exposures);
  const lagoon = analyze({type: 'FeatureCollection', features: sites.features.filter(f => f.properties.id === 'F03')}, {type: 'FeatureCollection', features: zones.features});
  assert.equal(lagoon.features[0].properties.exposure, 'outside', 'the facility inside the lagoon (a hole) is not covered');
});

test('the example file with errors loses exactly the four bad features and says why', () => {
  const result = validateFacilities(load('facilities-with-errors'));
  assert.equal(result.features.length, 12);
  assert.deepEqual(result.problems.map(p => [p.index, p.field]), [[12, 'properties.id'], [13, 'geometry.coordinates[0]'], [14, 'properties.name'], [15, 'geometry.type']]);
});
