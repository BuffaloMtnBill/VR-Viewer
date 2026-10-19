"""Scenes of parts, as the Visualizer sees a model: loading them, editing one part at a time, and model projects."""
import io
import json
import re
import uuid
import zipfile

import numpy as np
import pytest

from editor_vr import mesh
from editor_vr.server import create_app
from editor_vr.workspace import Workspace


def cube(size=10, at=(0, 0, 0)):
    corners = np.array([[x, y, z] for x in (0, size) for y in (0, size) for z in (0, size)], float) + at
    faces = [(0, 1, 3), (0, 3, 2), (4, 6, 7), (4, 7, 5), (0, 4, 5), (0, 5, 1), (2, 3, 7), (2, 7, 6), (0, 2, 6), (0, 6, 4), (1, 5, 7), (1, 7, 3)]
    return corners, np.array(faces)


def binary_stl(*meshes):
    triangles = np.concatenate([v[f] for v, f in meshes])
    return mesh.stl_bytes(triangles.reshape(-1, 3), np.arange(len(triangles) * 3).reshape(-1, 3))


def three_mf(objects, unit='millimeter'):
    """objects: (name, vertices, faces, transform or None, category, print file)."""
    body = []
    for k, (name, v, f, _, category, printfile) in enumerate(objects, 1):
        meta = ''.join(f'<m:metadata name="vis:{key}">{value}</m:metadata>' for key, value in (('category', category), ('printfile', printfile)) if value)
        body.append(f'<object id="{k}" name="{name}" type="model">' + (f'<m:metadatagroup>{meta}</m:metadatagroup>' if meta else '')
                    + '<mesh><vertices>' + ''.join(f'<vertex x="{x}" y="{y}" z="{z}"/>' for x, y, z in v)
                    + '</vertices><triangles>' + ''.join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in f) + '</triangles></mesh></object>')
    items = ''.join(f'<item objectid="{k}"' + (f' transform="{t}"' if t else '') + '/>' for k, (_, _, _, t, _, _) in enumerate(objects, 1))
    xml = (f'<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="urn:visualizer:print" unit="{unit}">'
           f'<resources>{"".join(body)}</resources><build>{items}</build></model>')
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as archive: archive.writestr('3D/3dmodel.model', xml)
    return out.getvalue()


def test_an_unnamed_stl_splits_into_its_separate_pieces():
    parts = mesh.load_parts(binary_stl(cube(), cube(at=(20, 0, 0))), 'two_cubes.stl')
    assert [p['name'] for p in parts] == ['two cubes 1', 'two cubes 2']
    assert all(len(p['faces']) == 12 and mesh.info(p['vertices'], p['faces'])['watertight'] for p in parts)
    assert parts[1]['vertices'][:, 0].min() == 20
    assert len(mesh.load_parts(binary_stl(cube(), cube(at=(20, 0, 0))), 'print.stl', split=False)) == 1


def test_named_ascii_solids_and_obj_groups_are_parts():
    v, f = cube()
    def solid(name): return f'solid {name}\n' + ''.join('facet normal 0 0 0\nouter loop\n' + ''.join(f'vertex {x} {y} {z}\n' for x, y, z in v[t]) + 'endloop\nendfacet\n' for t in f) + f'endsolid {name}\n'
    parts = mesh.load_parts((solid('Lid') + solid('Base')).encode(), 'box.stl')
    assert [p['name'] for p in parts] == ['Lid', 'Base']
    obj = 'o Body\n' + ''.join(f'v {x} {y} {z}\n' for x, y, z in v) + ''.join(f'f {a+1} {b+1} {c+1}\n' for a, b, c in f[:6]) + 'g Cap\n' + ''.join(f'f {a+1} {b+1} {c+1}\n' for a, b, c in f[6:])
    assert [p['name'] for p in mesh.load_parts(obj.encode(), 'thing.obj')] == ['Body', 'Cap']


