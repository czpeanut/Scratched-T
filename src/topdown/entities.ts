// Player, enemies, turret and NPC: movement, combat state machines, and
// rendering with the directional sprite sheets from art.ts.

import { clamp, lerp, dist, angleDist, rotateAngle } from './math';
import { PLAYER_CONFIG, WEAPONS } from './constants';
import { WeaponDef } from './types';
import { Tilemap } from './tilemap';
import { ParticleSystem } from './particles';
import { AudioManager } from './audio';
import {
  TD, FEET_OFFSET, ROW, Facing, facingOf, facesAway, weaponHand, walkFrame,
  attackFacing, swingHand, SWING_COL, aimFacing, aimHand, gunInFrame,
  drawCharacter, drawCharacterFlash, drawShadow, drawCastShadow, drawWeapon, drawProp,
} from './art';
import { ImageAsset } from './sprites';

export interface EnemyBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  damage: number;
}

type AttackPhase = 'idle' | 'windup' | 'active' | 'recover';

// A character's pose for this frame: the walk sheet normally, the swing
// rows while a melee attack is under way.
function poseFor(aim: number, moving: boolean, walkCycle: number, phase: AttackPhase): { facing: Facing; col: number } {
  if (phase !== 'idle') return { facing: attackFacing(aim), col: SWING_COL[phase] };
  return { facing: facingOf(aim), col: walkFrame(moving, walkCycle) };
}

// Draws a melee weapon in the sprite's own hand - no arm is ever drawn on top
// of the sprite. At rest it hangs from the hand measured for the facing; in
// a swing frame it sits in the swinging fist, along the forearm.
function drawMeleeWeapon(
  ctx: CanvasRenderingContext2D,
  who: string,
  asset: ImageAsset | undefined,
  grip: number,
  sx: number,
  sy: number,
  pose: { facing: Facing; col: number },
  phase: AttackPhase,
  aim: number
) {
  if (!asset) return;
  if (phase !== 'idle') {
    const h = swingHand(who, pose.facing, pose.col);
    drawWeapon(ctx, asset, sx + h.x, sy + h.y, h.angle, grip);
    return;
  }
  const h = weaponHand(who, pose.facing, pose.col);
  // Hanging from the hand, tip forward toward the side it faces.
  const angle = Math.PI / 2 + (Math.cos(aim) >= 0 ? -0.6 : 0.6);
  drawWeapon(ctx, asset, sx + h.x, sy + h.y, angle, grip);
}

export class Player {
  public x: number = 0;
  public y: number = 0;
  public vx: number = 0;
  public vy: number = 0;
  public radius: number = PLAYER_CONFIG.radius;

  // Twin-Stick Decoupled Angles & Kinetics
  public facingAngle: number = 0; // Aiming angle (toward crosshair in 360°)
  public moveAngle: number = 0;   // Velocity travel angle
  public walkCycle: number = 0;   // Stride gait oscillator
  public recoilKick: number = 0;  // Weapon slide / pushback in pixels
  public globalTimer: number = 0;
  public scarfFlutter: number = 0; // Cloth physics oscillation

  // Stats
  public health: number = PLAYER_CONFIG.maxHealth;
  public maxHealth: number = PLAYER_CONFIG.maxHealth;
  public stamina: number = 1.0;
  public isWinded: boolean = false;
  private staminaDelayTimer: number = 0;
  public invulnTimer: number = 0;
  public hurtTimer: number = 0;

  // Dash / Dodge roll
  public isDashing: boolean = false;
  public dashTimer: number = 0;
  public dashCooldown: number = 0;
  public dashDirX: number = 0;
  public dashDirY: number = 0;

  // Weapons & Combat
  public unlockedWeapons: string[] = ['fists'];
  public currentWeaponId: string = 'fists';
  public attackPhase: 'idle' | 'windup' | 'active' | 'recover' = 'idle';
  public attackTimer: number = 0;
  public attackCooldown: number = 0;
  public attackHitDone: boolean = false;
  public meleeSwingAngle: number = 0;

