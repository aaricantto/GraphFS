import os
from fnmatch import fnmatch

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
