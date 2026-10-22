// 3/4 Top-Down Grid Tilemap with 3D Wall Facades, Elevation, and AI Textures

import { TILE } from './constants';
import { circleAABBCollision } from './math';
import { ArtAssets } from './sprites';

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
      t === TileType.DECOR_VEHICLE
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

  // Fast DDA raycast for bullet trajectories & line of sight
  raycast(x1: number, y1: number, x2: number, y2: number): RayHit {
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

      if (this.isSolid(tx, ty)) {
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

  // --- 3/4 Top-Down Ground & Wall Rendering ---
  renderFloors(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    screenW: number,
    screenH: number
  ) {
    const startCol = Math.max(0, Math.floor((camX - screenW / 2) / TILE) - 1);
    const endCol = Math.min(this.cols - 1, Math.ceil((camX + screenW / 2) / TILE) + 1);
    const startRow = Math.max(0, Math.floor((camY - screenH / 2) / TILE) - 1);
    const endRow = Math.min(this.rows - 1, Math.ceil((camY + screenH / 2) / TILE) + 1);

    const halfW = screenW / 2;
    const halfH = screenH / 2;

    const tileFillImg = ArtAssets.tileFill.loaded ? ArtAssets.tileFill.img : null;

    for (let ty = startRow; ty <= endRow; ty++) {
      for (let tx = startCol; tx <= endCol; tx++) {
        const type = this.get(tx, ty);
        const sx = tx * TILE - (camX - halfW);
        const sy = ty * TILE - (camY - halfH);

        // Ground tiles
        switch (type) {
          case TileType.FLOOR_WARD: {
            // Hospital ward tile - alternating linoleum panels
            ctx.fillStyle = (tx + ty) % 2 === 0 ? '#182030' : '#141b2a';
            ctx.fillRect(sx, sy, TILE, TILE);
            ctx.strokeStyle = 'rgba(74, 90, 134, 0.22)';
            ctx.lineWidth = 1;
            ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);

            // Subtle floor cracks on older tiles
            const crackSeed = (tx * 17 + ty * 31) % 7;
            if (crackSeed === 0) {
              ctx.strokeStyle = 'rgba(15, 20, 32, 0.6)';
              ctx.beginPath();
              ctx.moveTo(sx + 4, sy + 6);
              ctx.lineTo(sx + 14, sy + 16);
              ctx.lineTo(sx + 26, sy + 12);
              ctx.stroke();
            } else if (crackSeed === 3) {
              // Shattered medicine glass fragments / vials
              ctx.fillStyle = 'rgba(127, 212, 255, 0.4)';
              ctx.fillRect(sx + 8, sy + 20, 3, 2);
              ctx.fillRect(sx + 18, sy + 10, 2, 3);
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(sx + 9, sy + 20, 1, 1);
            }
            break;
          }

          case TileType.FLOOR_ASPHALT: {
            // Post-war asphalt road
            ctx.fillStyle = '#111520';
            ctx.fillRect(sx, sy, TILE, TILE);

            if (tileFillImg) {
              ctx.save();
              ctx.globalAlpha = 0.35;
              ctx.drawImage(tileFillImg, sx, sy, TILE, TILE);
              ctx.restore();
            }

            // Subtle asphalt micro-cracks
            const aspSeed = (tx * 13 + ty * 23) % 9;
            if (aspSeed === 1) {
              ctx.strokeStyle = '#0b0e17';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(sx + 2, sy + 8);
              ctx.lineTo(sx + 12, sy + 18);
              ctx.lineTo(sx + 20, sy + 15);
              ctx.stroke();
            } else if (aspSeed === 4) {
              // Reflective rainwater puddle reflecting gloomy sky
              ctx.fillStyle = 'rgba(20, 30, 48, 0.75)';
              ctx.beginPath();
              ctx.ellipse(sx + 16, sy + 16, 11, 6, 0.2, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = 'rgba(70, 95, 140, 0.4)';
              ctx.lineWidth = 0.8;
              ctx.stroke();
              // Water sheen highlight
              ctx.fillStyle = 'rgba(160, 205, 255, 0.25)';
              ctx.fillRect(sx + 12, sy + 14, 5, 1.5);
            }

            // Road center dashes (double line segment)
            if ((ty === 12 || ty === 13) && tx % 3 === 0) {
              ctx.fillStyle = 'rgba(230, 200, 100, 0.35)';
              ctx.fillRect(sx + 2, sy + 14, TILE - 4, 3);
            }
            break;
          }

          case TileType.FLOOR_MOSS: {
            // Wasteland rubble overgrown with weeds
            ctx.fillStyle = '#0f1718';
            ctx.fillRect(sx, sy, TILE, TILE);

            if (tileFillImg) {
              ctx.save();
              ctx.globalAlpha = 0.55;
              ctx.drawImage(tileFillImg, sx, sy, TILE, TILE);
              ctx.restore();
            }

            // Weeds & moss tufts
            const mossSeed = (tx * 7 + ty * 13) % 6;
            if (mossSeed === 0 || mossSeed === 3) {
              ctx.fillStyle = '#1c3624';
              ctx.fillRect(sx + 4, sy + 6, 10, 8);
              ctx.fillStyle = '#295436';
              ctx.fillRect(sx + 6, sy + 4, 6, 4);
            } else if (mossSeed === 1) {
              // Gravel debris pebble
              ctx.fillStyle = '#283244';
              ctx.fillRect(sx + 12, sy + 14, 4, 3);
              ctx.fillStyle = '#1a2230';
              ctx.fillRect(sx + 13, sy + 17, 4, 2);
            }
            break;
          }

          case TileType.DECOR_RAILS: {
            // Abandoned railway heading to South Station
            ctx.fillStyle = '#0f141f';
            ctx.fillRect(sx, sy, TILE, TILE);

            // Weathered wooden sleepers with metallic spikes
            ctx.fillStyle = '#30241b';
            ctx.fillRect(sx + 2, sy + 5, TILE - 4, 6);
            ctx.fillStyle = '#3d2e23';
            ctx.fillRect(sx + 2, sy + 19, TILE - 4, 6);

            // Metal spikes
            ctx.fillStyle = '#59657a';
            ctx.fillRect(sx + 5, sy + 7, 2, 2);
            ctx.fillRect(sx + 23, sy + 7, 2, 2);
            ctx.fillRect(sx + 5, sy + 21, 2, 2);
            ctx.fillRect(sx + 23, sy + 21, 2, 2);

            // Steel rails with specular metallic reflection
            ctx.fillStyle = '#65738e';
            ctx.fillRect(sx + 6, sy, 3, TILE);
            ctx.fillRect(sx + 22, sy, 3, TILE);
            ctx.fillStyle = '#9cb2d6';
            ctx.fillRect(sx + 7, sy, 1, TILE);
            ctx.fillRect(sx + 23, sy, 1, TILE);
            break;
          }

          default: {
            // Void or wall floor base
            ctx.fillStyle = '#060810';
            ctx.fillRect(sx, sy, TILE, TILE);
          }
        }
      }
    }
  }

  // Render 3/4 perspective wall tops, vertical facades, rebar, and contact shadows
  renderWalls(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    screenW: number,
    screenH: number
  ) {
    const startCol = Math.max(0, Math.floor((camX - screenW / 2) / TILE) - 1);
    const endCol = Math.min(this.cols - 1, Math.ceil((camX + screenW / 2) / TILE) + 1);
    const startRow = Math.max(0, Math.floor((camY - screenH / 2) / TILE) - 2);
    const endRow = Math.min(this.rows - 1, Math.ceil((camY + screenH / 2) / TILE) + 1);

    const halfW = screenW / 2;
    const halfH = screenH / 2;

    const tileCapImg = ArtAssets.tileCap.loaded ? ArtAssets.tileCap.img : null;
    const tileFillImg = ArtAssets.tileFill.loaded ? ArtAssets.tileFill.img : null;

    for (let ty = startRow; ty <= endRow; ty++) {
      for (let tx = startCol; tx <= endCol; tx++) {
        const type = this.get(tx, ty);
        const sx = tx * TILE - (camX - halfW);
        const sy = ty * TILE - (camY - halfH);

        if (type === TileType.WALL_CONCRETE) {
          const hasWallBelow = this.get(tx, ty + 1) === TileType.WALL_CONCRETE;

          // 1. Wall Top Surface (Roof) - 3/4 angle view
          ctx.fillStyle = '#222d42';
          ctx.fillRect(sx, sy - 12, TILE, 16);

          if (tileCapImg) {
            ctx.drawImage(tileCapImg, sx, sy - 15, TILE, 12);
          } else {
            ctx.fillStyle = '#3a4b6e';
            ctx.fillRect(sx, sy - 15, TILE, 3);
          }

          ctx.strokeStyle = '#4a5d87';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 0.5, sy - 11.5, TILE - 1, 15);

          // Exposed twisted rebar rods projecting from damaged concrete tops
          const rebarSeed = (tx * 19 + ty * 29) % 8;
          if (rebarSeed === 2) {
            ctx.strokeStyle = '#944730';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sx + 8, sy - 12);
            ctx.lineTo(sx + 6, sy - 20);
            ctx.lineTo(sx + 10, sy - 24);
            ctx.stroke();
            // Second smaller rusty rod
            ctx.strokeStyle = '#b8593a';
            ctx.beginPath();
            ctx.moveTo(sx + 14, sy - 12);
            ctx.lineTo(sx + 17, sy - 18);
            ctx.stroke();
          }

          // 2. Wall Front Facade (Vertical 3D face facing the viewer)
          if (!hasWallBelow) {
            const faceH = 24;
            ctx.fillStyle = '#161d2c';
            ctx.fillRect(sx, sy + 4, TILE, faceH);

            if (tileFillImg) {
              ctx.save();
              ctx.globalAlpha = 0.75;
              ctx.drawImage(tileFillImg, sx, sy + 4, TILE, faceH);
              ctx.restore();
            }

            // Concrete brick joints
            ctx.strokeStyle = '#27344c';
            ctx.strokeRect(sx + 0.5, sy + 4.5, TILE - 1, faceH);

            // Stencil marking on certain walls (hospital unit or hazard stripe)
            if (tx === 10 && ty === 8) {
              ctx.fillStyle = '#7fd4ff';
              ctx.font = 'bold 7px monospace';
              ctx.fillText('WARD 01', sx + 2, sy + 14);
            } else if (tx === 88 && ty === 7) {
              ctx.fillStyle = '#ffbb33';
              ctx.font = 'bold 7px monospace';
              ctx.fillText('OUTPOST', sx + 2, sy + 14);
            }

            // Contact drop shadow on floor below wall
            const shadowGrad = ctx.createLinearGradient(sx, sy + 4 + faceH, sx, sy + 4 + faceH + 12);
            shadowGrad.addColorStop(0, 'rgba(4, 6, 12, 0.85)');
            shadowGrad.addColorStop(1, 'rgba(4, 6, 12, 0)');
            ctx.fillStyle = shadowGrad;
            ctx.fillRect(sx, sy + 4 + faceH, TILE, 12);
          }
        } else if (type === TileType.WALL_FENCE) {
          // Chain link fence with 3D elevation
          ctx.fillStyle = '#10141e';
          ctx.fillRect(sx, sy - 16, TILE, 32);
          ctx.strokeStyle = '#5c6f96';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, sy - 16);
          ctx.lineTo(sx + TILE, sy + 16);
          ctx.moveTo(sx + TILE, sy - 16);
          ctx.lineTo(sx, sy + 16);
          ctx.stroke();

          // Barbed wire coiled top
          ctx.strokeStyle = '#8ca3cc';
          ctx.beginPath();
          ctx.arc(sx + 8, sy - 18, 5, 0, Math.PI);
          ctx.arc(sx + 24, sy - 18, 5, 0, Math.PI);
          ctx.stroke();

          // Heavy steel fence posts
          ctx.fillStyle = '#7a8fb5';
          ctx.fillRect(sx, sy - 20, 3, 38);
        }
      }
    }
  }

  // Render 3/4 perspective obstacles (beds with IV stands, crates with stencils, sandbags, campfire)
  renderObstacles(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    screenW: number,
    screenH: number,
    time: number
  ) {
    const startCol = Math.max(0, Math.floor((camX - screenW / 2) / TILE) - 1);
    const endCol = Math.min(this.cols - 1, Math.ceil((camX + screenW / 2) / TILE) + 1);
    const startRow = Math.max(0, Math.floor((camY - screenH / 2) / TILE) - 1);
    const endRow = Math.min(this.rows - 1, Math.ceil((camY + screenH / 2) / TILE) + 1);

    const halfW = screenW / 2;
    const halfH = screenH / 2;

    for (let ty = startRow; ty <= endRow; ty++) {
      for (let tx = startCol; tx <= endCol; tx++) {
        const type = this.get(tx, ty);
        const sx = tx * TILE - (camX - halfW);
        const sy = ty * TILE - (camY - halfH);

        switch (type) {
          case TileType.COVER_SANDBAG: {
            // 3/4 Sandbags: shadow, front face, top cushions with burlap stitches
            ctx.fillStyle = 'rgba(4, 6, 12, 0.65)';
            ctx.beginPath();
            ctx.ellipse(sx + 16, sy + 23, 15, 6, 0, 0, Math.PI * 2);
            ctx.fill();

            // Sandbag bottom layer
            ctx.fillStyle = '#44372a';
            ctx.beginPath();
            ctx.roundRect(sx + 2, sy + 7, TILE - 4, 17, 3);
            ctx.fill();

            // Sandbag top cushion
            ctx.fillStyle = '#6e5a47';
            ctx.beginPath();
            ctx.roundRect(sx + 3, sy + 3, TILE - 6, 12, 3);
            ctx.fill();
            ctx.strokeStyle = '#8a725b';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Burlap cross seams
            ctx.strokeStyle = '#4e3f32';
            ctx.beginPath();
            ctx.moveTo(sx + 11, sy + 4);
            ctx.lineTo(sx + 11, sy + 14);
            ctx.moveTo(sx + 21, sy + 4);
            ctx.lineTo(sx + 21, sy + 14);
            ctx.stroke();
            break;
          }

          case TileType.COVER_CRATE: {
            // 3/4 Reinforced military shipping crate
            ctx.fillStyle = 'rgba(4, 6, 12, 0.65)';
            ctx.fillRect(sx + 3, sy + 22, TILE - 6, 7);

            // Crate front face
            ctx.fillStyle = '#382a1e';
            ctx.fillRect(sx + 3, sy + 8, TILE - 6, 16);
            // Crate top face
            ctx.fillStyle = '#56412f';
            ctx.fillRect(sx + 3, sy - 2, TILE - 6, 10);
            ctx.strokeStyle = '#755940';
            ctx.strokeRect(sx + 3.5, sy - 1.5, TILE - 7, 25);

            // Corner metal reinforcement brackets & rivets
            ctx.fillStyle = '#2f3b4e';
            ctx.fillRect(sx + 3, sy + 8, 4, 4);
            ctx.fillRect(sx + TILE - 7, sy + 8, 4, 4);
            ctx.fillRect(sx + 3, sy + 20, 4, 4);
            ctx.fillRect(sx + TILE - 7, sy + 20, 4, 4);

            // Stencil military chevron
            ctx.fillStyle = '#8f7759';
            ctx.font = '6px monospace';
            ctx.fillText('S-4', sx + 10, sy + 18);
            break;
          }

          case TileType.DECOR_BED: {
            // 3/4 Hospital Ward bed with mattress and attached IV stand
            ctx.fillStyle = 'rgba(4, 6, 12, 0.55)';
            ctx.fillRect(sx + 2, sy + 18, TILE - 4, 8);

            // Bed metallic frame
            ctx.fillStyle = '#1e2638';
            ctx.fillRect(sx + 3, sy + 6, TILE - 6, 16);
            // Hospital mattress sheet
            ctx.fillStyle = '#394869';
            ctx.fillRect(sx + 4, sy + 2, TILE - 8, 14);
            // Pillow
            ctx.fillStyle = '#6b7fa8';
            ctx.fillRect(sx + 6, sy + 2, 8, 7);

            // IV Saline drip stand next to bed head
            ctx.strokeStyle = '#8aa3cc';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx + 27, sy + 14);
            ctx.lineTo(sx + 27, sy - 8);
            ctx.lineTo(sx + 24, sy - 8);
            ctx.stroke();
            // Hanging saline bag
            ctx.fillStyle = 'rgba(160, 220, 255, 0.7)';
            ctx.fillRect(sx + 23, sy - 7, 3, 5);
            break;
          }

          case TileType.DECOR_DESK: {
            // 3/4 Office desk with stained documents
            ctx.fillStyle = 'rgba(4, 6, 12, 0.55)';
            ctx.fillRect(sx + 3, sy + 18, TILE - 6, 7);

            // Desk wood
            ctx.fillStyle = '#30231b';
            ctx.fillRect(sx + 4, sy + 8, TILE - 8, 14);
            ctx.fillStyle = '#4d372a';
            ctx.fillRect(sx + 4, sy + 2, TILE - 8, 10);

            // Yellowed notice document with red emergency stamp
            ctx.fillStyle = '#f0e2a8';
            ctx.fillRect(sx + 10, sy + 4, 10, 8);
            ctx.fillStyle = '#cc3333';
            ctx.fillRect(sx + 15, sy + 6, 3, 3);
            break;
          }

          case TileType.DECOR_CAMPFIRE: {
            // Old Zhou's barrel campfire with charred stones and ember glow
            ctx.fillStyle = 'rgba(4, 6, 12, 0.7)';
            ctx.beginPath();
            ctx.ellipse(sx + 16, sy + 22, 13, 6, 0, 0, Math.PI * 2);
            ctx.fill();

            // Charred stones encircling the barrel base
            ctx.fillStyle = '#1c1b18';
            ctx.fillRect(sx + 3, sy + 19, 4, 4);
            ctx.fillRect(sx + 25, sy + 19, 4, 4);
            ctx.fillRect(sx + 14, sy + 23, 4, 3);

            // Corrugated metal barrel
            ctx.fillStyle = '#262d3d';
            ctx.fillRect(sx + 6, sy + 8, 20, 16);
            ctx.fillStyle = '#3c4860';
            ctx.beginPath();
            ctx.ellipse(sx + 16, sy + 8, 10, 4, 0, 0, Math.PI * 2);
            ctx.fill();

            // Inner glowing embers
            ctx.fillStyle = '#ff4400';
            ctx.beginPath();
            ctx.ellipse(sx + 16, sy + 8, 7, 3, 0, 0, Math.PI * 2);
            ctx.fill();

            // Fire glow & leaping flame
            const flicker = Math.sin(time * 9) * 2.5 + Math.cos(time * 14) * 1.5;
            const grad = ctx.createRadialGradient(sx + 16, sy + 5, 2, sx + 16, sy + 5, 22 + flicker);
            grad.addColorStop(0, '#fff6bd');
            grad.addColorStop(0.35, '#ff8c1a');
            grad.addColorStop(0.7, 'rgba(230, 60, 10, 0.4)');
            grad.addColorStop(1, 'rgba(255, 60, 0, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(sx + 16, sy + 5, 22 + flicker, 0, Math.PI * 2);
            ctx.fill();
            break;
          }

          case TileType.DECOR_VEHICLE: {
            // 3/4 Abandoned Patrol Car Wreck
            ctx.fillStyle = 'rgba(4, 6, 12, 0.65)';
            ctx.beginPath();
            ctx.ellipse(sx + 16, sy + 23, 15, 8, 0, 0, Math.PI * 2);
            ctx.fill();

            // Car chassis
            ctx.fillStyle = '#1f2430';
            ctx.fillRect(sx + 2, sy + 6, TILE - 4, 16);
            ctx.fillStyle = '#343c50';
            ctx.fillRect(sx + 5, sy - 2, TILE - 10, 10);

            // Shattered windshield with spider cracks
            ctx.fillStyle = '#10141f';
            ctx.fillRect(sx + 7, sy, TILE - 14, 6);
            ctx.strokeStyle = 'rgba(160, 200, 255, 0.5)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(sx + 9, sy + 1);
            ctx.lineTo(sx + 16, sy + 4);
            ctx.lineTo(sx + 22, sy + 2);
            ctx.moveTo(sx + 16, sy + 4);
            ctx.lineTo(sx + 14, sy + 6);
            ctx.stroke();

            // Broken emergency roof light bar
            ctx.fillStyle = '#cc2233';
            ctx.fillRect(sx + 10, sy - 4, 4, 2);
            ctx.fillStyle = '#2255cc';
            ctx.fillRect(sx + 17, sy - 4, 4, 2);
            break;
          }
        }
      }
    }
  }
}
