"""Authoritative shared workspace. Commands are serialized; submissions are immutable packets."""
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


class Workspace:
    def __init__(self,folder):
        self.folder=Path(folder); self.folder.mkdir(parents=True,exist_ok=True)
        (self.folder/'models').mkdir(exist_ok=True); (self.folder/'requests').mkdir(exist_ok=True)
        self.lock=RLock(); self.path=self.folder/'workspace.json';self._mesh_cache={}
        if self.path.exists():
            self.state=json.loads(self.path.read_text())
            self.model(self.state['model']['id'])
        else:
            self.state={'schema':1,'revision':0,'settings':deepcopy(DEFAULT_SETTINGS),'annotations':[],'requests':[]}
            self._install(*mesh.demo(),name='Fluted study vessel',source='Built-in print model')

    def snapshot(self):
        with self.lock:return deepcopy(self.state)

    def _save(self):
        temporary=self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.state,allow_nan=False),encoding='utf-8')
        temporary.replace(self.path)

    def _touch(self,actor):
        self.state['revision']+=1;self.state['updated_at']=now();self.state['updated_by']=actor[:64]
        self._save()

    def _install(self,vertices,faces,name,source):
        key=uuid.uuid4().hex
        np.savez_compressed(self.folder/'models'/f'{key}.npz',vertices=vertices,faces=faces)
        self._mesh_cache={key:(vertices,faces)}
        summary=mesh.info(vertices,faces)
        self.state.update(model={'id':key,'name':name,'source':source,**summary},annotations=[])
        self.state['transform']={'position':[0,1.12,-.85],'quaternion':[0,0,0,1],
                                 'scale':.55/max(summary['dimensions_mm'])}
        self._touch('Desktop')

    def install(self,vertices,faces,name,source='Uploaded mesh'):
        with self.lock:
            self._install(vertices,faces,text(name,180,'Model name'),source)
            return self.snapshot()

    def model(self,key):
        identifier(key)
        with self.lock:
            if key in self._mesh_cache:return self._mesh_cache[key]
            path=self.folder/'models'/f'{key}.npz'
            if not path.exists():raise FileNotFoundError('Model not found.')
            with np.load(path,allow_pickle=False) as data:
                vertices,faces=data['vertices'].copy(),data['faces'].copy()
            if len(self._mesh_cache)>3:self._mesh_cache.clear()
            self._mesh_cache[key]=(vertices,faces)
            return vertices,faces

    def _check_model(self,payload):
        if payload.get('model_id')!=self.state['model']['id']:
            raise Conflict('The model changed on the computer. Your selection was not applied; load the current model and try again.')

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

    def _annotation(self,payload,actor):
        value=payload.get('annotation')
        if not isinstance(value,dict):raise ValueError('Supply an annotation.')
        key=identifier(value.get('id'))
        if any(a['id']==key for a in self.state['annotations']):return None
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
        result={'id':key,'tool':tool,'face_ids':sorted(set(faces)),'points':samples,'bounds_mm':bounds,
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
            else:
                self._check_model(payload)
                if command=='transform':
                    value=payload.get('transform',{})
                    if not isinstance(value,dict):raise ValueError('Supply a transform object.')
                    position=vector(value.get('position'),3,'Position',10)
                    quaternion=vector(value.get('quaternion'),4,'Rotation',1)
                    norm=math.sqrt(sum(q*q for q in quaternion))
                    if norm<.1:raise ValueError('Rotation quaternion is empty.')
                    self.state['transform']={'position':position,'quaternion':[q/norm for q in quaternion],
                                             'scale':number(value.get('scale'),.00001,1,'Display scale')}
                elif command=='annotate':
                    if len(self.state['annotations'])>=250:raise ValueError('This draft has 250 marks. Submit or clear it first.')
                    annotation=self._annotation(payload,actor)
                    if annotation is None:return self.snapshot()
                    self.state['annotations'].append(annotation)
                elif command=='remove':
                    key=identifier(payload.get('annotation_id'))
                    self.state['annotations']=[a for a in self.state['annotations'] if a['id']!=key]
                elif command=='undo':
                    if self.state['annotations']:self.state['annotations'].pop()
                elif command=='clear':self.state['annotations']=[]
                elif command=='review':
                    key=identifier(payload.get('request_id'))
                    record=next((r for r in self.state['requests'] if r['id']==key),None)
                    if not record:raise ValueError('Request not found.')
                    record['status']='reviewed';record['reviewed_at']=now()
                else:raise ValueError('Unknown workspace command.')
            self._touch(actor)
            return self.snapshot()

    def submit(self,payload):
        if not isinstance(payload,dict):raise ValueError('Supply an edit request.')
        with self.lock:
            self._check_model(payload)
            key=identifier(payload.get('id'))
            if any(r['id']==key for r in self.state['requests']):return self.snapshot()
            description=text(payload.get('description',self.state['settings']['description']),2000,'Instruction')
            if not description:raise ValueError('Describe the change before submitting.')
            if not self.state['annotations']:raise ValueError('Mark an area on the model before submitting.')
            if len(self.state['requests'])>=200:raise ValueError('This workspace has 200 requests. Archive it before continuing.')
            record={'id':key,'model_id':self.state['model']['id'],'model_name':self.state['model']['name'],
                    'description':description,'category':self.state['settings']['category'],
                    'mark_count':len(self.state['annotations']),
                    'face_count':len(set(i for a in self.state['annotations'] for i in a['face_ids'])),
                    'status':'queued','created_at':now(),'author':text(payload.get('actor','Browser'),64,'Actor'),
                    'packet_url':f'/api/requests/{key}/packet','glb_url':f'/api/requests/{key}/model.glb'}
            vertices,faces=self.model(record['model_id'])
            metadata={'name':record['model_name'],'model_id':record['model_id'],'request_id':key,
                      'instruction':description,'category':record['category'],'created_at':record['created_at'],
                      'processing':'placeholder: no geometry edits performed'}
            annotations=deepcopy(self.state['annotations'])
            (self.folder/'requests'/f'{key}.zip').write_bytes(mesh.packet(vertices,faces,annotations,metadata))
            (self.folder/'requests'/f'{key}.glb').write_bytes(mesh.annotated_glb(vertices,faces,annotations,metadata))
            self.state['requests'].insert(0,record)
            self._touch(record['author'])
            return self.snapshot()

    def export(self,kind):
        with self.lock:
            vertices,faces=self.model(self.state['model']['id'])
            metadata={'name':self.state['model']['name'],'model_id':self.state['model']['id'],
                      'instruction':self.state['settings']['description'],'processing':'annotation draft only'}
            if kind=='glb':return mesh.annotated_glb(vertices,faces,self.state['annotations'],metadata)
            return mesh.packet(vertices,faces,self.state['annotations'],metadata)
