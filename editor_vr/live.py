"""Small WebSocket notifications; full state is fetched again after reconnects."""
import json
from queue import Queue,Empty,Full
from threading import Lock
import uuid

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
        with self.lock:self.queues.add(queue)
        self.publish({'type':'presence','count':self.listeners})
        try:
            ws.send(json.dumps({'type':'hello','boot':self.boot}))
            while True:
                try:event=queue.get(timeout=10)
                except Empty:event={'type':'ping'}
                ws.send(json.dumps(event))
                while ws.receive(timeout=0) is not None:pass
        finally:
            with self.lock:self.queues.discard(queue)
            self.publish({'type':'presence','count':self.listeners})
