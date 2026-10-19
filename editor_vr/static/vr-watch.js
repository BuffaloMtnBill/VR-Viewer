// The left-wrist watch: tap its dial with a fingertip and a pie menu opens in front of you, within reach. Its options
// follow what you are doing: the scene (its parts to select, parts to add, Edit part), or one part, inspected (◀ Scene,
// Annotate) or marked up (tools, mark style, the note, Undo, Submit). Options marked ▸ open the next ring; the middle
// goes back one ring. Tap the options the same way (there are no lasers at the menus). Note and Meaning open a
// keyboard with a microphone key for dictation.
// The right-wrist button: Edit ▸ (the selected part) in the scene; Annotate ▸ in Inspect; Submit (with the number of
// marks) in Annotate. In the scene, a card floats above the selected part: its name and Edit ▸ (pressed with the laser
// and a pinch, or a fingertip), and its stats when asked for (Part ▸ Stats, or "show stats").
import * as THREE from 'three';
import {TOOL_NAMES} from './tools.js';
import {createVoice} from './vr-voice.js';

export const COLORS=['#ffb86b','#6be0d4','#ad9bff','#ff7895','#72b9ff'];
// A part's own color in the scene (Gray is the plain default); kept with the workspace, so every device shows it.
export const PART_COLORS=[{label:'Gray',color:null,fill:'#e3e3e3'},{label:'Red',color:'#d9534f'},{label:'Orange',color:'#f0913a'},
  {label:'Yellow',color:'#f2d14b'},{label:'Green',color:'#5cb85c'},{label:'Blue',color:'#3a7bd5'}];
const MEANINGS=['Add or enlarge','Smooth or blend','Surface detail','Remove or reduce','Review this area'],CATEGORIES=['size','texture','pattern','general'];
const UI={ink:'#ecf1f6',muted:'#a5b6c5',accent:'#ffb86b',mint:'#6be0d4',fill:'#17212bf2',raised:'#243441',hover:'#34495a',active:'#6b5034',
  primary:'#2d5550',line:'#415361',paper:'#17212b',sans:'Inter,"Segoe UI",Arial,sans-serif'};
const POKE={touch:.012,release:.025,hover:.07,settle:350};   // fingertip distance (m) that presses, lets go, lights; ms a new window ignores presses
const LIMITS={description:2000,meaning:80};
const title=word=>word[0].toUpperCase()+word.slice(1);

// A flat canvas in the room you can poke: regions are hit-tested in canvas pixels.
function surface(name,width,height,pixels) {
  const canvas=document.createElement('canvas');canvas.width=pixels;canvas.height=Math.round(pixels*height/width);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
  mesh.name=name;mesh.renderOrder=1100;mesh.visible=false;
  return {name,mesh,canvas,texture,width,height,regions:[],signature:'',
    context:canvas.getContext('2d'),
    toCanvas(local){return {x:(local.x/width+.5)*canvas.width,y:(.5-local.y/height)*canvas.height};},
    regionAt(x,y){return this.regions.find(region=>!region.disabled&&region.contains(x,y))||null;}};
}
function wrapText(c,value,width,maxLines) {
  const words=String(value).split(/\s+/).filter(Boolean),lines=[];let line='';
  for(const word of words){const next=line?`${line} ${word}`:word;if(c.measureText(next).width>width&&line){lines.push(line);line=word;}else line=next;}
  if(line)lines.push(line);
  return lines.slice(0,maxLines);
}

