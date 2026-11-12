# Renders a corvette cover with Charon Forge's real part models.
#
# Run by the desktop app as:
#   blender -b --factory-startup --python render_cover.py -- <charon_forge_dir> <build.json> <out.png> [size] [samples] [azimuth] [elevation] [views]
# An <out> ending in .glb saves the corvette as a 3D model instead (no render).
# [views] renders more camera angles from the same loaded scene instead of the main cover: "front:0:8,side:90:6,…"
# (name:azimuth:elevation), each written next to <out.png> as <out>-<name>.png.
# <charon_forge_dir> is the folder that CONTAINS the charon_forge package (Blender's extensions\user_default).
# <build.json> is {"Objects": [...], "BaseVersion": n} with plain key names, as Charon Forge imports it.
# The background is transparent so the editor can place the ship over its own backdrop.
import math
import os
import sys
import time

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
addons, build, out = args[0], args[1], args[2]
size = int(args[3]) if len(args) > 3 else 900
samples = int(args[4]) if len(args) > 4 else 32
azim = math.radians(float(args[5]) if len(args) > 5 else -35.0)
elev = math.radians(float(args[6]) if len(args) > 6 else 22.0)
views = []
for spec in (args[7].split(',') if len(args) > 7 and args[7] else []):
    name, a, e = spec.split(':')
    views.append((name, math.radians(float(a)), math.radians(float(e))))

import bpy  # noqa: E402
import mathutils  # noqa: E402


def log(*a):
    print('[cover]', *a, flush=True)


t0 = time.time()
sys.path.insert(0, addons)
import charon_forge  # noqa: E402

charon_forge.register()
log('Charon Forge loaded')

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
result = bpy.ops.object.charon_import_nmsship(filepath=build)
if 'FINISHED' not in result:
    log('import failed', result)
    os._exit(2)
scene = bpy.context.scene
log('imported', len(scene.objects), 'objects in', round(time.time() - t0, 1), 's')


def walk(lc):
    yield lc
    for c in lc.children:
        yield from walk(c)


for lc in walk(bpy.context.view_layer.layer_collection):
    lc.exclude = False
    lc.hide_viewport = False

meshes = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
if not meshes:
    log('nothing to render')
    os._exit(3)


PREVIEW_TRIS = 600000


def export_model(path):
    """The corvette as one textured .glb the editor turns like the traveller: every visible mesh made real
    (Charon Forge places parts as instances), then Blender's glTF exporter."""
    dg = bpy.context.evaluated_depsgraph_get()
    coll = bpy.data.collections.new('_hse_model')
    scene.collection.children.link(coll)
    made = []
    for inst in dg.object_instances:
        ob = inst.object
        if ob.type != 'MESH':
            continue
        src = inst.instance_object if inst.is_instance else ob
        if src is not None and getattr(src.original, 'hide_render', False):
            continue
        try:
            me = bpy.data.meshes.new_from_object(ob, preserve_all_data_layers=False, depsgraph=dg)
        except Exception:
            continue
        if not me.polygons:
            bpy.data.meshes.remove(me)
            continue
        o = bpy.data.objects.new('part', me)
        o.matrix_world = inst.matrix_world.copy()
        coll.objects.link(o)
        made.append(o)
    if not made:
        log('nothing to export')
        os._exit(3)
    # Charon Forge's materials are the game's shaders (finish variants, colourise masks, alpha from another branch),
    # which the glTF exporter can't follow: it wrote pale stand-ins and solid sheets where the game cuts holes. For the
    # model, each material gets its own diffuse picture as the colour and that picture's alpha as the cut-out. The
    # renders still use the full shaders (this is a separate Blender run).
    simple = 0
    for mat in bpy.data.materials:
        nt = mat.node_tree if mat.use_nodes else None
        if nt is None:
            continue
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        diff = nt.nodes.get('Diffuse')
        if bsdf is None or diff is None or diff.type != 'TEX_IMAGE' or diff.image is None:
            continue
        for l in list(bsdf.inputs['Base Color'].links):
            nt.links.remove(l)
        nt.links.new(diff.outputs['Color'], bsdf.inputs['Base Color'])
        if bsdf.inputs['Alpha'].is_linked:
            for l in list(bsdf.inputs['Alpha'].links):
                nt.links.remove(l)
            nt.links.new(diff.outputs['Alpha'], bsdf.inputs['Alpha'])
        simple += 1
    log('simplified', simple, 'materials for the model')
    # the model is for turning and finding an angle, not the final picture: Charon Forge's parts come to millions of
    # triangles (2.8 million for a test corvette), more than a browser draws smoothly, so it is thinned to ~600,000
    total = sum(len(o.data.polygons) for o in made)
    ratio = min(1.0, PREVIEW_TRIS / max(1, total))
    if ratio < 0.98:
        for o in made:
            if len(o.data.polygons) > 200:
                mod = o.modifiers.new('thin', 'DECIMATE')
                mod.ratio = ratio
                mod.use_collapse_triangulate = True
        log('thinned', total, 'faces by', round(ratio, 3))
    for o in bpy.context.view_layer.objects:
        o.select_set(o in made)
    bpy.context.view_layer.objects.active = made[0]
    tmp = path + '.part.glb'
    # textures keep their own format: JPEG would drop the alpha of light cards and see-through panels, which then
    # show as solid white sheets
    opts = dict(filepath=tmp, export_format='GLB', use_selection=True, export_apply=True, export_animations=False,
                export_yup=True, export_image_format='AUTO')
    try:
        bpy.ops.export_scene.gltf(**opts)
    except TypeError:
        for k in ('export_image_format', 'export_animations'):
            opts.pop(k, None)
        bpy.ops.export_scene.gltf(**opts)
    os.replace(tmp, path)
    log('exported', len(made), 'parts to', path, 'in', round(time.time() - t0, 1), 's')
    os._exit(0)


