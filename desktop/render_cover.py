# Renders a corvette cover with Charon Forge's real part models.
#
# Run by the desktop app as:
#   blender -b --factory-startup --python render_cover.py -- <charon_forge_dir> <build.json> <out.png> [size] [samples] [azimuth] [elevation]
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
direction = mathutils.Vector((math.cos(elev) * math.sin(azim), -math.cos(elev) * math.cos(azim), math.sin(elev)))
# fit the ship's real outline: project every bounding-box corner into the camera and back off until all fit
inv = direction.to_track_quat('Z', 'Y').to_matrix().transposed()
local = [inv @ (c - center) for c in corners]
half = math.tan(fov / 2) * 0.88
dist = max(max(abs(v.x), abs(v.y)) / half + v.z for v in local)
cam.location = center + direction * dist
cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()


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
tmp = out + '.part.png'
scene.render.filepath = tmp
t1 = time.time()
bpy.ops.render.render(write_still=True)
os.replace(tmp, out)
log('rendered', out, 'in', round(time.time() - t1, 1), 's')
os._exit(0)  # skip Blender's slow memory teardown
