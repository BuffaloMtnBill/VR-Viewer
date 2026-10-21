// Voice commands in VR: the microphone stays open, and the headset itself finds where speech starts and stops (by
// loudness against the room's background), so only short bits of speech go to the computer to be transcribed; the
// words are then matched against the commands. Nothing is sent while you are quiet, and nothing is saved.

const RATE=16000,CHUNK=1024;                       // 64 ms chunks
const START_CHUNKS=2,END_MS=700,MIN_MS=350,MAX_MS=3500,PREROLL=5;

// Lowercase words and digits only, so "Open menu." and "open the menu" both match; number words become digits and
// "16:9", "16 by 9", and "sixteen to nine" all read "16 by 9".
const NUMBERS=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen'];
export function words(text) {
  let out=` ${String(text).toLowerCase().replace(/(\d)\s*[:x×]\s*(\d)/g,'$1 by $2').replace(/[^a-z0-9\s]/g,' ')} `;
  NUMBERS.forEach((word,n)=>{out=out.replace(new RegExp(`\\b${word}\\b`,'g'),String(n));});
  return out.replace(/(\d) (?:to|x) (\d)/g,'$1 by $2').replace(/\s+/g,' ').trim();
}
// The option whose name was said (its label, or one of its spoken names); the longest name heard wins, so "plus ten"
// beats "plus". Labels shorter than three letters (like "AT") are only heard by their spoken names.
export function matchOption(text,options) {
  const heard=` ${words(text)} `;let best=null,bestLength=0;
  for(const option of options) {
    const label=words(option.label),names=[...(label.replace(/\s/g,'').length>=3?[label]:[]),...(option.aliases||[]).map(words)];
    for(const name of names)if(name&&heard.includes(` ${name} `)&&name.length>bestLength){best=option;bestLength=name.length;}
  }
  return best;
}
// Said at any time in VR. "Open parts" (and "open files", "open settings", …) opens the watch's menu at that ring;
// `menu` is the name heard. "Open menu" is matched first, so "open the menu" never reads as a menu named "the".
export const COMMANDS=[
  {name:'open-menu',label:'Open menu',pattern:/\b(open|show)( the)? menu\b/},
  {name:'open-named',label:'Open files',pattern:/\b(?:open|show|browse)(?: the)? (parts|files|file browser|browser|settings|backgrounds?)\b|\b(browse) files\b/},
  {name:'reset',label:'Reset view',pattern:/\breset( the)? view\b/},
  {name:'stats',label:'Show stats',pattern:/\b(?:(show|hide)(?: me)?(?: the)?(?: part)? )?(?:part )?(?:stats|statistics|info|details)\b/},
  {name:'unselect',label:'Unselect',pattern:/\b(unselect|deselect)( it| this| the part)?\b|\bclear( the)? selection\b|\bselect nothing\b/},
  {name:'paint',label:'Make it blue',pattern:/\b(?:make|paint|color|colour) (?:it|this|the part) (gray|grey|red|orange|yellow|green|blue)\b/},
  {name:'part-color',label:'Change color',pattern:/\b(change|set)( the)?( part)? colou?r\b|\bpart colou?r\b/},
  {name:'view-part',label:'View part',pattern:/^view( it| this| that)?$|\bview( this| the| that)? (part|object)\b|\bshow( it| this| this part| the part)? (alone|on its own)\b/},
  {name:'scene',label:'Back to scene',pattern:/\bback to( the)? scene\b|\bshow( me)?( the)?( whole)? scene\b/},
  {name:'exit',label:'Exit program',pattern:/\b(exit|quit|close)( the)? (program|vr)\b/},
];
const MENU_WORDS={'file browser':'files',browser:'files',browse:'files',backgrounds:'background'};
export function matchCommand(text) {
  const heard=words(text);
  for(const command of COMMANDS){const found=heard.match(command.pattern);if(!found)continue;
    const menu=command.name==='open-named'?found[1]||found[2]:null;
    return {...command,menu:menu?MENU_WORDS[menu]||menu:null,
      show:command.name==='stats'&&found[1]?found[1]==='show':null,color:command.name==='paint'?found[1]:null};}
  return null;
}