def test_a_visualizer_3mf_keeps_names_categories_print_files_and_placement():
    v, f = cube()
    data = three_mf([('Tower', v, f, None, 'Walls', '../stl/tower.stl'), ('Flag', v, f, '1 0 0 0 1 0 0 0 1 30 0 5', None, None)], unit='centimeter')
    tower, flag = mesh.load_parts(data, 'castle_assembled.3mf', units='m')   # a 3MF states its own unit
    assert (tower['name'], tower['category'], tower['print_file']) == ('Tower', 'Walls', '../stl/tower.stl')
    assert flag['category'] is None and np.allclose(flag['vertices'].min(axis=0), [300, 0, 50]) and np.allclose(np.ptp(flag['vertices'], axis=0), 100)


def test_large_parts_are_simplified_for_vr_and_the_scene_fits_its_budget():
    sphere_v, sphere_f = [], []
    rings, steps = 120, 240   # about 57,000 triangles
    for i in range(rings + 1):
        for j in range(steps):
            a, b = np.pi * i / rings, 2 * np.pi * j / steps
            sphere_v.append((50 * np.sin(a) * np.cos(b), 50 * np.sin(a) * np.sin(b), 50 * np.cos(a)))
    for i in range(rings):
        for j in range(steps):
            p, q, r, s = i * steps + j, i * steps + (j + 1) % steps, (i + 1) * steps + (j + 1) % steps, (i + 1) * steps + j
            sphere_f += [(p, q, r), (p, r, s)]
    part = mesh.part_record('Ball', np.array(sphere_v), np.array(sphere_f), budget=10_000)
    assert len(part['faces']) <= 10_000 and part['source_triangles'] > 50_000
    assert np.ptp(part['vertices'], axis=0).max() == pytest.approx(100, rel=.03), 'The shape keeps its size'
    fitted = mesh.fit_scene([part, part], budget=8_000)
    assert sum(len(p['faces']) for p in fitted) <= 8_000 and fitted[0]['source_triangles'] == part['source_triangles']


def test_the_scene_stage_selection_and_marks_belong_to_each_part(tmp_path):
    w = Workspace(tmp_path)
    vessel, stand = w.state['scene']['objects']
    assert w.state['stage'] == 'scene' and w.state['selected'] is None
    with pytest.raises(ValueError, match='Select a part'): w.action({'type': 'stage', 'stage': 'object'})
    w.action({'type': 'select', 'object_id': stand['id']})
    state = w.action({'type': 'stage', 'stage': 'object'})
    assert state['model']['id'] == stand['model_id'] and state['model']['name'] == 'Stand'
    assert state['transform']['scale'] == pytest.approx(.55 / 80), 'The part alone fills the table'
    mark = {'id': uuid.uuid4().hex, 'tool': 'pin', 'face_ids': [0], 'points': [[0, 0, 0]], 'color': '#ffb86b', 'meaning': 'Here', 'category': 'size', 'description': '', 'brush_radius_mm': 6}
    w.action({'type': 'annotate', 'model_id': stand['model_id'], 'annotation': mark})
    # Another part: its own (empty) marks; the stand's wait, counted in the scene.
    state = w.action({'type': 'stage', 'stage': 'object', 'object_id': vessel['id']})
    assert state['model']['name'] == 'Fluted vessel' and state['annotations'] == []
    assert {o['name']: o['marks'] for o in state['scene']['objects']} == {'Fluted vessel': 0, 'Stand': 1}
    with pytest.raises(ValueError, match='part being edited changed'):
        w.action({'type': 'annotate', 'model_id': stand['model_id'], 'annotation': {**mark, 'id': uuid.uuid4().hex}})
    state = w.action({'type': 'stage', 'stage': 'object', 'object_id': stand['id']})
    assert len(state['annotations']) == 1
    w.action({'type': 'settings', 'changes': {'description': 'Thicken the rim'}})
    state = w.submit({'id': uuid.uuid4().hex, 'model_id': stand['model_id'], 'description': 'Thicken the rim'})
    request = state['requests'][0]
    assert (request['model_name'], request['object_id'], request['scene']) == ('Stand', stand['id'], 'Fluted study vessel')
    with zipfile.ZipFile(tmp_path / 'requests' / f"{request['id']}.zip") as archive:
        packet = json.loads(archive.read('annotations.json'))
    assert packet['name'] == 'Stand' and packet['scene'] == 'Fluted study vessel' and packet['simplified_for_vr'] is False
    assert w.action({'type': 'stage', 'stage': 'scene'})['transform']['scale'] == pytest.approx(.55 / 102)


