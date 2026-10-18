"""Bounded STL/OBJ imports and portable annotated GLB exports. Coordinates are mm."""
import io
import json
import math
import re
import struct
import zipfile
import numpy as np

MAX_FACES = 150_000          # per part, as shown in VR (larger parts are simplified to this)
MAX_VERTICES = 300_000
SCENE_FACES = 600_000        # a whole scene, as shown in VR


def checked(vertices, faces):
    vertices = np.asarray(vertices, dtype=np.float64)
    faces = np.asarray(faces, dtype=np.int64)
    if vertices.ndim != 2 or vertices.shape[1] != 3 or not 3 <= len(vertices) <= MAX_VERTICES:
        raise ValueError(f'Use a mesh with 3–{MAX_VERTICES:,} vertices.')
    if faces.ndim != 2 or faces.shape[1] != 3 or not 1 <= len(faces) <= MAX_FACES:
        raise ValueError(f'Use a mesh with at most {MAX_FACES:,} triangles.')
    if not np.isfinite(vertices).all() or np.abs(vertices).max() > 1_000_000:
        raise ValueError('Mesh coordinates must be finite and within one million millimeters of the origin.')
    if faces.min() < 0 or faces.max() >= len(vertices):
        raise ValueError('The mesh refers to missing vertices.')
    # Weld the STL's repeated corners. This gives stable topology and face IDs.
    vertices, inverse = np.unique(vertices, axis=0, return_inverse=True)
    faces = inverse[faces]
    triangles = vertices[faces]
    areas = np.linalg.norm(np.cross(triangles[:,1]-triangles[:,0], triangles[:,2]-triangles[:,0]), axis=1)
    if np.any(areas < 1e-10):
        raise ValueError('The model contains zero-area triangles. Clean the mesh and try again.')
    if np.ptp(vertices, axis=0).max() < .01:
        raise ValueError('The model is too small. Check its import units.')
    return vertices.astype(np.float32), faces.astype(np.uint32)


UNITS = {'mm': 1, 'cm': 10, 'm': 1000}
MAX_PARTS = 64
_3MF_UNITS = {'micron': .001, 'millimeter': 1., 'centimeter': 10., 'inch': 25.4, 'foot': 304.8, 'meter': 1000.}


def weld(vertices, faces):
    """Shared corners merged and degenerate (sliver) triangles dropped, since print models often carry a few:
    (vertices, faces), or None if nothing is left. No size limits: see simplify."""
    vertices = np.asarray(vertices, dtype=np.float64)
    faces = np.asarray(faces, dtype=np.int64).reshape(-1, 3)
    if not len(faces) or not len(vertices) or not np.isfinite(vertices).all(): return None
    vertices, inverse = np.unique(vertices, axis=0, return_inverse=True)
    faces = inverse.ravel()[faces]
    triangles = vertices[faces]
    areas = np.linalg.norm(np.cross(triangles[:,1]-triangles[:,0], triangles[:,2]-triangles[:,0]), axis=1)
    faces = faces[(areas >= 1e-10) & (faces[:,0] != faces[:,1]) & (faces[:,1] != faces[:,2]) & (faces[:,0] != faces[:,2])]
    if not len(faces): return None
    used = np.unique(faces)
    remap = np.full(len(vertices), -1, dtype=np.int64); remap[used] = np.arange(len(used))
    return vertices[used], remap[faces]


def cleaned(vertices, faces):
    """weld, then the limits of checked: (float32 vertices, uint32 faces), or None if nothing is left."""
    welded = weld(vertices, faces)
    return None if welded is None else checked(*welded)


