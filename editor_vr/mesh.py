"""Bounded STL/OBJ imports and portable annotated GLB exports. Coordinates are mm."""
import io
import json
import math
import re
import struct
import zipfile
import numpy as np

MAX_FACES = 100_000
MAX_VERTICES = 300_000


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


def load_model(data, filename, units='mm'):
    if units not in ('mm','cm','m'):
        raise ValueError('Choose mm, cm, or m for import units.')
    extension = filename.rsplit('.',1)[-1].lower()
    if extension == 'stl':
        count = struct.unpack_from('<I',data,80)[0] if len(data)>=84 else 0
        if count and len(data)==84+count*50:
            if count>MAX_FACES: raise ValueError(f'Limit models to {MAX_FACES:,} triangles for VR.')
            dtype=np.dtype([('normal','<f4',(3,)),('vertices','<f4',(3,3)),('attribute','<u2')])
            vertices=np.frombuffer(data,dtype=dtype,count=count,offset=84)['vertices'].reshape(-1,3)
        else:
            text=data.decode('ascii',errors='strict')
            tokens=re.findall(r'\bvertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)',text,re.I)
            if not tokens or len(tokens)%3: raise ValueError('This is not a valid triangle STL.')
            if len(tokens)>MAX_FACES*3: raise ValueError(f'Limit models to {MAX_FACES:,} triangles for VR.')
            vertices=np.array(tokens,dtype=float)
        faces=np.arange(len(vertices)).reshape(-1,3)
    elif extension == 'obj':
        vertices=[]; faces=[]
        for line in data.decode('utf-8-sig',errors='strict').splitlines():
            words=line.split('#',1)[0].split()
            if not words: continue
            if words[0]=='v':
                if len(words)<4: raise ValueError('An OBJ vertex needs three coordinates.')
                vertices.append([float(v) for v in words[1:4]])
                if len(vertices)>MAX_VERTICES: raise ValueError('This OBJ has too many vertices.')
            elif words[0]=='f':
                polygon=[]
                for word in words[1:]:
                    index=int(word.split('/')[0])
                    if index==0: raise ValueError('OBJ vertex indices cannot be zero.')
                    polygon.append(index-1 if index>0 else len(vertices)+index)
                if len(polygon)<3: raise ValueError('An OBJ face needs at least three vertices.')
                faces.extend((polygon[0],polygon[i],polygon[i+1]) for i in range(1,len(polygon)-1))
                if len(faces)>MAX_FACES: raise ValueError(f'Limit models to {MAX_FACES:,} triangles for VR.')
    else:
        raise ValueError('Upload an STL or OBJ mesh. CAD solids should first be exported as a mesh.')
    return checked(np.asarray(vertices)*{'mm':1,'cm':10,'m':1000}[units],faces)


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
