import io
import re
import struct
import pytest
from vr_viewer.server import create_app,default_data_dir
from vr_viewer.workspace import Workspace
from vr_viewer import mesh
from vr_viewer.pairing import Pairing
from vr_viewer.lan import certificate

@pytest.fixture
def client(tmp_path):
    app=create_app(tmp_path);app.config['TESTING']=True
    return app.test_client()

def headers(client):
    token=re.search(rb'name="viewer-token" content="([^"]+)"',client.get('/').data).group(1).decode()
    return {'X-Viewer-Token':token}

def action(client,body):
    return client.post('/api/action',headers=headers(client),json={'model_id':client.get('/api/workspace').json['model']['id'],**body})

def test_initial_model_is_printable_and_mesh_transport_matches(client):
    result=client.get('/api/workspace');assert result.status_code==200
    model=result.json['model'];assert model['watertight'] and model['boundary_edges']==0
    data=client.get(f'/api/models/{model["id"]}/mesh').data
    magic,vertices,faces=struct.unpack_from('<4sII',data)
    assert magic==b'EVR1' and vertices==model['vertices'] and faces==model['triangles']
    assert len(data)==12+vertices*12+faces*12
    assert client.get('/').headers['Content-Security-Policy'].find("frame-ancestors 'none'")>=0








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
    first=Workspace(tmp_path);key=first.state['model']['id'];part=first.state['scene']['objects'][1]['id']
    first.action({'type':'part_color','object_id':part,'color':'#5cb85c'})
    second=Workspace(tmp_path)
    assert second.state['model']['id']==key
    assert second.state['scene']['objects'][1]['color']=='#5cb85c'


def test_data_lives_in_the_user_folder(monkeypatch,tmp_path):
    monkeypatch.delenv('VR_VIEWER_DATA',raising=False)
    assert default_data_dir().name=='vr-viewer' and 'site-packages' not in str(default_data_dir())
    monkeypatch.setenv('VR_VIEWER_DATA',str(tmp_path/'here'))
    assert default_data_dir()==tmp_path/'here'


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




def test_bad_transform_is_rejected_without_changing_state(client):
    before=client.get('/api/workspace').json
    assert action(client,{'type':'transform','transform':[]}).status_code==400
    assert client.get('/api/workspace').json==before
