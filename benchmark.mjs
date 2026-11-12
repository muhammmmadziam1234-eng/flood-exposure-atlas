import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {analyze} from './geo.mjs';
const collection=features=>({type:'FeatureCollection',features});
const points=[], zones=[];
for(let y=0;y<25;y++)for(let x=0;x<40;x++){
  const lon=79+x*.006,lat=7+y*.006,d=.002;
  const ring=[[lon,lat],[lon+d,lat],[lon+d,lat+d],[lon,lat+d],[lon,lat]];
  zones.push({type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{name:'Zone '+zones.length,level:'moderate'}});
  for(let i=0;i<6;i++){
    const coords=[lon+i*.001,lat+i*.0007];
    points.push({type:'Feature',geometry:{type:'Point',coordinates:coords},properties:{id:'S'+points.length}});
  }
}
function run(indexed){
  const start=performance.now(), result=analyze(collection(points),collection(zones),{indexed});
  return {ms:performance.now()-start,result};
}
const direct=run(false), grid=run(true);
assert.deepEqual(grid.result,direct.result);
console.log(points.length+' points, '+zones.length+' polygons. Indexed and direct outputs match.');
console.log('Direct: '+direct.ms.toFixed(1)+' ms | grid: '+grid.ms.toFixed(1)+' ms (single run, illustrative).');