def simplify(vertices, faces, budget):
    """At most `budget` triangles, by vertex clustering: corners in one grid cell merge to their mean, and
    triangles that collapse are dropped. Coarse, but fast and shape-preserving enough to see and mark a part."""
    if len(faces) <= budget: return vertices, faces
    triangles = vertices[faces]
    area = np.linalg.norm(np.cross(triangles[:,1]-triangles[:,0], triangles[:,2]-triangles[:,0]), axis=1).sum() / 2
    cell = max(np.sqrt(2 * area / budget), 1e-6)   # a surface of this area in cells this size makes about `budget` triangles
    low = vertices.min(axis=0)
    for _ in range(40):
        keys = np.floor((vertices - low) / cell).astype(np.int64)
        _, cluster, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
        cluster = cluster.ravel()
        merged = np.zeros((len(counts), 3)); np.add.at(merged, cluster, vertices); merged /= counts[:, None]
        mapped = cluster[faces]
        mapped = mapped[(mapped[:,0] != mapped[:,1]) & (mapped[:,1] != mapped[:,2]) & (mapped[:,0] != mapped[:,2])]
        _, first = np.unique(np.sort(mapped, axis=1), axis=0, return_index=True)
        mapped = mapped[np.sort(first)]
        if len(mapped) <= budget: return merged, mapped
        cell *= 1.15
    raise ValueError('This part could not be simplified for VR.')


def shells(faces, count):
    """Connected pieces of a welded mesh (faces sharing a vertex), as arrays of face indices, in file order."""
    labels = np.arange(count)
    while True:
        low = labels[faces].min(axis=1)
        before = labels.copy()
        for k in range(3): np.minimum.at(labels, faces[:, k], low)
        labels = labels[labels]
        while not np.array_equal(labels, labels[labels]): labels = labels[labels]
        if np.array_equal(labels, before): break
    of_face = labels[faces[:, 0]]
    _, first, inverse = np.unique(of_face, return_index=True, return_inverse=True)
    order = np.argsort(first)
    rank = np.empty_like(order); rank[order] = np.arange(len(order))
    pieces = rank[inverse.ravel()]
    return [np.flatnonzero(pieces == k) for k in range(len(order))]


def _stl_solids(data):
    """[(name, triangle corner array)] from a binary STL, or the named solids of an ASCII STL."""
    count = struct.unpack_from('<I', data, 80)[0] if len(data) >= 84 else 0
    if count and len(data) == 84 + count * 50:
        if count > 4_000_000: raise ValueError('Limit files to 4,000,000 triangles.')
        dtype = np.dtype([('normal', '<f4', (3,)), ('vertices', '<f4', (3, 3)), ('attribute', '<u2')])
        return [(None, np.frombuffer(data, dtype=dtype, count=count, offset=84)['vertices'].reshape(-1, 3).astype(np.float64))]
    text = data.decode('ascii', errors='strict')
    heads = list(re.finditer(r'^\s*solid[ \t]*([^\r\n]*)', text, re.M)) or [None]
    solids = []
    for k, head in enumerate(heads):
        start = head.end() if head else 0
        end = heads[k + 1].start() if k + 1 < len(heads) else len(text)
        tokens = re.findall(r'\bvertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)', text[start:end], re.I)
        if len(tokens) % 3: raise ValueError('This is not a valid triangle STL.')
        if tokens: solids.append(((head.group(1).strip() if head else '') or None, np.array(tokens, dtype=float)))
    if not solids: raise ValueError('This is not a valid triangle STL.')
    if sum(len(v) for _, v in solids) > 12_000_000: raise ValueError('Limit files to 4,000,000 triangles.')
    return solids


