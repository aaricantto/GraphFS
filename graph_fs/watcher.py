import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class _Handler(FileSystemEventHandler):
    def __init__(self, cb):
        super().__init__()
        self.cb = cb  # callback(evt: dict)

    def on_created(self, event):
        self.cb({
            "event": "created",
            "path": event.src_path,
            "is_dir": event.is_directory
        })

    def on_deleted(self, event):
        self.cb({
            "event": "deleted",
            "path": event.src_path,
            "is_dir": event.is_directory
        })

    def on_modified(self, event):
        # Many editors fire frequent file writes; we still forward — client can choose what to refresh.
        self.cb({
            "event": "modified",
            "path": event.src_path,
            "is_dir": event.is_directory
        })

    def on_moved(self, event):
        self.cb({
            "event": "moved",
            "path": event.src_path,
            "dest_path": event.dest_path,
            "is_dir": event.is_directory
        })

class WatchManager:
    """
    Manages a single watchdog observer bound to a 'root' path.
    Emits normalized events via provided callback.
    """

    def __init__(self):
        self.observer = None
        self.root = None

    def start(self, root: str, cb):
        self.stop()
        self.root = os.path.abspath(root)
        handler = _Handler(cb)
        obs = Observer()
        obs.schedule(handler, self.root, recursive=True)
        obs.daemon = True
        obs.start()
        self.observer = obs

    def stop(self):
        if self.observer:
            try:
                self.observer.stop()
                self.observer.join(timeout=2)
            finally:
                self.observer = None
