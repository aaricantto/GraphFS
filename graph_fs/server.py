# graph_fs/server.py
import os
import logging
from flask import Flask, send_from_directory, request
from flask_cors import CORS  # ← ADD THIS

from .fs_model import MultiFSModel
from .watch_registry import WatchRegistry
from .logging_utils import get_logger, block
from .appdata import AppState
from .logging_utils import init_logging
init_logging()  # ensure INFO logs (watch backend + fs events) are visible

# -----------------------------------------------------------------------------
# App + Socket.IO setup
# -----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(__file__)
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="/")

# ✨ Enable CORS for all routes - allows CDN requests from your localhost origin
CORS(app, resources={r"/*": {"origins": "*"}})

# Socket.IO in threading mode (compatible on Windows without eventlet/gevent)
from flask_socketio import SocketIO
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    logger=False,
    engineio_logger=False,
)

log = get_logger("graphfs.server")

# -----------------------------------------------------------------------------
# State (singletons shared across modules)
# -----------------------------------------------------------------------------
fs = MultiFSModel()
registry = WatchRegistry()
app_state = AppState()  # repo-local ./appdata by default

# -----------------------------------------------------------------------------
# Helpers (imported by events/api modules)
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
# Static index (keep simple server responsibility here)
# -----------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")

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
# Wire up API routes and Socket.IO events by importing their modules.
# (Import AFTER the singletons above are defined to avoid circular imports.)
# -----------------------------------------------------------------------------
from .api import routes as _api_routes          # noqa: F401
from .events import fs_events as _fs_events     # noqa: F401
from .events import user_events as _user_events # noqa: F401