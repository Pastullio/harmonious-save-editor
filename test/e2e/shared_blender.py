# The LiveLink add-on's side of shared travellers (owner 2026-11-23), against a running app (HSE_LIVE_FILE=<its live.json>):
# the check-in lists DryDock's shared travellers and hands over an "Add to Blender" request once; the menu lists them;
# Import asks for the right one. Usage: <python with bpy> shared_blender.py <addon dir> <expect import: 0 or 1>
import json, os, sys
import bpy

sys.path.insert(0, sys.argv[-2])
import harmonious_live_link as live

live.register()
live.check_link_now()
out = {"shared": live.LINK["shared"], "want": live.LINK["want"], "traveller": live.LINK["traveller"]}
live.LINK["want"] = None
live.check_link_now()
out["want_again"] = live.LINK["want"]   # handed over once only


class Lay:
    def __init__(self, rows): self.rows = rows
    def label(self, text="", **k): self.rows.append(("label", text))
    def operator(self, idname, text="", **k):
        props = type("P", (), {})(); self.rows.append((text, props)); return props

rows = []
live.HARMONIOUS_MT_shared.draw(type("M", (), {"layout": Lay(rows)})(), bpy.context)
out["menu"] = [(t, getattr(p, "who", None)) for t, p in rows]

# what Import asks DryDock for (the request is caught here; no game files to build from in the test)
asked = []
real = live.urllib.request.urlopen
def fake(req, timeout=0):
    asked.append(req.full_url.split("/api/live/")[1])
    raise live.urllib.error.URLError("stop here")
live.urllib.request.urlopen = fake
for who in (0, 2):
    try:
        bpy.ops.harmonious.import_traveller(who=who)
    except RuntimeError:
        pass
live.urllib.request.urlopen = real
out["asked"] = asked
print("RESULT " + json.dumps(out), flush=True)
os._exit(0)
