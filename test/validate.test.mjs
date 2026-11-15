import test from 'node:test';
import assert from 'node:assert/strict';
import {LIMITS, checkSize, parseGeoJSON, validateFacilities, validateZones} from '../validate.mjs';

const fc = features => ({type: 'FeatureCollection', features});
const site = (id, lon = 79.7, lat = 7.0, properties = {}) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [lon, lat]},
  properties: {id, name: 'Name ' + id, category: 'Health', ...properties}});
const square = (x = 0, y = 0, s = 1) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
const zone = (name = 'Zone A', level = 'high', coordinates = [square()], type = 'Polygon') =>
  ({type: 'Feature', geometry: {type, coordinates}, properties: {name, level}});
const only = (result, i = 0) => result.problems[i];

test('a valid facilities file is accepted and normalised', () => {
  const input = fc([{...site(' S1 ', 79.7, 7.0), geometry: {type: 'Point', coordinates: [79.7, 7.0, 12.5]},
    properties: {id: ' S1 ', name: ' Clinic ', category: 'Health', owner: 'dropped'}}]);
  const result = validateFacilities(input);
  assert.deepEqual(result.problems, []);
  assert.equal(result.total, 1);
  assert.equal(result.rejected, 0);
  assert.deepEqual(result.features, [{type: 'Feature', geometry: {type: 'Point', coordinates: [79.7, 7.0]},
    properties: {id: 'S1', name: 'Clinic', category: 'Health'}}]);
});

test('facility problems name the feature, the field and what was wrong', () => {
  const cases = [
    [site('a', 79.7, 7.0, {id: 12}), 'properties.id', /Expected a string, found 12/],
    [site('a', 79.7, 7.0, {id: '  '}), 'properties.id', /Must not be empty/],
    [site('a', 79.7, 7.0, {name: undefined}), 'properties.name', /found nothing/],
    [site('a', 79.7, 7.0, {category: 'x'.repeat(201)}), 'properties.category', /201 characters; the limit is 200/],
    [{...site('a'), properties: null}, 'properties', /found null/],
    [{...site('a'), type: 'Point'}, 'type', /Expected "Feature", found "Point"/],
    [{...site('a'), geometry: null}, 'geometry', /Expected a Point geometry, found null/],
    [{...site('a'), geometry: {type: 'LineString', coordinates: [[0, 0], [1, 1]]}}, 'geometry.type', /Expected "Point", found "LineString"/],
    [{...site('a'), geometry: {type: 'Point', coordinates: 'x'}}, 'geometry.coordinates', /Expected \[longitude, latitude\]/],
    [{...site('a'), geometry: {type: 'Point', coordinates: [1]}}, 'geometry.coordinates', /an array with 1 element\./],
    [{...site('a'), geometry: {type: 'Point', coordinates: [1, 2, 3, 4]}}, 'geometry.coordinates', /an array with 4 elements/],
    [{...site('a'), geometry: {type: 'Point', coordinates: ['79.7', 7]}}, 'geometry.coordinates[0]', /finite number, found "79.7"/],
    [{...site('a'), geometry: {type: 'Point', coordinates: [NaN, 7]}}, 'geometry.coordinates[0]', /found NaN/],
    [site('a', 200, 7), 'geometry.coordinates[0]', /Longitude 200 is outside -180 to 180/],
    [site('a', 79, -90.5), 'geometry.coordinates[1]', /Latitude -90.5 is outside -90 to 90/],
    ['text', '(feature)', /Expected a Feature object, found a string|found "text"/],
    [null, '(feature)', /found null/]
  ];
  for (const [feature, field, message] of cases) {
    const result = validateFacilities(fc([site('ok'), feature]));
    assert.equal(result.features.length, 1, field);
    assert.equal(result.rejected, 1, field);
    assert.equal(only(result).index, 1, field);
    assert.equal(only(result).field, field);
    assert.match(only(result).message, message, field);
  }
});

test('one feature can report several problems, and a duplicate id is judged against accepted features only', () => {
  const result = validateFacilities(fc([site('a', 500, 7), site('a'), site('a'), site('b', 79.7, 7.0, {name: ''}), site('b')]));
  assert.deepEqual(result.features.map(f => f.properties.id), ['a', 'b']);
  assert.deepEqual(result.problems.map(p => [p.index, p.field]), [[0, 'geometry.coordinates[0]'], [2, 'properties.id'], [3, 'properties.name']]);
  assert.match(result.problems[1].message, /Duplicate id "a" \(first used by feature 1\)/);
  assert.equal(result.total, 5);
  assert.equal(result.rejected, 3);
  const both = validateFacilities(fc([{...site('x', 0, 0), properties: {}}]));
  assert.deepEqual(both.problems.map(p => p.field), ['properties.id', 'properties.name', 'properties.category']);
});

test('a file that is not a feature collection is refused as a whole', () => {
  for (const [input, field, message] of [
    [[], '(file)', /Expected a GeoJSON FeatureCollection object, found an array/],
    [null, '(file)', /found null/],
    [{type: 'Feature'}, 'type', /Expected "FeatureCollection", found "Feature"/],
    [{type: 'FeatureCollection'}, 'features', /must be an array/],
    [{type: 'FeatureCollection', features: {}}, 'features', /must be an array/]
  ]) for (const validate of [validateFacilities, validateZones]) {
    const result = validate(input);
    assert.deepEqual(result.features, []);
    assert.equal(only(result).index, null);
    assert.equal(only(result).field, field);
    assert.match(only(result).message, message);
  }
});

