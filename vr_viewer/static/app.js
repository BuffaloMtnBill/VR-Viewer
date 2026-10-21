import * as THREE from 'three';
import {WorkspaceLink} from './link.js';
import {ModelViewer} from './viewer.js';
import {createVR} from './vr.js';
const $=id=>document.getElementById(id),link=new WorkspaceLink();let viewer,vr,toastTimer,currentModel=null,applying=Promise.resolve(),wire=false;
function notify(message,error=false){$('toast').textContent=message;$('toast').hidden=false;$('toast').classList.toggle('error',error);clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?7000:3500);vr?.notify(message);}
const act=command=>link.action(command).catch(()=>{});
// What is shown fills about 55 cm of the table: the scene's bounds, or the part shown alone.
function shownSize(state){if(state.stage==='object')return state.model.dimensions_mm;const objects=state.scene.objects;return [0,1,2].map(k=>Math.max(...objects.map(o=>o.bounds_mm[1][k]))-Math.min(...objects.map(o=>o.bounds_mm[0][k])));}
function fit(){if(!link.state)return;const dimensions=shownSize(link.state);const transform={position:[0,1.12,-.85],quaternion:[0,0,0,1],scale:.55/Math.max(...dimensions)};viewer?.transform(transform,true);viewer?.fitCamera();return act({type:'transform',transform});}
// Opening a model file on the computer (path relative to the browser's root): as the scene, or added beside it.
function openFile(path,mode='open',units='mm'){return link.command('/api/files/open',{path,mode,units});}
try{viewer=new ModelViewer($('viewport'));vr=createVR(viewer,link,{fit,notify,openFile,presenting:value=>{$('enter-vr').textContent=value?'In VR · use headset':'Enter VR ◉';}});viewer.onFrame=(time,frame)=>vr.update(time,frame);vr.attachButton($('enter-vr'));}
catch(error){$('viewer-error').hidden=false;$('viewer-error').textContent='The 3D view needs WebGL. '+error.message;}
const fileName=path=>String(path||'').split(/[\\/]/).pop();
// The scene's parts, grouped by category: click to select, double-click to view alone.
function drawScene(state){
  const object=state.stage==='object',list=$('part-list'),selected=state.selected;
  document.documentElement.classList.toggle('stage-scene',!object);document.documentElement.classList.toggle('stage-object',object);
  $('scene-heading').textContent=object?`Viewing ${state.model.name}`:state.scene.name;
  const groups=new Map();for(const item of state.scene.objects){const key=item.category||'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  list.replaceChildren();
  for(const [category,items] of groups){
    if(groups.size>1||category)list.append(div('part-group',category||'Other'));
    for(const item of items){
      const row=document.createElement('button');row.className='part-row';row.setAttribute('role','option');row.dataset.object=item.id;
      row.setAttribute('aria-selected',String(item.id===(object?state.model.object_id:selected)));
      if(item.color){const swatch=document.createElement('i');swatch.className='swatch';swatch.style.background=item.color;row.append(swatch);}
      const name=document.createElement('b');name.textContent=item.name;row.append(name);
      const size=document.createElement('small');size.textContent=item.triangles.toLocaleString()+' △'+(item.source_triangles!==item.triangles?' (simplified)':'');row.append(size);
      row.title=[item.name,item.source_file&&`File: ${item.source_file}`,item.print_file&&`Print file: ${item.print_file}`,item.source_triangles!==item.triangles&&`Simplified for VR from ${item.source_triangles.toLocaleString()} triangles`].filter(Boolean).join('\n');
      row.addEventListener('click',()=>object?act({type:'stage',stage:'object',object_id:item.id}):act({type:'select',object_id:item.id}));
      row.addEventListener('dblclick',()=>act({type:'stage',stage:'object',object_id:item.id}));
      list.append(row);
    }
  }
  $('view-part').disabled=!selected;$('remove-part').disabled=!selected||state.scene.objects.length<2;
  const chosen=state.scene.objects.find(o=>o.id===selected);$('part-color').disabled=!chosen;if(document.activeElement!==$('part-color'))$('part-color').value=chosen?.color||'#e3e3e3';
  $('import-model').title=object?'Return to the scene to add parts':'Upload files from this device';
}
function div(className,text){const node=document.createElement('div');node.className=className;if(text!==undefined)node.textContent=text;return node;}
// The selected part (or the one shown alone): its size, mesh, and where it came from.
function drawDetails(state){
  const item=state.scene.objects.find(o=>o.id===(state.stage==='object'?state.model.object_id:state.selected)),list=$('part-details');list.replaceChildren();
  $('detail-name').textContent=item?item.name:'Nothing selected';$('detail-note').textContent=item?(state.stage==='object'?'Shown on its own.':'Selected in the scene.'):'Click a part to see its details.';
  if(!item)return;
  const rows=[['Size',item.dimensions_mm.map(d=>d.toFixed(1)).join(' × ')+' mm'],['Triangles',item.triangles.toLocaleString()+(item.source_triangles>item.triangles?` (of ${item.source_triangles.toLocaleString()})`:'')],
    ['Mesh',item.watertight?'Closed (watertight)':'Has open edges'],item.category&&['Category',item.category],item.print_file&&['Print file',fileName(item.print_file)],item.source_file&&['File',item.source_file]].filter(Boolean);
  for(const [label,value] of rows){const term=document.createElement('dt');term.textContent=label;const detail=document.createElement('dd');detail.textContent=value;list.append(term,detail);}
}
link.addEventListener('state',({detail:state})=>{
  if(viewer?.modelId&&(viewer.modelId!==state.model.id||viewer.stage!==state.stage))vr?.cancelInteraction();
  $('last-change').textContent=state.updated_by?'Updated by '+state.updated_by:'This computer';
  drawScene(state);drawDetails(state);
  const object=state.stage==='object',dimensions=shownSize(state),files=state.scene.source?.files||[];
  $('view-badge').textContent=object?'ONE PART':`SCENE · ${state.scene.objects.length} PARTS`;
  $('view-hint').textContent=object?'Drag to orbit · right-drag to pan · scroll to zoom · Escape for the scene':'Click a part to select it · double-click to view it alone · drag to orbit';
  $('model-eyebrow').textContent=object?`ONE PART · ${state.scene.name.toUpperCase()}`:'SHARED SCENE';
  $('model-name').textContent=object?state.model.name:state.scene.name;$('model-dimensions').textContent=dimensions.map(n=>Number(n.toFixed(1))).join(' × ')+' mm';
  $('source-file').textContent=files.length===1?fileName(files[0]):files.length?`${files.length} files`:'';$('source-file').title=files.join('\n');
  $('model-stats').textContent=object?state.model.triangles.toLocaleString()+' triangles · '+(state.model.watertight?'closed mesh':'has open edges'):`${state.scene.objects.length} parts · ${state.scene.objects.reduce((n,o)=>n+o.triangles,0).toLocaleString()} triangles`;
  applying=applying.then(async()=>{if(!viewer)return;const latest=link.state,before=viewer.sceneKey;if(!await viewer.show(latest))return;
    currentModel=latest.model.id;viewer.transform(latest.transform);if(viewer.sceneKey!==before)viewer.fitCamera();viewer.wireframe(wire);}).catch(error=>notify(error.message,true));
});
link.addEventListener('connection',({detail})=>{$('connection-state').textContent=detail;$('connection-dot').classList.toggle('live',detail==='Live sync');});
link.addEventListener('presence',({detail})=>$('peer-count').textContent=detail+(detail===1?' device':' devices'));
link.addEventListener('error',({detail})=>notify(detail,true));
$('fit-view').addEventListener('click',fit);
$('turn-model').addEventListener('click',()=>{if(!viewer||!link.state)return;const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/4);viewer.pivot.quaternion.premultiply(q);act({type:'transform',transform:viewer.currentTransform()});});
for(const [id,ratio] of [['zoom-in',1.2],['zoom-out',1/1.2]])$(id).addEventListener('click',()=>{if(!viewer||!link.state)return;viewer.pivot.scale.setScalar(THREE.MathUtils.clamp(viewer.pivot.scale.x*ratio,.00001,1));act({type:'transform',transform:viewer.currentTransform()});});
$('wireframe').addEventListener('click',()=>{wire=!wire;viewer?.wireframe(wire);$('wireframe').setAttribute('aria-pressed',String(wire));});
$('connect-headset').addEventListener('click',()=>$('headset-dialog').showModal());$('close-headset').addEventListener('click',()=>$('headset-dialog').close());