  // Footsteps timer & Ghost trails
  private footstepTimer: number = 0;
  public ghostTrails: { x: number; y: number; alpha: number; angle: number }[] = [];

  constructor(startX: number, startY: number) {
    this.x = startX;
    this.y = startY;
  }

  get currentWeapon(): WeaponDef {
    return WEAPONS[this.currentWeaponId] ?? WEAPONS.fists;
  }

  unlockWeapon(id: string) {
    if (!this.unlockedWeapons.includes(id)) {
      this.unlockedWeapons.push(id);
    }
  }

  equipWeapon(id: string) {
    if (this.unlockedWeapons.includes(id) && WEAPONS[id]) {
      this.currentWeaponId = id;
      this.attackPhase = 'idle';
      this.attackTimer = 0;
    }
  }

  cycleWeapon(dir: number = 1) {
    if (this.unlockedWeapons.length <= 1) return;
    const idx = this.unlockedWeapons.indexOf(this.currentWeaponId);
    const nextIdx = (idx + dir + this.unlockedWeapons.length) % this.unlockedWeapons.length;
    this.equipWeapon(this.unlockedWeapons[nextIdx]);
  }

  takeDamage(amount: number, fromAngle: number, audio: AudioManager, particles: ParticleSystem) {
    if (this.invulnTimer > 0 || this.isDashing) return;

    this.health = Math.max(0, this.health - amount);
    this.invulnTimer = PLAYER_CONFIG.invulnOnHit;
    this.hurtTimer = 0.25;

    // Knockback
    this.vx = Math.cos(fromAngle) * 230;
    this.vy = Math.sin(fromAngle) * 230;

    audio.playerHurt();
    particles.spawnBlood(this.x, this.y, fromAngle, 14);
  }

  tryDash(canSprint: boolean, audio: AudioManager, particles: ParticleSystem): boolean {
    if (!canSprint || this.dashCooldown > 0 || this.isDashing || this.isWinded) return false;
    if (this.stamina < PLAYER_CONFIG.dashStaminaCost) return false;

    this.stamina = Math.max(0, this.stamina - PLAYER_CONFIG.dashStaminaCost);
    this.staminaDelayTimer = PLAYER_CONFIG.staminaRegenDelay;
    this.isDashing = true;
    this.dashTimer = PLAYER_CONFIG.dashDuration;
    this.dashCooldown = PLAYER_CONFIG.dashCooldown;

    const len = Math.hypot(this.vx, this.vy);
    if (len > 10) {
      this.dashDirX = this.vx / len;
      this.dashDirY = this.vy / len;
    } else {
      this.dashDirX = Math.cos(this.facingAngle);
      this.dashDirY = Math.sin(this.facingAngle);
    }

    audio.dash();
    particles.spawnDust(this.x, this.y, this.dashDirX * 120, this.dashDirY * 120);
    return true;
  }

  update(
    dt: number,
    moveX: number,
    moveY: number,
    aimX: number,
    aimY: number,
    isSprinting: boolean,
    canSprint: boolean,
    isAiming: boolean,
    tilemap: Tilemap,
    particles: ParticleSystem,
    audio: AudioManager
  ) {
    this.globalTimer += dt;
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    if (this.hurtTimer > 0) this.hurtTimer -= dt;
    if (this.dashCooldown > 0) this.dashCooldown -= dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.recoilKick > 0) this.recoilKick = Math.max(0, this.recoilKick - dt * 40);

    // Aim angle tracks mouse crosshair in full 360 degrees
    this.facingAngle = Math.atan2(aimY - this.y, aimX - this.x);

    // Cloth scarf flutter physics
    const moveSpeed = Math.hypot(this.vx, this.vy);
    this.scarfFlutter += dt * (10 + moveSpeed * 0.08);

    // Update ghost trails
    for (let i = this.ghostTrails.length - 1; i >= 0; i--) {
      this.ghostTrails[i].alpha -= dt * 4.5;
      if (this.ghostTrails[i].alpha <= 0) this.ghostTrails.splice(i, 1);
    }

