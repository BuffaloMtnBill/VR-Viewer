// VR for the shared workspace (WebXR, e.g. a Meta Quest on the LAN), with hands or controllers. The scene comes first:
// point a laser at a part and pinch (or pull the trigger) to select it. The model (the scene, or the part being
// edited) is handled as in 3D-VR-Terrain's model view:
// - a fist (a controller's grip button) turns it as the fist turns, about its center;
// - a pinch on the model itself (or the trigger, touching it) picks it up and carries it as if in your hand;
// - a pinch anywhere else (the trigger) drags it, and with both hands zooms it and turns it about the vertical.
// In Annotate, a laser from each hand marks the part with the chosen tool (a pinch, or the trigger) and a fist still
// turns it. The interface is tapped with a fingertip: the watch on the left wrist opens the menus, and the button on
// the right wrist switches to Annotate, then submits. Voice commands run throughout. The model's placement is shared
// with every device; the view (and the room around it) is your own.
import * as THREE from 'three';
import {createHandSkin} from './vr-hands.js';
import {createAnnotate} from './vr-annotate.js';
import {createWatch} from './vr-watch.js';
import {COMMANDS,createCommands,matchCommand,matchOption} from './vr-commands.js';
import {TOOL_NAMES} from './tools.js';
import {ENVIRONMENTS,createEnvironments} from './vr-environments.js';

const PINCH={press:.018,release:.025};   // thumb-to-index distance (m) that starts and ends a pinch
const TIP=new THREE.Vector3(0,0,-.06);   // a controller taps with a small dot this far in front of it
const NEAR=.02;   // a pinch within this far (m) of the model's bounds is on it, and picks it up
const PICK=.025;  // a pinch on a part (by laser) that moves further than this (m) drags the scene instead of selecting
// Steadying tracked hands while they hold the model: a One Euro filter (Casiez et al. 2012) smooths the tracking's
// millimeter jitter when the hand is nearly still and follows at once when it moves fast. cutoff in Hz; beta per m/s
// (or per radian/s for a turn).
const STEADY={cutoff:1.5,beta:12,derivative:1};
const Y=new THREE.Vector3(0,1,0);
const smoothing=(cutoff,dt)=>1/(1+1/(2*Math.PI*cutoff*dt));
function steadyPoint() {
  let last=null,speed=0;const value=new THREE.Vector3();
  return {reset(){last=null;},
    filter(raw,dt) {
      if(!last||!(dt>0)){last=value.copy(raw);speed=0;return value;}
      speed+=(raw.distanceTo(value)/dt-speed)*smoothing(STEADY.derivative,dt);
      return value.lerp(raw,smoothing(STEADY.cutoff+STEADY.beta*speed,dt));
    }};
}
function steadyTurn() {
  let last=null,speed=0;const value=new THREE.Quaternion();
  return {reset(){last=null;},
    filter(raw,dt) {
      if(!last||!(dt>0)){last=value.copy(raw);speed=0;return value;}
      speed+=(value.angleTo(raw)/dt-speed)*smoothing(STEADY.derivative,dt);
      return value.slerp(raw,smoothing(STEADY.cutoff+STEADY.beta*speed,dt));
    }};
}

let instance=null;
// The VR controller for this page, for the browser tests.
export const currentVR=()=>instance;

