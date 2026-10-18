/* Run a default HTTPS server and set EDITOR_VR_LAN_URL to its printed LAN address. */
const {chromium}=require(process.env.EDITOR_VR_PLAYWRIGHT||'playwright-core');
const assert=require('node:assert/strict');
const desktopURL=process.env.EDITOR_VR_HTTPS_URL||'https://localhost:8022';
const lanURL=process.env.EDITOR_VR_LAN_URL;
if(!lanURL)throw new Error('Set EDITOR_VR_LAN_URL to the HTTPS server LAN address.');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.EDITOR_VR_CHROMIUM||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 const local=await browser.newContext({ignoreHTTPSErrors:true}),remote=await browser.newContext({ignoreHTTPSErrors:true});
 const desktop=await local.newPage(),headset=await remote.newPage(),errors=[];
 for(const page of [desktop,headset])page.on('pageerror',e=>errors.push(e.message));
 await desktop.goto(desktopURL);await desktop.waitForFunction(()=>editor?.ready);
 const pin=await desktop.locator('.pin-display strong').textContent();assert.match(pin,/^\d{6}$/);
 await headset.goto(lanURL);assert.ok(new URL(headset.url()).pathname==='/pair');
 await headset.locator('#pair-pin').fill(pin);await headset.locator('#pair-form button').click();
 await headset.waitForFunction(()=>window.editor?.ready);await headset.waitForFunction(()=>document.getElementById('connection-state').textContent==='Live sync');
 assert.equal(await headset.evaluate(()=>window.isSecureContext),true);
 assert.equal(await headset.locator('.pin-display').count(),0,'Only the computer may display the pairing PIN');
 await headset.locator('#meaning').fill('Secure LAN link verified');await desktop.waitForFunction(()=>document.getElementById('meaning').value==='Secure LAN link verified');
 await headset.reload();await headset.waitForFunction(()=>window.editor?.ready);
 assert.equal(new URL(headset.url()).pathname,'/','Pairing cookie survives reload');
 assert.deepEqual(errors,[]);console.log('HTTPS, real LAN pairing, secure cookies, WSS synchronization, and PIN privacy passed.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
