import {analyze,compare} from './geo.mjs';
import {sites,zones,expandedZones,project,land,river,roads,width,height} from './scenario.mjs';
const baseline=analyze(sites,zones), expanded=compare(sites,zones,expandedZones);
let data=baseline;
const levels={outside:'Outside',low:'Low',moderate:'Moderate',high:'High'};
const $=id=>document.getElementById(id);
const map=$('map'), list=$('facilities'), filter=$('filter');
const ns='http://www.w3.org/2000/svg';
function svg(tag,attrs,parent=map){
  const node=document.createElementNS(ns,tag);
  for(const [k,v] of Object.entries(attrs)) node.setAttribute(k,v);
  parent.append(node);return node;
}
const path=points=>points.map(([x,y],i)=>(i?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)).join(' ')+' Z';
const defs=svg('defs',{}), clip=svg('clipPath',{id:'land-mask'},defs);
svg('path',{d:path(land)},clip);
svg('rect',{width,height,fill:'#174c5e'});
svg('path',{d:path(land),fill:'#e8e6d4',stroke:'#a9ad8d','stroke-width':3});
const terrain=svg('g',{'clip-path':'url(#land-mask)'});
for(let i=-6;i<23;i++){
  const y=i*38;
  svg('path',{d:'M 174 '+y+' Q 570 '+(y-76)+' 1040 '+(y+125),class:'contour'},terrain);
}
for(let i=0;i<30;i++){
  const x=170+i*34;
  svg('path',{d:'M '+x+' -10 Q '+(x+96)+' 280 '+(x-52)+' 690',class:'street'},terrain);
}
const zoneLayer=svg('g',{id:'map-zones'});
function renderZones(layer){
  zoneLayer.replaceChildren();
  for(const f of layer.features){
    const node=svg('path',{d:path(f.geometry.coordinates[0].map(project)),class:'zone '+f.properties.level},zoneLayer);
    svg('title',{},node).textContent=f.properties.name;
  }
}
renderZones(zones);
for(const d of roads){svg('path',{d,class:'road-border'},map);svg('path',{d,class:'road'});}
svg('path',{d:river,class:'river-bank'});svg('path',{d:river,class:'river'});
for(const [x,y,t,c] of [[65,401,'Alder Bay','water-label'],[318,283,'Westgate','place'],[595,155,'Northridge','place'],[799,393,'Eastbank','place'],[738,584,'Briar Marsh','place']])
  svg('text',{x,y,class:c}).textContent=t;
svg('path',{d:'M 914 597 v 29 h 51 v -8',class:'scale'});
svg('text',{x:917,y:648,class:'scale-label'}).textContent='200 m';
svg('path',{d:'M 941 58 l -9 23 9 -5 9 5 Z',fill:'#243a3b'});
svg('text',{x:936,y:53,class:'scale-label'}).textContent='N';
const markerLayer=svg('g',{});
let selected='S01', zoom=1;
const shown=()=>data.features.filter(f=>filter.value==='all'||f.properties.exposure===filter.value);
function el(tag,value,cls) {
  const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;return node;
}
function render(){
  const visible=shown();
  if(!visible.some(f=>f.properties.id===selected)) selected=visible[0]?.properties.id;
  $('count').textContent=visible.length+' shown';
  const focusId=document.activeElement?.dataset?.site;
  list.replaceChildren();markerLayer.replaceChildren();
  for(const f of visible){
    const {id,name,category,exposure}=f.properties, active=id===selected;
    const [cx,cy]=project(f.geometry.coordinates);
    const marker=svg('circle',{cx,cy,r:active?10:6,class:'marker '+exposure+(active?' selected':'')},markerLayer);
    svg('title',{},marker).textContent=name;
    marker.addEventListener('click',()=>{selected=id;render();view();});
    const button=el('button','', 'facility');button.type='button';button.dataset.site=id;
    button.setAttribute('aria-pressed',String(active));
    const info=el('span','');info.append(el('strong',name),el('small',category));
    button.append(info,el('span',levels[exposure],'level '+exposure));
    button.addEventListener('click',()=>{selected=id;render();view();});
    list.append(button);
  }
  if(focusId) list.querySelector('[data-site="'+focusId+'"]')?.focus({preventScroll:true});
  const item=visible.find(f=>f.properties.id===selected);
  const box=$('detail');box.replaceChildren();
  if(!item){box.append(el('p','No facilities match this filter.'));return;}
  const {name,matchedZones,baselineExposure,exposure}=item.properties;
  box.append(el('small','Selected facility'),el('h3',name),
    el('p',matchedZones.length?'Intersecting zones: '+matchedZones.join(', ')+'.':'Outside all modeled zones.'));
  if(baselineExposure)box.append(el('p','Baseline: '+levels[baselineExposure]+' / Expanded: '+levels[exposure]+'.','comparison'));
}
function view(){
  const target=data.features.find(f=>f.properties.id===selected);
  const [x,y]=target?project(target.geometry.coordinates):[width/2,height/2];
  const w=width/zoom,h=height/zoom;
  const clamp=(a,b)=>Math.max(0,Math.min(a,b));
  map.setAttribute('viewBox',[clamp(x-w/2,width-w),clamp(y-h/2,height-h),w,h].join(' '));
  $('zoom-in').disabled=zoom===3;$('zoom-out').disabled=zoom===1;
}
$('zoom-in').onclick=()=>{zoom=Math.min(3,zoom+0.5);view();};
$('zoom-out').onclick=()=>{zoom=Math.max(1,zoom-0.5);view();};
$('reset').onclick=()=>{zoom=1;view();};
filter.onchange=()=>{render();view();};
$('zones').onchange=e=>{zoneLayer.style.display=e.target.checked?'':'none';};
$('scenario').onchange=e=>{
  const alternative=e.target.value==='expanded';
  data=alternative?expanded:baseline;
  renderZones(alternative?expandedZones:zones);
  const changed=expanded.features.filter(f=>f.properties.exposureChange!==0).length;
  $('scenario-note').textContent=alternative?changed+' of '+expanded.features.length+' facilities change exposure from baseline.':'';
  render();view();
};
$('export').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify({type:'FeatureCollection',features:shown()},null,2)],{type:'application/geo+json'}));
  const a=document.createElement('a');a.href=url;a.download='alder-coast-exposure.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
render();view();
