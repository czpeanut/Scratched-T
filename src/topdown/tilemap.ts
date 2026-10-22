// Tile grid: collision, raycasts, and 3/4 rendering with the AI texture set.

import { TILE } from './constants';
import { circleAABBCollision } from './math';
import { TD, drawProp, tileHash, mirrorVariants } from './art';

// How far a wall's top face is lifted above its footprint, in pixels.
export const WALL_H = 24;

// A non-solid (or solid, via PROP_SOLID tiles) sprite placed freely in the
// world, y-sorted with everything else. (x, y) is its bottom centre.
export interface Decor {
  x: number;
  y: number;
  prop: string;
  flip?: boolean;
}

export const enum TileType {
  VOID = 0,
  FLOOR_WARD = 1,
  FLOOR_ASPHALT = 2,
  FLOOR_MOSS = 3,
  WALL_CONCRETE = 4,
  WALL_FENCE = 5,
  COVER_SANDBAG = 6,
  COVER_CRATE = 7,
  DECOR_BED = 8,
  DECOR_DESK = 9,
  DECOR_CAMPFIRE = 10,
  DECOR_RAILS = 11,
  DECOR_VEHICLE = 12,
  FLOOR_BRICK = 13,
  PROP_SOLID = 14, // blocks movement; drawn by a Decor entry
}

export interface RayHit {
  hit: boolean;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  dist: number;
}

