import * as THREE from 'three';
import {WorkspaceLink,uid} from './link.js';
import {ModelViewer} from './viewer.js';
import {AnnotationTools,TOOL_NAMES} from './tools.js';
import {createVR} from './vr.js';
const $=id=>document.getElementById(id),link=new WorkspaceLink();let viewer,vr,tools,toastTimer,currentModel=null,applying=Promise.resolve(),wire=false,pointerDown=false;
function notify(message,error=false){$('toast').textContent=message;$('toast').hidden=false;$('toast').classList.toggle('error',error);clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?7000:3500);vr?.notify(message);}
const act=command=>link.action(command).catch(()=>{});
const set=changes=>{if(changes.tool||changes.mode)tools?.cancel();return link.settings(changes).catch(()=>{});};
let submission=null;
function submit(){if(submission)return submission;$('submit-request').disabled=true;submission=link.submit().then(()=>notify('Edit request saved. The desktop packet is ready.')).catch(error=>{notify(error.message,true);throw error;}).finally(()=>{submission=null;$('submit-request').disabled=false;});return submission;}
function undo(){return act({type:'undo'});}
// What is shown fills about 55 cm of the table: the scene's bounds, or the part being edited.
function shownSize(state){if(state.stage==='object')return state.model.dimensions_mm;const objects=state.scene.objects;return [0,1,2].map(k=>Math.max(...objects.map(o=>o.bounds_mm[1][k]))-Math.min(...objects.map(o=>o.bounds_mm[0][k])));}
function fit(){if(!link.state)return;tools?.cancel();const dimensions=shownSize(link.state);const transform={position:[0,1.12,-.85],quaternion:[0,0,0,1],scale:.55/Math.max(...dimensions)};viewer?.transform(transform,true);viewer?.fitCamera();return act({type:'transform',transform});}
try{viewer=new ModelViewer($('viewport'));tools=new AnnotationTools(viewer,link,notify);vr=createVR(viewer,link,tools,{settings:set,submit,undo,fit,notify,presenting:value=>{$('enter-vr').textContent=value?'In VR · use headset':'Enter VR ◉';}});viewer.onFrame=(time,frame)=>vr.update(time,frame);vr.attachButton($('enter-vr'));}
catch(error){$('viewer-error').hidden=false;$('viewer-error').textContent='The 3D view needs WebGL. '+error.message;}
function updateSettings(settings){
  document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===settings.mode)));
  document.querySelectorAll('[data-tool]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tool===settings.tool)));
  document.querySelectorAll('[data-color]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.color===settings.color)));
  for(const id of ['meaning','category','description'])if(document.activeElement!==$(id))$(id).value=settings[id];
  $('brush-radius').value=settings.brush_radius_mm;$('brush-value').textContent=settings.brush_radius_mm+' mm';
  const scene=link.state?.stage!=='object';
  $('view-badge').textContent=scene?`SCENE · ${link.state?.scene.objects.length||0} PARTS`:settings.mode==='inspect'?'INSPECT MODE':TOOL_NAMES[settings.tool].toUpperCase();$('view-badge').classList.toggle('edit',!scene&&settings.mode==='edit');
  const hints={spray:'Hold and drag to paint · right-drag to pan · scroll to zoom',box:'Drag from a surface to select a 3D region · release to save',pin:'Click a surface to pin a note',measure:'Click two surface points to measure their distance',erase:'Click an annotated face to remove its mark'};
  $('tool-hint').textContent=scene?'Click a part to select it · double-click to edit it · drag to orbit':settings.mode==='inspect'?'Drag to orbit · right-drag to pan · scroll to zoom':hints[settings.tool];
  if(viewer)viewer.controls.enableRotate=scene||settings.mode==='inspect';
}
// The scene's parts, grouped by category: click to select, double-click to edit.
function drawScene(state){
  const object=state.stage==='object',list=$('part-list'),selected=state.selected;
  document.documentElement.classList.toggle('stage-scene',!object);document.documentElement.classList.toggle('stage-object',object);
  $('scene-heading').textContent=object?`Editing ${state.model.name}`:state.scene.name;
  const groups=new Map();for(const item of state.scene.objects){const key=item.category||'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  list.replaceChildren();
  for(const [category,items] of groups){
    if(groups.size>1||category)list.append(div('part-group',category||'Other'));
    for(const item of items){
      const row=document.createElement('button');row.className='part-row';row.setAttribute('role','option');row.dataset.object=item.id;
      row.setAttribute('aria-selected',String(item.id===(object?state.model.object_id:selected)));
      const name=document.createElement('b');name.textContent=item.name;row.append(name);
      if(item.marks){const marks=document.createElement('span');marks.className='marks';marks.textContent=item.marks;marks.title=`${item.marks} draft marks`;row.append(marks);}
      const size=document.createElement('small');size.textContent=item.triangles.toLocaleString()+' △'+(item.source_triangles!==item.triangles?' (simplified)':'');row.append(size);
      row.title=[item.name,item.print_file&&`Print file: ${item.print_file}`,item.source_triangles!==item.triangles&&`Simplified for VR from ${item.source_triangles.toLocaleString()} triangles`].filter(Boolean).join('\n');
      row.addEventListener('click',()=>object?act({type:'stage',stage:'object',object_id:item.id}):act({type:'select',object_id:item.id}));
      row.addEventListener('dblclick',()=>act({type:'stage',stage:'object',object_id:item.id}));
      list.append(row);
    }
  }
  $('edit-part').disabled=!selected;$('remove-part').disabled=!selected||state.scene.objects.length<2;
  $('import-model').title=object?'Return to the scene to add parts':'Add parts, or open files as a new scene';
}
function div(className,text){const node=document.createElement('div');node.className=className;if(text!==undefined)node.textContent=text;return node;}
function drawLists(state){
  const marks=$('annotations');marks.replaceChildren();$('annotation-count').textContent=state.annotations.length;
  if(!state.annotations.length){const empty=document.createElement('p');empty.className='empty-note';empty.textContent='Your first mark starts a conversation with the model.';marks.append(empty);}
  for(const annotation of [...state.annotations].reverse()){
    const row=div('mark'),dot=document.createElement('i');dot.style.background=annotation.color;const body=div('');const name=document.createElement('strong');name.textContent=annotation.meaning||TOOL_NAMES[annotation.tool];const detail=document.createElement('p');detail.textContent=TOOL_NAMES[annotation.tool]+' · '+annotation.face_ids.length.toLocaleString()+' faces'+(annotation.distance_mm!==undefined?' · '+annotation.distance_mm.toFixed(2)+' mm':'');const remove=document.createElement('button');remove.textContent='×';remove.title='Remove annotation';remove.addEventListener('click',()=>act({type:'remove',annotation_id:annotation.id}));body.append(name,detail);row.append(dot,body,remove);marks.append(row);
  }
  const count=new Set(state.annotations.flatMap(a=>a.face_ids)).size;
  $('selected-count').textContent=count?count.toLocaleString()+' selected faces':'No selected faces';$('draft-summary').textContent=state.annotations.length?`${state.annotations.length} marks · ${count.toLocaleString()} faces ready to send`:'Mark an area to begin.';
  const list=$('requests');list.replaceChildren();$('request-count').textContent=state.requests.length;
  if(!state.requests.length){const empty=div('empty-queue');const icon=document.createElement('span');icon.textContent='↗';const title=document.createElement('h4');title.textContent='Ready when you are.';const note=document.createElement('p');note.textContent='Mark a region, then send an edit from here or your wrist.';empty.append(icon,title,note);list.append(empty);}
  for(const request of state.requests){
    const card=div('request-card'),meta=div('request-meta');meta.textContent=request.category.toUpperCase()+' / '+request.id.slice(0,6);const status=document.createElement('span');status.className='request-state';status.textContent=request.status==='queued'?'RECEIVED':'REVIEWED';meta.append(status);const title=document.createElement('h4');title.textContent=request.description;const detail=document.createElement('p');detail.textContent=`${request.model_name} · ${request.mark_count} marks · ${request.face_count.toLocaleString()} faces · ${request.author}`;const files=div('request-actions');const packet=document.createElement('a');packet.href=request.packet_url;packet.textContent='Edit packet ↓';const glb=document.createElement('a');glb.href=request.glb_url;glb.textContent='3D file ↓';files.append(packet,glb);if(request.status==='queued'){const review=document.createElement('button');review.textContent='Mark reviewed';review.addEventListener('click',()=>act({type:'review',request_id:request.id}));files.append(review);}card.append(meta,title,detail,files);list.append(card);
  }
}
link.addEventListener('state',({detail:state})=>{
  if(viewer?.modelId&&(viewer.modelId!==state.model.id||viewer.stage!==state.stage)){tools.cancel();vr?.cancelInteraction();pointerDown=false;}
  drawLists(state);$('last-change').textContent=state.updated_by?'Updated by '+state.updated_by:'Local workspace';
  drawScene(state);updateSettings(state.settings);
  const object=state.stage==='object',dimensions=shownSize(state);
  $('model-eyebrow').textContent=object?`EDITING ONE PART · ${state.scene.name.toUpperCase()}`:'SHARED SCENE';
  $('model-name').textContent=object?state.model.name:state.scene.name;$('model-dimensions').textContent=dimensions.map(n=>Number(n.toFixed(1))).join(' × ')+' mm';
  $('model-stats').textContent=object?state.model.triangles.toLocaleString()+' triangles · '+(state.model.watertight?'closed mesh':'check mesh before printing'):`${state.scene.objects.length} parts · ${state.scene.objects.reduce((n,o)=>n+o.triangles,0).toLocaleString()} triangles`;
  applying=applying.then(async()=>{if(!viewer)return;const latest=link.state,before=viewer.sceneKey;if(!await viewer.show(latest))return;
    currentModel=latest.model.id;viewer.transform(latest.transform);if(viewer.sceneKey!==before){tools.cancel();viewer.fitCamera();}if(!tools.active)viewer.color(latest.annotations);viewer.wireframe(wire);}).catch(error=>notify(error.message,true));
});
link.addEventListener('connection',({detail})=>{$('connection-state').textContent=detail;$('connection-dot').classList.toggle('live',detail==='Live sync');});
link.addEventListener('presence',({detail})=>$('peer-count').textContent=detail+(detail===1?' device':' devices'));
link.addEventListener('error',({detail})=>notify(detail,true));
for(const button of document.querySelectorAll('[data-mode]'))button.addEventListener('click',()=>set({mode:button.dataset.mode}));
for(const button of document.querySelectorAll('[data-tool]'))button.addEventListener('click',()=>set({tool:button.dataset.tool,mode:'edit'}));
for(const button of document.querySelectorAll('[data-color]')){button.style.background=button.dataset.color;button.addEventListener('click',()=>set({color:button.dataset.color}));}
for(const id of ['meaning','description'])$(id).addEventListener('input',()=>set({[id]:$(id).value}));
$('category').addEventListener('change',()=>set({category:$('category').value}));$('brush-radius').addEventListener('input',()=>{$('brush-value').textContent=$('brush-radius').value+' mm';set({brush_radius_mm:Number($('brush-radius').value)});});
$('submit-request').addEventListener('click',()=>submit().catch(()=>{}));$('undo').addEventListener('click',undo);$('clear').addEventListener('click',()=>{if(link.state.annotations.length&&confirm('Clear the current marks? Submitted packets are kept.')){tools?.cancel();act({type:'clear'});}});
$('fit-view').addEventListener('click',fit);
$('turn-model').addEventListener('click',()=>{if(!viewer||!link.state)return;const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/4);viewer.pivot.quaternion.premultiply(q);act({type:'transform',transform:viewer.currentTransform()});});
for(const [id,ratio] of [['zoom-in',1.2],['zoom-out',1/1.2]])$(id).addEventListener('click',()=>{if(!viewer||!link.state)return;viewer.pivot.scale.setScalar(THREE.MathUtils.clamp(viewer.pivot.scale.x*ratio,.00001,1));act({type:'transform',transform:viewer.currentTransform()});});
$('wireframe').addEventListener('click',()=>{wire=!wire;viewer?.wireframe(wire);$('wireframe').setAttribute('aria-pressed',String(wire));});
$('connect-headset').addEventListener('click',()=>$('headset-dialog').showModal());$('close-headset').addEventListener('click',()=>$('headset-dialog').close());
let importMode='add';
function setImportMode(mode){importMode=mode;document.querySelectorAll('[data-import]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.import===mode)));
  $('import-note').textContent=mode==='open'?'The files become a new scene; current draft marks are cleared. Submitted requests keep their own copies.':'Added parts stand in a row beside the scene. Submitted requests keep their own copies.';}
document.querySelectorAll('[data-import]').forEach(b=>b.addEventListener('click',()=>setImportMode(b.dataset.import)));
// The open project's part files can be added straight from its folder.
async function showProjectParts(){
  const project=link.state?.scene.source?.project;$('project-parts').hidden=!project;if(!project)return;
  try{const detail=await link.request(`/api/projects/${encodeURIComponent(project)}`);const list=$('project-part-list');list.replaceChildren();
    for(const file of detail.parts){const button=document.createElement('button');button.textContent='＋ '+file.split('/').pop();button.title=file;
      button.addEventListener('click',async()=>{button.disabled=true;try{await link.command('/api/projects/add',{project,file});$('import-dialog').close();notify(`${file.split('/').pop()} added to the scene.`);}catch{button.disabled=false;}});list.append(button);}
    $('project-parts').hidden=!detail.parts.length;}catch{$('project-parts').hidden=true;}
}
function openImport(mode){setImportMode(mode);showProjectParts();$('import-dialog').showModal();}
$('import-model').addEventListener('click',()=>openImport(link.state?.stage==='object'?'open':'add'));$('add-part').addEventListener('click',()=>openImport('add'));
// Model projects on this computer (the Visualizer's layout): open an assembled scene, or every part file.
async function showProjects(){
  $('project-dialog').showModal();const list=$('project-list');list.replaceChildren();
  try{
    const {root,projects}=await link.request('/api/projects');$('project-root').textContent=projects.length?`From ${root}`:`No model projects in ${root}. Start the server with --models DIR to look elsewhere.`;
    for(const project of projects){
      const card=div('project'),title=document.createElement('h3');title.textContent=project.name;const files=div('project-files');
      const open=(label,file,hint)=>{const button=document.createElement('button');button.className='open';button.textContent=label;button.title=hint;
        button.addEventListener('click',async()=>{if(link.state.annotations.length&&!confirm('Open this project and clear the draft marks? Submitted requests are kept.'))return;button.disabled=true;
          try{await link.command('/api/projects/open',{project:project.name,...(file?{file}:{})});$('project-dialog').close();notify(`${project.name} opened.`);}catch{button.disabled=false;}});files.append(button);};
      for(const file of project.scenes)open(`Open ${file.split('/').pop().replace(/\.3mf$/i,'').replace(/_assembled$/,'').replace(/_/g,' ')}`,file,`The assembled scene ${file}`);
      if(project.parts.length)open(`All ${project.parts.length} part files`,null,'Every part file, side by side');
      if(!project.scenes.length&&project.parts.length)files.lastChild.textContent=`Open ${project.parts.length} part files`;
      card.append(title,files);list.append(card);
    }
  }catch(error){$('project-root').textContent=error.message;}
}
$('open-project').addEventListener('click',showProjects);$('close-projects').addEventListener('click',()=>$('project-dialog').close());
$('edit-part').addEventListener('click',()=>act({type:'stage',stage:'object'}));$('back-to-scene').addEventListener('click',()=>act({type:'stage',stage:'scene'}));
$('remove-part').addEventListener('click',()=>{const item=link.state.scene.objects.find(o=>o.id===link.state.selected);if(item&&confirm(`Remove ${item.name} from the scene? Its draft marks go too; files are untouched.`))act({type:'remove_object',object_id:item.id});});$('close-import').addEventListener('click',()=>$('import-dialog').close());$('choose-file').addEventListener('click',()=>$('model-file').click());
$('model-file').addEventListener('change',async event=>{const files=[...event.target.files];event.target.value='';if(!files.length)return;if(files.reduce((n,f)=>n+f.size,0)>30*1024*1024){notify('Choose files smaller than 30 MB together, or open them as a project.',true);return;}
  if(importMode==='open'&&link.state.annotations.length&&!confirm('Open these files as a new scene and clear the draft marks? Submitted requests are kept.'))return;
  const data=new FormData();for(const file of files)data.append('model',file);data.append('units',$('import-units').value);data.append('mode',importMode);
  try{await link.command('/api/models',data,true);$('import-dialog').close();notify(importMode==='open'?'Scene opened on every connected device.':'Parts added on every connected device.');}catch{/* The connection reports the exact error. */}});
$('load-demo').addEventListener('click',()=>{if(link.state.annotations.length&&!confirm('Open the demo scene and clear the draft marks? Submitted packets are kept.'))return;link.command('/api/demo',{}).catch(()=>{});});
if(viewer){
  const raycaster=new THREE.Raycaster();
  const ray=event=>{const box=viewer.canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1),viewer.camera);return raycaster;};
  // In the scene, a click (not a drag) selects the part under the pointer, and a double-click edits it.
  let clickFrom=null;
  viewer.canvas.addEventListener('pointerdown',event=>{if(event.button===0&&link.state?.stage==='scene')clickFrom={x:event.clientX,y:event.clientY};});
  viewer.canvas.addEventListener('pointerup',event=>{if(!clickFrom||link.state?.stage!=='scene')return;const moved=Math.hypot(event.clientX-clickFrom.x,event.clientY-clickFrom.y);clickFrom=null;
    if(moved>5)return;const hit=viewer.hit(ray(event));if((hit?.objectId||null)!==link.state.selected)act({type:'select',object_id:hit?.objectId||null});});
  viewer.canvas.addEventListener('dblclick',event=>{if(link.state?.stage!=='scene')return;const hit=viewer.hit(ray(event));if(hit?.objectId)act({type:'stage',stage:'object',object_id:hit.objectId});});
  viewer.canvas.addEventListener('pointerdown',event=>{if(event.button!==0||!link.state||link.state.stage!=='object'||link.state.settings.mode!=='edit'||event.shiftKey)return;event.preventDefault();const r=ray(event);if(tools.begin(viewer.hit(r),r)){pointerDown=true;viewer.canvas.setPointerCapture(event.pointerId);}});
  viewer.canvas.addEventListener('pointermove',event=>{if(!pointerDown||!tools.active)return;const r=ray(event);tools.update(viewer.hit(r),r);});
  viewer.canvas.addEventListener('pointerup',()=>{if(pointerDown){tools.end();pointerDown=false;}});viewer.canvas.addEventListener('pointercancel',()=>{tools.cancel();pointerDown=false;});
  document.addEventListener('keydown',event=>{if(event.target.matches('input,textarea,select')||event.target.isContentEditable)return;if(event.key==='Escape'){if(tools.active)tools.cancel();else if(link.state?.stage==='object'&&!document.querySelector('dialog[open]'))act({type:'stage',stage:'scene'});}const key=Number(event.key);if(key>=1&&key<=5)set({tool:Object.keys(TOOL_NAMES)[key-1],mode:'edit'});if(event.key==='Shift')viewer.controls.enableRotate=true;});
  document.addEventListener('keyup',event=>{if(event.key==='Shift'&&link.state)viewer.controls.enableRotate=link.state.settings.mode==='inspect';});
}
window.editor={link,viewer,tools,vr,fit,submit,get ready(){return Boolean(viewer?.mesh&&link.state);},get modelId(){return currentModel;}};
await link.start();
