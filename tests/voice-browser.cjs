/* VR voice on an emulated Meta Quest 3: spoken audio (tests/fixtures/voice-speech.wav, made with espeak-ng) is played
 * into Chromium's fake microphone, so the headset's own speech detection runs on real audio; the computer's Whisper is
 * stood in for, answering each clip in turn with the next phrase below (tests/test_workspace.py covers the server).
 * Covers the commands, options said from another ring, the confirmation before sending, and dictating the note.
 * Run with `npm test -- voice`.
 */
const {chromium}=require(process.env.EDITOR_VR_PLAYWRIGHT||'playwright-core');
const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const url=process.env.EDITOR_VR_URL||'http://127.0.0.1:8021';
const iwer=process.env.EDITOR_VR_IWER||require.resolve('iwer/build/iwer.min.js');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.EDITOR_VR_CHROMIUM||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader',
    '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${path.join(__dirname,'fixtures','voice-speech.wav')}`]});
  try {
    const page=await browser.newPage({viewport:{width:1400,height:950},permissions:['microphone']}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    // What the computer "hears": commands for each clip in turn; a dictated note when the keyboard asks.
    const heard=['Open menu.','Annotate.','Smooth or blend.','Back.','Measure tool.','Submit.','Not yet.','Take a note.'],sent=[];
    await page.route('**/api/transcribe',route=>{const body=route.request().postDataJSON();sent.push(body);
      route.fulfill({json:{text:body.purpose==='note'?'Round the rim by 2 mm.':heard.shift()??''}});});
    await page.addInitScript({content:`${await fs.readFile(iwer,'utf8')}\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3);window.xrDevice.installRuntime({forceInstall:true});`});
    await page.goto(url);await page.waitForFunction(()=>window.editor?.ready);
    await page.evaluate(async()=>{await editor.link.command('/api/demo',{});await editor.link.settings({mode:'inspect',description:'',tool:'spray',color:'#ffb86b'});});
    await page.locator('#enter-vr').click();await page.waitForFunction(()=>editor.vr.presenting);
    await page.waitForFunction(()=>editor.vr.state.commands.state==='listening',null,{timeout:10000});
    const until=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:25000});

    // "Open menu" opens Inspect's ring; "Annotate" (an option on show) switches mode, and the menu follows.
    await until(()=>editor.vr.state.watch.menu==='inspect');
    assert.equal(sent[0].purpose,'command');
    await until(()=>editor.link.state.settings.mode==='edit');
    await until(()=>editor.vr.state.watch.menu==='annotate');
    // "Smooth or blend" lives two rings in (Mark style ▸ Color): it is chosen, and the menu shows Mark style.
    await until(()=>editor.link.state.settings.color==='#6be0d4');
    assert.ok(sent.at(-1).vocabulary.includes('Smooth or blend'),'Whisper is told the names in the menus');
    await until(()=>editor.vr.state.watch.menu==='style');
    await until(()=>editor.vr.state.watch.menu==='annotate');   // "Back": one ring up
    // "Measure tool": with the menu open it is the Tools ring's Measure, which closes the menu.
    await until(()=>editor.link.state.settings.tool==='measure');
    await until(()=>editor.vr.state.watch.menu===null);
    // "Submit" asks first; "Not yet" closes it, sending nothing.
    const requests=await page.evaluate(()=>editor.link.state.requests.length);
    await until(()=>editor.vr.state.watch.menu==='send');
    await until(()=>editor.vr.state.watch.menu===null);
    assert.equal(await page.evaluate(()=>editor.link.state.requests.length),requests,'Nothing is sent without Yes');
    // "Take a note": the keyboard opens and listens; Stop sends the recording, and the words fill the note.
    await until(()=>editor.vr.state.watch.keyboard==='description'&&editor.vr.state.watch.voice==='listening');
    assert.equal((await page.evaluate(()=>editor.vr.state.commands.paused)),true,'Commands pause while dictating');
    await page.waitForTimeout(900);
    await page.evaluate(()=>{const p=editor.vr.regionPoint('key:voice');xrDevice.controllers.right.position.set(p[0],p[1],p[2]+.06);});
    await until(()=>editor.vr.state.watch.text==='Round the rim by 2 mm.');
    assert.equal(sent.find(body=>body.purpose==='note').rate,16000);
    assert.deepEqual(errors,[],`No page errors: ${errors.join('; ')}`);
    console.log('VR voice commands, options from any ring, confirmation before sending, and dictation passed.');
  } finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
