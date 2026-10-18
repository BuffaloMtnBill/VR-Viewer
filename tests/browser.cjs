const {chromium}=require(process.env.EDITOR_VR_PLAYWRIGHT||'playwright-core');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const url=process.env.EDITOR_VR_URL||'http://127.0.0.1:8021';
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.EDITOR_VR_CHROMIUM||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
  const context=await browser.newContext(),desktop=await context.newPage(),peer=await context.newPage(),errors=[],external=[];
  for(const page of [desktop,peer]){page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==new URL(url).origin)external.push(r.url());});await page.setViewportSize({width:1500,height:1050});await page.goto(url);await page.waitForFunction(()=>window.editor?.ready);await page.waitForFunction(()=>document.getElementById('connection-state').textContent==='Live sync');}
  await desktop.evaluate(()=>editor.link.command('/api/demo',{}));await peer.waitForFunction(()=>editor.link.state.annotations.length===0);
  // The scene opens first: its parts listed by category, the marking tools waiting for a part.
  await peer.waitForFunction(()=>editor.link.state.stage==='scene'&&editor.viewer.sceneKey?.endsWith(':scene:'));
  assert.equal(await desktop.locator('.part-row').count(),2);
  assert.equal(await peer.locator('[data-tool=pin]').isVisible(),false,'The marking tools wait for a part');
  // A click on the vessel in the view selects it on both devices; Edit part shows it alone, with the tools.
  const vessel=await peer.evaluate(()=>editor.link.state.scene.objects.find(o=>o.name==='Fluted vessel').id);
  const vesselPoint=await peer.evaluate(async id=>{const THREE=await import('three'),v=editor.viewer;v.controls.update();v.scene.updateMatrixWorld(true);for(let y=.3;y<=.7;y+=.05)for(let x=.35;x<=.65;x+=.05){const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x*2-1,1-y*2),v.camera);if(v.hit(ray)?.objectId===id){const box=v.canvas.getBoundingClientRect();return {x:box.x+x*box.width,y:box.y+y*box.height};}}throw new Error('The vessel is not in view');},vessel);
  await peer.mouse.click(vesselPoint.x,vesselPoint.y);
  await desktop.waitForFunction(id=>editor.link.state.selected===id,vessel);
  await desktop.waitForFunction(()=>document.querySelector('.part-row[aria-selected=true]')?.textContent.includes('Fluted vessel'));
  await desktop.locator('#edit-part').click();
  await peer.waitForFunction(id=>editor.link.state.stage==='object'&&editor.link.state.model.object_id===id&&editor.viewer.stage==='object',vessel);
  assert.equal(await peer.evaluate(()=>[...editor.viewer.meshes.values()].filter(m=>m.visible).length),1,'The part is shown alone');
  assert.equal(await peer.locator('#model-name').textContent(),'Fluted vessel');
  await peer.locator('[data-tool=pin]').click();await desktop.waitForFunction(()=>editor.link.state.settings.tool==='pin');
  await peer.locator('#description').fill('Round the marked edge and increase this opening by 2 mm.');await desktop.waitForFunction(()=>document.getElementById('description').value.includes('Round the marked'));
  // Click the rendered mesh through a true projected world point, rather than an API annotation.
  const point=await peer.evaluate(async()=>{const THREE=await import('three'),v=editor.viewer;v.controls.update();v.scene.updateMatrixWorld(true);let found=null;for(let y=.3;y<=.7&&!found;y+=.1)for(let x=.35;x<=.65&&!found;x+=.1){const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x*2-1,1-y*2),v.camera);if(v.hit(ray))found={x,y};}if(!found)throw new Error('No visible mesh');const box=v.canvas.getBoundingClientRect();return {x:box.x+found.x*box.width,y:box.y+found.y*box.height};});
  await peer.mouse.click(point.x,point.y);await desktop.waitForFunction(()=>editor.link.state.annotations.length===1);
  assert.equal(await desktop.locator('#annotation-count').textContent(),'1');
  const pending=peer.waitForResponse(r=>r.url().endsWith('/api/submit'));await peer.locator('#submit-request').click();const response=await pending;assert.equal(response.status(),200,await response.text());
  await desktop.waitForFunction(()=>editor.link.state.requests.length>0);const record=await desktop.evaluate(()=>editor.link.state.requests[0]);
  assert.match(await desktop.locator('.request-card').first().textContent(),/Round the marked edge/);
  const packet=await desktop.request.get(url+record.packet_url);assert.equal(packet.status(),200);assert.equal((await packet.body()).readUInt32LE(0),0x04034b50);
  await desktop.evaluate(()=>editor.link.drop());await desktop.waitForFunction(()=>document.getElementById('connection-state').textContent==='Live sync');
  await peer.locator('[data-tool=spray]').click();await desktop.waitForFunction(()=>editor.link.state.settings.tool==='spray');
  await peer.mouse.move(point.x,point.y);await peer.mouse.down();await peer.mouse.move(point.x+12,point.y+15,{steps:5});await peer.mouse.up();await desktop.waitForFunction(()=>editor.link.state.annotations.length>=2);
  // Exercise the other toolkits against rendered geometry as well.
  await peer.locator('[data-tool=box]').click();await peer.waitForFunction(()=>editor.link.state.settings.tool==='box');
  const beforeBox=await peer.evaluate(()=>editor.link.state.annotations.length);
  await peer.mouse.move(point.x,point.y);await peer.mouse.down();await peer.mouse.move(point.x+70,point.y+95,{steps:8});await peer.mouse.up();
  await peer.waitForFunction(count=>editor.link.state.annotations.length===count+1,beforeBox);
  assert.equal(await peer.evaluate(()=>editor.link.state.annotations.at(-1).tool),'box');
  const targets=await peer.evaluate(async()=>{const THREE=await import('three'),v=editor.viewer,b=v.canvas.getBoundingClientRect(),targets=[];for(let y=.35;y<.64;y+=.07)for(let x=.42;x<.63;x+=.06){const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x*2-1,1-y*2),v.camera);if(v.hit(ray))targets.push({x:b.x+x*b.width,y:b.y+y*b.height});}return [targets[0],targets.at(-1)];});
  assert.ok(targets[0]&&targets[1]);await peer.locator('[data-tool=measure]').click();await peer.waitForFunction(()=>editor.link.state.settings.tool==='measure');
  await peer.mouse.click(targets[0].x,targets[0].y);await peer.mouse.click(targets[1].x,targets[1].y);
  await peer.waitForFunction(()=>editor.link.state.annotations.at(-1)?.tool==='measure');
  assert.ok(await peer.evaluate(()=>editor.link.state.annotations.at(-1).distance_mm>0));
  const beforeErase=await peer.evaluate(()=>editor.link.state.annotations.length);await peer.locator('[data-tool=erase]').click();await peer.waitForFunction(()=>editor.link.state.settings.tool==='erase');await peer.mouse.click(point.x,point.y);
  await peer.waitForFunction(count=>editor.link.state.annotations.length===count-1,beforeErase);
  await desktop.waitForFunction(count=>editor.link.state.annotations.length===count,beforeErase-1);
  await desktop.locator('#wireframe').click();assert.equal(await desktop.locator('#wireframe').getAttribute('aria-pressed'),'true');await desktop.locator('#wireframe').click();
  const folder=path.resolve(__dirname,'../test-results');fs.mkdirSync(folder,{recursive:true});await desktop.screenshot({path:path.join(folder,'desktop.png'),fullPage:true});
  await desktop.setViewportSize({width:390,height:844});assert.equal(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await desktop.screenshot({path:path.join(folder,'mobile.png'),fullPage:true});
  // Back to the scene: the vessel's marks wait there (counted on its row); an upload is added beside the parts.
  const vesselMarks=await desktop.evaluate(()=>editor.link.state.annotations.length);
  await desktop.setViewportSize({width:1500,height:1050});await desktop.locator('#back-to-scene').click();
  await peer.waitForFunction(()=>editor.link.state.stage==='scene'&&editor.viewer.stage==='scene');
  assert.equal(await desktop.locator('.part-row',{hasText:'Fluted vessel'}).locator('.marks').textContent(),String(vesselMarks));
  await desktop.locator('#model-file').setInputFiles({name:'tiny-tetra.obj',mimeType:'text/plain',buffer:Buffer.from('v 0 0 0\nv 20 0 0\nv 0 20 0\nv 0 0 20\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n')});
  await peer.waitForFunction(()=>editor.link.state.scene.objects.length===3&&editor.viewer.meshes.size===3);
  const added=await peer.evaluate(()=>editor.link.state.scene.objects[2]);
  assert.equal(added.name,'tiny tetra');assert.equal(await peer.evaluate(()=>editor.link.state.selected),added.id,'The added part is selected');
  assert.equal(await desktop.locator('#annotation-count').textContent(),'0');
  // Remove it again (the files are untouched).
  desktop.once('dialog',dialog=>dialog.accept());await desktop.locator('#remove-part').click();
  await peer.waitForFunction(()=>editor.link.state.scene.objects.length===2&&editor.viewer.meshes.size===2);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('Scene selection and part editing, desktop/peer sync, spray, box regions, pins, rulers, erase, request packets, reconnect, responsive layout, and shared uploads passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