def _obj_groups(data):
    """[(name, vertices, faces)] for each o/g group of an OBJ (one group if it names none)."""
    vertices = []; groups = {}; current = None
    for line in data.decode('utf-8-sig', errors='strict').splitlines():
        words = line.split('#', 1)[0].split()
        if not words: continue
        if words[0] in ('o', 'g'):
            current = ' '.join(words[1:]) or None
        elif words[0] == 'v':
            if len(words) < 4: raise ValueError('An OBJ vertex needs three coordinates.')
            vertices.append([float(v) for v in words[1:4]])
            if len(vertices) > 4_000_000: raise ValueError('This OBJ has too many vertices.')
        elif words[0] == 'f':
            polygon = []
            for word in words[1:]:
                index = int(word.split('/')[0])
                if index == 0: raise ValueError('OBJ vertex indices cannot be zero.')
                polygon.append(index - 1 if index > 0 else len(vertices) + index)
            if len(polygon) < 3: raise ValueError('An OBJ face needs at least three vertices.')
            groups.setdefault(current, []).extend((polygon[0], polygon[i], polygon[i + 1]) for i in range(1, len(polygon) - 1))
            if sum(map(len, groups.values())) > 4_000_000: raise ValueError('Limit files to 4,000,000 triangles.')
    if not groups: raise ValueError('This OBJ has no faces.')
    vertices = np.asarray(vertices, dtype=np.float64)
    out = []
    for name, faces in groups.items():
        faces = np.asarray(faces, dtype=np.int64)
        if faces.min() < 0 or faces.max() >= len(vertices): raise ValueError('The OBJ refers to missing vertices.')
        out.append((name, vertices, faces))
    return out


def _transform(attr):
    """A 3MF 3x4 row-vector transform as a 4x4 matrix (points are row vectors)."""
    matrix = np.eye(4)
    if attr:
        values = [float(x) for x in attr.split()]
        if len(values) == 12: matrix[:, :3] = np.array(values).reshape(4, 3)
    return matrix


def _3mf_objects(data):
    """[(name, vertices, faces, extra)] for each mesh a 3MF's build places, in place, with its vis:category and
    vis:printfile metadata (the Visualizer's assembled models name each part's print file and category)."""
    from xml.etree import ElementTree
    try: archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile: raise ValueError('This 3MF archive is damaged.') from None
    with archive:
        names = [n for n in archive.namelist() if n.lower().endswith('.model')]
        if not names: raise ValueError('This 3MF has no model part.')
        main = next((n for n in names if n.lower() == '3d/3dmodel.model'), names[0])
        if archive.getinfo(main).file_size > 200 * 1024 * 1024: raise ValueError('This 3MF model is too large.')
        root = ElementTree.fromstring(archive.read(main))
    local = lambda tag: tag.rsplit('}', 1)[-1]
    scale = _3MF_UNITS.get(root.get('unit', 'millimeter'), 1.)
    objects = {}; build = []
    for element in root.iter():
        tag = local(element.tag)
        if tag == 'object':
            mesh = None; components = []; extra = {}
            for child in element:
                kind = local(child.tag)
                if kind == 'mesh':
                    vertices = [(float(v.get('x')), float(v.get('y')), float(v.get('z'))) for v in child.iter() if local(v.tag) == 'vertex']
                    triangles = [(int(t.get('v1')), int(t.get('v2')), int(t.get('v3'))) for t in child.iter() if local(t.tag) == 'triangle']
                    mesh = (np.asarray(vertices, dtype=np.float64).reshape(-1, 3), np.asarray(triangles, dtype=np.int64).reshape(-1, 3))
                elif kind == 'metadatagroup':
                    for item in child:
                        key = (item.get('name') or '').rsplit(':', 1)[-1].lower(); value = (item.text or '').strip()
                        if key == 'printfile' and value: extra['print_file'] = value[:300]
                        elif key == 'category' and value: extra['category'] = value[:60]
                elif kind == 'components':
                    components = [(c.get('objectid'), _transform(c.get('transform'))) for c in child if local(c.tag) == 'component']
            objects[element.get('id')] = (mesh, components, element.get('name'), extra)
        elif tag == 'item':
            build.append((element.get('objectid'), _transform(element.get('transform'))))
    out = []
    def emit(key, matrix, name, extra, depth=0):
        if key not in objects or depth > 16: return
        mesh, components, own, own_extra = objects[key]
        name = own or name; extra = own_extra or extra
        if mesh is not None and len(mesh[1]):
            placed = (np.c_[mesh[0], np.ones(len(mesh[0]))] @ matrix)[:, :3] * scale
            out.append((name or f'Object {key}', placed, mesh[1], extra))
        for child, child_matrix in components: emit(child, child_matrix @ matrix, name, extra, depth + 1)
    for key, matrix in build or [(key, np.eye(4)) for key in objects]: emit(key, matrix, None, {})
    if not out: raise ValueError('This 3MF contains no triangles.')
    return out


