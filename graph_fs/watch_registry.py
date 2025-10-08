# graph_fs/watch_registry.py
import os, sys, traceback, itertools
from typing import Dict, Tuple, Optional, Callable
from watchdog.events import FileSystemEventHandler
from watchdog.observers.inotify import InotifyObserver

def _abs(p: Optional[str]) -> Optional[str]:
    if p is None:
        return None
    try:
        return os.path.abspath(p)
    except Exception:
        return p

class _CtxHandler(FileSystemEventHandler):
    """Adds sid + watch_path + monotonic seq to each emitted fs event."""
    def __init__(self, cb: Callable[[dict], None], sid: str, watch_path: str):
        super().__init__()
        self.cb = cb
        self.sid = sid
        self.watch_path = _abs(watch_path)
        self.seq = itertools.count(1)

    def _emit(self, kind: str, src: str, is_dir: bool, dest: Optional[str] = None):
        evt = {
            "event": kind,
            "path": _abs(src),
            "is_dir": bool(is_dir),
            "sid": self.sid,
            "watch_path": self.watch_path,
            "seq": next(self.seq),
        }
        if dest is not None:
            evt["dest_path"] = _abs(dest)

        print(f"[watcher][sid={self.sid}] {kind}: {evt['path']}"
              f"{' -> ' + evt['dest_path'] if dest is not None else ''}"
              f" (dir={is_dir})", flush=True)
        try:
            self.cb(evt)
        except Exception:
            traceback.print_exc(file=sys.stdout)

    def on_created(self, e): self._emit("created", e.src_path, e.is_directory)
    def on_deleted(self, e): self._emit("deleted", e.src_path, e.is_directory)
    def on_modified(self, e): self._emit("modified", e.src_path, e.is_directory)
    def on_moved(self, e):    self._emit("moved",   e.src_path, e.is_directory, dest=e.dest_path)


class WatchRegistry:
    """
    Single inotify observer, many watched dirs.
    Keys are (sid, abs_path) -> ObservedWatch
    """
    def __init__(self):
        self.observer = InotifyObserver()
        self.observer.daemon = True
        self.observer.start()
        self._watches: Dict[Tuple[str, str], object] = {}

    def enable(self, sid: str, abs_path: str, cb: Callable[[dict], None], recursive: bool = True):
        key = (sid, abs_path)
        if key in self._watches:
            return  # idempotent
        handler = _CtxHandler(cb, sid, abs_path)
        watch = self.observer.schedule(handler, abs_path, recursive=recursive)
        self._watches[key] = watch
        print(f"[watcher] enabled sid={sid} path={abs_path}", flush=True)

    def disable(self, sid: str, abs_path: Optional[str] = None):
        if abs_path is None:
            # disable all for this sid
            for (s, p), w in list(self._watches.items()):
                if s == sid:
                    self.observer.unschedule(w)
                    self._watches.pop((s, p), None)
            print(f"[watcher] disabled ALL for sid={sid}", flush=True)
            return

        key = (sid, abs_path)
        w = self._watches.pop(key, None)
        if w:
            self.observer.unschedule(w)
            print(f"[watcher] disabled sid={sid} path={abs_path}", flush=True)

    def stop(self):
        for _, w in list(self._watches.items()):
            self.observer.unschedule(w)
        self._watches.clear()
        self.observer.stop()
        self.observer.join(timeout=3)
