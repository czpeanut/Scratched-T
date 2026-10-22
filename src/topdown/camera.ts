// Top-down smooth tracking camera with screen shake (trauma) and look-ahead

import { clamp, lerp } from './math';
import { VIEW } from './constants';

export class Camera {
  public x: number = 0;
  public y: number = 0;
  public trauma: number = 0; // 0 to 1
  public kickX: number = 0;
  public kickY: number = 0;

  private minX: number = 0;
  private minY: number = 0;
  private maxX: number = 1000;
  private maxY: number = 1000;

  setBounds(minX: number, minY: number, maxX: number, maxY: number) {
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  addTrauma(amount: number) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  addKick(kx: number, ky: number) {
    this.kickX += kx;
    this.kickY += ky;
  }

  update(dt: number, targetX: number, targetY: number, aimAngle: number = 0, isAiming: boolean = false) {
    // Look ahead in aiming direction
    const lookAheadDist = isAiming ? 48 : 20;
    const goalX = targetX + Math.cos(aimAngle) * lookAheadDist;
    const goalY = targetY + Math.sin(aimAngle) * lookAheadDist;

    // Smooth follow
    this.x = lerp(this.x, goalX, clamp(dt * 7, 0, 1));
    this.y = lerp(this.y, goalY, clamp(dt * 7, 0, 1));

    // Clamp inside world boundaries
    const halfW = VIEW.width / 2;
    const halfH = VIEW.height / 2;
    this.x = clamp(this.x, this.minX + halfW, Math.max(this.minX + halfW, this.maxX - halfW));
    this.y = clamp(this.y, this.minY + halfH, Math.max(this.minY + halfH, this.maxY - halfH));

    // Decay kick
    this.kickX = lerp(this.kickX, 0, clamp(dt * 12, 0, 1));
    this.kickY = lerp(this.kickY, 0, clamp(dt * 12, 0, 1));

    // Decay trauma (quadratic shake for punchy feel)
    this.trauma = clamp(this.trauma - dt * 1.5, 0, 1);
  }

  get shakeX(): number {
    const shake = this.trauma * this.trauma * 12;
    return (Math.random() * 2 - 1) * shake + this.kickX;
  }

  get shakeY(): number {
    const shake = this.trauma * this.trauma * 12;
    return (Math.random() * 2 - 1) * shake + this.kickY;
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: wx - (this.x - VIEW.width / 2) + this.shakeX,
      y: wy - (this.y - VIEW.height / 2) + this.shakeY,
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: sx + (this.x - VIEW.width / 2) - this.shakeX,
      y: sy + (this.y - VIEW.height / 2) - this.shakeY,
    };
  }
}