export function createWatch({scene,camera,joint,hands,link,mode,setMode,stage,setStage,select,bounds,exit,submit,undo,fit,backgrounds,voiceCommands,api}) {
  const face=surface('watch',.045,.045,256),radial=surface('pie menu',.42,.42,1024),keyboard=surface('keyboard',.62,.34,1600);
  const wrist=surface('wrist button',.075,.04,512),caption=surface('caption',.34,.05,870),card=surface('part card',.3,.165,800);
  for(const s of [face,radial,keyboard,wrist,caption,card])scene.add(s.mesh);
  face.mesh.renderOrder=1050;card.mesh.renderOrder=1040;
  const surfaces=[face,radial,keyboard,wrist,card];
  let menu=null,stack=[],hovered=new Set(),field='description',text='',then=null,voiceNote='',statsShown=false;
  const settings=()=>link.state?.settings||{};
  const marks=()=>link.state?.annotations.length||0;
  const objects=()=>link.state?.scene.objects||[];
  const selected=()=>objects().find(o=>o.id===link.state?.selected)||null;
  const partColor=()=>{const color=selected()?.color||null;return PART_COLORS.find(choice=>choice.color===color)||{label:'Custom',color,fill:color};};
  const shorten=(name,length)=>name.length>length?`${name.slice(0,length-1)}…`:name;
  // The open project's part files, for Add (fetched when the Add ring opens).
  let projectFiles={project:null,files:null};
  function loadProjectFiles() {
    const project=link.state?.scene.source?.project||null;
    if(projectFiles.project===project&&projectFiles.files)return;
    projectFiles={project,files:project?null:[]};
    if(project)api(`/api/projects/${encodeURIComponent(project)}`).then(detail=>{if(projectFiles.project===project){projectFiles.files=detail.parts;radial.signature='';}})
      .catch(()=>{projectFiles.files=[];radial.signature='';});
  }
  // The selected part's stats on its card: shown or hidden (they stay shown for the next part selected).
  function showStats(shown=!statsShown) {
    if(!selected()){say('Pick a part first: point at it and pinch');return;}
    statsShown=shown;card.signature='';say(shown?`${selected().name} · stats`:'Stats hidden');
  }
  function unselect() {
    if(!selected()){say('Nothing is selected');return;}
    select(null);say('Nothing selected');
    if(radial.mesh.visible){stack=[top()];menu=top();radial.signature='';}
  }
  // "Make it blue": a part color by name, for the selected part.
  function paint(label) {
    const item=selected(),choice=PART_COLORS.find(c=>c.label.toLowerCase()===String(label).toLowerCase().replace('grey','gray'));
    if(!item){say('Pick a part first: point at it and pinch');return;}
    if(!choice)return;
    link.action({type:'part_color',object_id:item.id,color:choice.color}).catch(error=>say(error.message));say(`${item.name} · ${choice.label}`);
  }
  function editPart() {
    const item=selected();
    if(!item){say('Pick a part first: point at it and pinch');return;}
    closeMenu();setStage('object');say(`Editing ${item.name}`);
  }
  const set=changes=>link.settings(changes).catch(()=>{});
  // Dictation: the words heard are added to the text, to check (or fix) before tapping Done.
  const voice=createVoice({api,onText:heard=>{text=`${text}${text&&!/\s$/.test(text)?' ':''}${heard}`.slice(0,LIMITS[field]);voiceNote='';keyboard.signature='';},
    onError:message=>{voiceNote=message;keyboard.signature='';}});

  // ---------- submitting ----------
  async function send() {
    closeMenu();
    if(!marks()){say('Mark a model area first');return;}
    if(!settings().description?.trim()){openKeyboard('description',send);say('Describe the change, then Done');return;}
    const count=marks();
    try{await submit();say(`Sent ${count} mark${count===1?'':'s'} to the desktop`);}catch(error){say(error.message);}
  }

  // ---------- the menus ----------
  // An item with `open` opens that ring; `local` items (steps, confirmations) can be said only while on show.
  // `detail` is the current value, shown under the label; `fill` colors the slice, `swatch` adds a dot.
  const step=(label,delta,aliases)=>({key:label,label,aliases,local:true,
    press:()=>set({brush_radius_mm:Math.min(100,Math.max(.5,Math.round((settings().brush_radius_mm+delta)*2)/2))})});
  const MENUS={
    scene:{title:'Scene',value:()=>link.state?.scene.name||'',items:()=>[
      {key:'parts',label:'Parts',aliases:['select a part','parts list'],open:'parts:0',detail:selected()?shorten(selected().name,18):`${objects().length} parts`},
      {key:'add',label:'Add part',aliases:['add','add a part'],open:'add:0',detail:link.state?.scene.source?.project?shorten(link.state.scene.source.project,18):'From a project'},
      {key:'edit',label:'Edit part',aliases:['edit','edit this part'],detail:selected()?shorten(selected().name,18):'Pick one first',primary:Boolean(selected()),press:()=>editPart()},
      ...selected()?[{key:'part',label:'Part',aliases:['this part','selected part','selection'],open:'part',detail:shorten(selected().name,18),swatch:partColor().fill||partColor().color}]:[],
      {key:'reset',label:'Reset view',press:()=>fit()},
      {key:'settings',label:'Settings',open:'settings',detail:voiceCommands.on?'Voice on':'Voice off'}]},
    inspect:{title:'Inspect',value:()=>shorten(link.state?.model.name||'',14),items:()=>[
      {key:'scene',label:'◀ Scene',aliases:['scene','back to scene','whole scene'],detail:'All parts',press:()=>{setStage('scene');}},
      {key:'reset',label:'Reset view',press:()=>fit()},
      {key:'annotate',label:'Annotate',aliases:['annotate mode'],detail:'Mark this part',press:()=>setMode('edit')},
      {key:'settings',label:'Settings',open:'settings',detail:voiceCommands.on?'Voice on':'Voice off'}]},
    annotate:{title:'Annotate',items:()=>[
      {key:'tools',label:'Tools',open:'tools',detail:TOOL_NAMES[settings().tool]},
      {key:'style',label:'Mark style',aliases:['style'],open:'style',detail:`${title(settings().category||'size')} · ${settings().brush_radius_mm} mm`,swatch:settings().color},
      {key:'note',label:'Note',aliases:['take a note'],detail:settings().description?.trim()?'Written':'Empty',press:()=>openKeyboard('description')},
      {key:'undo',label:'Undo mark',aliases:['undo'],detail:`${marks()} marks`,press:()=>undo()},
      {key:'submit',label:'Submit',aliases:['submit edit','send'],detail:'to the desktop',primary:true,press:()=>send()},
      {key:'scene',label:'◀ Scene',aliases:['scene','back to scene','whole scene'],detail:'All parts',press:()=>{setStage('scene');}},
      {key:'settings',label:'Settings',open:'settings',detail:voiceCommands.on?'Voice on':'Voice off'}]},
    // Choosing a tool closes the menu, so the next pinch on the model uses it.
    tools:{title:'Tools',items:()=>[{key:'inspect',label:'Move model',aliases:['inspect','move'],active:settings().mode==='inspect',press:()=>{setMode('inspect');closeMenu();}},
      ...Object.entries(TOOL_NAMES).map(([key,label])=>({key,label,active:settings().mode==='edit'&&settings().tool===key,press:()=>{set({tool:key,mode:'edit'});closeMenu();}}))]},
    style:{title:'Mark style',items:()=>[
      {key:'color',label:'Color',aliases:['mark color'],open:'color',detail:settings().meaning,swatch:settings().color},
      {key:'category',label:'Category',aliases:['edit category'],open:'category',detail:title(settings().category||'size')},
      {key:'brush',label:'Brush',aliases:['brush radius'],open:'brush',detail:`${settings().brush_radius_mm} mm`},
      {key:'meaning',label:'Meaning',aliases:['color meaning'],detail:'Type or say it',press:()=>openKeyboard('meaning')}]},
    color:{title:'Mark color',items:()=>COLORS.map((color,i)=>({key:String(i),label:MEANINGS[i],fill:color,active:settings().color===color,
      press:()=>{set({color,meaning:MEANINGS[i]});back();}}))},
    // The selected part: edit it, its stats, its color, or let it go.
    part:{title:'Part',value:()=>shorten(selected()?.name||'',14),items:()=>[
      {key:'edit',label:'Edit part',aliases:['edit','edit this part'],primary:true,press:()=>editPart()},
      {key:'stats',label:statsShown?'Hide stats':'Stats',aliases:['stats','show stats','hide stats','statistics','part info','details'],active:statsShown,press:()=>showStats()},
      {key:'color',label:'Color',aliases:['part color','part colour','change color','paint part','recolor'],open:'part-color',detail:partColor().label,swatch:partColor().fill||partColor().color},
      {key:'unselect',label:'Unselect',aliases:['deselect','clear selection','select nothing'],press:()=>unselect()}]},
    'part-color':{title:'Part color',value:()=>shorten(selected()?.name||'',14),items:()=>PART_COLORS.map(choice=>({key:choice.label.toLowerCase(),label:choice.label,
      fill:choice.fill||choice.color,active:partColor().color===choice.color,press:()=>{const item=selected();if(!item)return;
        link.action({type:'part_color',object_id:item.id,color:choice.color}).catch(error=>say(error.message));say(`${item.name} · ${choice.label}`);back();}}))},
    category:{title:'Edit category',items:()=>CATEGORIES.map(category=>({key:category,label:title(category),active:settings().category===category,
      press:()=>{set({category});back();}}))},
    brush:{title:'Brush radius',value:()=>`${settings().brush_radius_mm} mm`,items:()=>[step('−−',-5,['minus five','much smaller']),step('−',-.5,['minus','smaller']),
      step('+',.5,['plus','larger']),step('++',5,['plus five','much larger'])]},
    // A living background can be paused at its time of day (and run on again).
    background:{title:'Background',items:()=>[...backgrounds.list.map(b=>({key:b.key,label:b.label,aliases:b.aliases,active:backgrounds.current===b.key,detail:b.living?'Sun and moon':undefined,press:()=>backgrounds.set(b.key)})),
      ...backgrounds.living?[{key:'time',label:backgrounds.running?'Pause sky':'Run sky',aliases:['pause the sky','stop the sky','run the sky','start the sky'],active:!backgrounds.running,press:()=>backgrounds.pause()}]:[]]},
    settings:{title:'Settings',items:()=>[
      {key:'background',label:'Background',aliases:['backgrounds','room'],open:'background',detail:backgrounds.list.find(b=>b.key===backgrounds.current)?.label},
      {key:'voice',label:voiceCommands.on?'Voice: on':'Voice: off',aliases:['voice'],active:voiceCommands.on,press:()=>voiceCommands.toggle()},
      {key:'exit',label:'Exit VR',aliases:['exit'],open:'exit'}]},
    // Leaving VR, and sending by voice, take a second, deliberate choice.
    exit:{title:'Leave VR?',items:()=>[{key:'confirm',label:'Yes, exit',aliases:['yes','exit','exit vr'],local:true,press:()=>exit()},
      {key:'stay',label:'Stay',aliases:['no','cancel'],local:true,press:()=>back()}]},
    send:{title:'Send to desktop?',value:()=>`${marks()} marks`,items:()=>[{key:'confirm',label:'Yes, send',aliases:['yes','send','send it'],local:true,primary:true,press:()=>send()},
      {key:'stay',label:'Not yet',aliases:['no','cancel','wait'],local:true,press:()=>closeMenu()}]},
  };
  // Rings made as they are needed: the scene's parts and the project's part files, six to a ring, with More ▸.
  const PAGE=6;
  function paged(list,page,next,item) {
    const shown=list.length>PAGE+1?list.slice(page*PAGE,page*PAGE+PAGE):list;
    const items=shown.map(item);
    if(list.length>PAGE+1&&(page+1)*PAGE<list.length)items.push({key:'more',label:'More',aliases:['more parts','next'],local:true,open:`${next}:${page+1}`,detail:`${list.length-(page+1)*PAGE} more`});
    return items;
  }
  function menuOf(key) {
    const [kind,page]=key.split(':');
    if(kind==='parts')return {title:Number(page)?`Parts · ${Number(page)+1}`:'Parts',items:()=>paged(objects(),Number(page),'parts',o=>({key:o.id,label:o.name,detail:[o.category,o.marks?`${o.marks} marks`:null].filter(Boolean).join(' · ')||null,
      active:o.id===link.state?.selected,press:()=>{select(o.id);stack=[top()];menu=top();radial.signature='';say(`Selected ${o.name}`);}}))};
    if(kind==='add'){loadProjectFiles();return {title:'Add part',items:()=>{
      if(projectFiles.files===null)return [{key:'loading',label:'Loading…',local:true,press:()=>{}}];
      if(!projectFiles.files.length)return [{key:'upload',label:'Upload',detail:'On the computer: Import',local:true,press:()=>say('Add parts on the computer: Import, or Open project')}];
      return paged(projectFiles.files,Number(page),'add',file=>({key:file.replace(/[^\w.-]/g,'_'),label:file.split('/').pop().replace(/\.(stl|obj)$/i,'').replace(/[_-]+/g,' '),detail:'＋ beside the scene',
        press:()=>{say(`Adding ${file.split('/').pop()}…`);api('/api/projects/add',{project:projectFiles.project,file}).then(()=>{say(`Added ${file.split('/').pop()}`);stack=[top()];menu=top();radial.signature='';}).catch(error=>say(error.message));}}));}};}
    return MENUS[key];
  }
  // A menu's items, with each `open` item opening its ring.
  const itemsOf=key=>menuOf(key).items().map(item=>item.open?{...item,press:()=>open(item.open)}:item);
  const top=()=>stage()==='scene'?'scene':mode()==='edit'?'annotate':'inspect';
  function open(key){stack.push(key);menu=key;radial.signature='';}
  function back(){stack.pop();menu=stack.at(-1)||null;radial.signature='';if(!menu)closeMenu();}
  function openMenu(path=[]) {
    keyboard.mesh.visible=false;voice.cancel();
    // Fixed in the room in front of you (not on the moving wrist), a little below eye level.
    place(radial.mesh,.38,-.16);radial.mesh.visible=true;radial.since=performance.now();
    stack=[top(),...path];menu=stack.at(-1);radial.signature='';
  }
  function closeMenu(){radial.mesh.visible=false;menu=null;stack=[];}
  // "Open tools", "show style", …: a ring by name, from wherever the watch is.
  function openNamed(name) {
    const key={'mark style':'style',backgrounds:'background',parts:'parts:0',add:'add:0'}[name]||name;
    if(key==='background'){openMenu(['settings','background']);return true;}
    if(key==='part-color'){if(stage()!=='scene'||!selected())return false;openMenu(['part','part-color']);return true;}
    if(['tools','style'].includes(key)){if(stage()!=='object')return false;if(mode()!=='edit')setMode('edit');}
    const root=['tools','style'].includes(key)?'annotate':top();
    if(!itemsOf(root).some(item=>item.open===key))return false;
    openMenu([key]);stack[0]=root;return true;
  }
  function confirmSend(){openMenu(['send']);}
  function openKeyboard(which,after=null) {
    closeMenu();field=which;then=after;text=settings()[which]||'';voiceNote='';
    place(keyboard.mesh,.4,-.24);keyboard.mesh.visible=true;keyboard.signature='';keyboard.since=performance.now();
  }
  function closeKeyboard(){voice.cancel();keyboard.mesh.visible=false;then=null;}
  function done() {
    const after=then;set({[field]:text.slice(0,LIMITS[field])}).then(()=>after?.());
    say(field==='meaning'?'Color meaning saved':'Note saved');closeKeyboard();
  }
  function dictate(){openKeyboard('description');voice.start();}
  function place(mesh,distance,drop) {
    const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camera().quaternion);forward.y=0;
    if(forward.lengthSq()<1e-6)forward.set(0,0,-1);
    forward.normalize();
    mesh.position.copy(camera().position).addScaledVector(forward,distance).add(new THREE.Vector3(0,drop,0));
    mesh.lookAt(camera().position);
  }

  // ---------- drawing ----------
  function drawFace() {
    const c=face.context,s=face.canvas.width,isOpen=radial.mesh.visible||keyboard.mesh.visible,hot=hovered.has('watch:face');
    const signature=`${isOpen}:${hot}:${top()}`;if(signature===face.signature)return;face.signature=signature;
    c.clearRect(0,0,s,s);
    c.beginPath();c.arc(s/2,s/2,s/2-8,0,Math.PI*2);c.fillStyle=hot?UI.hover:'#101820';c.fill();c.lineWidth=10;c.strokeStyle=isOpen?UI.ink:top()==='annotate'?UI.accent:UI.mint;c.stroke();
    // A small pie menu as the dial.
    for(let i=0;i<6;i++){const a=i/6*Math.PI*2;c.beginPath();c.arc(s/2+Math.cos(a)*62,s/2+Math.sin(a)*62,14,0,Math.PI*2);c.fillStyle=top()==='annotate'?UI.accent:UI.mint;c.fill();}
    c.beginPath();c.arc(s/2,s/2,26,0,Math.PI*2);c.fillStyle=UI.ink;c.fill();
    face.regions=[{id:'watch:face',contains:()=>true,press:()=>(radial.mesh.visible||keyboard.mesh.visible)?close():openMenu()}];
    face.texture.needsUpdate=true;
  }
  function drawRadial() {
    if(!radial.mesh.visible||!menu)return;
    const spec=menuOf(menu),items=itemsOf(menu),value=spec.value?.()||'';
    const signature=JSON.stringify([stack,items.map(item=>[item.label,item.active,item.detail,item.swatch]),value,[...hovered]]);
    if(signature===radial.signature)return;radial.signature=signature;
    const c=radial.context,S=radial.canvas.width,C=S/2,outer=500,inner=175,n=Math.max(items.length,1),slice=Math.PI*2/n;
    c.clearRect(0,0,S,S);radial.regions=[];
    items.forEach((item,i)=>{
      const start=-Math.PI/2+i*slice-slice/2,end=start+slice,id=`radial:${menu}:${item.key}`;
      c.beginPath();c.arc(C,C,outer,start,end);c.arc(C,C,inner,end,start,true);c.closePath();
      c.fillStyle=item.fill||(item.active?UI.active:hovered.has(id)?UI.hover:item.primary?UI.primary:UI.fill);c.fill();
      if(item.fill&&hovered.has(id)){c.fillStyle='#ffffff38';c.fill();}
      c.lineWidth=item.active?10:4;c.strokeStyle=item.active?UI.accent:UI.line;c.stroke();
      const mid=(start+end)/2,r=(outer+inner)/2,dark=Boolean(item.fill),width=Math.min(250,2*r*Math.sin(slice/2)*.9);
      c.fillStyle=dark?UI.paper:UI.ink;c.font=`600 ${n>6?40:46}px ${UI.sans}`;c.textAlign='center';c.textBaseline='middle';
      const lines=wrapText(c,item.open?`${item.label} ▸`:item.label,width,2),x=C+Math.cos(mid)*r,y=C+Math.sin(mid)*r-(item.detail?20:0);
      lines.forEach((line,k)=>c.fillText(line,x,y+(k-(lines.length-1)/2)*48));
      if(item.detail) {
        c.font=`500 30px ${UI.sans}`;c.fillStyle=dark?UI.paper:UI.muted;
        const detail=wrapText(c,item.detail,width-(item.swatch?30:0),1)[0]||'',dy=y+lines.length*24+22,shift=item.swatch?15:0;
        c.fillText(detail,x+shift,dy);
        if(item.swatch){const w=c.measureText(detail).width;c.beginPath();c.arc(x+shift-w/2-18,dy,11,0,Math.PI*2);c.fillStyle=item.swatch;c.fill();}
      }
      radial.regions.push({id,press:item.press,contains:(px,py)=>{
        const dx=px-C,dy=py-C,distance=Math.hypot(dx,dy);if(distance<inner||distance>outer)return false;
        const angle=((Math.atan2(dy,dx)+Math.PI/2+slice/2)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
        return Math.floor(angle/slice)===i;}});
    });
    // The middle: where you are, the ring's value, and Back (or Close on the first ring).
    const first=stack.length<2,hot=hovered.has('radial:center');
    c.beginPath();c.arc(C,C,inner-12,0,Math.PI*2);c.fillStyle=hot?UI.hover:'#0d141bf5';c.fill();c.lineWidth=4;c.strokeStyle=UI.accent;c.stroke();
    c.fillStyle=UI.accent;c.font=`650 30px ${UI.sans}`;c.textAlign='center';
    wrapText(c,spec.title.toUpperCase(),280,2).forEach((line,k)=>c.fillText(line,C,C-70+k*34));
    if(stack.length>2){c.fillStyle=UI.muted;c.font=`500 22px ${UI.sans}`;c.fillText(stack.slice(1,-1).map(key=>menuOf(key).title).join(' › ').slice(0,30),C,C-112);}
    if(value){c.fillStyle=UI.ink;c.font=`600 ${value.length>8?32:48}px ${UI.sans}`;c.fillText(value,C,C+5);}
    c.fillStyle=UI.muted;c.font=`600 34px ${UI.sans}`;c.fillText(first?'Close':'‹ Back',C,C+72);
    radial.regions.push({id:'radial:center',press:back,contains:(x,y)=>Math.hypot(x-C,y-C)<inner-12});
    radial.texture.needsUpdate=true;
  }
  const ROWS=['1234567890','qwertyuiop','asdfghjkl,','zxcvbnm-.'];
  function drawKeyboard() {
    if(!keyboard.mesh.visible)return;
    const signature=JSON.stringify([field,text,[...hovered],voice.state,voiceNote]);if(signature===keyboard.signature)return;keyboard.signature=signature;
    const c=keyboard.context,W=keyboard.canvas.width,H=keyboard.canvas.height,pad=24,key=(W-2*pad)/10;
    c.clearRect(0,0,W,H);c.fillStyle=UI.fill;c.beginPath();c.roundRect(0,0,W,H,36);c.fill();
    keyboard.regions=[];
    const button=(id,x,y,w,h,label,press,primary=false)=>{
      c.fillStyle=primary?UI.active:hovered.has(id)?UI.hover:UI.raised;c.beginPath();c.roundRect(x+5,y+5,w-10,h-10,14);c.fill();
      c.fillStyle=UI.ink;c.font=`600 ${label.length>1?40:52}px ${UI.sans}`;c.textAlign='center';c.textBaseline='middle';c.fillText(label,x+w/2,y+h/2);
      keyboard.regions.push({id,press,contains:(px,py)=>px>=x&&px<=x+w&&py>=y&&py<=y+h});
    };
    // What is being written: the label, then the last lines of the text with a caret.
    c.fillStyle=UI.accent;c.font=`650 30px ${UI.sans}`;c.textAlign='left';c.textBaseline='middle';
    c.fillText(field==='meaning'?'WHAT THIS COLOR MEANS':'THE CHANGE YOU WANT',pad+8,pad+20);
    c.fillStyle=UI.muted;c.textAlign='right';c.font=`500 26px ${UI.sans}`;c.fillText(`${text.length}/${LIMITS[field]}`,W-pad-8,pad+20);
    const boxTop=pad+44,boxHeight=176;
    c.fillStyle='#0b1117';c.beginPath();c.roundRect(pad,boxTop,W-2*pad,boxHeight,18);c.fill();
    const listening=voice.state==='listening'||voice.state==='starting',working=voice.state==='working';
    c.textAlign='left';c.font=`500 40px ${UI.sans}`;
    if(listening||working||voiceNote||!text){
      c.fillStyle=listening?UI.accent:UI.muted;
      c.fillText(listening?'Listening… say the change, then tap Stop':working?'Working out what you said…':voiceNote||'Tap keys, or 🎤 Speak',pad+24,boxTop+boxHeight/2);
    } else {
      c.fillStyle=UI.ink;const lines=[];let all=wrapText(c,`${text}|`,W-2*pad-48,200);lines.push(...all.slice(-3));
      lines.forEach((line,k)=>c.fillText(line,pad+24,boxTop+40+k*50));
    }
    const top=boxTop+boxHeight+12,row=(H-top-pad)/5;
    ROWS.forEach((keys,r)=>[...keys].forEach((k,i)=>button(`key:${k}`,pad+i*key+(r===2?key*.25:r===3?key*.5:0),top+r*row,key,row,k.toUpperCase(),()=>{text=(text+k).slice(0,LIMITS[field]);})));
    const y=top+4*row;
    button('key:cancel',pad,y,key*2,row,'Cancel',closeKeyboard);
    button('key:voice',pad+key*2,y,key*2,row,voice.state==='listening'?'■ Stop':voice.state==='working'?'…':'🎤 Speak',()=>{voiceNote='';voice.toggle();},voice.state==='listening');
    button('key:space',pad+key*4,y,key*2,row,'Space',()=>{text=(text+' ').slice(0,LIMITS[field]);});
    button('key:back',pad+key*6,y,key*2,row,'⌫',()=>{text=text.slice(0,-1);});
    button('key:done',pad+key*8,y,key*2,row,'Done',done,true);
    keyboard.texture.needsUpdate=true;
  }
  // The right wrist's button: Annotate ▸ in Inspect, Submit (with the number of marks) in Annotate.
  function drawWrist() {
    const inScene=stage()==='scene',inspecting=!inScene&&mode()!=='edit',hot=hovered.has('wrist:button');
    const label=inScene?(selected()?'Edit ▸':'Pick a part'):inspecting?'Annotate ▸':`Submit · ${marks()}`;
    const signature=JSON.stringify([label,hot]);if(signature===wrist.signature)return;wrist.signature=signature;
    const c=wrist.context,W=wrist.canvas.width,H=wrist.canvas.height,idle=inScene&&!selected();
    c.clearRect(0,0,W,H);c.beginPath();c.roundRect(8,8,W-16,H-16,60);c.fillStyle=hot?'#3d6f68':idle?'#1c2731':inScene||inspecting?UI.raised:UI.primary;c.fill();
    c.lineWidth=10;c.strokeStyle=idle?UI.line:inScene||inspecting?UI.mint:UI.accent;c.stroke();
    c.fillStyle=idle?UI.muted:'#fffbe8';c.font=`700 ${label.length>9?76:92}px ${UI.sans}`;c.textAlign='center';c.textBaseline='middle';c.fillText(label,W/2,H/2+4);
    wrist.regions=[{id:'wrist:button',contains:()=>true,press:()=>inScene?editPart():inspecting?setMode('edit'):send()}];
    wrist.texture.needsUpdate=true;
  }

  // The card above the selected part, drawn from its bottom up: the name and Edit ▸, and the stats above them.
  function statLines(item) {
    const lines=[['Triangles',item.triangles.toLocaleString()+(item.source_triangles>item.triangles?` (of ${item.source_triangles.toLocaleString()})`:'')],
      ['Size',`${item.dimensions_mm.map(d=>d.toFixed(1)).join(' × ')} mm`],['Mesh',item.watertight?'Closed (watertight)':'Has open edges'],
      ['Marks',String(item.marks||0)]];
    if(item.category)lines.push(['Category',title(item.category)]);
    if(item.print_file)lines.push(['Print file',item.print_file.split('/').pop()]);
    return lines.slice(0,5);
  }
  function drawCard() {
    if(!card.mesh.visible)return;
    const item=selected();if(!item)return;
    const signature=JSON.stringify([item,statsShown,hovered.has('card:edit')]);if(signature===card.signature)return;card.signature=signature;
    const c=card.context,W=card.canvas.width,H=card.canvas.height,band=150,top=H-band;
    c.clearRect(0,0,W,H);card.regions=[];
    if(statsShown) {
      const lines=statLines(item),rowH=52,boxTop=top-16-lines.length*rowH-24;
      c.fillStyle=UI.fill;c.beginPath();c.roundRect(0,boxTop,W,top-12-boxTop,26);c.fill();
      c.textBaseline='middle';
      lines.forEach(([label,value],k)=>{const y=boxTop+24+rowH*(k+.5);
        c.textAlign='left';c.fillStyle=UI.muted;c.font=`500 34px ${UI.sans}`;c.fillText(label,28,y);
        c.fillStyle=UI.ink;c.font=`600 38px ${UI.sans}`;c.fillText(wrapText(c,value,W-250,1)[0]||'',220,y);});
    }
    c.fillStyle=UI.fill;c.beginPath();c.roundRect(0,top,W,band,30);c.fill();c.lineWidth=5;c.strokeStyle=UI.accent;c.stroke();
    c.textAlign='left';c.textBaseline='middle';c.fillStyle=UI.ink;c.font=`650 44px ${UI.sans}`;
    c.fillText(wrapText(c,item.name,470,1)[0]||'',30,top+(item.category?52:band/2));
    if(item.category){c.fillStyle=UI.muted;c.font=`500 28px ${UI.sans}`;c.fillText(title(item.category),30,top+102);}
    const bx=W-250,by=top+18,bw=232,bh=band-36,hot=hovered.has('card:edit');
    c.fillStyle=hot?'#3d6f68':UI.primary;c.beginPath();c.roundRect(bx,by,bw,bh,22);c.fill();c.lineWidth=5;c.strokeStyle=UI.mint;c.stroke();
    c.fillStyle='#fffbe8';c.font=`700 46px ${UI.sans}`;c.textAlign='center';c.fillText('Edit ▸',bx+bw/2,by+bh/2+2);
    card.regions=[{id:'card:edit',press:()=>editPart(),contains:(x,y)=>x>=bx&&x<=bx+bw&&y>=by&&y<=by+bh}];
    card.texture.needsUpdate=true;
  }
  // Above the selected part, upright and turned to you; larger further off, so it stays readable.
  function placeCard() {
    const item=stage()==='scene'?selected():null,box=item?bounds(item.id):null;
    if(!box){card.mesh.visible=false;card.shown=null;return;}
    if(card.shown!==item.id){card.shown=item.id;card.since=performance.now();card.signature='';}
    const centre=box.getCenter(new THREE.Vector3()),eye=camera().position,size=THREE.MathUtils.clamp(eye.distanceTo(centre)/.9,1,4);
    card.mesh.scale.setScalar(size);
    card.mesh.position.set(centre.x,box.max.y+.012*size+card.height*size/2,centre.z);
    card.mesh.lookAt(eye.x,card.mesh.position.y,eye.z);card.mesh.visible=true;
  }
  // A laser on the card: what it points at (only a button catches it; the rest of the card lets the laser through).
  function laser(hand,ray) {
    hand.laserHover=null;
    if(!card.mesh.visible)return null;
    card.mesh.updateMatrixWorld();
    const hit=ray.intersectObject(card.mesh,false)[0];if(!hit)return null;
    const {x,y}=card.toCanvas(card.mesh.worldToLocal(hit.point.clone())),region=card.regionAt(x,y);if(!region)return null;
    hand.laserHover=region.id;
    const settled=performance.now()-(card.since||0)>POKE.settle;
    return {id:region.id,distance:hit.distance,point:hit.point,press:()=>{if(settled){hand.presses=(hand.presses||0)+1;region.press();}}};
  }

  // ---------- the watch on your left wrist, the button on your right ----------
  const handOf=side=>hands.find(hand=>hand.source?.handedness===side);
  function wear(s,hand,side) {
    s.mesh.visible=Boolean(hand);
    if(!hand)return;
    const wristJoint=hand.tracked&&joint(hand,'wrist'),index=hand.tracked&&joint(hand,'index-finger-metacarpal'),little=hand.tracked&&joint(hand,'pinky-finger-metacarpal');
    if(wristJoint&&index&&little) {
      // On the back of the wrist, facing out of it (the palm of the left hand faces b × a, of the right a × b).
      const a=index.position.clone().sub(wristJoint.position),b=little.position.clone().sub(wristJoint.position);
      const outward=(side==='left'?a.clone().cross(b):b.clone().cross(a)).normalize();
      s.mesh.position.copy(wristJoint.position).addScaledVector(outward,.022);
      s.mesh.lookAt(s.mesh.position.clone().add(outward));
    } else {
      // On top of the controller.
      hand.grip.updateMatrixWorld();
      s.mesh.position.copy(hand.grip.localToWorld(new THREE.Vector3(0,.035,.04)));
      s.mesh.lookAt(camera().position);
    }
  }

  // ---------- tapping with a fingertip ----------
  const visible=()=>surfaces.filter(s=>s.mesh.visible);
  function pokeBy(point,hand) {
    for(const s of visible()) {
      if(s===face&&hand===handOf('left')||s===wrist&&hand===handOf('right'))continue;   // not pressed by their own wrist
      const local=s.mesh.worldToLocal(point.clone());
      if(Math.abs(local.x)>s.width/2||Math.abs(local.y)>s.height/2)continue;
      return {surface:s,depth:Math.abs(local.z),...s.toCanvas(local)};
    }
    return null;
  }
  // Called for each hand every frame with its fingertip: a region lights as the fingertip comes near and is pressed
  // when it touches; it presses again only after the fingertip lifts off. onUI while the hand is at the interface.
  function pointer(hand,{fingertip}) {
    const touch=fingertip?pokeBy(fingertip,hand):null,near=touch&&touch.depth<POKE.hover;
    const region=near?touch.surface.regionAt(touch.x,touch.y):null;
    hand.uiHover=region?.id||null;
    // A window that has only just opened under a fingertip is not pressed by it: the finger lifts off and comes back.
    const settled=!touch||performance.now()-(touch.surface.since||0)>POKE.settle;
    if(touch&&touch.depth<POKE.touch){if(!hand.poking){hand.poking=true;if(region&&settled){hand.presses=(hand.presses||0)+1;region.press?.();}}}
    else if(!touch||touch.depth>POKE.release)hand.poking=false;
    return {onUI:Boolean(near)};
  }

  let captionUntil=0;
  function update() {
    wear(face,handOf('left'),'left');wear(wrist,handOf('right'),'right');
    placeCard();
    hovered=new Set(hands.flatMap(hand=>[hand.uiHover,hand.laserHover]).filter(Boolean));
    // The selection went (or Edit part began): its rings go with it.
    if(radial.mesh.visible&&['part','part-color'].includes(menu)&&(!selected()||stage()!=='scene')){stack=[top()];menu=top();radial.signature='';}
    // The mode changed (on the computer, by voice, or from the wrist): the menu follows it.
    if(radial.mesh.visible&&stack[0]!==top()&&!['tools','style'].includes(stack[1])){stack=[top()];menu=top();radial.signature='';}
    if(radial.mesh.visible&&menu&&!menuOf(menu))back();
    drawFace();drawRadial();drawKeyboard();drawWrist();drawCard();
    if(caption.mesh.visible&&performance.now()>captionUntil)caption.mesh.visible=false;
  }
  function close(){closeMenu();closeKeyboard();card.mesh.visible=false;}   // (the card comes back next frame while in VR)
  // A short caption in front of you: what happened, or what a voice command was heard as.
  function say(message) {
    const c=caption.context,W=caption.canvas.width,H=caption.canvas.height;
    c.clearRect(0,0,W,H);c.fillStyle=UI.fill;c.beginPath();c.roundRect(0,0,W,H,H/2);c.fill();
    c.fillStyle=UI.accent;c.font=`600 ${Math.round(H*.42)}px ${UI.sans}`;c.textAlign='center';c.textBaseline='middle';
    c.fillText(wrapText(c,message,W-60,1)[0]||'',W/2,H/2+2);
    caption.texture.needsUpdate=true;place(caption.mesh,.6,-.22);caption.mesh.visible=true;captionUntil=performance.now()+2500;caption.text=message;
  }

  // What can be said while a menu is open: each option on show, by its label (and any spoken names), and Back or
  // Close. Pressing it does exactly what tapping it would. With `everywhere`, any option in this mode's menus too
  // ("Pin a note", "Smooth or blend", "Brush"): the menu moves to where that option lives, then presses it.
  function voiceOptions(everywhere=false) {
    const options=[],press=fn=>()=>{fn();radial.signature='';};
    if(everywhere) {
      if(!radial.mesh.visible)return options;
      const seen=new Set();
      const walk=(key,path)=>{if(seen.has(key))return;seen.add(key);
        for(const item of itemsOf(key)) {
          if(!item.local)options.push({label:item.label,aliases:item.aliases||[],press:press(()=>{stack=[...path];menu=stack.at(-1);item.press();})});
          if(item.open)walk(item.open,[...path,item.open]);   // a ring's More pages too
        }};
      walk(top(),[top()]);
      return options;
    }
    if(radial.mesh.visible&&menu) {
      for(const item of itemsOf(menu))options.push({label:item.label,aliases:item.aliases||[],press:press(item.press)});
      options.push(stack.length<2?{label:'Close',aliases:['close menu','close the menu'],press:closeMenu}:{label:'Back',aliases:['go back'],press:press(back)});
    }
    if(keyboard.mesh.visible)options.push({label:'Done',aliases:['save'],press:done},{label:'Cancel',aliases:[],press:closeKeyboard});
    return options;
  }

  return {update,pointer,laser,close,say,voiceOptions,openNamed,confirmSend,dictate,send,editPart,showStats,unselect,paint,
    openMenu:()=>{if(!radial.mesh.visible)openMenu();},
    get searching(){return voice.state!=='idle';},   // the keyboard's microphone is in use
    // Any menu up: the model is not gripped or marked meanwhile.
    get busy(){return radial.mesh.visible||keyboard.mesh.visible;},
    get state(){
      const regions=s=>s.mesh.visible?s.regions.map(({id})=>id):[];
      return {caption:caption.mesh.visible?caption.text:null,voice:voice.state,voiceNote,face:face.mesh.visible?face.mesh.position.toArray():null,
        button:wrist.mesh.visible?wrist.mesh.position.toArray():null,buttonLabel:wrist.signature?JSON.parse(wrist.signature)[0]:null,
        menu:radial.mesh.visible?menu:null,path:radial.mesh.visible?[...stack]:[],keyboard:keyboard.mesh.visible?field:null,text,
        card:card.mesh.visible?{part:card.shown,stats:statsShown?statLines(selected()).map(([label])=>label):null,position:card.mesh.position.toArray()}:null,
        regions:{watch:regions(face),radial:regions(radial),keyboard:regions(keyboard),wrist:regions(wrist),card:regions(card)}};
    },
    // Where a region's middle is in the room, for the browser test to point or poke at it.
    regionPoint(id){
      for(const s of surfaces) {
        if(!s.mesh.visible)continue;
        const region=s.regions.find(r=>r.id===id);if(!region)continue;
        const W=s.canvas.width,H=s.canvas.height;let best=null;
        for(let y=0;y<H&&!best;y+=6)for(let x=0;x<W;x+=6)if(region.contains(x,y)){
          // The first hit row's middle stretch: scan along it.
          let x2=x;while(x2+6<W&&region.contains(x2+6,y))x2+=6;
          let y2=y;while(y2+6<H&&region.contains((x+x2)/2,y2+6))y2+=6;
          best={x:(x+x2)/2,y:(y+y2)/2};break;
        }
        if(!best)return null;
        s.mesh.updateMatrixWorld();
        return s.mesh.localToWorld(new THREE.Vector3((best.x/W-.5)*s.width,(.5-best.y/H)*s.height,0)).toArray();
      }
      return null;
    }};
}
