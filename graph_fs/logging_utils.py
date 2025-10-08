import logging
import os
from typing import Optional

# Environment knobs (optional):
#   GRAPHFS_LOG=DEBUG|INFO|WARNING (default INFO)
#   GRAPHFS_ACCESS_LOG=1           (show werkzeug/engineio/socketio access logs)
LOG_LEVEL = getattr(logging, os.environ.get("GRAPHFS_LOG", "INFO").upper(), logging.INFO)


def _rich_handler():
    # Always prefer Rich (you installed it). Fall back to plain StreamHandler if missing.
    try:
        from rich.logging import RichHandler  # type: ignore
        return RichHandler(
            show_time=True,
            show_path=False,
            rich_tracebacks=True,
            markup=False,
            log_time_format="[%X]",
        )
    except Exception:
        return logging.StreamHandler()


def init_logging() -> None:
    """Idempotent: set up colored console logging and quiet noisy frameworks."""
    if getattr(init_logging, "_inited", False):
        return

    root = logging.getLogger()
    root.setLevel(LOG_LEVEL)

    ch = _rich_handler()
    ch.setLevel(LOG_LEVEL)
    # Message-only; Rich renders level/time.
    ch.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(ch)

    # Quiet the HTTP/socket spam unless explicitly requested
    if not os.environ.get("GRAPHFS_ACCESS_LOG"):
        logging.getLogger("werkzeug").setLevel(logging.WARNING)
        logging.getLogger("engineio").setLevel(logging.WARNING)
        logging.getLogger("socketio").setLevel(logging.WARNING)

    init_logging._inited = True  # type: ignore[attr-defined]


def get_logger(name: str) -> logging.Logger:
    """Return a module logger that inherits the root config."""
    log = logging.getLogger(name)
    log.setLevel(LOG_LEVEL)
    return log


def block(title: str, **fields) -> str:
    """Human-friendly multi-line block for structured log output."""
    if fields:
        lines = [f"{k:<10}: {v}" for k, v in fields.items()]
        body = "\n┃ " + "\n┃ ".join(lines)
    else:
        body = ""
    return f"┏ {title}{body}\n┗"
