// How far apart are a straight line in longitude/latitude and the great-circle path between the same two
// positions? This is the error that treating degrees as planar coordinates introduces for one polygon edge.
// East-west edges are the worst case: a meridian is itself a great circle, so a north-south edge has no gap.
// Spherical Earth (radius 6371 km). The great circle between two points at latitude phi, delta radians of longitude
// apart, reaches latitude atan(tan(phi) / cos(delta / 2)) at its midpoint.
//   node validation/planar-gap.mjs            prints the table
//   node validation/planar-gap.mjs --write    also writes docs/evidence/planar-gap.txt
import {writeFileSync} from 'node:fs';

const R = 6371000, lengthsKm = [1, 5, 25, 100], latitudes = [0, 30, 45, 60];
const gapMetres = (latitude, km) => {
  const phi = latitude * Math.PI / 180, delta = km * 1000 / (R * Math.cos(phi));
  return R * (Math.atan(Math.tan(phi) / Math.cos(delta / 2)) - phi);
};
const lines = [
  'Largest gap between a straight line in longitude/latitude and the great-circle path, for an east-west edge.',
  'Spherical Earth, radius 6371 km. Script: validation/planar-gap.mjs',
  '',
  'latitude | ' + lengthsKm.map(km => (km + ' km edge').padStart(11)).join(' | '),
  ...latitudes.map(lat => String(lat).padStart(3) + ' deg  | ' + lengthsKm.map(km => (gapMetres(lat, km).toFixed(1) + ' m').padStart(11)).join(' | '))
];
console.log(lines.join('\n'));
if (process.argv.includes('--write')) writeFileSync(new URL('../docs/evidence/planar-gap.txt', import.meta.url), lines.join('\n') + '\n');
