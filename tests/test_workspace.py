import io
import json
import re
import struct
import uuid
import zipfile
import numpy as np
import pytest
from editor_vr.server import create_app
from editor_vr.workspace import Workspace,Conflict
from editor_vr import mesh
from editor_vr.pairing import Pairing,COOKIE
from editor_vr.lan import certificate

@pytest.fixture
def client(tmp_path):
    app=create_app(tmp_path);app.config['TESTING']=True
    return app.test_client()

def headers(client):
    token=re.search(rb'name="editor-token" content="([^"]+)"',client.get('/').data).group(1).decode()
    return {'X-Editor-Token':token}

def action(client,body):
    return client.post('/api/action',headers=headers(client),json={'model_id':client.get('/api/workspace').json['model']['id'],**body})

def mark(client,**changes):
    annotation={'id':uuid.uuid4().hex,'tool':'spray','face_ids':[0,1,2],'points':[[0,20,50]],
                'color':'#ffb86b','meaning':'Enlarge','category':'size','description':'Widen here','brush_radius_mm':6,**changes}
    response=action(client,{'type':'annotate','annotation':annotation})
    return response,annotation

def test_initial_model_is_printable_and_mesh_transport_matches(client):
    result=client.get('/api/workspace');assert result.status_code==200
    model=result.json['model'];assert model['watertight'] and model['boundary_edges']==0
    data=client.get(f'/api/models/{model["id"]}/mesh').data
    magic,vertices,faces=struct.unpack_from('<4sII',data)
    assert magic==b'EVR1' and vertices==model['vertices'] and faces==model['triangles']
    assert len(data)==12+vertices*12+faces*12
    assert client.get('/').headers['Content-Security-Policy'].find("frame-ancestors 'none'")>=0


def test_submission_packet_carries_real_face_colors_and_instructions(client):
    result,annotation=mark(client);assert result.status_code==200
    assert action(client,{'type':'settings','changes':{'description':'Increase the marked wall by 2 mm','category':'size'}}).status_code==200
    key=uuid.uuid4().hex;model=result.json['model']['id']
    submitted=client.post('/api/submit',headers=headers(client),json={'id':key,'model_id':model,'actor':'Quest headset'})
    assert submitted.status_code==200,submitted.json
    record=submitted.json['requests'][0];assert record['status']=='queued' and record['face_count']==3
    packet=client.get(record['packet_url']);assert packet.status_code==200
    with zipfile.ZipFile(io.BytesIO(packet.data)) as archive:
        assert set(archive.namelist())=={'model.stl','annotated.glb','annotations.json','README.txt'}
        metadata=json.loads(archive.read('annotations.json'));assert metadata['instruction']=='Increase the marked wall by 2 mm'
        assert metadata['annotations'][0]['face_ids']==[0,1,2]
        glb=archive.read('annotated.glb');assert struct.unpack_from('<4sII',glb)==(b'glTF',2,len(glb))
        length,kind=struct.unpack_from('<I4s',glb,12);assert kind==b'JSON'
        gltf=json.loads(glb[20:20+length]);assert gltf['meshes'][0]['extras']['annotations'][0]['id']==annotation['id']
        offset=20+length+8;view=gltf['bufferViews'][1]
        colors=np.frombuffer(glb,dtype='<f4',count=12,offset=offset+view['byteOffset'])
        assert colors[:4]==pytest.approx([1,184/255,107/255,1])
    repeat=client.post('/api/submit',headers=headers(client),json={'id':key,'model_id':model})
    assert len(repeat.json['requests'])==1
    assert action(client,{'type':'clear'}).json['annotations']==[]
    assert client.get(record['packet_url']).data==packet.data, 'Submitted snapshots must stay immutable'
    reviewed=action(client,{'type':'review','request_id':key});assert reviewed.json['requests'][0]['status']=='reviewed'


def test_model_replacement_preserves_submitted_packets_but_rejects_old_strokes(client):
    mark(client);state=client.get('/api/workspace').json
    action(client,{'type':'settings','changes':{'description':'Make this rounder'}})
    submitted=client.post('/api/submit',headers=headers(client),json={'id':uuid.uuid4().hex,'model_id':state['model']['id']}).json
    record=submitted['requests'][0]
    replaced=client.post('/api/demo',headers=headers(client),json={}).json
    assert replaced['model']['id']!=state['model']['id'] and not replaced['annotations']
    assert replaced['requests'][0]['id']==record['id']
    stale=client.post('/api/action',headers=headers(client),json={'type':'undo','model_id':state['model']['id']})
    assert stale.status_code==409
    assert client.get(record['packet_url']).status_code==200