def load_parts(data, filename, units='mm', split=True):
    """The parts of a model file, as the Visualizer sees them: a 3MF's objects (placed by its build, with their
    category and print file), an OBJ's o/g groups, an ASCII STL's named solids, or the separate pieces of an STL
    that names none (split=False keeps such an STL whole: a project's print file is one part). Each is
    {name, vertices, faces, category, print_file}, in millimeters."""
    if units not in UNITS: raise ValueError('Choose mm, cm, or m for import units.')
    stem = re.sub(r'[_-]+', ' ', filename.rsplit('/', 1)[-1].rsplit('.', 1)[0]).strip()[:120] or 'Part'
    extension = filename.rsplit('.', 1)[-1].lower()
    raw = []
    if extension == 'stl':
        solids = _stl_solids(data)
        for name, corners in solids:
            raw.append((name if len(solids) > 1 else name or stem, corners, np.arange(len(corners)).reshape(-1, 3), {}, split and len(solids) == 1))
    elif extension == 'obj':
        groups = _obj_groups(data)
        raw = [(name or stem, v, f, {}, False) for name, v, f in groups]
    elif extension == '3mf':
        raw = [(name, v, f, extra, False) for name, v, f, extra in _3mf_objects(data)]
        units = 'mm'   # a 3MF states its own unit
    else:
        raise ValueError('Upload STL, OBJ, or 3MF meshes. CAD solids should first be exported as a mesh.')
    pieces_of = []
    for name, vertices, faces, extra, separable in raw:
        welded = weld(np.asarray(vertices) * UNITS[units], faces)
        if welded is None: continue
        vertices, faces = welded
        pieces = shells(faces, len(vertices)) if separable else [None]
        if len(pieces) > MAX_PARTS: pieces = [None]   # dust and fragments: keep the file whole
        for k, piece in enumerate(pieces):
            if piece is None: part = (vertices, faces)
            else:
                used = np.unique(faces[piece]); remap = np.zeros(len(vertices), dtype=np.int64); remap[used] = np.arange(len(used))
                part = (vertices[used], remap[faces[piece]])
            pieces_of.append((name if len(pieces) == 1 else f'{name} {k + 1}', part, extra))
    if not pieces_of: raise ValueError('The file has no usable triangles.')
    if len(pieces_of) > MAX_PARTS: raise ValueError(f'Limit a file to {MAX_PARTS} parts.')
    return [part_record(name, *part, extra) for name, part, extra in pieces_of]


def part_record(name, vertices, faces, extra=None, budget=MAX_FACES):
    """A scene part, simplified to its share of what VR shows if it is larger."""
    extra = extra or {}
    source = len(faces)
    vertices, faces = simplify(vertices, faces, budget)
    checked_part = cleaned(vertices, faces)
    if checked_part is None: raise ValueError(f'{name} has no usable triangles.')
    return {'name': str(name)[:120], 'vertices': checked_part[0], 'faces': checked_part[1], 'category': extra.get('category'),
            'print_file': extra.get('print_file'), 'source_triangles': int(source)}


