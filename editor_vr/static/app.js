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
function fit(){if(!link.state)return;tools?.cancel();const dimensions=link.state.model.dimensions_mm;const transform={position:[0,1.12,-.85],quaternion:[0,0,0,1],scale:.55/Math.max(...dimensions)};viewer?.transform(transform,true);viewer?.fitCamera();return act({type:'transform',transform});}
try{viewer=new ModelViewer($('viewport'));tools=new AnnotationTools(viewer,link,notify);vr=createVR(viewer,link,tools,{settings:set,submit,undo,fit,notify,presenting:value=>{$('enter-vr').textContent=value?'In VR · use headset':'Enter VR ◉';}});viewer.onFrame=(time,frame)=>vr.update(time,frame);vr.attachButton($('enter-vr'));}
catch(error){$('viewer-error').hidden=false;$('viewer-error').textContent='The 3D view needs WebGL. '+error.message;}
function updateSettings(settings){
  document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===settings.mode)));
  document.querySelectorAll('[data-tool]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tool===settings.tool)));
  document.querySelectorAll('[data-color]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.color===settings.color)));
  for(const id of ['meaning','category','description'])if(document.activeElement!==$(id))$(id).value=settings[id];
  $('brush-radius').value=settings.brush_radius_mm;$('brush-value').textContent=settings.brush_radius_mm+' mm';
  $('view-badge').textContent=settings.mode==='inspect'?'INSPECT MODE':TOOL_NAMES[settings.tool].toUpperCase();$('view-badge').classList.toggle('edit',settings.mode==='edit');
  const hints={spray:'Hold and drag to paint · right-drag to pan · scroll to zoom',box:'Drag from a surface to select a 3D region · release to save',pin:'Click a surface to pin a note',measure:'Click two surface points to measure their distance',erase:'Click an annotated face to remove its mark'};
  $('tool-hint').textContent=settings.mode==='inspect'?'Drag to orbit · right-drag to pan · scroll to zoom':hints[settings.tool];
  if(viewer)viewer.controls.enableRotate=settings.mode==='inspect';
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
    const card=div('request-card'),meta=div('request-meta');meta.textContent=request.category.toUpperCase()+' / '+request.id.slice(0,6);const status=document.createElement('span');status.className='request-state';status.textContent=request.status==='queued'?'RECEIVED':'REVIEWED';meta.append(status);const title=document.createElement('h4');title.textContent=request.description;const detail=document.createElement('p');detail.textContent=`${request.mark_count} marks · ${request.face_count.toLocaleString()} faces · ${request.author}`;const files=div('request-actions');const packet=document.createElement('a');packet.href=request.packet_url;packet.textContent='Edit packet ↓';const glb=document.createElement('a');glb.href=request.glb_url;glb.textContent='3D file ↓';files.append(packet,glb);if(request.status==='queued'){const review=document.createElement('button');review.textContent='Mark reviewed';review.addEventListener('click',()=>act({type:'review',request_id:request.id}));files.append(review);}card.append(meta,title,detail,files);list.append(card);
  }
}
link.addEventListener('state',({detail:state})=>{
  if(viewer?.modelId&&viewer.modelId!==state.model.id){tools.cancel();vr?.cancelInteraction();pointerDown=false;}
  updateSettings(state.settings);drawLists(state);$('last-change').textContent=state.updated_by?'Updated by '+state.updated_by:'Local workspace';
  $('model-name').textContent=state.model.name;$('model-dimensions').textContent=state.model.dimensions_mm.map(n=>Number(n.toFixed(1))).join(' × ')+' mm';$('model-stats').textContent=state.model.triangles.toLocaleString()+' triangles · '+(state.model.watertight?'closed mesh':'check mesh before printing');
  applying=applying.then(async()=>{if(!viewer)return;if(currentModel!==state.model.id){tools.cancel();await viewer.load(state.model);currentModel=state.model.id;viewer.fitCamera();}const latest=link.state;if(currentModel!==latest.model.id)return;viewer.transform(latest.transform);if(!tools.active)viewer.color(latest.annotations);viewer.wireframe(wire);}).catch(error=>notify(error.message,true));
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
$('import-model').addEventListener('click',()=>$('import-dialog').showModal());$('close-import').addEventListener('click',()=>$('import-dialog').close());$('choose-file').addEventListener('click',()=>$('model-file').click());
$('model-file').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;if(file.size>30*1024*1024){notify('Choose a model smaller than 30 MB.',true);return;}const data=new FormData();data.append('model',file);data.append('units',$('import-units').value);try{await link.command('/api/models',data,true);$('import-dialog').close();notify('Model loaded on every connected device.');}catch{/* The connection reports the exact error. */}});
$('load-demo').addEventListener('click',()=>{if(link.state.annotations.length&&!confirm('Load the demo and clear current marks? Submitted packets are kept.'))return;link.command('/api/demo',{}).catch(()=>{});});
if(viewer){
  const raycaster=new THREE.Raycaster();
  const ray=event=>{const box=viewer.canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1),viewer.camera);return raycaster;};
  viewer.canvas.addEventListener('pointerdown',event=>{if(event.button!==0||!link.state||link.state.settings.mode!=='edit'||event.shiftKey)return;event.preventDefault();const r=ray(event);if(tools.begin(viewer.hit(r),r)){pointerDown=true;viewer.canvas.setPointerCapture(event.pointerId);}});
  viewer.canvas.addEventListener('pointermove',event=>{if(!pointerDown||!tools.active)return;const r=ray(event);tools.update(viewer.hit(r),r);});
  viewer.canvas.addEventListener('pointerup',()=>{if(pointerDown){tools.end();pointerDown=false;}});viewer.canvas.addEventListener('pointercancel',()=>{tools.cancel();pointerDown=false;});
  document.addEventListener('keydown',event=>{if(event.target.matches('input,textarea,select')||event.target.isContentEditable)return;if(event.key==='Escape')tools.cancel();const key=Number(event.key);if(key>=1&&key<=5)set({tool:Object.keys(TOOL_NAMES)[key-1],mode:'edit'});if(event.key==='Shift')viewer.controls.enableRotate=true;});
  document.addEventListener('keyup',event=>{if(event.key==='Shift'&&link.state)viewer.controls.enableRotate=link.state.settings.mode==='inspect';});
}
window.editor={link,viewer,tools,vr,fit,submit,get ready(){return Boolean(viewer?.mesh&&link.state);},get modelId(){return currentModel;}};
await link.start();
