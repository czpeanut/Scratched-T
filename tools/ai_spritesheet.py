"""Turns AI-generated animation strips into a game-ready sprite sheet.

Each source strip is one image with N full-body poses on a flat magenta
(#FF00FF) background, as produced by tools/gemini_gen.py. This script:

  1. keys out the magenta (with despill on anti-aliased edges),
  2. finds the N poses by column occupancy - it does NOT trust the poses to sit
     in equal-width cells, because image models rarely space them evenly,
  3. scales every pose of every animation by ONE shared factor (derived from a
     reference animation's standing height) so the character never changes
     size between animations,
  4. anchors each pose on its horizontal centre of mass and its feet, and
  5. packs the result into the row/column grid the game's ANIMS table expects.

Requires Pillow (python3 -m pip install pillow). No API key involved - this
step only ever reads local PNGs.

usage:
  python3 tools/ai_spritesheet.py CONFIG.json
"""
import json
import os
import sys

from PIL import Image, ImageChops, ImageFilter

MAGENTA = (255, 0, 255)


def key_magenta(im, tol=110):
    """Returns RGBA with magenta removed and magenta fringes despilled."""
    im = im.convert('RGB')
    out = Image.new('RGBA', im.size)
    src = im.load()
    dst = out.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            # Magenta is "red and blue high, green low". Distance in that
            # direction is far more robust than plain RGB distance, which
            # misfires on the pink-ish seams image models leave between panels.
            m = min(r, b) - g
            if m > tol:
                dst[x, y] = (0, 0, 0, 0)
                continue
            if m > 30:
                # Fringe pixel blended with the background: pull red/blue down
                # to green's level so no pink halo survives the downscale.
                lim = g + 30
                r, b = min(r, lim), min(b, lim)
            dst[x, y] = (r, g, b, 255)
    return out


def clean_specks(alpha_cols, min_px):
    return [c if c >= min_px else 0 for c in alpha_cols]