def fit_scene(parts, budget=SCENE_FACES):
    """Parts simplified further, in proportion, so that together they stay within what VR shows."""
    total = sum(len(p['faces']) for p in parts)
    if total <= budget: return parts
    out = []
    for p in parts:
        share = max(2000, int(budget * len(p['faces']) / total))
        record = part_record(p['name'], p['vertices'].astype(np.float64), p['faces'].astype(np.int64),
                             {'category': p['category'], 'print_file': p['print_file']}, share)
        record['source_triangles'] = p['source_triangles']
        out.append(record)
    return out


def load_model(data, filename, units='mm'):
    """One whole mesh from an STL or OBJ (every part together)."""
    if filename.rsplit('.', 1)[-1].lower() not in ('stl', 'obj'):
        raise ValueError('Upload an STL or OBJ mesh. CAD solids should first be exported as a mesh.')
    parts = load_parts(data, filename, units, split=False)
    if len(parts) == 1: return parts[0]['vertices'], parts[0]['faces']
    offsets = np.cumsum([0] + [len(p['vertices']) for p in parts[:-1]])
    return checked(np.concatenate([p['vertices'] for p in parts]), np.concatenate([p['faces'].astype(np.int64) + o for p, o in zip(parts, offsets)]))


def demo():
    n, rows, height = 96, 20, 90
    vertices=[]
    for inside in (False,True):
        for row in range(rows+1):
            z=(3+(height-3)*row/rows) if inside else height*row/rows
            for j in range(n):
                a=j*2*math.pi/n
                radius=26+7*(z/height)**1.4+1.8*math.cos(12*a+z*.012)*(math.sin(math.pi*z/height)**.4)
                if inside: radius-=2.4
                vertices.append((radius*math.cos(a),radius*math.sin(a),z))
    faces=[]; offset=(rows+1)*n
    for row in range(rows):
        for j in range(n):
            a=row*n+j; b=row*n+(j+1)%n; c=b+n; d=a+n
            faces.extend(((a,b,c),(a,c,d),(a+offset,c+offset,b+offset),(a+offset,d+offset,c+offset)))
    lower=len(vertices);vertices.append((0,0,0)); floor=len(vertices);vertices.append((0,0,3))
    for j in range(n):
        k=(j+1)%n; a=rows*n+j; b=rows*n+k
        faces.extend(((a,b,b+offset),(a,b+offset,a+offset),(lower,k,j),(floor,offset+j,offset+k)))
    return checked(vertices,faces)


def demo_stand():
    """A round stepped stand for the demo vessel to sit on (below it, in the same coordinates)."""
    n=96; rings=[(0,-12,40),(1,-12,40),(2,-4,40),(3,-4,34),(4,0,34)]   # (index, z, radius) up the profile
    vertices=[(0,0,-12)]
    for _,z,radius in rings:
        for j in range(n):
            a=j*2*math.pi/n; vertices.append((radius*math.cos(a),radius*math.sin(a),z))
    top=len(vertices); vertices.append((0,0,0))
    faces=[]
    for j in range(n):
        k=(j+1)%n
        faces.append((0,1+k,1+j))
        for r in range(1,len(rings)):
            a=1+(r-1)*n+j; b=1+(r-1)*n+k; c=1+r*n+k; d=1+r*n+j
            if rings[r][1]==rings[r-1][1] and rings[r][2]==rings[r-1][2]: continue
            faces.extend(((a,b,c),(a,c,d)))
        last=1+(len(rings)-1)*n
        faces.append((top,last+j,last+k))
    return cleaned(vertices,faces)


def demo_scene():
    """The built-in scene: a fluted vessel on its stand, two parts."""
    return [part_record('Fluted vessel',*demo(),{'category':'Vessel'}),part_record('Stand',*demo_stand(),{'category':'Base'})]


def info(vertices, faces):
    edges=np.concatenate([faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]]])
    _, counts=np.unique(np.sort(edges,axis=1),axis=0,return_counts=True)
    return {'vertices':len(vertices),'triangles':len(faces),
            'bounds_mm':[vertices.min(axis=0).tolist(),vertices.max(axis=0).tolist()],
            'dimensions_mm':np.ptp(vertices,axis=0).round(3).tolist(),
            'watertight':bool(np.all(counts==2)), 'boundary_edges':int(np.count_nonzero(counts==1)),
            'nonmanifold_edges':int(np.count_nonzero(counts>2)), 'units':'mm'}


