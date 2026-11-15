// Seeded randomized tests for the spatial engine. The generator is a 32-bit PRNG (mulberry32)
// so every run sees the same scenes; change a seed to explore different ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import {contains, analyze, compare, zoneIndex, severity} from '../geo.mjs';

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const LEVELS = ['low', 'moderate', 'high'];
const closed = pts => [...pts, pts[0]];
const rect = (x0, y0, x1, y1) => closed([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);

// ---- exact integer helpers: shape generation and an independent oracle ----
const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const onSegment = (a, b, c) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
function segmentsTouch(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(a, b, c)) || (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) || (o4 === 0 && onSegment(c, d, b));
}
function isSimple(pts) {
  const n = pts.length;
  if (n < 3 || new Set(pts.map(String)).size !== n) return false;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = pts[i], b = pts[(i + 1) % n], c = pts[j], d = pts[(j + 1) % n];
    if (j === i + 1 || (i === 0 && j === n - 1)) {
      const [s, p, q] = j === i + 1 ? [b, a, d] : [a, b, c];  // shared vertex and the two free ends
      if (orient(s, p, q) === 0 && (p[0] - s[0]) * (q[0] - s[0]) + (p[1] - s[1]) * (q[1] - s[1]) > 0) return false;
    } else if (segmentsTouch(a, b, c, d)) return false;
  }
  return true;
}
function hull(points) {
  const p = [...new Map(points.map(q => [String(q), q])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const build = list => {
    const out = [];
    for (const q of list) {
      while (out.length >= 2 && orient(out.at(-2), out.at(-1), q) <= 0) out.pop();
      out.push(q);
    }
    return out.slice(0, -1);
  };
  return [...build(p), ...build([...p].reverse())];
}
function randomConvex(r, cx, cy, span) {
  for (;;) {
    const pts = Array.from({length: int(r, 3, 9)}, () => [int(r, cx - span, cx + span), int(r, cy - span, cy + span)]);
    const h = hull(pts);
    if (h.length >= 3) return h;
  }
}
function randomStar(r, cx, cy, span) {
  for (;;) {
    const n = int(r, 5, 9), pts = [];
    for (let k = 0; k < n; k++) {
      const angle = (k + r() * 0.8) / n * 2 * Math.PI, radius = 1 + r() * (span - 1);
      pts.push([cx + Math.round(radius * Math.cos(angle)), cy + Math.round(radius * Math.sin(angle))]);
    }
    if (isSimple(pts)) return pts;
  }
}
// A shape is an array of polygons; a polygon is [shell, ...holes] with closed integer rings in [0, 20]^2.
function shape(r) {
  const kind = int(r, 0, 3), cx = int(r, 6, 14), cy = int(r, 6, 14), span = int(r, 3, 6);
  if (kind === 0) return [[closed(randomConvex(r, cx, cy, span))]];
  if (kind === 1) return [[closed(randomStar(r, cx, cy, span))]];
  if (kind === 2) return [[rect(cx - span, cy - span, cx + span, cy + span), closed(randomConvex(r, cx, cy, span - 2))]];
  return [[closed(randomConvex(r, cx - 5, cy, 2))], [closed(randomConvex(r, cx + 5, cy, 2))]];
}
function oracle(p, polygons) {
  const P = [p[0] * 2, p[1] * 2], scale = ring => ring.map(([x, y]) => [x * 2, y * 2]);
  const onBoundary = ring => ring.slice(1).some((b, i) => orient(ring[i], b, P) === 0 && onSegment(ring[i], b, P));
  const winding = ring => {
    let w = 0;
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i], b = ring[i + 1];
      if (a[1] <= P[1]) { if (b[1] > P[1] && orient(a, b, P) > 0) w++; }
      else if (b[1] <= P[1] && orient(a, b, P) < 0) w--;
    }
    return w;
  };
  return polygons.some(rings => {
    const rs = rings.map(scale);
    return rs.some(onBoundary) || (winding(rs[0]) !== 0 && rs.slice(1).every(hole => winding(hole) === 0));
  });
}
const geometryOf = (polygons, scale = 1) => {
  const f = ring => ring.map(([x, y]) => [x * scale, y * scale]);
  const coordinates = polygons.map(rings => rings.map(f));
  return polygons.length === 1 ? {type: 'Polygon', coordinates: coordinates[0]} : {type: 'MultiPolygon', coordinates};
};
const zoneOf = (name, level, geometry) => ({type: 'Feature', geometry, properties: {name, level}});
const collection = features => ({type: 'FeatureCollection', features});
const siteAt = (i, [x, y]) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [x, y]}, properties: {id: 'P' + i, name: 'P' + i, category: 'test'}});
const latticePoints = (polygons, margin = 1) => {
  const xs = polygons.flat(2).map(p => p[0]), ys = polygons.flat(2).map(p => p[1]), out = [];
  for (let x = Math.min(...xs) - margin; x <= Math.max(...xs) + margin; x += 0.5)
    for (let y = Math.min(...ys) - margin; y <= Math.max(...ys) + margin; y += 0.5) out.push([x, y]);
  return out;
};
const gcd = (a, b) => b ? gcd(b, a % b) : Math.abs(a);