def find_poses(rgba, n, min_gap=6):
    """Splits a strip into n poses by vertical runs of non-empty columns."""
    w, h = rgba.size
    a = rgba.getchannel('A').load()
    cols = [sum(1 for y in range(h) if a[x, y]) for x in range(w)]
    cols = clean_specks(cols, max(3, h // 200))
    runs = []
    x = 0
    while x < w:
        if cols[x]:
            s = x
            while x < w and cols[x]:
                x += 1
            runs.append([s, x])
        else:
            x += 1
    # Drop dust: runs with almost no mass.
    runs = [r for r in runs if sum(cols[r[0]:r[1]]) > h * 2]
    # Merge runs separated by tiny gaps (a hand detached from a body by one
    # anti-aliased column, etc.), then keep merging the closest pair until
    # exactly n remain.
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < min_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    while len(merged) > n:
        gaps = [merged[i + 1][0] - merged[i][1] for i in range(len(merged) - 1)]
        i = gaps.index(min(gaps))
        merged[i][1] = merged[i + 1][1]
        del merged[i + 1]
    if len(merged) < n:
        # Poses overlap horizontally (an outstretched knife reaching past the
        # next figure's back, say) without actually touching: separate them
        # by connected pixels instead of by empty columns.
        return find_poses_by_components(rgba, n)
    poses = []
    for s, e in merged:
        crop = rgba.crop((s, 0, e, h))
        bbox = crop.getbbox()
        poses.append(crop.crop(bbox))
    return poses


def find_poses_by_components(rgba, n, step=4):
    """Splits by 8-connected blobs on a downsampled alpha mask. The n largest
    blobs seed the poses; every smaller blob (a detached hand, a speck of
    hair) joins whichever seed's bounding box is nearest."""
    w, h = rgba.size
    sw, sh = w // step, h // step
    a = rgba.getchannel('A').resize((sw, sh), Image.BOX).load()
    label = [[0] * sw for _ in range(sh)]
    blobs = []  # [count, x0, y0, x1, y1]
    for y in range(sh):
        for x in range(sw):
            if a[x, y] < 64 or label[y][x]:
                continue
            lid = len(blobs) + 1
            stack = [(x, y)]
            label[y][x] = lid
            b = [0, x, y, x, y]
            while stack:
                cx, cy = stack.pop()
                b[0] += 1
                b[1], b[2] = min(b[1], cx), min(b[2], cy)
                b[3], b[4] = max(b[3], cx), max(b[4], cy)
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < sw and 0 <= ny < sh and not label[ny][nx] and a[nx, ny] >= 64:
                            label[ny][nx] = lid
                            stack.append((nx, ny))
            blobs.append(b)
    if len(blobs) < n:
        raise ValueError(f'expected {n} poses, found only {len(blobs)} blobs')
    order = sorted(range(len(blobs)), key=lambda i: -blobs[i][0])
    seeds = sorted(order[:n], key=lambda i: blobs[i][1])
    owner = {s: s for s in seeds}
    for i in order[n:]:
        bx = (blobs[i][1] + blobs[i][3]) / 2
        by = (blobs[i][2] + blobs[i][4]) / 2

        def dist(s):
            x0, y0, x1, y1 = blobs[s][1:]
            return max(x0 - bx, 0, bx - x1) + max(y0 - by, 0, by - y1)
        owner[i] = min(seeds, key=dist)
    poses = []
    full_a = rgba.getchannel('A')
    for s in seeds:
        mine = {i + 1 for i, o in owner.items() if o == s}
        mask = Image.new('L', (sw, sh), 0)
        mp = mask.load()
        for y in range(sh):
            row = label[y]
            for x in range(sw):
                if row[x] in mine:
                    mp[x, y] = 255
        # Grow the coarse mask back to full size (dilated a little, so edge
        # pixels lost to the downsample come back), then cut with real alpha.
        big = mask.resize((w, h), Image.NEAREST).filter(ImageFilter.MaxFilter(step * 2 + 1))
        piece = rgba.copy()
        piece.putalpha(ImageChops.multiply(full_a, big))
        poses.append(piece.crop(piece.getbbox()))
    return poses


def feet_center_x(rgba, frac=0.15):
    """Horizontal centre of the lowest `frac` of the figure - the planted
    feet. Attack poses anchor here: a swung club or a thrown fist drags the
    centre of mass forward, and anchoring on it would make the character
    appear to slide backward while striking."""
    w, h = rgba.size
    a = rgba.getchannel('A').load()
    tot = sx = 0
    for y in range(int(h * (1 - frac)), h):
        for x in range(w):
            if a[x, y]:
                tot += 1
                sx += x
    return sx / tot if tot else w / 2


def mass_center_x(rgba):
    a = rgba.getchannel('A').load()
    w, h = rgba.size
    tot = sx = 0
    for y in range(h):
        for x in range(w):
            if a[x, y]:
                tot += 1
                sx += x
    return sx / tot if tot else w / 2


def downscale(rgba, scale):
    w, h = rgba.size
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    # Premultiplied resize so transparent pixels' (meaningless) colour never
    # bleeds into the edge of the figure.
    small = rgba.convert('RGBa').resize((nw, nh), Image.LANCZOS).convert('RGBA')
    px = small.load()
    for y in range(nh):
        for x in range(nw):
            r, g, b, a = px[x, y]
            # Hard alpha: pixel art has no semi-transparent edge pixels, and
            # the game draws with smoothing off anyway.
            px[x, y] = (r, g, b, 255) if a >= 110 else (0, 0, 0, 0)
    return small


OUTLINE = (18, 12, 14, 255)


def add_outline(rgba):
    """1px dark outline around the silhouette. At ~40px tall the model's own
    outlines are averaged away by the downscale, and without one a
    brown-clad figure melts into brown ruins behind it. The image is padded
    by 1px so the outline never clips."""
    w, h = rgba.size
    out = Image.new('RGBA', (w + 2, h + 2), (0, 0, 0, 0))
    out.paste(rgba, (1, 1))
    src = out.copy().load()
    px = out.load()
    for y in range(h + 2):
        for x in range(w + 2):
            if src[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w + 2 and 0 <= ny < h + 2 and src[nx, ny][3]:
                    px[x, y] = OUTLINE
                    break
    return out


def build(cfg_path):
    with open(cfg_path) as f:
        cfg = json.load(f)
    base = os.path.dirname(os.path.abspath(cfg_path))
    fw, fh = cfg['frameW'], cfg['frameH']
    anims = cfg['anims']  # ordered list: {name, src, frames}
    cols = max(a['frames'] for a in anims)

    # Image models fill the canvas with whatever they draw, so a crouched or
    # sprawled pose comes back drawn LARGER than a standing one. Asking for a
    # standing "calibration" pose as the first figure of every strip gives
    # each strip its own ruler: scale = standHeight / calibration height,
    # then the calibration figure is discarded.
    poses, scales = {}, {}
    for a in anims:
        strip = Image.open(os.path.join(base, a['src']))
        calib = a.get('calib', False)
        found = find_poses(key_magenta(strip), a['frames'] + (1 if calib else 0))
        if calib:
            scales[a['name']] = cfg['standHeight'] / found[0].size[1]
            found = found[1:]
        poses[a['name']] = found
        print(f"{a['name']}: {[p.size for p in found]}")

    # Strips without a calibration figure fall back to the reference
    # animation's tallest pose (fine for upright animations like idle/run).
    fallback = scales.get(cfg['scaleRef']) or cfg['standHeight'] / max(
        p.size[1] for p in poses[cfg['scaleRef']])
    for a in anims:
        scales.setdefault(a['name'], fallback)
    print('scales:', {k: round(v, 4) for k, v in scales.items()})

    sheet = Image.new('RGBA', (cols * fw, len(anims) * fh), (0, 0, 0, 0))
    for row, a in enumerate(anims):
        scale = scales[a['name']]
        for col, p in enumerate(poses[a['name']]):
            anchor = feet_center_x if a.get('anchor') == 'feet' else mass_center_x
            cx = anchor(p) * scale
            small = downscale(p, scale)
            if small.size[0] > fw or small.size[1] > fh:
                # Shrink just this pose to fit rather than clipping it; logged
                # so an oversized pose is a visible decision, not a surprise.
                k = min(fw / small.size[0], fh / small.size[1])
                print(f"  {a['name']}[{col}] {small.size} > cell, refit x{k:.2f}")
                cx *= k
                small = downscale(p, scale * k)
            if cfg.get('outline', True):
                small = add_outline(small)
                cx += 1
            x = round(fw / 2 - cx)
            x = max(0, min(fw - small.size[0], x))
            y = fh - small.size[1]  # feet on the cell's bottom row
            sheet.alpha_composite(small, (col * fw + x, row * fh + y))
    out = os.path.join(base, cfg['out'])
    sheet.save(out)
    print(f'wrote {out} {sheet.size}')

    if cfg.get('tipsOut'):
        write_tips(sheet, cfg, anims, os.path.join(base, cfg['tipsOut']))


def strike_tip(sheet, col, row, fw, fh):
    """The forward-most point of a pose - the fist, club end or blade tip in
    an attack's strike frame. Returned relative to where the game anchors the
    cell: x from the cell's centre line (the body's centre), y from its
    bottom row (the feet), so it can be added straight to body.centerX and
    body.bottom."""
    a = sheet.getchannel('A').load()
    x0, y0 = col * fw, row * fh
    for x in range(fw - 1, -1, -1):
        ys = [y for y in range(fh) if a[x0 + x, y0 + y]]
        if ys:
            # Average over the rightmost few columns, so a single stray
            # outline pixel can't pull the point off the fist.
            band = [(xx, yy) for xx in range(max(0, x - 2), x + 1) for yy in range(fh) if a[x0 + xx, y0 + yy]]
            cy = sum(yy for _, yy in band) / len(band)
            return round(x + 0.5 - fw / 2, 1), round(cy - fh + 1, 1)
    return 0, 0


def write_tips(sheet, cfg, anims, path):
    fw, fh = cfg['frameW'], cfg['frameH']
    lines = []
    for row, a in enumerate(anims):
        if 'tipFrame' in a:
            x, y = strike_tip(sheet, a['tipFrame'], row, fw, fh)
            lines.append(f"  {a['name']}: {{ x: {x}, y: {y} }},")
    with open(path, 'w') as f:
        f.write('// Generated by tools/ai_spritesheet.py from the packed player sheet - do\n'
                '// not edit by hand; re-run the tool after changing the art.\n'
                '//\n'
                '// Where the striking end (fist, club end, blade tip) sits in each\n'
                '// attack\'s strike frame, for a character facing right: x from the body\'s\n'
                '// centre, y from its feet (negative is up). Hit effects and hitboxes\n'
                '// are placed here so they line up with what is drawn.\n'
                'export const ATTACK_TIPS = {\n' + '\n'.join(lines) + '\n};\n')
    print(f'wrote {path}')


if __name__ == '__main__':
    build(sys.argv[1])
