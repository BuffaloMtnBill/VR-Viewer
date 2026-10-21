/* Real WebXR on an emulated Meta Quest 3 (IWER), with controllers and with tracked hands: selecting parts by laser,
 * gripping and scaling the model, the watch's pie menu in the scene and with one part (tapped with a fingertip, or a
 * controller's dot), Open ▸ and Add part ▸ browsing the computer's model files, the part's card and stats, the right
 * wrist's View and ◀ Scene button, backgrounds, Exit's confirmation, and the desktop following.
 * Run with `npm test -- vr`, or against a running server with VR_VIEWER_URL.
 */
const {chromium}=require(process.env.VR_VIEWER_PLAYWRIGHT||'playwright-core');
const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const url=process.env.VR_VIEWER_URL||'http://127.0.0.1:8021';
const iwer=process.env.VR_VIEWER_IWER||require.resolve('iwer/build/iwer.min.js');
const output=path.resolve(__dirname,'../test-results');

(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.VR_VIEWER_CHROMIUM||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 await fs.mkdir(output,{recursive:true});
 const desktop=await browser.newPage({viewport:{width:1450,height:1000}}),errors=[];desktop.on('pageerror',e=>errors.push(e.message));await desktop.goto(url+'/?full');await desktop.waitForFunction(()=>viewerApp?.ready);
 for(const input of (process.env.VR_VIEWER_INPUTS||'controller,hand').split(',')){
  const page=await browser.newPage({viewport:{width:1400,height:1000}});page.on('pageerror',e=>errors.push(input+': '+e.message));
  await page.addInitScript({content:`${await fs.readFile(iwer,'utf8')}\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3);window.xrDevice.installRuntime({forceInstall:true});window.xrDevice.primaryInputMode='${input}';`});
  await page.goto(url);await page.waitForFunction(()=>window.viewerApp?.ready);
  // IWER's Quest user agent gets the headset's simple page.
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('headset-page')),true,'The headset gets the simple page');
  assert.equal(await page.locator('.tool-rail').isVisible(),false,'without the desktop rails');
  await page.evaluate(()=>viewerApp.link.command('/api/demo',{}));
  await page.waitForFunction(()=>viewerApp.viewer.meshes.size===2&&viewerApp.viewer.stage==='scene');
  await page.locator('#enter-vr').click();await page.waitForFunction(()=>viewerApp.vr.presenting);await page.waitForTimeout(350);
  const state=()=>page.evaluate(()=>viewerApp.vr.state),frames=(n=1)=>page.waitForTimeout(90*n);
  const source=(side)=>input==='hand'?`xrDevice.hands.${side}`:`xrDevice.controllers.${side}`;
  const place=async(side,position,quaternion=[0,0,0,1])=>{await page.evaluate(({side,position,quaternion,input})=>{const s=input==='hand'?xrDevice.hands[side]:xrDevice.controllers[side];s.position.set(...position);s.quaternion.set(...quaternion);},{side,position,quaternion,input});await frames(2);};
  const press=async(side,value)=>{await page.evaluate(({side,value,input})=>{if(input==='hand')xrDevice.hands[side].updatePinchValue(value);else xrDevice.controllers[side].updateButtonValue('trigger',value);},{side,value,input});await frames(2);};
  const rest={left:[-.15,1.2,-.3],right:[.3,1.1,-.1]};
  const atRest=async()=>{await place('left',rest.left);await place('right',rest.right);await frames(3);};
  await atRest();
  if(input==='hand')await page.waitForFunction(()=>viewerApp.vr.state.hands.filter(h=>h.tracked&&h.model).length===2,null,{timeout:15000});

  // A fingertip tap (a controller's dot, or the index fingertip) on a region of the watch, pie, or wrist button: from
  // 8 cm in front, onto it until VR has seen the touch, and away again. (Software rendering on CI can stall for
  // seconds while a background loads, hence the generous wait.)
  async function tap(id,side='right'){
   const point=await page.evaluate(id=>viewerApp.vr.regionPoint(id),id);
   assert.ok(point,`${id} is on show: ${JSON.stringify((await state()).watch.regions)}`);
   const index=(await state()).hands.findIndex(h=>h.side===side),presses=(await state()).hands[index].presses;
   let offset=[0,0,.06];   // a controller's dot is 6 cm in front of it
   if(input==='hand'){const s=await state(),tip=s.hands[index].indexTip,at=await page.evaluate(side=>{const p=xrDevice.hands[side].position;return [p.x,p.y,p.z];},side);offset=at.map((v,i)=>v-tip[i]);}
   const at=point.map((v,i)=>v+offset[i]);
   await place(side,[at[0],at[1],at[2]+.08]);
   await place(side,at);
   await page.waitForFunction(([i,n])=>viewerApp.vr.state.hands[i].presses>n,[index,presses],{timeout:10000}).catch(async()=>{throw new Error(`${id} was not pressed: ${JSON.stringify({point,at,state:await state()})}`);});
   await place(side,[at[0],at[1],at[2]+.1]);await place(side,rest[side]);await frames(2);
  }

  // The scene comes first. Point the laser at the vessel and pinch (pull the trigger): it is selected.
  const aimAt=async(side,name,from=[0,0,.35])=>page.evaluate(async({side,name,from,input})=>{const THREE=await import('three'),v=viewerApp.viewer,item=viewerApp.link.state.scene.objects.find(o=>o.name===name);
    const mesh=[...v.meshes.values()].find(m=>m.userData.objectId===item.id);mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;
    const target=mesh.localToWorld(new THREE.Vector3((b.min.x+b.max.x)/2,b.min.y,(b.min.z+b.max.z)/2+(b.max.z-b.min.z)*.25));
    const s=input==='hand'?xrDevice.hands[side]:xrDevice.controllers[side];s.position.set(target.x+from[0],target.y+from[1],target.z+from[2]);s.quaternion.set(0,0,0,1);},{side,name,from,input});
  let s=await state();
  assert.equal(s.stage,'scene');assert.equal(s.selected,null);
  await aimAt('right','Fluted vessel');await frames(3);
  s=await state();assert.ok(s.lasers.some(l=>l.side==='right'&&l.shown&&l.onModel),`The scene's laser lands on a part: ${JSON.stringify(s.lasers)}`);
  const vessel=await page.evaluate(()=>viewerApp.link.state.scene.objects.find(o=>o.name==='Fluted vessel').id);
  await press('right',1);await press('right',0);
  await page.waitForFunction(id=>viewerApp.link.state.selected===id,vessel);
  await desktop.waitForFunction(id=>viewerApp.link.state.selected===id,vessel);
  await page.waitForFunction(()=>/Fluted vessel/.test(viewerApp.vr.state.watch.caption||''));
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
  await press('left',0);await press('right',0);await page.evaluate(()=>viewerApp.fit());await atRest();
  assert.equal((await state()).selected,vessel,'Gripping the scene keeps the selection');

  // The watch on the left wrist opens the scene's pie: Parts, Open, Add part, View part, Part, Reset view, Settings.
  assert.ok((await state()).watch.face,'The watch is on the left wrist');
  await tap('watch:face');
  s=await state();assert.equal(s.watch.menu,'scene');
  assert.deepEqual(s.watch.regions.radial,['radial:scene:parts','radial:scene:open','radial:scene:add','radial:scene:view','radial:scene:part','radial:scene:reset','radial:scene:settings','radial:center'],'Part ▸ appears with a part selected');
  // The selected part has a card floating above it: its name and View ▸.
  s=await state();assert.equal(s.watch.card?.part,vessel,'A card floats above the selected part');assert.deepEqual(s.watch.regions.card,['card:action']);
  assert.equal(s.watch.card.stats,null);
  const top=await page.evaluate(async id=>{const THREE=await import('three'),m=[...viewerApp.viewer.meshes.values()].find(m=>m.userData.objectId===id);return new THREE.Box3().setFromObject(m).max.y;},vessel);
  assert.ok(s.watch.card.position[1]>top,'above it');
  // Part ▸: View part, Stats, Color ▸, Unselect.
  await tap('radial:scene:part');
  assert.deepEqual((await state()).watch.regions.radial,['radial:part:view','radial:part:stats','radial:part:color','radial:part:unselect','radial:center']);
  await tap('radial:part:stats');
  assert.deepEqual((await state()).watch.card.stats,['Size','Triangles','Mesh','Category'],'Stats show on the card');
  await page.waitForTimeout(300);await page.screenshot({path:path.join(output,`vr-${input}-card.png`)});
  // Color ▸ paints the selected part, on every device; Gray puts it back.
  await tap('radial:part:color');
  assert.deepEqual((await state()).watch.regions.radial,['radial:part-color:gray','radial:part-color:red','radial:part-color:orange','radial:part-color:yellow','radial:part-color:green','radial:part-color:blue','radial:center']);
  await tap('radial:part-color:blue');
  await desktop.waitForFunction(id=>viewerApp.link.state.scene.objects.find(o=>o.id===id).color==='#3a7bd5',vessel);
  await page.waitForFunction(id=>{const m=[...viewerApp.viewer.meshes.values()].find(m=>m.userData.objectId===id),c=m.geometry.attributes.color.array;return c[2]>c[0]*2;},vessel);
  assert.equal((await state()).watch.menu,'part','Choosing a color goes back to Part');
  await tap('radial:part:color');await tap('radial:part-color:gray');
  await desktop.waitForFunction(id=>!('color' in viewerApp.link.state.scene.objects.find(o=>o.id===id)),vessel);
  await tap('radial:part:stats');assert.equal((await state()).watch.card.stats,null,'Hide stats');
  // Unselect: the card goes, and the menu is back on the scene's ring.
  await tap('radial:part:unselect');
  await page.waitForFunction(()=>viewerApp.link.state.selected===null&&viewerApp.vr.state.watch.card===null);
  assert.equal((await state()).watch.menu,'scene');
  await tap('radial:center');
  await aimAt('right','Fluted vessel');await frames(3);await press('right',1);await press('right',0);
  await page.waitForFunction(id=>viewerApp.link.state.selected===id&&viewerApp.vr.state.watch.card?.part===id,vessel);
  await atRest();await tap('watch:face');
  // Settings ▸ Background: the room around the scene.
  await tap('radial:scene:settings');await tap('radial:settings:background');await tap('radial:background:lake');
  await page.waitForFunction(()=>viewerApp.vr.state.backgroundShown==='lake.jpg');
  await page.waitForTimeout(400);await page.screenshot({path:path.join(output,`vr-${input}-lake.png`)});
  // The living desert: the light follows the sun by day and the moon by night, and the sky can be paused.
  await tap('radial:background:desert-day');
  s=await state();assert.equal(s.backgroundShown,'desert-day');assert.ok(s.environment.running,'The day runs');
  const at=async phase=>{await page.evaluate(p=>viewerApp.vr.environments.setPhase(p),phase);await page.waitForTimeout(400);return (await state()).environment;};
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
  await page.waitForFunction(p=>viewerApp.vr.state.environment.phase>p,paused);
  assert.ok(await page.evaluate(()=>viewerApp.viewer.scene.getObjectByName('desert-day')),'The desert stands around the scene');
  await tap('radial:background:studio');assert.equal((await state()).backgroundShown,'studio');
  assert.equal(await page.evaluate(()=>viewerApp.viewer.scene.getObjectByName('desert-day')),undefined,'Leaving the desert removes it');
  assert.ok(await page.evaluate(()=>viewerApp.viewer.scene.children.filter(c=>c.isLight).every(l=>l.intensity>0)),'The studio lights come back');
  await tap('radial:center');await tap('radial:center');assert.equal((await state()).watch.menu,'scene','Back one ring at a time');
  await tap('radial:center');assert.equal((await state()).watch.menu,null,'Close');

  // View ▸ shows the selected part alone: with controllers, the card's, by laser and the trigger; with hands, the
  // right wrist's, tapped.
  assert.equal((await state()).watch.buttonLabel,'View ▸');
  if(input==='controller') {
    await page.waitForTimeout(400);   // the card ignores presses for a moment after it appears
    const button=await page.evaluate(()=>viewerApp.vr.regionPoint('card:action'));
    await place('right',[button[0],button[1],button[2]+.4]);await frames(3);
    s=await state();assert.equal(s.hands.find(h=>h.side==='right').over??null,null);
    assert.ok(s.lasers.some(l=>l.side==='right'&&l.shown),'The laser shows');
    assert.equal(await page.evaluate(()=>viewerApp.vr.hands.find(h=>h.source?.handedness==='right').panel?.id),'card:action','The laser lands on View ▸');
    await press('right',1);await press('right',0);
  } else await tap('wrist:button','left');
  await page.waitForFunction(id=>viewerApp.link.state.stage==='object'&&viewerApp.link.state.model.object_id===id&&viewerApp.viewer.stage==='object',vessel);
  await desktop.waitForFunction(()=>viewerApp.link.state.stage==='object');
  assert.equal(await page.evaluate(()=>[...viewerApp.viewer.meshes.values()].filter(m=>m.visible).length),1,'The part alone');
  await atRest();
  assert.equal((await state()).lasers.some(l=>l.shown),false,'No laser while the part is shown alone (except on its card)');
  // One hand grips and moves the part.
  const partFrom=(await state()).transform.position;
  await place('right',[.22,1.25,-.35]);await press('right',1);await place('right',[.32,1.25,-.35]);
  assert.ok(Math.abs((await state()).transform.position[0]-partFrom[0])>.06,'One hand moves the part');
  assert.deepEqual((await state()).transform.quaternion,[0,0,0,1],'Dragging moves it without turning it');await press('right',0);await atRest();
  // A pinch on the part itself picks it up: it moves and turns with the hand, as if held.
  const centre=async()=>page.evaluate(async()=>{const THREE=await import('three'),m=viewerApp.viewer.mesh;m.geometry.computeBoundingBox();const c=m.geometry.boundingBox.getCenter(new THREE.Vector3());return m.localToWorld(c).toArray();});
  await page.evaluate(()=>viewerApp.fit());await frames(3);
  const heldFrom=(await state()).transform,inside=await centre();
  await place('right',inside);await press('right',1);
  assert.equal((await state()).hands.find(h=>h.side==='right').mode,'hold','A pinch on the part holds it');
  const quarter=[0,Math.sin(Math.PI/8),0,Math.cos(Math.PI/8)];   // 45° about the vertical
  await place('right',[inside[0]+.1,inside[1]+.05,inside[2]],quarter);await frames(3);
  let held=(await state()).transform;
  assert.ok(held.position[0]-heldFrom.position[0]>.05&&held.position[1]-heldFrom.position[1]>.02,`The held part goes with the hand: ${JSON.stringify(held)}`);
  assert.ok(Math.abs(held.quaternion[1])>.2,`and turns with it: ${JSON.stringify(held.quaternion)}`);
  await press('right',0);await desktop.waitForFunction(q=>Math.abs(viewerApp.link.state.transform.quaternion[1]-q)<1e-6,held.quaternion[1]);
  await page.evaluate(()=>viewerApp.fit());await atRest();
  if(input==='controller') {
    // A fist (the grip button) turns the part about its center, which stays put.
    const spinFrom=(await state()).transform;
    await place('right',[.25,1.2,-.3]);
    await page.evaluate(()=>xrDevice.controllers.right.updateButtonValue('squeeze',1));await frames(2);
    assert.equal((await state()).hands.find(h=>h.side==='right').mode,'spin');
    await place('right',[.3,1.25,-.3],quarter);await frames(2);
    const spun=(await state()).transform;
    assert.ok(Math.abs(spun.quaternion[1])>.2,'The fist turns the part');
    assert.ok(spun.position.every((v,i)=>Math.abs(v-spinFrom.position[i])<1e-6),'about its center, which stays put');
    await page.evaluate(()=>xrDevice.controllers.right.updateButtonValue('squeeze',0));await frames(2);
    await page.evaluate(()=>viewerApp.fit());await atRest();
  }
  // One part's pie: ◀ Scene, Reset view, Stats, Color ▸, Settings. Its card carries ◀ Scene.
  await tap('watch:face');
  s=await state();assert.equal(s.watch.menu,'object');
  assert.deepEqual(s.watch.regions.radial,['radial:object:scene','radial:object:reset','radial:object:stats','radial:object:color','radial:object:settings','radial:center']);
  await tap('radial:object:stats');assert.ok((await state()).watch.card.stats,'Stats on the part alone too');
  await tap('radial:object:stats');await tap('radial:center');
  // The right wrist's button: ◀ Scene, tapped with the other hand.
  assert.equal((await state()).watch.buttonLabel,'◀ Scene');
  await tap('wrist:button','left');
  await page.waitForFunction(()=>viewerApp.link.state.stage==='scene'&&viewerApp.viewer.stage==='scene');
  await desktop.waitForFunction(()=>viewerApp.link.state.stage==='scene');
  assert.equal(await page.evaluate(()=>[...viewerApp.viewer.meshes.values()].filter(m=>m.visible).length),2);

  // Open ▸ browses the computer: Models ▸ Cubes ▸ two-cubes opens as the scene, on every device.
  await tap('watch:face');await tap('radial:scene:open');
  await page.waitForFunction(()=>viewerApp.vr.state.watch.regions.radial.includes('radial:files:open:0:0:folder-Models'));
  await tap('radial:files:open:0:0:folder-Models');
  await page.waitForFunction(()=>viewerApp.vr.state.watch.regions.radial.join()==='radial:files:open:1:0:up,radial:files:open:1:0:folder-Models/Cubes,radial:files:open:1:0:folder-Models/Empty,radial:center');
  await tap('radial:files:open:1:0:folder-Models/Empty');
  await page.waitForFunction(()=>viewerApp.vr.state.watch.regions.radial.join()==='radial:files:open:4:0:up,radial:center');
  await tap('radial:center');assert.equal((await state()).watch.menu,'files:open:1:0','Back goes up the way you came');
  await tap('radial:files:open:1:0:folder-Models/Cubes');
  await page.waitForFunction(()=>viewerApp.vr.state.watch.regions.radial.join()==='radial:files:open:3:0:up,radial:files:open:3:0:all,radial:files:open:3:0:file-Models/Cubes/tetra.obj,radial:files:open:3:0:file-Models/Cubes/two-cubes.stl,radial:center');
  await page.waitForTimeout(300);await page.screenshot({path:path.join(output,`vr-${input}-files.png`)});
  await tap('radial:files:open:3:0:file-Models/Cubes/two-cubes.stl');
  await page.waitForFunction(()=>viewerApp.link.state.scene.name==='two-cubes'&&viewerApp.viewer.meshes.size===2&&viewerApp.vr.state.watch.menu===null);
  await desktop.waitForFunction(()=>viewerApp.link.state.scene.name==='two-cubes');
  await page.waitForFunction(()=>/Opened two-cubes/.test(viewerApp.vr.state.watch.caption||''));
  // Add part ▸ starts in the open model's folder: the tetrahedron is added beside the cubes, and selected.
  await atRest();await tap('watch:face');await tap('radial:scene:add');
  await page.waitForFunction(()=>viewerApp.vr.state.watch.regions.radial.includes('radial:files:add:0:0:file-Models/Cubes/tetra.obj'));
  await tap('radial:files:add:0:0:file-Models/Cubes/tetra.obj');
  await page.waitForFunction(()=>viewerApp.link.state.scene.objects.length===3&&viewerApp.viewer.meshes.size===3);
  assert.equal(await page.evaluate(()=>viewerApp.link.state.scene.objects.find(o=>o.id===viewerApp.link.state.selected)?.name),'tetra');
  // Stats name the file a part came from.
  await atRest();await tap('watch:face');await tap('radial:scene:part');await tap('radial:part:stats');
  assert.deepEqual((await state()).watch.card.stats,['Size','Triangles','Mesh','File']);
  await tap('radial:part:stats');await tap('radial:center');

  if(input==='hand') {
    const sizes=await page.evaluate(async()=>{const THREE=await import('three');return viewerApp.vr.hands.map(hand=>{const skin=hand.xrHand.getObjectByProperty('type','SkinnedMesh');skin.computeBoundingBox();return {size:skin.boundingBox.getSize(new THREE.Vector3()).length(),dots:Object.values(hand.xrHand.joints).filter(j=>j.userData.dot?.visible).length};});});
    for(const hand of sizes){assert.ok(hand.size<.6,'Tracked hand mesh stays hand-sized');assert.equal(hand.dots,0,'Joint dots hide once the hand model is ready');}
  }

  // Parts ▸ selects another (and returns to the scene's ring).
  const big=await page.evaluate(()=>viewerApp.link.state.scene.objects.find(o=>o.name==='Big cube').id);
  await tap('radial:scene:parts');await tap(`radial:parts:0:${big}`);
  await page.waitForFunction(id=>viewerApp.link.state.selected===id,big);assert.equal((await state()).watch.menu,'scene');
  await tap('radial:center');
  // Exit VR asks first: Settings ▸ Exit VR ▸ Stay goes back; Yes, exit leaves.
  await tap('watch:face');await tap('radial:scene:settings');await tap('radial:settings:exit');
  assert.equal((await state()).watch.menu,'exit');
  await tap('radial:exit:stay');assert.equal((await state()).watch.menu,'settings');assert.equal(await page.evaluate(()=>viewerApp.vr.presenting),true);
  await tap('radial:settings:exit');await tap('radial:exit:confirm');
  await page.waitForFunction(()=>!viewerApp.vr.presenting);
  assert.equal(await page.evaluate(()=>viewerApp.vr.state.backgroundShown),'studio','Leaving VR puts the studio back');
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('Quest controller and tracked-hand scene selection by laser, gripping and scaling, the watch pie in the scene and with one part, the card and stats, View and ◀ Scene, Open ▸ and Add part ▸ file browsing, backgrounds, Exit confirmation, and desktop following passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
