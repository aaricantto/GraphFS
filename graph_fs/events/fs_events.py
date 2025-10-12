# Bridge: filesystem -> client socket
from ..server import socketio, _dbg, log

def on_fs_event(evt: dict):
    sid = evt.get("sid")

    def _send():
        try:
            socketio.emit("fs_event", evt, to=sid)
            # Keep the structured DEBUG...
            _dbg(
                "FS EVENT FORWARDED",
                sid=sid,
                kind=evt.get("event"),
                path=evt.get("path"),
                dest=evt.get("dest_path"),
                is_dir=bool(evt.get("is_dir")),
                seq=evt.get("seq"),
            )
            # ...and also a concise INFO line so it shows up with default logging
            try:
                kind = (evt.get("event") or "").upper()
                is_dir = bool(evt.get("is_dir"))
                typ = "FOLDER" if is_dir else "FILE"
                p = evt.get("path")
                d = evt.get("dest_path")
                if d:
                    log.info(f"→ fs_event: {typ} {kind}: {p} → {d} (sid={sid})")
                else:
                    log.info(f"→ fs_event: {typ} {kind}: {p} (sid={sid})")
            except Exception:
                pass
        except Exception:
            log.exception("failed to forward fs_event", extra={"sid": sid, "evt": evt})

    socketio.start_background_task(_send)