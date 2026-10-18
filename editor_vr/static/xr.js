import * as THREE from 'three';
import {createHandSkin} from './hand-skin.js';
import {WristUI} from './xr-ui.js';

export class EditorXR{
  constructor(viewer,link,tools,ctx){this.viewer=viewer;this.link=link;this.tools=tools;this.ctx=ctx;this.session=null;this.hands=[];this.grab=null;this.lastTransform=0;this.ray=new THREE.Raycaster();this.ray.near=0;this.ray.far=8;
    this.camera=new THREE.PerspectiveCamera(70,1,.01,30);viewer.scene.add(this.camera);viewer.xrCamera=this.camera;
    this.ui=new WristUI(viewer.scene,{settings:changes=>ctx.settings(changes),submit:()=>ctx.submit(),undo:()=>ctx.undo(),fit:()=>ctx.fit(),camera:()=>viewer.renderer.xr.isPresenting?viewer.renderer.xr.getCamera():this.camera});this.ui.watch.mesh.visible=false;
    for(let i=0;i<2;i++)this.attach(i);
  }
  attach(i){const renderer=this.viewer.renderer,controller=renderer.xr.getController(i),grip=renderer.xr.getControllerGrip(i),hand=renderer.xr.getHand(i);this.viewer.scene.add(controller,grip,hand);
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:0x6be0d4,transparent:true,opacity:.72,depthTest:false}));line.renderOrder=20;line.scale.z=1.5;line.visible=false;controller.add(line);
    const pointer=new THREE.Mesh(new THREE.SphereGeometry(.0035,8,6),new THREE.MeshBasicMaterial({color:0xffb86b,depthTest:false}));pointer.renderOrder=25;pointer.visible=false;this.viewer.scene.add(pointer);
    const model=new THREE.Mesh(new THREE.BoxGeometry(.035,.06,.1),new THREE.MeshStandardMaterial({color:0x8c9eae,roughness:.5}));model.position.z=.025;grip.add(model);
    const item={i,controller,grip,hand,line,pointer,model,skin:createHandSkin(hand),source:null,pressed:false,eventPressed:false,mode:null,point:new THREE.Vector3(),rotation:new THREE.Quaternion()};this.hands.push(item);
    controller.addEventListener('connected',event=>{item.source=event.data;});controller.addEventListener('disconnected',()=>{item.source=null;item.mode=null;item.pressed=false;item.eventPressed=false;this.rebase();});controller.addEventListener('selectstart',()=>item.eventPressed=true);controller.addEventListener('selectend',()=>item.eventPressed=false);
  }
  joint(hand,name){const joint=hand.hand.joints?.[name];return joint&&joint.visible!==false?joint:null;}
  point(hand){const a=this.joint(hand,'thumb-tip'),b=this.joint(hand,'index-finger-tip');if(hand.source?.hand&&a&&b)hand.point.copy(a.getWorldPosition(new THREE.Vector3())).add(b.getWorldPosition(new THREE.Vector3())).multiplyScalar(.5);else hand.controller.getWorldPosition(hand.point);hand.controller.getWorldQuaternion(hand.rotation);}
  pressed(hand){if(hand.eventPressed||hand.source?.gamepad?.buttons[0]?.pressed)return true;if(!hand.source?.hand)return false;const a=this.joint(hand,'thumb-tip'),b=this.joint(hand,'index-finger-tip');return Boolean(a&&b&&a.position.distanceTo(b.position)<(hand.pressed ? .030 : .018));}
  rayFor(hand){this.ray.set(hand.controller.getWorldPosition(new THREE.Vector3()),new THREE.Vector3(0,0,-1).transformDirection(hand.controller.matrixWorld));return this.ray;}
  rebase(){const hands=this.hands.filter(h=>h.mode==='grab');if(!hands.length){this.grab=null;this.viewer.localBusy=false;return;}this.viewer.localBusy=true;this.grab={hands:hands.map(h=>h.i),points:hands.map(h=>h.point.clone()),rotations:hands.map(h=>h.rotation.clone()),position:this.viewer.pivot.position.clone(),quaternion:this.viewer.pivot.quaternion.clone(),scale:this.viewer.pivot.scale.x};}
  moveGrab(){if(!this.grab)return;const g=this.grab,hands=g.hands.map(i=>this.hands[i]),q=new THREE.Quaternion();let anchor=g.points[0],current=hands[0].point,ratio=1;
    if(hands.length===1)q.copy(hands[0].rotation).multiply(g.rotations[0].clone().invert());
    else{const start=g.points[1].clone().sub(g.points[0]),end=hands[1].point.clone().sub(hands[0].point);if(start.length()<.025||end.length()<.025)return;ratio=end.length()/start.length();const scale=THREE.MathUtils.clamp(g.scale*ratio,.00001,1);ratio=scale/g.scale;q.setFromUnitVectors(start.normalize(),end.normalize());anchor=g.points[0].clone().add(g.points[1]).multiplyScalar(.5);current=hands[0].point.clone().add(hands[1].point).multiplyScalar(.5);}
    this.viewer.pivot.position.copy(g.position).sub(anchor).multiplyScalar(ratio).applyQuaternion(q).add(current);this.viewer.pivot.quaternion.copy(q).multiply(g.quaternion);this.viewer.pivot.scale.setScalar(g.scale*ratio);this.viewer.pivot.updateMatrixWorld(true);
  }
  publishTransform(force=false){const t=performance.now();if(!force&&t-this.lastTransform<120)return;this.lastTransform=t;this.link.action({type:'transform',transform:this.viewer.currentTransform()}).catch(()=>{});}
  update(time,frame){if(!this.session||!frame)return;const camera=this.viewer.renderer.xr.getCamera();
    for(const hand of this.hands){this.point(hand);hand.grip.visible=Boolean(hand.source&&!hand.source.hand);hand.skin.update(hand.pressed);if(hand.source?.hand)for(const joint of Object.values(hand.hand.joints||{})){if(!hand.skin.ready&&!joint.userData.editorDot){const dot=new THREE.Mesh(new THREE.SphereGeometry(.005,6,4),new THREE.MeshBasicMaterial({color:0xb3d5e4}));joint.add(dot);joint.userData.editorDot=dot;}if(joint.userData.editorDot)joint.userData.editorDot.visible=!hand.skin.ready;} }
    const left=this.hands.find(h=>h.source?.handedness==='left');const wrist=left&&this.joint(left,'wrist');const anchor=wrist?wrist.getWorldPosition(new THREE.Vector3()):left?left.point:new THREE.Vector3(-.3,1.15,-.45);this.ui.update(anchor,camera);this.ui.watch.mesh.visible=true;
    const hovered=[];
    for(const hand of this.hands){
      if(!hand.source){hand.line.visible=false;hand.pointer.visible=false;continue;}
      const ray=this.rayFor(hand),ui=this.ui.hit(ray,hand.source.handedness),hit=this.viewer.hit(ray),target=ui||hit;hovered.push(ui?.region?.id);
      hand.line.visible=true;hand.line.scale.z=target?.distance||1.5;hand.pointer.visible=Boolean(target);if(target)hand.pointer.position.copy(target.point);hand.line.material.color.set(target?this.link.state.settings.color:'#7f9bae');
      const pressed=this.pressed(hand),squeeze=Boolean(hand.source.gamepad?.buttons[1]?.pressed),was=hand.pressed;const other=this.hands.find(h=>h!==hand);
      if((pressed&&!was)||(squeeze&&!hand.squeezed)){
        if(ui&&target===ui&&!squeeze){hand.mode='ui';ui.region?.action();}
        else if(other?.mode==='grab'||other?.mode==='paint'){
          if(other.mode==='paint')this.tools.cancel();hand.mode='grab';other.mode='grab';this.rebase();
        }else if(squeeze||this.link.state.settings.mode==='inspect'){hand.mode='grab';this.rebase();}
        else if(hit&&this.tools.begin(hit,ray))hand.mode=this.tools.active?'paint':'tool';
      }
      if(hand.mode==='paint'&&pressed)this.tools.update(hit,ray);
      if((!pressed&&was&&!squeeze)||(!squeeze&&hand.squeezed&&!pressed)){
        if(hand.mode==='paint')this.tools.end();const moved=hand.mode==='grab';hand.mode=null;if(moved){this.publishTransform(true);this.rebase();}
      }
      hand.pressed=pressed;hand.squeezed=squeeze;
    }
    this.ui.hover(hovered);
    if(this.grab){this.moveGrab();this.publishTransform();}
  }
  async enter(){if(this.session)return;if(!this.link.state||!this.viewer.mesh){this.ctx.notify('Wait for the model to finish loading.');return;}try{
      if(!window.isSecureContext||!navigator.xr)throw new Error('Use the HTTPS headset address shown in Connect headset. WebXR needs a secure page.');
      const session=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor','bounded-floor','hand-tracking']});this.session=session;this.viewer.renderer.xr.enabled=true;this.viewer.renderer.xr.setReferenceSpaceType('local-floor');
      session.addEventListener('end',()=>{if(this.tools.active)this.tools.end();if(this.grab)this.publishTransform(true);this.session=null;this.ui.close();this.ui.watch.mesh.visible=false;this.hands.forEach(h=>{h.mode=null;h.pressed=false;h.line.visible=false;h.pointer.visible=false;});this.rebase();this.viewer.renderer.xr.enabled=false;this.viewer.resize();this.ctx.presenting(false);});
      session.addEventListener('visibilitychange',()=>{if(session.visibilityState==='visible')this.link.refresh();});
      await this.viewer.renderer.xr.setSession(session);this.ui.updateState(this.link.state);this.ctx.presenting(true);this.ui.notify('Raise your left wrist for tools.');
    }catch(error){if(this.session){this.session.end().catch(()=>{});this.session=null;}this.ctx.notify(error.message,true);}}
  async attachButton(button){let supported=false;try{supported=await navigator.xr?.isSessionSupported('immersive-vr');}catch{/* Desktop remains available. */}button.disabled=!supported;button.title=supported?'Enter the shared workspace in VR':'Open the HTTPS address in Quest Browser to enter VR';button.addEventListener('click',()=>this.enter());}
  cancelInteraction(){this.tools.cancel();this.hands.forEach(hand=>hand.mode=null);this.rebase();}
  updateState(state){this.ui.updateState(state);}
  notify(message){this.ui.notify(message);}
  get state(){return {presenting:Boolean(this.session),hands:this.hands.map(h=>({side:h.source?.handedness,tracked:Boolean(h.source?.hand),model:h.skin.ready,pressed:h.pressed,mode:h.mode,point:h.point.toArray()})),transform:this.viewer.currentTransform(),ui:this.ui.stateForTests};}
}
