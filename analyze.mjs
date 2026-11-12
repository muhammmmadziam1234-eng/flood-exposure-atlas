import {writeFile} from 'node:fs/promises';
import {analyze,compare} from './geo.mjs';
import {sites,zones,expandedZones} from './scenario.mjs';
const [output='exposure.geojson',mode='baseline']=process.argv.slice(2);
if(!['baseline','expanded'].includes(mode))throw new Error('Mode must be baseline or expanded.');
const result=mode==='expanded'?compare(sites,zones,expandedZones):analyze(sites,zones);
await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log('Wrote '+result.features.length+' classified sites to '+output+' ('+mode+').');
