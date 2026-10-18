import * as THREE from 'three';
import {uid} from './link.js';
export const TOOL_NAMES={spray:'Spray paint',box:'3D region',pin:'Pin a note',measure:'Measure',erase:'Erase mark'};
export class AnnotationTools{
  constructor(viewer,link,notify){this.viewer=viewer;this.link=link;this.notify=notify;this.stroke=null;this.ruler=null;}
  get settings(){return this.link.state.settings;}
  get active(){return Boolean(this.stroke);}
  begin(hit,ray){
    if(!hit||!this.viewer.mesh)return false;
    if(this.viewer.modelId!==this.link.state.model.id){this.notify('The model is changing. Wait for it to load before marking.');return false;}
    const s={...this.settings},point=this.viewer.local(hit.point);
    if(s.tool==='erase'){const mark=[...this.link.state.annotations].reverse().find(a=>a.face_ids.includes(hit.faceIndex));if(mark)this.link.action({type:'remove',annotation_id:mark.id}).catch(()=>{});else this.notify('There is no annotation at this point.');return true;}
    if(s.tool==='measure'){
      if(!this.ruler){this.ruler={point:point.toArray(),face:hit.faceIndex,model_id:this.viewer.modelId};this.notify('First endpoint set. Select the second endpoint.');return true;}
      if(this.ruler.model_id!==this.viewer.modelId)this.ruler=null;
      if(!this.ruler)return false;
      const distance=point.distanceTo(new THREE.Vector3(...this.ruler.point));
      if(distance<.01){this.notify('Choose a different second point.');return true;}
      const annotation=this.make(s,[this.ruler.face,hit.faceIndex],[this.ruler.point,point.toArray()]);
      this.ruler=null;this.commit(annotation);this.notify(`${distance.toFixed(2)} mm measured.`);return true;
    }
    if(s.tool==='pin'){this.commit(this.make(s,[hit.faceIndex],[point.toArray()]));return true;}
    this.stroke={settings:s,model_id:this.viewer.modelId,faces:new Set(),points:[],start:point,depth:hit.distance,bounds:null,last:null};
    this.update(hit,ray);return true;
  }
  make(settings,faces,points,bounds=null){return {id:uid(),tool:settings.tool,color:settings.color,meaning:settings.meaning,category:settings.category,description:settings.description,brush_radius_mm:settings.brush_radius_mm,face_ids:[...new Set(faces)],points,bounds_mm:bounds};}
  update(hit,ray){
    const stroke=this.stroke;if(!stroke||stroke.model_id!==this.viewer.modelId)return;
    const viewer=this.viewer;
    if(stroke.settings.tool==='spray'){
      if(!hit)return;const point=viewer.local(hit.point),radius=stroke.settings.brush_radius_mm;
      if(stroke.last&&stroke.last.distanceTo(point)<radius*.12)return;
      stroke.last=point;stroke.faces.add(hit.faceIndex);if(stroke.points.length<4096)stroke.points.push(point.toArray());
      const normal=new THREE.Vector3().fromArray(viewer.faceNormals,hit.faceIndex*3),center=new THREE.Vector3(),other=new THREE.Vector3();
      for(let face=0;face<viewer.centers.length/3;face++)if(center.fromArray(viewer.centers,face*3).distanceToSquared(point)<=radius*radius&&other.fromArray(viewer.faceNormals,face*3).dot(normal)>.2)stroke.faces.add(face);
    }else if(stroke.settings.tool==='box'){
      const end=viewer.local(ray.ray.at(stroke.depth,new THREE.Vector3()));
      const low=stroke.start.clone().min(end),high=stroke.start.clone().max(end);
      stroke.bounds=[low.toArray(),high.toArray()];stroke.points=[stroke.start.toArray(),end.toArray()];stroke.faces.clear();
      for(let face=0;face<viewer.centers.length/3;face++){let contains=true;for(let k=0;k<3;k++){const v=viewer.centers[face*3+k];if(v<low.getComponent(k)-.001||v>high.getComponent(k)+.001){contains=false;break;}}if(contains)stroke.faces.add(face);}
      viewer.region(stroke.bounds,stroke.settings.color);
    }
    viewer.color(this.link.state.annotations,{face_ids:[...stroke.faces],color:stroke.settings.color});
  }
  end(){const stroke=this.stroke;this.stroke=null;this.viewer.region(null);if(!stroke)return;
    if(stroke.model_id!==this.viewer.modelId){this.notify('Model changed; the unfinished selection was cancelled.',true);return;}
    if(!stroke.faces.size){this.notify('No face centers in this region. Make a larger 3D box.');this.viewer.color(this.link.state.annotations);return;}
    this.commit(this.make(stroke.settings,[...stroke.faces],stroke.points,stroke.bounds));
  }
  commit(annotation){this.link.action({type:'annotate',model_id:this.viewer.modelId,annotation}).then(()=>this.notify(`${TOOL_NAMES[annotation.tool]} mark saved to the workspace.`)).catch(()=>{});}
  cancel(){this.stroke=null;this.ruler=null;this.viewer.region(null);if(this.link.state)this.viewer.color(this.link.state.annotations);}
}
