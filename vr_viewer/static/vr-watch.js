// The left-wrist watch: tap its dial with a fingertip and a pie menu opens in front of you, within reach. Its options
// follow what you are doing: the scene (its parts to select, Open ▸ and Add part ▸ to browse the computer's model
// files, View part), or one part on its own (◀ Scene, its stats and color). Options marked ▸ open the next ring; the
// middle goes back one ring. Tap the options the same way (there are no lasers at the menus).
// The right-wrist button: View ▸ (the selected part) in the scene; ◀ Scene while one part is shown. A card floats
// above the part: its name and View ▸ (or ◀ Scene), pressed with the laser and a pinch or a fingertip, and its stats
// when asked for (Part ▸ Stats, or "show stats").
import * as THREE from 'three';

// A part's own color (Gray is the plain default); kept with the workspace, so every device shows it.
export const PART_COLORS=[{label:'Gray',color:null,fill:'#e3e3e3'},{label:'Red',color:'#d9534f'},{label:'Orange',color:'#f0913a'},
  {label:'Yellow',color:'#f2d14b'},{label:'Green',color:'#5cb85c'},{label:'Blue',color:'#3a7bd5'}];
const UI={ink:'#ecf1f6',muted:'#a5b6c5',accent:'#ffb86b',mint:'#6be0d4',fill:'#17212bf2',raised:'#243441',hover:'#34495a',active:'#6b5034',
  primary:'#2d5550',line:'#415361',paper:'#17212b',sans:'Inter,"Segoe UI",Arial,sans-serif'};
const POKE={touch:.012,release:.025,hover:.07,settle:350};   // fingertip distance (m) that presses, lets go, lights; ms a new window ignores presses
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

