import argparse
import ipaddress
from pathlib import Path
import socket
from threading import Thread
import time
import webbrowser
from .server import create_app,read_parts
from .lan import certificate,local_addresses
from .pairing import Pairing


def open_when_ready(url,port):
    end=time.monotonic()+20
    while time.monotonic()<end:
        try:
            with socket.create_connection(('127.0.0.1',port),timeout=.5):break
        except OSError:time.sleep(.2)
    webbrowser.open(url)


def port_in_use(host,port):
    """Whether another program already has this port: listening on this computer (on any address), or holding the
    address this server would bind. A server on the same port would otherwise answer some of its requests."""
    for address in ('127.0.0.1','::1'):
        try:
            with socket.create_connection((address,port),timeout=.5):return True
        except OSError:pass
    # Bind as the server will. On Linux and macOS, SO_REUSEADDR lets the connections a stopped server leaves behind
    # (TIME-WAIT, for about a minute) through, and still refuses a running one; on Windows it would let a second
    # server share the port, so there the port is asked for exclusively.
    family=socket.AF_INET6 if ':' in host else socket.AF_INET
    try:
        with socket.socket(family,socket.SOCK_STREAM) as probe:
            if hasattr(socket,'SO_EXCLUSIVEADDRUSE'):probe.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
            else:probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            probe.bind((host,port))
    except OSError:return True
    return False


def main():
    parser=argparse.ArgumentParser(prog='vr-viewer',description='VR-Viewer: view 3D models on the desktop and in a Quest headset')
    parser.add_argument('paths',nargs='*',type=Path,metavar='MODEL',help='STL, OBJ or 3MF files (or a folder of them) to open')
    parser.add_argument('--units',choices=('mm','cm','m'),default='mm',help='Units of the STL and OBJ files opened here (default mm)')
    parser.add_argument('--root',type=Path,help='The folder the file browser may show (default your home folder, or VR_VIEWER_ROOT)')
    parser.add_argument('--port',type=int,default=8000)
    parser.add_argument('--host',help='Listen address; defaults to all interfaces for the headset')
    parser.add_argument('--local',action='store_true',help='Desktop-only HTTP on loopback')
    parser.add_argument('--no-browser',action='store_true')
    parser.add_argument('--data-dir',type=Path,help='Where to keep working copies, the certificate and paired devices')
    parser.add_argument('--forget-devices',action='store_true')
    args=parser.parse_args()
    if not 1024<=args.port<=65535:parser.error('Port must be 1024–65535.')
    if args.root and not args.root.expanduser().is_dir():parser.error(f'--root {args.root} is not a folder.')
    # The models named here are read first, so a mistyped path stops before anything starts.
    opened=None
    if args.paths:
        try:opened=read_parts(args.paths,args.units)
        except (ValueError,OSError) as error:parser.exit(1,f'vr-viewer: {error}\n')
    host=args.host or ('127.0.0.1' if args.local else '0.0.0.0')
    if args.local:
        # No pairing or TLS here, so never on the network; localhost is pinned to its address rather than resolved.
        if host=='localhost':host='127.0.0.1'
        try:loopback=ipaddress.ip_address(host).is_loopback
        except ValueError:loopback=False
        if not loopback:parser.error('--local must listen on a loopback address. Use default HTTPS for the network.')
    # Another server on this port: do not start alongside it.
    if port_in_use(host,args.port):
        parser.exit(1,f'Port {args.port} is already in use by another program (perhaps another VR-Viewer). '
            f'Stop that server, or start this one with --port <another port>.\n')
    start=args.paths[0].expanduser().resolve() if args.paths else None
    app=create_app(args.data_dir,root=args.root,start=(start if start.is_dir() else start.parent) if start else None)
    workspace=app.extensions['vr_viewer']['workspace']
    if opened:
        parts,name,files=opened
        try:workspace.open_scene(parts,name,{'kind':'files','folder':str(start if start.is_dir() else start.parent),'files':[str(f) for f in files]})
        except ValueError as error:parser.exit(1,f'vr-viewer: {error}\n')
    ssl_context=None; pairing=None
    if args.local:
        url=f'http://[{host}]:{args.port}' if ':' in host else f'http://{host}:{args.port}'
    else:
        import os
        addresses=local_addresses();hostname=socket.gethostname()
        hosts=['localhost','127.0.0.1',hostname,*addresses]
        if host not in ('0.0.0.0','::'):hosts.append(host)
        app.config['TRUSTED_HOSTS']=list(dict.fromkeys([*app.config['TRUSTED_HOSTS'],*hosts]))
        folder=workspace.folder/'tls'
        ssl_context=tuple(map(str,certificate(folder,hosts)))
        fixed=os.environ.get('VR_VIEWER_PAIRING_PIN')
        if fixed is not None and (len(fixed)!=6 or not fixed.isdigit()):parser.error('VR_VIEWER_PAIRING_PIN must contain six digits.')
        pairing=Pairing(folder,fixed)
        if args.forget_devices:pairing.forget_all()
        app.config['PAIRING']=pairing
        app.config['HEADSET_URLS']=[f'https://{ip}:{args.port}' for ip in addresses] or [f'https://{hostname}:{args.port}']
        url=f'https://localhost:{args.port}'
    if opened:print(f'\nOpened {opened[1]}: {len(workspace.state["scene"]["objects"])} part(s).',flush=True)
    print(f'\nVR-Viewer desktop: {url}',flush=True)
    if pairing:
        print('Quest: '+ ' or '.join(app.config['HEADSET_URLS'])+'\nAccept the local certificate warning, then pair with PIN: '+pairing.pin,flush=True)
    print('Data: '+str(workspace.folder)+'\nFiles: '+str(app.extensions['vr_viewer']['root'])+'\nPress Ctrl+C to stop.\n',flush=True)
    if not args.no_browser:Thread(target=open_when_ready,args=(url,args.port),daemon=True).start()
    app.run(host=host,port=args.port,ssl_context=ssl_context,threaded=True,debug=False)

if __name__=='__main__':main()
