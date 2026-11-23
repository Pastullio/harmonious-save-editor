# Harmonious DryDock: bring a corvette .blend up to date with the build in the save. Run by the app as
#   blender <file.blend> --python blend_update.py -- <build.json> [report.json]
# in your own Blender (not in the background), so your add-ons are loaded and you see the result.
#
# The .blend is NOT saved here: the scene is changed and left for you to look at. Saving it (Ctrl+S) keeps it, and
# with LiveLink on sends it back, which is when DryDock knows the file and the save agree again. The app made a copy
# of the .blend before starting Blender.
#
# Only what differs is touched, so everything else in the scene stays as it is (materials, your own objects, other
# add-ons' notes on a part):
#   - a part that is in the save and in the scene, in the same place: left alone
#   - a part that moved (same part, another place): the object is moved
#   - a part only in the scene: removed
#   - a part only in the save: added with Charon Forge when it is installed (its real model), else as a copy of a
#     part of the same kind already in the scene, else as a plain box that still carries the part's details
# A scene with groups, presets or Forge shapes keeps parts inside them where this can't reach, so there the whole
# build is brought in again with Charon Forge's own import (which replaces the build objects), or nothing is done.
import json
import math
import sys
import time

import bpy
import mathutils

TOL_POS = 0.002    # game units: a part within this of where the save has it is the same part
TOL_DIR = 0.002    # the same for its Up (which carries the size) and At

Z_UP = mathutils.Matrix.Rotation(math.radians(-90.0), 4, "X")       # Blender's Z-up to the game's Y-up
Z_BACK = mathutils.Matrix.Rotation(math.radians(90.0), 4, "X")


def whole(v):
    try:
        return int(str(v).strip() or 0)
    except (TypeError, ValueError):
        try:
            return int(float(v or 0))
        except (TypeError, ValueError):
            return 0


def part_id(v):
    return str(v or "").lstrip("^")


def read_object(o):
    """A scene part the way the builders write it (and the LiveLink add-on reads it)."""
    m = Z_UP @ o.matrix_world
    return {"id": part_id(o.get("ObjectID")), "pos": tuple(m.translation), "up": tuple(m.col[1].to_3d()),
            "at": tuple(m.col[2].to_3d().normalized()), "stamp": whole(o.get("Timestamp", 0)), "user": whole(o.get("UserData", 0)), "obj": o}


def read_data(d):
    at = mathutils.Vector(d.get("At") or (0, 0, 1))
    if at.length > 0:
        at.normalize()
    return {"id": part_id(d.get("ObjectID")), "pos": tuple(float(x) for x in d.get("Position") or (0, 0, 0)),
            "up": tuple(float(x) for x in d.get("Up") or (0, 1, 0)), "at": tuple(at),
            "stamp": whole(d.get("Timestamp", 0)), "user": whole(d.get("UserData", 0)), "data": d}


def matrix_of(p):
    """The world matrix (Blender, Z-up) of a part from the game's Position, Up and At."""
    up, at = mathutils.Vector(p["up"]), mathutils.Vector(p["at"])
    size = up.length or 1.0
    right = at.cross(up)
    if right.length < 1e-9:   # At along Up: no turn to read, keep it upright
        right = mathutils.Vector((1, 0, 0))
    right.normalize()
    right *= -size
    at = at.normalized() * size if at.length else mathutils.Vector((0, 0, size))
    pos = p["pos"]
    m = mathutils.Matrix(((right[0], up[0], at[0], pos[0]), (right[1], up[1], at[1], pos[1]), (right[2], up[2], at[2], pos[2]), (0, 0, 0, 1)))
    return Z_BACK @ m


def close(a, b):
    return (all(abs(x - y) <= TOL_POS for x, y in zip(a["pos"], b["pos"]))
            and all(abs(x - y) <= TOL_DIR for x, y in zip(a["up"], b["up"]))
            and all(abs(x - y) <= TOL_DIR for x, y in zip(a["at"], b["at"])))


def cell(p):
    return (p["id"],) + tuple(int(math.floor(x / 0.05)) for x in p["pos"])