// Linear resampling, for browsers that will not record at 16 kHz themselves.
export function resample(samples,from) {
  if(from===RATE)return samples;
  const out=new Float32Array(Math.floor(samples.length*RATE/from));
  for(let i=0;i<out.length;i++){const x=i*from/RATE,j=Math.floor(x),f=x-j;out[i]=samples[j]*(1-f)+(samples[j+1]??samples[j])*f;}
  return out;
}
// 16-bit samples, base64-encoded, as the computer expects them.
export function toBase64(samples) {
  const pcm=new Int16Array(samples.length);
  for(let i=0;i<samples.length;i++)pcm[i]=Math.max(-32768,Math.min(32767,Math.round(samples[i]*32767)));
  const bytes=new Uint8Array(pcm.buffer);let text='';
  for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(text);
}

export function createCommands({api,onHeard,onError,vocabulary=()=>[]}) {
  let stream=null,context=null,processor=null,state='off',paused=false,busy=false;
  let floor=.003,loud=0,quiet=0,speech=null,recent=[],lastHeard='';
  function chunk(samples,rate) {
    let sum=0;for(const s of samples)sum+=s*s;
    const level=Math.sqrt(sum/samples.length),threshold=Math.max(floor*3.5,.012),ms=samples.length/rate*1000;
    // The background level follows the room slowly, and only while nobody is speaking.
    if(!speech)floor=floor*.95+Math.min(level,floor*4)*.05;
    if(paused||busy){speech=null;loud=0;recent=[];return;}
    if(!speech) {
      recent.push(samples);if(recent.length>PREROLL)recent.shift();
      loud=level>threshold?loud+1:0;
      if(loud>=START_CHUNKS){speech={parts:[...recent],ms:recent.length*ms};recent=[];quiet=0;}
      return;
    }
    speech.parts.push(samples);speech.ms+=ms;
    quiet=level>threshold?0:quiet+ms;
    if(quiet>=END_MS||speech.ms>=MAX_MS){const done=speech;speech=null;loud=0;if(done.ms-quiet>=MIN_MS)send(done,rate);}
  }
  async function send(segment,rate) {
    busy=true;
    const length=segment.parts.reduce((sum,part)=>sum+part.length,0),all=new Float32Array(length);
    let offset=0;for(const part of segment.parts){all.set(part,offset);offset+=part.length;}
    try {
      const result=await api('/api/transcribe',{rate:RATE,purpose:'command',vocabulary:vocabulary().slice(0,40),samples:toBase64(resample(all,rate))});
      lastHeard=result.text||'';
      if(lastHeard)onHeard(lastHeard);
    } catch{/* A missed word is not worth interrupting for; the next one is tried as usual. */}
    finally{busy=false;}
  }
  async function start() {
    if(state!=='off')return;
    if(!navigator.mediaDevices?.getUserMedia){onError?.('Voice commands need the microphone, which needs the secure https page.');return;}
    state='starting';
    try {
      stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(state!=='starting'){stream.getTracks().forEach(track=>track.stop());return;}   // switched off meanwhile
      try{context=new AudioContext({sampleRate:RATE});}catch{context=new AudioContext();}
      const source=context.createMediaStreamSource(stream),rate=context.sampleRate;
      processor=context.createScriptProcessor(CHUNK,1,1);
      processor.onaudioprocess=event=>chunk(new Float32Array(event.inputBuffer.getChannelData(0)),rate);
      source.connect(processor);processor.connect(context.destination);
      state='listening';
    } catch(error) {
      stop();
      onError?.(error?.name==='NotAllowedError'?'Voice commands need the microphone: allow it for this page.':`The microphone could not start: ${error.message}`);
    }
  }
  function stop() {
    processor?.disconnect();stream?.getTracks().forEach(track=>track.stop());context?.close().catch(()=>{});
    processor=null;stream=null;context=null;speech=null;recent=[];state='off';
  }
  return {start,stop,
    set paused(value){paused=Boolean(value);},
    get state(){return {state,paused,busy,heard:lastHeard,speaking:Boolean(speech)};}};
}
