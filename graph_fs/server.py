# graph_fs/server.py
import os
import logging
from flask import Flask, send_from_directory, jsonify, request
from flask_socketio import SocketIO, emit

from .fs_model import FSModel
from .watch_registry import WatchRegistry  # one process-wide observer, many per-socket watches
from .logging_utils import get_logger, block

# -----------------------------------------------------------------------------
# App + Socket.IO setup
# -----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/")

# Keep access logs quiet in console; you can re-enable via GRAPHFS_ACCESS_LOG=1 env.
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",   # least surprising; works great with background tasks
    logger=False,
    engineio_logger=False,
)

# Module logger (inherits rich console formatting)
log = get_logger("graphfs.server")

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

def _ok(title: str, **fields):
    log.info("\n" + block(title, **fields))

def _dbg(title: str, **fields):
    log.debug("\n" + block(title, **fields))

def _err(title: str, **fields):
    log.error("\n" + block(title, **fields))

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
    _ok("SOCKET CONNECTED", sid=_sid(), root=fs.root)
    emit("server_info", {"message": "connected", "root": fs.root})

@socketio.on("disconnect")
def on_disconnect():
    try:
        registry.disable(_sid())
        _ok("SOCKET DISCONNECTED; CLEANED WATCHES", sid=_sid())
    except Exception:
        log.exception("disconnect cleanup failed", extra={"sid": _sid()})

@socketio.on("set_root")
def on_set_root(data):
    path = (data or {}).get("path", "").strip()
    excludes = (data or {}).get("excludes", [])
    _ok("SET ROOT RECEIVED", sid=_sid(), path=path, excludes=",".join(excludes or []))
    try:
        fs.set_root(path)
        emit("root_set", {"root": fs.root})
        _dbg("ROOT SET EMITTED", sid=_sid(), root=fs.root)

        children = fs.list_dir(fs.root, excludes=excludes)
        emit("listing", {"path": fs.root, "children": children})
        _ok("LISTING EMITTED (NEW ROOT)", sid=_sid(), path=fs.root, count=len(children))
    except Exception as e:
        log.exception("set_root failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": str(e)})

@socketio.on("list_dir")
def on_list_dir(data):
    path = (data or {}).get("path", "").strip()
    excludes = (data or {}).get("excludes", [])
    _dbg("LIST DIR RECEIVED", sid=_sid(), path=path, excludes=",".join(excludes or []))
    try:
        abs_path = fs.resolve(path)
        children = fs.list_dir(abs_path, excludes=excludes)
        emit("listing", {"path": abs_path, "children": children})
        _ok("LISTING EMITTED", sid=_sid(), path=abs_path, count=len(children))
    except Exception as e:
        log.exception("list_dir failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": str(e)})

@socketio.on("watch_enable")
def on_watch_enable(data):
    path = (data or {}).get("path", "").strip()
    recursive = bool((data or {}).get("recursive", True))
    _ok("WATCH ENABLE RECEIVED", sid=_sid(), path=path, recursive=recursive)
    try:
        abs_path = fs.resolve(path)
        registry.enable(_sid(), abs_path, _on_fs_event, recursive=recursive)
        emit("watch_ack", {"enabled": True, "path": abs_path})
        _ok("WATCH ENABLED", sid=_sid(), path=abs_path, recursive=recursive)
    except Exception as e:
        log.exception("watch_enable failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": f"watch_enable failed: {e}"})

@socketio.on("watch_disable")
def on_watch_disable(data):
    path = (data or {}).get("path")
    _ok("WATCH DISABLE RECEIVED", sid=_sid(), path=path)
    try:
        abs_path = fs.resolve(path) if path else None
        registry.disable(_sid(), abs_path)
        emit("watch_ack", {"enabled": False, "path": abs_path})
        _ok("WATCH DISABLED", sid=_sid(), path=abs_path or "(all for sid)")
    except Exception as e:
        log.exception("watch_disable failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": f"watch_disable failed: {e}"})

# Optional: runtime verbosity toggle (backend-only; use if you want)
@socketio.on("log_level")
def on_log_level(data):
    lvl = str((data or {}).get("level", "INFO")).upper()
    level = getattr(logging, lvl, logging.INFO)
    logging.getLogger().setLevel(level)
    _ok("LOG LEVEL SET", level=lvl)

# -----------------------------------------------------------------------------
# Event bridge from registry -> client socket
# -----------------------------------------------------------------------------
def _on_fs_event(evt: dict):
    # Always emit from a Socket.IO background task (inotify runs on a different thread)
    sid = evt.get("sid")

    def _send():
        try:
            socketio.emit("fs_event", evt, to=sid)
            _dbg("FS EVENT FORWARDED",
                 sid=sid,
                 kind=evt.get("event"),
                 path=evt.get("path"),
                 dest=evt.get("dest_path"),
                 is_dir=bool(evt.get("is_dir")),
                 seq=evt.get("seq"))
        except Exception:
            log.exception("failed to forward fs_event", extra={"sid": sid, "evt": evt})

    socketio.start_background_task(_send)

# -----------------------------------------------------------------------------
# Optional startup root (no watch auto-start)
# -----------------------------------------------------------------------------
def start_watcher_on_startup():
    """Optional root bootstrap; does NOT start any watch."""
    root = os.environ.get("GRAPHFS_ROOT")
    if not root:
        _dbg("STARTUP ROOT", note="no GRAPHFS_ROOT set")
        return
    try:
        fs.set_root(root)
        _ok("STARTUP ROOT SET FROM ENV", root=fs.root)
    except Exception:
        log.exception("Failed to set root from GRAPHFS_ROOT", extra={"wanted": root})
