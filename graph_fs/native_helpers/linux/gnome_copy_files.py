#!/usr/bin/env python3
# Requires: python3-gi, gir1.2-gtk-3.0
# Sets the GNOME/Nautilus clipboard target 'x-special/gnome-copied-files'
# with "copy\nfile:///..." payload so you can Paste in Nautilus/Nemo/Caja.

import sys, os, urllib.parse
import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gdk

def file_uri(p: str) -> str:
    return "file://" + urllib.parse.quote(os.path.abspath(p))

def main(argv):
    # argv are absolute paths from the server
    paths = [os.path.abspath(p) for p in argv if os.path.isfile(p)]
    if not paths:
        print("No files to copy.", file=sys.stderr)
        return 1

    payload = "copy\n" + "\n".join(file_uri(p) for p in paths)

    cb = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
    def _get_func(clipboard, selection, info, data):
        selection.set(selection.get_target(), 8, payload.encode("utf-8"))
    cb.set_with_data(
        targets=[Gtk.TargetEntry.new("x-special/gnome-copied-files", 0, 0)],
        get_func=_get_func,
        clear_func=lambda clipboard, data: None,
        user_data=None,
    )
    cb.store()  # persist after process exit

    print(f"Copied {len(paths)} file(s) to clipboard for GNOME Paste.")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
