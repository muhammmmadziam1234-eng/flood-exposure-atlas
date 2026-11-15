import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.woff2':'font/woff2'};
const assets=new Set(['index.html','style.css','app.mjs','geo.mjs','scenario.mjs','validate.mjs','codec.mjs','view.mjs','job.mjs','worker.mjs','fonts/gelasio-bold.woff2']);
createServer(async (req,res)=>{
  if (req.method!=='GET'&&req.method!=='HEAD') {res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
  let name;
  try {name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';}
  catch {res.writeHead(400).end();return;}
  if (!assets.has(name)) {res.writeHead(404).end();return;}
  try {
    const body=await readFile(new URL('./'+name,import.meta.url));
    res.writeHead(200,{'Content-Type':types[name.slice(name.lastIndexOf('.'))],'X-Content-Type-Options':'nosniff'}).end(body);
  } catch {res.writeHead(500).end();}
}).listen(Number(process.env.PORT||4173),'127.0.0.1',function(){
  console.log('Flood Exposure Atlas: http://127.0.0.1:'+this.address().port);
});