    const isMoving = moveSpeed > 15;
    if (isMoving) {
      this.moveAngle = Math.atan2(this.vy, this.vx);
    }

    // Dash update
    if (this.isDashing) {
      this.dashTimer -= dt;
      this.vx = this.dashDirX * PLAYER_CONFIG.dashSpeed;
      this.vy = this.dashDirY * PLAYER_CONFIG.dashSpeed;
      this.walkCycle += dt * 32;

      this.ghostTrails.push({ x: this.x, y: this.y, alpha: 0.65, angle: this.facingAngle });

      if (this.dashTimer <= 0) {
        this.isDashing = false;
      }
    } else {
      // Normal twin-stick movement
      const sprintAllowed = canSprint && isSprinting && !this.isWinded && this.stamina > 0.05;
      let targetSpeed = sprintAllowed ? PLAYER_CONFIG.sprintSpeed : PLAYER_CONFIG.runSpeed;

      if (isAiming && this.currentWeapon.type === 'ranged') {
        targetSpeed *= PLAYER_CONFIG.aimSpeedMult;
      }

      const targetVx = moveX * targetSpeed;
      const targetVy = moveY * targetSpeed;

      const accel = (moveX !== 0 || moveY !== 0) ? PLAYER_CONFIG.accel : PLAYER_CONFIG.friction;
      this.vx = lerp(this.vx, targetVx, clamp(dt * (accel / 200), 0, 1));
      this.vy = lerp(this.vy, targetVy, clamp(dt * (accel / 200), 0, 1));

      // Advance leg walk cycle
      if (isMoving) {
        this.walkCycle += dt * (sprintAllowed ? 22 : 14);
      } else {
        this.walkCycle = lerp(this.walkCycle, 0, dt * 10);
      }

      // Stamina
      if (sprintAllowed && isMoving) {
        this.stamina = Math.max(0, this.stamina - dt * PLAYER_CONFIG.staminaDrain);
        this.staminaDelayTimer = PLAYER_CONFIG.staminaRegenDelay;
        if (this.stamina <= 0) this.isWinded = true;
      } else {
        if (this.staminaDelayTimer > 0) {
          this.staminaDelayTimer -= dt;
        } else {
          this.stamina = Math.min(1.0, this.stamina + dt * PLAYER_CONFIG.staminaRegen);
          if (this.isWinded && this.stamina >= PLAYER_CONFIG.windedRecover) {
            this.isWinded = false;
          }
        }
      }

      // Footsteps & dust
      if (isMoving) {
        this.footstepTimer += dt;
        const interval = sprintAllowed ? 0.22 : 0.34;
        if (this.footstepTimer >= interval) {
          this.footstepTimer = 0;
          audio.footstep();
          particles.spawnDust(this.x, this.y + 12, this.vx * 0.3, this.vy * 0.3);
        }
      }
    }

    // Integrate position & resolve collision
    this.x += this.vx * dt;
    const colX = tilemap.resolveCircleCollision(this.x, this.y, this.radius);
    this.x = colX.x;

    this.y += this.vy * dt;
    const colY = tilemap.resolveCircleCollision(this.x, this.y, this.radius);
    this.y = colY.y;

