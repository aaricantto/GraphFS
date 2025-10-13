# graph_fs/filesystem.py
import platform

def get_observer_class():
    """
    Select a watchdog Observer class appropriate for the host OS.
    Linux   -> InotifyObserver
    macOS   -> FSEventsObserver
    Windows -> Observer (Windows API backend)
    Fallback -> generic Observer
    """
    sysname = platform.system().lower()
    try:
        if sysname == "linux":
            from watchdog.observers.inotify import InotifyObserver
            return InotifyObserver
        elif sysname == "darwin":
            from watchdog.observers.fsevents import FSEventsObserver
            return FSEventsObserver
        elif sysname == "windows":
            from watchdog.observers import Observer
            return Observer
        else:
            from watchdog.observers import Observer
            return Observer
    except Exception:
        # Last-resort fallback
        from watchdog.observers import Observer
        return Observer


def backend_name(cls) -> str:
    """Human-friendly name for logs."""
    try:
        return cls.__name__
    except Exception:
        return "Observer"
