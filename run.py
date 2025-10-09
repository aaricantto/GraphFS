from graph_fs.logging_utils import init_logging
init_logging()  # colored console logs; quiet noisy frameworks by default

from graph_fs.server import app, socketio, start_watcher_on_startup

if __name__ == "__main__":
    # Restore previous session (favourites + active roots) before serving.
    start_watcher_on_startup()
    # Run the app. debug=True keeps reloader & better tracebacks.
    socketio.run(app, host="0.0.0.0", port=5098, debug=True)
