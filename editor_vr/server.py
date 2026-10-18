"""One local-network workspace, shared by the desktop and paired headset."""
import io
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
from . import mesh


def create_app(data_dir=None):
    app=Flask(__name__)
    app.config.update(MAX_CONTENT_LENGTH=30*1024*1024,TRUSTED_HOSTS=['localhost','127.0.0.1','[::1]'],PAIRING=None,HEADSET_URLS=[])
    root=Path(data_dir or os.environ.get('EDITOR_VR_DATA',Path(__file__).resolve().parents[1]/'data'))
    workspace=Workspace(root);hub=Hub();token=secrets.token_urlsafe(32)
    app.extensions['editor_vr']={'workspace':workspace,'hub':hub,'token':token}
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
        response.headers['Permissions-Policy']='xr-spatial-tracking=(self)'
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
        result=workspace.action(request.get_json(silent=True));hub.publish({'type':'state','revision':result['revision']});return jsonify(result)
    @app.post('/api/submit')
    def submit():
        result=workspace.submit(request.get_json(silent=True));hub.publish({'type':'state','revision':result['revision']});return jsonify(result)
    @app.post('/api/models')
    def upload():
        source=request.files.get('model')
        if source is None or not source.filename:raise ValueError('Choose an STL or OBJ model.')
        filename=source.filename.replace('\\','/').rsplit('/',1)[-1][:180]
        vertices,faces=mesh.load_model(source.read(),filename,request.form.get('units','mm'))
        result=workspace.install(vertices,faces,filename)
        hub.publish({'type':'state','revision':result['revision']});return jsonify(result)
    @app.post('/api/demo')
    def example():
        result=workspace.install(*mesh.demo(),name='Fluted study vessel',source='Built-in print model')
        hub.publish({'type':'state','revision':result['revision']});return jsonify(result)
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
    @sock.route('/api/live')
    def live(ws):hub.serve(ws)
    return app
