"""One local-network view of a model, shared by the desktop and paired headset."""
import io
import logging
import os
from pathlib import Path
import secrets
import struct
import sys
from flask import Flask,abort,jsonify,redirect,render_template,request,send_file
from flask_sock import Sock
from werkzeug.exceptions import HTTPException
from .live import Hub
from .pairing import COOKIE,is_local
from .workspace import Workspace,Conflict
from .speech import Transcriber,decode_samples,purpose_of,vocabulary_of
from . import mesh

LOGGER=logging.getLogger(__name__)
MODEL_TYPES=('.stl','.obj','.3mf')
MAX_FILE=300*1024*1024   # a model file opened from this computer's disk
MAX_FOLDER_FILES=24      # a folder opened whole: at most this many of its model files
MAX_LISTED=500


def default_data_dir():
    """Where the viewer keeps its working copies, certificate and paired devices: VR_VIEWER_DATA, or the user's
    application data folder."""
    if os.environ.get('VR_VIEWER_DATA'):return Path(os.environ['VR_VIEWER_DATA']).expanduser()
    if sys.platform=='win32':base=Path(os.environ.get('LOCALAPPDATA',Path.home()/'AppData'/'Local'))
    elif sys.platform=='darwin':base=Path.home()/'Library'/'Application Support'
    else:base=Path(os.environ.get('XDG_DATA_HOME') or Path.home()/'.local'/'share')
    return base/'vr-viewer'


def model_files(folder):
    """A folder's model files, by name."""
    return sorted((p for p in folder.iterdir() if p.is_file() and not p.name.startswith('.') and p.suffix.lower() in MODEL_TYPES),
                  key=lambda p:p.name.lower())


def read_parts(paths,units='mm',split=None):
    """The parts of model files on this computer, with a scene name. One file alone is split as the Visualizer
    sees it (a 3MF's objects, an OBJ's groups, an STL's separate pieces); among several, each file is one part
    (a 3MF still gives its objects), as is a file added beside a scene (split=False). A folder stands for its model
    files."""
    files=[]
    for path in paths:
        path=Path(path).expanduser().resolve()
        if path.is_dir():
            found=model_files(path)
            if not found:raise ValueError(f'{path.name} has no STL, OBJ or 3MF files.')
            files+=found[:MAX_FOLDER_FILES]
        elif path.is_file() and path.suffix.lower() in MODEL_TYPES:files.append(path)
        elif path.exists():raise ValueError(f'{path.name} is not an STL, OBJ or 3MF file.')
        else:raise ValueError(f'{path} was not found.')
    if not files:raise ValueError('Choose STL, OBJ or 3MF files.')
    parts=[]
    for path in files:
        if path.stat().st_size>MAX_FILE:raise ValueError(f'{path.name} is too large to view (over 300 MB).')
        found=mesh.load_parts(path.read_bytes(),path.name,units,split=len(files)==1 if split is None else split)
        for part in found:part['source_file']=str(path)
        parts+=found
    single=len(paths)==1 and Path(paths[0]).expanduser()
    name=(single.stem if single.is_file() else single.resolve().name) if single else f'{len(files)} files'
    return parts,name or 'Scene',files


