/* Run a default HTTPS server and set VR_VIEWER_LAN_URL to its printed LAN address. */
const {chromium}=require(process.env.VR_VIEWER_PLAYWRIGHT||'playwright-core');
const assert=require('node:assert/strict');
const desktopURL=process.env.VR_VIEWER_HTTPS_URL||'https://localhost:8022';
const lanURL=process.env.VR_VIEWER_LAN_URL;
if(!lanURL)throw new Error('Set VR_VIEWER_LAN_URL to the HTTPS server LAN address.');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.VR_VIEWER_CHROMIUM||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 const local=await browser.newContext({ignoreHTTPSErrors:true}),remote=await browser.newContext({ignoreHTTPSErrors:true});
 const desktop=await local.newPage(),headset=await remote.newPage(),errors=[];
 for(const page of [desktop,headset])page.on('pageerror',e=>errors.push(e.message));
 await desktop.goto(desktopURL);await desktop.waitForFunction(()=>viewerApp?.ready);
 const pin=await desktop.locator('.pin-display strong').textContent();assert.match(pin,/^\d{6}$/);
 await headset.goto(lanURL);assert.ok(new URL(headset.url()).pathname==='/pair');
 await headset.locator('#pair-pin').fill(pin);await headset.locator('#pair-form button').click();
 await headset.waitForFunction(()=>window.viewerApp?.ready);await headset.waitForFunction(()=>document.getElementById('connection-state').textContent==='Live sync');
 assert.equal(await headset.evaluate(()=>window.isSecureContext),true);
 assert.equal(await headset.locator('.pin-display').count(),0,'Only the computer may display the pairing PIN');
 const part=await headset.evaluate(()=>viewerApp.link.state.scene.objects[0].id);await headset.evaluate(id=>viewerApp.link.action({type:'select',object_id:id}),part);await desktop.waitForFunction(id=>viewerApp.link.state.selected===id,part);
 await headset.reload();await headset.waitForFunction(()=>window.viewerApp?.ready);
 assert.equal(new URL(headset.url()).pathname,'/','Pairing cookie survives reload');
 assert.deepEqual(errors,[]);console.log('HTTPS, real LAN pairing, secure cookies, WSS synchronization, and PIN privacy passed.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
