# Bridge: filesystem -> client socket
from ..server import socketio, _dbg, log

def on_fs_event(evt: dict):
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
