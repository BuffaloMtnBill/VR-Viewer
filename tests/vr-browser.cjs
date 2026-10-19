/* Real WebXR on an emulated Meta Quest 3 (IWER), with controllers and with tracked hands: gripping and scaling the
 * model, the watch's pie menu in both modes (tapped with a fingertip, or a controller's dot), the keyboard, marking the
 * model with the laser, the right wrist's Annotate and Submit button, Exit's confirmation, and the desktop following.
 * Run with `npm test -- vr`, or against a running server with EDITOR_VR_URL.
 */
const {chromium}=require(process.env.EDITOR_VR_PLAYWRIGHT||'playwright-core');
const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const url=process.env.EDITOR_VR_URL||'http://127.0.0.1:8021';
const iwer=process.env.EDITOR_VR_IWER||require.resolve('iwer/build/iwer.min.js');
const output=path.resolve(__dirname,'../test-results');

(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.EDITOR_VR_CHROMIUM||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 await fs.mkdir(output,{recursive:true});
 const desktop=await browser.newPage({viewport:{width:1450,height:1000}}),errors=[];desktop.on('pageerror',e=>errors.push(e.message));await desktop.goto(url+'/?full');await desktop.waitForFunction(()=>editor?.ready);
 for(const input of (process.env.EDITOR_VR_INPUTS||'controller,hand').split(',')){
  const page=await browser.newPage({viewport:{width:1400,height:1000}});page.on('pageerror',e=>errors.push(input+': '+e.message));
  await page.addInitScript({content:`${await fs.readFile(iwer,'utf8')}\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3);window.xrDevice.installRuntime({forceInstall:true});window.xrDevice.primaryInputMode='${input}';`});
  await page.goto(url);await page.waitForFunction(()=>window.editor?.ready);
  // IWER's Quest user agent gets the headset's simple page.
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('headset-page')),true,'The headset gets the simple page');
  assert.equal(await page.locator('.tool-rail').isVisible(),false,'without the desktop rails');
  await page.evaluate(async()=>{await editor.link.command('/api/demo',{});await editor.link.settings({mode:'inspect',description:'',tool:'spray',color:'#ffb86b',category:'size',brush_radius_mm:6});});
  await page.waitForFunction(()=>editor.viewer.meshes.size===2&&editor.viewer.stage==='scene');
  await page.locator('#enter-vr').click();await page.waitForFunction(()=>editor.vr.presenting);await page.waitForTimeout(350);
  const state=()=>page.evaluate(()=>editor.vr.state),frames=(n=1)=>page.waitForTimeout(90*n);
  const source=(side)=>input==='hand'?`xrDevice.hands.${side}`:`xrDevice.controllers.${side}`;
  const place=async(side,position,quaternion=[0,0,0,1])=>{await page.evaluate(({side,position,quaternion,input})=>{const s=input==='hand'?xrDevice.hands[side]:xrDevice.controllers[side];s.position.set(...position);s.quaternion.set(...quaternion);},{side,position,quaternion,input});await frames(2);};
  const press=async(side,value)=>{await page.evaluate(({side,value,input})=>{if(input==='hand')xrDevice.hands[side].updatePinchValue(value);else xrDevice.controllers[side].updateButtonValue('trigger',value);},{side,value,input});await frames(2);};
  const rest={left:[-.15,1.2,-.3],right:[.3,1.1,-.1]};
  const atRest=async()=>{await place('left',rest.left);await place('right',rest.right);await frames(3);};
  await atRest();
  if(input==='hand')await page.waitForFunction(()=>editor.vr.state.hands.filter(h=>h.tracked&&h.model).length===2,null,{timeout:15000});

  // A fingertip tap (a controller's dot, or the index fingertip) on a region of the watch, pie, keyboard, or wrist
  // button: from 8 cm in front, onto it until VR has seen the touch, and away again.
  async function tap(id,side='right'){
   const point=await page.evaluate(id=>editor.vr.regionPoint(id),id);
   assert.ok(point,`${id} is on show: ${JSON.stringify((await state()).watch.regions)}`);
   const index=(await state()).hands.findIndex(h=>h.side===side),presses=(await state()).hands[index].presses;
   let offset=[0,0,.06];   // a controller's dot is 6 cm in front of it
   if(input==='hand'){const s=await state(),tip=s.hands[index].indexTip,at=await page.evaluate(side=>{const p=xrDevice.hands[side].position;return [p.x,p.y,p.z];},side);offset=at.map((v,i)=>v-tip[i]);}
   const at=point.map((v,i)=>v+offset[i]);
   await place(side,[at[0],at[1],at[2]+.08]);
   await place(side,at);
   await page.waitForFunction(([i,n])=>editor.vr.state.hands[i].presses>n,[index,presses],{timeout:3000}).catch(async()=>{throw new Error(`${id} was not pressed: ${JSON.stringify({point,at,state:await state()})}`);});
   await place(side,[at[0],at[1],at[2]+.1]);await place(side,rest[side]);await frames(2);
  }

  // The scene comes first. Point the laser at the vessel and pinch (pull the trigger): it is selected.
  const aimAt=async(side,name,from=[0,0,.35])=>page.evaluate(async({side,name,from,input})=>{const THREE=await import('three'),v=editor.viewer,item=editor.link.state.scene.objects.find(o=>o.name===name);
    const mesh=[...v.meshes.values()].find(m=>m.userData.objectId===item.id);mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;
    const target=mesh.localToWorld(new THREE.Vector3((b.min.x+b.max.x)/2,b.min.y,(b.min.z+b.max.z)/2+(b.max.z-b.min.z)*.25));
    const s=input==='hand'?xrDevice.hands[side]:xrDevice.controllers[side];s.position.set(target.x+from[0],target.y+from[1],target.z+from[2]);s.quaternion.set(0,0,0,1);},{side,name,from,input});
  let s=await state();
  assert.equal(s.stage,'scene');assert.equal(s.selected,null);
  await aimAt('right','Fluted vessel');await frames(3);
  s=await state();assert.ok(s.lasers.some(l=>l.side==='right'&&l.shown&&l.onModel),`The scene's laser lands on a part: ${JSON.stringify(s.lasers)}`);
  const vessel=await page.evaluate(()=>editor.link.state.scene.objects.find(o=>o.name==='Fluted vessel').id);
  await press('right',1);await press('right',0);
  await page.waitForFunction(id=>editor.link.state.selected===id,vessel);
  await desktop.waitForFunction(id=>editor.link.state.selected===id,vessel);
  await page.waitForFunction(()=>/Fluted vessel/.test(editor.vr.state.watch.caption||''));
  // Pinching away from the parts (the laser pointing up) grips the whole scene; two hands scale and turn it.
  const up=[Math.sin(Math.PI/4),0,0,Math.cos(Math.PI/4)];   // pointing up: the laser misses the scene
  const before=(await state()).transform.position;
  await place('right',[.22,1.25,-.35],up);await press('right',1);assert.equal((await state()).hands.find(h=>h.side==='right').mode,'grab');
  await place('right',[.32,1.25,-.35],up);assert.ok(Math.abs((await state()).transform.position[0]-before[0])>.06,'One hand moves the scene');await press('right',0);
  await place('left',[-.13,1.25,-.35],up);await place('right',[.13,1.25,-.35],up);
  await press('left',1);await press('right',1);const small=(await state()).transform.scale;
  await place('left',[-.23,1.25,-.35],up);await place('right',[.23,1.25,-.35],up);assert.ok((await state()).transform.scale>small*1.4,'Two hands scale the scene');
  const turnedFrom=(await state()).transform.quaternion;
  await place('left',[0,1.25,-.12],up);await place('right',[0,1.25,-.58],up);
  assert.ok(Math.abs((await state()).transform.quaternion.reduce((sum,q,i)=>sum+q*turnedFrom[i],0))<.9,'Turning the hand pair turns the scene');
  await press('left',0);await press('right',0);await page.evaluate(()=>editor.fit());await atRest();
  assert.equal((await state()).selected,vessel,'Gripping the scene keeps the selection');

  // The watch on the left wrist opens the scene's pie: Parts, Add part, Edit part, Reset view, Settings.
  assert.ok((await state()).watch.face,'The watch is on the left wrist');
  await tap('watch:face');
  s=await state();assert.equal(s.watch.menu,'scene');
  assert.deepEqual(s.watch.regions.radial,['radial:scene:parts','radial:scene:add','radial:scene:edit','radial:scene:color','radial:scene:reset','radial:scene:settings','radial:center'],'Part color appears with a part selected');
  await tap('radial:scene:add');assert.deepEqual((await state()).watch.regions.radial,['radial:add:0:upload','radial:center'],'Without a project, Add points to the computer');
  await tap('radial:center');
  // Part color ▸ paints the selected part, on every device; Gray puts it back.
  await tap('radial:scene:color');
  assert.deepEqual((await state()).watch.regions.radial,['radial:part-color:gray','radial:part-color:red','radial:part-color:orange','radial:part-color:yellow','radial:part-color:green','radial:part-color:blue','radial:center']);
  await tap('radial:part-color:blue');
  await desktop.waitForFunction(id=>editor.link.state.scene.objects.find(o=>o.id===id).color==='#3a7bd5',vessel);
  await page.waitForFunction(id=>{const m=[...editor.viewer.meshes.values()].find(m=>m.userData.objectId===id),c=m.geometry.attributes.color.array;return c[2]>c[0]*2;},vessel);
  assert.equal((await state()).watch.menu,'scene','Choosing a color goes back to the scene ring');
  await tap('radial:scene:color');await tap('radial:part-color:gray');
  await desktop.waitForFunction(id=>!('color' in editor.link.state.scene.objects.find(o=>o.id===id)),vessel);
  // Settings ▸ Background: the room around the scene.
  await tap('radial:scene:settings');await tap('radial:settings:background');await tap('radial:background:lake');
  await page.waitForFunction(()=>editor.vr.state.backgroundShown==='lake.jpg');
  await page.waitForTimeout(400);await page.screenshot({path:path.join(output,`vr-${input}-lake.png`)});
  // The living desert: the light follows the sun by day and the moon by night, and the sky can be paused.
  await tap('radial:background:desert-day');
  s=await state();assert.equal(s.backgroundShown,'desert-day');assert.ok(s.environment.running,'The day runs');
  const at=async phase=>{await page.evaluate(p=>editor.vr.environments.setPhase(p),phase);await page.waitForTimeout(400);return (await state()).environment;};
  let sky=await at(.25);
  assert.equal(sky.light.direction[1]>.8&&sky.source,'sun','At noon the sun is high, and it gives the light');assert.ok(sky.light.intensity>3);
  await page.screenshot({path:path.join(output,`vr-${input}-desert-noon.png`)});
  sky=await at(.47);assert.equal(sky.source,'sun');assert.ok(sky.light.direction[0]<-.5&&sky.light.intensity<3,'Low in the west, the sun dims');
  await page.screenshot({path:path.join(output,`vr-${input}-desert-sunset.png`)});
  sky=await at(.75);
  assert.equal(sky.source,'moon');assert.ok(sky.light.direction[1]>.7&&sky.light.intensity>.8&&sky.light.intensity<1.5,'At midnight the moon gives a fainter light');
  assert.deepEqual(sky.light.direction,sky.moon);
  await page.screenshot({path:path.join(output,`vr-${input}-desert-night.png`)});
  await tap('radial:background:time');s=await state();assert.equal(s.environment.running,false,'Pause sky');
  const paused=s.environment.phase;await page.waitForTimeout(500);assert.equal((await state()).environment.phase,paused);
  await tap('radial:background:time');assert.ok((await state()).environment.running,'Run sky');
  await page.waitForFunction(p=>editor.vr.state.environment.phase>p,paused);
  assert.ok(await page.evaluate(()=>editor.viewer.scene.getObjectByName('desert-day')),'The desert stands around the scene');
  await tap('radial:background:studio');assert.equal((await state()).backgroundShown,'studio');
  assert.equal(await page.evaluate(()=>editor.viewer.scene.getObjectByName('desert-day')),undefined,'Leaving the desert removes it');
  assert.ok(await page.evaluate(()=>editor.viewer.scene.children.filter(c=>c.isLight).every(l=>l.intensity>0)),'The studio lights come back');
  await tap('radial:center');await tap('radial:center');assert.equal((await state()).watch.menu,'scene','Back one ring at a time');
  await tap('radial:center');assert.equal((await state()).watch.menu,null,'Close');

  // The right wrist's Edit ▸ shows the selected part alone, in Inspect.
  assert.equal((await state()).watch.buttonLabel,'Edit ▸');
  await tap('wrist:button','left');
  await page.waitForFunction(id=>editor.link.state.stage==='object'&&editor.link.state.model.object_id===id&&editor.viewer.stage==='object',vessel);
  assert.equal(await page.evaluate(()=>[...editor.viewer.meshes.values()].filter(m=>m.visible).length),1,'The part alone');
  assert.equal((await state()).lasers.some(l=>l.shown),false,'No laser in Inspect');
  // Inspect: one hand grips and turns the part.
  const partFrom=(await state()).transform.position;
  await place('right',[.22,1.25,-.35]);await press('right',1);await place('right',[.32,1.25,-.35]);
  assert.ok(Math.abs((await state()).transform.position[0]-partFrom[0])>.06,'One hand moves the part');await press('right',0);await atRest();
  await tap('watch:face');
  s=await state();assert.equal(s.watch.menu,'inspect');
  assert.deepEqual(s.watch.regions.radial,['radial:inspect:scene','radial:inspect:reset','radial:inspect:annotate','radial:inspect:settings','radial:center']);
  await tap('radial:center');

  // The right wrist's button: Annotate ▸, tapped with the other hand.
  assert.equal((await state()).watch.buttonLabel,'Annotate ▸');
  await tap('wrist:button','left');
  await page.waitForFunction(()=>editor.link.state.settings.mode==='edit');
  await page.waitForFunction(()=>editor.vr.state.watch.buttonLabel==='Submit · 0');
  await desktop.waitForFunction(()=>document.getElementById('view-badge').textContent!=='INSPECT MODE');

  // Annotate's pie: Tools ▸ a tool closes it; Mark style ▸ Color and Category return to Mark style; Brush steps.
  await tap('watch:face');
  s=await state();assert.equal(s.watch.menu,'annotate');
  assert.deepEqual(s.watch.regions.radial,['radial:annotate:tools','radial:annotate:style','radial:annotate:note','radial:annotate:undo','radial:annotate:submit','radial:annotate:scene','radial:annotate:settings','radial:center']);
  await tap('radial:annotate:tools');await tap('radial:tools:pin');
  await page.waitForFunction(()=>editor.link.state.settings.tool==='pin');assert.equal((await state()).watch.menu,null,'Choosing a tool closes the menu');
  await tap('watch:face');await tap('radial:annotate:style');await tap('radial:style:color');await tap('radial:color:2');
  await page.waitForFunction(()=>editor.link.state.settings.color==='#ad9bff');assert.equal((await state()).watch.menu,'style');
  await tap('radial:style:category');await tap('radial:category:general');await page.waitForFunction(()=>editor.link.state.settings.category==='general');
  await tap('radial:style:brush');assert.deepEqual((await state()).watch.path,['annotate','style','brush']);
  await tap('radial:brush:+');await page.waitForFunction(()=>editor.link.state.settings.brush_radius_mm===6.5);
  await page.waitForTimeout(300);await page.screenshot({path:path.join(output,`vr-${input}-pie.png`)});
  await tap('radial:center');await tap('radial:center');assert.equal((await state()).watch.menu,'annotate');
  // Note: the keyboard; Done saves the note to the shared workspace (the computer's page shows it).
  await tap('radial:annotate:note');
  s=await state();assert.equal(s.watch.keyboard,'description');assert.equal(s.watch.menu,null);
  for(const key of 'smooth')await tap('key:'+key);
  assert.equal((await state()).watch.text,'smooth');
  await page.waitForTimeout(200);await page.screenshot({path:path.join(output,`vr-${input}-keyboard.png`)});
  await tap('key:done');
  await desktop.waitForFunction(()=>document.getElementById('description').value==='smooth');
  assert.equal((await state()).watch.keyboard,null,'Done puts the keyboard away');

  // Marking: the laser shows in Annotate; point it at the part's front and pinch (the trigger) to pin a note.
  await aimAt('right','Fluted vessel');await frames(3);
  s=await state();assert.ok(s.lasers.some(l=>l.side==='right'&&l.shown&&l.onModel),`The laser lands on the model: ${JSON.stringify(s.lasers)}`);
  await press('right',1);await press('right',0);
  await page.waitForFunction(()=>editor.link.state.annotations.length===1);
  const mark=await page.evaluate(()=>editor.link.state.annotations[0]);
  assert.equal(mark.tool,'pin');assert.equal(mark.color,'#ad9bff');assert.equal(mark.category,'general');
  if(input==='controller') {
    // In Annotate the grip button still moves the model (with hands, a fist does).
    const from=(await state()).transform.position;
    await page.evaluate(()=>xrDevice.controllers.right.updateButtonValue('squeeze',1));await frames(2);
    assert.equal((await state()).hands.find(h=>h.side==='right').mode,'grab');
    await place('right',[.3,1.2,-.3]);assert.ok(Math.abs((await state()).transform.position[0]-from[0])>.05,'The grip button moves the model in Annotate');
    await page.evaluate(()=>xrDevice.controllers.right.updateButtonValue('squeeze',0));await frames(2);
    await page.evaluate(()=>editor.fit());
  }
  await atRest();

  // Submit, on the right wrist: the request reaches the computer.
  await page.waitForFunction(()=>editor.vr.state.watch.buttonLabel==='Submit · 1');
  const requestsBefore=await page.evaluate(()=>editor.link.state.requests.length);
  await tap('wrist:button','left');
  await page.waitForFunction(count=>editor.link.state.requests.length===count+1,requestsBefore);
  await desktop.waitForFunction(count=>editor.link.state.requests.length===count+1,requestsBefore);
  const request=await page.evaluate(()=>editor.link.state.requests[0]);
  assert.equal(request.description,'smooth');assert.equal((await desktop.request.get(url+request.packet_url)).status(),200);
  await page.waitForFunction(()=>/Sent 1 mark/.test(editor.vr.state.watch.caption||''));

  if(input==='hand') {
    const sizes=await page.evaluate(async()=>{const THREE=await import('three');return editor.vr.hands.map(hand=>{const skin=hand.xrHand.getObjectByProperty('type','SkinnedMesh');skin.computeBoundingBox();return {size:skin.boundingBox.getSize(new THREE.Vector3()).length(),dots:Object.values(hand.xrHand.joints).filter(j=>j.userData.dot?.visible).length};});});
    for(const hand of sizes){assert.ok(hand.size<.6,'Tracked hand mesh stays hand-sized');assert.equal(hand.dots,0,'Joint dots hide once the hand model is ready');}
  }

  // ◀ Scene: every part again; Parts ▸ selects another (and returns to the scene's ring).
  await tap('watch:face');await tap('radial:annotate:scene');
  await page.waitForFunction(()=>editor.link.state.stage==='scene'&&editor.viewer.stage==='scene');
  assert.equal(await page.evaluate(()=>[...editor.viewer.meshes.values()].filter(m=>m.visible).length),2);
  const stand=await page.evaluate(()=>editor.link.state.scene.objects.find(o=>o.name==='Stand').id);
  await page.waitForFunction(()=>editor.vr.state.watch.menu==='scene');
  await tap('radial:scene:parts');await tap(`radial:parts:0:${stand}`);
  await page.waitForFunction(id=>editor.link.state.selected===id,stand);assert.equal((await state()).watch.menu,'scene');
  await tap('radial:center');
  // Exit VR asks first: Settings ▸ Exit VR ▸ Stay goes back; Yes, exit leaves.
  await tap('watch:face');await tap('radial:scene:settings');await tap('radial:settings:exit');
  assert.equal((await state()).watch.menu,'exit');
  await tap('radial:exit:stay');assert.equal((await state()).watch.menu,'settings');assert.equal(await page.evaluate(()=>editor.vr.presenting),true);
  await tap('radial:settings:exit');await tap('radial:exit:confirm');
  await page.waitForFunction(()=>!editor.vr.presenting);
  assert.equal(await page.evaluate(()=>editor.vr.state.backgroundShown),'studio','Leaving VR puts the studio back');
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('Quest controller and tracked-hand scene selection by laser, gripping and scaling, Edit part, the watch pie in the scene, Inspect and Annotate, backgrounds, keyboard, laser marking, wrist Annotate and Submit, Exit confirmation, and desktop following passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
