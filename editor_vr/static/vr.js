// VR for the shared workspace (WebXR, e.g. a Meta Quest on the LAN), with hands or controllers. The scene comes first:
// point a laser at a part and pinch (or pull the trigger) to select it; pinch and drag (or make a fist, or hold the
// grip button) to move the whole scene. Edit part shows the selected part alone, in two modes. Inspect: grip it (a
// pinch or a fist; a controller's trigger or grip button) to move and turn it, and with both hands to scale it.
// Annotate: a laser from each hand marks it with the chosen tool (a pinch, or the trigger); a fist (or the grip
// button) still moves it. The interface is tapped with a fingertip: the watch on the left wrist
// opens the menus, and the button on the right wrist switches to Annotate, then submits. Voice commands run
// throughout. The model's placement is shared with every device; the view (and the room around it) is your own.
import * as THREE from 'three';
import {createHandSkin} from './vr-hands.js';
import {createAnnotate} from './vr-annotate.js';
import {createWatch} from './vr-watch.js';
import {COMMANDS,createCommands,matchCommand,matchOption} from './vr-commands.js';
import {TOOL_NAMES} from './tools.js';

const PINCH={press:.018,release:.025};   // thumb-to-index distance (m) that starts and ends a pinch
const TIP=new THREE.Vector3(0,0,-.06);   // a controller taps with a small dot this far in front of it
// The room around the model: the studio the desktop page shows, or a 360° sky.
export const BACKGROUNDS=[{key:'studio',label:'Studio'},{key:'forest',label:'Mellow forest'},{key:'desert',label:'Sandy desert'},{key:'lake',label:'Moonlit lake'}];

let instance=null;
// The VR controller for this page, for the browser tests.
export const currentVR=()=>instance;

