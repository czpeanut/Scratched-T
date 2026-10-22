// Dynamic Reticle with Aim-Down-Sights Shrinking Crosshair
// (遠射瞄準縮小準星系統)

import { clamp, lerp } from './math';
import { WeaponDef } from './types';

export class Reticle {
  public aimProgress: number = 0; // 0 (hip-fire) to 1 (full pinpoint aim)
  public currentSpread: number = 0.38; // Current half-angle spread in radians
  public bloom: number = 0; // Added bloom from firing recoil
  public isAimed: boolean = false;
  private lockedBeepPlayed: boolean = false;

  update(
    dt: number,
    aimingInput: boolean,
    isMoving: boolean,
    weapon: WeaponDef,
    onAimLocked?: () => void
  ) {
    this.isAimed = aimingInput;

    const rampTime = weapon.aimRampTime ?? 1.4;
    const spreadMax = weapon.spreadMax ?? 0.38;
    const spreadMin = weapon.spreadMin ?? 0.015;
    const moveExtra = isMoving ? (weapon.moveSpread ?? 0.12) : 0;

    // Recover bloom over time
    this.bloom = Math.max(0, this.bloom - dt * 1.8);

    if (this.isAimed) {
      // Ramp aim progress up
      this.aimProgress = clamp(this.aimProgress + dt / rampTime, 0, 1);

      if (this.aimProgress >= 0.98 && !this.lockedBeepPlayed) {
        this.lockedBeepPlayed = true;
        onAimLocked?.();
      }
    } else {
      // Release aim: ramp down quickly
      this.aimProgress = clamp(this.aimProgress - dt * 3.5, 0, 1);
      this.lockedBeepPlayed = false;
    }

    // Calculate current effective spread: lerp between spreadMax and spreadMin
    const baseSpread = lerp(spreadMax, spreadMin, this.aimProgress);
    this.currentSpread = clamp(baseSpread + this.bloom + moveExtra, spreadMin, spreadMax + 0.2);
  }

  addBloom(amount: number) {
    this.bloom += amount;
  }

  // Draw the reticle at (screenX, screenY) on canvas
  render(
    ctx: CanvasRenderingContext2D,
    screenX: number,
    screenY: number,
    distToPlayer: number,
    weapon: WeaponDef
  ) {
    if (weapon.type !== 'ranged') {
      // Melee reticle: minimalist subtle targeting pip
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 238, 214, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(screenX, screenY, 6, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#f0d9b5';
      ctx.fillRect(screenX - 1, screenY - 1, 2, 2);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(screenX, screenY);

    // Calculate visual radius based on current spread and distance
    // Closer spread = smaller radius; tight aim shrinks towards 5px
    const spreadRadiusPx = clamp(this.currentSpread * Math.min(distToPlayer, 300) * 0.4 + 5, 4, 38);

    const isFullyAimed = this.aimProgress > 0.95;
    const accentColor = isFullyAimed ? '#ffe082' : this.isAimed ? '#f0d9b5' : 'rgba(255, 236, 210, 0.7)';
    const bracketLen = isFullyAimed ? 4 : lerp(6, 4, this.aimProgress);

    // 1. Center pinpoint dot
    ctx.fillStyle = isFullyAimed ? '#fff3c2' : '#f0d9b5';
    ctx.fillRect(-1, -1, 2, 2);

    // 2. Dynamic 4-quadrant brackets that slide inward as aim tightens
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.5;

    // Top bracket
    ctx.beginPath();
    ctx.moveTo(-bracketLen, -spreadRadiusPx);
    ctx.lineTo(bracketLen, -spreadRadiusPx);
    ctx.moveTo(0, -spreadRadiusPx);
    ctx.lineTo(0, -spreadRadiusPx - 3);
    ctx.stroke();

    // Bottom bracket
    ctx.beginPath();
    ctx.moveTo(-bracketLen, spreadRadiusPx);
    ctx.lineTo(bracketLen, spreadRadiusPx);
    ctx.moveTo(0, spreadRadiusPx);
    ctx.lineTo(0, spreadRadiusPx + 3);
    ctx.stroke();

    // Left bracket
    ctx.beginPath();
    ctx.moveTo(-spreadRadiusPx, -bracketLen);
    ctx.lineTo(-spreadRadiusPx, bracketLen);
    ctx.moveTo(-spreadRadiusPx, 0);
    ctx.lineTo(-spreadRadiusPx - 3, 0);
    ctx.stroke();

    // Right bracket
    ctx.beginPath();
    ctx.moveTo(spreadRadiusPx, -bracketLen);
    ctx.lineTo(spreadRadiusPx, bracketLen);
    ctx.moveTo(spreadRadiusPx, 0);
    ctx.lineTo(spreadRadiusPx + 3, 0);
    ctx.stroke();

    // 3. Faint circular dispersion guide
    ctx.strokeStyle = isFullyAimed ? 'rgba(255, 224, 130, 0.35)' : 'rgba(240, 217, 181, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, spreadRadiusPx, 0, Math.PI * 2);
    ctx.stroke();

    // 4. Aim progress gauge / diamond when aiming
    if (this.isAimed) {
      const gaugeRadius = spreadRadiusPx + 7;
      ctx.strokeStyle = isFullyAimed ? '#ffd24d' : 'rgba(240, 217, 181, 0.65)';
      ctx.lineWidth = 1;

      // Circular arc showing percentage of steady aim
      ctx.beginPath();
      ctx.arc(0, 0, gaugeRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.aimProgress);
      ctx.stroke();

      if (isFullyAimed) {
        // "LOCK" indicator
        ctx.fillStyle = '#ffe082';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('鎖定', 0, -spreadRadiusPx - 8);
      }
    }

    ctx.restore();
  }
}