export function createWatch({scene,camera,joint,hands,link,stage,setStage,select,bounds,exit,fit,openFile,backgrounds,voiceCommands,api}) {
  const face=surface('watch',.045,.045,256),radial=surface('pie menu',.42,.42,1024);
  const wrist=surface('wrist button',.075,.04,512),caption=surface('caption',.34,.05,870),card=surface('part card',.3,.165,800);
  for(const s of [face,radial,wrist,caption,card])scene.add(s.mesh);
  face.mesh.renderOrder=1050;card.mesh.renderOrder=1040;
  const surfaces=[face,radial,wrist,card];
  let menu=null,stack=[],hovered=new Set(),statsShown=false;
  const objects=()=>link.state?.scene.objects||[];
  const selected=()=>objects().find(o=>o.id===link.state?.selected)||null;
  // The part the card and Part ▸ are about: the selected one in the scene, or the one shown alone.
  const current=()=>stage()==='scene'?selected():objects().find(o=>o.id===link.state?.model.object_id)||null;
  const partColor=()=>{const color=current()?.color||null;return PART_COLORS.find(choice=>choice.color===color)||{label:'Custom',color,fill:color};};
  const shorten=(name,length)=>name.length>length?`${name.slice(0,length-1)}…`:name;
  const fileName=path=>String(path||'').split(/[\\/]/).pop();

  // ---------- the file browser: the computer's folders and model files, a ring per folder ----------
  // Rings are keyed files:<mode>:<folder>:<page>, where <folder> indexes the folders visited (0: where browsing
  // starts, the open model's folder); each folder's listing is fetched when its ring first shows.
  const browser={folders:[null],listings:new Map()};
  function folderRing(mode,path) {
    let index=browser.folders.indexOf(path);
    if(index<0){browser.folders.push(path);index=browser.folders.length-1;}
    return `files:${mode}:${index}:0`;
  }
  function listing(index) {
    const key=browser.folders[index];
    if(!browser.listings.has(key)) {
      browser.listings.set(key,null);
      api(key===null?'/api/files':`/api/files?path=${encodeURIComponent(key)}`).then(found=>browser.listings.set(key,found))
        .catch(error=>browser.listings.set(key,{error:error.message})).finally(()=>{radial.signature='';});
    }
    return browser.listings.get(key);
  }
  function openModel(path,mode,name) {
    closeMenu();say(`${mode==='add'?'Adding':'Opening'} ${name}…`);
    openFile(path,mode).then(()=>say(mode==='add'?`Added ${name}`:`Opened ${name}`)).catch(error=>say(error.message));
  }

  // The selected part's stats on its card: shown or hidden (they stay shown for the next part selected).
  function showStats(shown=!statsShown) {
    if(!current()){say('Pick a part first: point at it and pinch');return;}
    statsShown=shown;card.signature='';say(shown?`${current().name} · stats`:'Stats hidden');
  }
  function unselect() {
    if(!selected()){say('Nothing is selected');return;}
    if(stage()!=='scene')setStage('scene');
    select(null);say('Nothing selected');
    if(radial.mesh.visible){stack=['scene'];menu='scene';radial.signature='';}
  }
  // "Make it blue": a part color by name, for the selected part.
  function paint(label) {
    const item=current(),choice=PART_COLORS.find(c=>c.label.toLowerCase()===String(label).toLowerCase().replace('grey','gray'));
    if(!item){say('Pick a part first: point at it and pinch');return;}
    if(!choice)return;
    link.action({type:'part_color',object_id:item.id,color:choice.color}).catch(error=>say(error.message));say(`${item.name} · ${choice.label}`);
  }
  function viewPart() {
    const item=selected();
    if(!item){say('Pick a part first: point at it and pinch');return;}
    closeMenu();setStage('object');say(`${item.name} on its own`);
  }

  // ---------- the menus ----------
  // An item with `open` opens that ring; `local` items (confirmations, paging) can be said only while on show.
  // `detail` is the current value, shown under the label; `fill` colors the slice, `swatch` adds a dot.
  const settingsItem=()=>({key:'settings',label:'Settings',open:'settings',detail:voiceCommands.on?'Voice on':'Voice off'});
  const MENUS={
    scene:{title:'Scene',value:()=>shorten(link.state?.scene.name||'',14),items:()=>[
      {key:'parts',label:'Parts',aliases:['select a part','parts list'],open:'parts:0',detail:selected()?shorten(selected().name,18):`${objects().length} parts`},
      {key:'open',label:'Open',aliases:['open a model','open file','files','browse'],open:'files:open:0:0',detail:'A model file'},
      {key:'add',label:'Add part',aliases:['add','add a part'],open:'files:add:0:0',detail:'Beside the scene'},
      {key:'view',label:'View part',aliases:['view','view this part','show it alone'],detail:selected()?shorten(selected().name,18):'Pick one first',primary:Boolean(selected()),press:()=>viewPart()},
      ...selected()?[{key:'part',label:'Part',aliases:['this part','selected part','selection'],open:'part',detail:shorten(selected().name,18),swatch:partColor().fill||partColor().color}]:[],
      {key:'reset',label:'Reset view',press:()=>fit()},
      settingsItem()]},
    object:{title:'One part',value:()=>shorten(current()?.name||'',14),items:()=>[
      {key:'scene',label:'◀ Scene',aliases:['scene','back to scene','whole scene'],detail:'All parts',press:()=>{setStage('scene');}},
      {key:'reset',label:'Reset view',press:()=>fit()},
      {key:'stats',label:statsShown?'Hide stats':'Stats',aliases:['stats','show stats','hide stats','statistics','part info','details'],active:statsShown,press:()=>showStats()},
      {key:'color',label:'Color',aliases:['part color','part colour','change color','paint part','recolor'],open:'part-color',detail:partColor().label,swatch:partColor().fill||partColor().color},
      settingsItem()]},
    // The selected part: view it alone, its stats, its color, or let it go.
    part:{title:'Part',value:()=>shorten(selected()?.name||'',14),items:()=>[
      {key:'view',label:'View part',aliases:['view','view this part','show it alone'],primary:true,press:()=>viewPart()},
      {key:'stats',label:statsShown?'Hide stats':'Stats',aliases:['stats','show stats','hide stats','statistics','part info','details'],active:statsShown,press:()=>showStats()},
      {key:'color',label:'Color',aliases:['part color','part colour','change color','paint part','recolor'],open:'part-color',detail:partColor().label,swatch:partColor().fill||partColor().color},
      {key:'unselect',label:'Unselect',aliases:['deselect','clear selection','select nothing'],press:()=>unselect()}]},
    'part-color':{title:'Part color',value:()=>shorten(current()?.name||'',14),items:()=>PART_COLORS.map(choice=>({key:choice.label.toLowerCase(),label:choice.label,
      fill:choice.fill||choice.color,active:partColor().color===choice.color,press:()=>{const item=current();if(!item)return;
        link.action({type:'part_color',object_id:item.id,color:choice.color}).catch(error=>say(error.message));say(`${item.name} · ${choice.label}`);back();}}))},
    // A living background can be paused at its time of day (and run on again).
    background:{title:'Background',items:()=>[...backgrounds.list.map(b=>({key:b.key,label:b.label,aliases:b.aliases,active:backgrounds.current===b.key,detail:b.living?'Sun and moon':undefined,press:()=>backgrounds.set(b.key)})),
      ...backgrounds.living?[{key:'time',label:backgrounds.running?'Pause sky':'Run sky',aliases:['pause the sky','stop the sky','run the sky','start the sky'],active:!backgrounds.running,press:()=>backgrounds.pause()}]:[]]},
    settings:{title:'Settings',items:()=>[
      {key:'background',label:'Background',aliases:['backgrounds','room'],open:'background',detail:backgrounds.list.find(b=>b.key===backgrounds.current)?.label},
      {key:'voice',label:voiceCommands.on?'Voice: on':'Voice: off',aliases:['voice'],active:voiceCommands.on,press:()=>voiceCommands.toggle()},
      {key:'exit',label:'Exit VR',aliases:['exit'],open:'exit'}]},
    // Leaving VR takes a second, deliberate choice.
    exit:{title:'Leave VR?',items:()=>[{key:'confirm',label:'Yes, exit',aliases:['yes','exit','exit vr'],local:true,press:()=>exit()},
      {key:'stay',label:'Stay',aliases:['no','cancel'],local:true,press:()=>back()}]},
  };
  // Rings made as they are needed: the scene's parts and a folder's contents, six to a ring, with More ▸.
  const PAGE=6;
  function paged(list,page,next,item) {
    const shown=list.length>PAGE+1?list.slice(page*PAGE,page*PAGE+PAGE):list;
    const items=shown.map(item);
    if(list.length>PAGE+1&&(page+1)*PAGE<list.length)items.push({key:'more',label:'More',aliases:['more','next'],local:true,open:`${next}:${page+1}`,detail:`${list.length-(page+1)*PAGE} more`});
    return items;
  }
  function menuOf(key) {
    const [kind,...rest]=key.split(':');
    if(kind==='parts'){const page=Number(rest[0]);return {title:page?`Parts · ${page+1}`:'Parts',items:()=>paged(objects(),page,'parts',o=>({key:o.id,label:o.name,detail:o.category||null,
      active:o.id===link.state?.selected,press:()=>{select(o.id);stack=['scene'];menu='scene';radial.signature='';say(`Selected ${o.name}`);}}))};}
    if(kind==='files') {
      const [mode,index,page]=[rest[0],Number(rest[1]),Number(rest[2])],found=listing(index);
      return {title:mode==='add'?'Add part':'Open',value:()=>found&&!found.error?shorten(found.name,14):'',items:()=>{
        if(found===null)return [{key:'loading',label:'Loading…',local:true,press:()=>{}}];
        if(found.error)return [{key:'error',label:'Cannot open',detail:shorten(found.error,22),local:true,press:()=>say(found.error)}];
        // Up a folder, then the folders, then the model files (and all of them at once, when there are several).
        const entries=[...found.parent!==null?[{kind:'up'}]:[],...found.folders.map(f=>({kind:'folder',...f})),
          ...found.files.length>1?[{kind:'all'}]:[],...found.files.map(f=>({kind:'file',...f}))];
        if(!entries.length)return [{key:'empty',label:'No models here',local:true,press:()=>{}}];
        return paged(entries,page,`files:${mode}:${index}`,entry=>{
          if(entry.kind==='up')return {key:'up',label:'Up',aliases:['up a folder','parent folder','go up'],local:true,detail:shorten(found.parent.split('/').pop()||found.root,16),open:folderRing(mode,found.parent)};
          if(entry.kind==='folder')return {key:`folder-${entry.path}`,label:entry.name,detail:'Folder',open:folderRing(mode,entry.path)};
          if(entry.kind==='all')return {key:'all',label:mode==='add'?'Add them all':'Open them all',aliases:['all of them','every model'],primary:true,detail:`${found.files.length} models`,press:()=>openModel(found.path,mode,found.name)};
          return {key:`file-${entry.path}`,label:entry.name.replace(/\.(stl|obj|3mf)$/i,''),aliases:[entry.name.replace(/\.(stl|obj|3mf)$/i,'').replace(/[_-]+/g,' ')],
            detail:entry.name.split('.').pop().toUpperCase(),press:()=>openModel(entry.path,mode,entry.name)};
        });}};
    }
    return MENUS[key];
  }
  // A menu's items, with each `open` item opening its ring.
  const itemsOf=key=>menuOf(key).items().map(item=>item.open?{...item,press:()=>open(item.open)}:item);
  const top=()=>stage()==='scene'?'scene':'object';
  function open(key) {
    // Browsing starts afresh from the open model's folder, so it follows what was opened since.
    if(/^files:\w+:0:0$/.test(key)){browser.folders=[null];browser.listings.clear();}
    stack.push(key);menu=key;radial.signature='';
  }
  function back(){stack.pop();menu=stack.at(-1)||null;radial.signature='';if(!menu)closeMenu();}
  function openMenu(path=[]) {
    // Fixed in the room in front of you (not on the moving wrist), a little below eye level.
    place(radial.mesh,.38,-.16);radial.mesh.visible=true;radial.since=performance.now();
    stack=[top()];menu=top();for(const key of path)open(key);radial.signature='';
  }
  function closeMenu(){radial.mesh.visible=false;menu=null;stack=[];}
  // "Open parts", "open files", …: a ring by name, from wherever the watch is.
  function openNamed(name) {
    const key={parts:'parts:0',files:'files:open:0:0',add:'files:add:0:0',backgrounds:'background'}[name]||name;
    if(key==='background'){openMenu(['settings','background']);return true;}
    if(key==='part-color'){if(!current())return false;openMenu(stage()==='scene'?['part','part-color']:['part-color']);return true;}
    if(key.startsWith('files:')&&stage()!=='scene')setStage('scene');
    const root=key.startsWith('files:')?'scene':top();
    if(!itemsOf(root).some(item=>item.open===key))return false;
    stack=[root];menu=root;place(radial.mesh,.38,-.16);radial.mesh.visible=true;radial.since=performance.now();open(key);return true;
  }
  function place(mesh,distance,drop) {
    const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camera().quaternion);forward.y=0;
    if(forward.lengthSq()<1e-6)forward.set(0,0,-1);
    forward.normalize();
    mesh.position.copy(camera().position).addScaledVector(forward,distance).add(new THREE.Vector3(0,drop,0));
    mesh.lookAt(camera().position);
  }

  // ---------- drawing ----------
  function drawFace() {
    const c=face.context,s=face.canvas.width,isOpen=radial.mesh.visible,hot=hovered.has('watch:face');
    const signature=`${isOpen}:${hot}:${top()}`;if(signature===face.signature)return;face.signature=signature;
    c.clearRect(0,0,s,s);
    c.beginPath();c.arc(s/2,s/2,s/2-8,0,Math.PI*2);c.fillStyle=hot?UI.hover:'#101820';c.fill();c.lineWidth=10;c.strokeStyle=isOpen?UI.ink:top()==='object'?UI.accent:UI.mint;c.stroke();
    // A small pie menu as the dial.
    for(let i=0;i<6;i++){const a=i/6*Math.PI*2;c.beginPath();c.arc(s/2+Math.cos(a)*62,s/2+Math.sin(a)*62,14,0,Math.PI*2);c.fillStyle=top()==='object'?UI.accent:UI.mint;c.fill();}
    c.beginPath();c.arc(s/2,s/2,26,0,Math.PI*2);c.fillStyle=UI.ink;c.fill();
    face.regions=[{id:'watch:face',contains:()=>true,press:()=>radial.mesh.visible?closeMenu():openMenu()}];
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
    if(stack.length>2&&!menu.startsWith('files:')){c.fillStyle=UI.muted;c.font=`500 22px ${UI.sans}`;c.fillText(stack.slice(1,-1).map(key=>menuOf(key).title).filter((t,i,all)=>t!==all[i-1]&&t!==spec.title).join(' › ').slice(0,30),C,C-112);}
    if(value){c.fillStyle=UI.ink;c.font=`600 ${value.length>8?32:48}px ${UI.sans}`;c.fillText(value,C,C+5);}
    c.fillStyle=UI.muted;c.font=`600 34px ${UI.sans}`;c.fillText(first?'Close':'‹ Back',C,C+72);
    radial.regions.push({id:'radial:center',press:back,contains:(x,y)=>Math.hypot(x-C,y-C)<inner-12});
    radial.texture.needsUpdate=true;
  }
  // The right wrist's button: View ▸ in the scene, ◀ Scene while one part is shown.
  function drawWrist() {
    const inScene=stage()==='scene',hot=hovered.has('wrist:button');
    const label=inScene?(selected()?'View ▸':'Pick a part'):'◀ Scene';
    const signature=JSON.stringify([label,hot]);if(signature===wrist.signature)return;wrist.signature=signature;
    const c=wrist.context,W=wrist.canvas.width,H=wrist.canvas.height,idle=inScene&&!selected();
    c.clearRect(0,0,W,H);c.beginPath();c.roundRect(8,8,W-16,H-16,60);c.fillStyle=hot?'#3d6f68':idle?'#1c2731':UI.raised;c.fill();
    c.lineWidth=10;c.strokeStyle=idle?UI.line:inScene?UI.mint:UI.accent;c.stroke();
    c.fillStyle=idle?UI.muted:'#fffbe8';c.font=`700 ${label.length>9?76:92}px ${UI.sans}`;c.textAlign='center';c.textBaseline='middle';c.fillText(label,W/2,H/2+4);
    wrist.regions=[{id:'wrist:button',contains:()=>true,press:()=>inScene?viewPart():setStage('scene')}];
    wrist.texture.needsUpdate=true;
  }

  // The card above the part, drawn from its bottom up: the name and View ▸ (◀ Scene), and the stats above them.
  function statLines(item) {
    const lines=[['Size',`${item.dimensions_mm.map(d=>d.toFixed(1)).join(' × ')} mm`],
      ['Triangles',item.triangles.toLocaleString()+(item.source_triangles>item.triangles?` (of ${item.source_triangles.toLocaleString()})`:'')],
      ['Mesh',item.watertight?'Closed (watertight)':'Has open edges']];
    if(item.category)lines.push(['Category',title(item.category)]);
    if(item.source_file)lines.push(['File',fileName(item.source_file)]);
    else if(item.print_file)lines.push(['Print file',fileName(item.print_file)]);
    return lines.slice(0,5);
  }
  function drawCard() {
    if(!card.mesh.visible)return;
    const item=current();if(!item)return;
    const inScene=stage()==='scene',action=inScene?'View ▸':'◀ Scene';
    const signature=JSON.stringify([item,statsShown,action,hovered.has('card:action')]);if(signature===card.signature)return;card.signature=signature;
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
    const bx=W-250,by=top+18,bw=232,bh=band-36,hot=hovered.has('card:action');
    c.fillStyle=hot?'#3d6f68':UI.primary;c.beginPath();c.roundRect(bx,by,bw,bh,22);c.fill();c.lineWidth=5;c.strokeStyle=UI.mint;c.stroke();
    c.fillStyle='#fffbe8';c.font=`700 ${action.length>6?40:46}px ${UI.sans}`;c.textAlign='center';c.fillText(action,bx+bw/2,by+bh/2+2);
    card.regions=[{id:'card:action',press:()=>inScene?viewPart():setStage('scene'),contains:(x,y)=>x>=bx&&x<=bx+bw&&y>=by&&y<=by+bh}];
    card.texture.needsUpdate=true;
  }
  // Above the part, upright and turned to you; larger further off, so it stays readable.
  function placeCard() {
    const item=current(),box=item?bounds(item.id):null;
    if(!box){card.mesh.visible=false;card.shown=null;return;}
    const shown=`${item.id}:${stage()}`;
    if(card.shown!==shown){card.shown=shown;card.since=performance.now();card.signature='';}
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
    // The selection went: its rings go with it.
    if(radial.mesh.visible&&(menu==='part'&&!selected()||menu==='part-color'&&!current())){stack=[top()];menu=top();radial.signature='';}
    // The stage changed (on the computer, by voice, or from the wrist): the menu follows it.
    if(radial.mesh.visible&&stack[0]!==top()){stack=[top()];menu=top();radial.signature='';}
    if(radial.mesh.visible&&menu&&!menuOf(menu))back();
    drawFace();drawRadial();drawWrist();drawCard();
    if(caption.mesh.visible&&performance.now()>captionUntil)caption.mesh.visible=false;
  }
  function close(){closeMenu();card.mesh.visible=false;}   // (the card comes back next frame while in VR)
  // A short caption in front of you: what happened, or what a voice command was heard as.
  function say(message) {
    const c=caption.context,W=caption.canvas.width,H=caption.canvas.height;
    c.clearRect(0,0,W,H);c.fillStyle=UI.fill;c.beginPath();c.roundRect(0,0,W,H,H/2);c.fill();
    c.fillStyle=UI.accent;c.font=`600 ${Math.round(H*.42)}px ${UI.sans}`;c.textAlign='center';c.textBaseline='middle';
    c.fillText(wrapText(c,message,W-60,1)[0]||'',W/2,H/2+2);
    caption.texture.needsUpdate=true;place(caption.mesh,.6,-.22);caption.mesh.visible=true;captionUntil=performance.now()+2500;caption.text=message;
  }

  // What can be said while a menu is open: each option on show, by its label (and any spoken names), and Back or
  // Close. Pressing it does exactly what tapping it would. With `everywhere`, any option in this stage's menus too
  // ("Blue", "Background"): the menu moves to where that option lives, then presses it. Folders are not searched.
  function voiceOptions(everywhere=false) {
    const options=[],press=fn=>()=>{fn();radial.signature='';};
    if(everywhere) {
      if(!radial.mesh.visible)return options;
      const seen=new Set();
      const walk=(key,path)=>{if(seen.has(key))return;seen.add(key);
        for(const item of itemsOf(key)) {
          if(!item.local)options.push({label:item.label,aliases:item.aliases||[],press:press(()=>{stack=[...path];menu=stack.at(-1);item.press();})});
          if(item.open&&!item.open.startsWith('files:'))walk(item.open,[...path,item.open]);   // a ring's More pages too
        }};
      walk(top(),[top()]);
      return options;
    }
    if(radial.mesh.visible&&menu) {
      for(const item of itemsOf(menu))options.push({label:item.label,aliases:item.aliases||[],press:press(item.press)});
      options.push(stack.length<2?{label:'Close',aliases:['close menu','close the menu'],press:closeMenu}:{label:'Back',aliases:['go back'],press:press(back)});
    }
    return options;
  }

  return {update,pointer,laser,close,say,voiceOptions,openNamed,viewPart,showStats,unselect,paint,
    openMenu:()=>{if(!radial.mesh.visible)openMenu();},
    // Any menu up: the model is not gripped meanwhile.
    get busy(){return radial.mesh.visible;},
    get state(){
      const regions=s=>s.mesh.visible?s.regions.map(({id})=>id):[];
      return {caption:caption.mesh.visible?caption.text:null,face:face.mesh.visible?face.mesh.position.toArray():null,
        button:wrist.mesh.visible?wrist.mesh.position.toArray():null,buttonLabel:wrist.signature?JSON.parse(wrist.signature)[0]:null,
        menu:radial.mesh.visible?menu:null,path:radial.mesh.visible?[...stack]:[],
        card:card.mesh.visible&&current()?{part:current().id,stats:statsShown?statLines(current()).map(([label])=>label):null,position:card.mesh.position.toArray()}:null,
        regions:{watch:regions(face),radial:regions(radial),wrist:regions(wrist),card:regions(card)}};
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