    // Melee attack cycle
    const weapon = this.currentWeapon;
    if (weapon.type === 'melee' && this.attackPhase !== 'idle') {
      this.attackTimer -= dt;

      if (this.attackPhase === 'windup') {
        if (this.attackTimer <= 0) {
          this.attackPhase = 'active';
          this.attackTimer = weapon.active ?? 0.08;
          this.attackHitDone = false;
          this.meleeSwingAngle = this.facingAngle;

          const lunge = weapon.lunge ?? 80;
          this.vx += Math.cos(this.facingAngle) * lunge;
          this.vy += Math.sin(this.facingAngle) * lunge;
          audio.meleeSwing();
          particles.spawnSlash(this.x, this.y, this.facingAngle, weapon.range + 8, weapon.id === 'knife');
        }
      } else if (this.attackPhase === 'active') {
        if (this.attackTimer <= 0) {
          this.attackPhase = 'recover';
          this.attackTimer = weapon.recover ?? 0.12;
        }
      } else if (this.attackPhase === 'recover') {
        if (this.attackTimer <= 0) {
          this.attackPhase = 'idle';
        }
      }
    }
  }

  startMeleeAttack(): boolean {
    const weapon = this.currentWeapon;
    if (weapon.type !== 'melee') return false;
    if (this.attackPhase !== 'idle' || this.attackCooldown > 0) return false;

    this.attackPhase = 'windup';
    this.attackTimer = weapon.windup ?? 0.06;
    this.attackCooldown = weapon.cooldown ?? 0.28;
    return true;
  }

  // Where shots leave the pistol, held out in the aiming pose's hand.
  muzzlePoint(angle: number): { x: number; y: number } {
    const f = aimFacing(this.facingAngle);
    const h = aimHand('player', f, 0);
    const reach = gunInFrame(f) ? 0 : 7; // the drawn-in gun's point is the muzzle
    return { x: this.x + h.x + Math.cos(angle) * reach, y: this.y + h.y + Math.sin(angle) * reach };
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    screenW: number,
    screenH: number,
    isAiming: boolean
  ) {
    const ox = camX - screenW / 2;
    const oy = camY - screenH / 2;
    const sx = this.x - ox;
    const sy = this.y - oy;
    const aimAngle = this.facingAngle;
    const isMoving = Math.hypot(this.vx, this.vy) > 15;
    const gun = this.currentWeapon.type === 'ranged';
    const phase: AttackPhase = gun ? 'idle' : this.attackPhase;
    // With the pistol out he walks in the aiming pose, arm held toward the
    // crosshair.
    const pose = gun
      ? { facing: aimFacing(aimAngle), col: walkFrame(isMoving, this.walkCycle) }
      : poseFor(aimAngle, isMoving, this.walkCycle, phase);
    const { facing, col } = pose;

    ctx.save();
    drawShadow(ctx, sx, sy + FEET_OFFSET, 10);

    // Dash afterimages: the current frame as fading silhouettes.
    for (const g of this.ghostTrails) {
      drawCharacterFlash(ctx, TD.player, g.x - ox, g.y - oy, facingOf(g.angle), col, g.alpha * 0.5, '#c9b28a');
    }

    if (this.invulnTimer > 0 && Math.floor(this.invulnTimer * 16) % 2 === 0) {
      ctx.globalAlpha = 0.5;
    }

    // Facing away (walking), the weapon is hidden behind the body.
    const behind = !gun && phase === 'idle' && facesAway(facing);
    if (behind) this.renderWeapon(ctx, sx, sy, pose, phase, isAiming);
    if (!drawCharacter(ctx, TD.player, sx, sy, facing, col)) {
      ctx.fillStyle = '#8c7a5c';
      ctx.fillRect(sx - 6, sy - 18, 12, 30);
    }
    if (this.hurtTimer > 0) {
      drawCharacterFlash(ctx, TD.player, sx, sy, facing, col, Math.min(1, this.hurtTimer * 5), '#ffd9c4');
    }
    if (!behind) this.renderWeapon(ctx, sx, sy, pose, phase, isAiming);

    ctx.restore();
  }

  private renderWeapon(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    pose: { facing: Facing; col: number },
    phase: AttackPhase,
    isAiming: boolean
  ) {
    const weapon = this.currentWeapon;
    const aim = this.facingAngle;
    if (weapon.type === 'ranged') {
      // In the outstretched hand of the aiming pose, pointing at the
      // crosshair; the pistol image includes the gripping hand. Recoil kicks
      // it back along the aim.
      const h = aimHand('player', pose.facing, pose.col);
      const hx = sx + h.x - Math.cos(aim) * this.recoilKick * 0.4;
      const hy = sy + h.y - Math.sin(aim) * this.recoilKick * 0.4;
      const inFrame = gunInFrame(pose.facing);
      if (!inFrame) drawWeapon(ctx, TD.weapons.pistol, hx, hy, aim, 2);
      const reach = inFrame ? 0 : 7;
      const mx = hx + Math.cos(aim) * reach;
      const my = hy + Math.sin(aim) * reach;
      if (isAiming) {
        // Laser sight: a thin dim red line from the muzzle.
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 70, 50, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + Math.cos(aim) * 320, my + Math.sin(aim) * 320);
        ctx.stroke();
        ctx.restore();
      }
      if (this.recoilKick > 3) {
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(aim);
        ctx.fillStyle = 'rgba(255, 190, 90, 0.9)';
        ctx.beginPath();
        ctx.moveTo(0, -3);
        ctx.lineTo(9, 0);
        ctx.lineTo(0, 3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff2cf';
        ctx.beginPath();
        ctx.arc(1, 0, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      return;
    }
    // Bare fists: the swing frames are the punch.
    if (weapon.id === 'fists') return;
    drawMeleeWeapon(ctx, 'player', TD.weapons[weapon.id], weapon.id === 'stick' ? 4 : 3, sx, sy, pose, phase, aim);
  }
}

export class EnemyLooter {
  public x: number;
  public y: number;
  public vx: number = 0;
  public vy: number = 0;
  public radius: number = 13;
  public facingAngle: number = 0; // Smooth angular tracking
  public walkCycle: number = 0;
  public health: number = 4;
  public maxHealth: number = 4;
  public state: 'idle' | 'patrol' | 'alert' | 'chase' | 'windup' | 'attack' | 'recover' | 'dead' = 'patrol';

  private alertTimer: number = 0;
  private attackTimer: number = 0;
  private patrolTimer: number = 2.0;
  private patrolDir: number = 1;
  public hurtFlash: number = 0;
  public dead: boolean = false;
  // 0..1: how visible this enemy is to the player (line of sight), eased.
  public seen: number = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.facingAngle = Math.PI;
  }

  takeDamage(amount: number, fromAngle: number, audio: AudioManager, particles: ParticleSystem): boolean {
    if (this.dead) return false;
    this.health -= amount;
    this.hurtFlash = 0.15;

    this.vx += Math.cos(fromAngle) * (140 + amount * 30);
    this.vy += Math.sin(fromAngle) * (140 + amount * 30);

    particles.spawnBlood(this.x, this.y, fromAngle, 12);
    audio.enemyHurt();

    if (this.health <= 0) {
      this.dead = true;
      this.state = 'dead';
      audio.enemyDie();
      particles.spawnBlood(this.x, this.y, fromAngle, 20);
      return true;
    }

    if (this.state !== 'chase' && this.state !== 'windup' && this.state !== 'attack') {
      this.state = 'chase';
    }
    return false;
  }

  update(dt: number, player: Player, tilemap: Tilemap, particles: ParticleSystem, audio: AudioManager) {
    if (this.dead) return;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;

    const d = dist(this.x, this.y, player.x, player.y);
    const toPlayerAngle = Math.atan2(player.y - this.y, player.x - this.x);

    const isMoving = Math.hypot(this.vx, this.vy) > 10;
    if (isMoving) {
      this.walkCycle += dt * 14;
    }

    switch (this.state) {
      case 'patrol': {
        this.patrolTimer -= dt;
        if (this.patrolTimer <= 0) {
          this.patrolTimer = 2 + Math.random() * 2;
          this.patrolDir *= -1;
        }
        this.vx = this.patrolDir * 35;
        this.vy = 0;
        const targetPatrolAngle = this.patrolDir > 0 ? 0 : Math.PI;
        this.facingAngle = rotateAngle(this.facingAngle, targetPatrolAngle, dt * 5.0);

        if (d < 170) {
          const ray = tilemap.raycast(this.x, this.y, player.x, player.y);
          if (!ray.hit) {
            this.state = 'alert';
            this.alertTimer = 0.35;
            audio.enemyAlert();
          }
        }
        break;
      }

      case 'alert': {
        this.vx = 0;
        this.vy = 0;
        this.facingAngle = rotateAngle(this.facingAngle, toPlayerAngle, dt * 8.0);
        this.alertTimer -= dt;
        if (this.alertTimer <= 0) {
          this.state = 'chase';
        }
        break;
      }

      case 'chase': {
        this.facingAngle = rotateAngle(this.facingAngle, toPlayerAngle, dt * 6.5);
        const speed = 125;
        this.vx = lerp(this.vx, Math.cos(this.facingAngle) * speed, dt * 6);
        this.vy = lerp(this.vy, Math.sin(this.facingAngle) * speed, dt * 6);

        if (d < 38) {
          this.state = 'windup';
          this.attackTimer = 0.26;
          this.vx = 0;
          this.vy = 0;
        }
        break;
      }

      case 'windup': {
        this.facingAngle = rotateAngle(this.facingAngle, toPlayerAngle, dt * 8.0);
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) {
          this.state = 'attack';
          this.attackTimer = 0.18;
          this.vx = Math.cos(this.facingAngle) * 170;
          this.vy = Math.sin(this.facingAngle) * 170;
          audio.meleeSwing();
          particles.spawnSlash(this.x, this.y, this.facingAngle, 40, false);

          if (dist(this.x, this.y, player.x, player.y) < 46) {
            player.takeDamage(1, this.facingAngle, audio, particles);
          }
        }
        break;
      }

      case 'attack': {
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) {
          this.state = 'recover';
          this.attackTimer = 0.35;
        }
        break;
      }

      case 'recover': {
        this.vx = lerp(this.vx, 0, dt * 8);
        this.vy = lerp(this.vy, 0, dt * 8);
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) {
          this.state = 'chase';
        }
        break;
      }
    }

    // Integrate & collide
    this.x += this.vx * dt;
    const colX = tilemap.resolveCircleCollision(this.x, this.y, this.radius);
    this.x = colX.x;

    this.y += this.vy * dt;
    const colY = tilemap.resolveCircleCollision(this.x, this.y, this.radius);
    this.y = colY.y;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, screenW: number, screenH: number) {
    if (this.dead) return;
    const sx = this.x - (camX - screenW / 2);
    const sy = this.y - (camY - screenH / 2);
    const angle = this.facingAngle;
    const isMoving = Math.hypot(this.vx, this.vy) > 10;
    const phase: AttackPhase =
      this.state === 'windup' ? 'windup' : this.state === 'attack' ? 'active' : this.state === 'recover' ? 'recover' : 'idle';
    const pose = poseFor(angle, isMoving, this.walkCycle, phase);
    const { facing, col } = pose;

    ctx.save();
    drawShadow(ctx, sx, sy + FEET_OFFSET, 10);

    const behind = phase === 'idle' && facesAway(facing);
    const knife = () => drawMeleeWeapon(ctx, 'looter', TD.weapons.knife, 3, sx + shake, sy, pose, phase, angle);
    // Wind-up tell: the raised-knife frame shakes.
    const shake = this.state === 'windup' ? Math.round(Math.sin(this.attackTimer * 90)) : 0;
    if (behind) knife();
    if (!drawCharacter(ctx, TD.looter, sx + shake, sy, facing, col)) {
      ctx.fillStyle = '#6e4a3c';
      ctx.fillRect(sx - 6, sy - 18, 12, 30);
    }
    if (this.hurtFlash > 0) {
      drawCharacterFlash(ctx, TD.looter, sx + shake, sy, facing, col, Math.min(1, this.hurtFlash * 8));
    }
    if (!behind) knife();

    if (this.state === 'alert' || this.state === 'windup') {
      ctx.fillStyle = this.state === 'windup' ? '#ff5a3c' : '#ffcf6a';
      ctx.strokeStyle = '#1f1712';
      ctx.lineWidth = 2;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.strokeText('!', sx, sy - 26);
      ctx.fillText('!', sx, sy - 26);
    }

    if (this.health < this.maxHealth) {
      ctx.fillStyle = 'rgba(20, 12, 8, 0.7)';
      ctx.fillRect(sx - 10, sy - 24, 20, 3);
      ctx.fillStyle = '#d9533b';
      ctx.fillRect(sx - 10, sy - 24, (this.health / this.maxHealth) * 20, 3);
    }
    ctx.restore();
  }
}

