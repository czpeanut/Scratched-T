"""Builds the top-down art set (public/assets/td/) from Gemini source images.

Sources live in assets/td/src/ (generated with tools/gemini_gen.py, the same
character references as the side-view game). This step needs no API key:

  python3 tools/td_art.py

Outputs:
  player.png, looter.png  rows 0-4 (down, up, right, down-right, up-right) x
                          5 cols (idle + 4 walk); rows 5-7 a melee swing
                          (wind-up, strike, follow-through) from the front,
                          side and back; left-facing = mirrored
  src/topdown/char-rig.ts the weapon hand of each row, measured
  zhou.png                row 0: idle, breath, wave; row 1: standing facing
                          down, down-right, right, up-right, up
  prop_*.png              one image per prop, outlined, at in-game size
  tex_*.png               seamless floor / wall textures at in-game scale
Requires Pillow.
"""
import os
import sys

from PIL import Image, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from ai_backdrop import seamless_xy  # noqa: E402
from ai_spritesheet import (add_outline, downscale, find_poses,  # noqa: E402
                            find_poses_by_components, key_magenta,
                            mass_center_x)

SRC = os.path.join(ROOT, 'assets/td/src')
OUT = os.path.join(ROOT, 'public/assets/td')

CELL_W, CELL_H = 40, 44
STAND_H = 34  # a standing figure is about one 32px tile tall


def pack_row(sheet, row, poses, scale):
    for col, p in enumerate(poses):
        cx = mass_center_x(p) * scale
        small = add_outline(downscale(p, scale))
        cx += 1
        x = max(0, min(CELL_W - small.width, round(CELL_W / 2 - cx)))
        y = CELL_H - small.height
        sheet.alpha_composite(small, (col * CELL_W + x, row * CELL_H + y))


ROWS = ('down', 'up', 'right', 'downright', 'upright')


def is_skin(p):
    r, g, b, a = p
    return a and r > 140 and r - g >= 30 and r - b >= 50 and g > 80


def weapon_hand(sheet, row, col):
    """The hand a weapon goes in, for one cell: the lowest skin pixels of the
    arm on the character's right side (screen left when facing the camera,
    screen right when facing away or sideways). Returned relative to the
    cell's centre column and the feet (the cell's bottom row)."""
    px = sheet.load()
    x0, y0 = col * CELL_W, row * CELL_H
    rows = [y for y in range(CELL_H) if any(px[x0 + x, y0 + y][3] for x in range(CELL_W))]
    top, bot = rows[0], rows[-1]
    cols = [x for x in range(CELL_W) for y in range(top, bot + 1) if px[x0 + x, y0 + y][3]]
    cx = sum(cols) / len(cols)
    side = {'down': -1, 'downright': -1, 'up': 1, 'upright': 1, 'right': 0}[ROWS[row]]
    # In profile only the near arm shows, so any skin below the head is it.
    pts = [(x, y) for y in range(top + 12, bot - 6) for x in range(CELL_W)
           if is_skin(px[x0 + x, y0 + y]) and (side == 0 or (x - cx) * side > 2)]
    want_left = side < 0
    if pts:
        low = max(y for _, y in pts)
        hand = [(x, y) for x, y in pts if y >= low - 1]
        hx = sum(x for x, _ in hand) / len(hand)
        hy = sum(y for _, y in hand) / len(hand)
    else:  # sleeve covers the hand: assume hip height at the body's side
        hx, hy = cx + (-5 if want_left else 5), top + 22
    return round(hx + 0.5 - CELL_W / 2, 1), round(hy - (CELL_H - 1), 1)