def test_added_parts_stand_beside_the_scene_and_parts_can_be_removed(tmp_path):
    w = Workspace(tmp_path)
    v, f = cube(20)
    state = w.add_objects([mesh.part_record('Block', v, f), mesh.part_record('Block', v, f)])
    block, second = state['scene']['objects'][2:]
    assert state['selected'] == block['id'] and block['name'] == 'Block'
    assert block['bounds_mm'][0][0] == pytest.approx(40 + 10) and block['bounds_mm'][0][2] == pytest.approx(-12), 'On the floor, right of the scene'
    assert second['bounds_mm'][0][0] == pytest.approx(block['bounds_mm'][1][0] + 10)
    state = w.action({'type': 'remove_object', 'object_id': block['id']})
    assert [o['name'] for o in state['scene']['objects']] == ['Fluted vessel', 'Stand', 'Block'] and state['selected'] is None
    for item in state['scene']['objects'][1:]: w.action({'type': 'remove_object', 'object_id': item['id']})
    with pytest.raises(ValueError, match='at least one part'):
        w.action({'type': 'remove_object', 'object_id': state['scene']['objects'][0]['id']})


def test_a_monolithic_model_opens_for_viewing_with_its_part_selected(tmp_path):
    w = Workspace(tmp_path)
    v, f = cube(20)
    state = w.open_scene([mesh.part_record('Trophy', v, f)], 'Trophy')
    assert state['stage'] == 'scene' and state['selected'] == state['scene']['objects'][0]['id'], 'View mode, ready to Edit'
    state = w.open_scene([mesh.part_record('A', v, f), mesh.part_record('B', *cube(5, (30, 0, 0)))], 'Two')
    assert state['stage'] == 'scene' and state['selected'] is None, 'With several parts, you choose'


def test_a_part_can_be_colored_on_every_device_and_put_back_to_gray(tmp_path):
    w = Workspace(tmp_path)
    vessel, stand = w.snapshot()['scene']['objects']
    state = w.action({'type': 'part_color', 'object_id': stand['id'], 'color': '#3A7BD5'})
    assert state['scene']['objects'][1]['color'] == '#3a7bd5' and 'color' not in state['scene']['objects'][0]
    assert Workspace(tmp_path).snapshot()['scene']['objects'][1]['color'] == '#3a7bd5', 'Kept with the workspace'
    for bad in ('blue', '#12345', 3):
        with pytest.raises(ValueError, match='six-digit'):
            w.action({'type': 'part_color', 'object_id': stand['id'], 'color': bad})
    state = w.action({'type': 'part_color', 'object_id': stand['id'], 'color': None})
    assert 'color' not in state['scene']['objects'][1]


def test_a_one_model_workspace_becomes_a_scene_of_that_part(tmp_path):
    w = Workspace(tmp_path)
    old = {'schema': 1, 'revision': 3, 'settings': w.state['settings'], 'requests': [], 'transform': w.state['transform'],
           'model': {**w.state['model'], 'name': 'Old vase', 'source': 'Uploaded mesh'},
           'annotations': [{'id': uuid.uuid4().hex, 'tool': 'pin', 'face_ids': [1], 'points': [[0, 0, 0]]}]}
    old['model'].pop('object_id')
    (tmp_path / 'workspace.json').write_text(json.dumps(old))
    state = Workspace(tmp_path).snapshot()
    assert [o['name'] for o in state['scene']['objects']] == ['Old vase'] and state['stage'] == 'object'
    assert len(state['annotations']) == 1 and state['model']['object_id'] == state['selected']


