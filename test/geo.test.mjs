import test from 'node:test';
import assert from 'node:assert/strict';
import {contains,analyze,compare,zoneIndex} from '../geo.mjs';
import {sites,zones,expandedZones} from '../scenario.mjs';
const square=(x,y,s)=>[[x,y],[x+s,y],[x+s,y+s],[x,y+s],[x,y]];
test('polygon boundaries and hole interiors follow the documented convention',()=>{
  const g={type:'Polygon',coordinates:[square(0,0,10),square(2,2,3)]};
  for(const p of [[0,5],[9,9],[2,4],[10,10]]) assert.equal(contains(p,g),true);
  for(const p of [[3,3],[11,1]]) assert.equal(contains(p,g),false);
});
test('multipolygon searches every part',()=>{
  const g={type:'MultiPolygon',coordinates:[[square(0,0,1)],[square(2,2,1)]]};
  assert.equal(contains([2.5,2.5],g),true);
  assert.equal(contains([1.5,1.5],g),false);
});
test('spatial join handles overlaps and does not modify inputs',()=>{
  const results=analyze(sites,zones).features;
  const clinic=results.find(f=>f.properties.id==='S01');
  assert.equal(clinic.properties.exposure,'high');
  assert.equal(clinic.properties.matchedZones.length,3);
  assert.equal(results.find(f=>f.properties.id==='S07').properties.exposure,'outside');
  assert.equal(results.length,sites.features.length);
  assert.ok(sites.features.every(f=>f.properties.exposure===undefined));
});
test('grid retains candidates at cell edges and for broad polygons',()=>{
  const f=ring=>({geometry:{type:'Polygon',coordinates:[ring]}});
  const local=f(square(-.25,-.25,.5)), broad=f(square(-100,-60,150));
  const candidates=zoneIndex([local,broad],.01);
  assert.deepEqual(candidates([.25,.25]),[local,broad]);
  assert.deepEqual(candidates([10,10]),[broad]);
  assert.deepEqual(analyze(sites,zones),analyze(sites,zones,{indexed:false}));
});
test('scenario comparison preserves baseline class and computes signed change',()=>{
  const results=compare(sites,zones,expandedZones);
  const baseline=analyze(sites,zones).features;
  assert.ok(results.features.some(f=>f.properties.exposureChange>0));
  assert.ok(results.features.some(f=>f.properties.exposureChange===0));
  assert.deepEqual(results.features.map(f=>f.properties.baselineExposure),baseline.map(f=>f.properties.exposure));
});