export class SentryTurret {
  public x: number;
  public y: number;
  public radius: number = 14;
  public health: number = 6;
  public maxHealth: number = 6;
  public angle: number = 0;
  public dead: boolean = false;
  public hurtFlash: number = 0;

  private sweepAngleMin: number = -Math.PI * 0.4;
  private sweepAngleMax: number = Math.PI * 0.4;
  private sweepDir: number = 1;
  private fireCooldown: number = 0;
  public lockTimer: number = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  takeDamage(amount: number, fromAngle: number, audio: AudioManager, particles: ParticleSystem): boolean {
    if (this.dead) return false;
    this.health -= amount;
    this.hurtFlash = 0.15;
    particles.spawnSparks(this.x, this.y, fromAngle, 8);
    audio.meleeHit();

    if (this.health <= 0) {
      this.dead = true;
      audio.enemyDie();
      particles.spawnSparks(this.x, this.y, 0, 16);
      return true;
    }
    return false;
  }

  update(
    dt: number,
    player: Player,
    tilemap: Tilemap,
    enemyBullets: EnemyBullet[],
    audio: AudioManager,
    particles: ParticleSystem
  ) {
    if (this.dead) return;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.fireCooldown > 0) this.fireCooldown -= dt;

    const d = dist(this.x, this.y, player.x, player.y);
    const toPlayerAngle = Math.atan2(player.y - this.y, player.x - this.x);