@pytest.fixture
def projects(tmp_path):
    root = tmp_path / 'Models'
    (root / 'Castle' / 'preview').mkdir(parents=True); (root / 'Castle' / 'stl').mkdir()
    v, f = cube()
    (root / 'Castle' / 'preview' / 'castle_assembled.3mf').write_bytes(three_mf([('Tower', v, f, None, 'Walls', '../stl/tower.stl'), ('Gate', v, f, '1 0 0 0 1 0 0 0 1 20 0 0', 'Doors', None)]))
    (root / 'Castle' / 'stl' / 'tower.stl').write_bytes(binary_stl(cube()))
    (root / 'Castle' / 'stl' / 'flag.stl').write_bytes(binary_stl(cube(5), cube(5, at=(10, 0, 0))))
    (root / 'Loose').mkdir(); (root / 'Loose' / 'part.stl').write_bytes(binary_stl(cube()))
    (root / 'Empty').mkdir()
    (tmp_path / 'secret.stl').write_bytes(binary_stl(cube()))
    app = create_app(tmp_path / 'data', models_dir=root)
    client = app.test_client()
    token = re.search(rb'name="editor-token" content="([^"]+)"', client.get('/').data).group(1).decode()
    return client, {'X-Editor-Token': token}


def test_model_projects_are_listed_and_opened(projects):
    client, headers = projects
    listed = client.get('/api/projects').json['projects']
    assert [(p['name'], p['scenes'], p['parts']) for p in listed] == [
        ('Castle', ['preview/castle_assembled.3mf'], ['stl/flag.stl', 'stl/tower.stl']), ('Loose', [], ['part.stl'])]
    state = client.post('/api/projects/open', headers=headers, json={'project': 'Castle'}).json
    assert state['scene']['name'] == 'Castle · castle_assembled' and state['scene']['source'] == {'project': 'Castle', 'file': 'preview/castle_assembled.3mf'}
    assert [(o['name'], o['category'], o['print_file']) for o in state['scene']['objects']] == [('Tower', 'Walls', '../stl/tower.stl'), ('Gate', 'Doors', None)]
    # A project's print file is one part, even when it holds separate pieces.
    state = client.post('/api/projects/add', headers=headers, json={'project': 'Castle', 'file': 'stl/flag.stl'}).json
    assert [o['name'] for o in state['scene']['objects']][-1] == 'flag' and state['scene']['objects'][-1]['print_file'] == 'stl/flag.stl'
    # Without an assembled scene, every part file, side by side.
    state = client.post('/api/projects/open', headers=headers, json={'project': 'Loose'}).json
    assert [o['name'] for o in state['scene']['objects']] == ['part']


@pytest.mark.parametrize('payload', [{'project': '../data'}, {'project': '..'}, {'project': 'Castle/../..'}, {'project': 'Empty'},
                                     {'project': 'Castle', 'file': '../../secret.stl'}, {'project': 'Castle', 'file': '/etc/passwd'}])
def test_projects_stay_inside_the_models_folder(projects, payload):
    client, headers = projects
    route = '/api/projects/add' if 'file' in payload else '/api/projects/open'
    response = client.post(route, headers=headers, json=payload)
    assert response.status_code == 400


def test_uploads_add_to_the_scene_or_open_a_new_one(projects):
    client, headers = projects
    stl = binary_stl(cube(), cube(at=(30, 0, 0)))
    state = client.post('/api/models', headers=headers, data={'model': (io.BytesIO(stl), 'pair.stl')}).json
    assert [o['name'] for o in state['scene']['objects']][-2:] == ['pair 1', 'pair 2'] and len(state['scene']['objects']) == 4
    state = client.post('/api/models', headers=headers, data={'model': [(io.BytesIO(stl), 'pair.stl'), (io.BytesIO(binary_stl(cube())), 'one.stl')], 'mode': 'open'}).json
    assert state['scene']['name'] == '2 imported files' and [o['name'] for o in state['scene']['objects']] == ['pair 1', 'pair 2', 'one']
