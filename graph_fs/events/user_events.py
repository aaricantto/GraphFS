import logging
from flask_socketio import emit
from ..server import (
    socketio, fs, registry, app_state,
    _sid, _ok, _dbg, _err, _abs, _touch_for_root
)
from .fs_events import on_fs_event as _on_fs_event

# ---- Socket.IO events --------------------------------------------------------

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
        from ..server import log
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
        import os
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
        from ..server import log
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
        from ..server import log
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
        from ..server import log
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
        from ..server import log
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
        from ..server import log
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
        from ..server import log
        log.exception("watch_disable failed", extra={"sid": _sid(), "path": path})
        emit("error", {"message": f"watch_disable failed: {e}"})

@socketio.on("log_level")
def on_log_level(data):
    lvl = str((data or {}).get("level", "INFO")).upper()
    level = getattr(logging, lvl, logging.INFO)
    import logging as _logging
    _logging.getLogger().setLevel(level)
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
