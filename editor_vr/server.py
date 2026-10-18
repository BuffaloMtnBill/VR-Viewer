"""One local-network workspace, shared by the desktop and paired headset."""
import io
import logging
import os
from pathlib import Path
import secrets
import struct
from flask import Flask,abort,jsonify,redirect,render_template,request,send_file
from flask_sock import Sock
from werkzeug.exceptions import HTTPException
from .live import Hub
from .pairing import COOKIE,is_local
from .workspace import Workspace,Conflict,identifier
from .speech import Transcriber,decode_samples,purpose_of,vocabulary_of
from . import mesh

LOGGER=logging.getLogger(__name__)


def create_app(data_dir=None,transcriber=None,models_dir=None):
    app=Flask(__name__)
    app.config.update(MAX_CONTENT_LENGTH=30*1024*1024,TRUSTED_HOSTS=['localhost','127.0.0.1','[::1]'],PAIRING=None,HEADSET_URLS=[])
    root=Path(data_dir or os.environ.get('EDITOR_VR_DATA',Path(__file__).resolve().parents[1]/'data'))
    workspace=Workspace(root);hub=Hub();token=secrets.token_urlsafe(32)
    transcriber=transcriber or Transcriber()
    # Model projects to open (the Visualizer's layout: one folder per model, with preview/*_assembled.3mf and stl/).
    projects=Path(models_dir or os.environ.get('EDITOR_VR_MODELS',Path.home()/'Projects'/'Models')).expanduser()
    app.extensions['editor_vr']={'workspace':workspace,'hub':hub,'token':token,'transcriber':transcriber}
    sock=Sock(app)

    @app.before_request
    def boundary():
        pairing=app.config['PAIRING']
        public=request.path in ('/pair','/api/pair') or request.path.startswith('/static/')
        if pairing and not is_local(request.remote_addr) and not public and not pairing.is_paired(request.cookies.get(COOKIE)):
            return redirect('/pair') if request.path=='/' else (jsonify(error='Pair this device first.'),401)
        if request.method=='POST' or request.path=='/api/live':
            origin=request.headers.get('Origin')
            if origin and origin.rstrip('/')!=request.host_url.rstrip('/'):abort(403,description='Use the Editor-VR page to make this request.')
        if request.method=='POST' and request.path!='/api/pair':
            if not secrets.compare_digest(request.headers.get('X-Editor-Token',''),token):abort(403,description='Reload Editor-VR before making changes.')

    @app.after_request
    def headers(response):
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='same-origin'
        # Host validation itself may have produced the error response.
        try:websocket=('wss://' if request.is_secure else 'ws://')+request.host
        except HTTPException:websocket="'self'"
        response.headers['Content-Security-Policy']=f"default-src 'self'; script-src 'self' 'nonce-{token}'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' {websocket}; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
        # The headset's microphone: VR dictation and voice commands.
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
    @app.post('/api/submit')
    def submit():
        return publish(workspace.submit(request.get_json(silent=True)))
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
            return publish(workspace.open_scene(parts,name,'Uploaded meshes'))
        return publish(workspace.add_objects(parts,'Uploaded mesh'))
    @app.post('/api/demo')
    def example():
        return publish(workspace.open_scene(mesh.demo_scene(),'Fluted study vessel','Built-in scene'))

    # ---------- model projects on this computer ----------
    def project_folder(name):
        if not isinstance(name,str) or not name or name.startswith('.') or '/' in name or '\\' in name:raise ValueError('Choose a project.')
        folder=(projects/name).resolve()
        if folder.parent!=projects.resolve() or not folder.is_dir():raise ValueError('That project was not found.')
        return folder
    def project_file(folder,relative):
        if not isinstance(relative,str) or not relative:raise ValueError('Choose a model file.')
        path=(folder/relative).resolve()
        if not path.is_relative_to(folder) or not path.is_file() or path.suffix.lower() not in ('.stl','.obj','.3mf'):raise ValueError('That model file was not found.')
        if path.stat().st_size>300*1024*1024:raise ValueError('That model file is too large.')
        return path
    def describe(folder):
        """A project's assembled scenes (preview/*.3mf, or other 3MFs) and its part files (stl/, or the folder's own)."""
        scenes=sorted(p.relative_to(folder).as_posix() for p in [*folder.glob('preview/*.3mf'),*folder.glob('*.3mf')])
        parts=sorted(p.relative_to(folder).as_posix() for p in folder.glob('stl/*') if p.suffix.lower() in ('.stl','.obj'))
        parts=parts or sorted(p.name for p in folder.iterdir() if p.is_file() and p.suffix.lower() in ('.stl','.obj'))
        return {'name':folder.name,'scenes':scenes,'parts':parts}
    @app.get('/api/projects')
    def project_list():
        if not projects.is_dir():return jsonify(root=str(projects),projects=[])
        found=[describe(f) for f in sorted(projects.iterdir(),key=lambda f:f.name.lower()) if f.is_dir() and not f.name.startswith('.')]
        return jsonify(root=str(projects),projects=[p for p in found if p['scenes'] or p['parts']])
    @app.get('/api/projects/<name>')
    def project_detail(name):return jsonify(describe(project_folder(name)))
    @app.post('/api/projects/open')
    def project_open():
        """A project as the scene: one of its assembled 3MFs, or (without one) every part file, side by side."""
        payload=request.get_json(silent=True) or {}
        folder=project_folder(payload.get('project'))
        info=describe(folder)
        chosen=payload.get('file') or (info['scenes'][0] if info['scenes'] else None)
        source={'project':folder.name,'file':chosen}
        if chosen:
            path=project_file(folder,chosen)
            parts=mesh.load_parts(path.read_bytes(),path.name,split=path.suffix.lower()!='.stl')
            return publish(workspace.open_scene(parts,f'{folder.name} · {path.stem}',source))
        if not info['parts']:raise ValueError('That project has no model files.')
        result=None
        for k,relative in enumerate(info['parts'][:24]):
            path=project_file(folder,relative)
            parts=mesh.load_parts(path.read_bytes(),path.name,split=False)
            result=workspace.open_scene(parts,folder.name,source) if k==0 else workspace.add_objects(parts,source)
        return publish(result)
    @app.post('/api/projects/add')
    def project_add():
        """One of a project's part files, added to the scene beside what is there."""
        payload=request.get_json(silent=True) or {}
        folder=project_folder(payload.get('project'))
        path=project_file(folder,payload.get('file'))
        parts=mesh.load_parts(path.read_bytes(),path.name,split=False)
        for part in parts:part['print_file']=part['print_file'] or path.relative_to(folder).as_posix()
        return publish(workspace.add_objects(parts,{'project':folder.name,'file':path.relative_to(folder).as_posix()}))
    @app.get('/api/models/<key>/mesh')
    def geometry(key):
        try:vertices,faces=workspace.model(key)
        except FileNotFoundError:abort(404)
        data=struct.pack('<4sII',b'EVR1',len(vertices),len(faces))+vertices.astype('<f4').tobytes()+faces.astype('<u4').tobytes()
        return send_file(io.BytesIO(data),mimetype='application/octet-stream')
    @app.get('/api/export/<kind>')
    def export(kind):
        if kind not in ('glb','zip'):abort(404)
        return send_file(io.BytesIO(workspace.export(kind)),mimetype='model/gltf-binary' if kind=='glb' else 'application/zip',
                         as_attachment=True,download_name='editor-vr-annotated.'+kind)
    @app.get('/api/requests/<key>/<kind>')
    def packet(key,kind):
        identifier(key)
        if kind not in ('packet','model.glb'):abort(404)
        extension='zip' if kind=='packet' else 'glb'
        path=root/'requests'/f'{key}.{extension}'
        if not path.is_file():abort(404)
        return send_file(path,as_attachment=True,download_name=f'edit-request-{key[:8]}.{extension}')
    @app.post('/api/transcribe')
    def transcribe():
        """VR dictation and voice commands: the headset's recording (16 kHz samples) to text, on this computer;
        nothing is kept. purpose "note" expects an edit instruction, "command" the VR voice commands."""
        if not transcriber.available():
            return jsonify(error='Voice needs faster-whisper on the computer: pip install faster-whisper'),503
        payload=request.get_json(silent=True)
        samples,purpose=decode_samples(payload),purpose_of(payload)
        vocabulary=vocabulary_of(payload) if purpose=='command' else ()
        try:text=transcriber.transcribe(samples,purpose,vocabulary)
        except Exception:
            LOGGER.exception('Transcription failed')
            return jsonify(error='That could not be understood. Try again, or type it.'),500
        return jsonify(text=text[:2000])
    @sock.route('/api/live')
    def live(ws):hub.serve(ws)
    return app