test('engine agrees with an exact winding-number oracle on random integer polygons', () => {
  const r = mulberry32(11), seen = {inside: 0, outside: 0, boundary: 0};
  let checked = 0;
  for (let n = 0; n < 400; n++) {
    const polygons = shape(r), geometry = geometryOf(polygons);
    for (const p of latticePoints(polygons)) {
      const expected = oracle(p, polygons);
      assert.equal(contains(p, geometry), expected, 'polygon ' + n + ' point ' + p + ' ' + JSON.stringify(geometry));
      checked++; seen[expected ? 'inside' : 'outside']++;
    }
  }
  assert.ok(checked > 100000, 'only ' + checked + ' pairs');
  assert.ok(seen.inside > 10000 && seen.outside > 10000, JSON.stringify(seen));
});

test('a point exactly on a vertex or edge of an integer polygon is covered', () => {
  const r = mulberry32(12);
  let edgePoints = 0;
  for (let n = 0; n < 300; n++) {
    const polygons = shape(r), geometry = geometryOf(polygons);
    for (const ring of polygons.flat()) for (let i = 0; i + 1 < ring.length; i++) {
      const [a, b] = [ring[i], ring[i + 1]], g = gcd(b[0] - a[0], b[1] - a[1]);
      for (let k = 0; k <= g; k++) {
        const p = [a[0] + k * (b[0] - a[0]) / g, a[1] + k * (b[1] - a[1]) / g];
        assert.equal(contains(p, geometry), true, 'lattice point ' + p + ' on an edge of ' + JSON.stringify(geometry));
        edgePoints++;
      }
      assert.equal(contains([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], geometry), true, 'edge midpoint');
    }
  }
  assert.ok(edgePoints > 3000, 'only ' + edgePoints + ' boundary points');
});

test('moving a point into a hole flips it to outside, and the hole boundary stays covered', () => {
  const r = mulberry32(13);
  for (let n = 0; n < 200; n++) {
    const x0 = int(r, 0, 5), y0 = int(r, 0, 5), x1 = x0 + int(r, 7, 12), y1 = y0 + int(r, 7, 12);
    const hx0 = int(r, x0 + 1, x1 - 4), hy0 = int(r, y0 + 1, y1 - 4), hx1 = int(r, hx0 + 2, x1 - 1), hy1 = int(r, hy0 + 2, y1 - 1);
    const geometry = {type: 'Polygon', coordinates: [rect(x0, y0, x1, y1), rect(hx0, hy0, hx1, hy1)]};
    const y = (hy0 + hy1) / 2;
    for (let x = x0; x <= (hx0 + hx1) / 2; x += 0.5) {
      const inHole = x > hx0;
      assert.equal(contains([x, y], geometry), !inHole, 'x=' + x + ' hole ' + [hx0, hy0, hx1, hy1]);
    }
    assert.equal(contains([hx0, y], geometry), true, 'on the hole boundary');
    assert.equal(contains([hx0 + 0.5, y], geometry), false, 'half a unit inside the hole');
    assert.equal(contains([(hx0 + hx1) / 2, y], geometry), false, 'centre of the hole');
    assert.equal(contains([hx1 + 0.5, y], geometry), hx1 + 0.5 <= x1, 'back in the solid part');
  }
});

test('the grid never drops a candidate: every covering zone is shortlisted, for any cell size', () => {
  const r = mulberry32(14);
  for (let n = 0; n < 150; n++) {
    const zones = Array.from({length: int(r, 1, 6)}, (_, i) => zoneOf('Z' + i, 'low', geometryOf(shape(r))));
    const step = [0.25, 0.5, 1, 2, 3][int(r, 0, 4)], candidates = zoneIndex(zones, step);
    for (let x = -1; x <= 21; x += 0.5) for (let y = -1; y <= 21; y += 0.5) {
      const shortlisted = candidates([x, y]);
      for (const zone of zones) if (contains([x, y], zone.geometry))
        assert.ok(shortlisted.includes(zone), 'zone ' + zone.properties.name + ' missing at ' + [x, y] + ' step ' + step);
    }
  }
});

