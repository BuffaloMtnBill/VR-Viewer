/* VR voice on an emulated Meta Quest 3: spoken audio (tests/fixtures/voice-speech.wav, made with espeak-ng) is played
 * into Chromium's fake microphone, so the headset's own speech detection runs on real audio; the computer's Whisper is
 * stood in for, answering each clip in turn with the next phrase below (tests/test_speech.py covers the server).
 * Covers the commands, options said from another ring, viewing a part and the scene, and opening a file by voice.
 * Run with `npm test -- voice`.
 */
const {chromium}=require(process.env.VR_VIEWER_PLAYWRIGHT||'playwright-core');
const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const url=process.env.VR_VIEWER_URL||'http://127.0.0.1:8021';
const iwer=process.env.VR_VIEWER_IWER||require.resolve('iwer/build/iwer.min.js');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.VR_VIEWER_CHROMIUM||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader',
    '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${path.join(__dirname,'fixtures','voice-speech.wav')}`]});
  try {
    const page=await browser.newPage({viewport:{width:1400,height:950},permissions:['microphone']}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    // What the computer "hears": commands for each clip in turn.
    const heard=['Open menu.','Stand.','Show stats.','Make it blue.','View part.','Back to scene.','Open files.','Models.','Cubes.','Two cubes.'],sent=[];
    await page.route('**/api/transcribe',route=>{const body=route.request().postDataJSON();sent.push(body);route.fulfill({json:{text:heard.shift()??''}});});
    await page.addInitScript({content:`${await fs.readFile(iwer,'utf8')}\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3);window.xrDevice.installRuntime({forceInstall:true});`});
    await page.goto(url);await page.waitForFunction(()=>window.viewerApp?.ready);
    await page.evaluate(()=>viewerApp.link.command('/api/demo',{}));
    await page.waitForFunction(()=>viewerApp.viewer.meshes?.size===2);
    await page.locator('#enter-vr').click();await page.waitForFunction(()=>viewerApp.vr.presenting);
    await page.waitForFunction(()=>viewerApp.vr.state.commands.state==='listening',null,{timeout:10000});
    const until=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:25000});

    // "Open menu" opens the scene's ring; "Stand" (a part, in Parts ▸) selects it.
    await until(()=>viewerApp.vr.state.watch.menu==='scene');
    assert.equal(sent[0].purpose,'command');
    const stand=await page.evaluate(()=>viewerApp.link.state.scene.objects.find(o=>o.name==='Stand').id);
    await until(id=>viewerApp.link.state.selected===id,stand);
    // "Show stats" puts them on the card above Stand; "Make it blue" (two rings in: Part ▸ Color) paints it.
    await until(()=>viewerApp.vr.state.watch.card?.stats?.includes('Triangles'));
    await until(id=>viewerApp.link.state.scene.objects.find(o=>o.id===id).color==='#3a7bd5',stand);
    assert.ok(sent.at(-1).vocabulary.includes('Blue'),'Whisper is told the names in the menus');
    // "View part" shows it alone; "Back to scene" (a command: the menu has closed) every part again.
    await until(id=>viewerApp.link.state.stage==='object'&&viewerApp.link.state.model.object_id===id,stand);
    await until(()=>viewerApp.link.state.stage==='scene');
    // "Open files" opens the browser; a folder, then another, then a file, are said by name.
    await until(()=>viewerApp.vr.state.watch.menu==='files:open:0:0');
    await until(()=>viewerApp.link.state.scene.name==='two-cubes');
    await until(()=>viewerApp.vr.state.watch.menu===null);
    assert.deepEqual(await page.evaluate(()=>viewerApp.link.state.scene.objects.map(o=>o.name)),['Big cube','Small cube']);
    assert.deepEqual(errors,[],`No page errors: ${errors.join('; ')}`);
    console.log('VR voice commands, parts by name, stats and color, View part and Back to scene, options from any ring, and opening a file by voice passed.');
  } finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