def build_character(prefix, out_name):
    """Each source strip: figure 1 is a front-facing standing calibration
    figure, figures 2-5 a walk cycle. The down row uses the calibration
    figure as its idle frame; the others use the 'feet passing' walk frame."""
    sheet = Image.new('RGBA', (CELL_W * 5, CELL_H * len(ROWS)), (0, 0, 0, 0))
    for row, d in enumerate(ROWS):
        strip = key_magenta(Image.open(os.path.join(SRC, f'{prefix}_{d}.png')))
        poses = find_poses(strip, 5)
        scale = STAND_H / poses[0].height
        walk = poses[1:]
        idle = poses[0] if d == 'down' else walk[1]
        pack_row(sheet, row, [idle] + walk, scale)
    hands = [weapon_hand(sheet, r, 0) for r in range(len(ROWS))]
    sheet, swings = add_attacks(sheet, prefix)
    sheet.save(os.path.join(OUT, out_name))
    print('wrote', out_name, sheet.size)
    return hands, swings


ATTACK_ROWS = ('front', 'side', 'back')  # sheet rows 5, 6, 7


def swing_hand(sheet, row, col):
    """The swinging fist of an attack frame and the forearm's direction.
    Relative to the cell centre and the feet; the angle points from the
    shoulder to the fist.

    Wind-up: the skin farthest from the chest, ignoring the face (the fist is
    raised by the head). Strike and follow-through: the outermost opaque
    pixel in front of the body between shoulder and hip height - the fist is
    often shaded too dark to read as skin there."""
    import math
    px = sheet.load()
    x0, y0 = col * CELL_W, row * CELL_H
    rows = [y for y in range(CELL_H) if any(px[x0 + x, y0 + y][3] for x in range(CELL_W))]
    top = rows[0]
    head = [x for y in range(top, top + 6) for x in range(CELL_W) if px[x0 + x, y0 + y][3]]
    hx = sum(head) / len(head)
    chest = (hx, top + 14)
    shoulder = (hx + 2, top + 12)
    if col == 0:
        pts = [(x, y) for y in range(top, CELL_H) for x in range(CELL_W)
               if is_skin(px[x0 + x, y0 + y]) and not (abs(x - hx) < 5 and y < top + 12)]
        key = lambda p: -math.hypot(p[0] - chest[0], p[1] - chest[1])
    else:
        lo, hi = (top + 8, top + 22) if col == 1 else (top + 6, top + 28)
        pts = [(x, y) for y in range(lo, hi) for x in range(CELL_W)
               if px[x0 + x, y0 + y][3] > 128 and x > hx + 3]
        key = lambda p: -p[0]
    if not pts:
        return {'x': 6, 'y': -20, 'a': 0}
    pts.sort(key=key)
    far = pts[:3]
    # One pixel in from the outline, inside the fist.
    fx = sum(p[0] for p in far) / len(far) - (1 if col else 0)
    fy = sum(p[1] for p in far) / len(far)
    a = math.atan2(fy - shoulder[1], fx - shoulder[0])
    return {'x': round(fx + 0.5 - CELL_W / 2, 1), 'y': round(fy - (CELL_H - 1), 1), 'a': round(a, 2)}


# Which of a strip's figures 2-4 are the wind-up, strike and follow-through,
# where the model drew them in another order.
SWING_ORDER = {('looter', 'back'): (3, 2, 1)}


def add_attacks(sheet, prefix):
    """Attack rows below the walk rows: wind-up, strike, follow-through of a
    one-handed swing to the right, seen from the front (3/4), the side and
    the back. Each source strip starts with a front-facing calibration
    figure."""
    big = Image.new('RGBA', (sheet.width, sheet.height + CELL_H * len(ATTACK_ROWS)), (0, 0, 0, 0))
    big.alpha_composite(sheet)
    rig = []
    for i, name in enumerate(ATTACK_ROWS):
        strip = key_magenta(Image.open(os.path.join(SRC, f'{prefix}_attack_{name}.png')))
        poses = find_poses(strip, 4)
        row = len(ROWS) + i
        order = SWING_ORDER.get((prefix, name), (1, 2, 3))
        pack_row(big, row, [poses[k] for k in order], STAND_H / poses[0].height)
        rig.append([swing_hand(big, row, c) for c in range(3)])
    return big, rig