def stl_bytes(vertices,faces):
    triangles=vertices[faces]
    normals=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
    normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-12)
    records=np.zeros(len(faces),dtype=[('normal','<f4',(3,)),('vertices','<f4',(3,3)),('attribute','<u2')])
    records['normal']=normals;records['vertices']=triangles
    return b'Editor-VR | millimeters | original geometry'.ljust(80,b'\0')+struct.pack('<I',len(faces))+records.tobytes()


def annotated_glb(vertices,faces,annotations,metadata):
    # glTF is Y-up in meters. The extras explicitly preserve native mm coordinates
    # and face IDs; the source STL in the packet stays untransformed.
    positions=vertices[faces].reshape(-1,3).astype('<f4')
    positions=np.c_[positions[:,0],positions[:,2],-positions[:,1]].astype('<f4')*.001
    colors=np.tile(np.array([.72,.76,.8,1],dtype='<f4'),(len(positions),1))
    for annotation in annotations:
        color=annotation['color'].lstrip('#')
        rgb=[int(color[i:i+2],16)/255 for i in (0,2,4)]
        for face in annotation['face_ids']: colors[face*3:face*3+3]=[*rgb,1]
    raw=positions.tobytes()+colors.tobytes()
    document={'asset':{'version':'2.0','generator':'Editor-VR'},'scene':0,
              'scenes':[{'nodes':[0]}], 'nodes':[{'mesh':0,'name':metadata['name']}],
              'meshes':[{'primitives':[{'attributes':{'POSITION':0,'COLOR_0':1},'mode':4,'material':0}],
                         'extras':{'native_units':'mm','native_to_gltf':'[x,z,-y] / 1000','annotations':annotations,**metadata}}],
              'materials':[{'doubleSided':True,'pbrMetallicRoughness':{'metallicFactor':0,'roughnessFactor':.7}}],
              'buffers':[{'byteLength':len(raw)}],
              'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':positions.nbytes,'target':34962},
                             {'buffer':0,'byteOffset':positions.nbytes,'byteLength':colors.nbytes,'target':34962}],
              'accessors':[{'bufferView':0,'componentType':5126,'count':len(positions),'type':'VEC3',
                            'min':positions.min(axis=0).tolist(),'max':positions.max(axis=0).tolist()},
                           {'bufferView':1,'componentType':5126,'count':len(colors),'type':'VEC4'}]}
    encoded=json.dumps(document,separators=(',',':'),allow_nan=False).encode()
    encoded+=b' '*((-len(encoded))%4);raw+=b'\0'*((-len(raw))%4)
    return struct.pack('<4sII',b'glTF',2,12+8+len(encoded)+8+len(raw))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(raw),b'BIN\0')+raw


def packet(vertices,faces,annotations,metadata):
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('model.stl',stl_bytes(vertices,faces))
        archive.writestr('annotated.glb',annotated_glb(vertices,faces,annotations,metadata))
        archive.writestr('annotations.json',json.dumps({'schema':'editor-vr.annotation-packet/1','units':'mm',
                             'coordinate_system':'native model XYZ, normally print Z-up',**metadata,'annotations':annotations},indent=2,allow_nan=False))
        archive.writestr('README.txt','Editor-VR edit request\n\nmodel.stl is the unchanged source geometry in millimeters.\n'
                          'annotated.glb colors the selected faces and carries annotation metadata in mesh extras.\n'
                          'annotations.json contains native-mm sample points, face IDs, intent colors, categories, and instructions.\n'
                          'The desktop geometry editing pipeline is a placeholder; no mesh edits have been performed.\n')
    return output.getvalue()
