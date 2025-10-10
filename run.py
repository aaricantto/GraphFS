from graph_fs.logging_utils import init_logging
init_logging()  # colored console logs; quiet noisy frameworks by default

# IMPORTANT: we’ll serve the ASGI app from Flask-SocketIO (no eventlet)
from graph_fs.server import app, socketio, start_watcher_on_startup

if __name__ == "__main__":
    # Restore previous session (favourites + active roots) before serving.
    start_watcher_on_startup()

    import asyncio
    from hypercorn.config import Config
    from hypercorn.asyncio import serve

    cfg = Config()
    cfg.bind = ["0.0.0.0:5098"]
    cfg.use_reloader = True
    cfg.accesslog = "-"  # log to stdout

    print("✅ Starting GraphFS server (ASGI / asyncio, Python 3.14)…")
    # Serve the Socket.IO ASGI app (wraps Flask + Socket.IO)
    asyncio.run(serve(app, cfg))