def write_rig(hands, attacks):
    path = os.path.join(ROOT, 'src/topdown/char-rig.ts')
    with open(path, 'w') as f:
        f.write('// Generated by tools/td_art.py - re-run it after changing the art.\n'
                '//\n'
                '// Where each character holds a weapon, per sheet row (down, up, right,\n'
                '// down-right, up-right), in the idle frame: x from the cell centre, y from\n'
                '// the feet (negative is up), facing as drawn (mirror x for left).\n'
                'export const WEAPON_HAND: Record<string, { x: number; y: number }[]> = {\n')
        for name, pts in hands.items():
            f.write(f'  {name}: [' + ', '.join(f'{{ x: {x}, y: {y} }}' for x, y in pts) + '],\n')
        f.write('};\n\n'
                '// The swinging fist in the attack rows (front, side, back) for wind-up,\n'
                '// strike and follow-through, same coordinates; `a` is the forearm\n'
                '// direction (radians, swinging to the right).\n'
                'export const SWING_HAND: Record<string, { x: number; y: number; a: number }[][]> = {\n')
        for name, rows in attacks.items():
            f.write(f'  {name}: [\n')
            for r in rows:
                f.write('    [' + ', '.join(f"{{ x: {p['x']}, y: {p['y']}, a: {p['a']} }}" for p in r) + '],\n')
            f.write('  ],\n')
        f.write('};\n')
    print('wrote', path, hands)


def build_zhou():
    """Row 0: idle, breath, wave (facing the camera). Row 1: standing, facing
    down, down-right, right, up-right, up - so he can turn to whoever he
    talks to."""
    strip = key_magenta(Image.open(os.path.join(SRC, 'zhou.png')))
    poses = find_poses(strip, 3)
    scale = (STAND_H - 2) / poses[0].height  # a little stooped
    sheet = Image.new('RGBA', (CELL_W * 5, CELL_H * 2), (0, 0, 0, 0))
    pack_row(sheet, 0, poses, scale)
    dirs = find_poses(key_magenta(Image.open(os.path.join(SRC, 'zhou_dirs.png'))), 5)
    pack_row(sheet, 1, dirs, (STAND_H - 2) / dirs[0].height)
    sheet.save(os.path.join(OUT, 'zhou.png'))
    print('wrote zhou.png', sheet.size)


# name, source, index among the strip's components (sorted left to right by
# their left edge), width in game pixels.
PROPS = [
    ('sandbag_long', 'props_a', 6, 0, 64),
    ('scooter', 'props_a', 6, 1, 34),
    ('car', 'props_a', 6, 2, 70),
    ('sandbag_curve', 'props_a', 6, 3, 44),
    ('rubble', 'props_a', 6, 4, 38),
    ('drum_fire', 'props_a', 6, 5, 20),
    ('bed', 'props_b', 5, 0, 40),
    ('desk', 'props_b', 5, 1, 34),
    ('stools', 'props_b', 5, 2, 14),
    ('garbage', 'props_b', 5, 3, 32),
    ('crate', 'props_b', 5, 4, 30),
    ('turret', 'props_c', 5, 0, 36),
    ('stick', 'props_c', 5, 1, 22),
    ('knife', 'props_c', 5, 2, 16),
    ('pistol', 'props_c', 5, 3, 14),
    ('adrenaline', 'props_c', 5, 4, 14),
]


def drop_magenta_shadows(rgba):
    """The model sometimes paints a soft shadow under props in a darker
    magenta, which the plain key leaves behind as a purple rim. Anything
    still clearly magenta-tinted goes."""
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and r - g > 22 and b - g > 22 and abs(r - b) < 45:
                px[x, y] = (0, 0, 0, 0)
    return rgba


