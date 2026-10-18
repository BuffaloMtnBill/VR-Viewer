// Voice commands in VR: the microphone stays open, and the headset itself finds where speech starts and stops (by
// loudness against the room's background), so only short bits of speech go to the computer to be transcribed; the
// words are then matched against the commands. Nothing is sent while you are quiet, and nothing is saved.
import {resample,toBase64} from './vr-voice.js';

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
// Said at any time in VR. "Open tools" (and "show style", "open settings", …) opens the watch's menu at that ring;
// `menu` is the name heard. "Open menu" is matched first, so "open the menu" never reads as a menu named "the". A tool
// is named in full ("spray paint", "pin a note") or with "tool" ("measure tool"), so a passing word does not switch it.
export const COMMANDS=[
  {name:'open-menu',label:'Open menu',pattern:/\b(open|show)( the)? menu\b/},
  {name:'open-named',label:'Open tools',pattern:/\b(?:open|show)(?: the)? (parts|tools|style|mark style|settings|backgrounds?)\b/},
  {name:'tool',label:'Spray paint',pattern:/\b(spray|region|box|pin|measure|erase|eraser)( paint)? tool\b|\b(spray paint|3d region|pin a note|erase mark)\b/},
  {name:'note',label:'Take a note',pattern:/\b(take|write)( a)? note\b|\bdictate\b/},
  {name:'undo',label:'Undo',pattern:/\bundo( the)?( last)?( mark)?\b/},
  {name:'submit',label:'Submit edit',pattern:/\bsubmit( the)?( edit| request| it)?\b/},
  {name:'inspect',label:'Inspect mode',pattern:/\b(inspect|move) mode\b|\bswitch to inspect\b/},
  {name:'annotate',label:'Annotate mode',pattern:/\bannotate mode\b|\bswitch to annotate\b|\bstart annotating\b/},
  {name:'reset',label:'Reset view',pattern:/\breset( the)? view\b/},
  {name:'edit-part',label:'Edit part',pattern:/\bedit( this| the| that)? (part|object)\b/},
  {name:'scene',label:'Back to scene',pattern:/\bback to( the)? scene\b|\bshow( me)?( the)?( whole)? scene\b/},
  {name:'exit',label:'Exit program',pattern:/\b(exit|quit|close)( the)? (program|vr)\b/},
];
const TOOL_WORDS={spray:'spray','spray paint':'spray',region:'box',box:'box','3d region':'box',pin:'pin','pin a note':'pin',measure:'measure',erase:'erase',eraser:'erase','erase mark':'erase'};
export function matchCommand(text) {
  const heard=words(text);
  for(const command of COMMANDS){const found=heard.match(command.pattern);if(!found)continue;
    return {...command,menu:command.name==='open-named'?found[1]:null,tool:command.name==='tool'?TOOL_WORDS[found[1]||found[3]]:null};}
  return null;
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