export class Tilemap {
  public cols: number;
  public rows: number;
  public grid: Uint8Array;
  public decor: Decor[] = [];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.grid = new Uint8Array(cols * rows);
  }

  get widthPx(): number {
    return this.cols * TILE;
  }

  get heightPx(): number {
    return this.rows * TILE;
  }

  get(tx: number, ty: number): TileType {
    if (tx < 0 || tx >= this.cols || ty < 0 || ty >= this.rows) return TileType.WALL_CONCRETE;
    return this.grid[ty * this.cols + tx];
  }

  set(tx: number, ty: number, type: TileType) {
    if (tx < 0 || tx >= this.cols || ty < 0 || ty >= this.rows) return;
    this.grid[ty * this.cols + tx] = type;
  }

  fillRect(x1: number, y1: number, x2: number, y2: number, type: TileType) {
    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(this.cols - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(this.rows - 1, Math.max(y1, y2));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        this.set(x, y, type);
      }
    }
  }

  isSolid(tx: number, ty: number): boolean {
    const t = this.get(tx, ty);
    return (
      t === TileType.WALL_CONCRETE ||
      t === TileType.WALL_FENCE ||
      t === TileType.COVER_SANDBAG ||
      t === TileType.COVER_CRATE ||
      t === TileType.DECOR_BED ||
      t === TileType.DECOR_DESK ||
      t === TileType.DECOR_VEHICLE ||
      t === TileType.PROP_SOLID
    );
  }

  // Resolve circle collision against neighboring solid tiles
  resolveCircleCollision(cx: number, cy: number, r: number): { x: number; y: number } {
    let outX = cx;
    let outY = cy;

    const minTx = Math.floor((cx - r - 4) / TILE);
    const maxTx = Math.floor((cx + r + 4) / TILE);
    const minTy = Math.floor((cy - r - 4) / TILE);
    const maxTy = Math.floor((cy + r + 4) / TILE);

    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (!this.isSolid(tx, ty)) continue;

        const tileRx = tx * TILE;
        const tileRy = ty * TILE;
        const res = circleAABBCollision(outX, outY, r, tileRx, tileRy, TILE, TILE);

        if (res.hit) {
          outX += res.normalX * res.depth;
          outY += res.normalY * res.depth;
        }
      }
    }

    return { x: outX, y: outY };
  }

  // Stepped raycast. Bullets stop at anything solid; with `sightOnly`, only
  // walls block - low cover, furniture and the fence are seen over/through.
  raycast(x1: number, y1: number, x2: number, y2: number, sightOnly = false): RayHit {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const totalDist = Math.hypot(dx, dy);

    if (totalDist === 0) {
      return { hit: false, x: x1, y: y1, tileX: 0, tileY: 0, dist: 0 };
    }

    const step = 6;
    const numSteps = Math.ceil(totalDist / step);
    const stepX = (dx / totalDist) * step;
    const stepY = (dy / totalDist) * step;

    let curX = x1;
    let curY = y1;

    for (let i = 0; i <= numSteps; i++) {
      const tx = Math.floor(curX / TILE);
      const ty = Math.floor(curY / TILE);

      if (sightOnly ? this.isWall(tx, ty) : this.isSolid(tx, ty)) {
        return {
          hit: true,
          x: curX,
          y: curY,
          tileX: tx,
          tileY: ty,
          dist: Math.hypot(curX - x1, curY - y1),
        };
      }

      curX += stepX;
      curY += stepY;
    }

    return {
      hit: false,
      x: x2,
      y: y2,
      tileX: Math.floor(x2 / TILE),
      tileY: Math.floor(y2 / TILE),
      dist: totalDist,
    };
  }

  // --- Rendering ---
  //
  // Floors are drawn first, flat. Everything with height (walls, fences,
  // props) is handed to the caller as y-sorted renderables so it interleaves
  // correctly with characters: a wall hides whoever stands behind it.

  private visibleRange(camX: number, camY: number, screenW: number, screenH: number, padTop = 1) {
    return {
      c0: Math.max(0, Math.floor((camX - screenW / 2) / TILE) - 1),
      c1: Math.min(this.cols - 1, Math.ceil((camX + screenW / 2) / TILE) + 1),
      r0: Math.max(0, Math.floor((camY - screenH / 2) / TILE) - padTop),
      r1: Math.min(this.rows - 1, Math.ceil((camY + screenH / 2) / TILE) + padTop),
    };
  }

  isWall(tx: number, ty: number): boolean {
    const t = this.get(tx, ty);
    return t === TileType.WALL_CONCRETE;
  }

  private floorTexture(t: TileType): string | null {
    switch (t) {
      case TileType.FLOOR_WARD: return 'terrazzo';
      case TileType.FLOOR_ASPHALT: return 'asphalt';
      case TileType.FLOOR_MOSS: return 'overgrown';
      case TileType.FLOOR_BRICK: return 'brick';
      case TileType.DECOR_RAILS: return 'rails';
      default: return null;
    }
  }

  // What floor lies under a solid tile: the most common floor around it.
  private floorUnder(tx: number, ty: number): TileType {
    for (const [dx, dy] of [[0, 1], [0, -1], [-1, 0], [1, 0]]) {
      const t = this.get(tx + dx, ty + dy);
      if (this.floorTexture(t)) return t;
    }
    return TileType.FLOOR_ASPHALT;
  }

  renderFloors(ctx: CanvasRenderingContext2D, camX: number, camY: number, screenW: number, screenH: number) {
    const { c0, c1, r0, r1 } = this.visibleRange(camX, camY, screenW, screenH);
    const ox = camX - screenW / 2;
    const oy = camY - screenH / 2;
    const roof = TD.tex.walltop;

    for (let ty = r0; ty <= r1; ty++) {
      for (let tx = c0; tx <= c1; tx++) {
        let t = this.get(tx, ty);
        const sx = Math.round(tx * TILE - ox);
        const sy = Math.round(ty * TILE - oy);

        if (t === TileType.VOID) {
          // Outside the playable area: the roofs of the surrounding ruins,
          // much darker than the lit wall tops.
          ctx.fillStyle = '#1d1712';
          ctx.fillRect(sx, sy, TILE, TILE);
          const rv = mirrorVariants(roof);
          if (rv) {
            ctx.globalAlpha = 0.35;
            ctx.drawImage(rv[Math.floor(tileHash(tx >> 1, ty >> 1) * 4)], (tx * TILE) % 64, (ty * TILE) % 64, TILE, TILE, sx, sy, TILE, TILE);
            ctx.globalAlpha = 1;
          }
          continue;
        }
        if (t === TileType.WALL_CONCRETE) continue; // fully covered by the wall itself
        if (!this.floorTexture(t)) t = this.floorUnder(tx, ty);

        const name = this.floorTexture(t)!;
        const variants = mirrorVariants(TD.tex[name]);
        if (variants) {
          // Rails only mirror left-right: flipped vertically the ties shift.
          let v = Math.floor(tileHash(tx >> 2, ty >> 2) * 4);
          if (name === 'rails') v &= 1;
          ctx.drawImage(variants[v], (tx * TILE) % 128, (ty * TILE) % 128, TILE, TILE, sx, sy, TILE, TILE);
        } else {
          ctx.fillStyle = '#3a332b';
          ctx.fillRect(sx, sy, TILE, TILE);
        }

        // Faded lane markings down the middle of the highway.
        if (t === TileType.FLOOR_ASPHALT && ty === 13 && tx >= 59 && tx <= 85 && tx % 3 !== 0) {
          ctx.fillStyle = 'rgba(214, 184, 110, 0.28)';
          ctx.fillRect(sx, sy - 2, TILE, 3);
        }

        // Ambient occlusion where the floor meets a wall.
        if (this.isWall(tx, ty - 1)) {
          const g = ctx.createLinearGradient(0, sy, 0, sy + 12);
          g.addColorStop(0, 'rgba(20, 12, 6, 0.55)');
          g.addColorStop(1, 'rgba(20, 12, 6, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(sx, sy, TILE, 12);
        }
        ctx.fillStyle = 'rgba(20, 12, 6, 0.3)';
        if (this.isWall(tx - 1, ty)) ctx.fillRect(sx, sy, 4, TILE);
        if (this.isWall(tx + 1, ty)) ctx.fillRect(sx + TILE - 3, sy, 3, TILE);
      }
    }
  }

  // Pushes every wall, fence and prop in view as { y: sort key, render }.
  // The sort key is the bottom of the object's footprint, matching the
  // characters' feet.
  collectRenderables(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    screenW: number,
    screenH: number,
    time: number,
    out: { y: number; render: () => void }[]
  ) {
    // Wall tops reach WALL_H above their tile, so look one row further down.
    const { c0, c1, r0, r1 } = this.visibleRange(camX, camY, screenW, screenH, 2);
    const ox = camX - screenW / 2;
    const oy = camY - screenH / 2;

    for (let ty = r0; ty <= r1; ty++) {
      for (let tx = c0; tx <= c1; tx++) {
        const t = this.get(tx, ty);
        const sx = Math.round(tx * TILE - ox);
        const sy = Math.round(ty * TILE - oy);
        const key = (ty + 1) * TILE;
        switch (t) {
          case TileType.WALL_CONCRETE:
            out.push({ y: key, render: () => this.drawWall(ctx, tx, ty, sx, sy) });
            break;
          case TileType.WALL_FENCE:
            out.push({ y: key, render: () => this.drawFence(ctx, sx, sy) });
            break;
          case TileType.COVER_SANDBAG:
            out.push({ y: key, render: () => this.drawSandbag(ctx, tx, ty, sx, sy) });
            break;
          case TileType.COVER_CRATE: {
            const h = tileHash(tx, ty);
            const inCamp = this.get(tx, ty + 1) === TileType.FLOOR_BRICK || this.get(tx, ty - 1) === TileType.FLOOR_BRICK;
            const name = inCamp ? 'crate' : h < 0.5 ? 'rubble' : 'garbage';
            out.push({ y: key, render: () => this.drawShadowedProp(ctx, name, sx + TILE / 2, sy + TILE, h < 0.5) });
            break;
          }
          case TileType.DECOR_BED:
            out.push({ y: key, render: () => this.drawShadowedProp(ctx, 'bed', sx + TILE / 2, sy + TILE + 6) });
            break;
          case TileType.DECOR_DESK:
            out.push({ y: key, render: () => this.drawShadowedProp(ctx, 'desk', sx + TILE / 2, sy + TILE) });
            break;
          case TileType.DECOR_VEHICLE:
            // A car spans two tiles; the left one draws it.
            if (this.get(tx - 1, ty) !== TileType.DECOR_VEHICLE) {
              const wide = this.get(tx + 1, ty) === TileType.DECOR_VEHICLE;
              out.push({
                y: key,
                render: () => this.drawShadowedProp(ctx, 'car', sx + (wide ? TILE : TILE / 2), sy + TILE + 2, tileHash(tx, ty) < 0.5),
              });
            }
            break;
          case TileType.DECOR_CAMPFIRE:
            out.push({ y: key - 8, render: () => this.drawCampfire(ctx, sx, sy, time) });
            break;
        }
      }
    }

    for (const d of this.decor) {
      const sx = Math.round(d.x - ox);
      const sy = Math.round(d.y - oy);
      if (sx < -80 || sx > screenW + 80 || sy < -40 || sy > screenH + 100) continue;
      out.push({ y: d.y, render: () => this.drawShadowedProp(ctx, d.prop, sx, sy, d.flip) });
    }
  }

  private drawWall(ctx: CanvasRenderingContext2D, tx: number, ty: number, sx: number, sy: number) {
    const top = mirrorVariants(TD.tex.walltop);
    const topY = sy - WALL_H;

    // Top face: the tile's footprint lifted by the wall height.
    if (top) {
      ctx.drawImage(top[Math.floor(tileHash(tx >> 1, ty >> 1) * 4)], (tx * TILE) % 64, (ty * TILE) % 64, TILE, TILE, sx, topY, TILE, TILE);
    } else {
      ctx.fillStyle = '#8a8070';
      ctx.fillRect(sx, topY, TILE, TILE);
    }
    // Rim light on exposed top edges, dark lip where the top meets open floor.
    ctx.fillStyle = 'rgba(255, 236, 200, 0.22)';
    if (!this.isWall(tx, ty - 1)) ctx.fillRect(sx, topY, TILE, 2);
    ctx.fillStyle = 'rgba(30, 20, 12, 0.45)';
    if (!this.isWall(tx - 1, ty)) ctx.fillRect(sx, topY, 2, TILE);
    if (!this.isWall(tx + 1, ty)) ctx.fillRect(sx + TILE - 2, topY, 2, TILE);

    // Front face, only where the wall ends and floor (or the void) begins.
    if (!this.isWall(tx, ty + 1)) {
      const faceY = sy + TILE - WALL_H;
      const below = this.get(tx, ty + 1);
      const hosp = below === TileType.FLOOR_WARD && TD.tex.hospwall.loaded;
      const face = hosp ? TD.tex.hospwall : TD.tex.wallface;
      if (face.loaded) {
        const srcY = hosp ? 0 : (ty * 37) % (128 - WALL_H);
        ctx.drawImage(face.img, (tx * TILE) % 128, srcY, TILE, WALL_H, sx, faceY, TILE, WALL_H);
      } else {
        ctx.fillStyle = '#6a6052';
        ctx.fillRect(sx, faceY, TILE, WALL_H);
      }
      // Darken toward the floor and under the top edge for depth.
      const g = ctx.createLinearGradient(0, faceY, 0, faceY + WALL_H);
      g.addColorStop(0, 'rgba(25, 16, 10, 0.35)');
      g.addColorStop(0.25, 'rgba(25, 16, 10, 0)');
      g.addColorStop(1, 'rgba(25, 16, 10, 0.4)');
      ctx.fillStyle = g;
      ctx.fillRect(sx, faceY, TILE, WALL_H);
      ctx.fillStyle = 'rgba(15, 10, 6, 0.7)';
      ctx.fillRect(sx, faceY, TILE, 1);
    }
  }

  private drawFence(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    const base = sy + TILE - 4;
    const h = 30;
    ctx.save();
    ctx.fillStyle = 'rgba(16, 10, 6, 0.4)';
    ctx.fillRect(sx, base - 2, TILE, 5);
    // Chain-link mesh
    ctx.strokeStyle = 'rgba(150, 140, 120, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -h; i < TILE; i += 5) {
      ctx.moveTo(sx + i, base);
      ctx.lineTo(sx + i + h, base - h);
      ctx.moveTo(sx + i + h, base);
      ctx.lineTo(sx + i, base - h);
    }
    ctx.save();
    ctx.rect(sx, base - h, TILE, h);
    ctx.clip();
    ctx.stroke();
    ctx.restore();
    // Posts and top rail
    ctx.fillStyle = '#4a4238';
    ctx.fillRect(sx, base - h - 2, 3, h + 2);
    ctx.fillRect(sx + TILE - 3, base - h - 2, 3, h + 2);
    ctx.fillRect(sx, base - h - 2, TILE, 2);
    // Razor wire
    ctx.strokeStyle = '#8c8270';
    ctx.beginPath();
    for (let i = 0; i < 4; i++) ctx.arc(sx + 4 + i * 8, base - h - 5, 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawSandbag(ctx: CanvasRenderingContext2D, tx: number, ty: number, sx: number, sy: number) {
    const img = TD.props.sandbag_long;
    if (!img.loaded) {
      ctx.fillStyle = '#7a6a50';
      ctx.fillRect(sx + 1, sy + 8, TILE - 2, 22);
      return;
    }
    const vertical = this.get(tx, ty - 1) === TileType.COVER_SANDBAG || this.get(tx, ty + 1) === TileType.COVER_SANDBAG;
    // A 34px slice of the long sandbag wall; alternate halves so a run
    // doesn't repeat the same bags.
    const w = 34;
    const srcX = (tx + ty) % 2 === 0 ? 0 : img.img.width - w;
    const h = img.img.height;
    ctx.fillStyle = 'rgba(16, 10, 6, 0.4)';
    ctx.beginPath();
    ctx.ellipse(sx + TILE / 2, sy + TILE - 2, 18, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (vertical) {
      // A north-south line: bag tops repeat down the run (lifted by the
      // barricade's height); the last tile shows the nearest bag's face.
      const mid = TD.props.sandbag_ns_mid;
      const end = TD.props.sandbag_ns_end;
      if (mid.loaded) ctx.drawImage(mid.img, sx + 1, sy - 10);
      if (this.get(tx, ty + 1) !== TileType.COVER_SANDBAG) drawProp(ctx, end, sx + TILE / 2, sy + TILE);
      return;
    }
    ctx.drawImage(img.img, srcX, 0, w, h, sx - 1, sy + TILE - h + 1, w, h);
  }

  private drawShadowedProp(ctx: CanvasRenderingContext2D, name: string, cx: number, bottomY: number, flip = false) {
    const asset = TD.props[name];
    const w = asset && asset.loaded ? asset.img.width : 28;
    ctx.fillStyle = 'rgba(16, 10, 6, 0.42)';
    ctx.beginPath();
    ctx.ellipse(cx, bottomY - 3, w * 0.5, Math.max(4, w * 0.16), 0, 0, Math.PI * 2);
    ctx.fill();
    if (!drawProp(ctx, asset, cx, bottomY, flip)) {
      ctx.fillStyle = '#6a5a48';
      ctx.fillRect(cx - 12, bottomY - 24, 24, 22);
    }
  }

  private drawCampfire(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number) {
    const cx = sx + TILE / 2;
    const bottom = sy + TILE - 6;
    this.drawShadowedProp(ctx, 'drum_fire', cx, bottom);
    // Live flames licking over the painted ones.
    const img = TD.props.drum_fire;
    const topY = bottom - (img.loaded ? img.img.height : 40) + 6;
    for (let i = 0; i < 3; i++) {
      const f = Math.sin(time * (9 + i * 3) + i * 2);
      const fh = 7 + f * 3;
      ctx.fillStyle = i === 2 ? 'rgba(255, 236, 170, 0.85)' : 'rgba(255, 130, 40, 0.75)';
      ctx.beginPath();
      const fx = cx + (i - 1) * 3;
      ctx.moveTo(fx - 3, topY + 4);
      ctx.quadraticCurveTo(fx + f, topY - fh, fx + 3, topY + 4);
      ctx.closePath();
      ctx.fill();
    }
  }
}