test('indexed analysis equals direct analysis on random scenes, with broad zones and points on cell edges', () => {
  const r = mulberry32(15), cell = 0.006;
  let broadZones = 0, covered = 0, onCellEdge = 0;
  for (let n = 0; n < 250; n++) {
    const zones = Array.from({length: int(r, 1, 7)}, (_, i) => {
      const level = LEVELS[int(r, 0, 2)];
      if (r() < 0.25) {  // wider than 64 cells, so it goes to the broad list; the apex sits inside the point area
        broadZones++;
        const apex = [int(r, 2, 40) * 0.001, int(r, 2, 40) * 0.001];
        const shell = closed([[-0.5, -0.5], [0.6, -0.4], apex]);
        return zoneOf('Broad ' + i, level, {type: 'Polygon', coordinates: [shell]});
      }
      return zoneOf('Zone ' + i, level, geometryOf(shape(r), 0.002));
    });
    const points = [];
    for (let i = 0; i < 70; i++) points.push([int(r, -2, 44) * 0.001, int(r, -2, 44) * 0.001]);
    for (let i = 0; i < 30; i++) { points.push([int(r, -1, 8) * cell, int(r, -1, 8) * cell]); onCellEdge++; }
    for (const z of zones) if (z.geometry.type === 'Polygon') points.push(z.geometry.coordinates[0][0]);
    const sites = collection(points.map((p, i) => siteAt(i, p)));
    const zoneSet = collection(zones), direct = analyze(sites, zoneSet, {indexed: false}), indexed = analyze(sites, zoneSet);
    assert.deepEqual(indexed, direct, 'scene ' + n);
    covered += direct.features.filter(f => f.properties.exposure !== 'outside').length;
  }
  assert.ok(broadZones > 100 && onCellEdge > 5000 && covered > 2000, [broadZones, onCellEdge, covered].join());
});

test('raising a zone level never lowers any exposure, and only changes sites that zone covers', () => {
  const r = mulberry32(16);
  let raised = 0;
  for (let n = 0; n < 250; n++) {
    const zones = Array.from({length: int(r, 2, 6)}, (_, i) => zoneOf('Z' + i, LEVELS[int(r, 0, 1)], geometryOf(shape(r))));
    const sites = collection(latticePoints(zones.flatMap(z => z.geometry.type === 'Polygon' ? [z.geometry.coordinates] : z.geometry.coordinates), 0)
      .filter((_, i) => i % 7 === 0).map((p, i) => siteAt(i, p)));
    const before = analyze(sites, collection(zones));
    const pick = int(r, 0, zones.length - 1), newLevel = LEVELS[int(r, LEVELS.indexOf(zones[pick].properties.level) + 1, 2)];
    const changed = zones.map((z, i) => i === pick ? zoneOf(z.properties.name, newLevel, z.geometry) : z);
    const after = analyze(sites, collection(changed));
    before.features.forEach((f, i) => {
      const g = after.features[i], covers = contains(f.geometry.coordinates, zones[pick].geometry);
      assert.ok(severity[g.properties.exposure] >= severity[f.properties.exposure], 'severity dropped for ' + f.properties.id);
      if (!covers) assert.deepEqual(g.properties, f.properties, 'a site outside the raised zone changed');
      else { assert.ok(severity[g.properties.exposure] >= severity[newLevel]); raised++; }
      assert.deepEqual([...g.properties.matchedZones].sort(), [...f.properties.matchedZones].sort(), 'raising a level must not change which zones match');
    });
  }
  assert.ok(raised > 500, 'only ' + raised + ' covered sites');
});

test('exposure is the highest matching level and matched zones list every covering zone', () => {
  const r = mulberry32(17);
  for (let n = 0; n < 100; n++) {
    const zones = Array.from({length: int(r, 1, 6)}, (_, i) => zoneOf('Z' + i, LEVELS[int(r, 0, 2)], geometryOf(shape(r))));
    const sites = collection(Array.from({length: 40}, (_, i) => siteAt(i, [int(r, -1, 42) / 2, int(r, -1, 42) / 2])));
    for (const f of analyze(sites, collection(zones)).features) {
      const hits = zones.filter(z => contains(f.geometry.coordinates, z.geometry));
      assert.deepEqual([...f.properties.matchedZones].sort(), hits.map(z => z.properties.name).sort());
      const top = Math.max(0, ...hits.map(z => severity[z.properties.level]));
      assert.equal(severity[f.properties.exposure], top);
    }
  }
});

