import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript'};
const assets=new Set(['index.html','style.css','app.mjs','geo.mjs','scenario.mjs']);
createServer(async (req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if (!assets.has(name)) {res.writeHead(404).end();return;}
  try {
    const body=await readFile(new URL('./'+name,import.meta.url));
    res.writeHead(200,{'Content-Type':types[name.slice(name.lastIndexOf('.'))]+'; charset=utf-8'}).end(body);
  } catch {res.writeHead(500).end();}
}).listen(Number(process.env.PORT||4173),'127.0.0.1',function(){
  console.log('Flood Exposure Atlas: http://127.0.0.1:'+this.address().port);
});
