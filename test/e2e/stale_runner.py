# Runs blend_update.py the way `blender <file> --python blend_update.py -- <build> <report>` does, but in the
# background, then saves the scene as <out> (the person's own Blender leaves it open and unsaved).
# Usage: python stale_runner.py <file.blend> <blend_update.py> <out.blend> -- <build.json> <report.json>
import os, runpy, sys
import bpy

src, script, out = sys.argv[1:4]
bpy.ops.wm.open_mainfile(filepath=src, load_ui=False)
sys.argv = ["blender"] + sys.argv[4:]
runpy.run_path(script, run_name="__main__")
bpy.ops.wm.save_as_mainfile(filepath=out, copy=True)
print("UPDATED", out, flush=True)
os._exit(0)