def build_props():
    cache = {}
    for name, src, n, idx, width in PROPS:
        if src not in cache:
            keyed = drop_magenta_shadows(key_magenta(Image.open(os.path.join(SRC, src + '.png'))))
            cache[src] = find_poses_by_components(keyed, n)
        p = cache[src][idx]
        img = add_outline(downscale(p, width / p.width))
        img.save(os.path.join(OUT, f'prop_{name}.png'))
        print(f'prop_{name}', img.size)


def build_sandbag_ns():
    """A north-south sandbag line, in two tiles: `mid` (two bag tops, repeats
    vertically) and `end` (the nearest bag with its front face). The source
    recedes in perspective, so each piece is cut at bag seams - found as the
    dark outline rows down the centre - and scaled to the same width."""
    im = drop_magenta_shadows(key_magenta(Image.open(os.path.join(SRC, 'sandbag_ns.png'))))
    im = im.crop(im.getbbox())
    px = im.load()
    cx = im.width // 2
    seams, prev = [], False
    for y in range(im.height):
        r, g, b, a = px[cx, y]
        dark = a > 0 and r + g + b < 200
        if dark and not prev:
            seams.append(y)
        prev = dark
    # The last three seams bound the front face, the nearest bag and the bag
    # behind it; the two bags before those make the repeating piece.
    mid = im.crop((0, seams[-5], im.width, seams[-3]))
    end = im.crop((0, seams[-3], im.width, im.height))
    for name, piece, h in (('mid', mid, 32), ('end', end, None)):
        piece = piece.crop(piece.getbbox())
        w = 28
        ph = h or round(piece.height * w / piece.width)
        out = add_outline(piece.resize((w, ph), Image.LANCZOS))
        if h:  # the repeating piece keeps its side outline only
            out = out.crop((0, 1, out.width, out.height - 1))
        out.save(os.path.join(OUT, f'prop_sandbag_ns_{name}.png'))
        print(f'prop_sandbag_ns_{name}', out.size)


def straighten(rgba, heavy_right):
    """Rotates a weapon lying at an angle so its long axis is horizontal,
    then flips it so the striking end points right: `heavy_right(img)` says
    whether it already does."""
    import math
    a = rgba.getchannel('A').load()
    w, h = rgba.size
    pts = [(x, y) for y in range(0, h, 2) for x in range(0, w, 2) if a[x, y]]
    mx = sum(p[0] for p in pts) / len(pts)
    my = sum(p[1] for p in pts) / len(pts)
    cxx = sum((p[0] - mx) ** 2 for p in pts)
    cyy = sum((p[1] - my) ** 2 for p in pts)
    cxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    ang = 0.5 * math.atan2(2 * cxy, cxx - cyy)  # long axis, y-down radians
    img = rgba.rotate(math.degrees(ang), resample=Image.BICUBIC, expand=True)
    img = img.crop(img.getbbox())
    if not heavy_right(img):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    return img


