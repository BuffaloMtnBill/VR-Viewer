/* Runs the browser tests: starts a test server (app.py --local, with a fresh data folder) with the project's Python,
 * runs each tests/*-browser.cjs in turn against it, prints a summary, and stops the server.
 *
 *   npm test                 every browser test
 *   npm test -- vr voice     only tests/vr-browser.cjs and tests/voice-browser.cjs
 *
 * The server's file browser shows a small folder of models made here (VR_VIEWER_FILES tells the tests where).
 * Set up once with `npm install` and `npm run setup` (Playwright's Chromium). VR_VIEWER_CHROMIUM uses another
 * Chromium instead; VR_VIEWER_TEST_PORT another port. tests/https-browser.cjs needs a LAN server and runs only when
 * VR_VIEWER_LAN_URL is set.
 */
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');

const root=path.join(__dirname,'..');
const port=Number(process.env.VR_VIEWER_TEST_PORT||8021);
const url=`http://127.0.0.1:${port}`;
let files=null;

function python() {
  const venv=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  return fs.existsSync(venv)?venv:process.platform==='win32'?'python':'python3';
}
const answers=()=>new Promise(resolve=>{
  const request=http.get(url,response=>{response.resume();resolve(true);});
  request.on('error',()=>resolve(false));request.setTimeout(2000,()=>{request.destroy();resolve(false);});
});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Models for the file browser: Models/Cubes holds an ASCII STL of two named cubes (two parts) and an OBJ tetrahedron.
function cube(name,size,x) {
  const v=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(([a,b,c])=>[a*size+x,b*size,c*size]);
  const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[1,2,6],[1,6,5],[3,0,4],[3,4,7]];
  return `solid ${name}\n${faces.map(f=>`facet normal 0 0 0\nouter loop\n${f.map(i=>`vertex ${v[i].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid ${name}\n`;
}
function makeFiles(folder) {
  const cubes=path.join(folder,'Models','Cubes');fs.mkdirSync(cubes,{recursive:true});fs.mkdirSync(path.join(folder,'Models','Empty'));
  fs.writeFileSync(path.join(cubes,'two-cubes.stl'),cube('Big cube',20,0)+cube('Small cube',10,30));
  fs.writeFileSync(path.join(cubes,'tetra.obj'),'v 0 0 0\nv 20 0 0\nv 0 20 0\nv 0 0 20\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n');
  fs.writeFileSync(path.join(cubes,'readme.txt'),'Not a model');
}

function chosenTests() {
  const all=fs.readdirSync(path.join(root,'tests')).filter(name=>/-?browser\.cjs$/.test(name)).sort()
    .filter(name=>name!=='https-browser.cjs'||process.env.VR_VIEWER_LAN_URL);
  const wanted=process.argv.slice(2);
  if(!wanted.length)return all;
  const picked=all.filter(name=>wanted.some(want=>name===`${want}-browser.cjs`||name===want||(want==='desktop'&&name==='browser.cjs')));
  if(!picked.length){console.error(`No browser test matches ${wanted.join(', ')}. Tests: ${all.join(', ')}`);process.exit(2);}
  return picked;
}

function run(file) {
  return new Promise(resolve=>{
    const started=Date.now(),output=[];
    const child=spawn(process.execPath,[path.join(root,'tests',file)],{cwd:root,env:{...process.env,VR_VIEWER_URL:url,VR_VIEWER_FILES:files}});
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>output.push(chunk));
    child.on('close',code=>resolve({file,code,seconds:(Date.now()-started)/1000,output:Buffer.concat(output).toString()}));
  });
}

(async()=>{
  try{require.resolve('playwright-core');require.resolve('iwer/build/iwer.min.js');}catch{console.error('Run `npm install` and `npm run setup` first.');process.exit(2);}
  const tests=chosenTests();
  if(await answers()){console.error(`Something is already answering on ${url}. Stop it, or set VR_VIEWER_TEST_PORT.`);process.exit(2);}
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'vr-viewer-test-')),data=path.join(scratch,'data');files=path.join(scratch,'files');makeFiles(files);
  console.log(`Starting the test server on ${url} …`);
  const server=spawn(python(),[path.join(root,'app.py'),'--local','--port',String(port),'--no-browser','--data-dir',data,'--root',files],{cwd:root,stdio:['ignore','pipe','pipe']});
  const serverLog=[];for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>serverLog.push(chunk));
  const stop=()=>{if(server.exitCode===null)server.kill();fs.rmSync(scratch,{recursive:true,force:true});};
  process.on('SIGINT',()=>{stop();process.exit(130);});
  try {
    for(let i=0;i<60&&!(await answers());i++){
      if(server.exitCode!==null)throw new Error(`The test server stopped:\n${Buffer.concat(serverLog)}`);
      await pause(500);
    }
    if(!(await answers()))throw new Error('The test server did not start within 30 seconds.');
    const results=[];
    // One at a time: the tests deliberately change the same workspace.
    for(const file of tests) {
      process.stdout.write(`${file.padEnd(24)} `);
      const result=await run(file);results.push(result);
      const lines=result.output.trim().split('\n').filter(line=>!/^\s+at /.test(line)||/tests[\\/][\w-]+\.cjs/.test(line));   // the test's own line
      console.log(`${result.code===0?'passed':'FAILED'}  (${result.seconds.toFixed(0)} s)${result.code===0?'':`\n${lines.slice(0,14).join('\n')}\n`}`);
    }
    const failed=results.filter(result=>result.code!==0);
    console.log(`\n${results.length-failed.length} of ${results.length} browser tests passed.`);
    process.exitCode=failed.length?1:0;
  } catch(error){console.error(error.message);process.exitCode=1;}
  finally{stop();}
})();
