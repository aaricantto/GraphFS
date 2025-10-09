import json, os, time, tempfile, threading, platform
from typing import Dict, List, Optional

APPNAME = "graph-fs"
STATE_FILENAME = "state.json"

def _platform_appdir() -> str:
    """
    Cross-platform per-user app data directory:
      - Linux: XDG_DATA_HOME/graph-fs  (defaults to ~/.local/share/graph-fs)
      - macOS: ~/Library/Application Support/graph-fs
      - Windows: %APPDATA%\\graph-fs (fallback to %LOCALAPPDATA% or home)
    """
    sysname = platform.system().lower()
    if sysname == "windows":
        base = os.getenv("APPDATA") or os.getenv("LOCALAPPDATA") or os.path.expanduser("~")
        return os.path.join(base, APPNAME)
    if sysname == "darwin":
        return os.path.join(os.path.expanduser("~/Library/Application Support"), APPNAME)
    # Linux / other POSIX
    xdg = os.getenv("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    return os.path.join(xdg, APPNAME)

def _repo_local_appdir() -> str:
    """
    Prefer a repo-local ./appdata directory (ignored by git per your .gitignore).
    Falls back to platform appdir if cannot create/write.
    You can override via env GRAPHFS_APPDATA=/custom/path
    """
    env_override = os.getenv("GRAPHFS_APPDATA")
    if env_override:
        return os.path.abspath(env_override)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
    candidate = os.path.join(repo_root, "appdata")
    try:
        os.makedirs(candidate, exist_ok=True)
        # quick writability check:
        testfile = os.path.join(candidate, ".write_test")
        with open(testfile, "w", encoding="utf-8") as f:
            f.write("ok")
        os.remove(testfile)
        return candidate
    except Exception:
        # fall back to platform dir
        fallback = _platform_appdir()
        os.makedirs(fallback, exist_ok=True)
        return fallback

class AppState:
    """
    JSON-backed app state:
      roots: abs_path -> {
        name: str,
        favorite: bool,
        active: bool,           # currently in fs model
        added_at: ts,
        last_used: ts
      }
    """
    def __init__(self, dir_path: Optional[str] = None):
        self.dir = dir_path or _repo_local_appdir()
        os.makedirs(self.dir, exist_ok=True)
        self.file = os.path.join(self.dir, STATE_FILENAME)
        self._lock = threading.RLock()
        self._data: Dict = {"roots": {}}
        self._load()
        print(f"[AppState] Initialized at: {self.dir}")
        print(f"[AppState] State file: {self.file}")

    # ---------- load/save ----------
    def _load(self):
        with self._lock:
            try:
                if os.path.exists(self.file):
                    with open(self.file, "r", encoding="utf-8") as f:
                        self._data = json.load(f)
                    print(f"[AppState] Loaded state with {len(self._data.get('roots', {}))} roots")
                else:
                    self._data = {"roots": {}}
                    print(f"[AppState] No existing state file, starting fresh")
            except Exception as e:
                print(f"[AppState] Error loading state: {e}")
                # Corrupt? Start fresh rather than crash.
                self._data = {"roots": {}}

    def _save(self):
        with self._lock:
            try:
                # Write to temp file first
                tmp_file = self.file + ".tmp"
                with open(tmp_file, "w", encoding="utf-8") as f:
                    json.dump(self._data, f, indent=2)
                # Atomic replace
                os.replace(tmp_file, self.file)
                print(f"[AppState] Saved state with {len(self._data.get('roots', {}))} roots")
            except Exception as e:
                print(f"[AppState] Error saving state: {e}")

    # ---------- mutations ----------
    def _ensure_root(self, path: str) -> Dict:
        p = os.path.abspath(path)
        r = self._data["roots"].get(p)
        if not r:
            r = {
                "name": os.path.basename(p) or p,
                "favorite": False,
                "active": False,
                "added_at": time.time(),
                "last_used": 0.0,
            }
            self._data["roots"][p] = r
        return r

    def record_root_add(self, abs_path: str, name: Optional[str] = None):
        with self._lock:
            now = time.time()
            r = self._ensure_root(abs_path)
            r["name"] = name or r.get("name") or os.path.basename(abs_path) or abs_path
            r["active"] = True
            r["last_used"] = now
            if "added_at" not in r:
                r["added_at"] = now
            self._save()
            print(f"[AppState] Recorded root add: {abs_path}")

    def record_root_remove(self, abs_path: str):
        with self._lock:
            r = self._ensure_root(abs_path)
            r["active"] = False
            self._save()
            print(f"[AppState] Recorded root remove: {abs_path}")

    def touch_root(self, abs_path: str):
        with self._lock:
            r = self._ensure_root(abs_path)
            r["last_used"] = time.time()
            self._save()

    def set_favorite(self, abs_path: str, fav: bool):
        with self._lock:
            r = self._ensure_root(abs_path)
            r["favorite"] = bool(fav)
            self._save()
            print(f"[AppState] Set favorite: {abs_path} = {fav}")

    def toggle_favorite(self, abs_path: str) -> bool:
        with self._lock:
            r = self._ensure_root(abs_path)
            r["favorite"] = not bool(r.get("favorite", False))
            self._save()
            print(f"[AppState] Toggled favorite: {abs_path} = {r['favorite']}")
            return r["favorite"]

    # ---------- views ----------
    def iter_roots(self) -> List[Dict]:
        return [{"path": p, **meta} for p, meta in self._data.get("roots", {}).items()]

    def favorites(self) -> List[Dict]:
        return sorted(
            (r for r in self.iter_roots() if r.get("favorite")),
            key=lambda x: (-(x.get("last_used") or 0), x.get("name","").lower()),
        )

    def actives(self) -> List[Dict]:
        return sorted(
            (r for r in self.iter_roots() if r.get("active")),
            key=lambda x: (x.get("name","").lower()),
        )

    def recents(self, limit: int = 10) -> List[Dict]:
        return sorted(self.iter_roots(), key=lambda x: (-(x.get("last_used") or 0)))[:limit]

    def snapshot(self) -> Dict:
        with self._lock:
            return {
                "favorites": self.favorites(),
                "actives": self.actives(),
                "recents": self.recents(),
                "roots": self.iter_roots(),
                "appdata_dir": self.dir,
            }