def match(have, want):
    """Pairs each part the save wants with the scene part in the same place. Returns (pairs, only_scene, only_save);
    a part that is twice in one place (a duplicate) pairs off one for one."""
    grid = {}
    for h in have:
        grid.setdefault(cell(h), []).append(h)
    pairs, only_save, used = [], [], set()
    for w in want:
        c = cell(w)
        hit = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for h in grid.get((c[0], c[1] + dx, c[2] + dy, c[3] + dz), ()):
                        if id(h) not in used and close(h, w):
                            hit = h
                            break
                    if hit:
                        break
                if hit:
                    break
            if hit:
                break
        if hit:
            used.add(id(hit))
            pairs.append((hit, w))
        else:
            only_save.append(w)
    return pairs, [h for h in have if id(h) not in used], only_save


def set_prop(o, key, value):
    """Keeps the kind of value the builder used (Charon Forge keeps Timestamp and UserData as text)."""
    old = o.get(key)
    o[key] = str(value) if isinstance(old, str) or old is None else int(value)


def charon_builder():
    """Charon Forge's builder when the add-on is on in this Blender (its package name has an install prefix)."""
    mods = [(n, m) for n, m in list(sys.modules.items()) if m is not None and "charon" in n.lower() and callable(getattr(m, "get_builder", None))]
    mods.sort(key=lambda nm: 0 if nm[0].endswith(".builder") else 1)
    for _name, mod in mods:
        try:
            builder = mod.get_builder()
        except Exception:  # noqa: BLE001
            continue
        if builder is not None and hasattr(builder, "deserialise_from_data"):
            return builder
    return None


def add_with_charon(builder, parts, scene):
    """Charon Forge builds the parts (their real models). Returns {index in parts: object} for the ones it made."""
    before = set(scene.objects)
    data = {"Objects": [p["data"] for p in parts], "BaseVersion": 8}
    build = getattr(builder, "_deserialise_base", None) or builder.deserialise_from_data   # the first skips "is this in a station?"
    build(data)
    made = [read_object(o) for o in scene.objects if o not in before and "ObjectID" in o]
    pairs, _, _ = match(made, parts)
    index = {id(p): k for k, p in enumerate(parts)}
    return {index[id(w)]: h["obj"] for h, w in pairs}


