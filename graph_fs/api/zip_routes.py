
import io, os, time, zipfile
from flask import Response, request
from ..server import app, fs, _ok

@app.route("/api/zip_files", methods=["POST"])
def zip_files():
    """
    Build a zip containing the provided absolute file paths (validated under roots).
    Request: { "paths": ["/abs/file1", "/abs/file2", ...] }
    Response: application/zip (download)
    """
    data = request.get_json(silent=True) or {}
    paths = data.get("paths", [])
    if not paths:
        return {"error": "No paths provided"}, 400

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in paths:
            try:
                resolved = fs.resolve(p)
                if not os.path.isfile(resolved):
                    continue
                arcname = os.path.basename(resolved)  # change if you want to preserve subpaths
                zf.write(resolved, arcname)
            except Exception:
                # Skip anything we can't safely include
                continue

    buf.seek(0)
    _ok("ZIP BUILT", count=len(paths))
    filename = f"scripts-{int(time.time())}.zip"
    return Response(
        buf.getvalue(),
        mimetype="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
