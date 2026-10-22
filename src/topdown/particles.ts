// Top-down particle and VFX system

import { clamp, lerp } from './math';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
  drag?: number;
  alpha?: number;
}

export interface BulletTracer {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  life: number;
  maxLife: number;
}

export interface SlashArc {
  cx: number;
  cy: number;
  angle: number;
  radius: number;
  arcSpan: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface FloorDecal {
  x: number;
  y: number;
  radius: number;
  color: string;
  alpha: number;
}

export class ParticleSystem {
  public particles: Particle[] = [];
  public tracers: BulletTracer[] = [];
  public slashes: SlashArc[] = [];
  public decals: FloorDecal[] = [];

  update(dt: number) {
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = p.drag ?? 0.92;
      p.vx *= Math.pow(drag, dt * 60);
      p.vy *= Math.pow(drag, dt * 60);
    }

    // Update tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.tracers.splice(i, 1);
      }
    }

    // Update slash arcs
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.slashes.splice(i, 1);
      }
    }
  }

  spawnBlood(x: number, y: number, dirAngle: number, count: number = 8) {
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 1.4;
      const speed = 60 + Math.random() * 160;
      const angle = dirAngle + spread;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: Math.random() > 0.4 ? '#c82845' : '#851025',
        size: 1.5 + Math.random() * 2,
        life: 0.35 + Math.random() * 0.3,
        maxLife: 0.65,
        drag: 0.88,
      });
    }

    // Add small permanent floor stain decal (capped to 60)
    if (this.decals.length > 60) this.decals.shift();
    this.decals.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 10,
      radius: 3 + Math.random() * 5,
      color: '#6e1122',
      alpha: 0.55 + Math.random() * 0.3,
    });
  }

  spawnSparks(x: number, y: number, dirAngle: number, count: number = 6) {
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 2;
      const speed = 100 + Math.random() * 180;
      const angle = dirAngle + Math.PI + spread;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: Math.random() > 0.3 ? '#ffe680' : '#ffffff',
        size: 1 + Math.random() * 1.5,
        life: 0.12 + Math.random() * 0.15,
        maxLife: 0.27,
        drag: 0.85,
      });
    }
  }

  spawnDust(x: number, y: number, vx: number = 0, vy: number = 0) {
    this.particles.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 6,
      vx: -vx * 0.2 + (Math.random() - 0.5) * 20,
      vy: -vy * 0.2 + (Math.random() - 0.5) * 20,
      color: '#434e6b',
      size: 2 + Math.random() * 3,
      life: 0.25 + Math.random() * 0.2,
      maxLife: 0.45,
      drag: 0.9,
    });
  }

  spawnShellCasing(x: number, y: number, facingAngle: number) {
    // Eject casing perpendicular to gun
    const ejectAngle = facingAngle + Math.PI / 2 + (Math.random() - 0.5) * 0.4;
    const speed = 80 + Math.random() * 60;
    this.particles.push({
      x,
      y,
      vx: Math.cos(ejectAngle) * speed,
      vy: Math.sin(ejectAngle) * speed,
      color: '#e6c86a',
      size: 1.5,
      life: 0.3 + Math.random() * 0.15,
      maxLife: 0.45,
      drag: 0.86,
    });
  }

  spawnTracer(x1: number, y1: number, x2: number, y2: number, isAimed: boolean = false) {
    this.tracers.push({
      x1,
      y1,
      x2,
      y2,
      color: isAimed ? '#fff3c4' : '#ffd97d',
      width: isAimed ? 2 : 1.5,
      life: 0.08,
      maxLife: 0.08,
    });
  }

  spawnMuzzleFlash(x: number, y: number, angle: number) {
    for (let i = 0; i < 4; i++) {
      const spread = (Math.random() - 0.5) * 0.8;
      const speed = 120 + Math.random() * 100;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle + spread) * speed,
        vy: Math.sin(angle + spread) * speed,
        color: Math.random() > 0.5 ? '#fff4b8' : '#ffaa33',
        size: 1.5 + Math.random() * 1.5,
        life: 0.05 + Math.random() * 0.05,
        maxLife: 0.1,
        drag: 0.8,
      });
    }
  }

  spawnSlash(cx: number, cy: number, angle: number, radius: number, isKnife: boolean = false) {
    this.slashes.push({
      cx,
      cy,
      angle,
      radius,
      arcSpan: Math.PI * 0.75,
      color: isKnife ? '#cbe5ff' : '#ffd580',
      life: 0.12,
      maxLife: 0.12,
    });
  }

  renderDecals(ctx: CanvasRenderingContext2D, camX: number, camY: number, screenW: number, screenH: number) {
    for (const d of this.decals) {
      const sx = d.x - (camX - screenW / 2);
      const sy = d.y - (camY - screenH / 2);
      if (sx < -20 || sx > screenW + 20 || sy < -20 || sy > screenH + 20) continue;

      ctx.save();
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(sx, sy, d.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, screenW: number, screenH: number) {
    const halfW = screenW / 2;
    const halfH = screenH / 2;

    // Render slash arcs
    for (const s of this.slashes) {
      const sx = s.cx - (camX - halfW);
      const sy = s.cy - (camY - halfH);
      const progress = 1 - s.life / s.maxLife;

      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = lerp(3, 1, progress);
      ctx.globalAlpha = 1 - progress;
      ctx.beginPath();
      const startAngle = s.angle - s.arcSpan / 2 + (s.arcSpan * progress * 0.4);
      const endAngle = s.angle + s.arcSpan / 2;
      ctx.arc(sx, sy, s.radius, startAngle, endAngle);
      ctx.stroke();
      ctx.restore();
    }

    // Render tracers
    for (const t of this.tracers) {
      const sx1 = t.x1 - (camX - halfW);
      const sy1 = t.y1 - (camY - halfH);
      const sx2 = t.x2 - (camX - halfW);
      const sy2 = t.y2 - (camY - halfH);
      const progress = 1 - t.life / t.maxLife;

      ctx.save();
      ctx.strokeStyle = t.color;
      ctx.lineWidth = t.width;
      ctx.globalAlpha = 1 - progress;
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.stroke();
      ctx.restore();
    }

    // Render particles
    for (const p of this.particles) {
      const sx = p.x - (camX - halfW);
      const sy = p.y - (camY - halfH);
      if (sx < -10 || sx > screenW + 10 || sy < -10 || sy > screenH + 10) continue;

      const progress = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 1 - progress * 0.6;
      ctx.beginPath();
      ctx.arc(sx, sy, p.size * (1 - progress * 0.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