def add_by_copy(p, samples, scene):
    """A copy of a part of the same kind already in the scene (sharing its mesh), else a box. Returns (object, was_box)."""
    src = samples.get(p["id"])
    if src is not None:
        o = src.copy()
        o.parent = None
        o.animation_data_clear()
        for c in list(o.constraints):
            o.constraints.remove(c)
        (src.users_collection[0] if src.users_collection else scene.collection).objects.link(o)
        for key in [k for k in o.keys() if k.startswith("sw_")]:   # WorkBench's notes belong to the part it was copied from
            del o[key]
        box = False
    else:
        mesh = bpy.data.meshes.new(p["id"])
        s = 0.5
        mesh.from_pydata([(-s, -s, -s), (s, -s, -s), (s, s, -s), (-s, s, -s), (-s, -s, s), (s, -s, s), (s, s, s), (-s, s, s)], [],
                         [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
        o = bpy.data.objects.new(p["id"], mesh)
        scene.collection.objects.link(o)
        o["ObjectID"], o["SnapID"], o["belongs_to_preset"] = p["id"], p["id"], False
        box = True
    o.name = p["id"]
    o.matrix_world = matrix_of(p)
    return o, box


def update(scene, wanted):
    want = [read_data(d) for d in wanted if isinstance(d, dict) and d.get("ObjectID")]
    if not want:
        raise RuntimeError("the build from DryDock has no parts")
    holders = [o for o in scene.objects if any(k in o for k in ("GroupID", "PresetID")) or o.get("belongs_to_preset")]
    if holders:
        # parts inside groups and presets aren't objects of their own: bring the whole build in again
        if not hasattr(bpy.ops.object, "charon_import_nmsship"):
            raise RuntimeError("this scene has %d groups or presets, and their parts can only be replaced with Charon Forge, which isn't turned on in this Blender. Nothing was changed" % len(holders))
        return None
    have = [read_object(o) for o in scene.objects if "ObjectID" in o and part_id(o.get("ObjectID"))]
    pairs, gone, new = match(have, want)
    # a part that moved: the same kind of part (and colour) left over on both sides, nearest first
    moved = []
    by_kind = {}
    for h in gone:
        by_kind.setdefault((h["id"], h["user"]), []).append(h)
    still_new = []
    for w in new:
        pool = by_kind.get((w["id"], w["user"]))
        if pool:
            k = min(range(len(pool)), key=lambda i: sum((a - b) ** 2 for a, b in zip(pool[i]["pos"], w["pos"])))
            moved.append((pool.pop(k), w))
        else:
            still_new.append(w)
    gone = [h for pool in by_kind.values() for h in pool]
    samples = {}
    for h in have:
        samples.setdefault(h["id"], h["obj"])
    for h, w in moved:
        h["obj"].matrix_world = matrix_of(w)
    # add first (a copy needs a part of its kind still in the scene), then remove
    made, boxes, forged = {}, 0, 0
    builder = charon_builder() if still_new else None
    if builder is not None:
        try:
            made = add_with_charon(builder, still_new, scene)
            forged = len(made)
        except Exception as error:  # noqa: BLE001 - fall back to copies
            print("[DryDock] Charon Forge couldn't add the new parts (%s: %s); copying parts instead" % (type(error).__name__, error))
    for k, w in enumerate(still_new):
        if k not in made:
            made[k], box = add_by_copy(w, samples, scene)
            boxes += box
    obj_of = {id(w): h["obj"] for h, w in pairs + moved}
    obj_of.update({id(w): made[k] for k, w in enumerate(still_new)})
    removed = len(gone)
    if gone:
        bpy.data.batch_remove([h["obj"] for h in gone])
    # every part: the save's build order, timestamp and colour
    for order, w in enumerate(want):
        o = obj_of[id(w)]
        o["order"] = order
        if whole(o.get("Timestamp", 0)) != w["stamp"] or "Timestamp" not in o:
            set_prop(o, "Timestamp", w["stamp"])
        if whole(o.get("UserData", 0)) != w["user"] or "UserData" not in o:
            set_prop(o, "UserData", w["user"])
    return {"same": len(pairs), "moved": len(moved), "added": len(still_new), "removed": removed, "boxes": boxes, "forged": forged, "parts": len(want)}


def plural(n, word):
    return "%d %s%s" % (n, word, "" if n == 1 else "s")


def run():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    report = {"ok": False}
    lines = []
    try:
        if not args:
            raise RuntimeError("no build was given")
        with open(args[0], "r", encoding="utf-8") as f:
            doc = json.load(f)
        scene = bpy.context.scene
        result = update(scene, doc.get("objects") or [])
        if result is None:
            # groups or presets: Charon Forge's own import of the whole build
            done = bpy.ops.object.charon_import_nmsship(filepath=doc["build_file"])
            if "FINISHED" not in done:
                raise RuntimeError("Charon Forge couldn't import the build")
            result = {"whole": True, "parts": len(doc.get("objects") or [])}
            lines.append("Brought in again with Charon Forge: %s." % plural(result["parts"], "part"))
            lines.append("Groups and presets were replaced by their parts.")
        else:
            bits = [plural(result[k], "part") + " " + k for k in ("added", "removed", "moved") if result[k]]
            lines.append(("Updated from your save: " + ", ".join(bits) + ".") if bits else "Already the same as your save.")
            if result["boxes"]:
                lines.append("%s new here and shown as a box (no model in this file)." % ("1 part is" if result["boxes"] == 1 else "%d parts are" % result["boxes"]))
        lines.append("Not saved yet. Look it over, then save (Ctrl+S) to keep it.")
        if doc.get("backup"):
            lines.append("The file as it was: " + doc["backup"])
        report.update(ok=True, **result)
        bpy.context.view_layer.update()
    except Exception as error:  # noqa: BLE001 - shown in Blender and to the app
        report["error"] = "%s: %s" % (type(error).__name__, error)
        lines = ["DryDock couldn't update this file:", str(error)]
    report["lines"] = lines
    print("[DryDock] " + " ".join(lines))
    if len(args) > 1:
        with open(args[1], "w", encoding="utf-8") as f:
            json.dump(report, f)
    return report, lines


def in_window():
    """Run once Blender's window is up (builders and popups need one), then say what happened."""
    wm = bpy.context.window_manager
    if not wm.windows:
        return 0.5
    with bpy.context.temp_override(window=wm.windows[0]):
        report, lines = run()

        def draw(menu, _context):
            for line in lines:
                menu.layout.label(text=line)
        try:
            wm.popup_menu(draw, title="Harmonious DryDock", icon="INFO" if report["ok"] else "ERROR")
        except Exception:  # noqa: BLE001
            pass
    return None


if __name__ == "__main__":
    if bpy.app.background:
        run()
    else:
        bpy.app.timers.register(in_window, first_interval=0.5)
