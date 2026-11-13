"""Puts the LiveLink logo and the add-on's coloured icons into the Blender add-on as base64, between the LOGO markers,
so the add-on stays one .py file.
- The logo: src/assets/livelink/logo-round.png (the owner's round logo, 2026-11-11), shrunk to 256 px, 256 colours.
- The icons, drawn here: neon pink for the build tools (corvettes and bases), neon blue for posing (owner, 2026-11-11),
  neon green for 3D printing (owner, 2026-11-13).
Usage: python3 tools/addon-logo.py"""
import base64, io, math, os, re
from PIL import Image, ImageDraw

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
addon = os.path.join(root, "desktop", "addon", "harmonious_live_link.py")
PINK, BLUE, GREEN = (255, 63, 160), (63, 184, 255), (57, 255, 128)
S = 256   # drawn big, shrunk to 64 for smooth edges


def png(im, colours=None):
    if colours:
        im = im.quantize(colours, method=Image.Quantize.FASTOCTREE)
    b = io.BytesIO()
    im.save(b, "PNG", optimize=True)
    return base64.b64encode(b.getvalue()).decode()


def icon(draw_fn, col):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    draw_fn(d, col + (255,))
    return im.resize((64, 64), Image.LANCZOS)


W = 22   # line width at 256 px


def line(d, pts, c, w=W):
    d.line(pts, fill=c, width=w, joint="curve")
    for p in (pts[0], pts[-1]):
        d.ellipse((p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2), fill=c)


def link(d, c):   # two chain links, drawn as rotated capsules
    def capsule(cx, cy):
        pts = []
        for k in range(40):
            a = k / 40 * 2 * math.pi
            x, y = 60 * math.cos(a), 30 * math.sin(a)
            r = math.radians(-45)
            pts.append((cx + x * math.cos(r) - y * math.sin(r), cy + x * math.sin(r) + y * math.cos(r)))
        d.line(pts + [pts[0]], fill=c, width=W, joint="curve")
    capsule(100, 156)
    capsule(156, 100)


def build(d, c):   # a wrench
    line(d, [(64, 192), (150, 106)], c, 30)
    d.ellipse((130, 40, 216, 126), outline=c, width=W)
    d.polygon([(178, 40), (216, 40), (216, 78)], fill=(0, 0, 0, 0))
    d.rectangle((168, 30, 226, 58), fill=(0, 0, 0, 0))


def corvette(d, c):   # a four-point star (a ship's glint)
    d.polygon([(128, 20), (150, 106), (236, 128), (150, 150), (128, 236), (106, 150), (20, 128), (106, 106)], fill=c)


def send(d, c):   # an arrow up out of a tray
    line(d, [(128, 176), (128, 44)], c)
    line(d, [(74, 98), (128, 44), (182, 98)], c)
    line(d, [(44, 214), (212, 214)], c)


def info(d, c):
    d.ellipse((28, 28, 228, 228), outline=c, width=W)
    line(d, [(128, 118), (128, 182)], c)
    d.ellipse((114, 66, 142, 94), fill=c)


def base(d, c):   # a house
    line(d, [(36, 124), (128, 40), (220, 124)], c)
    line(d, [(64, 112), (64, 214), (192, 214), (192, 112)], c)
    d.rectangle((108, 150, 148, 214), fill=c)


def person(d, c):
    d.ellipse((98, 18, 158, 78), fill=c)
    line(d, [(128, 92), (128, 160)], c)
    line(d, [(60, 116), (128, 100), (196, 116)], c)
    line(d, [(84, 232), (128, 160), (172, 232)], c)


def pose(d, c):   # arms up
    d.ellipse((98, 18, 158, 78), fill=c)
    line(d, [(128, 92), (128, 160)], c)
    line(d, [(56, 52), (88, 104), (128, 108), (168, 104), (200, 52)], c)
    line(d, [(84, 232), (128, 160), (172, 232)], c)


def bone(d, c):
    line(d, [(70, 186), (186, 70)], c, 28)
    for x, y in ((56, 176), (80, 200), (176, 56), (200, 80)):
        d.ellipse((x - 26, y - 26, x + 26, y + 26), fill=c)