    let playerSpotted = false;
    if (d < 240) {
      const ray = tilemap.raycast(this.x, this.y, player.x, player.y);
      if (!ray.hit) playerSpotted = true;
    }

    if (playerSpotted) {
      this.angle = rotateAngle(this.angle, toPlayerAngle, dt * 3.5);

      if (Math.abs(angleDist(this.angle, toPlayerAngle)) < 0.25) {
        this.lockTimer += dt;
        if (this.lockTimer > 0.4 && this.fireCooldown <= 0) {
          this.fireCooldown = 0.85;
          this.lockTimer = 0;

          const speed = 230;
          enemyBullets.push({
            x: this.x + Math.cos(this.angle) * 16,
            y: this.y + Math.sin(this.angle) * 16,
            vx: Math.cos(this.angle) * speed,
            vy: Math.sin(this.angle) * speed,
            radius: 4,
            life: 2.5,
            damage: 1,
          });

          audio.shoot(false);
          particles.spawnSparks(this.x, this.y, this.angle, 5);
        }
      }
    } else {
      this.angle += this.sweepDir * dt * 0.8;
      if (this.angle > this.sweepAngleMax) this.sweepDir = -1;
      if (this.angle < this.sweepAngleMin) this.sweepDir = 1;
      this.lockTimer = 0;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, screenW: number, screenH: number) {
    const sx = this.x - (camX - screenW / 2);
    const sy = this.y - (camY - screenH / 2);
    const feetY = sy + FEET_OFFSET;

    ctx.save();
    drawCastShadow(ctx, TD.props.turret, sx, feetY, Math.cos(this.angle) < 0, 0.5);

    if (this.dead) {
      // Wreck: the sprite charred dark and slumped.
      ctx.save();
      ctx.filter = 'brightness(0.35) sepia(0.4)';
      ctx.translate(sx, feetY);
      ctx.scale(1, 0.7);
      drawProp(ctx, TD.props.turret, 0, 0);
      ctx.restore();
      ctx.restore();
      return;
    }

    // Scanning laser from the gun head
    const headY = sy - 10;
    ctx.save();
    ctx.strokeStyle = this.lockTimer > 0 ? 'rgba(255, 60, 40, 0.75)' : 'rgba(255, 60, 40, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(this.angle) * 14, headY + Math.sin(this.angle) * 14);
    ctx.lineTo(sx + Math.cos(this.angle) * 240, headY + Math.sin(this.angle) * 240);
    ctx.stroke();
    ctx.restore();

    // The sprite faces right; mirror it to whichever side the guns point.
    const flip = Math.cos(this.angle) < 0;
    if (this.hurtFlash > 0) ctx.filter = 'brightness(2.2)';
    if (!drawProp(ctx, TD.props.turret, sx, feetY, flip)) {
      ctx.fillStyle = '#4a4038';
      ctx.fillRect(sx - 12, sy - 14, 24, 26);
    }
    ctx.filter = 'none';

    if (this.health < this.maxHealth) {
      ctx.fillStyle = 'rgba(20, 12, 8, 0.7)';
      ctx.fillRect(sx - 14, sy - 34, 28, 3);
      ctx.fillStyle = '#e08a3c';
      ctx.fillRect(sx - 14, sy - 34, (this.health / this.maxHealth) * 28, 3);
    }
    ctx.restore();
  }
}

