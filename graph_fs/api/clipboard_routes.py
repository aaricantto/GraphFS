import os, sys, subprocess, platform
from flask import request, jsonify
from ..server import app, fs, _ok, _err

# ---------- utils -------------------------------------------------------------

def _resolve_files(paths):
    out = []
    for p in paths:
        try:
            rp = fs.resolve(p)
            if os.path.isfile(rp):
                out.append(os.path.abspath(rp))
        except Exception:
            pass
    return out

def _is_wsl() -> bool:
    try:
        rel = platform.uname().release.lower()
        if "microsoft" in rel or "wsl" in rel:
            return True
    except Exception:
        pass
    if os.environ.get("WSL_DISTRO_NAME"):
        return True
    if os.path.exists("/proc/sys/fs/binfmt_misc/WSLInterop"):
        return True
    return False

def _wsl_to_windows_paths(files):
    win = []
    for p in files:
        try:
            win.append(subprocess.check_output(["wslpath", "-w", p], text=True).strip())
        except Exception:
            pass
    return win

# ---------- runners -----------------------------------------------------------

def _run_windows_via_helper(ps1_windows_path, files_windows):
    if not ps1_windows_path:
        return False, "missing windows helper path"
    cmd = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-STA",
        "-File", ps1_windows_path,
        *files_windows,
    ]
    try:
        cp = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return True, (cp.stdout.strip() or "OK")
    except subprocess.CalledProcessError as e:
        return False, (e.stderr or e.stdout or str(e))

def _run_windows_native(files):
    here = os.path.dirname(__file__)
    ps = os.path.abspath(os.path.join(here, os.pardir, "native_helpers", "windows", "copy_files.ps1"))
    # When the server itself is Windows, the path is already Windows-y enough
    return _run_windows_via_helper(ps, files)

def _run_wsl_bridge(files):
    # Convert the helper path + each file path to Windows and call powershell.exe from WSL
    here = os.path.dirname(__file__)
    ps_wsl = os.path.abspath(os.path.join(here, os.pardir, "native_helpers", "windows", "copy_files.ps1"))
    try:
        ps_win = subprocess.check_output(["wslpath", "-w", ps_wsl], text=True).strip()
    except Exception as e:
        return False, f"wslpath failed for helper: {e}"
    files_win = _wsl_to_windows_paths(files)
    if not files_win:
        return False, "Could not convert any file paths to Windows paths"
    return _run_windows_via_helper(ps_win, files_win)

def _run_linux_gnome(files):
    here = os.path.dirname(__file__)
    py = os.path.abspath(os.path.join(here, os.pardir, "native_helpers", "linux", "gnome_copy_files.py"))
    if not os.path.isfile(py):
        return False, "missing linux helper (gnome_copy_files.py)"
    env = os.environ.copy()
    cmd = [sys.executable, py, *files]
    try:
        cp = subprocess.run(cmd, capture_output=True, text=True, env=env, check=True)
        return True, cp.stdout.strip()
    except subprocess.CalledProcessError as e:
        return False, (e.stderr or e.stdout or str(e))

# ---------- route -------------------------------------------------------------

@app.route("/api/copy_files_to_clipboard", methods=["POST"])
def copy_files_to_clipboard():
    data = request.get_json(silent=True) or {}
    paths = data.get("paths", [])
    if not paths:
        return jsonify({"ok": False, "error": "No paths provided"}), 400

    files = _resolve_files(paths)
    if not files:
        return jsonify({"ok": False, "error": "No files resolved"}), 400

    sysname = platform.system().lower()
    if sysname == "linux" and _is_wsl():
        ok, msg = _run_wsl_bridge(files)
        os_name = "wsl-bridge"
    elif sysname == "windows":
        ok, msg = _run_windows_native(files)
        os_name = "windows"
    elif sysname == "linux":
        ok, msg = _run_linux_gnome(files)
        os_name = "linux"
    else:
        return jsonify({"ok": False, "error": f"Unsupported OS: {sysname}"}), 400

    if ok:
        _ok("FILES COPIED TO OS CLIPBOARD", count=len(files), os=os_name)
        return jsonify({"ok": True, "message": msg, "count": len(files)})
    else:
        _err("CLIPBOARD COPY FAILED", os=os_name, error=msg)
        return jsonify({"ok": False, "error": msg}), 500