export function createVR(viewer,link,tools,ctx) {
  const {renderer,scene}=viewer;
  const camera=new THREE.PerspectiveCamera(70,1,.01,30);scene.add(camera);viewer.xrCamera=camera;
  let session=null,grab=null,lastTransform=0,voiceOn=true,modeOverride=null;

  // ---------- the room around the model ----------
  const studio={background:scene.background,fog:scene.fog,grid:scene.children.find(child=>child.type==='GridHelper')};
  let backdrop='studio';
  try{if(BACKGROUNDS.some(b=>b.key===localStorage.getItem('editor-vr-background')))backdrop=localStorage.getItem('editor-vr-background');}catch{/* Storage is optional. */}
  const skies={};
  function sky(key) {
    if(!skies[key]){skies[key]=new THREE.TextureLoader().load(`/static/backgrounds/${key}.jpg`);skies[key].mapping=THREE.EquirectangularReflectionMapping;skies[key].colorSpace=THREE.SRGBColorSpace;}
    return skies[key];
  }
  function showBackdrop() {
    const room=session&&backdrop!=='studio';
    scene.background=room?sky(backdrop):studio.background;scene.fog=room?null:studio.fog;
    if(studio.grid)studio.grid.visible=!room;
  }
  function setBackdrop(key) {
    if(!BACKGROUNDS.some(b=>b.key===key))return;
    backdrop=key;showBackdrop();
    try{localStorage.setItem('editor-vr-background',key);}catch{/* Storage is optional. */}
  }

  // ---------- the stage (the scene, or one part) and the mode ----------
  // Both are shared; a change shows at once here, before the server confirms it.
  let stageOverride=null;
  const stage=()=>stageOverride&&performance.now()<stageOverride.until?stageOverride.stage:link.state?.stage||'scene';
  function setStage(next,objectId) {
    if(next===stage()&&!objectId)return;
    stageOverride={stage:next,until:performance.now()+1500};release();
    link.action({type:'stage',stage:next,...(objectId?{object_id:objectId}:{})}).catch(error=>watch?.say(error.message));
    if(next==='scene')watch?.say('The scene · point at a part and pinch to select it');
  }
  function select(objectId){link.action({type:'select',object_id:objectId}).catch(()=>{});}
  const mode=()=>modeOverride&&performance.now()<modeOverride.until?modeOverride.mode:link.state?.settings.mode||'inspect';
  function setMode(next) {
    if(next===mode())return;
    modeOverride={mode:next,until:performance.now()+1500};
    release();ctx.settings({mode:next});
    watch?.say(next==='edit'?`Annotate · ${TOOL_NAMES[link.state.settings.tool]}`:'Inspect · grip the model to move it');
  }

  // ---------- controllers and hands ----------
  const hands=[0,1].map(index=>{
    const controller=renderer.xr.getController(index),grip=renderer.xr.getControllerGrip(index),xrHand=renderer.xr.getHand(index);
    const dot=new THREE.Mesh(new THREE.SphereGeometry(.007,12,8),new THREE.MeshBasicMaterial({color:0xffb86b,depthTest:false}));
    dot.renderOrder=1001;dot.position.copy(TIP);controller.add(dot);
    const body=new THREE.Mesh(new THREE.CylinderGeometry(.017,.022,.11,16),new THREE.MeshStandardMaterial({color:0x8c9eae,roughness:.5}));
    body.rotation.x=Math.PI/2.6;body.position.set(0,-.01,.03);grip.add(body);
    const hand={index,controller,grip,xrHand,skin:createHandSkin(xrHand),dot,source:null,held:false,fist:false,pinch:false,mode:null,
      point:new THREE.Vector3(),rotation:new THREE.Quaternion(),tracked:false,gripStart:null};
    controller.addEventListener('connected',event=>{hand.source=event.data;});
    controller.addEventListener('disconnected',()=>{hand.source=null;hand.held=false;if(hand.mode==='paint')annotate.cancel();hand.mode=null;rebase();});
    scene.add(controller,grip,xrHand);
    return hand;
  });
  const jointMaterial=new THREE.MeshStandardMaterial({color:0xb3d5e4,roughness:.7}),jointGeometry=new THREE.SphereGeometry(1,10,8);
  const joint=(hand,name)=>{const j=hand.xrHand.joints?.[name];return j&&j.visible!==false?j:null;};
  // Joint dots until the hand model loads (or if it cannot).
  function dressJoints(hand,shown) {
    for(const j of Object.values(hand.xrHand.joints||{})) {
      if(!j.userData.dot&&shown){const dot=new THREE.Mesh(jointGeometry,jointMaterial);dot.scale.setScalar(Math.max(j.jointRadius||.008,.006)*.9);j.add(dot);j.userData.dot=dot;}
      if(j.userData.dot)j.userData.dot.visible=shown;
    }
  }
  // A pinch: thumb and index tips together, with a little hysteresis. The fingertips decide whenever they are tracked
  // (the system's own pinch signal lingers after the fingers open); it is used only when the joints are not available.
  function pinching(hand) {
    const thumb=joint(hand,'thumb-tip'),index=joint(hand,'index-finger-tip');
    if(!thumb||!index)return Boolean(hand.source?.gamepad?.buttons[0]?.pressed);
    return thumb.position.distanceTo(index.position)<(hand.pinch?PINCH.release:PINCH.press);
  }
  // A fist: index, middle, and ring fingertips curled in to the wrist (an index finger held out to tap is no fist).
  function fist(hand) {
    const wrist=joint(hand,'wrist');if(!wrist)return false;
    const reach=name=>joint(hand,`${name}-finger-tip`)?.position.distanceTo(wrist.position)??1;
    return ['index','middle','ring'].every(name=>reach(name)<(hand.fist?.13:.11));
  }
  // What a hand is asking for: to grip the model, or to mark it. Inspect grips with any pinch, fist, trigger, or grip
  // button; Annotate marks with a pinch (or the trigger) and grips with a fist (or the grip button).
  function intent(hand) {
    const buttons=hand.source?.gamepad?.buttons||[];
    if(hand.tracked){hand.fist=fist(hand);hand.pinch=!hand.fist&&pinching(hand);}
    const trigger=hand.tracked?hand.pinch:Boolean(buttons[0]?.pressed),squeeze=hand.tracked?hand.fist:Boolean(buttons[1]?.pressed);
    if(stage()==='scene')return {grip:squeeze,pick:trigger&&!squeeze,mark:false};
    return mode()==='edit'?{grip:squeeze,mark:trigger&&!squeeze}:{grip:trigger||squeeze,mark:false};
  }
  // Where a hand holds: between thumb and index tips (following the wrist once gripped, so opening the fingers to let
  // go never moves the model), or the controller itself; and how it is turned.
  function handPoint(hand) {
    const thumb=joint(hand,'thumb-tip'),index=joint(hand,'index-finger-tip'),wrist=joint(hand,'wrist');
    if(hand.tracked&&thumb&&index) {
      if(hand.gripStart&&wrist)hand.point.copy(hand.gripStart.pinch).add(wrist.position).sub(hand.gripStart.wrist);
      else hand.point.copy(thumb.position).add(index.position).multiplyScalar(.5);
      if(wrist)hand.rotation.copy(wrist.quaternion);
    } else {
      hand.controller.getWorldPosition(hand.point);hand.controller.getWorldQuaternion(hand.rotation);
    }
    return hand.point;
  }
  // The point a hand taps with: the index fingertip, or the dot in front of a controller.
  function fingertipOf(hand) {
    if(hand.tracked)return joint(hand,'index-finger-tip')?.position||null;
    hand.controller.updateMatrixWorld();
    return hand.controller.localToWorld(TIP.clone());
  }

  // ---------- gripping: one hand moves and turns the model, two also scale it ----------
  function rebase() {
    const holding=hands.filter(h=>h.mode==='grab');
    viewer.localBusy=holding.length>0;
    grab=holding.length?{hands:holding,points:holding.map(h=>h.point.clone()),rotations:holding.map(h=>h.rotation.clone()),
      position:viewer.pivot.position.clone(),quaternion:viewer.pivot.quaternion.clone(),scale:viewer.pivot.scale.x}:null;
  }
  function moveGrab() {
    if(!grab)return;
    const g=grab,q=new THREE.Quaternion();let anchor=g.points[0],current=g.hands[0].point,ratio=1;
    if(g.hands.length===1)q.copy(g.hands[0].rotation).multiply(g.rotations[0].clone().invert());
    else {
      const start=g.points[1].clone().sub(g.points[0]),end=g.hands[1].point.clone().sub(g.hands[0].point);
      if(start.length()<.025||end.length()<.025)return;
      const scale=THREE.MathUtils.clamp(g.scale*end.length()/start.length(),.00001,1);ratio=scale/g.scale;
      q.setFromUnitVectors(start.normalize(),end.normalize());
      anchor=g.points[0].clone().add(g.points[1]).multiplyScalar(.5);current=g.hands[0].point.clone().add(g.hands[1].point).multiplyScalar(.5);
    }
    viewer.pivot.position.copy(g.position).sub(anchor).multiplyScalar(ratio).applyQuaternion(q).add(current);
    viewer.pivot.quaternion.copy(q).multiply(g.quaternion);viewer.pivot.scale.setScalar(g.scale*ratio);viewer.pivot.updateMatrixWorld(true);
  }
  function publishTransform(force=false) {
    const now=performance.now();if(!force&&now-lastTransform<120)return;lastTransform=now;
    link.action({type:'transform',transform:viewer.currentTransform()}).catch(()=>{});
  }
  // Let go of everything: a menu opened, the mode changed, or the model changed.
  function release() {
    const moved=hands.some(h=>h.mode==='grab');
    hands.forEach(hand=>{if(hand.mode==='paint')annotate.cancel();hand.mode=null;hand.gripStart=null;});
    rebase();if(moved)publishTransform(true);
  }

  // ---------- per frame ----------
  function updateHand(hand) {
    hand.tracked=Boolean(hand.source?.hand);
    hand.grip.visible=Boolean(hand.source)&&!hand.tracked;hand.dot.visible=Boolean(hand.source)&&!hand.tracked;
    if(!hand.source){annotate.aim(hand,false);return;}
    // Tapping the watch, its menus, the keyboard, and the wrist button: fingertips only.
    const ui=watch.pointer(hand,{fingertip:fingertipOf(hand)}),want=intent(hand),pressed=want.grip||want.mark||want.pick;
    const other=hands.find(h=>h!==hand),inScene=stage()==='scene';
    annotate.aim(hand,(inScene||mode()==='edit')&&!ui.onUI&&!watch.busy&&hand.mode!=='grab',inScene?'#6be0d4':null);
    if(pressed&&!hand.held) {
      const wrist=hand.tracked&&joint(hand,'wrist');
      if(ui.onUI||watch.busy)hand.mode='ui';   // a hand at the interface (or with a menu up) never grips or marks
      else if(other.mode==='grab'||other.mode==='paint') {
        // A second hand joins in: the two grip together (an unfinished stroke is dropped).
        if(other.mode==='paint')annotate.cancel();
        hand.mode='grab';other.mode='grab';hand.gripStart=wrist?{pinch:handPoint(hand).clone(),wrist:wrist.position.clone()}:null;rebase();
      } else if(want.pick&&hand.hit?.objectId) {
        // A pinch on a part picks it when let go; moved first, it grips the scene instead.
        hand.mode='pick';hand.pick={objectId:hand.hit.objectId,from:handPoint(hand).clone()};
      } else if(want.grip||want.pick) {
        handPoint(hand);hand.gripStart=wrist?{pinch:hand.point.clone(),wrist:wrist.position.clone()}:null;
        hand.mode='grab';rebase();
      } else hand.mode=annotate.begin(hand)||'tool';
    } else if(pressed&&hand.mode==='paint')annotate.move(hand);
    else if(pressed&&hand.mode==='pick'&&handPoint(hand).distanceTo(hand.pick.from)>.025) {
      const wrist=hand.tracked&&joint(hand,'wrist');
      hand.mode='grab';hand.gripStart=wrist?{pinch:hand.point.clone(),wrist:wrist.position.clone()}:null;rebase();
    } else if(!pressed&&hand.held) {
      const was=hand.mode;hand.mode=null;hand.gripStart=null;
      if(was==='pick'){select(hand.pick.objectId);const item=link.state.scene.objects.find(o=>o.id===hand.pick.objectId);if(item)watch.say(`${item.name} · Edit ▸ on your right wrist`);}
      if(was==='paint')annotate.end();
      if(was==='grab'){publishTransform(true);rebase();}
    }
    hand.held=pressed;
    handPoint(hand);
    if(hand.tracked)dressJoints(hand,!hand.skin.update(hand.held));
    hand.dot.material.color.set(hand.uiHover?0xffffff:hand.mode==='grab'?0x6be0d4:0xffb86b);
  }
  function update(time,frame) {
    if(!session||!frame)return;
    commands.paused=watch.searching;   // dictation is not a command
    if(modeOverride&&link.state?.settings.mode===modeOverride.mode)modeOverride=null;
    if(stageOverride&&link.state?.stage===stageOverride.stage)stageOverride=null;
    hands.forEach(updateHand);
    // A menu opened while the model was held: let go of it there.
    if(watch.busy&&hands.some(h=>h.mode==='grab'||h.mode==='paint'))release();
    watch.update();
    if(grab){moveGrab();publishTransform();}
  }

  // ---------- voice commands ----------
  const annotate=createAnnotate({scene,viewer,tools,link});
  const api=(url,payload)=>link.request(url,payload);
  let watch=null;
  // With a menu open, any option on show can be said ("Pin a note", "plus", "Back"), and so can any option elsewhere
  // in this mode's menus: the menu moves to it. What is on show wins a tie. Whisper is told which names to expect.
  const commands=createCommands({api,
    vocabulary:()=>[...new Set([...watch.voiceOptions(),...COMMANDS,...watch.voiceOptions(true)].map(option=>option.label))],
    onHeard:text=>{
      if(!session)return;
      const option=watch.busy?matchOption(text,watch.voiceOptions())||matchOption(text,watch.voiceOptions(true)):null;
      if(option){option.press();watch.say(`🎤 ${option.label}`);return;}
      const command=matchCommand(text);
      if(!command)return;
      if(command.name==='open-menu'){watch.openMenu();watch.say('🎤 Open menu');}
      else if(command.name==='open-named'){watch.say(watch.openNamed(command.menu)?`🎤 Open ${command.menu}`:`🎤 No ${command.menu} here`);}
      else if(command.name==='tool'){if(stage()==='scene'){watch.say('🎤 Edit a part first');return;}ctx.settings({tool:command.tool,mode:'edit'});modeOverride={mode:'edit',until:performance.now()+1500};watch.say(`🎤 ${TOOL_NAMES[command.tool]}`);}
      else if(command.name==='note'){watch.dictate();watch.say('🎤 Say the change, then tap Stop');}
      else if(command.name==='undo'){ctx.undo();watch.say('🎤 Undo');}
      else if(command.name==='submit'){if(stage()==='scene'){watch.say('🎤 Edit a part first');return;}watch.confirmSend();watch.say('🎤 Send to the desktop?');}
      else if(command.name==='inspect'){if(stage()==='scene')watch.editPart();setMode('inspect');}
      else if(command.name==='annotate'){if(stage()==='scene')watch.editPart();setMode('edit');}
      else if(command.name==='edit-part')watch.editPart();
      else if(command.name==='scene'){if(stage()==='scene')watch.say('🎤 Already the whole scene');else setStage('scene');}
      else if(command.name==='reset'){ctx.fit();watch.say('🎤 Reset view');}
      else if(command.name==='exit'){watch.say('🎤 Exit');session.end();}
    },
    onError:message=>watch?.say(`🎤 ${message}`)});
  watch=createWatch({scene,camera:()=>camera,joint,hands,link,mode,setMode,stage,setStage,select,api,
    exit:()=>session?.end(),submit:()=>ctx.submit(),undo:()=>ctx.undo(),fit:()=>ctx.fit(),
    backgrounds:{list:BACKGROUNDS,get current(){return backdrop;},set:setBackdrop},
    voiceCommands:{get on(){return voiceOn;},toggle(){voiceOn=!voiceOn;if(voiceOn&&session)commands.start();else commands.stop();}}});

  // ---------- session ----------
  async function enter() {
    if(session)return;
    if(!link.state||!viewer.mesh){ctx.notify('Wait for the model to finish loading.');return;}
    try {
      if(!window.isSecureContext||!navigator.xr)throw new Error('Use the HTTPS headset address shown in Connect headset. WebXR needs a secure page.');
      session=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor','bounded-floor','hand-tracking']});
      renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local-floor');
      session.addEventListener('end',()=>{
        release();watch.close();commands.stop();annotate.hideAll();
        session=null;showBackdrop();renderer.xr.enabled=false;viewer.resize();ctx.presenting(false);
        hands.forEach(hand=>{hand.held=false;hand.mode=null;});
      });
      // Taking the headset off hides the session; on return, catch up with the workspace at once.
      session.addEventListener('visibilitychange',()=>{if(session?.visibilityState==='visible')link.refresh();});
      await renderer.xr.setSession(session);
      showBackdrop();ctx.presenting(true);
      if(voiceOn)commands.start();
      watch.say('Tap the watch on your left wrist for the menu');
    } catch(error){if(session){session.end().catch(()=>{});session=null;}ctx.notify(error.message,true);}
  }
  async function attachButton(button) {
    let supported=false;
    try{supported=await navigator.xr?.isSessionSupported('immersive-vr');}catch{/* Desktop remains available. */}
    button.disabled=!supported;
    button.title=supported?'Enter the shared workspace in VR':'Open the HTTPS address in Quest Browser to enter VR';
    button.addEventListener('click',()=>enter());
  }

  instance={update,attachButton,enter,setMode,
    exit:()=>session?.end(),
    notify(message){if(session)watch.say(message);},
    // The model changed under the hands: drop what they were doing.
    cancelInteraction(){tools.cancel();release();},
    regionPoint:id=>watch.regionPoint(id),
    get presenting(){return Boolean(session);},
    get session(){return session;},
    get hands(){return hands;},
    get state(){return {presenting:Boolean(session),stage:stage(),selected:link.state?.selected||null,mode:mode(),background:backdrop,
      backgroundShown:scene.background?.isTexture?scene.background.image?.src?.split('/').pop()||backdrop:'studio',
      transform:viewer.currentTransform(),watch:watch.state,lasers:annotate.state,commands:{...commands.state,on:voiceOn},
      hands:hands.map(hand=>({side:hand.source?.handedness||null,tracked:hand.tracked,model:hand.skin.ready,held:hand.held,mode:hand.mode,
        touching:Boolean(hand.poking),presses:hand.presses||0,over:hand.uiHover||null,point:hand.point.toArray(),indexTip:joint(hand,'index-finger-tip')?.position.toArray()||null}))};}};
  return instance;
}
