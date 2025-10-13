# graph_fs/watcher.py
import os
import sys
import traceback
from typing import Callable, Optional

from watchdog.events import FileSystemEventHandler
from .filesystem import get_observer_class, backend_name


class _Handler(FileSystemEventHandler):
    """
    Normalizes watchdog events and forwards them to the provided callback.

    Callback signature:
        cb(evt: dict)  # keys: event, path, dest_path (optional), is_dir
    """

    def __init__(self, cb: Callable[[dict], None]):
        super().__init__()
        if not callable(cb):
            raise TypeError("watcher callback must be callable")
        self.cb = cb

    # --- helpers -------------------------------------------------------------
    @staticmethod
    def _abs(path: Optional[str]) -> Optional[str]:
        if path is None:
            return None
        try:
            return os.path.abspath(path)
        except Exception:
            return path

    @staticmethod
    def _log(msg: str) -> None:
        print(f"[watcher] {msg}", flush=True)

    def _emit(self, kind: str, src: str, is_dir: bool, dest: Optional[str] = None) -> None:
        evt = {
            "event": kind,
            "path": self._abs(src),
            "is_dir": bool(is_dir),
        }
        if dest is not None:
            evt["dest_path"] = self._abs(dest)

        # developer-friendly console log
        if dest is None:
            self._log(f"{kind}: {evt['path']} (dir={is_dir})")
        else:
            self._log(f"{kind}: {evt['path']} -> {evt['dest_path']} (dir={is_dir})")

        # hand off to server socket emitter
        try:
            self.cb(evt)
        except Exception:
            # Never let callback errors kill the observer thread
            self._log("ERROR delivering event to callback:")
            traceback.print_exc(file=sys.stdout)


class WatchManager:
    """
    Manages a single platform-appropriate observer bound to a 'root' path.

    - start(root, cb): begins watching recursively from root
    - stop(): stops observer
    """

    def __init__(self):
        self.ObserverClass = get_observer_class()
        self.observer = None
        self.root: Optional[str] = None

    @property
    def is_running(self) -> bool:
        return self.observer is not None

    def start(self, root: str, cb: Callable[[dict], None]):
        """
        Start watching `root` recursively. Raises on any failure.
        """
        self.stop()  # cleanly replace an existing observer

        if not root:
            raise ValueError("watch root is required")
        abs_root = os.path.abspath(root)
        if not os.path.isdir(abs_root):
            raise NotADirectoryError(f"Not a directory: {abs_root}")

        handler = _Handler(cb)
        obs = self.ObserverClass()

        # Schedule and start.
        try:
            obs.schedule(handler, abs_root, recursive=True)
        except Exception as e:
            raise RuntimeError(f"watcher schedule failed on {abs_root}: {e}")

        obs.daemon = True
        obs.start()

        self.observer = obs
        self.root = abs_root
        print(f"[watcher] started ({backend_name(self.ObserverClass)}) on {self.root}", flush=True)

    def stop(self):
        """
        Stop the current observer if running.
        """
        if self.observer is not None:
            try:
                print("[watcher] stopping…", flush=True)
                self.observer.stop()
                self.observer.join(timeout=3)
                print("[watcher] stopped", flush=True)
            finally:
                self.observer = None
                self.root = None
