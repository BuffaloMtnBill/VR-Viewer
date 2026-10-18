import * as THREE from 'three';
import {TOOL_NAMES} from './tools.js';
const C={paper:'#17212b',surface:'#243441',line:'#415361',ink:'#ecf1f6',muted:'#a5b6c5',accent:'#ffb86b',mint:'#6be0d4'};
export const COLORS=['#ffb86b','#6be0d4','#ad9bff','#ff7895','#72b9ff'];
const MEANINGS=['Add or enlarge','Smooth or blend','Surface detail','Remove or reduce','Review this area'],CATEGORIES=['size','texture','pattern','general'];
const DEFAULTS={tool:'spray',mode:'inspect',color:COLORS[0],category:'size',brush_radius_mm:6,description:'',meaning:'Add or enlarge'},PIE={outer:500,inner:175};
const title=word=>word[0].toUpperCase()+word.slice(1);
export class CanvasPanel{
  constructor(width,height,pixelsX,pixelsY,round=false){this.round=round;this.canvas=document.createElement('canvas');this.canvas.width=pixelsX;this.canvas.height=pixelsY;this.ctx=this.canvas.getContext('2d');this.texture=new THREE.CanvasTexture(this.canvas);this.texture.colorSpace=THREE.SRGBColorSpace;this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:this.texture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));this.mesh.renderOrder=100;this.regions=[];this.width=width;this.height=height;}
  clear(transparent=false){this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);if(!transparent){this.ctx.fillStyle=C.paper;this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);}this.regions=[];}
  text(value,x,y,size=30,color=C.ink){this.ctx.font=`${size}px sans-serif`;this.ctx.fillStyle=color;this.ctx.fillText(value,x,y);}
  button(id,label,x,y,w,h,action,selected=false,color=null){this.ctx.fillStyle=color|| (selected?'#6b5034':C.surface);this.ctx.fillRect(x,y,w,h);this.ctx.strokeStyle=selected?C.accent:C.line;this.ctx.lineWidth=2;this.ctx.strokeRect(x,y,w,h);if(label)this.text(label,x+15,y+h/2+10,Math.min(30,h*.45));this.regions.push({id,x,y,w,h,action});}
  finish(){this.texture.needsUpdate=true;}
  hit(ray){if(!this.mesh.visible)return null;this.mesh.updateMatrixWorld(true);const hit=ray.intersectObject(this.mesh,false)[0];if(!hit)return null;const x=hit.uv.x*this.canvas.width,y=(1-hit.uv.y)*this.canvas.height;if(this.round&&Math.hypot(x-this.canvas.width/2,y-this.canvas.height/2)>this.canvas.width/2)return null;return {...hit,panel:this,region:this.regions.find(r=>r.contains?r.contains(x,y):x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h)||null};}
}
export class WristUI{
  constructor(scene,ctx){this.ctx=ctx;this.watch=new CanvasPanel(.23,.16,690,480);this.panel=new CanvasPanel(.64,.875,1024,1400);this.panel.mesh.visible=false;this.radial=new CanvasPanel(.5,.5,1024,1024,true);this.radial.mesh.visible=false;this.radial.mesh.renderOrder=110;scene.add(this.watch.mesh,this.panel.mesh,this.radial.mesh);this.menu=[];this.hovered=new Set();this.hoverKey='';this.page='tools';this.field='description';this.shift=false;this.message='Point and pinch';this.state=null;this.draw();}
  updateState(state){this.state=state;this.draw();}
  notify(message){this.message=message;this.draw();}
  set(changes){this.ctx.settings(changes);}
  get settings(){return this.state?.settings||DEFAULTS;}
  place(mesh,distance,drop){const camera=this.ctx.camera(),position=camera.getWorldPosition(new THREE.Vector3()),forward=new THREE.Vector3(0,0,-1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));forward.y=0;if(forward.lengthSq()<1e-6)forward.set(0,0,-1);forward.normalize();mesh.position.copy(position).addScaledVector(forward,distance);mesh.position.y=position.y-drop;mesh.lookAt(position);}
  open(page='tools'){this.closeMenu();this.page=page;this.panel.mesh.visible=true;this.place(this.panel.mesh,.76,.12);this.draw();}
  close(){this.panel.mesh.visible=false;this.closeMenu();}
  // The pie menu: fixed in front of you, a little below eye level. Back returns to the menu it was opened from.
  openMenu(){this.panel.mesh.visible=false;this.menu=['root'];this.radial.mesh.visible=true;this.place(this.radial.mesh,.62,.14);this.draw();}
  closeMenu(){if(!this.radial.mesh.visible)return;this.radial.mesh.visible=false;this.menu=[];this.draw();}
  go(key){this.menu.push(key);this.drawRadial();}
  back(){this.menu.pop();if(!this.menu.length)this.closeMenu();else this.drawRadial();}
  hover(ids){const key=ids.filter(Boolean).sort().join();if(key===this.hoverKey)return;this.hoverKey=key;this.hovered=new Set(ids);this.drawRadial();}
  async submit(){if(!this.state?.annotations.length){this.notify('Mark a model area first.');return;}if(!this.state.settings.description.trim()){this.field='description';this.open('instruction');this.notify('Type the requested change.');return;}try{await this.ctx.submit();this.notify('Sent to the desktop edit queue.');this.close();}catch(error){this.notify(error.message);}}
  draw(){
    const state=this.state,s=this.settings;
    const watch=this.watch;watch.clear();watch.text('EDITOR / VR',28,53,28,C.accent);watch.text(s.mode==='inspect'?'Inspect model':TOOL_NAMES[s.tool],28,110,36);watch.text(`${state?.annotations.length||0} marks  ·  ${state?.requests.length||0} requests`,28,157,25,C.muted);
    watch.button('watch-menu',this.radial.mesh.visible?'Close menu':'Menu  ◔',26,190,308,77,()=>this.radial.mesh.visible?this.closeMenu():this.openMenu(),this.radial.mesh.visible);watch.button('watch-submit','Submit  ↗',350,190,308,77,()=>this.submit(),true);
    watch.button('watch-mode',s.mode==='inspect'?'Switch to Annotate':'Switch to Inspect',26,283,632,68,()=>this.set({mode:s.mode==='inspect'?'edit':'inspect'}));watch.text(this.message.slice(0,43),28,410,22,C.muted);watch.finish();
    const p=this.panel;p.clear();p.text('EDITOR / VR',38,66,32,C.accent);p.button('close','Close ×',810,25,177,64,()=>this.close());
    p.button('tab-tools','Tools',38,112,455,68,()=>{this.page='tools';this.draw();},this.page==='tools');p.button('tab-instruction','Instruction',513,112,474,68,()=>{this.page='instruction';this.field='description';this.draw();},this.page==='instruction');
    if(this.page==='tools'){
      p.button('inspect','Inspect',38,212,455,67,()=>this.set({mode:'inspect'}),s.mode==='inspect');p.button('edit','Annotate',513,212,474,67,()=>this.set({mode:'edit'}),s.mode==='edit');
      const names=Object.entries(TOOL_NAMES);names.forEach(([key,label],i)=>{const col=i%2,row=Math.floor(i/2);p.button('tool-'+key,label,38+col*485,310+row*83,464,67,()=>this.set({tool:key,mode:'edit'}),s.tool===key);});
      p.text('MARK COLOR',38,600,25,C.muted);COLORS.forEach((color,i)=>p.button('color-'+i,'',38+i*190,620,168,65,()=>this.set({color,meaning:MEANINGS[i]}),s.color===color,color));
      p.text('COLOR MEANS',38,734,25,C.muted);p.button('meaning',s.meaning.slice(0,42)||'Set color meaning',38,755,949,67,()=>{this.field='meaning';this.page='instruction';this.draw();});
      p.text('EDIT CATEGORY',38,870,25,C.muted);CATEGORIES.forEach((category,i)=>p.button('category-'+category,title(category),38+(i%2)*485,892+Math.floor(i/2)*80,464,65,()=>this.set({category}),s.category===category));
      p.button('radius-minus','−',38,1083,100,64,()=>this.set({brush_radius_mm:Math.max(.5,s.brush_radius_mm-.5)}));p.text(`Brush radius: ${s.brush_radius_mm} mm`,175,1124,30);p.button('radius-plus','+',887,1083,100,64,()=>this.set({brush_radius_mm:Math.min(100,s.brush_radius_mm+.5)}));
      p.button('undo','Undo mark',38,1180,295,66,()=>this.ctx.undo());p.button('reset','Reset view',357,1180,295,66,()=>this.ctx.fit());p.button('note','Add note →',677,1180,310,66,()=>{this.field='description';this.page='instruction';this.draw();});
      p.text('Close this panel, then point at the model and pinch.',38,1310,27,C.muted);
    }else{
      p.text(this.field==='meaning'?'What does this color mean?':'Describe the requested change',38,231,30,C.muted);
      const value=s[this.field]||'',lines=this.wrap(value||'Point at keys and pinch to type…',59);lines.slice(-4).forEach((line,i)=>p.text(line,38,285+i*42,30,value?C.ink:C.muted));
      p.text(`${value.length}/${this.field==='meaning'?80:2000} characters`,38,476,24,C.muted);
      const rows=['1234567890','qwertyuiop','asdfghjkl','zxcvbnm'];rows.forEach((letters,row)=>{const w=83,gap=9,x=(1024-(letters.length*(w+gap)-gap))/2;[...letters].forEach((letter,col)=>p.button('key-'+letter,this.shift?letter.toUpperCase():letter,x+col*(w+gap),520+row*91,w,74,()=>this.type(this.shift?letter.toUpperCase():letter)));});
      p.button('shift',this.shift?'ABC':'abc',38,900,145,74,()=>{this.shift=!this.shift;this.draw();});p.button('space','Space',201,900,425,74,()=>this.type(' '));p.button('backspace','Backspace',645,900,342,74,()=>this.type(null));
      ['.',',','-','+','?','/'].forEach((key,i)=>p.button('key-symbol-'+i,key,38+i*161,994,143,65,()=>this.type(key)));
      p.button('done','Back to tools',38,1110,455,73,()=>{this.page='tools';this.draw();});p.button('submit','Submit edit  ↗',513,1110,474,73,()=>this.submit(),true);
      p.text(`${state?.annotations.length||0} marks will travel with your instruction.`,38,1256,28,C.muted);
      p.text('The geometry editing step runs on the computer later.',38,1310,26,C.muted);
    }
    p.finish();this.drawRadial();
  }
  // The menus, read from the shared settings: each item is a slice; ▸ items open the next ring.
  menus(s){const count=this.state?.annotations.length||0,tool=s.mode==='inspect'?'Move model':TOOL_NAMES[s.tool];
    const pick=(changes,then)=>()=>{this.set(changes);then();};
    return {
      root:{title:'Editor',value:tool,items:[
        {key:'tools',label:'Tools ▸',detail:tool,action:()=>this.go('tools')},
        {key:'style',label:'Mark style ▸',detail:`${title(s.category)} · ${s.brush_radius_mm} mm`,swatch:s.color,action:()=>this.go('style')},
        {key:'note',label:'Note',detail:s.description.trim()?'Written':'Empty',action:()=>{this.field='description';this.open('instruction');}},
        {key:'undo',label:'Undo mark',detail:`${count} marks`,action:()=>this.ctx.undo()},
        {key:'reset',label:'Reset view',action:()=>this.ctx.fit()},
        {key:'submit',label:'Submit  ↗',detail:'to the desktop',primary:true,action:()=>this.submit()}]},
      // Choosing a tool closes the menu, so the next pinch on the model uses it.
      tools:{title:'Tools',value:tool,items:[{key:'inspect',label:'Move model',active:s.mode==='inspect',action:pick({mode:'inspect'},()=>this.closeMenu())},
        ...Object.entries(TOOL_NAMES).map(([key,label])=>({key,label,active:s.mode==='edit'&&s.tool===key,action:pick({tool:key,mode:'edit'},()=>this.closeMenu())}))]},
      style:{title:'Mark style',items:[
        {key:'color',label:'Color ▸',detail:s.meaning,swatch:s.color,action:()=>this.go('color')},
        {key:'category',label:'Category ▸',detail:title(s.category),action:()=>this.go('category')},
        {key:'brush',label:'Brush ▸',detail:`${s.brush_radius_mm} mm`,action:()=>this.go('brush')},
        {key:'meaning',label:'Meaning',detail:'Type it',action:()=>{this.field='meaning';this.open('instruction');}}]},
      color:{title:'Mark color',items:COLORS.map((color,i)=>({key:String(i),label:MEANINGS[i],fill:color,active:s.color===color,action:pick({color,meaning:MEANINGS[i]},()=>this.back())}))},
      category:{title:'Edit category',value:title(s.category),items:CATEGORIES.map(category=>({key:category,label:title(category),active:s.category===category,action:pick({category},()=>this.back())}))},
      brush:{title:'Brush radius',value:`${s.brush_radius_mm} mm`,items:[['−−',-5],['−',-.5],['+',.5],['++',5]].map(([label,step])=>({key:label,label,
        action:()=>this.set({brush_radius_mm:Math.min(100,Math.max(.5,Math.round((s.brush_radius_mm+step)*2)/2))})}))},
    };
  }
  drawRadial(){
    const r=this.radial;if(!r.mesh.visible||!this.menu.length)return;
    const key=this.menu.at(-1),spec=this.menus(this.settings)[key],items=spec.items,c=r.ctx,S=r.canvas.width,M=S/2,{outer,inner}=PIE,slice=Math.PI*2/items.length;
    r.clear(true);
    items.forEach((item,i)=>{
      const start=-Math.PI/2+i*slice-slice/2,end=start+slice,mid=(start+end)/2,radius=(outer+inner)/2,id=`radial-${key}-${item.key}`,x=M+Math.cos(mid)*radius,y=M+Math.sin(mid)*radius;
      c.beginPath();c.arc(M,M,outer,start,end);c.arc(M,M,inner,end,start,true);c.closePath();
      c.fillStyle=item.fill||(item.active?'#6b5034':this.hovered.has(id)?'#34495a':item.primary?'#2d5550':'#17212bf2');c.fill();
      if(item.fill&&this.hovered.has(id)){c.fillStyle='#ffffff38';c.fill();}
      c.lineWidth=item.active?10:4;c.strokeStyle=item.active?C.accent:C.line;c.stroke();
      const dark=Boolean(item.fill),words=this.wrapWords(c,item.label,'600 44px sans-serif',Math.min(260,2*radius*Math.sin(slice/2)*.85));
      c.textAlign='center';c.textBaseline='middle';c.font='600 44px sans-serif';c.fillStyle=dark?C.paper:C.ink;
      const top=y-(words.length-1)*24-(item.detail?18:0);words.forEach((line,k)=>c.fillText(line,x,top+k*48));
      if(item.detail){c.font='26px sans-serif';c.fillStyle=dark?C.paper:C.muted;c.fillText(item.detail.slice(0,22),x+(item.swatch?14:0),top+words.length*48-6);
        if(item.swatch){const w=c.measureText(item.detail.slice(0,22)).width;c.beginPath();c.arc(x-w/2-6,top+words.length*48-6,11,0,Math.PI*2);c.fillStyle=item.swatch;c.fill();}}
      r.regions.push({id,x:x-40,y:y-40,w:80,h:80,action:item.action,contains:(px,py)=>{const dx=px-M,dy=py-M,d=Math.hypot(dx,dy);if(d<inner||d>outer)return false;
        const angle=((Math.atan2(dy,dx)+Math.PI/2+slice/2)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);return Math.floor(angle/slice)===i;}});
    });
    // The middle: the menu's name and current value, and Back (or Close on the first ring).
    const hot=this.hovered.has('radial-center'),label=this.menu.length>1?'‹ Back':'Close';
    c.beginPath();c.arc(M,M,inner-12,0,Math.PI*2);c.fillStyle=hot?'#34495a':'#101820f5';c.fill();c.lineWidth=4;c.strokeStyle=C.accent;c.stroke();
    c.textAlign='center';c.textBaseline='middle';c.font='600 30px sans-serif';c.fillStyle=C.accent;c.fillText(spec.title.toUpperCase(),M,M-62);
    if(spec.value){c.font=`600 ${spec.value.length>10?30:42}px sans-serif`;c.fillStyle=C.ink;c.fillText(spec.value,M,M);}
    c.font='600 32px sans-serif';c.fillStyle=C.muted;c.fillText(label,M,M+64);
    r.regions.push({id:'radial-center',x:M-60,y:M+30,w:120,h:60,action:()=>this.back(),contains:(px,py)=>Math.hypot(px-M,py-M)<inner-12});
    r.finish();
  }
  wrapWords(c,text,font,width){c.font=font;const lines=[];let line='';for(const word of text.split(' ')){const next=line?line+' '+word:word;if(line&&c.measureText(next).width>width){lines.push(line);line=word;}else line=next;}lines.push(line);return lines.slice(0,2);}
  wrap(text,count){const lines=[];for(let i=0;i<text.length;i+=count)lines.push(text.slice(i,i+count));return lines;}
  type(key){const old=this.state.settings[this.field],limit=this.field==='meaning'?80:2000;const value=key===null?old.slice(0,-1):(old+key).slice(0,limit);this.state={...this.state,settings:{...this.state.settings,[this.field]:value}};this.set({[this.field]:value});this.draw();}
  hit(ray,side){const hits=[this.radial.hit(ray),this.panel.hit(ray),side==='left'?null:this.watch.hit(ray)].filter(Boolean);return hits.sort((a,b)=>a.distance-b.distance)[0]||null;}
  update(anchor,camera){this.watch.mesh.position.copy(anchor).add(new THREE.Vector3(-.015,.065,.025));this.watch.mesh.lookAt(camera.getWorldPosition(new THREE.Vector3()));this.watch.mesh.updateMatrixWorld(true);this.panel.mesh.updateMatrixWorld(true);this.radial.mesh.updateMatrixWorld(true);}
  get stateForTests(){const serialize=p=>({matrix:p.mesh.matrixWorld.toArray(),width:p.width,height:p.height,canvas:[p.canvas.width,p.canvas.height],regions:p.regions.map(({action,contains,...r})=>r),visible:p.mesh.visible});return {watch:serialize(this.watch),panel:serialize(this.panel),radial:serialize(this.radial),menu:this.menu.at(-1)||null,page:this.page,field:this.field};}
}
