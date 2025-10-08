# graph_fs/watcher.py
import os
import sys
import traceback
from typing import Callable, Optional

from watchdog.events import FileSystemEventHandler
from watchdog.observers.inotify import InotifyObserver


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
        # Simple, unbuffered log to stdout so you can see events immediately.
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

    # --- watchdog event hooks -----------------------------------------------
    def on_created(self, event):
        self._emit("created", event.src_path, event.is_directory)

    def on_deleted(self, event):
        self._emit("deleted", event.src_path, event.is_directory)

    def on_modified(self, event):
        # Many editors touch files frequently; still forward so the UI can decide.
        self._emit("modified", event.src_path, event.is_directory)

    def on_moved(self, event):
        self._emit("moved", event.src_path, event.is_directory, dest=event.dest_path)


class WatchManager:
    """
    Manages a single inotify observer bound to a 'root' path.

    - Uses Linux inotify ONLY (no polling, no fallback).
    - start(root, cb): begins watching recursively from root
    - stop(): stops observer
    """

    def __init__(self):
        self.observer: Optional[InotifyObserver] = None
        self.root: Optional[str] = None

    @property
    def is_running(self) -> bool:
        return self.observer is not None

    def start(self, root: str, cb: Callable[[dict], None]):
        """
        Start watching `root` recursively with inotify. Raises on any failure.
        """
        self.stop()  # cleanly replace an existing observer

        if not root:
            raise ValueError("watch root is required")
        abs_root = os.path.abspath(root)
        if not os.path.isdir(abs_root):
            raise NotADirectoryError(f"Not a directory: {abs_root}")

        handler = _Handler(cb)
        obs = InotifyObserver()

        # Schedule and start. Any scheduling failure (e.g., path not supported)
        # will raise here and we propagate it — no fallback.
        try:
            obs.schedule(handler, abs_root, recursive=True)
        except Exception as e:
            raise RuntimeError(f"inotify failed to schedule on {abs_root}: {e}")

        obs.daemon = True
        obs.start()

        self.observer = obs
        self.root = abs_root
        print(f"[watcher] started (inotify) on {self.root}", flush=True)

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
