export const severity = { outside: 0, low: 1, moderate: 2, high: 3 };

function ringLocation([x,y], ring) {
  let inside = false;
  for (let i=0,j=ring.length-2;i<ring.length-1;j=i++) {
    const [a,b]=ring[j], [c,d]=ring[i];
    if (Math.abs((x-a)*(d-b)-(y-b)*(c-a))<1e-12 &&
        x>=Math.min(a,c) && x<=Math.max(a,c) && y>=Math.min(b,d) && y<=Math.max(b,d)) return 'edge';
    if ((b>y)!==(d>y) && x<(c-a)*(y-b)/(d-b)+a) inside=!inside;
  }
  return inside ? 'inside' : 'outside';
}

export function contains(point, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] :
    geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(([outer,...holes]) => {
    const loc=ringLocation(point,outer);
    return loc==='edge' || (loc==='inside' && !holes.some(hole=>ringLocation(point,hole)==='inside'));
  });
}

function bounds({type,coordinates}){
  const rings=type==='Polygon'?[coordinates[0]]:coordinates.map(p=>p[0]);
  let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
  for(const ring of rings)for(const [x,y] of ring){
    west=Math.min(west,x);south=Math.min(south,y);east=Math.max(east,x);north=Math.max(north,y);
  }
  return [west,south,east,north];
}

// Grid lookups select candidates only; the polygon test makes the final decision.
export function zoneIndex(zones,step=.006){
  if(!Number.isFinite(step)||step<=0)throw new RangeError('Grid step must be positive.');
  const cells=new Map(), broad=[], tile=n=>Math.floor(n/step);
  for(const zone of zones){
    const [west,south,east,north]=bounds(zone.geometry).map(tile);
    if((east-west+1)*(north-south+1)>4096){broad.push(zone);continue;}
    for(let x=west;x<=east;x++)for(let y=south;y<=north;y++){
      const key=x+':'+y;
      if(!cells.has(key))cells.set(key,[]);
      cells.get(key).push(zone);
    }
  }
  return ([x,y])=>[...(cells.get(tile(x)+':'+tile(y))??[]),...broad];
}

export function analyze(sites,zones,{indexed=true}={}){
  const candidates=indexed?zoneIndex(zones.features):()=>zones.features;
  return {type:'FeatureCollection',features:sites.features.map(site=>{
    const point=site.geometry.coordinates;
    const matches=candidates(point).filter(zone=>contains(point,zone.geometry))
      .sort((a,b)=>severity[b.properties.level]-severity[a.properties.level] ||
        a.properties.name.localeCompare(b.properties.name));
    return {...site,properties:{...site.properties,exposure:matches[0]?.properties.level ?? 'outside',
      matchedZones:matches.map(zone=>zone.properties.name)}};
  })};
}

export function compare(sites,baselineZones,alternativeZones){
  const baseline=analyze(sites,baselineZones), alternative=analyze(sites,alternativeZones);
  return {type:'FeatureCollection',features:alternative.features.map((f,i)=>{
    const baselineExposure=baseline.features[i].properties.exposure;
    return {...f,properties:{...f.properties,baselineExposure,
      exposureChange:severity[f.properties.exposure]-severity[baselineExposure]}};
  })};
}
