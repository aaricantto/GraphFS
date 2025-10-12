from graph_fs.logging_utils import init_logging
init_logging()  # colored console logs; quiet noisy frameworks by default

# IMPORTANT: we’ll serve the Flask app (Socket.IO in threading mode) via Hypercorn here,
# matching your current approach. If you prefer, you can also do socketio.run(app).
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
    # NOTE: Hypercorn expects an ASGI app; many setups serve Flask through ASGI shims,
    # but your current stack has been running with this entrypoint. If you hit issues,
    # switch to:  socketio.run(app, host="0.0.0.0", port=5098, debug=True)
    asyncio.run(serve(app, cfg))
