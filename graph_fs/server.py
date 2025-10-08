# graph_fs/server.py
import os
import logging
from flask import Flask, send_from_directory, jsonify, request
from flask_socketio import SocketIO, emit

from .fs_model import FSModel
from .watch_registry import WatchRegistry  # one process-wide observer, many per-socket watches

# -----------------------------------------------------------------------------
# App + Socket.IO setup
# -----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/")
socketio = SocketIO(app, cors_allowed_origins="*")

# Logger: inherit handlers from root/Flask; only set name + level here
log = logging.getLogger("graphfs.server")
if not log.handlers:
    # Don't spam basicConfig; just set a sane default level if nothing configured.
    log.setLevel(logging.INFO)

# -----------------------------------------------------------------------------
# State
# -----------------------------------------------------------------------------
fs = FSModel()
registry = WatchRegistry()

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _sid() -> str:
    # request.sid only exists in socket.io handlers
    return getattr(request, "sid", "<no-sid>")

def _ok(message: str, **fields):
    log.info(message + (f" | {fields}" if fields else ""))

def _dbg(message: str, **fields):
    log.debug(message + (f" | {fields}" if fields else ""))

def _warn(message: str, **fields):
    log.warning(message + (f" | {fields}" if fields else ""))

def _err(message: str, **fields):
    log.error(message + (f" | {fields}" if fields else ""))

# -----------------------------------------------------------------------------
# HTTP routes
# -----------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")

@app.route("/health")
def health():
    data = {"ok": True, "root": fs.root or ""}
    _dbg("HTTP /health", **data)
    return jsonify(data)

# -----------------------------------------------------------------------------
# Socket.IO events
# -----------------------------------------------------------------------------
@socketio.on("connect")
def on_connect():
    _ok("socket connected", sid=_sid(), root=fs.root)
    emit("server_info", {"message": "connected", "root": fs.root})

@socketio.on("disconnect")
def on_disconnect():
    # Clean up all watches for this socket
    try:
        registry.disable(_sid())
        _ok("socket disconnected; cleaned up watches", sid=_sid())
    except Exception:
        log.exception("disconnect cleanup failed", extra={"sid": _sid()})

@socketio.on("set_root")
def on_set_root(data):
    path = (data or {}).get("path", "").strip()
    excludes = (data or {}).get("excludes", [])
    _ok("set_root received", sid=_sid(), path=path, excludes=excludes)
    try:
        fs.set_root(path)
        emit("root_set", {"root": fs.root})
        _dbg("root_set emitted", sid=_sid(), root=fs.root)

        children = fs.list_dir(fs.root, excludes=excludes)
        emit("listing", {"path": fs.root, "children": children})
        _ok("listing emitted for new root", sid=_sid(), path=fs.root, count=len(children))
    except Exception as e:
        log.exception("set_root failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": str(e)})

@socketio.on("list_dir")
def on_list_dir(data):
    path = (data or {}).get("path", "").strip()
    excludes = (data or {}).get("excludes", [])
    _dbg("list_dir received", sid=_sid(), path=path, excludes=excludes)
    try:
        abs_path = fs.resolve(path)
        children = fs.list_dir(abs_path, excludes=excludes)
        emit("listing", {"path": abs_path, "children": children})
        _ok("listing emitted", sid=_sid(), path=abs_path, count=len(children))
    except Exception as e:
        log.exception("list_dir failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": str(e)})

@socketio.on("watch_enable")
def on_watch_enable(data):
    path = (data or {}).get("path", "").strip()
    recursive = bool((data or {}).get("recursive", True))
    _ok("watch_enable received", sid=_sid(), path=path, recursive=recursive)
    try:
        abs_path = fs.resolve(path)
        registry.enable(_sid(), abs_path, _on_fs_event, recursive=recursive)
        emit("watch_ack", {"enabled": True, "path": abs_path})
        _ok("watch enabled", sid=_sid(), path=abs_path, recursive=recursive)
    except Exception as e:
        log.exception("watch_enable failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": f"watch_enable failed: {e}"})

@socketio.on("watch_disable")
def on_watch_disable(data):
    path = (data or {}).get("path")
    _ok("watch_disable received", sid=_sid(), path=path)
    try:
        abs_path = fs.resolve(path) if path else None
        registry.disable(_sid(), abs_path)
        emit("watch_ack", {"enabled": False, "path": abs_path})
        _ok("watch disabled", sid=_sid(), path=abs_path or "(all for sid)")
    except Exception as e:
        log.exception("watch_disable failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": f"watch_disable failed: {e}"})

# -----------------------------------------------------------------------------
# Event bridge from registry -> client socket
# -----------------------------------------------------------------------------
def _on_fs_event(evt: dict):
    # Route only to the socket that owns this watch
    sid = evt.get("sid")
    try:
        socketio.emit("fs_event", evt, to=sid)
        _dbg("fs_event forwarded", sid=sid, kind=evt.get("event"), path=evt.get("path"),
             dest=evt.get("dest_path"), is_dir=bool(evt.get("is_dir")), seq=evt.get("seq"))
    except Exception:
        # Don't crash on any emission failure; log and move on
        log.exception("failed to forward fs_event", extra={"sid": sid, "evt": evt})

# -----------------------------------------------------------------------------
# Optional startup root (no watch auto-start)
# -----------------------------------------------------------------------------
def start_watcher_on_startup():
    """Optional root bootstrap; does NOT start any watch."""
    root = os.environ.get("GRAPHFS_ROOT")
    if not root:
        _dbg("start_watcher_on_startup: no GRAPHFS_ROOT set")
        return
    try:
        fs.set_root(root)
        _ok("root set from env GRAPHFS_ROOT", root=fs.root)
    except Exception:
        log.exception("Failed to set root from GRAPHFS_ROOT", extra={"wanted": root})