test('limits: more than 100,000 features is refused with a clear message, the cap on listed problems is reported', () => {
  assert.equal(LIMITS.maxFeatures, 100000);
  assert.equal(LIMITS.maxBytes, 5 * 1024 * 1024);
  const big = validateFacilities(fc(new Array(100001).fill(site('a'))));
  assert.equal(big.features.length, 0);
  assert.equal(big.total, 100001);
  assert.match(only(big).message, /100,001 features; the limit is 100,000\. Split it into smaller files/);
  assert.equal(validateFacilities(fc(Array.from({length: 100000}, (_, i) => site('s' + i)))).features.length, 100000);
  const noisy = validateFacilities(fc(Array.from({length: 1500}, () => site('a', 999, 0))));
  assert.equal(noisy.problems.length, LIMITS.maxProblems);
  assert.equal(noisy.omittedProblems, 500);
  assert.equal(noisy.rejected, 1500);
});

test('file size and JSON text are checked before validation', () => {
  assert.equal(checkSize(5 * 1024 * 1024), null);
  assert.match(checkSize(5 * 1024 * 1024 + 1).message, /5\.0 MB; the limit is 5 MB/);
  assert.equal(checkSize(5 * 1024 * 1024 + 1).index, null);
  assert.deepEqual(parseGeoJSON('﻿{"a":1}'), {value: {a: 1}});
  const bad = parseGeoJSON('{"type": ');
  assert.equal(bad.problem.field, '(file)');
  assert.match(bad.problem.message, /^Not valid JSON: /);
});

test('a valid zones file accepts polygons with holes and multipolygons', () => {
  const withHole = zone('Hole', 'moderate', [square(0, 0, 10), square(2, 2, 3).reverse()]);
  const multi = zone('Multi', 'low', [[square(0, 0, 1)], [square(5, 5, 1)]], 'MultiPolygon');
  const result = validateZones(fc([zone(), withHole, multi]));
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.features.map(f => f.properties), [{name: 'Zone A', level: 'high'}, {name: 'Hole', level: 'moderate'}, {name: 'Multi', level: 'low'}]);
});

test('zone problems point at the exact ring and position', () => {
  const cases = [
    [zone('Z', 'severe'), 'properties.level', /one of low, moderate, high \(found "severe"\)/],
    [zone('Z', 'High'), 'properties.level', /found "High"/],
    [{...zone('Z', 'low'), properties: {level: 'low'}}, 'properties.name', /found nothing/],
    [zone('Z', 'low', [square().slice(0, 3)]), 'geometry.coordinates[0]', /3 positions; a closed ring needs at least 4/],
    [zone('Z', 'low', [[[0, 0], [1, 0], [1, 1], [0, 1]]]), 'geometry.coordinates[0]', /not closed/],
    [zone('Z', 'low', [square(), [[2, 2], [3, 2], [3, 3]]]), 'geometry.coordinates[1]', /The hole has 3 positions/],
    [zone('Z', 'low', [[[0, 0], [1, 0], [2, 0], [0, 0]]]), 'geometry.coordinates[0]', /zero area/],
    [zone('Z', 'low', [[[0, 0], [1, 0], [1, 95], [0, 0]].concat([[0, 0]])]), 'geometry.coordinates[0][2][1]', /Latitude 95/],
    [zone('Z', 'low', [[[0, 0], [1, 'x'], [1, 1], [0, 0]]]), 'geometry.coordinates[0][1][1]', /finite number, found "x"/],
    [zone('Z', 'low', [[[179, 0], [-179, 0], [-179, 1], [179, 0]]]), 'geometry.coordinates[0][1]', /jumps 358 degrees of longitude.*antimeridian/],
    [zone('Z', 'low', [], 'Polygon'), 'geometry.coordinates', /at least one ring/],
    [zone('Z', 'low', [], 'MultiPolygon'), 'geometry.coordinates', /at least one polygon/],
    [zone('Z', 'low', [[square(), square(0, 0, 400)]], 'MultiPolygon'), 'geometry.coordinates[0][1][1][0]', /Longitude 400/],
    [{...zone(), geometry: {type: 'Point', coordinates: [0, 0]}}, 'geometry.type', /Expected "Polygon" or "MultiPolygon", found "Point"/],
    [{...zone(), geometry: null}, 'geometry', /found null/]
  ];
  for (const [feature, field, message] of cases) {
    const result = validateZones(fc([zone('OK'), feature]));
    assert.equal(result.features.length, 1, field);
    assert.equal(only(result).index, 1, field);
    assert.equal(only(result).field, field);
    assert.match(only(result).message, message, field);
  }
});

test('only the first bad position of a ring is reported, so a bad file cannot flood the list', () => {
  const ring = Array.from({length: 50}, (_, i) => [i, 999]);
  const result = validateZones(fc([zone('Z', 'low', [[...ring, ring[0]]])]));
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].field, 'geometry.coordinates[0][0][1]');
});
