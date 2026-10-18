import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';

export class ModelViewer{
  constructor(canvas){
    this.canvas=canvas;this.renderer=new THREE.WebGLRenderer({canvas,antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor(0x232b34);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x232b34);this.scene.fog=new THREE.Fog(0x232b34,4,12);
    this.camera=new THREE.PerspectiveCamera(43,1,.01,30);this.camera.position.set(.8,1.6,.7);
    this.controls=new OrbitControls(this.camera,canvas);this.controls.target.set(0,1.12,-.85);this.controls.enableDamping=true;this.controls.minDistance=.1;this.controls.maxDistance=5;
    this.scene.add(new THREE.HemisphereLight(0xd9edff,0x31313a,2.4));
    const key=new THREE.DirectionalLight(0xffe2bf,4);key.position.set(-2,4,2);this.scene.add(key);
    const rim=new THREE.DirectionalLight(0x9bd3f8,3);rim.position.set(2,2,-4);this.scene.add(rim);
    const platform=new THREE.Mesh(new THREE.CylinderGeometry(.48,.50,.045,96),new THREE.MeshStandardMaterial({color:0x373d46,roughness:.8,metalness:.15}));platform.position.set(0,.765,-.85);this.scene.add(platform);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.485,.0015,6,96),new THREE.MeshBasicMaterial({color:0x677786}));ring.rotation.x=Math.PI/2;ring.position.set(0,.79,-.85);this.scene.add(ring);
    const grid=new THREE.GridHelper(12,120,0x3c4856,0x303b48);grid.position.y=.735;this.scene.add(grid);
    // pivot (the shared placement) › content (model Z-up to view Y-up) › offset (centers what is shown) › one mesh per part
    this.pivot=new THREE.Group();this.scene.add(this.pivot);this.content=new THREE.Group();this.content.rotation.x=-Math.PI/2;this.pivot.add(this.content);
    this.offset=new THREE.Group();this.content.add(this.offset);this.parts=new THREE.Group();this.offset.add(this.parts);
    this.overlay=new THREE.Group();this.offset.add(this.overlay);this.previewGroup=new THREE.Group();this.offset.add(this.previewGroup);
    this.meshes=new Map();this.mesh=null;this.stage='scene';this.selected=null;this.localBusy=false;this.modelId=null;this.sceneKey=null;this.loadSerial=0;
    new ResizeObserver(()=>this.resize()).observe(canvas);this.resize();
    this.renderer.setAnimationLoop((time,frame)=>{this.controls.enabled=!this.renderer.xr.isPresenting;this.controls.update();this.onFrame?.(time,frame);this.renderer.render(this.scene,this.renderer.xr.isPresenting?this.xrCamera:this.camera);});
  }
  resize(){if(this.renderer.xr.isPresenting)return;const w=this.canvas.clientWidth,h=this.canvas.clientHeight;this.renderer.setSize(w,h,false);this.camera.aspect=w/Math.max(1,h);this.camera.updateProjectionMatrix();}
  // One part's mesh: geometry in its native millimeters, with per-face centers and normals for the marking tools.
  async build(item){
    const response=await fetch(`/api/models/${item.model_id}/mesh`);if(!response.ok)throw new Error(`${item.name} could not be loaded.`);const data=await response.arrayBuffer();
    const header=new DataView(data);if(header.getUint32(0,true)!==0x31525645)throw new Error('Unrecognized mesh data.');const nv=header.getUint32(4,true),nf=header.getUint32(8,true);
    const vertices=new Float32Array(data,12,nv*3),faces=new Uint32Array(data,12+nv*12,nf*3);
    const positions=new Float32Array(nf*9),smooth=new Float32Array(nv*3),normals=new Float32Array(nf*9),centers=new Float32Array(nf*3),faceNormals=new Float32Array(nf*3);
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
    for(let face=0;face<nf;face++){
      a.fromArray(vertices,faces[face*3]*3);b.fromArray(vertices,faces[face*3+1]*3);c.fromArray(vertices,faces[face*3+2]*3);
      normal.subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a));
      for(let j=0;j<3;j++){const index=faces[face*3+j]*3;for(let k=0;k<3;k++){positions[face*9+j*3+k]=vertices[index+k];smooth[index+k]+=normal.getComponent(k);centers[face*3+k]+=vertices[index+k]/3;}}
      normal.normalize().toArray(faceNormals,face*3);
    }
    for(let face=0;face<nf;face++)for(let j=0;j<3;j++)normal.fromArray(smooth,faces[face*3+j]*3).normalize().toArray(normals,face*9+j*3);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.BufferAttribute(new Float32Array(nf*9).fill(.76),3));geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.4,metalness:.12,side:THREE.DoubleSide,emissive:0x000000}));
    mesh.name=item.name;mesh.userData={modelId:item.model_id,centers,faceNormals};return mesh;
  }
  // Show the workspace: every part of the scene (stage "scene"), or the part being edited alone (stage "object"),
  // centered; in the scene, the selected part glows.
  async show(state){
    const serial=++this.loadSerial,objects=state.scene.objects;
    for(const item of objects)if(!this.meshes.has(item.model_id)){const mesh=await this.build(item);if(serial!==this.loadSerial)return false;if(!this.meshes.has(item.model_id)){this.meshes.set(item.model_id,mesh);this.parts.add(mesh);}}
    if(serial!==this.loadSerial)return false;
    const wanted=new Set(objects.map(o=>o.model_id));
    for(const [key,mesh] of this.meshes)if(!wanted.has(key)){this.parts.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();this.meshes.delete(key);}
    for(const item of objects)Object.assign(this.meshes.get(item.model_id).userData,{objectId:item.id,name:item.name});
    this.stage=state.stage;this.selected=state.selected;this.model=state.model;
    this.modelId=state.model.id;this.mesh=this.meshes.get(this.modelId)||null;
    for(const [key,mesh] of this.meshes){mesh.visible=this.stage==='scene'||key===this.modelId;mesh.material.emissive.setHex(this.stage==='scene'&&mesh.userData.objectId===this.selected?0x3a2a12:0);}
    const shown=this.stage==='scene'?objects:objects.filter(o=>o.model_id===this.modelId);
    const low=new THREE.Vector3(Infinity,Infinity,Infinity),high=new THREE.Vector3(-Infinity,-Infinity,-Infinity);
    for(const item of shown){low.min(new THREE.Vector3(...item.bounds_mm[0]));high.max(new THREE.Vector3(...item.bounds_mm[1]));}
    this.offset.position.copy(low.add(high).multiplyScalar(-.5));
    this.sceneKey=`${state.scene.id}:${this.stage}:${this.stage==='object'?this.modelId:''}`;
    return true;
  }
  get centers(){return this.mesh?.userData.centers||null;}
  get faceNormals(){return this.mesh?.userData.faceNormals||null;}
  transform(value,force=false){if(!value||this.localBusy&&!force)return;this.pivot.position.fromArray(value.position);this.pivot.quaternion.fromArray(value.quaternion);this.pivot.scale.setScalar(value.scale);this.pivot.updateMatrixWorld(true);}
  currentTransform(){return {position:this.pivot.position.toArray(),quaternion:this.pivot.quaternion.toArray(),scale:this.pivot.scale.x};}
  fitCamera(){this.controls.target.copy(this.pivot.position);this.camera.position.copy(this.pivot.position).add(new THREE.Vector3(.75,.43,1.4));this.controls.update();}
  local(world){return this.mesh.worldToLocal(world.clone());}
  world(local){return this.mesh.localToWorld(local.clone());}
  hit(raycaster){
    this.pivot.updateMatrixWorld(true);
    if(this.stage==='object')return this.mesh?raycaster.intersectObject(this.mesh,false)[0]||null:null;
    const hit=raycaster.intersectObjects([...this.meshes.values()].filter(m=>m.visible),false)[0];
    return hit?{...hit,objectId:hit.object.userData.objectId}:null;
  }
  color(annotations,draft=null){for(const mesh of this.meshes.values())if(mesh!==this.mesh&&mesh.userData.tinted){mesh.geometry.attributes.color.array.fill(.76);mesh.geometry.attributes.color.needsUpdate=true;mesh.userData.tinted=false;}
    if(!this.mesh)return;this.mesh.userData.tinted=true;const colors=this.mesh.geometry.attributes.color;colors.array.fill(.76);const color=new THREE.Color();for(const mark of [...annotations,...(draft?[draft]:[])]){color.set(mark.color);for(const face of mark.face_ids||[])for(let j=0;j<3;j++)color.toArray(colors.array,face*9+j*3);}colors.needsUpdate=true;this.drawMarks(annotations);}
  disposeGroup(group){for(const child of [...group.children]){group.remove(child);child.geometry?.dispose();if(Array.isArray(child.material))child.material.forEach(m=>m.dispose());else child.material?.dispose();}}
  drawMarks(annotations){this.disposeGroup(this.overlay);for(const mark of annotations){if(mark.tool==='pin'){const pin=new THREE.Mesh(new THREE.SphereGeometry(Math.max(...this.model.dimensions_mm)*.012,12,8),new THREE.MeshBasicMaterial({color:mark.color,depthTest:false}));pin.position.fromArray(mark.points[0]);pin.renderOrder=5;this.overlay.add(pin);}if(mark.tool==='measure'){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(mark.points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:mark.color,depthTest:false}));line.renderOrder=5;this.overlay.add(line);}if(mark.tool==='box'&&mark.bounds_mm){const box=new THREE.Box3(...mark.bounds_mm.map(p=>new THREE.Vector3(...p)));this.overlay.add(new THREE.Box3Helper(box,mark.color));}}}
  region(bounds,color){this.disposeGroup(this.previewGroup);if(bounds)this.previewGroup.add(new THREE.Box3Helper(new THREE.Box3(...bounds.map(p=>new THREE.Vector3(...p))),color));}
  wireframe(value){for(const mesh of this.meshes.values())mesh.material.wireframe=value;}
}