test('degenerate, unclosed and unusual rings never throw and never invent coverage', () => {
  const square = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.equal(contains([2, 2], {type: 'Polygon', coordinates: [square]}), true, 'a ring missing its closing position is still a ring');
  assert.equal(contains([0, 0], {type: 'Polygon', coordinates: [square]}), true);
  assert.equal(contains([5, 2], {type: 'Polygon', coordinates: [square]}), false);
  for (const coordinates of [[], [[]], [[[0, 0], [1, 1]]], [[[0, 0], [1, 1], [0, 0]]]])
    assert.equal(contains([0, 0], {type: 'Polygon', coordinates}), false, JSON.stringify(coordinates));
  assert.equal(contains([0, 0], {type: 'Polygon', coordinates: [[[0, 0], [0, 0], [0, 0], [0, 0]]]}), true, 'a ring collapsed onto a point still covers that point');
  assert.equal(contains([1, 1], {type: 'Point', coordinates: [1, 1]}), false);
  assert.equal(contains([1, 1], null), false);
  assert.equal(contains([NaN, NaN], {type: 'Polygon', coordinates: [closed(square)]}), false);
});

test('a zone with unusable coordinates stays a candidate everywhere, so the grid matches a direct scan', () => {
  const good = zoneOf('Good', 'high', {type: 'Polygon', coordinates: [closed([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]])]});
  const broken = [
    zoneOf('NaN vertex', 'low', {type: 'Polygon', coordinates: [closed([[0, 0], [NaN, 0], [0.02, 0.02], [0, 0.02]])]}),
    zoneOf('Huge', 'moderate', {type: 'Polygon', coordinates: [closed([[1e300, 1e300], [1e300, 1.5e300], [1.5e300, 1.5e300]])]}),
    zoneOf('Empty', 'moderate', {type: 'Polygon', coordinates: []})
  ];
  const sites = collection([[0.005, 0.005], [0.015, 0.015], [5, 5], [NaN, 1]].map((p, i) => siteAt(i, p)));
  const zones = collection([good, ...broken]);
  assert.deepEqual(analyze(sites, zones), analyze(sites, zones, {indexed: false}));
  assert.equal(analyze(sites, zones).features[0].properties.exposure, 'high');
});

test('zones with an unknown level or no name are refused with a clear message', () => {
  const sites = collection([siteAt(0, [0, 0])]), geometry = {type: 'Polygon', coordinates: [rect(-1, -1, 1, 1)]};
  assert.throws(() => analyze(sites, collection([zoneOf('Z', 'severe', geometry)])), /level "severe"/);
  assert.throws(() => analyze(sites, collection([zoneOf('Z', 'outside', geometry)])), /expected low, moderate or high/);
  assert.throws(() => analyze(sites, collection([zoneOf(undefined, 'low', geometry)])), /no text name/);
  assert.throws(() => compare(sites, collection([zoneOf('Z', 'low', geometry)]), collection([zoneOf('Z', 'x', geometry)])), /level "x"/);
});

test('zones of one level are listed in a fixed, locale-independent order', () => {
  const geometry = {type: 'Polygon', coordinates: [rect(-1, -1, 1, 1)]}, sites = collection([siteAt(0, [0, 0])]);
  const names = ['Zone 9', 'zone b', 'Zone 10', 'Alder', 'alder north', 'Zone a'];
  const result = analyze(sites, collection(names.map(n => zoneOf(n, 'low', geometry)))).features[0];
  assert.deepEqual(result.properties.matchedZones, [...names].sort((a, b) => a.localeCompare(b, 'en')));
});

test('progress is reported in order, ends at the total, and does not change the result', () => {
  const r = mulberry32(18), zones = collection([zoneOf('Z', 'high', geometryOf(shape(r)))]);
  const sites = collection(Array.from({length: 1234}, (_, i) => siteAt(i, [int(r, 0, 20), int(r, 0, 20)])));
  const calls = [];
  const withProgress = analyze(sites, zones, {onProgress: (done, total) => calls.push([done, total])});
  assert.deepEqual(withProgress, analyze(sites, zones));
  assert.ok(calls.length >= 100 && calls.length <= 250, 'calls: ' + calls.length);
  assert.ok(calls.every(([done, total], i) => total === 1234 && done > (calls[i - 1]?.[0] ?? 0)));
  assert.deepEqual(calls.at(-1), [1234, 1234]);
  const both = [];
  compare(sites, zones, zones, {onProgress: (done, total) => both.push([done, total])});
  assert.deepEqual(both.at(-1), [2468, 2468]);
  assert.ok(both.every(([done, total], i) => total === 2468 && done > (both[i - 1]?.[0] ?? 0)));
  analyze(collection([]), zones, {onProgress: (done, total) => assert.deepEqual([done, total], [0, 0])});
});