def create_app(data_dir=None,transcriber=None,root=None,start=None):
    """root: the folder the file browser may show (default the home folder); start: where it opens first."""
    app=Flask(__name__)
    app.config.update(MAX_CONTENT_LENGTH=30*1024*1024,TRUSTED_HOSTS=['localhost','127.0.0.1','[::1]'],PAIRING=None,HEADSET_URLS=[])
    workspace=Workspace(Path(data_dir) if data_dir else default_data_dir());hub=Hub();token=secrets.token_urlsafe(32)
    transcriber=transcriber or Transcriber()
    browse_root=Path(root or os.environ.get('VR_VIEWER_ROOT') or Path.home()).expanduser().resolve()
    app.extensions['vr_viewer']={'workspace':workspace,'hub':hub,'token':token,'transcriber':transcriber,'root':browse_root}
    sock=Sock(app)

    @app.before_request
    def boundary():
        pairing=app.config['PAIRING']
        public=request.path in ('/pair','/api/pair') or request.path.startswith('/static/')
        if pairing and not is_local(request.remote_addr) and not public and not pairing.is_paired(request.cookies.get(COOKIE)):
            return redirect('/pair') if request.path=='/' else (jsonify(error='Pair this device first.'),401)
        if request.method=='POST' or request.path=='/api/live':
            origin=request.headers.get('Origin')
            if origin and origin.rstrip('/')!=request.host_url.rstrip('/'):abort(403,description='Use the VR-Viewer page to make this request.')
        if request.method=='POST' and request.path!='/api/pair':
            if not secrets.compare_digest(request.headers.get('X-Viewer-Token',''),token):abort(403,description='Reload VR-Viewer before making changes.')

    @app.after_request
    def headers(response):
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='same-origin'
        # Host validation itself may have produced the error response.
        try:websocket=('wss://' if request.is_secure else 'ws://')+request.host
        except HTTPException:websocket="'self'"
        response.headers['Content-Security-Policy']=f"default-src 'self'; script-src 'self' 'nonce-{token}'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' {websocket}; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
        # The headset's microphone: VR voice commands.
        response.headers['Permissions-Policy']='xr-spatial-tracking=(self), microphone=(self)'
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):return jsonify(error=error.description),error.code
    @app.errorhandler(ValueError)
    def bad_value(error):return jsonify(error=str(error)),409 if isinstance(error,Conflict) else 400
    @app.errorhandler(UnicodeError)
    def bad_encoding(error):return jsonify(error='The mesh file has invalid text encoding.'),400

    @app.get('/')
    def index():
        pairing=app.config['PAIRING']
        return render_template('index.html',token=token,pairing_pin=pairing.pin if pairing and is_local(request.remote_addr) else None,
                               headset_urls=app.config['HEADSET_URLS'])
    @app.get('/pair')
    def pair_page():return render_template('pair.html')
    @app.post('/api/pair')
    def pair():
        pairing=app.config['PAIRING']
        if not pairing:return jsonify(paired=True)
        payload=request.get_json(silent=True)
        if not isinstance(payload,dict):raise ValueError('Supply a PIN object.')
        try:cookie=pairing.pair(payload.get('pin',''))
        except PermissionError as error:return jsonify(error=str(error)),429
        if not cookie:return jsonify(error='That PIN does not match the computer.'),403
        response=jsonify(paired=True)
        response.set_cookie(COOKIE,cookie,max_age=400*24*3600,secure=request.is_secure,httponly=True,samesite='Strict')
        return response
    @app.get('/api/workspace')
    def state():return jsonify(workspace.snapshot())
    @app.post('/api/action')
    def action():
        return publish(workspace.action(request.get_json(silent=True)))
    def publish(result):
        hub.publish({'type':'state','revision':result['revision']});return jsonify(result)
    @app.post('/api/models')
    def upload():
        """Meshes from this device: added to the scene (mode=add, the default) or opened as a new scene (mode=open)."""
        sources=[f for f in request.files.getlist('model') if f and f.filename]
        if not sources:raise ValueError('Choose STL, OBJ, or 3MF models.')
        if len(sources)>16:raise ValueError('Choose at most 16 files at once.')
        parts=[]
        for source in sources:
            filename=source.filename.replace('\\','/').rsplit('/',1)[-1][:180]
            parts+=mesh.load_parts(source.read(),filename,request.form.get('units','mm'))
        if request.form.get('mode')=='open':
            name=sources[0].filename.replace('\\','/').rsplit('/',1)[-1].rsplit('.',1)[0] if len(sources)==1 else f'{len(sources)} imported files'
            return publish(workspace.open_scene(parts,name,{'kind':'upload'}))
        return publish(workspace.add_objects(parts,{'kind':'upload'}))
    @app.post('/api/demo')
    def example():
        return publish(workspace.open_scene(mesh.demo_scene(),'Fluted study vessel',{'kind':'demo'}))

    # ---------- the file browser: folders and model files under the root, read and never written ----------
    def relative(path):
        return '' if path==browse_root else path.relative_to(browse_root).as_posix()
    def inside(value,kind='folder'):
        """A path the browser gave (relative to the root), checked to stay inside it."""
        if not isinstance(value,str) or '\0' in value:raise ValueError(f'Choose a {kind}.')
        path=(browse_root/value).resolve()
        if not path.is_relative_to(browse_root):raise ValueError(f'That {kind} is outside {display(browse_root)}.')
        return path
    def display(path):
        home=Path.home()
        return '~/'+path.relative_to(home).as_posix() if path.is_relative_to(home) and path!=home else '~' if path==home else str(path)
    def first_folder():
        """Where the browser opens: the open scene's folder, the start folder, or the root."""
        source=workspace.snapshot()['scene'].get('source')
        candidates=[Path(source['folder']) if isinstance(source,dict) and source.get('folder') else None,Path(start).expanduser() if start else None,browse_root]
        for folder in candidates:
            if folder and folder.resolve().is_dir() and folder.resolve().is_relative_to(browse_root):return folder.resolve()
        return browse_root
    @app.get('/api/files')
    def browse():
        folder=first_folder() if request.args.get('path') is None else inside(request.args['path'])
        if not folder.is_dir():raise ValueError('That folder was not found.')
        folders,files=[],[]
        try:entries=sorted(folder.iterdir(),key=lambda p:p.name.lower())
        except PermissionError:raise ValueError(f'{folder.name} cannot be read.') from None
        for entry in entries:
            if entry.name.startswith('.'):continue
            try:
                real=entry.resolve()
                if not real.is_relative_to(browse_root):continue   # a link out of the root
                if real.is_dir():folders.append({'name':entry.name,'path':relative(real)})
                elif real.is_file() and real.suffix.lower() in MODEL_TYPES:files.append({'name':entry.name,'path':relative(real),'size':real.stat().st_size})
            except OSError:continue
        return jsonify(root=display(browse_root),path=relative(folder),display=display(folder),name=folder.name or display(folder),
                       parent=relative(folder.parent) if folder!=browse_root else None,
                       folders=folders[:MAX_LISTED],files=files[:MAX_LISTED],truncated=len(folders)>MAX_LISTED or len(files)>MAX_LISTED)
    @app.post('/api/files/open')
    def open_file():
        """A model file (or every model file in a folder) as the scene (mode "open"), or added beside it ("add")."""
        payload=request.get_json(silent=True) or {}
        path=inside(payload.get('path'),'file')
        mode=payload.get('mode','open')
        if mode not in ('open','add'):raise ValueError('Open, or add.')
        if not path.exists():raise ValueError('That file was not found.')
        parts,name,files=read_parts([path],payload.get('units','mm'),split=False if mode=='add' else None)
        source={'kind':'files','folder':str(path if path.is_dir() else path.parent),'files':[str(f) for f in files]}
        if mode=='add':return publish(workspace.add_objects(parts,source))
        return publish(workspace.open_scene(parts,name,source))

    @app.get('/api/models/<key>/mesh')
    def geometry(key):
        try:vertices,faces=workspace.model(key)
        except FileNotFoundError:abort(404)
        data=struct.pack('<4sII',b'EVR1',len(vertices),len(faces))+vertices.astype('<f4').tobytes()+faces.astype('<u4').tobytes()
        return send_file(io.BytesIO(data),mimetype='application/octet-stream')
    @app.post('/api/transcribe')
    def transcribe():
        """VR voice commands: the headset's recording (16 kHz samples) to text, on this computer; nothing is kept."""
        if not transcriber.available():
            return jsonify(error='Voice needs faster-whisper on the computer: pip install "vr-viewer[voice]"'),503
        payload=request.get_json(silent=True)
        samples,purpose=decode_samples(payload),purpose_of(payload)
        try:text=transcriber.transcribe(samples,purpose,vocabulary_of(payload))
        except Exception:
            LOGGER.exception('Transcription failed')
            return jsonify(error='That could not be understood. Try again.'),500
        return jsonify(text=text[:2000])
    @sock.route('/api/live')
    def live(ws):hub.serve(ws)
    return app
