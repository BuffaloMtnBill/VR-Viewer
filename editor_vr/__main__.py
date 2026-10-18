import argparse
import ipaddress
from pathlib import Path
import socket
from threading import Thread
import time
import webbrowser
from .server import create_app
from .lan import certificate,local_addresses
from .pairing import Pairing


def open_when_ready(url,port):
    end=time.monotonic()+20
    while time.monotonic()<end:
        try:
            with socket.create_connection(('127.0.0.1',port),timeout=.5):break
        except OSError:time.sleep(.2)
    webbrowser.open(url)


def main():
    parser=argparse.ArgumentParser(description='Editor-VR: shared desktop and Quest model annotation')
    parser.add_argument('--port',type=int,default=8020)
    parser.add_argument('--host',help='Listen address; defaults to all interfaces for the headset')
    parser.add_argument('--local',action='store_true',help='Desktop-only HTTP on loopback')
    parser.add_argument('--no-browser',action='store_true')
    parser.add_argument('--data-dir',type=Path)
    parser.add_argument('--models',type=Path,help='Folder of model projects to open (default ~/Projects/Models, or EDITOR_VR_MODELS)')
    parser.add_argument('--forget-devices',action='store_true')
    args=parser.parse_args()
    if not 1024<=args.port<=65535:parser.error('Port must be 1024–65535.')
    app=create_app(args.data_dir,models_dir=args.models)
    host=args.host or ('127.0.0.1' if args.local else '0.0.0.0')
    ssl_context=None; pairing=None
    if args.local:
        # No pairing or TLS here, so never on the network; localhost is pinned to its address rather than resolved.
        if host=='localhost':host='127.0.0.1'
        try:loopback=ipaddress.ip_address(host).is_loopback
        except ValueError:loopback=False
        if not loopback:parser.error('--local must listen on a loopback address. Use default HTTPS for the network.')
        url=f'http://[{host}]:{args.port}' if ':' in host else f'http://{host}:{args.port}'
    else:
        import os
        addresses=local_addresses();hostname=socket.gethostname()
        hosts=['localhost','127.0.0.1',hostname,*addresses]
        if host not in ('0.0.0.0','::'):hosts.append(host)
        app.config['TRUSTED_HOSTS']=list(dict.fromkeys([*app.config['TRUSTED_HOSTS'],*hosts]))
        folder=app.extensions['editor_vr']['workspace'].folder/'tls'
        ssl_context=tuple(map(str,certificate(folder,hosts)))
        fixed=os.environ.get('EDITOR_VR_PAIRING_PIN')
        if fixed is not None and (len(fixed)!=6 or not fixed.isdigit()):parser.error('EDITOR_VR_PAIRING_PIN must contain six digits.')
        pairing=Pairing(folder,fixed)
        if args.forget_devices:pairing.forget_all()
        app.config['PAIRING']=pairing
        app.config['HEADSET_URLS']=[f'https://{ip}:{args.port}' for ip in addresses] or [f'https://{hostname}:{args.port}']
        url=f'https://localhost:{args.port}'
    print(f'\nEditor-VR desktop: {url}',flush=True)
    if pairing:
        print('Quest: '+ ' or '.join(app.config['HEADSET_URLS'])+'\nAccept the local certificate warning, then pair with PIN: '+pairing.pin,flush=True)
    print('Data: '+str(app.extensions['editor_vr']['workspace'].folder)+'\nPress Ctrl+C to stop.\n',flush=True)
    if not args.no_browser:Thread(target=open_when_ready,args=(url,args.port),daemon=True).start()
    app.run(host=host,port=args.port,ssl_context=ssl_context,threaded=True,debug=False)

if __name__=='__main__':main()
