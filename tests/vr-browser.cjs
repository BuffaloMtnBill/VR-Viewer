/* Real WebXR events on an emulated Quest: gestures, wrist UI, keyboard, model marks, desktop handoff. */
const {chromium}=require(process.env.EDITOR_VR_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const url=process.env.EDITOR_VR_URL||'http://127.0.0.1:8021';
const iwer=process.env.EDITOR_VR_IWER||require.resolve('iwer/build/iwer.min.js');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.EDITOR_VR_CHROMIUM||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 const desktop=await browser.newPage({viewport:{width:1450,height:1000}}),errors=[];desktop.on('pageerror',e=>errors.push(e.message));await desktop.goto(url);await desktop.waitForFunction(()=>editor?.ready);
 for(const input of ['controller','hand']){
  const page=await browser.newPage({viewport:{width:1400,height:1000}});page.on('pageerror',e=>errors.push(input+': '+e.message));
  await page.addInitScript({content:`${await fs.readFile(iwer,'utf8')}\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3);window.xrDevice.installRuntime({forceInstall:true});window.xrDevice.primaryInputMode='${input}';`});
  await page.goto(url);await page.waitForFunction(()=>window.editor?.ready);await page.evaluate(async()=>{await editor.link.command('/api/demo',{});await editor.link.settings({mode:'inspect',description:''});});
  await page.waitForFunction(()=>editor.viewer.modelId===editor.link.state.model.id);
  await page.locator('#enter-vr').click();await page.waitForFunction(()=>editor.xr.state.presenting);await page.waitForTimeout(350);
  const state=()=>page.evaluate(()=>editor.xr.state),frames=()=>page.waitForTimeout(180);
  const place=async(side,position,quaternion=[0,0,0,1])=>{await page.evaluate(({side,position,quaternion,input})=>{const source=input==='hand'?xrDevice.hands[side]:xrDevice.controllers[side];source.position.set(...position);source.quaternion.set(...quaternion);},{side,position,quaternion,input});await frames();};
  const press=async(side,value)=>{await page.evaluate(({side,value,input})=>{if(input==='hand')xrDevice.hands[side].updatePinchValue(value);else xrDevice.controllers[side].updateButtonValue('trigger',value);},{side,value,input});await frames();};
  await place('left',[-.2,1.25,-.35]);await place('right',[.22,1.25,-.35]);
  if(input==='hand'){await page.waitForFunction(()=>editor.xr.state.hands.filter(h=>h.tracked&&h.model).length===2,null,{timeout:15000});}
  const before=(await state()).transform.position;
  await press('right',1);assert.equal((await state()).hands.find(h=>h.side==='right').mode,'grab');
  await place('right',[.32,1.25,-.35]);const moved=(await state()).transform.position;assert.ok(Math.abs(moved[0]-before[0])>.06,'One-hand grabbing must move the model');await press('right',0);
  await place('left',[-.13,1.25,-.35]);await place('right',[.13,1.25,-.35]);
  await press('left',1);await press('right',1);const small=(await state()).transform.scale;
  await place('left',[-.23,1.25,-.35]);await place('right',[.23,1.25,-.35]);assert.ok((await state()).transform.scale>small*1.4,'Two hands must scale the model');
  const rotationBefore=(await state()).transform.quaternion;
  await place('left',[0,1.25,-.12]);await place('right',[0,1.25,-.58]);
  const rotationAfter=(await state()).transform.quaternion;
  assert.ok(Math.abs(rotationAfter.reduce((sum,q,i)=>sum+q*rotationBefore[i],0))<.9,'Turning the hand pair must rotate the model');
  await press('left',0);await press('right',0);await page.evaluate(()=>editor.fit());await frames();
  // Aim using the panel's actual world transform and region rectangles.
  async function tap(panel,id){
   await page.evaluate(async({panel,id,input})=>{const THREE=await import('three'),state=editor.xr.state.ui[panel],r=state.regions.find(r=>r.id===id);if(!r)throw new Error('No UI region '+id);const matrix=new THREE.Matrix4().fromArray(state.matrix);const target=new THREE.Vector3(((r.x+r.w/2)/state.canvas[0]-.5)*state.width,(.5-(r.y+r.h/2)/state.canvas[1])*state.height,0).applyMatrix4(matrix);const origin=target.clone().addScaledVector(new THREE.Vector3(0,0,1).transformDirection(matrix),panel==='watch'?.12:.32);const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),target.clone().sub(origin).normalize());const source=input==='hand'?xrDevice.hands.right:xrDevice.controllers.right;source.position.set(origin.x,origin.y,origin.z);source.quaternion.set(q.x,q.y,q.z,q.w);},{panel,id,input});
   await frames();await press('right',1);await press('right',0);await page.evaluate(()=>editor.link.pending);
  }
  // The pie menu: Tools ▸ a tool closes it; Mark style ▸ Color / Category return to Mark style; Back climbs one ring.
  await tap('watch','watch-menu');assert.equal((await state()).ui.radial.visible,true);assert.equal((await state()).ui.menu,'root');
  await tap('radial','radial-root-tools');assert.equal((await state()).ui.menu,'tools');
  await tap('radial','radial-tools-pin');await page.waitForFunction(()=>editor.link.state.settings.tool==='pin'&&editor.link.state.settings.mode==='edit');assert.equal((await state()).ui.radial.visible,false);
  await tap('watch','watch-menu');await tap('radial','radial-root-style');await tap('radial','radial-style-color');await tap('radial','radial-color-2');
  await page.waitForFunction(()=>editor.link.state.settings.color==='#ad9bff');assert.equal((await state()).ui.menu,'style');
  await tap('radial','radial-style-category');await tap('radial','radial-category-general');await page.waitForFunction(()=>editor.link.state.settings.category==='general');
  const radius=await page.evaluate(()=>editor.link.state.settings.brush_radius_mm);await tap('radial','radial-style-brush');await tap('radial','radial-brush-+');
  await page.waitForFunction(r=>editor.link.state.settings.brush_radius_mm===r+.5,radius);
  await tap('radial','radial-center');assert.equal((await state()).ui.menu,'style');await tap('radial','radial-center');assert.equal((await state()).ui.menu,'root');
  await tap('radial','radial-root-note');assert.equal((await state()).ui.radial.visible,false);assert.equal((await state()).ui.panel.visible,true);assert.equal((await state()).ui.page,'instruction');
  for(const key of 'smooth')await tap('panel','key-'+key);
  await page.waitForFunction(()=>editor.link.state.settings.description==='smooth');
  await desktop.waitForFunction(()=>document.getElementById('description').value==='smooth');
  await tap('panel','close');
  // Point at the model's front surface and select through the actual ray.
  await page.evaluate(async input=>{const THREE=await import('three'),v=editor.viewer,b=v.mesh.geometry.boundingBox;const target=v.world(new THREE.Vector3(0,b.min.y,(b.min.z+b.max.z)/2));const source=input==='hand'?xrDevice.hands.right:xrDevice.controllers.right;source.position.set(target.x,target.y,target.z+.35);source.quaternion.set(0,0,0,1);},input);
  await frames();await press('right',1);await press('right',0);
  await page.waitForFunction(()=>editor.link.state.annotations.length===1);
  assert.equal(await page.evaluate(()=>editor.link.state.annotations[0].color),'#ad9bff');
  const previousRequests=await page.evaluate(()=>editor.link.state.requests.length);await tap('watch','watch-submit');await page.waitForFunction(count=>editor.link.state.requests.length===count+1,previousRequests);
  const requestID=await page.evaluate(()=>editor.link.state.requests[0].id);await desktop.waitForFunction(id=>editor.link.state.requests.some(r=>r.id===id),requestID);
  const packet=await page.evaluate(()=>editor.link.state.requests.find(r=>r.description==='smooth').packet_url);assert.equal((await desktop.request.get(url+packet)).status(),200);
  const folder=path.resolve(__dirname,'../test-results');await fs.mkdir(folder,{recursive:true});await page.waitForTimeout(500);
  if(input==='hand'){
    const sizes=await page.evaluate(async()=>{const THREE=await import('three');return editor.xr.hands.map(hand=>{const skin=hand.hand.getObjectByProperty('type','SkinnedMesh');skin.computeBoundingBox();return {size:skin.boundingBox.getSize(new THREE.Vector3()).length(),dots:Object.values(hand.hand.joints).filter(j=>j.userData.editorDot?.visible).length};});});
    for(const hand of sizes){assert.ok(hand.size<.6,'Tracked hand mesh must remain hand-sized');assert.equal(hand.dots,0,'Fallback dots hide after the hand skin is ready');}
  }
  await tap('watch','watch-menu');await tap('radial','radial-root-style');await place('right',[.3,1.12,-.4]);await frames();
  await page.screenshot({path:path.join(folder,'vr-'+input+'.png')});
  await page.evaluate(()=>editor.xr.session.end());await page.waitForFunction(()=>!editor.xr.state.presenting);await page.close();
 }
 assert.deepEqual(errors,[]);console.log('Quest controller and tracked-hand movement, two-hand scaling, wrist pie menu, in-world keyboard, surface selection, wrist submission, and desktop synchronization passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