def tool(d, c):   # a blaster
    d.polygon([(28, 96), (200, 96), (232, 120), (200, 144), (120, 144), (104, 214), (64, 214), (72, 144), (28, 144)], fill=c)


def picture(d, c):
    d.rounded_rectangle((24, 48, 232, 208), 18, outline=c, width=W)
    line(d, [(48, 186), (104, 124), (148, 168), (176, 140), (210, 184)], c, 18)
    d.ellipse((168, 74, 200, 106), fill=c)


def light(d, c):   # a sun
    d.ellipse((84, 84, 172, 172), fill=c)
    for k in range(8):
        a = k * math.pi / 4
        line(d, [(128 + 70 * math.cos(a), 128 + 70 * math.sin(a)), (128 + 106 * math.cos(a), 128 + 106 * math.sin(a))], c, 18)


def importer(d, c):   # an arrow down into a tray
    line(d, [(128, 40), (128, 168)], c)
    line(d, [(74, 116), (128, 170), (182, 116)], c)
    line(d, [(44, 214), (212, 214)], c)


def printer(d, c):   # a print head over a model being built up in layers
    d.polygon([(96, 28), (160, 28), (160, 76), (140, 104), (116, 104), (96, 76)], fill=c)
    for k, (x0, x1) in enumerate(((48, 208), (64, 192), (84, 172))):
        y = 216 - k * 30
        d.rounded_rectangle((x0, y - 18, x1, y), 6, fill=c)


def eye(d, c):
    d.ellipse((20, 64, 236, 192), outline=c, width=W)
    d.ellipse((92, 92, 164, 164), fill=c)


def ruler(d, c):
    d.rounded_rectangle((20, 92, 236, 164), 12, outline=c, width=18)
    for k, x in enumerate(range(56, 220, 32)):
        line(d, [(x, 100), (x, 128 if k % 2 else 140)], c, 14)


def stand(d, c):   # a ship on a flight stand
    d.polygon([(28, 92), (128, 44), (228, 92), (128, 112)], fill=c)
    line(d, [(128, 112), (128, 196)], c, 18)
    d.rounded_rectangle((64, 196, 192, 222), 10, fill=c)


ICONS = {"link": (link, PINK), "build": (build, PINK), "corvette": (corvette, PINK), "send": (send, PINK), "info": (info, PINK), "base": (base, PINK),
         "traveller": (person, BLUE), "pose": (pose, BLUE), "bone": (bone, BLUE), "tool": (tool, BLUE), "picture": (picture, BLUE),
         "light": (light, BLUE), "import": (importer, BLUE), "send3d": (send, BLUE),
         "print": (printer, GREEN), "printeye": (eye, GREEN), "printsize": (ruler, GREEN), "printstand": (stand, GREEN),
         "printsave": (send, GREEN), "printship": (corvette, GREEN), "printme": (person, GREEN)}

logo = Image.open(os.path.join(root, "src", "assets", "livelink", "logo-round.png")).convert("RGBA")
logo.thumbnail((256, 256), Image.LANCZOS)
logo_b64 = png(logo, 255)
icons = {k: png(icon(fn, col)) for k, (fn, col) in ICONS.items()}
if os.environ.get("ICON_SHEET"):   # a picture of every icon, to look at
    sheet = Image.new("RGBA", (72 * len(icons), 72), (40, 40, 40, 255))
    for i, k in enumerate(icons):
        sheet.alpha_composite(Image.open(io.BytesIO(base64.b64decode(icons[k]))), (i * 72 + 4, 4))
    sheet.save(os.environ["ICON_SHEET"])
block = ("# ---- LOGO (generated by tools/addon-logo.py from src/assets/livelink) ----\n"
         "LOGO_IMAGE = \"%s\"\nICONS = {\n" % logo_b64 + "".join('    "%s": "%s",\n' % kv for kv in icons.items()) + "}\n# ---- /LOGO ----")
s = open(addon, encoding="utf-8").read()
s2 = re.sub(r"# ---- LOGO .*?# ---- /LOGO ----", lambda _: block, s, flags=re.S)
assert "LOGO_IMAGE" in s2, "no LOGO markers in the add-on"
open(addon, "w", encoding="utf-8", newline="\n").write(s2)
print("logo and %d icons: %d base64 characters" % (len(icons), len(logo_b64) + sum(map(len, icons.values()))))
