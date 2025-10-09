import os
from fnmatch import fnmatch
from typing import Optional, Dict, List

class FSModel:
    """
    Minimal file model with:
      - set_root(path)
      - resolve(path) -> absolute path under root
      - list_dir(abs_path, excludes=None) -> [{"name","path","type"}]
    """

    def __init__(self):
        self.root = None

    def set_root(self, path: str):
        if not path:
            raise ValueError("Root path is required.")
        root = os.path.abspath(os.path.expanduser(os.path.expandvars(path)))
        if not os.path.isdir(root):
            raise NotADirectoryError(f"Not a directory: {root}")
        self.root = root

    def _ensure_root(self):
        if not self.root:
            raise RuntimeError("Root is not set. Use set_root first.")

    def resolve(self, path: str) -> str:
        self._ensure_root()
        if not path:
            raise ValueError("Path is required.")
        abs_candidate = os.path.abspath(path if os.path.isabs(path) else os.path.join(self.root, path))
        if not abs_candidate.startswith(self.root.rstrip(os.sep) + os.sep) and abs_candidate != self.root:
            raise PermissionError("Path is outside the root.")
        return abs_candidate

    def _is_excluded(self, abs_entry_path: str, excludes):
        if not excludes:
            return False
        rel = os.path.relpath(abs_entry_path, self.root).replace("\\", "/")
        name = os.path.basename(abs_entry_path)

        # Match any:
        # - exact segment equals pattern (e.g. "venv", "__pycache__")
        # - fnmatch on basename (e.g. "*.pyc")
        # - substring on rel path segments (e.g. "node_modules" anywhere)
        parts = rel.split("/")
        for pat in excludes:
            if not pat:
                continue
            if pat in parts:
                return True
            if fnmatch(name, pat):
                return True
            if pat in rel:
                return True
        return False

    def list_dir(self, abs_path: str, excludes=None):
        self._ensure_root()
        abs_path = self.resolve(abs_path)
        if not os.path.isdir(abs_path):
            raise NotADirectoryError(f"Not a directory: {abs_path}")

        entries = []
        with os.scandir(abs_path) as it:
            for entry in it:
                if self._is_excluded(entry.path, excludes):
                    continue
                typ = "folder" if entry.is_dir(follow_symlinks=False) else "file"
                entries.append({"name": entry.name, "path": entry.path, "type": typ})

        entries.sort(key=lambda x: (x["type"] != "folder", x["name"].lower()))
        return entries


class MultiFSModel:
    """
    Multi-root sibling to FSModel.
      - add_root(path) / remove_root(path)
      - roots (dict of abs_path -> display_name)
      - resolve(path) accepts absolute paths and ensures they live under ANY root
      - list_dir(abs_path, excludes=None)
    """
    def __init__(self):
        self.roots: Dict[str, str] = {}  # abs_path -> display_name

    @staticmethod
    def _abs_dir(path: str) -> str:
        if not path:
            raise ValueError("Path is required.")
        root = os.path.abspath(os.path.expanduser(os.path.expandvars(path)))
        if not os.path.isdir(root):
            raise NotADirectoryError(f"Not a directory: {root}")
        return root

    def add_root(self, path: str) -> str:
        abs_root = self._abs_dir(path)
        name = os.path.basename(abs_root) or abs_root
        self.roots[abs_root] = name
        return abs_root

    def remove_root(self, path: str) -> None:
        if not path:
            return
        abs_root = os.path.abspath(path)
        self.roots.pop(abs_root, None)

    def list_roots(self) -> List[Dict[str, str]]:
        return [{"path": p, "name": n} for p, n in self.roots.items()]

    def _ensure_under_any_root(self, abs_candidate: str) -> str:
        if not self.roots:
            raise RuntimeError("No roots set. Use add_root first.")
        abs_candidate = os.path.abspath(abs_candidate)
        for r in self.roots.keys():
            r = r.rstrip(os.sep)
            if abs_candidate == r or abs_candidate.startswith(r + os.sep):
                return abs_candidate
        raise PermissionError("Path is outside all configured roots.")

    def resolve(self, path: str) -> str:
        if not path:
            raise ValueError("Path is required.")
        # Absolute only: client sends absolute paths (safer with multi-root)
        abs_candidate = os.path.abspath(path)
        return self._ensure_under_any_root(abs_candidate)

    def _is_excluded(self, abs_entry_path: str, excludes):
        if not excludes:
            return False
        # Determine the matching root to compute rel
        abs_entry_path = os.path.abspath(abs_entry_path)
        rel = None
        for r in self.roots.keys():
            r = r.rstrip(os.sep)
            if abs_entry_path == r:
                rel = ""
                break
            if abs_entry_path.startswith(r + os.sep):
                rel = os.path.relpath(abs_entry_path, r).replace("\\", "/")
                break
        if rel is None:
            return True  # if not under any root, treat as excluded
        name = os.path.basename(abs_entry_path)

        parts = rel.split("/") if rel else []
        for pat in excludes or []:
            if not pat:
                continue
            if pat in parts:
                return True
            if fnmatch(name, pat):
                return True
            if pat and rel and pat in rel:
                return True
        return False

    def list_dir(self, abs_path: str, excludes=None):
        abs_path = self.resolve(abs_path)
        if not os.path.isdir(abs_path):
            raise NotADirectoryError(f"Not a directory: {abs_path}")
        entries = []
        with os.scandir(abs_path) as it:
            for entry in it:
                if self._is_excluded(entry.path, excludes):
                    continue
                typ = "folder" if entry.is_dir(follow_symlinks=False) else "file"
                entries.append({"name": entry.name, "path": entry.path, "type": typ})
        entries.sort(key=lambda x: (x["type"] != "folder", x["name"].lower()))
        return entries
