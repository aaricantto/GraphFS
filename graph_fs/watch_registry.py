# graph_fs/watch_registry.py
import os
import sys
import traceback
import itertools
import logging
from typing import Dict, Tuple, Optional, Callable

from watchdog.events import FileSystemEventHandler
from watchdog.observers.inotify import InotifyObserver

log = logging.getLogger("graphfs.watch_registry")
if not log.handlers:
    log.setLevel(logging.INFO)

def _abs(p: Optional[str]) -> Optional[str]:
    if p is None:
        return None
    try:
        return os.path.abspath(p)
    except Exception:
        return p

class _CtxHandler(FileSystemEventHandler):
    """Adds sid + watch_path + monotonic seq to each emitted fs event; emits debug logs."""
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

        log.debug(
            "inotify event",
            extra={
                "sid": self.sid,
                "kind": kind,
                "path": evt["path"],
                "dest_path": evt.get("dest_path"),
                "is_dir": is_dir,
                "seq": evt["seq"],
                "watch_path": self.watch_path,
            },
        )
        try:
            self.cb(evt)
        except Exception:
            # Never let callback errors kill the observer thread
            log.exception("ERROR delivering event to callback", extra={"sid": self.sid})
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
        log.info("inotify observer started")

    def enable(self, sid: str, abs_path: str, cb: Callable[[dict], None], recursive: bool = True):
        key = (sid, abs_path)
        if key in self._watches:
            log.debug("watch already enabled (idempotent)", extra={"sid": sid, "path": abs_path})
            return

        if not os.path.isdir(abs_path):
            # Fail early with a clear message
            msg = f"Not a directory: {abs_path}"
            log.warning("enable rejected: not a directory", extra={"sid": sid, "path": abs_path})
            raise NotADirectoryError(msg)

        handler = _CtxHandler(cb, sid, abs_path)
        watch = self.observer.schedule(handler, abs_path, recursive=recursive)
        self._watches[key] = watch
        log.info("watch enabled", extra={"sid": sid, "path": abs_path, "recursive": recursive,
                                         "active_watches": len(self._watches)})

    def disable(self, sid: str, abs_path: Optional[str] = None):
        if abs_path is None:
            removed = 0
            # disable all for this sid
            for (s, p), w in list(self._watches.items()):
                if s == sid:
                    self.observer.unschedule(w)
                    self._watches.pop((s, p), None)
                    removed += 1
            log.info("watches disabled (all for sid)", extra={"sid": sid, "removed": removed,
                                                              "active_watches": len(self._watches)})
            return

        key = (sid, abs_path)
        w = self._watches.pop(key, None)
        if w:
            self.observer.unschedule(w)
            log.info("watch disabled", extra={"sid": sid, "path": abs_path,
                                              "active_watches": len(self._watches)})
        else:
            log.debug("disable noop (no watch found)", extra={"sid": sid, "path": abs_path})

    def stop(self):
        for _, w in list(self._watches.items()):
            self.observer.unschedule(w)
        self._watches.clear()
        self.observer.stop()
        self.observer.join(timeout=3)
        log.info("inotify observer stopped")