// ---------- the file browser: folders and model files on the computer running VR-Viewer ----------
let filesMode='open',folder=null;
function setFilesMode(mode){filesMode=mode;document.querySelectorAll('[data-files]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.files===mode)));
  $('files-title').textContent=mode==='add'?'Add a part.':'Open a model.';$('files-eyebrow').textContent=mode==='add'?'ADD BESIDE THE SCENE':'OPEN A MODEL';
  $('open-folder').textContent=mode==='add'?'Add every model here':'Open every model here';}
document.querySelectorAll('[data-files]').forEach(b=>b.addEventListener('click',()=>setFilesMode(b.dataset.files)));
const sizeOf=bytes=>bytes<1e6?`${Math.max(1,Math.round(bytes/1e3))} kB`:`${(bytes/1e6).toFixed(bytes<1e7?1:0)} MB`;
async function browse(path=null){
  const list=$('file-list');
  try{
    folder=await link.request(path===null?'/api/files':`/api/files?path=${encodeURIComponent(path)}`);
    $('files-root').textContent=`Showing ${folder.root} and the folders in it. Files are read, never changed.`;
    // Where you are: each folder from the root, to go back up to.
    const crumbs=$('files-crumbs');crumbs.replaceChildren();const parts=folder.path?folder.path.split('/'):[];
    [[folder.root,''],...parts.map((name,i)=>[name,parts.slice(0,i+1).join('/')])].forEach(([name,target],i,all)=>{
      if(i)crumbs.append(Object.assign(document.createElement('span'),{textContent:'/'}));
      const button=document.createElement('button');button.textContent=name;button.disabled=i===all.length-1;button.addEventListener('click',()=>browse(target));crumbs.append(button);});
    list.replaceChildren();
    const row=(className,icon,name,detail,press,title)=>{const button=document.createElement('button');button.className=`file-row ${className}`;button.setAttribute('role','listitem');button.title=title||name;
      const i=document.createElement('i');i.textContent=icon;const b=document.createElement('b');b.textContent=name;button.append(i,b);
      if(detail){const small=document.createElement('small');small.textContent=detail;button.append(small);}
      button.addEventListener('click',press);list.append(button);return button;};
    if(folder.parent!==null)row('up','↰','Up a folder',null,()=>browse(folder.parent));
    for(const entry of folder.folders)row('folder','▸',entry.name,null,()=>browse(entry.path));
    for(const file of folder.files)row('model','◆',file.name,sizeOf(file.size),async event=>{const button=event.currentTarget;button.disabled=true;
      try{await openFile(file.path,filesMode,$('files-units').value);$('files-dialog').close();notify(filesMode==='add'?`${file.name} added to the scene.`:`${file.name} opened.`);}catch{button.disabled=false;}});
    if(!folder.folders.length&&!folder.files.length)list.append(Object.assign(document.createElement('p'),{className:'empty-note',textContent:'No folders or STL, OBJ or 3MF files here.'}));
    if(folder.truncated)list.append(Object.assign(document.createElement('p'),{className:'empty-note',textContent:'Only the first 500 are shown.'}));
    $('open-folder').disabled=!folder.files.length;$('open-folder').title=folder.files.length?`${folder.files.length} model files, each one part`:'';
  }catch(error){list.replaceChildren(Object.assign(document.createElement('p'),{className:'empty-note',textContent:error.message}));}
}
function showFiles(mode){setFilesMode(mode);$('files-dialog').showModal();browse(folder?.path??null);}
$('open-folder').addEventListener('click',async()=>{if(!folder)return;$('open-folder').disabled=true;
  try{await openFile(folder.path,filesMode,$('files-units').value);$('files-dialog').close();notify(`${folder.name}: ${folder.files.length} files ${filesMode==='add'?'added':'opened'}.`);}catch{/* The connection reports the exact error. */}finally{$('open-folder').disabled=false;}});
$('open-files').addEventListener('click',()=>showFiles('open'));$('add-part').addEventListener('click',()=>showFiles('add'));$('close-files').addEventListener('click',()=>$('files-dialog').close());

// ---------- uploading from this device ----------
let importMode='add';
function setImportMode(mode){importMode=mode;document.querySelectorAll('[data-import]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.import===mode)));
  $('import-note').textContent=mode==='open'?'The files become a new scene.':'Added parts stand in a row beside the scene.';}
document.querySelectorAll('[data-import]').forEach(b=>b.addEventListener('click',()=>setImportMode(b.dataset.import)));
$('import-model').addEventListener('click',()=>{setImportMode(link.state?.stage==='object'?'open':'add');$('import-dialog').showModal();});
$('close-import').addEventListener('click',()=>$('import-dialog').close());$('choose-file').addEventListener('click',()=>$('model-file').click());
$('model-file').addEventListener('change',async event=>{const files=[...event.target.files];event.target.value='';if(!files.length)return;if(files.reduce((n,f)=>n+f.size,0)>30*1024*1024){notify('Choose files smaller than 30 MB together, or open them with Open… on the computer.',true);return;}
  const data=new FormData();for(const file of files)data.append('model',file);data.append('units',$('import-units').value);data.append('mode',importMode);
  try{await link.command('/api/models',data,true);$('import-dialog').close();notify(importMode==='open'?'Scene opened on every connected device.':'Parts added on every connected device.');}catch{/* The connection reports the exact error. */}});
$('load-demo').addEventListener('click',()=>link.command('/api/demo',{}).catch(()=>{}));

$('view-part').addEventListener('click',()=>act({type:'stage',stage:'object'}));$('back-to-scene').addEventListener('click',()=>act({type:'stage',stage:'scene'}));
$('part-color').addEventListener('change',event=>{if(link.state.selected)act({type:'part_color',object_id:link.state.selected,color:event.target.value});});
$('remove-part').addEventListener('click',()=>{const item=link.state.scene.objects.find(o=>o.id===link.state.selected);if(item&&confirm(`Remove ${item.name} from the scene? Its file is untouched.`))act({type:'remove_object',object_id:item.id});});
if(viewer){
  const raycaster=new THREE.Raycaster();
  const ray=event=>{const box=viewer.canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1),viewer.camera);return raycaster;};
  // In the scene, a click (not a drag) selects the part under the pointer, and a double-click shows it alone.
  let clickFrom=null;
  viewer.canvas.addEventListener('pointerdown',event=>{if(event.button===0&&link.state?.stage==='scene')clickFrom={x:event.clientX,y:event.clientY};});
  viewer.canvas.addEventListener('pointerup',event=>{if(!clickFrom||link.state?.stage!=='scene')return;const moved=Math.hypot(event.clientX-clickFrom.x,event.clientY-clickFrom.y);clickFrom=null;
    if(moved>5)return;const hit=viewer.hit(ray(event));if((hit?.objectId||null)!==link.state.selected)act({type:'select',object_id:hit?.objectId||null});});
  viewer.canvas.addEventListener('dblclick',event=>{if(link.state?.stage!=='scene')return;const hit=viewer.hit(ray(event));if(hit?.objectId)act({type:'stage',stage:'object',object_id:hit.objectId});});
  document.addEventListener('keydown',event=>{if(event.target.matches('input,textarea,select')||event.target.isContentEditable)return;if(event.key==='Escape'&&link.state?.stage==='object'&&!document.querySelector('dialog[open]'))act({type:'stage',stage:'scene'});});
}
window.viewerApp={link,viewer,vr,fit,openFile,get ready(){return Boolean(viewer?.mesh&&link.state);},get modelId(){return currentModel;}};
await link.start();
