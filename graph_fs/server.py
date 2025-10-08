import os
from flask import Flask, send_from_directory, jsonify
from flask_socketio import SocketIO, emit
from .fs_model import FSModel
from .watcher import WatchManager

BASE_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/")
socketio = SocketIO(app, cors_allowed_origins="*")

fs = FSModel()
watcher = WatchManager()

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")

@app.route("/health")
def health():
    return jsonify({"ok": True, "root": fs.root or ""})

@socketio.on("connect")
def on_connect():
    emit("server_info", {"message": "connected", "root": fs.root})

@socketio.on("set_root")
def on_set_root(data):
    path = (data or {}).get("path", "").strip()
    excludes = (data or {}).get("excludes", [])
    try:
        fs.set_root(path)
        watcher.start(fs.root, _on_fs_event)
        emit("root_set", {"root": fs.root})
        children = fs.list_dir(fs.root, excludes=excludes)
        emit("listing", {"path": fs.root, "children": children})
    except Exception as e:
        emit("error", {"message": str(e)})

@socketio.on("list_dir")
def on_list_dir(data):
    path = (data or {}).get("path", "").strip()
    excludes = (data or {}).get("excludes", [])
    try:
        abs_path = fs.resolve(path)
        children = fs.list_dir(abs_path, excludes=excludes)
        emit("listing", {"path": abs_path, "children": children})
    except Exception as e:
        emit("error", {"message": str(e)})

def _on_fs_event(evt):
    socketio.emit("fs_event", evt)


def start_watcher_on_startup():
    """
    Back-compat no-op. If you want to auto-start the watcher with a root,
    set GRAPHFS_ROOT in the environment.
    """
    root = os.environ.get("GRAPHFS_ROOT")
    if not root:
        return
    try:
        fs.set_root(root)
        watcher.start(fs.root, _on_fs_event)
    except Exception as e:
        app.logger.warning(f"Failed to start watcher on startup: {e}")
