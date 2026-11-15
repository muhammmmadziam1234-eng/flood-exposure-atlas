import test from 'node:test';
import assert from 'node:assert/strict';
import {csvCell, toCsv, toGeoJSON, encodeState, decodeState} from '../codec.mjs';
import {extentOf, fitProjection, geometryPath} from '../view.mjs';

const result = (id, name, exposure, extra = {}) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [79.7, 7.01]},
  properties: {id, name, category: 'Health', exposure, matchedZones: [], ...extra}});

test('CSV has the documented columns, RFC 4180 quoting and CRLF line ends', () => {
  const csv = toCsv([
    result('S1', 'Harbour Clinic', 'high', {matchedZones: ['Floodway', 'Corridor, east'], baselineExposure: 'moderate', exposureChange: 1}),
    result('S2', 'Say "hi"\nthere', 'outside')
  ]);
  assert.equal(csv, [
    'id,name,category,lon,lat,exposure,baseline_exposure,change,matched_zones',
    'S1,Harbour Clinic,Health,79.7,7.01,high,moderate,1,"Floodway; Corridor, east"',
    'S2,"Say ""hi""\nthere",Health,79.7,7.01,outside,,,',
    ''
  ].join('\r\n'));
});

test('CSV cells that a spreadsheet would run as formulas are neutralised, numbers are not', () => {
  for (const text of ['=SUM(A1)', '+1', '-2', '@cmd', '\tx', '\rx']) assert.equal(csvCell(text).replace(/"/g, ''), "'" + text, JSON.stringify(text));
  assert.equal(csvCell('safe = fine'), 'safe = fine');
  assert.equal(csvCell(-79.7), '-79.7');
  assert.equal(csvCell(-1), '-1');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(null), '');
  const csv = toCsv([result('=1+1', '+cmd|calc', 'low', {matchedZones: ['-Zone'], category: '@x'})]);
  assert.equal(csv.split('\r\n')[1], "'=1+1,'+cmd|calc,'@x,79.7,7.01,low,,,'-Zone");
});

test('GeoJSON export keeps every property, including the comparison fields', () => {
  const features = [result('S1', 'A', 'high', {baselineExposure: 'low', exposureChange: 2})];
  const parsed = JSON.parse(toGeoJSON(features));
  assert.equal(parsed.type, 'FeatureCollection');
  assert.deepEqual(parsed.features, features);
});

test('URL state round-trips, leaves out defaults, and ignores anything it does not understand', () => {
  assert.equal(encodeState({scenario: 'baseline', level: 'all', site: null}), '');
  assert.equal(encodeState({scenario: 'expanded', level: 'high', site: 'S04'}), '#scenario=expanded&level=high&site=S04');
  assert.equal(encodeState({scenario: 'baseline', level: 'moderate', site: null}), '#level=moderate');
  assert.deepEqual(decodeState('#scenario=expanded&level=high&site=S04'), {scenario: 'expanded', level: 'high', site: 'S04'});
  assert.deepEqual(decodeState(''), {scenario: 'baseline', level: 'all', site: null});
  assert.deepEqual(decodeState('#scenario=bogus&level=extreme&site=&x=1'), {scenario: 'baseline', level: 'all', site: null});
  assert.deepEqual(decodeState('scenario=expanded'), {scenario: 'expanded', level: 'all', site: null});
  const odd = 'Café & Bar #1/ä';
  assert.equal(decodeState(encodeState({scenario: 'baseline', level: 'all', site: odd})).site, odd);
  assert.equal(decodeState('#site=' + 'x'.repeat(201)).site, null);
  assert.equal(decodeState('#site=%E0%A4%A').site === null || typeof decodeState('#site=%E0%A4%A').site === 'string', true);
});

test('the display projection fits the data inside the map and centres a single point', () => {
  const extent = [79.6, 6.9, 79.8, 7.1], project = fitProjection(extent, 1000, 680);
  const corners = [[79.6, 6.9], [79.8, 6.9], [79.6, 7.1], [79.8, 7.1]].map(project);
  for (const [x, y] of corners) assert.ok(x >= 0 && x <= 1000 && y >= 0 && y <= 680, JSON.stringify(corners));
  assert.ok(project([79.8, 7.1])[1] < project([79.6, 6.9])[1], 'north is up');
  assert.ok(project([79.8, 7.1])[0] > project([79.6, 6.9])[0], 'east is right');
  const [cx, cy] = fitProjection([10, 20, 10, 20], 1000, 680)([10, 20]);
  assert.deepEqual([cx, cy], [500, 340]);
});

test('extent covers points and zone outer rings, and path text follows the ring format of the map', () => {
  const sites = [{geometry: {type: 'Point', coordinates: [1, 2]}}, {geometry: {type: 'Point', coordinates: [5, -3]}}];
  const zones = [{geometry: {type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 8], [0, 0]]]}},
    {geometry: {type: 'MultiPolygon', coordinates: [[[[20, 1], [21, 1], [21, 2], [20, 1]]]]}}];
  assert.deepEqual(extentOf(sites, zones), [0, -3, 21, 8]);
  assert.equal(extentOf([], []), null);
  const ring = [[0, 0], [2, 0], [2, 2], [0, 0]], hole = [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 0.5]];
  assert.equal(geometryPath({type: 'Polygon', coordinates: [ring, hole]}, ([x, y]) => [x * 10, y * 10]),
    'M0.00 0.00 L20.00 0.00 L20.00 20.00 L0.00 0.00 Z M5.00 5.00 L10.00 5.00 L10.00 10.00 L5.00 5.00 Z');
  assert.equal(geometryPath({type: 'MultiPolygon', coordinates: [[ring], [hole]]}, p => p).split('Z').length - 1, 2);
});
