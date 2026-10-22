"""Turns AI-generated environment art into game-ready backdrop and tile images.

Inputs are raw Gemini outputs (see tools/gemini_gen.py); outputs land in
assets/ai/. Parallax layers come back with a flat magenta sky that is keyed
out; tile textures are made seamless here rather than trusting the model's
"seamless" claim, which is usually only approximately true.

usage:
  python3 tools/ai_backdrop.py SRC_DIR OUT_DIR

SRC_DIR must contain bg_sky.png, bg_far.png, bg_mid.png, tex_fill.png and
tex_top.png. Requires Pillow.
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageEnhance

VIEW_H = 360
TILE = 32


def key_magenta(im, tol=90):
    """Keys magenta to transparent and despills the anti-aliased fringe
    (pixels part-blended with the magenta sky), which would otherwise leave
    purple outlines around every rooftop and railing."""
    rgb = im.convert('RGB')
    out = Image.new('RGBA', rgb.size)
    src = rgb.load()
    dst = out.load()
    w, h = rgb.size
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            m = min(r, b) - g
            if m > tol:
                dst[x, y] = (0, 0, 0, 0)
            elif m > 20:
                lim = g + 20
                dst[x, y] = (min(r, lim), g, min(b, lim), 255)
            else:
                dst[x, y] = (r, g, b, 255)
    return out


def resize_rgba(im, size):
    """Premultiplied resize: transparent pixels carry no colour into edges."""
    return im.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')


def crop_to_alpha(im):
    return im.crop(im.getbbox())


def haze(im, color, amount):
    """Aerial perspective: pull a layer toward the sky colour."""
    flat = Image.new('RGBA', im.size, color + (255,))
    mixed = Image.blend(im.convert('RGBA'), flat, amount)
    mixed.putalpha(im.getchannel('A') if im.mode == 'RGBA' else 255)
    return mixed


def seamless_x(im, band):
    """Crossfades the right edge into the left so the image tiles
    horizontally: the output is `band` px narrower than the input."""
    w, h = im.size
    left = im.crop((0, 0, band, h))
    right = im.crop((w - band, 0, w, h))
    # The output's last column is followed, in the source, by `right`'s first
    # column - so the band must start as pure `right` (mask 255) and end as
    # pure `left` (mask 0), which then runs on into the untouched middle.
    row = [round(255 * (1 - x / (band - 1))) for x in range(band)]
    mask = Image.new('L', (band, h))
    mask.putdata(row * h)
    blended = Image.composite(right, left, mask)
    out = im.crop((0, 0, w - band, h)).copy()
    out.paste(blended, (0, 0))
    return out


def seamless_xy(im):
    """Classic offset-and-feather: blend the texture with a copy of itself
    offset by half a tile, using a mask that hides the original's seams."""
    w, h = im.size
    shifted = ImageChops.offset(im, w // 2, h // 2)
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    # Opaque (use `shifted`) near the edges, transparent in the middle.
    steps = 64
    for i in range(steps):
        v = int(255 * (1 - i / steps) ** 1.5)
        inset_x = int(i * w / (2 * steps))
        inset_y = int(i * h / (2 * steps))
        d.rectangle((inset_x, inset_y, w - inset_x - 1, h - inset_y - 1), outline=v)
    return Image.composite(shifted, im, mask)


def build_layers(src, out):
    sky = Image.open(os.path.join(src, 'bg_sky.png')).convert('RGB')
    w = round(sky.width * VIEW_H / sky.height)
    sky = sky.resize((w, VIEW_H), Image.LANCZOS)
    sky.save(os.path.join(out, 'bg_sky.png'))
    # Sample the haze colour from the sky just above its horizon.
    hz = sky.resize((1, 1), Image.BOX, box=(0, VIEW_H * 0.7, w, VIEW_H * 0.85)).getpixel((0, 0))
    print('sky', sky.size, 'haze', hz)

    # Against a sunset, distance reads as darker-than-sky silhouettes, not as
    # fog: haze the far layer toward a dimmed sky colour.
    dusk = tuple(int(c * 0.62) for c in hz)
    for name, height, tint, amount, dim in (('bg_far', 190, dusk, 0.55, 1.0),
                                            ('bg_mid', 240, hz, 0.16, 0.78)):
        im = crop_to_alpha(key_magenta(Image.open(os.path.join(src, name + '.png'))))
        w = round(im.width * height / im.height)
        im = resize_rgba(im, (w, height))
        a = im.getchannel('A').point(lambda v: 255 if v >= 128 else 0)
        im = haze(im, tint, amount)
        if dim != 1.0:
            im = ImageEnhance.Brightness(im).enhance(dim)
        im.putalpha(a)
        im = seamless_x(im, band=max(24, w // 12))
        im.save(os.path.join(out, name + '.png'))
        print(name, im.size)


def build_tiles(src, out):
    fill = Image.open(os.path.join(src, 'tex_fill.png')).convert('RGB')
    s = min(fill.size)
    fill = seamless_xy(fill.crop((0, 0, s, s)))
    fill = fill.resize((TILE * 4, TILE * 4), Image.LANCZOS)
    # Darker and flatter than the characters, so terrain never competes with
    # the things standing on it.
    fill = ImageEnhance.Color(fill).enhance(0.75)
    fill = ImageEnhance.Brightness(fill).enhance(0.62)
    fill.save(os.path.join(out, 'tile_fill.png'))
    print('tile_fill', fill.size)

    top = Image.open(os.path.join(src, 'tex_top.png')).convert('RGB')
    w, h = top.size
    # The model leaves a light area above the asphalt (weeds poke into it).
    # Find the asphalt's top as the first row that is mostly non-light.
    px = top.load()
    asphalt = 0
    for y in range(h):
        dark = sum(1 for x in range(0, w, 8) if sum(px[x, y]) < 600)
        if dark > (w // 8) * 0.8:
            asphalt = y
            break
    weeds = int(h * 0.05)
    band = top.crop((0, max(0, asphalt - weeds), w, asphalt + int(h * 0.26)))
    cap_w = TILE * 4
    cap_h = round(band.height * cap_w / band.width)
    cap = band.resize((cap_w, cap_h), Image.LANCZOS).convert('RGBA')
    # Key the light sky above the asphalt; keep weeds.
    cpx = cap.load()
    weed_rows = round(weeds * cap_w / band.width)
    for y in range(weed_rows + 1):
        for x in range(cap_w):
            r, g, b, _ = cpx[x, y]
            if r + g + b > 560:
                cpx[x, y] = (0, 0, 0, 0)
    # Fade the bottom few rows out so the cap melts into the fill texture.
    for y in range(cap_h - 4, cap_h):
        k = (cap_h - y) / 5
        for x in range(cap_w):
            r, g, b, a = cpx[x, y]
            cpx[x, y] = (r, g, b, int(a * k))
    cap = ImageEnhance.Brightness(cap).enhance(0.85)
    cap = seamless_x(cap.resize((cap_w + 16, cap_h), Image.LANCZOS), band=16)
    cap.save(os.path.join(out, 'tile_cap.png'))
    print('tile_cap', cap.size, 'weed rows', weed_rows)


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    build_layers(src, out)
    build_tiles(src, out)
