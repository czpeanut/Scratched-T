"""Builds the two-layer gun rig from AI art: an armless body (rows of the
packed player sheet) plus one arm-and-pistol sprite that the game rotates
around the shoulder toward the crosshair.

  1. The arm source (assets/ai/src/gun_arm.png: a straight horizontal arm
     holding a pistol, shoulder end on the left) is keyed, scaled so the
     sleeve is the right length for the 40px character, outlined, and saved
     as assets/ai/gun_arm.png.
  2. Its pivot (the shoulder end of the sleeve) and muzzle (the end of the
     barrel) are measured in that image.
  3. For every armless body frame, the shoulder joint - the dark patch the
     arm attaches to - is located.
  4. Everything is written to src/game/gun-rig.js, in the same coordinates
     attack-tips.js uses (x from the body's centre, y from the feet).

usage:
  python3 tools/ai_gunrig.py
Requires Pillow. Run after tools/ai_spritesheet.py tools/ai_art/player.json.
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from ai_spritesheet import add_outline, downscale, key_magenta  # noqa: E402

SLEEVE_PX = 13  # shoulder to wrist; a touch long, so the pistol reads at 40px


def is_jacket(p):
    r, g, b, a = p
    return a and r > 120 and g > 95 and b < 150 and r - b > 30 and abs(r - g) < 45


def is_skin(p):
    # Hand ~(225,167,130) vs jacket ~(181,153,116): skin is both brighter and
    # much redder than green.
    r, g, b, a = p
    return a and r > 200 and r - g >= 40 and r - b >= 70


def build_arm(src, out):
    arm = key_magenta(Image.open(src))
    arm = arm.crop(arm.getbbox())
    w, h = arm.size
    px = arm.load()
    # The sleeve's centre line: the row with the most jacket pixels in the
    # left third (where only the sleeve is).
    best_row, best = 0, -1
    for y in range(h):
        n = sum(1 for x in range(w // 3) if is_jacket(px[x, y]))
        if n > best:
            best_row, best = y, n
    # Wrist: walking right along that row, the first skin pixel after the
    # sleeve.
    wrist = next((x for x in range(w) if is_skin(px[x, best_row])), w // 2)
    # Sleeve thickness at the shoulder end, for the pivot's vertical centre.
    col = [y for y in range(h) if px[min(6, w - 1), y][3]]
    pivot_y_src = (col[0] + col[-1]) / 2 if col else best_row
    scale = SLEEVE_PX / max(1, wrist)
    small = add_outline(downscale(arm, scale))
    small.save(out)

    sw, sh = small.size
    a = small.getchannel('A').load()
    # Muzzle: the right-most opaque column, taken in the upper half (the
    # barrel sits above the grip).
    muzzle = (sw - 1, sh / 2)
    for x in range(sw - 1, -1, -1):
        ys = [y for y in range(int(sh * 0.6)) if a[x, y]]
        if ys:
            muzzle = (x + 0.5, sum(ys) / len(ys))
            break
    pivot = (1 + 2.0, pivot_y_src * scale + 1)  # +1: the outline padding
    print(f'arm {small.size} scale {scale:.4f} wrist@{wrist}px pivot {pivot} muzzle {muzzle}')
    return {'w': sw, 'h': sh, 'pivotX': round(pivot[0], 1), 'pivotY': round(pivot[1], 1),
            'muzzleX': round(muzzle[0], 1), 'muzzleY': round(muzzle[1], 1)}


def shoulder_of(sheet, col, row, fw, fh):
    """The shoulder joint of an armless body frame: the dark brown patch on
    the upper torso. Falls back to a fixed proportion below the top of the
    head if the patch can't be found."""
    px = sheet.load()
    x0, y0 = col * fw, row * fh
    rows = [y for y in range(fh) if any(px[x0 + x, y0 + y][3] for x in range(fw))]
    top = rows[0]
    hits = []
    for y in range(top + 7, min(fh, top + 18)):
        for x in range(fw):
            r, g, b, a = px[x0 + x, y0 + y]
            if a and 45 <= r <= 125 and 30 <= g <= 100 and b <= 90 and r - b >= 12 and r >= g:
                hits.append((x, y))
    if len(hits) >= 3:
        cx = sum(x for x, _ in hits) / len(hits)
        cy = sum(y for _, y in hits) / len(hits)
    else:
        xs = [x for x in range(fw) if px[x0 + x, y0 + top + 11][3]]
        cx, cy = (sum(xs) / len(xs) if xs else fw / 2), top + 11
    return round(cx + 0.5 - fw / 2, 1), round(cy - fh + 1, 1)


def main():
    cfg = json.load(open(os.path.join(ROOT, 'tools/ai_art/player.json')))
    fw, fh = cfg['frameW'], cfg['frameH']
    sheet = Image.open(os.path.join(ROOT, 'assets/ai/player.png')).convert('RGBA')
    rows = {a['name']: (i, a['frames']) for i, a in enumerate(cfg['anims'])}

    arm = build_arm(os.path.join(ROOT, 'assets/ai/src/gun_arm.png'), os.path.join(ROOT, 'assets/ai/gun_arm.png'))
    shoulders = {}
    for name in ('gunStand', 'gunRun'):
        row, n = rows[name]
        shoulders[name] = [shoulder_of(sheet, c, row, fw, fh) for c in range(n)]
        print(name, shoulders[name])

    def pts(lst):
        return ', '.join(f'{{ x: {x}, y: {y} }}' for x, y in lst)

    out = os.path.join(ROOT, 'src/game/gun-rig.js')
    with open(out, 'w') as f:
        f.write(
            '// Generated by tools/ai_gunrig.py - do not edit by hand; re-run the tool\n'
            '// after changing the art.\n'
            '//\n'
            '// The two-layer gun rig. The body rows gunStand/gunRun are drawn without\n'
            '// arms; assets/ai/gun_arm.png (arm + pistol, pointing right) is drawn on top,\n'
            '// rotated around its pivot, with that pivot placed on the frame\'s shoulder.\n'
            '// Shoulders use attack-tips.js coordinates: x from the body\'s centre, y from\n'
            '// its feet (negative is up), facing right. Arm points are pixels in its image.\n'
            f"export const GUN_ARM = {{ w: {arm['w']}, h: {arm['h']}, pivotX: {arm['pivotX']}, pivotY: {arm['pivotY']}, "
            f"muzzleX: {arm['muzzleX']}, muzzleY: {arm['muzzleY']} }};\n\n"
            'export const GUN_SHOULDERS = {\n'
            f"  gunStand: [{pts(shoulders['gunStand'])}],\n"
            f"  gunRun: [{pts(shoulders['gunRun'])}],\n"
            '};\n'
        )
    print('wrote', out)


if __name__ == '__main__':
    main()
