// Top-down art set: Gemini-generated sprites and textures in public/assets/td/,
// built by tools/td_art.py. Every draw helper returns false while its image is
// still loading, so callers can fall back to a simple shape.

import { ImageAsset } from './sprites';

const td = (name: string) => new ImageAsset(`/assets/td/${name}.png`);

// Character sheets: 3 rows (down, up, right) x 5 cols (idle + 4 walk frames).
// Facing left is the right row mirrored.
export const CELL_W = 40;
export const CELL_H = 44;
// Feet sit this far below an entity's (x, y) body centre - the same offset the
// contact shadows and collision circle were tuned for.
export const FEET_OFFSET = 13;

export const TD = {
  player: td('player'),
  looter: td('looter'),
  zhou: td('zhou'),
  weapons: {
    stick: td('weapon_stick'),
    knife: td('weapon_knife'),
    pistol: td('weapon_pistol'),
  } as Record<string, ImageAsset>,
  props: Object.fromEntries(
    [
      'sandbag_long', 'sandbag_curve', 'sandbag_ns_mid', 'sandbag_ns_end', 'scooter', 'car', 'rubble', 'drum_fire',
      'bed', 'desk', 'stools', 'garbage', 'crate', 'turret',
      'stick', 'knife', 'pistol', 'adrenaline',
    ].map((n) => [n, td(`prop_${n}`)])
  ) as Record<string, ImageAsset>,
  tex: Object.fromEntries(
    ['asphalt', 'brick', 'terrazzo', 'overgrown', 'rails', 'walltop', 'wallface', 'hospwall']
      .map((n) => [n, td(`tex_${n}`)])
  ) as Record<string, ImageAsset>,
};

// The side-view game's dusk backdrop, reused behind the title screen.
export const TITLE_LAYERS = ['bg_sky', 'bg_far', 'bg_mid'].map((n) => new ImageAsset(`/assets/ai/${n}.png`));

export interface Facing {
  row: number;
  flip: boolean;
}

// Down/up only when the angle is clearly vertical, so diagonal movement keeps
// the more readable side view.
export function facingOf(angle: number): Facing {
  const s = Math.sin(angle);
  if (s < -0.6) return { row: 1, flip: false };
  if (s > 0.6) return { row: 0, flip: false };
  return { row: 2, flip: Math.cos(angle) < 0 };
}

export function walkFrame(moving: boolean, walkCycle: number): number {
  if (!moving) return 0;
  return 1 + (Math.floor(walkCycle / 1.6) % 4 + 4) % 4;
}

// Draws one character cell with its feet at (sx, sy + FEET_OFFSET).
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  sheet: ImageAsset,
  sx: number,
  sy: number,
  facing: Facing,
  col: number,
  bob: number = 0
): boolean {
  if (!sheet.loaded) return false;
  const feetY = Math.round(sy + FEET_OFFSET);
  const x = Math.round(sx);
  const y = feetY - CELL_H + 1 + bob;
  ctx.save();
  if (facing.flip) {
    ctx.translate(x, 0);
    ctx.scale(-1, 1);
    ctx.translate(-x, 0);
  }
  ctx.drawImage(sheet.img, col * CELL_W, facing.row * CELL_H, CELL_W, CELL_H,
    x - CELL_W / 2, y, CELL_W, CELL_H);
  ctx.restore();
  return true;
}

// Soft oval contact shadow under the feet.
export function drawShadow(ctx: CanvasRenderingContext2D, sx: number, feetY: number, rx: number, alpha = 0.45) {
  ctx.fillStyle = `rgba(16, 10, 6, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(sx, feetY, rx, rx * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Draws an image with its bottom edge centred on (cx, bottomY).
export function drawProp(
  ctx: CanvasRenderingContext2D,
  asset: ImageAsset | undefined,
  cx: number,
  bottomY: number,
  flip = false
): boolean {
  if (!asset || !asset.loaded) return false;
  const w = asset.img.width;
  const h = asset.img.height;
  const x = Math.round(cx - w / 2);
  const y = Math.round(bottomY - h);
  if (flip) {
    ctx.save();
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(asset.img, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(asset.img, x, y);
  }
  return true;
}

// Draws a weapon sprite (striking end pointing right in the image) rotated to
// `angle` around a hand at (hx, hy). `grip` is how many pixels of the image
// sit behind the hand. Mirrored vertically when pointing left so the weapon
// never renders upside down.
export function drawWeapon(
  ctx: CanvasRenderingContext2D,
  asset: ImageAsset | undefined,
  hx: number,
  hy: number,
  angle: number,
  grip: number
): boolean {
  if (!asset || !asset.loaded) return false;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(angle);
  if (Math.cos(angle) < 0) ctx.scale(1, -1);
  ctx.drawImage(asset.img, -grip, -asset.img.height / 2);
  ctx.restore();
  return true;
}

// Hurt flash: the sprite drawn again as a pale silhouette on top.
let flashCanvas: HTMLCanvasElement | null = null;
export function drawCharacterFlash(
  ctx: CanvasRenderingContext2D,
  sheet: ImageAsset,
  sx: number,
  sy: number,
  facing: Facing,
  col: number,
  alpha: number,
  color = '#fff4e0'
) {
  if (!sheet.loaded) return;
  if (!flashCanvas) {
    flashCanvas = document.createElement('canvas');
    flashCanvas.width = CELL_W;
    flashCanvas.height = CELL_H;
  }
  const f = flashCanvas.getContext('2d')!;
  f.globalCompositeOperation = 'source-over';
  f.clearRect(0, 0, CELL_W, CELL_H);
  f.drawImage(sheet.img, col * CELL_W, facing.row * CELL_H, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
  f.globalCompositeOperation = 'source-in';
  f.fillStyle = color;
  f.fillRect(0, 0, CELL_W, CELL_H);
  const feetY = Math.round(sy + FEET_OFFSET);
  const x = Math.round(sx);
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (facing.flip) {
    ctx.translate(x, 0);
    ctx.scale(-1, 1);
    ctx.translate(-x, 0);
  }
  ctx.drawImage(flashCanvas, x - CELL_W / 2, feetY - CELL_H + 1);
  ctx.restore();
}

// Cheap deterministic hash for picking prop variants per tile.
export function tileHash(tx: number, ty: number): number {
  let h = (tx * 374761393 + ty * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// A texture and its three mirror images. Floors pick one per 4x4-tile block
// so the 128px repeat stops reading as a grid; mirrored neighbours still
// meet seamlessly (each edge meets its own reflection).
const variantCache = new Map<ImageAsset, HTMLCanvasElement[]>();
export function mirrorVariants(asset: ImageAsset): CanvasImageSource[] | null {
  if (!asset.loaded) return null;
  let v = variantCache.get(asset);
  if (!v) {
    const { width: w, height: h } = asset.img;
    v = [0, 1, 2, 3].map((i) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      g.translate(i & 1 ? w : 0, i & 2 ? h : 0);
      g.scale(i & 1 ? -1 : 1, i & 2 ? -1 : 1);
      g.drawImage(asset.img, 0, 0);
      return c;
    });
    variantCache.set(asset, v);
  }
  return v;
}