if out.lower().endswith('.glb'):
    export_model(out)

corners = [o.matrix_world @ mathutils.Vector(c) for o in meshes for c in o.bound_box]
lo = mathutils.Vector([min(c[i] for c in corners) for i in range(3)])
hi = mathutils.Vector([max(c[i] for c in corners) for i in range(3)])
center = (lo + hi) / 2

cam_data = bpy.data.cameras.new('cover_cam')
cam_data.lens = 70
cam_data.clip_end = (hi - lo).length * 20
cam = bpy.data.objects.new('cover_cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
fov = 2 * math.atan(cam_data.sensor_width / (2 * cam_data.lens))


def aim(azim, elev):
    """Point the camera from this direction and back off until the ship's whole outline fits."""
    direction = mathutils.Vector((math.cos(elev) * math.sin(azim), -math.cos(elev) * math.cos(azim), math.sin(elev)))
    if abs(direction.z) > 0.999:   # straight down: keep a sensible up axis
        direction = mathutils.Vector((0.0, -0.02, 1.0)).normalized()
    inv = direction.to_track_quat('Z', 'Y').to_matrix().transposed()
    local = [inv @ (c - center) for c in corners]
    half = math.tan(fov / 2) * 0.88
    dist = max(max(abs(v.x), abs(v.y)) / half + v.z for v in local)
    cam.location = center + direction * dist
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()


aim(azim, elev)


def sun(name, rot, strength, color, angle=3):
    d = bpy.data.lights.new(name, 'SUN')
    d.energy, d.color, d.angle = strength, color, math.radians(angle)
    o = bpy.data.objects.new(name, d)
    o.rotation_euler = [math.radians(a) for a in rot]
    scene.collection.objects.link(o)


sun('key', (50, 0, -40), 2.6, (1.0, .97, .92))
sun('rim', (-60, 0, 150), 4.0, (.65, .8, 1.0))
sun('fill', (70, 0, 120), 0.8, (.8, .85, 1.0))
world = bpy.data.worlds.new('cover_world')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs[0].default_value = (.03, .05, .09, 1)
    bg.inputs[1].default_value = 1.0

scene.render.engine = 'CYCLES'
scene.cycles.samples = samples
scene.cycles.use_denoising = True
# use a GPU when Blender has one configured; otherwise the CPU
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = True
                scene.cycles.device = 'GPU'
                log('using', kind)
                break
        except Exception:
            continue
except Exception:
    scene.cycles.device = 'CPU'
scene.render.resolution_x = scene.render.resolution_y = size
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
try:
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = -0.4
    for look in ('AgX - Medium High Contrast', 'Medium High Contrast'):
        try:
            scene.view_settings.look = look
            break
        except Exception:
            pass
except Exception:
    pass
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
def shoot(path):
    tmp = path + '.part.png'
    scene.render.filepath = tmp
    t1 = time.time()
    bpy.ops.render.render(write_still=True)
    os.replace(tmp, path)
    log('rendered', path, 'in', round(time.time() - t1, 1), 's')


if views:
    stem = out[:-4] if out.lower().endswith('.png') else out
    for name, a, e in views:
        aim(a, e)
        shoot(stem + '-' + name + '.png')
else:
    shoot(out)
os._exit(0)  # skip Blender's slow memory teardown
