"""Small WebSocket notifications; full state is fetched again after reconnects."""
import json
from queue import Queue,Empty,Full
from threading import Lock
import uuid

# Pages only listen, so what a device may send is kept small (CVR-02, EVR-02, VRV-03, LAN-07):
MAX_MESSAGE=1024     # bytes in one message; the WebSocket server closes past it (SOCK_SERVER_OPTIONS)
MAX_INBOUND=64       # messages a page may send between checks, once a second, before it is closed
MAX_LISTENERS=32     # open pages at once
PING_SECONDS=10

class Hub:
    def __init__(self):
        self.boot=uuid.uuid4().hex;self.lock=Lock();self.queues=set()
    @property
    def listeners(self):
        with self.lock:return len(self.queues)
    def publish(self,event):
        with self.lock:queues=list(self.queues)
        for queue in queues:
            try:queue.put_nowait(event)
            except Full:pass
    def serve(self,ws):
        queue=Queue(maxsize=32)
        with self.lock:
            if len(self.queues)>=MAX_LISTENERS:
                ws.close(reason=1008,message='Too many open pages.');return
            self.queues.add(queue)
        self.publish({'type':'presence','count':self.listeners})
        try:
            ws.send(json.dumps({'type':'hello','boot':self.boot}))
            idle=0
            while True:
                try:event=queue.get(timeout=1);idle=0
                except Empty:
                    idle+=1;event={'type':'ping'} if idle>=PING_SECONDS else None
                if event is not None:idle=0;ws.send(json.dumps(event))
                for _ in range(MAX_INBOUND+1):
                    if ws.receive(timeout=0) is None:break
                else:
                    ws.close(reason=1008,message='Pages only listen here.');return
        finally:
            with self.lock:self.queues.discard(queue)
            self.publish({'type':'presence','count':self.listeners})