def test_annotations_are_idempotent_and_ruler_uses_mm(client):
    result,annotation=mark(client,tool='measure',points=[[1,2,3],[4,6,3]],face_ids=[0,1])
    assert result.json['annotations'][0]['distance_mm']==5
    repeat=action(client,{'type':'annotate','annotation':annotation})
    assert len(repeat.json['annotations'])==1
    assert action(client,{'type':'undo'}).json['annotations']==[]


@pytest.mark.parametrize('changes',[
 {'face_ids':[-1]},{'face_ids':[9999999]},{'face_ids':[True]},{'points':[[float('nan'),0,0]]},
 {'points':[]},{'tool':'unknown'},{'color':'red'},{'category':'other'},
 {'tool':'box','bounds_mm':[[5,0,0],[0,2,3]]},{'tool':'measure','points':[[0,0,0]]},
])
def test_invalid_annotations_do_not_mutate_state(client,changes):
    revision=client.get('/api/workspace').json['revision']
    response,_=mark(client,**changes);assert response.status_code==400
    assert client.get('/api/workspace').json['revision']==revision


@pytest.mark.parametrize('changes',[{'mode':'unknown'},{'brush_radius_mm':float('inf')},{'brush_radius_mm':False},{'description':'a'*2001},{'unknown':1}])
def test_invalid_settings(client,changes):
    assert action(client,{'type':'settings','changes':changes}).status_code==400


def test_print_upload_units_and_mesh_validation(client):
    obj=b'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'
    response=client.post('/api/models',headers=headers(client),data={'model':(io.BytesIO(obj),'../triangle.obj'),'units':'cm','mode':'open'})
    assert response.status_code==200
    assert response.json['scene']['name']=='triangle' and response.json['model']['name']=='triangle'
    assert response.json['model']['dimensions_mm']==[10,10,0]
    assert not response.json['model']['watertight']
    bad=client.post('/api/models',headers=headers(client),data={'model':(io.BytesIO(b'bad'),'x.stl')})
    assert bad.status_code==400
    assert client.get('/api/workspace').json['model']['name']=='triangle'


def test_source_stl_roundtrip_and_negative_obj_indices():
    vertices,faces=mesh.demo();out=mesh.stl_bytes(vertices,faces)
    a,b=mesh.load_model(out,'demo.stl')
    assert mesh.info(a,b)['watertight']
    assert len(b)==len(faces)
    a,b=mesh.load_model(b'v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1','t.obj')
    assert len(b)==1


def test_workspace_survives_restart(tmp_path):
    first=Workspace(tmp_path);key=first.state['model']['id']
    first.action({'type':'settings','changes':{'description':'Keep this instruction'}})
    second=Workspace(tmp_path)
    assert second.state['model']['id']==key
    assert second.state['settings']['description']=='Keep this instruction'


def test_local_boundary_and_pairing(client,tmp_path):
    assert client.post('/api/action',json={}).status_code==403
    assert client.post('/api/action',headers={**headers(client),'Origin':'https://foreign.example'},json={}).status_code==403
    assert client.get('/',headers={'Host':'foreign.example'}).status_code==400
    app=client.application;app.config['PAIRING']=Pairing(tmp_path/'pair',pin='123456')
    remote={'REMOTE_ADDR':'192.168.1.22'}
    assert client.get('/',environ_overrides=remote).status_code==302
    assert client.get('/api/workspace',environ_overrides=remote).status_code==401
    assert client.get('/pair',environ_overrides=remote).status_code==200
    assert client.post('/api/pair',environ_overrides=remote,json={'pin':'000000'}).status_code==403
    response=client.post('/api/pair',environ_overrides=remote,json={'pin':'123456'})
    assert response.status_code==200
    assert client.get('/api/workspace',environ_overrides=remote).status_code==200
    contents=(tmp_path/'pair'/'paired.json').read_text()
    assert '123456' not in contents


def test_certificate_covers_lan_addresses_and_is_reused(tmp_path):
    from cryptography import x509
    a,b=certificate(tmp_path,['localhost','127.0.0.1','192.168.1.42'])
    cert=x509.load_pem_x509_certificate(a.read_bytes())
    san=cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert '192.168.1.42' in [str(value) for value in san.get_values_for_type(x509.IPAddress)]
    before=a.read_bytes();assert certificate(tmp_path,['localhost','127.0.0.1','192.168.1.42'])==(a,b)
    assert a.read_bytes()==before


def test_unused_region_fields_cannot_poison_a_pin(client):
    response,_=mark(client,tool='pin',bounds_mm=[float('nan')])
    assert response.status_code==200
    assert response.json['annotations'][0]['bounds_mm'] is None
    assert client.get('/api/workspace').status_code==200


def test_bad_transform_is_rejected_without_changing_state(client):
    before=client.get('/api/workspace').json
    assert action(client,{'type':'transform','transform':[]}).status_code==400
    assert client.get('/api/workspace').json==before