def half_stats(img):
    w, h = img.size
    px = img.load()
    out = []
    for x0, x1 in ((0, w // 2), (w // 2, w)):
        n = lum = 0
        for y in range(h):
            for x in range(x0, x1):
                r, g, b, al = px[x, y]
                if al > 128:
                    n += 1
                    lum += r + g + b
        out.append((n, lum / max(1, n)))
    return out


def build_weapons():
    comps = find_poses_by_components(
        drop_magenta_shadows(key_magenta(Image.open(os.path.join(SRC, 'props_c.png')))), 5)
    # Club: the thicker (heavier) end strikes. Knife: the bright blade does.
    stick = straighten(comps[1], lambda im: half_stats(im)[1][0] >= half_stats(im)[0][0])
    knife = straighten(comps[2], lambda im: half_stats(im)[1][1] >= half_stats(im)[0][1])
    for name, img, length in (('stick', stick, 22), ('knife', knife, 14)):
        out = add_outline(downscale(img, length / img.width))
        out.save(os.path.join(OUT, f'weapon_{name}.png'))
        print(f'weapon_{name}', out.size)
    # Pistol in hand: the side-view game's arm sprite, from the wrist on.
    arm = Image.open(os.path.join(ROOT, 'public/assets/ai/gun_arm.png')).convert('RGBA')
    w, h = arm.size
    px = arm.load()
    wrist = next((x for x in range(w) for y in range(h)
                  if px[x, y][3] and px[x, y][0] > 200 and px[x, y][0] - px[x, y][1] >= 40), w // 2)
    pistol = arm.crop((max(0, wrist - 2), 0, w, h))
    pistol.save(os.path.join(OUT, 'weapon_pistol.png'))
    print('weapon_pistol', pistol.size, 'from wrist x', wrist)


def drop_yellow(im):
    """The asphalt came with painted yellow lane dashes baked in; repeated
    every 4 tiles they read as a parking lot. Paint them over with the
    asphalt beside them (the game draws its own lane line)."""
    src = im.copy().load()
    px = im.load()
    w, h = im.size

    def yellow(p):
        r, g, b = p
        return r - b > 30 and g - b > 16

    for y in range(h):
        for x in range(w):
            if not yellow(src[x, y]):
                continue
            # Blend the nearest clean asphalt to the left and right (the
            # dashes run vertically).
            left = next((src[(x - d) % w, y] for d in range(1, 30) if not yellow(src[(x - d) % w, y])), None)
            right = next((src[(x + d) % w, y] for d in range(1, 30) if not yellow(src[(x + d) % w, y])), None)
            near = [c for c in (left, right) if c]
            if near:
                px[x, y] = tuple(sum(c[i] for c in near) // len(near) for i in range(3))
    return im


def tex(name, size, bright=1.0, color=1.0, crop=None, squash=None, contrast=1.0, clean=None):
    im = Image.open(os.path.join(SRC, f'tex_{name}.png')).convert('RGB')
    if clean:
        im = clean(im)
    if crop:
        w, h = im.size
        im = im.crop((int(w * crop), int(h * crop), int(w * (1 - crop)), int(h * (1 - crop))))
    s = min(im.size)
    im = seamless_xy(im.crop((0, 0, s, s)))
    im = im.resize(squash or (size, size), Image.LANCZOS)
    if color != 1.0:
        im = ImageEnhance.Color(im).enhance(color)
    if contrast != 1.0:
        im = ImageEnhance.Contrast(im).enhance(contrast)
    if bright != 1.0:
        im = ImageEnhance.Brightness(im).enhance(bright)
    im.save(os.path.join(OUT, f'tex_{name}.png'))
    print(f'tex_{name}', im.size)


def build_textures():
    # Floors: 128px = 4 tiles per repeat. Kept darker and flatter than the
    # characters so the figures always read on top of them.
    tex('asphalt', 128, bright=0.72, color=0.55, contrast=0.8, clean=drop_yellow)
    tex('brick', 128, bright=0.78, color=0.8)
    tex('terrazzo', 128, bright=0.82, color=0.85)
    tex('overgrown', 128, bright=0.78, color=0.85)
    tex('rails', 128, bright=0.8, color=0.85)
    # The wall top came back as a framed slab; its interior is the concrete.
    # Its dark crack splats repeat every two tiles; soften them.
    tex('walltop', 64, bright=0.95, color=0.8, crop=0.13, contrast=0.6)
    tex('wallface', 128, bright=0.8, color=0.8)
    # The hospital wall's green/white bands span the face's full height.
    tex('hospwall', 128, bright=0.85, squash=(128, 24))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    p_hands, p_swings = build_character('player', 'player.png')
    l_hands, l_swings = build_character('looter', 'looter.png')
    write_rig({'player': p_hands, 'looter': l_hands}, {'player': p_swings, 'looter': l_swings})
    build_zhou()
    build_props()
    build_sandbag_ns()
    build_weapons()
    build_textures()
