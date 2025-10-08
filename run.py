from graph_fs.server import app, socketio, start_watcher_on_startup

if __name__ == "__main__":
    # Start with no root; user will set it from the UI.
    start_watcher_on_startup()
    # Use eventlet so Socket.IO can do real WebSockets easily.
    socketio.run(app, host="0.0.0.0", port=5098, debug=True)
