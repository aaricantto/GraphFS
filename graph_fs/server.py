# graph_fs/server.py
import os
import logging
from flask import Flask, send_from_directory, jsonify, request
from flask_socketio import SocketIO, emit

from .fs_model import MultiFSModel
from .watch_registry import WatchRegistry
from .logging_utils import get_logger, block
from .appdata import AppState

# -----------------------------------------------------------------------------
# App + Socket.IO setup
# -----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(__file__)
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="/")

# Use ASGI mode so we can run with Hypercorn/asyncio (no eventlet)
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
fs = MultiFSModel()
registry = WatchRegistry()
app_state = AppState()  # repo-local ./appdata by default

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

def _abs(p: str) -> str:
    return os.path.abspath(os.path.expanduser(os.path.expandvars(p or "")))

def _touch_for_root(abs_path: str):
    abs_path = _abs(abs_path)
    # Touch owning root (or itself if exact)
    for r in list(fs.roots.keys()):
        rr = r.rstrip(os.sep)
        if abs_path == rr or abs_path.startswith(rr + os.sep):
            app_state.touch_root(rr)
            return

# -----------------------------------------------------------------------------
# HTTP routes
# -----------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "templates/index.html")

@app.route("/health")
def health():
    roots = fs.list_roots()
    data = {"ok": True, "roots": roots, "app_state": app_state.snapshot()}
    _dbg("HTTP /health", roots=str(roots))
    return jsonify(data)

# -----------------------------------------------------------------------------
# Socket.IO events
# -----------------------------------------------------------------------------
@socketio.on("connect")
def on_connect():
    roots = fs.list_roots()
    _ok("SOCKET CONNECTED", sid=_sid(), roots=str(roots), appdata_dir=app_state.dir)
    emit("server_info", {
        "message": "connected",
        "roots": roots,
        "state": app_state.snapshot()
    })

@socketio.on("disconnect")
def on_disconnect():
    try:
        registry.disable(_sid())
        _ok("SOCKET DISCONNECTED; CLEANED WATCHES", sid=_sid())
    except Exception:
        log.exception("disconnect cleanup failed", extra={"sid": _sid()})

# ---- ROOT MANAGEMENT ---------------------------------------------------------
@socketio.on("add_root")
def on_add_root(data):
    path = _abs((data or {}).get("path", ""))
    excludes = (data or {}).get("excludes", [])
    _ok("ADD ROOT RECEIVED", sid=_sid(), path=path, excludes=",".join(excludes or []))
    try:
        abs_root = fs.add_root(path)
        # persist state
        app_state.record_root_add(abs_root, os.path.basename(abs_root))
        emit("root_added", {"root": abs_root, "name": os.path.basename(abs_root)})
        _dbg("ROOT ADDED EMITTED", sid=_sid(), root=abs_root)

        # Auto-enable watch for convenience
        registry.enable(_sid(), abs_root, _on_fs_event, recursive=True)
        _ok("WATCH AUTO-ENABLED ON ROOT", sid=_sid(), path=abs_root)

        children = fs.list_dir(abs_root, excludes=excludes)
        emit("listing", {"path": abs_root, "children": children})
        emit("app_state", app_state.snapshot())  # push updated state
        _ok("LISTING EMITTED (NEW ROOT)", sid=_sid(), path=abs_root, count=len(children))
    except Exception as e:
        log.exception("add_root failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": str(e)})

@socketio.on("remove_root")
def on_remove_root(data):
    path = _abs((data or {}).get("path", ""))
    _ok("REMOVE ROOT RECEIVED", sid=_sid(), path=path)
    try:
        fs.remove_root(path)
        registry.disable(_sid(), path)
        app_state.record_root_remove(path)
        emit("root_removed", {"root": path})
        emit("app_state", app_state.snapshot())
        _ok("ROOT REMOVED", sid=_sid(), path=path)
    except Exception as e:
        log.exception("remove_root failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": str(e)})

@socketio.on("list_roots")
def on_list_roots(_data):
    _dbg("LIST ROOTS RECEIVED", sid=_sid())
    try:
        roots = fs.list_roots()
        emit("roots_list", {"roots": roots})
        _ok("ROOTS LIST EMITTED", sid=_sid(), count=len(roots))
    except Exception as e:
        log.exception("list_roots failed", extra={"sid": _sid()})
        emit("error", {"message": str(e)})

