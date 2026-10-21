const {chromium}=require(process.env.VR_VIEWER_PLAYWRIGHT||'playwright-core');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const url=process.env.VR_VIEWER_URL||'http://127.0.0.1:8021';
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.VR_VIEWER_CHROMIUM||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
  const context=await browser.newContext(),desktop=await context.newPage(),peer=await context.newPage(),errors=[],external=[];
  for(const page of [desktop,peer]){page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==new URL(url).origin)external.push(r.url());});await page.setViewportSize({width:1500,height:1050});await page.goto(url);await page.waitForFunction(()=>window.viewerApp?.ready);await page.waitForFunction(()=>document.getElementById('connection-state').textContent==='Live sync');}
  await desktop.evaluate(()=>viewerApp.link.command('/api/demo',{}));
  // The scene opens first: its parts listed by category.
  await peer.waitForFunction(()=>viewerApp.link.state.stage==='scene'&&viewerApp.viewer.sceneKey?.endsWith(':scene:')&&viewerApp.viewer.meshes.size===2);
  assert.equal(await desktop.locator('.part-row').count(),2);
  assert.equal(await desktop.locator('#detail-name').textContent(),'Nothing selected');
  // A click on the vessel in the view selects it on both devices, and its details show.
  const vessel=await peer.evaluate(()=>viewerApp.link.state.scene.objects.find(o=>o.name==='Fluted vessel').id);
  const vesselPoint=await peer.evaluate(async id=>{const THREE=await import('three'),v=viewerApp.viewer;v.controls.update();v.scene.updateMatrixWorld(true);for(let y=.3;y<=.7;y+=.05)for(let x=.35;x<=.65;x+=.05){const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x*2-1,1-y*2),v.camera);if(v.hit(ray)?.objectId===id){const box=v.canvas.getBoundingClientRect();return {x:box.x+x*box.width,y:box.y+y*box.height};}}throw new Error('The vessel is not in view');},vessel);
  await peer.mouse.click(vesselPoint.x,vesselPoint.y);
  await desktop.waitForFunction(id=>viewerApp.link.state.selected===id,vessel);
  await desktop.waitForFunction(()=>document.querySelector('.part-row[aria-selected=true]')?.textContent.includes('Fluted vessel'));
  assert.equal(await desktop.locator('#detail-name').textContent(),'Fluted vessel');
  assert.match(await desktop.locator('#part-details').textContent(),/Size.*mm.*Triangles.*Mesh\s*Closed/s);
  // Color: the picker paints the selected part on both devices.
  await desktop.locator('#part-color').evaluate(input=>{input.value='#5cb85c';input.dispatchEvent(new Event('change',{bubbles:true}));});
  await peer.waitForFunction(id=>{const m=[...viewerApp.viewer.meshes.values()].find(m=>m.userData.objectId===id),c=m.geometry.attributes.color.array;return m.userData.paint==='#5cb85c'&&c[1]>c[0]*2;},vessel);
  assert.equal(await peer.locator('#part-color').inputValue(),'#5cb85c');
  // The selected part is outlined, and the outline pulses; the other parts are not.
  await peer.waitForFunction(id=>viewerApp.viewer.outlined===id,vessel);
  assert.deepEqual(await peer.evaluate(()=>[...viewerApp.viewer.meshes.values()].map(m=>m.children.filter(c=>c.name.startsWith('outline-')&&c.visible).length).sort()),[0,2]);
  const beats=await peer.evaluate(async()=>{const seen=new Set();for(let i=0;i<12;i++){seen.add(viewerApp.viewer.outline.edge.uniforms.opacity.value.toFixed(2));await new Promise(r=>setTimeout(r,120));}return seen.size;});
  assert.ok(beats>3,'The outline pulses');
  const folder=path.resolve(__dirname,'../test-results');fs.mkdirSync(folder,{recursive:true});await peer.screenshot({path:path.join(folder,'selected-outline.png')});
  // View part: the part on its own, on both devices; Escape goes back to the scene.
  await desktop.locator('#view-part').click();
  await peer.waitForFunction(id=>viewerApp.link.state.stage==='object'&&viewerApp.link.state.model.object_id===id&&viewerApp.viewer.stage==='object',vessel);
  assert.equal(await peer.evaluate(()=>viewerApp.viewer.outlined),null,'Viewing a part alone drops the outline');
  assert.equal(await peer.evaluate(()=>[...viewerApp.viewer.meshes.values()].filter(m=>m.visible).length),1,'The part is shown alone');
  assert.equal(await peer.locator('#model-name').textContent(),'Fluted vessel');assert.equal(await peer.locator('#view-badge').textContent(),'ONE PART');
  await desktop.locator('#wireframe').click();assert.equal(await desktop.locator('#wireframe').getAttribute('aria-pressed'),'true');await desktop.locator('#wireframe').click();
  await desktop.screenshot({path:path.join(folder,'desktop-part.png'),fullPage:true});
  await desktop.locator('#viewport').click({position:{x:5,y:5}});await desktop.keyboard.press('Escape');
  await peer.waitForFunction(()=>viewerApp.link.state.stage==='scene'&&viewerApp.viewer.stage==='scene');
  await desktop.evaluate(()=>viewerApp.link.drop());await desktop.waitForFunction(()=>document.getElementById('connection-state').textContent==='Live sync');

  // Open…: the file browser starts at the root, goes into Models ▸ Cubes, and opens an STL of two named solids.
  await desktop.locator('#open-files').click();
  await desktop.waitForFunction(()=>[...document.querySelectorAll('#file-list .file-row b')].some(b=>b.textContent==='Models'));
  assert.equal(await desktop.locator('#open-folder').isDisabled(),true,'Nothing to open at the root');
  await desktop.locator('#file-list .file-row',{hasText:'Models'}).click();
  await desktop.waitForFunction(()=>[...document.querySelectorAll('#file-list .file-row b')].map(b=>b.textContent).join()==='Up a folder,Cubes,Empty');
  await desktop.locator('#file-list .file-row',{hasText:'Cubes'}).click();
  await desktop.waitForFunction(()=>[...document.querySelectorAll('#file-list .file-row.model b')].map(b=>b.textContent).join()==='tetra.obj,two-cubes.stl');
  assert.equal(await desktop.locator('#file-list .file-row',{hasText:'readme'}).count(),0,'Only model files are listed');
  assert.deepEqual(await desktop.locator('#files-crumbs button').allTextContents(),[await desktop.evaluate(()=>document.querySelector('#files-crumbs button').textContent),'Models','Cubes']);
  await desktop.screenshot({path:path.join(folder,'file-browser.png')});
  await desktop.locator('#file-list .file-row',{hasText:'two-cubes.stl'}).click();
  await peer.waitForFunction(()=>viewerApp.link.state.scene.name==='two-cubes'&&viewerApp.viewer.meshes.size===2);
  assert.equal(await desktop.locator('#files-dialog').evaluate(d=>d.open),false,'Opening closes the browser');
  assert.deepEqual(await peer.evaluate(()=>viewerApp.link.state.scene.objects.map(o=>o.name)),['Big cube','Small cube']);
  assert.equal(await peer.locator('#source-file').textContent(),'two-cubes.stl');
  // Add part: the browser opens in the model's folder; the OBJ is added beside the scene and selected.
  await desktop.locator('#add-part').click();
  await desktop.waitForFunction(()=>document.getElementById('files-title').textContent==='Add a part.'&&[...document.querySelectorAll('#file-list .file-row.model b')].some(b=>b.textContent==='tetra.obj'));
  await desktop.locator('#file-list .file-row',{hasText:'tetra.obj'}).click();
  await peer.waitForFunction(()=>viewerApp.link.state.scene.objects.length===3&&viewerApp.viewer.meshes.size===3);
  const added=await peer.evaluate(()=>viewerApp.link.state.scene.objects[2]);
  assert.equal(added.name,'tetra');assert.equal(await peer.evaluate(()=>viewerApp.link.state.selected),added.id,'The added part is selected');
  // Remove it again (the file is untouched).
  desktop.once('dialog',dialog=>dialog.accept());await desktop.locator('#remove-part').click();
  await peer.waitForFunction(()=>viewerApp.link.state.scene.objects.length===2&&viewerApp.viewer.meshes.size===2);
  // Open every model here: the folder's files together (the STL's named solids are still its parts).
  await desktop.locator('#open-files').click();await desktop.locator('[data-files=open]').click();
  await desktop.waitForFunction(()=>!document.getElementById('open-folder').disabled);await desktop.locator('#open-folder').click();
  await peer.waitForFunction(()=>viewerApp.link.state.scene.name==='Cubes'&&viewerApp.viewer.meshes.size===3);
  assert.deepEqual(await peer.evaluate(()=>viewerApp.link.state.scene.objects.map(o=>o.name)),['tetra','Big cube','Small cube']);
  // An upload from this device is added beside the parts.
  await desktop.locator('#model-file').setInputFiles({name:'tiny-tetra.obj',mimeType:'text/plain',buffer:Buffer.from('v 0 0 0\nv 20 0 0\nv 0 20 0\nv 0 0 20\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n')});
  await peer.waitForFunction(()=>viewerApp.link.state.scene.objects.length===4&&viewerApp.viewer.meshes.size===4);
  await desktop.screenshot({path:path.join(folder,'desktop.png'),fullPage:true});
  await desktop.setViewportSize({width:390,height:844});assert.equal(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await desktop.screenshot({path:path.join(folder,'mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('Scene selection, details, color and outline, viewing one part, the file browser (open, add, a whole folder), reconnect, uploads and the responsive layout passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