// Column in Zhou's row 1 for each character-sheet facing row.
const ZHOU_DIR_COL: Record<number, number> = {
  [ROW.down]: 0, [ROW.downRight]: 1, [ROW.right]: 2, [ROW.upRight]: 3, [ROW.up]: 4,
};

export class NPCZhou {
  public x: number;
  public y: number;
  public radius: number = 14;
  public facingAngle: number = Math.PI / 2; // faces the camera until the player comes near
  private animTime: number = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  update(dt: number, playerX?: number, playerY?: number) {
    if (playerX !== undefined && playerY !== undefined) {
      const d = dist(this.x, this.y, playerX, playerY);
      if (d < 120) {
        const toPlayer = Math.atan2(playerY - this.y, playerX - this.x);
        this.facingAngle = rotateAngle(this.facingAngle, toPlayer, dt * 4.0);
      }
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    screenW: number,
    screenH: number,
    playerDist: number,
    showLabel = true
  ) {
    const sx = this.x - (camX - screenW / 2);
    const sy = this.y - (camY - screenH / 2);
    this.animTime += 1 / 60;

    ctx.save();
    drawShadow(ctx, sx, sy + FEET_OFFSET, 10);
    // Facing the camera he breathes, and waves when the player is close;
    // turned any other way he stands in that direction's pose (row 1).
    const facing = facingOf(this.facingAngle);
    const drawn = facing.row === ROW.down
      ? drawCharacter(ctx, TD.zhou, sx, sy, { row: 0, flip: false }, playerDist < 70 ? 2 : Math.floor(this.animTime * 1.5) % 2)
      : drawCharacter(ctx, TD.zhou, sx, sy, { row: 1, flip: facing.flip }, ZHOU_DIR_COL[facing.row]);
    if (!drawn) {
      ctx.fillStyle = '#6b5440';
      ctx.fillRect(sx - 6, sy - 16, 12, 28);
    }

    if (showLabel && playerDist < 90) {
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20, 12, 8, 0.85)';
      ctx.fillStyle = '#f2cf8a';
      ctx.strokeText('老周', sx, sy - 26);
      ctx.fillText('老周', sx, sy - 26);
      if (playerDist < 48) {
        ctx.fillStyle = '#fff4e0';
        ctx.strokeText('[E] 交談', sx, sy - 37);
        ctx.fillText('[E] 交談', sx, sy - 37);
      }
    }
    ctx.restore();
  }
}

export interface PickupItem {
  id: string;
  type: 'weapon' | 'adrenaline' | 'health';
  payload?: any;
  x: number;
  y: number;
  radius: number;
  name: string;
  collected: boolean;
}

export interface StoryTrigger {
  id: string;
  flag: string;
  rx: number;
  ry: number;
  rw: number;
  rh: number;
  prompt?: string;
  fired: boolean;
  onEnter: (game: any) => void;
}