# Legacy alias
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
        _touch_for_root(abs_path)
        emit("listing", {"path": abs_path, "children": children})
        _ok("LISTING EMITTED", sid=_sid(), path=abs_path, count=len(children))
    except Exception as e:
        log.exception("list_dir failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": str(e)})

# ---- WATCH -------------------------------------------------------------------
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

# ---- APP STATE / FAVOURITES --------------------------------------------------
@socketio.on("get_app_state")
def on_get_app_state(_data):
    emit("app_state", app_state.snapshot())
    _dbg("APP STATE EMITTED", sid=_sid())

@socketio.on("toggle_favorite_root")
def on_toggle_favorite_root(data):
    path = _abs((data or {}).get("path", ""))
    fav = app_state.toggle_favorite(path)
    emit("favorite_toggled", {"path": path, "favorite": fav})
    emit("app_state", app_state.snapshot())
    _ok("FAVORITE TOGGLED", sid=_sid(), path=path, favorite=fav)

# -----------------------------------------------------------------------------
# Event bridge from registry -> client socket
# -----------------------------------------------------------------------------
def _on_fs_event(evt: dict):
    sid = evt.get("sid")

    def _send():
        try:
            socketio.emit("fs_event", evt, to=sid)
            _dbg(
                "FS EVENT FORWARDED",
                sid=sid,
                kind=evt.get("event"),
                path=evt.get("path"),
                dest=evt.get("dest_path"),
                is_dir=bool(evt.get("is_dir")),
                seq=evt.get("seq"),
            )
        except Exception:
            log.exception("failed to forward fs_event", extra={"sid": sid, "evt": evt})

    socketio.start_background_task(_send)

# -----------------------------------------------------------------------------
# Startup restoration
# -----------------------------------------------------------------------------
def start_watcher_on_startup():
    """
    Restore previously active roots from app_state (if they still exist).
    We do NOT auto-enable watches here; a fresh connection will do that.
    """
    restored = 0
    try:
        for info in app_state.actives():
            p = info.get("path")
            if p and os.path.isdir(p):
                try:
                    fs.add_root(p)
                    restored += 1
                except Exception:
                    pass
        _ok("RESTORED SAVED ACTIVE ROOTS", count=restored, appdata_dir=app_state.dir)
    except Exception:
        log.exception("Failed to restore saved roots")

# -----------------------------------------------------------------------------
# Extra API
# -----------------------------------------------------------------------------
@app.route("/api/read_files", methods=["POST"])
def read_files():
    """
    Read multiple text files and return their contents.
    Request body: { "paths": ["/abs/path1", "/abs/path2", ...] }
    Response: { "files": [{"path": "...", "content": "..."}, ...] }
    """
    try:
        data = request.get_json()
        paths = data.get("paths", [])

        if not paths:
            return jsonify({"error": "No paths provided"}), 400

        results = []
        for abs_path in paths:
            try:
                # Validate path is under a root
                resolved = fs.resolve(abs_path)

                # Check if file exists and is readable
                if not os.path.isfile(resolved):
                    results.append({"path": abs_path, "error": "Not a file", "content": None})
                    continue

                # Read file with encoding detection fallback
                try:
                    with open(resolved, "r", encoding="utf-8") as f:
                        content = f.read()
                except UnicodeDecodeError:
                    try:
                        with open(resolved, "r", encoding="latin-1") as f:
                            content = f.read()
                    except Exception as e:
                        results.append({"path": abs_path, "error": f"Encoding error: {e}", "content": None})
                        continue

                results.append({"path": abs_path, "content": content, "error": None})

            except PermissionError:
                results.append({"path": abs_path, "error": "Permission denied", "content": None})
            except Exception as e:
                results.append({"path": abs_path, "error": str(e), "content": None})

        successful = [r for r in results if r["error"] is None]
        _ok("FILES READ", count=len(successful), total=len(paths))
        return jsonify({"files": successful})

    except Exception as e:
        log.exception("read_files failed")
        return jsonify({"error": str(e)}), 500
