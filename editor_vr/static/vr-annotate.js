// The laser: picking parts in the scene, and Annotate mode's marking. Each hand (or controller) points its ray at the model, in
// the mark's color, and a pinch (or the trigger) applies the chosen tool where it lands: spray while held, drag out a
// 3D region, pin, the two ends of a measurement, or erase a mark. The interface is tapped with a fingertip instead,
// so the laser is hidden while a hand is at the menus.
import * as THREE from 'three';

export function createAnnotate({scene,viewer,tools,link}) {
  const lasers=new Map();
  function laserOf(hand) {
    if(lasers.has(hand))return lasers.get(hand);
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),
      new THREE.LineBasicMaterial({color:0x6be0d4,transparent:true,opacity:.75,depthTest:false}));
    line.renderOrder=20;line.visible=false;hand.controller.add(line);
    const spot=new THREE.Mesh(new THREE.SphereGeometry(.0035,8,6),new THREE.MeshBasicMaterial({color:0xffb86b,depthTest:false}));
    spot.renderOrder=25;spot.visible=false;scene.add(spot);
    const raycaster=new THREE.Raycaster();raycaster.near=0;raycaster.far=8;
    const laser={line,spot,raycaster};lasers.set(hand,laser);return laser;
  }
  // The hand's pointing ray (the controller's, or the system's ray for a tracked hand).
  function rayOf(hand) {
    hand.controller.updateMatrixWorld();
    const {raycaster}=laserOf(hand);
    raycaster.set(hand.controller.getWorldPosition(new THREE.Vector3()),new THREE.Vector3(0,0,-1).transformDirection(hand.controller.matrixWorld));
    return raycaster;
  }
  // Every frame for each hand: aim, and show the laser (or hide it, when `shown` is false). Returns the model hit
  // (in the scene, with the part's objectId). `color` overrides the mark's color (the scene's selecting laser).
  // `panel(ray)` is a button floating in the room (the selected part's card): nearer than the model, it stops the laser
  // there and is kept as hand.panel, to be pressed by a pinch.
  function aim(hand,shown,color=null,panel=null) {
    const laser=laserOf(hand);
    if(!shown){laser.line.visible=false;laser.spot.visible=false;hand.hit=null;hand.panel=null;return null;}
    const ray=rayOf(hand),hit=viewer.hit(ray),button=panel?.(ray)||null;
    hand.panel=button&&(!hit||button.distance<hit.distance)?button:null;hand.ray=ray;
    laser.line.visible=true;
    if(hand.panel) {
      laser.line.scale.z=hand.panel.distance;laser.line.material.color.set('#ffffff');
      laser.spot.visible=true;laser.spot.position.copy(hand.panel.point);hand.hit=null;return null;
    }
    laser.line.scale.z=hit?.distance||1.5;
    laser.line.material.color.set(hit?color||link.state.settings.color:'#7f9bae');
    laser.spot.visible=Boolean(hit);if(hit)laser.spot.position.copy(hit.point);
    hand.hit=hit;
    return hit;
  }
  function begin(hand) {
    if(!hand.hit||!tools.begin(hand.hit,hand.ray))return null;
    return tools.active?'paint':'tool';
  }
  function move(hand){if(tools.active)tools.update(hand.hit,hand.ray);}
  function end(){if(tools.active)tools.end();}
  function cancel(){tools.cancel();}
  function hideAll(){for(const laser of lasers.values()){laser.line.visible=false;laser.spot.visible=false;}}
  return {aim,begin,move,end,cancel,hideAll,
    get state(){return [...lasers.entries()].map(([hand,laser])=>({side:hand.source?.handedness||null,shown:laser.line.visible,onModel:laser.spot.visible}));}};
}
