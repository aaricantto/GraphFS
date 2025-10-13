from flask import jsonify, request
# Import shared singletons and helpers from the server module
from ..server import app, fs, app_state, _dbg, _ok

@app.route("/health")
def health():
    roots = fs.list_roots()
    data = {"ok": True, "roots": roots, "app_state": app_state.snapshot()}
    _dbg("HTTP /health", roots=str(roots))
    return jsonify(data)

@app.route("/api/read_files", methods=["POST"])
def read_files():
    """
    Read multiple text files and return their contents.
    Request body: { "paths": ["/abs/path1", "/abs/path2", ...] }
    Response: { "files": [{"path": "...", "content": "..."}, ...] }
    """
    try:
        data = request.get_json(silent=True) or {}
        paths = data.get("paths", [])

        if not paths:
            return jsonify({"error": "No paths provided"}), 400

        results = []
        for abs_path in paths:
            try:
                # Validate path is under a root
                resolved = fs.resolve(abs_path)

                # Check if file exists and is readable
                import os
                if not os.path.isfile(resolved):
                    results.append({"path": abs_path, "error": "Not a file", "content": None})
                    continue

                # Read file with encoding detection fallback
                try:
                    with open(resolved, "r", encoding="utf-8") as f:
                        content = f.read()
                except UnicodeDecodeError:
                    try:
                        with open(resolved, "r", encoding="latin-1") as f:
                            content = f.read()
                    except Exception as e:
                        results.append({"path": abs_path, "error": f"Encoding error: {e}", "content": None})
                        continue

                results.append({"path": abs_path, "content": content, "error": None})

            except PermissionError:
                results.append({"path": abs_path, "error": "Permission denied", "content": None})
            except Exception as e:
                results.append({"path": abs_path, "error": str(e), "content": None})

        successful = [r for r in results if r["error"] is None]
        _ok("FILES READ", count=len(successful), total=len(paths))
        return jsonify({"files": successful})

    except Exception as e:
        from ..server import log
        log.exception("read_files failed")
        return jsonify({"error": str(e)}), 500