export function createVR(viewer,link,tools,ctx) {
  const {renderer,scene}=viewer;
  const camera=new THREE.PerspectiveCamera(70,1,.01,30);scene.add(camera);viewer.xrCamera=camera;
  let session=null,grab=null,lastTransform=0,lastTime=null,voiceOn=true,modeOverride=null;

  // ---------- the room around the model ----------
  // The room is your own (the desktop keeps the studio); a living one runs on its own day clock.
  const environments=createEnvironments(viewer);
  let backdrop='studio';
  try{if(ENVIRONMENTS.some(e=>e.key===localStorage.getItem('editor-vr-background')))backdrop=localStorage.getItem('editor-vr-background');}catch{/* Storage is optional. */}
  const showBackdrop=()=>environments.show(session?backdrop:'studio');
  function setBackdrop(key) {
    if(!ENVIRONMENTS.some(e=>e.key===key))return;
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
  // Where a part is in the room: its box (for the card above it), or null while it is not shown.
  function partBounds(objectId) {
    const mesh=[...viewer.meshes.values()].find(m=>m.userData.objectId===objectId);
    if(!mesh?.visible)return null;
    viewer.pivot.updateMatrixWorld(true);return new THREE.Box3().setFromObject(mesh);
  }
  const mode=()=>modeOverride&&performance.now()<modeOverride.until?modeOverride.mode:link.state?.settings.mode||'inspect';
  function setMode(next) {
    if(next===mode())return;
    modeOverride={mode:next,until:performance.now()+1500};
    release();ctx.settings({mode:next});
    watch?.say(next==='edit'?`Annotate · ${TOOL_NAMES[link.state.settings.tool]}`:'Inspect · pinch the part to hold it, a fist turns it');
  }

  // ---------- controllers and hands ----------
  const hands=[0,1].map(index=>{
    const controller=renderer.xr.getController(index),grip=renderer.xr.getControllerGrip(index),xrHand=renderer.xr.getHand(index);
    const dot=new THREE.Mesh(new THREE.SphereGeometry(.007,12,8),new THREE.MeshBasicMaterial({color:0xffb86b,depthTest:false}));
    dot.renderOrder=1001;dot.position.copy(TIP);controller.add(dot);
    const body=new THREE.Mesh(new THREE.CylinderGeometry(.017,.022,.11,16),new THREE.MeshStandardMaterial({color:0x8c9eae,roughness:.5}));
    body.rotation.x=Math.PI/2.6;body.position.set(0,-.01,.03);grip.add(body);
    const hand={index,controller,grip,xrHand,skin:createHandSkin(xrHand),dot,source:null,held:false,fist:false,pinch:false,mode:null,
      point:new THREE.Vector3(),rotation:new THREE.Quaternion(),tracked:false,gripStart:null,kind:null,steady:steadyPoint(),steadyTurn:steadyTurn()};
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
  // What a hand is doing: a pinch or a fist (a controller's trigger or grip button), decided as it starts and kept
  // while it is held; null when open. A pinch first: a pinch with the other fingers curled can read as a fist too.
  function gesture(hand) {
    if(hand.tracked) {
      const pinch=pinching(hand),closed=fist(hand);hand.pinch=pinch;hand.fist=closed;
      if(hand.held)return hand.kind==='fist'?closed?'fist':null:pinch||closed?'pinch':null;
      return pinch?'pinch':closed?'fist':null;
    }
    const buttons=hand.source?.gamepad?.buttons||[],trigger=Boolean(buttons[0]?.pressed),squeeze=Boolean(buttons[1]?.pressed);
    if(hand.held&&hand.kind)return (hand.kind==='pinch'?trigger:squeeze)||trigger||squeeze?hand.kind:null;
    return trigger?'pinch':squeeze?'fist':null;
  }
  // Where a hand holds: between thumb and index tips, or the controller itself; and how it is turned. While gripping,
  // a tracked hand's point follows the wrist from where the grip began (opening the fingers to let go never moves the
  // model), and its point and turn are steadied (see STEADY).
  function handPoint(hand,dt=0) {
    const thumb=joint(hand,'thumb-tip'),index=joint(hand,'index-finger-tip'),wrist=joint(hand,'wrist');
    if(hand.tracked&&thumb&&index) {
      if(hand.gripStart&&wrist) {
        hand.point.copy(hand.steady.filter(raw.copy(hand.gripStart.pinch).add(wrist.position).sub(hand.gripStart.wrist),dt));
        hand.rotation.copy(hand.steadyTurn.filter(wrist.quaternion,dt));
      } else {
        hand.point.copy(thumb.position).add(index.position).multiplyScalar(.5);
        if(wrist)hand.rotation.copy(wrist.quaternion);
      }
    } else {
      hand.controller.getWorldPosition(hand.point);hand.controller.getWorldQuaternion(hand.rotation);
    }
    return hand.point;
  }
  const raw=new THREE.Vector3();
  // What a held thing turns about: the wrist (or the controller), so the model turns in the hand as a held thing does.
  const handPivot=(hand,out)=>hand.tracked&&hand.gripStart?out.copy(hand.point).sub(hand.gripStart.pinch).add(hand.gripStart.wrist):out.copy(hand.point);
  function startGrip(hand) {
    const wrist=hand.tracked&&joint(hand,'wrist');
    handPoint(hand);hand.gripStart=wrist?{pinch:hand.point.clone(),wrist:wrist.position.clone()}:null;
    hand.steady.reset();hand.steadyTurn.reset();
  }
  // Whether a point in the room is on the model: within NEAR of what is shown.
  const modelBox=new THREE.Box3();
  function onModel(point) {
    viewer.pivot.updateMatrixWorld(true);modelBox.makeEmpty();
    for(const mesh of viewer.meshes.values())if(mesh.visible)modelBox.expandByObject(mesh);
    return !modelBox.isEmpty()&&modelBox.expandByScalar(NEAR).containsPoint(point);
  }
  // The point a hand taps with: the index fingertip, or the dot in front of a controller.
  function fingertipOf(hand) {
    if(hand.tracked)return joint(hand,'index-finger-tip')?.position||null;
    hand.controller.updateMatrixWorld();
    return hand.controller.localToWorld(TIP.clone());
  }

  // ---------- moving the model (the pivot: its center, turn, and scale in the room) ----------
  // grab: one hand drags it; two zoom it (hands apart zoom in) and turn it about the vertical, the grabbed points
  // staying in your hands. spin: a fist turns it as the fist turns, about its center, which stays put. hold: a pinch
  // on it carries it as a rigid body fixed to the hand, moving and turning with the hand.
  const MOVING=['grab','spin','hold'];
  function rebase() {
    const moving=hands.filter(h=>MOVING.includes(h.mode));
    viewer.localBusy=moving.length>0;
    grab=moving.length?{hands:moving.map(hand=>({hand,mode:hand.mode,point:hand.point.clone(),pivot:handPivot(hand,new THREE.Vector3()),turn:hand.rotation.clone()})),
      position:viewer.pivot.position.clone(),quaternion:viewer.pivot.quaternion.clone(),scale:viewer.pivot.scale.x,yaw:0}:null;
  }
  const turn=new THREE.Quaternion(),yawTurn=new THREE.Quaternion(),now=new THREE.Vector3();
  function moveModel() {
    if(!grab)return;
    const g=grab,pivot=viewer.pivot,grabbing=g.hands.filter(h=>h.hand.mode==='grab');
    if(grabbing.length===2) {
      const [a,b]=grabbing,start=b.point.clone().sub(a.point),end=b.hand.point.clone().sub(a.hand.point);
      if(start.length()<.025||end.length()<.025)return;
      const ratio=THREE.MathUtils.clamp(g.scale*end.length()/start.length(),.00001,1)/g.scale;
      // Turning only about the vertical, so the model stays upright; kept as it was while the hands are stacked.
      if(Math.hypot(start.x,start.z)>.04&&Math.hypot(end.x,end.z)>.04)g.yaw=Math.atan2(end.x,end.z)-Math.atan2(start.x,start.z);
      yawTurn.setFromAxisAngle(Y,g.yaw);
      const from=a.point.clone().add(b.point).multiplyScalar(.5),to=a.hand.point.clone().add(b.hand.point).multiplyScalar(.5);
      pivot.position.copy(g.position).sub(from).multiplyScalar(ratio).applyQuaternion(yawTurn).add(to);
      pivot.quaternion.copy(yawTurn).multiply(g.quaternion);pivot.scale.setScalar(g.scale*ratio);
    } else if(grabbing.length===1) {
      const [a]=grabbing;pivot.position.copy(g.position).add(a.hand.point).sub(a.point);
    } else {
      const held=g.hands[0];if(!held)return;
      turn.copy(held.hand.rotation).multiply(held.turn.clone().invert());
      pivot.quaternion.copy(turn).multiply(g.quaternion).normalize();
      if(held.mode==='hold')pivot.position.copy(g.position).sub(held.pivot).applyQuaternion(turn).add(handPivot(held.hand,now));
    }
    pivot.updateMatrixWorld(true);
  }
  function publishTransform(force=false) {
    const now=performance.now();if(!force&&now-lastTransform<120)return;lastTransform=now;
    link.action({type:'transform',transform:viewer.currentTransform()}).catch(()=>{});
  }
  // Let go of everything: a menu opened, the mode changed, or the model changed.
  function release() {
    const moved=hands.some(h=>MOVING.includes(h.mode));
    hands.forEach(hand=>{if(hand.mode==='paint')annotate.cancel();hand.mode=null;hand.gripStart=null;});
    rebase();if(moved)publishTransform(true);
  }

  // ---------- per frame ----------
  function updateHand(hand,dt) {
    hand.tracked=Boolean(hand.source?.hand);
    hand.grip.visible=Boolean(hand.source)&&!hand.tracked;hand.dot.visible=Boolean(hand.source)&&!hand.tracked;
    if(!hand.source){annotate.aim(hand,false);return;}
    handPoint(hand,dt);
    // Tapping the watch, its menus, the keyboard, and the wrist button: fingertips only.
    const ui=watch.pointer(hand,{fingertip:fingertipOf(hand)}),kind=gesture(hand),pressed=Boolean(kind);
    const other=hands.find(h=>h!==hand),inScene=stage()==='scene',marking=!inScene&&mode()==='edit';
    annotate.aim(hand,(inScene||marking)&&!ui.onUI&&!watch.busy&&!MOVING.includes(hand.mode),inScene?'#6be0d4':null,inScene?ray=>watch.laser(hand,ray):null);
    if(!inScene)hand.laserHover=null;
    if(pressed&&!hand.held) {
      hand.kind=kind;
      if(ui.onUI||watch.busy)hand.mode='ui';   // a hand at the interface (or with a menu up) never grips or marks
      else if(kind==='pinch'&&hand.panel){hand.panel.press();hand.mode='ui';}   // the laser on the part's card: Edit ▸
      else if(MOVING.includes(other.mode)||other.mode==='paint') {
        // A second hand joins in: the two grab together, to zoom and turn (an unfinished stroke is dropped).
        if(other.mode==='paint')annotate.cancel();
        startGrip(hand);hand.mode='grab';other.mode='grab';rebase();
      } else if(kind==='fist'){startGrip(hand);hand.mode='spin';rebase();}
      else if(marking)hand.mode=annotate.begin(hand)||'tool';
      else if(onModel(hand.point)){startGrip(hand);hand.mode='hold';rebase();}
      else if(inScene&&hand.hit?.objectId) {
        // A pinch on a part picks it when let go; moved first, it drags the scene instead.
        hand.mode='pick';hand.pick={objectId:hand.hit.objectId,from:hand.point.clone()};
      } else {startGrip(hand);hand.mode='grab';rebase();}
    } else if(pressed&&hand.mode==='paint')annotate.move(hand);
    else if(pressed&&hand.mode==='pick'&&hand.point.distanceTo(hand.pick.from)>PICK){startGrip(hand);hand.mode='grab';rebase();}
    else if(!pressed&&hand.held) {
      const was=hand.mode;hand.mode=null;hand.gripStart=null;hand.kind=null;
      if(was==='pick'){select(hand.pick.objectId);const item=link.state.scene.objects.find(o=>o.id===hand.pick.objectId);if(item)watch.say(`${item.name} · Edit ▸ on your right wrist`);}
      if(was==='paint')annotate.end();
      if(MOVING.includes(was)) {
        // Still holding with the other hand: it carries on alone, from where it is now.
        publishTransform(true);rebase();
      }
    }
    hand.held=pressed;
    if(hand.tracked)dressJoints(hand,!hand.skin.update(hand.held));
    hand.dot.material.color.set(hand.uiHover?0xffffff:MOVING.includes(hand.mode)?0x6be0d4:0xffb86b);
  }
  function update(time,frame) {
    if(!session||!frame)return;
    const dt=lastTime===null?0:Math.min((time-lastTime)/1000,.1);lastTime=time;
    environments.update(time);
    commands.paused=watch.searching;   // dictation is not a command
    if(modeOverride&&link.state?.settings.mode===modeOverride.mode)modeOverride=null;
    if(stageOverride&&link.state?.stage===stageOverride.stage)stageOverride=null;
    hands.forEach(hand=>updateHand(hand,dt));
    // A menu opened while the model was held: let go of it there.
    if(watch.busy&&hands.some(h=>MOVING.includes(h.mode)||h.mode==='paint'))release();
    watch.update();
    if(grab){moveModel();publishTransform();}
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
      else if(command.name==='stats'){if(stage()!=='scene'){watch.say('🎤 Stats show in the scene');return;}watch.showStats(command.show??undefined);}
      else if(command.name==='unselect')watch.unselect();
      else if(command.name==='part-color'){if(!watch.openNamed('part-color'))watch.say('🎤 Pick a part first');}
      else if(command.name==='paint')watch.paint(command.color);
      else if(command.name==='scene'){if(stage()==='scene')watch.say('🎤 Already the whole scene');else setStage('scene');}
      else if(command.name==='reset'){ctx.fit();watch.say('🎤 Reset view');}
      else if(command.name==='exit'){watch.say('🎤 Exit');session.end();}
    },
    onError:message=>watch?.say(`🎤 ${message}`)});
  watch=createWatch({scene,camera:()=>camera,joint,hands,link,mode,setMode,stage,setStage,select,api,bounds:partBounds,
    exit:()=>session?.end(),submit:()=>ctx.submit(),undo:()=>ctx.undo(),fit:()=>ctx.fit(),
    backgrounds:{list:ENVIRONMENTS,get current(){return backdrop;},set:setBackdrop,
      get living(){return environments.living;},get running(){return environments.running;},pause:()=>environments.pause()},
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
    get watch(){return watch;},   // for the browser tests
    environments,
    get presenting(){return Boolean(session);},
    get session(){return session;},
    get hands(){return hands;},
    get state(){return {presenting:Boolean(session),stage:stage(),selected:link.state?.selected||null,mode:mode(),background:backdrop,
      backgroundShown:scene.background?.isTexture?scene.background.image?.src?.split('/').pop()||backdrop:environments.key,environment:environments.state,
      transform:viewer.currentTransform(),watch:watch.state,lasers:annotate.state,commands:{...commands.state,on:voiceOn},
      hands:hands.map(hand=>({side:hand.source?.handedness||null,tracked:hand.tracked,model:hand.skin.ready,held:hand.held,mode:hand.mode,
        touching:Boolean(hand.poking),presses:hand.presses||0,over:hand.uiHover||null,point:hand.point.toArray(),indexTip:joint(hand,'index-finger-tip')?.position.toArray()||null}))};}};
  return instance;
}
