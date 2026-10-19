"""Authoritative shared workspace. Commands are serialized; submissions are immutable packets.

The workspace holds a scene of named objects (the parts of a Visualizer project, or uploaded meshes). It is viewed
whole (stage "scene"), where objects are selected and added, or one object at a time (stage "object"), where it is
marked up and edit requests are made for it. Marks belong to their object's mesh and wait there while others are
edited."""
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

TOOLS=('spray','box','pin','measure','erase')
CATEGORIES=('size','texture','pattern','general')
DEFAULT_SETTINGS={'mode':'inspect','tool':'spray','color':'#ffb86b','meaning':'Add or enlarge',
                  'category':'size','description':'','brush_radius_mm':6}


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


def fitted(dimensions):
    """The shared presentation: whatever is shown, about 55 cm across on the table."""
    return {**deepcopy(TABLE),'scale':.55/max(max(dimensions),1e-6)}


class Workspace:
    def __init__(self,folder):
        self.folder=Path(folder); self.folder.mkdir(parents=True,exist_ok=True)
        (self.folder/'models').mkdir(exist_ok=True); (self.folder/'requests').mkdir(exist_ok=True)
        self.lock=RLock(); self.path=self.folder/'workspace.json';self._mesh_cache={}
        if self.path.exists():
            self.state=self._migrated(json.loads(self.path.read_text()))
            for item in self.state['scene']['objects']:self.model(item['model_id'])
        else:
            self.state={'schema':2,'revision':0,'settings':deepcopy(DEFAULT_SETTINGS),'marks':[],'requests':[]}
            self._open(mesh.demo_scene(),'Fluted study vessel','Built-in scene','Desktop')

    @staticmethod
    def _migrated(state):
        """A one-model workspace (schema 1) becomes a scene of that one object, keeping its marks."""
        if state.get('schema')==2:return state
        model=state['model'];key=uuid.uuid4().hex
        item={'id':key,'name':model['name'],'category':None,'print_file':None,'model_id':model['id'],
              'source_triangles':model['triangles'],**{k:model[k] for k in ('triangles','dimensions_mm','bounds_mm','watertight')}}
        state.update(schema=2,scene={'id':uuid.uuid4().hex,'name':model['name'],'source':model.get('source','Uploaded mesh'),'objects':[item]},
                     stage='object',selected=key,marks=[{**a,'model_id':model['id']} for a in state.pop('annotations',[])])
        state['model']={**model,'object_id':key}
        return state

    def snapshot(self):
        """The state, with `annotations` as the marks on the object being edited (or selected)."""
        with self.lock:
            state=deepcopy(self.state);key=state['model']['id']
            state['annotations']=[a for a in state.pop('marks') if a['model_id']==key]
            counts={}
            for mark in self.state['marks']:counts[mark['model_id']]=counts.get(mark['model_id'],0)+1
            for item in state['scene']['objects']:item['marks']=counts.get(item['model_id'],0)
            return state

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
                'print_file':part.get('print_file'),'model_id':key,'source_triangles':part.get('source_triangles',summary['triangles']),
                **{k:summary[k] for k in ('triangles','dimensions_mm','bounds_mm','watertight')}}

    def _scene_bounds(self,objects=None):
        objects=self.state['scene']['objects'] if objects is None else objects
        low=np.min([o['bounds_mm'][0] for o in objects],axis=0);high=np.max([o['bounds_mm'][1] for o in objects],axis=0)
        return low,high

    def _activate(self,item):
        """The object whose mesh is marked and whose requests are made: the selected one, or the first."""
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
        # A scene opens for viewing. A monolithic model (one part) is selected at once, so Edit is the next step.
        objects=self.state['scene']['objects']
        self.state.update(stage='scene',selected=objects[0]['id'] if len(objects)==1 else None,marks=[])
        self._mesh_cache={o['model_id']:self._mesh_cache[o['model_id']] for o in self.state['scene']['objects']}
        self._activate(self.state['scene']['objects'][0]);self._show();self._touch(actor)

    def open_scene(self,parts,name,source='Uploaded meshes',actor='Desktop'):
        """Replace the scene (draft marks go; submitted requests keep their own copies)."""
        with self.lock:
            self._open(parts,name,source,actor);return self.snapshot()

    def install(self,vertices,faces,name,source='Uploaded mesh'):
        """A scene of one mesh."""
        return self.open_scene([mesh.part_record(name,vertices,faces)],name,source)

    def add_objects(self,parts,source='Uploaded mesh',actor='Desktop',place=True):
        """Add parts to the scene. With place, they stand on the scene's floor in a row beside it (a print file is
        oriented to print, not placed in the assembly); the first is selected."""
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

    def _check_model(self,payload):
        if payload.get('model_id')!=self.state['model']['id']:
            raise Conflict('The part being edited changed. Your selection was not applied; try again on the current part.')

    def _settings(self,changes):
        if not isinstance(changes,dict) or set(changes)-set(DEFAULT_SETTINGS): raise ValueError('Unknown tool setting.')
        result=deepcopy(self.state['settings'])
        for key,value in changes.items():
            if key=='mode' and value not in ('inspect','edit'):raise ValueError('Choose inspect or edit mode.')
            if key=='tool' and value not in TOOLS:raise ValueError('Choose an available tool.')
            if key=='category' and value not in CATEGORIES:raise ValueError('Choose an edit category.')
            if key=='color' and (not isinstance(value,str) or not re.fullmatch('#[a-fA-F0-9]{6}',value)):raise ValueError('Choose a six-digit color.')
            if key=='brush_radius_mm':value=number(value,.2,100,'Brush radius')
            if key in ('description','meaning'):value=text(value,2000 if key=='description' else 80,key)
            result[key]=value
        return result

    def _active_marks(self):
        return [a for a in self.state['marks'] if a['model_id']==self.state['model']['id']]

    def _annotation(self,payload,actor):
        value=payload.get('annotation')
        if not isinstance(value,dict):raise ValueError('Supply an annotation.')
        key=identifier(value.get('id'))
        if any(a['id']==key for a in self.state['marks']):return None
        tool=value.get('tool')
        if tool not in TOOLS[:-1]:raise ValueError('Choose a selection tool.')
        settings=self._settings({k:value[k] for k in ('color','meaning','category','description','brush_radius_mm') if k in value})
        faces=value.get('face_ids')
        if not isinstance(faces,list) or not 1<=len(faces)<=mesh.MAX_FACES:raise ValueError('An annotation needs selected faces.')
        count=self.state['model']['triangles']
        if any(isinstance(i,bool) or not isinstance(i,int) or not 0<=i<count for i in faces):raise ValueError('Selection refers to a missing face.')
        samples=value.get('points',[])
        if not isinstance(samples,list) or not 1<=len(samples)<=4096:raise ValueError('Supply 1–4096 model-space selection points.')
        samples=[vector(p,3,'Sample point') for p in samples]
        bounds=None
        if tool=='box':
            bounds=value.get('bounds_mm')
            if not isinstance(bounds,list) or len(bounds)!=2:raise ValueError('Supply both corners of the 3D region.')
            bounds=[vector(p,3,'Region corner') for p in bounds]
            if any(a>b for a,b in zip(*bounds)):raise ValueError('Region corners must be ordered min to max.')
        if tool=='measure' and len(samples)!=2:raise ValueError('A ruler needs exactly two endpoints.')
        result={'id':key,'tool':tool,'model_id':self.state['model']['id'],'face_ids':sorted(set(faces)),'points':samples,'bounds_mm':bounds,
                'color':settings['color'],'meaning':settings['meaning'],'category':settings['category'],
                'description':settings['description'],'brush_radius_mm':settings['brush_radius_mm'],
                'created_at':now(),'author':actor}
        if tool=='measure':result['distance_mm']=math.dist(*samples)
        return result

    def action(self,payload):
        if not isinstance(payload,dict):raise ValueError('Supply a command object.')
        actor=text(payload.get('actor','Browser'),64,'Actor')
        command=payload.get('type')
        with self.lock:
            if command=='settings':self.state['settings']=self._settings(payload.get('changes'))
            elif command=='transform':
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
                    if key is None:raise ValueError('Select a part to edit first.')
                    item=self._object(key);self.state['selected']=key;self._activate(item)
                self.state['stage']=stage;self._show()
            elif command=='part_color':
                # How a part is shown (on every device); None puts back the plain gray. Its marks keep their own colors.
                item=self._object(payload.get('object_id'));color=payload.get('color')
                if color is None:item.pop('color',None)
                elif isinstance(color,str) and re.fullmatch('#[a-fA-F0-9]{6}',color):item['color']=color.lower()
                else:raise ValueError('Choose a six-digit color.')
            elif command=='remove_object':
                item=self._object(payload.get('object_id'))
                objects=self.state['scene']['objects']
                if len(objects)==1:raise ValueError('A scene keeps at least one part.')
                objects.remove(item)
                self.state['marks']=[a for a in self.state['marks'] if a['model_id']!=item['model_id']]
                if self.state['selected']==item['id']:self.state['selected']=None
                if self.state['model']['object_id']==item['id']:
                    self.state['stage']='scene';self._activate(objects[0])
                self._show()
            elif command=='review':
                key=identifier(payload.get('request_id'))
                record=next((r for r in self.state['requests'] if r['id']==key),None)
                if not record:raise ValueError('Request not found.')
                record['status']='reviewed';record['reviewed_at']=now()
            else:
                self._check_model(payload)
                marks=self._active_marks()
                if command=='annotate':
                    if len(marks)>=250:raise ValueError('This part has 250 marks. Submit or clear them first.')
                    annotation=self._annotation(payload,actor)
                    if annotation is None:return self.snapshot()
                    self.state['marks'].append(annotation)
                elif command=='remove':
                    key=identifier(payload.get('annotation_id'))
                    self.state['marks']=[a for a in self.state['marks'] if a['id']!=key]
                elif command=='undo':
                    if marks:self.state['marks'].remove(marks[-1])
                elif command=='clear':self.state['marks']=[a for a in self.state['marks'] if a not in marks]
                else:raise ValueError('Unknown workspace command.')
            self._touch(actor)
            return self.snapshot()

    def _metadata(self,extra=None):
        model=self.state['model'];item=self._object(model['object_id'])
        return {'name':item['name'],'model_id':model['id'],'object_id':item['id'],'scene':self.state['scene']['name'],
                'part_category':item['category'],'print_file':item['print_file'],
                'source_triangles':item['source_triangles'],'simplified_for_vr':item['source_triangles']!=item['triangles'],**(extra or {})}

    def submit(self,payload):
        if not isinstance(payload,dict):raise ValueError('Supply an edit request.')
        with self.lock:
            self._check_model(payload)
            key=identifier(payload.get('id'))
            if any(r['id']==key for r in self.state['requests']):return self.snapshot()
            description=text(payload.get('description',self.state['settings']['description']),2000,'Instruction')
            if not description:raise ValueError('Describe the change before submitting.')
            marks=self._active_marks()
            if not marks:raise ValueError('Mark an area on the part before submitting.')
            if len(self.state['requests'])>=200:raise ValueError('This workspace has 200 requests. Archive it before continuing.')
            item=self._object(self.state['model']['object_id'])
            record={'id':key,'model_id':self.state['model']['id'],'model_name':item['name'],'object_id':item['id'],
                    'scene':self.state['scene']['name'],'print_file':item['print_file'],
                    'description':description,'category':self.state['settings']['category'],
                    'mark_count':len(marks),'face_count':len(set(i for a in marks for i in a['face_ids'])),
                    'status':'queued','created_at':now(),'author':text(payload.get('actor','Browser'),64,'Actor'),
                    'packet_url':f'/api/requests/{key}/packet','glb_url':f'/api/requests/{key}/model.glb'}
            vertices,faces=self.model(record['model_id'])
            metadata=self._metadata({'request_id':key,'instruction':description,'category':record['category'],'created_at':record['created_at'],
                                     'processing':'placeholder: no geometry edits performed'})
            annotations=deepcopy(marks)
            (self.folder/'requests'/f'{key}.zip').write_bytes(mesh.packet(vertices,faces,annotations,metadata))
            (self.folder/'requests'/f'{key}.glb').write_bytes(mesh.annotated_glb(vertices,faces,annotations,metadata))
            self.state['requests'].insert(0,record)
            self._touch(record['author'])
            return self.snapshot()

    def export(self,kind):
        with self.lock:
            vertices,faces=self.model(self.state['model']['id'])
            metadata=self._metadata({'instruction':self.state['settings']['description'],'processing':'annotation draft only'})
            if kind=='glb':return mesh.annotated_glb(vertices,faces,self._active_marks(),metadata)
            return mesh.packet(vertices,faces,self._active_marks(),metadata)
