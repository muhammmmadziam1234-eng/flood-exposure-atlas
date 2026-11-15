import test from 'node:test';
import assert from 'node:assert/strict';
import {runJob} from '../job.mjs';
import {analyze, withChange, compare} from '../geo.mjs';
import {sites, zones, expandedZones} from '../scenario.mjs';

const fc = features => ({type: 'FeatureCollection', features});
const site = (id, lon, lat) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [lon, lat]}, properties: {id, name: id, category: 'Test'}});
const square = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
const zone = (name, level) => ({type: 'Feature', geometry: {type: 'Polygon', coordinates: [square]}, properties: {name, level}});
const run = job => { const messages = []; runJob(job, m => messages.push(m)); return messages; };

test('withChange gives the same result as compare', () => {
  const baseline = analyze(sites, zones);
  assert.deepEqual(withChange(baseline, analyze(sites, expandedZones)), compare(sites, zones, expandedZones));
});

test('imported facilities and zones are validated, analysed and reported with progress', () => {
  const messages = run({type: 'run', facilities: {text: JSON.stringify(fc([site('in', 2, 2), site('edge', 4, 4), site('out', 9, 9), site('bad', 999, 0)]))},
    zones: {text: JSON.stringify(fc([zone('Z', 'high')]))}});
  const result = messages.at(-1);
  assert.equal(result.type, 'result');
  assert.deepEqual(result.baseline.features.map(f => [f.properties.id, f.properties.exposure]), [['in', 'high'], ['edge', 'high'], ['out', 'outside']]);
  assert.equal(result.expanded, null, 'imported zones are one scenario');
  assert.deepEqual(result.reports.map(r => [r.layer, r.total, r.accepted, r.rejected]), [['facilities', 4, 3, 1], ['zones', 1, 1, 0]]);
  assert.equal(result.reports[0].problems[0].index, 3);
  assert.equal(result.sites.features.length, 3);
  assert.equal(result.zones.baseline.features.length, 1);
  assert.ok(result.elapsedMs >= 0);
  assert.deepEqual(messages.filter(m => m.type === 'status').map(m => m.message.split(' ')[0]), ['Checking', 'Checking', 'Analysing']);
  const progress = messages.filter(m => m.type === 'progress');
  assert.deepEqual(progress.at(-1), {type: 'progress', done: 3, total: 3});
});

test('imported facilities against the sample zones also return the expanded scenario', () => {
  const messages = run({type: 'run', facilities: {text: JSON.stringify(fc([site('a', 79.7, 7.0)]))}, zones: {baseline: zones, expanded: expandedZones}});
  const result = messages.at(-1);
  assert.equal(result.type, 'result');
  assert.equal(result.zones, undefined, 'zones were not imported, so they are not sent back');
  assert.equal(result.expanded.features.length, 1);
  assert.equal(result.expanded.features[0].properties.baselineExposure, result.baseline.features[0].properties.exposure);
  const last = messages.filter(m => m.type === 'progress').at(-1);
  assert.deepEqual([last.done, last.total], [2, 2], 'two passes over one facility');
});

test('a layer with nothing acceptable leaves the current data alone and reports why', () => {
  const messages = run({type: 'run', facilities: {text: JSON.stringify(fc([site('bad', 999, 0)]))}, zones: {baseline: zones, expanded: expandedZones}});
  assert.equal(messages.at(-1).type, 'rejected');
  assert.equal(messages.at(-1).reports[0].problems.length, 1);
  assert.ok(!messages.some(m => m.type === 'result' || m.type === 'progress'));
});

test('text that is not JSON or too large is reported as a problem, not thrown', () => {
  const broken = run({type: 'run', facilities: {text: '{"type":'}, zones: {baseline: zones, expanded: null}}).at(-1);
  assert.equal(broken.type, 'rejected');
  assert.match(broken.reports[0].problems[0].message, /^Not valid JSON/);
  const huge = run({type: 'run', facilities: {collection: sites}, zones: {text: ' '.repeat(5 * 1024 * 1024 + 1)}}).at(-1);
  assert.equal(huge.type, 'rejected');
  assert.match(huge.reports[0].problems[0].message, /limit is 5 MB/);
});
