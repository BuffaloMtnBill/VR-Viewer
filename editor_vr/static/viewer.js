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
    this.pivot=new THREE.Group();this.scene.add(this.pivot);this.content=new THREE.Group();this.content.rotation.x=-Math.PI/2;this.pivot.add(this.content);
    this.overlay=new THREE.Group();this.content.add(this.overlay);this.previewGroup=new THREE.Group();this.content.add(this.previewGroup);this.mesh=null;this.centers=null;this.faceNormals=null;this.localBusy=false;this.modelId=null;this.loadSerial=0;
    new ResizeObserver(()=>this.resize()).observe(canvas);this.resize();
    this.renderer.setAnimationLoop((time,frame)=>{this.controls.enabled=!this.renderer.xr.isPresenting;this.controls.update();this.onFrame?.(time,frame);this.renderer.render(this.scene,this.renderer.xr.isPresenting?this.xrCamera:this.camera);});
  }
  resize(){if(this.renderer.xr.isPresenting)return;const w=this.canvas.clientWidth,h=this.canvas.clientHeight;this.renderer.setSize(w,h,false);this.camera.aspect=w/Math.max(1,h);this.camera.updateProjectionMatrix();}
  async load(model){
    if(model.id===this.modelId)return;
    const serial=++this.loadSerial;const response=await fetch(`/api/models/${model.id}/mesh`);if(!response.ok)throw new Error('The model could not be loaded.');const data=await response.arrayBuffer();if(serial!==this.loadSerial)return;
    const header=new DataView(data);if(header.getUint32(0,true)!==0x31525645)throw new Error('Unrecognized mesh data.');const nv=header.getUint32(4,true),nf=header.getUint32(8,true);
    const vertices=new Float32Array(data,12,nv*3),faces=new Uint32Array(data,12+nv*12,nf*3);
    const positions=new Float32Array(nf*9),smooth=new Float32Array(nv*3),normals=new Float32Array(nf*9);this.centers=new Float32Array(nf*3);this.faceNormals=new Float32Array(nf*3);
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
    for(let face=0;face<nf;face++){
      a.fromArray(vertices,faces[face*3]*3);b.fromArray(vertices,faces[face*3+1]*3);c.fromArray(vertices,faces[face*3+2]*3);
      normal.subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a));
      for(let j=0;j<3;j++){const index=faces[face*3+j]*3;for(let k=0;k<3;k++){positions[face*9+j*3+k]=vertices[index+k];smooth[index+k]+=normal.getComponent(k);this.centers[face*3+k]+=vertices[index+k]/3;}}
      normal.normalize().toArray(this.faceNormals,face*3);
    }
    for(let face=0;face<nf;face++)for(let j=0;j<3;j++)normal.fromArray(smooth,faces[face*3+j]*3).normalize().toArray(normals,face*9+j*3);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.BufferAttribute(new Float32Array(nf*9).fill(.8),3));geometry.computeBoundingBox();geometry.computeBoundingSphere();
    if(this.mesh){this.content.remove(this.mesh);this.mesh.geometry.dispose();this.mesh.material.dispose();}
    this.mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.4,metalness:.12,side:THREE.DoubleSide}));this.mesh.name='Annotated print model';const center=geometry.boundingBox.getCenter(new THREE.Vector3());this.mesh.position.copy(center).negate();this.content.add(this.mesh);this.overlay.position.copy(this.mesh.position);this.previewGroup.position.copy(this.mesh.position);this.modelId=model.id;this.model=model;
  }
  transform(value,force=false){if(!value||this.localBusy&&!force)return;this.pivot.position.fromArray(value.position);this.pivot.quaternion.fromArray(value.quaternion);this.pivot.scale.setScalar(value.scale);this.pivot.updateMatrixWorld(true);}
  currentTransform(){return {position:this.pivot.position.toArray(),quaternion:this.pivot.quaternion.toArray(),scale:this.pivot.scale.x};}
  fitCamera(){this.controls.target.copy(this.pivot.position);this.camera.position.copy(this.pivot.position).add(new THREE.Vector3(.75,.43,1.4));this.controls.update();}
  local(world){return this.mesh.worldToLocal(world.clone());}
  world(local){return this.mesh.localToWorld(local.clone());}
  hit(raycaster){if(!this.mesh)return null;this.pivot.updateMatrixWorld(true);return raycaster.intersectObject(this.mesh,false)[0]||null;}
  color(annotations,draft=null){if(!this.mesh)return;const colors=this.mesh.geometry.attributes.color;colors.array.fill(.76);const color=new THREE.Color();for(const mark of [...annotations,...(draft?[draft]:[])]){color.set(mark.color);for(const face of mark.face_ids||[])for(let j=0;j<3;j++)color.toArray(colors.array,face*9+j*3);}colors.needsUpdate=true;this.drawMarks(annotations);}
  disposeGroup(group){for(const child of [...group.children]){group.remove(child);child.geometry?.dispose();if(Array.isArray(child.material))child.material.forEach(m=>m.dispose());else child.material?.dispose();}}
  drawMarks(annotations){this.disposeGroup(this.overlay);for(const mark of annotations){if(mark.tool==='pin'){const pin=new THREE.Mesh(new THREE.SphereGeometry(Math.max(...this.model.dimensions_mm)*.012,12,8),new THREE.MeshBasicMaterial({color:mark.color,depthTest:false}));pin.position.fromArray(mark.points[0]);pin.renderOrder=5;this.overlay.add(pin);}if(mark.tool==='measure'){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(mark.points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:mark.color,depthTest:false}));line.renderOrder=5;this.overlay.add(line);}if(mark.tool==='box'&&mark.bounds_mm){const box=new THREE.Box3(...mark.bounds_mm.map(p=>new THREE.Vector3(...p)));this.overlay.add(new THREE.Box3Helper(box,mark.color));}}}
  region(bounds,color){this.disposeGroup(this.previewGroup);if(bounds)this.previewGroup.add(new THREE.Box3Helper(new THREE.Box3(...bounds.map(p=>new THREE.Vector3(...p))),color));}
  wireframe(value){if(this.mesh)this.mesh.material.wireframe=value;}
}
