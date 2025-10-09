# graph_fs/server.py
import os
import logging
from flask import Flask, send_from_directory, jsonify, request
from flask_socketio import SocketIO, emit

from .fs_model import MultiFSModel  # <-- CHANGED: use multi-root model
from .watch_registry import WatchRegistry
from .logging_utils import get_logger, block

# -----------------------------------------------------------------------------
# App + Socket.IO setup
# -----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(__file__)
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="/")

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    logger=False,
    engineio_logger=False,
)

log = get_logger("graphfs.server")

# -----------------------------------------------------------------------------
# State
# -----------------------------------------------------------------------------
fs = MultiFSModel()  # <-- CHANGED: multi-root filesystem model
registry = WatchRegistry()

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _sid() -> str:
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
    return send_from_directory(FRONTEND_DIR, "templates/index.html")

@app.route("/health")
def health():
    roots = fs.list_roots()
    data = {"ok": True, "roots": roots}
    _dbg("HTTP /health", roots=str(roots))
    return jsonify(data)

# -----------------------------------------------------------------------------
# Socket.IO events
# -----------------------------------------------------------------------------
@socketio.on("connect")
def on_connect():
    roots = fs.list_roots()
    _ok("SOCKET CONNECTED", sid=_sid(), roots=str(roots))
    emit("server_info", {"message": "connected", "roots": roots})

@socketio.on("disconnect")
def on_disconnect():
    try:
        registry.disable(_sid())
        _ok("SOCKET DISCONNECTED; CLEANED WATCHES", sid=_sid())
    except Exception:
        log.exception("disconnect cleanup failed", extra={"sid": _sid()})

@socketio.on("add_root")  # <-- NEW: add a root
def on_add_root(data):
    path = (data or {}).get("path", "").strip()
    excludes = (data or {}).get("excludes", [])
    _ok("ADD ROOT RECEIVED", sid=_sid(), path=path, excludes=",".join(excludes or []))
    try:
        abs_root = fs.add_root(path)
        emit("root_added", {"root": abs_root, "name": os.path.basename(abs_root)})
        _dbg("ROOT ADDED EMITTED", sid=_sid(), root=abs_root)

        # AUTO-ENABLE WATCH ON NEW ROOT
        registry.enable(_sid(), abs_root, _on_fs_event, recursive=True)
        _ok("WATCH AUTO-ENABLED ON ROOT", sid=_sid(), path=abs_root)

        children = fs.list_dir(abs_root, excludes=excludes)
        emit("listing", {"path": abs_root, "children": children})
        _ok("LISTING EMITTED (NEW ROOT)", sid=_sid(), path=abs_root, count=len(children))
    except Exception as e:
        log.exception("add_root failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": str(e)})

@socketio.on("remove_root")  # <-- NEW: remove a root
def on_remove_root(data):
    path = (data or {}).get("path", "").strip()
    _ok("REMOVE ROOT RECEIVED", sid=_sid(), path=path)
    try:
        abs_path = os.path.abspath(path)
        fs.remove_root(abs_path)
        
        # Disable watch for this root
        registry.disable(_sid(), abs_path)
        
        emit("root_removed", {"root": abs_path})
        _ok("ROOT REMOVED", sid=_sid(), path=abs_path)
    except Exception as e:
        log.exception("remove_root failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": str(e)})

@socketio.on("list_roots")  # <-- NEW: list all roots
def on_list_roots(data):
    _dbg("LIST ROOTS RECEIVED", sid=_sid())
    try:
        roots = fs.list_roots()
        emit("roots_list", {"roots": roots})
        _ok("ROOTS LIST EMITTED", sid=_sid(), count=len(roots))
    except Exception as e:
        log.exception("list_roots failed", extra={"sid": _sid()})
        emit("error", {"message": str(e)})

# LEGACY: kept for backward compatibility (acts like add_root)
@socketio.on("set_root")
def on_set_root(data):
    _ok("SET ROOT (LEGACY) -> forwarding to add_root", sid=_sid())
    on_add_root(data)

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
# Optional startup roots (no watch auto-start)
# -----------------------------------------------------------------------------
def start_watcher_on_startup():
    """Optional root bootstrap from env; does NOT start watches."""
    root = os.environ.get("GRAPHFS_ROOT")
    if not root:
        _dbg("STARTUP ROOT", note="no GRAPHFS_ROOT set")
        return
    try:
        abs_root = fs.add_root(root)
        _ok("STARTUP ROOT SET FROM ENV", root=abs_root)
    except Exception:
        log.exception("Failed to add root from GRAPHFS_ROOT", extra={"wanted": root})