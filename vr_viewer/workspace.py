"""The shared view. Commands are serialized, and every device follows the same state.

The workspace holds a scene of named objects (the parts of a model file, or of several). It is viewed whole (stage
"scene"), where objects are selected, colored, added and removed, or one object at a time (stage "object"). Nothing
here writes to the model files themselves: parts are kept as compact copies in the data folder."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
from threading import RLock
import uuid
import numpy as np
from . import mesh


class Conflict(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def number(value,low,high,label):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not low<=value<=high:
        raise ValueError(f'{label} must be a finite number from {low} to {high}.')
    return float(value)


def text(value,limit,label):
    if not isinstance(value,str) or len(value)>limit:
        raise ValueError(f'{label} must be text of at most {limit} characters.')
    return value.strip()


def identifier(value):
    if not isinstance(value,str) or not re.fullmatch('[a-f0-9]{32}',value):
        raise ValueError('Invalid identifier.')
    return value


def vector(value,length,label,limit=1e6):
    if not isinstance(value,list) or len(value)!=length: raise ValueError(f'{label} needs {length} coordinates.')
    return [number(v,-limit,limit,label) for v in value]


MAX_OBJECTS=64
TABLE={'position':[0,1.12,-.85],'quaternion':[0,0,0,1]}
SCHEMA=1


def fitted(dimensions):
    """The shared presentation: whatever is shown, about 55 cm across on the table."""
    return {**deepcopy(TABLE),'scale':.55/max(max(dimensions),1e-6)}


class Workspace:
    def __init__(self,folder):
        self.folder=Path(folder); self.folder.mkdir(parents=True,exist_ok=True)
        (self.folder/'models').mkdir(exist_ok=True)
        self.lock=RLock(); self.path=self.folder/'workspace.json';self._mesh_cache={}
        state=None
        if self.path.exists():
            try:
                state=json.loads(self.path.read_text())
                if state.get('schema')!=SCHEMA:state=None
                else:
                    for item in state['scene']['objects']:self.model(item['model_id'])
            except (ValueError,KeyError,TypeError,OSError):state=None   # unreadable, or its parts are gone: start afresh
        if state:self.state=state
        else:
            self.state={'schema':SCHEMA,'revision':0}
            self._open(mesh.demo_scene(),'Fluted study vessel','Built-in scene','Desktop')

    def snapshot(self):
        with self.lock:return deepcopy(self.state)

    def _save(self):
        temporary=self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.state,allow_nan=False),encoding='utf-8')
        temporary.replace(self.path)

    def _touch(self,actor):
        self.state['revision']+=1;self.state['updated_at']=now();self.state['updated_by']=actor[:64]
        self._save()

    # ---------- the scene ----------
    def _store(self,part):
        key=uuid.uuid4().hex
        vertices,faces=part['vertices'],part['faces']
        np.savez_compressed(self.folder/'models'/f'{key}.npz',vertices=vertices,faces=faces)
        self._mesh_cache[key]=(vertices,faces)
        summary=mesh.info(vertices,faces)
        return {'id':uuid.uuid4().hex,'name':text(part['name'],120,'Part name') or 'Part','category':(part.get('category') or None),
                'print_file':part.get('print_file'),'source_file':part.get('source_file'),'model_id':key,
                'source_triangles':part.get('source_triangles',summary['triangles']),
                **{k:summary[k] for k in ('triangles','dimensions_mm','bounds_mm','watertight')}}

    def _forget_unused(self):
        """The stored copies of parts no longer in the scene."""
        used={o['model_id'] for o in self.state['scene']['objects']}
        self._mesh_cache={key:value for key,value in self._mesh_cache.items() if key in used}
        for path in (self.folder/'models').glob('*.npz'):
            if path.stem not in used:path.unlink(missing_ok=True)

    def _scene_bounds(self,objects=None):
        objects=self.state['scene']['objects'] if objects is None else objects
        low=np.min([o['bounds_mm'][0] for o in objects],axis=0);high=np.max([o['bounds_mm'][1] for o in objects],axis=0)
        return low,high

    def _activate(self,item):
        """The object shown on its own in stage "object": the selected one, or the first."""
        vertices,faces=self.model(item['model_id'])
        self.state['model']={'id':item['model_id'],'object_id':item['id'],'name':item['name'],'source':self.state['scene']['name'],
                             **mesh.info(vertices,faces)}

    def _object(self,key):
        identifier(key)
        item=next((o for o in self.state['scene']['objects'] if o['id']==key),None)
        if item is None:raise Conflict('That part is no longer in the scene.')
        return item

    def _show(self):
        """Fit the presentation to what the stage shows."""
        if self.state['stage']=='object':self.state['transform']=fitted(self.state['model']['dimensions_mm'])
        else:
            low,high=self._scene_bounds();self.state['transform']=fitted((high-low).tolist())

    def _open(self,parts,name,source,actor):
        if not parts:raise ValueError('The scene needs at least one part.')
        if len(parts)>MAX_OBJECTS:raise ValueError(f'Limit a scene to {MAX_OBJECTS} parts.')
        parts=mesh.fit_scene(parts)
        self.state['scene']={'id':uuid.uuid4().hex,'name':text(name,180,'Scene name') or 'Scene','source':source,'objects':[self._store(p) for p in parts]}
        # A scene opens whole. A monolithic model (one part) is selected at once.
        objects=self.state['scene']['objects']
        self.state.update(stage='scene',selected=objects[0]['id'] if len(objects)==1 else None)
        self._forget_unused()
        self._activate(objects[0]);self._show();self._touch(actor)

    def open_scene(self,parts,name,source='Uploaded meshes',actor='Desktop'):
        """Replace the scene."""
        with self.lock:
            self._open(parts,name,source,actor);return self.snapshot()

    def add_objects(self,parts,source='Uploaded mesh',actor='Desktop',place=True):
        """Add parts to the scene. With place, they stand on the scene's floor in a row beside it; the first is
        selected."""
        with self.lock:
            objects=self.state['scene']['objects']
            if len(objects)+len(parts)>MAX_OBJECTS:raise ValueError(f'Limit a scene to {MAX_OBJECTS} parts.')
            room=mesh.SCENE_FACES-sum(o['triangles'] for o in objects)
            if room<2000*len(parts):raise ValueError('The scene is full for VR. Remove a part, or open a smaller scene.')
            parts=mesh.fit_scene(parts,room)
            added=[]
            low,high=self._scene_bounds()
            right=float(high[0])
            for part in parts:
                vertices=part['vertices'].astype(np.float64)
                if place:
                    least,most=vertices.min(axis=0),vertices.max(axis=0)
                    shift=np.array([right+10-least[0],(low[1]+high[1])/2-(least[1]+most[1])/2,low[2]-least[2]])
                    vertices=vertices+shift;right+=10+float(most[0]-least[0])
                added.append(self._store({**part,'vertices':vertices.astype(np.float32)}))
            objects.extend(added)
            self.state['selected']=added[0]['id']
            if self.state['stage']=='scene':self._activate(added[0]);self._show()
            self._touch(actor);return self.snapshot()

    def model(self,key):
        identifier(key)
        with self.lock:
            if key in self._mesh_cache:return self._mesh_cache[key]
            path=self.folder/'models'/f'{key}.npz'
            if not path.exists():raise FileNotFoundError('Model not found.')
            with np.load(path,allow_pickle=False) as data:
                vertices,faces=data['vertices'].copy(),data['faces'].copy()
            self._mesh_cache[key]=(vertices,faces)
            return vertices,faces

    def action(self,payload):
        if not isinstance(payload,dict):raise ValueError('Supply a command object.')
        actor=text(payload.get('actor','Browser'),64,'Actor')
        command=payload.get('type')
        with self.lock:
            if command=='transform':
                value=payload.get('transform',{})
                if not isinstance(value,dict):raise ValueError('Supply a transform object.')
                position=vector(value.get('position'),3,'Position',10)
                quaternion=vector(value.get('quaternion'),4,'Rotation',1)
                norm=math.sqrt(sum(q*q for q in quaternion))
                if norm<.1:raise ValueError('Rotation quaternion is empty.')
                self.state['transform']={'position':position,'quaternion':[q/norm for q in quaternion],
                                         'scale':number(value.get('scale'),.00001,1,'Display scale')}
            elif command=='select':
                key=payload.get('object_id')
                if key is None:self.state['selected']=None
                else:
                    item=self._object(key);self.state['selected']=key
                    if self.state['stage']=='scene':self._activate(item)
            elif command=='stage':
                stage=payload.get('stage')
                if stage not in ('scene','object'):raise ValueError('Choose the scene or one part.')
                if stage=='object':
                    key=payload.get('object_id',self.state['selected'])
                    if key is None:raise ValueError('Select a part to view first.')
                    item=self._object(key);self.state['selected']=key;self._activate(item)
                self.state['stage']=stage;self._show()
            elif command=='part_color':
                # How a part is shown (on every device); None puts back the plain gray.
                item=self._object(payload.get('object_id'));color=payload.get('color')
                if color is None:item.pop('color',None)
                elif isinstance(color,str) and re.fullmatch('#[a-fA-F0-9]{6}',color):item['color']=color.lower()
                else:raise ValueError('Choose a six-digit color.')
            elif command=='remove_object':
                item=self._object(payload.get('object_id'))
                objects=self.state['scene']['objects']
                if len(objects)==1:raise ValueError('A scene keeps at least one part.')
                objects.remove(item)
                if self.state['selected']==item['id']:self.state['selected']=None
                if self.state['model']['object_id']==item['id']:
                    self.state['stage']='scene';self._activate(objects[0])
                self._forget_unused();self._show()
            else:raise ValueError('Unknown workspace command.')
            self._touch(actor)
            return self.snapshot()
