// Ultra-Refined 3D Geometric Articulated Entities
// Featuring high-detail procedural models, 360° decoupled limb movement,
// tactical gear, cloth scarf physics, slide blowback recoil, and dynamic lighting integration.

import { clamp, lerp, dist, angleDist, rotateAngle } from './math';
import { PLAYER_CONFIG, WEAPONS } from './constants';
import { WeaponDef } from './types';
import { Tilemap } from './tilemap';
import { ParticleSystem } from './particles';
import { AudioManager } from './audio';

export interface EnemyBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  damage: number;
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

  // --- ULTRA-REFINED COMMERCIAL 3/4 RENDERING PIPELINE ---
  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    screenW: number,
    screenH: number,
    isAiming: boolean
  ) {
    const sx = this.x - (camX - screenW / 2);
    const sy = this.y - (camY - screenH / 2);

    const aimAngle = this.facingAngle;
    const isMoving = Math.hypot(this.vx, this.vy) > 15;
    const isAimingUp = Math.sin(aimAngle) < -0.15; // Aiming upward/backwards

    ctx.save();

    // 1. Soft Dynamic Contact Drop Shadow at feet
    const shadowGrad = ctx.createRadialGradient(sx, sy + 13, 2, sx, sy + 13, 16);
    shadowGrad.addColorStop(0, 'rgba(4, 6, 12, 0.75)');
    shadowGrad.addColorStop(0.7, 'rgba(4, 6, 12, 0.4)');
    shadowGrad.addColorStop(1, 'rgba(4, 6, 12, 0)');
    ctx.fillStyle = shadowGrad;
    ctx.beginPath();
    ctx.ellipse(sx, sy + 13, 16, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Dash Ghost Trails with cyan trail glow
    for (const g of this.ghostTrails) {
      const gx = g.x - (camX - screenW / 2);
      const gy = g.y - (camY - screenH / 2);
      ctx.save();
      ctx.globalAlpha = g.alpha * 0.45;
      ctx.fillStyle = '#7fd4ff';
      ctx.beginPath();
      ctx.ellipse(gx, gy - 2, 8, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Invulnerability blink
    if (this.invulnTimer > 0 && Math.floor(this.invulnTimer * 16) % 2 === 0) {
      ctx.globalAlpha = 0.45;
    }

    // 4. Decoupled Legs (Walking Gait along moveAngle with knees & boot soles)
    const stride = isMoving ? Math.sin(this.walkCycle) * 5.5 : 0;
    const mCos = isMoving ? Math.cos(this.moveAngle) : 0;
    const mSin = isMoving ? Math.sin(this.moveAngle) : 0;

    // Left Foot & Knee
    const foot1X = sx - 4.5 + mCos * stride;
    const foot1Y = sy + 9 + mSin * stride;
    // Right Foot & Knee
    const foot2X = sx + 4.5 - mCos * stride;
    const foot2Y = sy + 9 - mSin * stride;

    // Tactical Pants (Dark navy reinforced cordura)
    ctx.fillStyle = '#1c263b';
    ctx.fillRect(foot1X - 2.5, foot1Y - 6, 5, 6);
    ctx.fillRect(foot2X - 2.5, foot2Y - 6, 5, 6);

    // Knee Protectors (Kevlar pads with rivet highlights)
    ctx.fillStyle = '#2d3d5e';
    ctx.fillRect(foot1X - 2, foot1Y - 4, 4, 3);
    ctx.fillRect(foot2X - 2, foot2Y - 4, 4, 3);
    ctx.fillStyle = '#7a8fb8';
    ctx.fillRect(foot1X - 1, foot1Y - 3, 1, 1);
    ctx.fillRect(foot2X - 1, foot2Y - 3, 1, 1);

    // Heavy Combat Boots (Tread sole + metal toe cap)
    ctx.fillStyle = '#0a0e17';
    ctx.beginPath();
    ctx.roundRect(foot1X - 3, foot1Y - 1, 6, 8, 2);
    ctx.roundRect(foot2X - 3, foot2Y - 1, 6, 8, 2);
    ctx.fill();
    ctx.fillStyle = '#3c4a63'; // Bootlaces & tread
    ctx.fillRect(foot1X - 2, foot1Y + 1, 4, 1.5);
    ctx.fillRect(foot2X - 2, foot2Y + 1, 4, 1.5);

    // 5. Z-SORTING: If aiming UP, draw weapon & arms BEHIND the torso!
    if (isAimingUp) {
      this.renderArmsAndWeapon(ctx, sx, sy, aimAngle, isAiming, true);
    }

    // 6. Torso & Heavy Ballistic Armor Vest
    ctx.save();
    const leanX = clamp(this.vx * 0.015, -2.5, 2.5);
    const breathe = Math.sin(this.globalTimer * 3.5) * 0.6;
    ctx.translate(sx + leanX, sy - 2 + breathe);

    // Undercoat (Survivor trench jacket in dark slate)
    ctx.fillStyle = '#1e293d';
    ctx.beginPath();
    ctx.roundRect(-7.5, -8.5, 15, 17, 4);
    ctx.fill();

    // Modular Plate Carrier (Front & Back Ballistic Armor Plate)
    ctx.fillStyle = '#121927';
    ctx.beginPath();
    ctx.roundRect(-6.5, -7, 13, 13, 3);
    ctx.fill();

    // Beveled armor plate highlight
    ctx.strokeStyle = '#2d3e5e';
    ctx.lineWidth = 1;
    ctx.strokeRect(-5.5, -6, 11, 11);

    // Tactical Molle Webbing & Ammo Mag Pouches
    ctx.fillStyle = '#30415e';
    ctx.fillRect(-5, -3, 3, 5);
    ctx.fillRect(-1, -3, 3, 5);
    ctx.fillRect(3, -3, 3, 5);
    // Pouch flap snaps
    ctx.fillStyle = '#7a8fb8';
    ctx.fillRect(-4, -2, 1, 1);
    ctx.fillRect(0, -2, 1, 1);
    ctx.fillRect(4, -2, 1, 1);

    // Heavy duty tactical utility belt with metal buckle
    ctx.fillStyle = '#382b20';
    ctx.fillRect(-6.5, 4.5, 13, 3);
    ctx.fillStyle = '#a6825c';
    ctx.fillRect(-1.5, 4, 3, 4);

    if (isAimingUp) {
      // Back of armor with hydration pack / comms harness
      ctx.fillStyle = '#1a2438';
      ctx.fillRect(-4, -5, 8, 8);
      ctx.fillStyle = '#3f527a';
      ctx.fillRect(-3, -4, 6, 2);
    } else {
      // Front survival collar zipper & radio mic
      ctx.fillStyle = '#7fd4ff';
      ctx.fillRect(-0.5, -7, 1, 5);
      ctx.fillStyle = '#111';
      ctx.fillRect(-5, -6, 2, 2.5);
    }

    // Dynamic Red Scarf flowing with momentum & wind
    const scarfDx = -Math.cos(this.moveAngle) * (isMoving ? 6 : 2) + Math.sin(this.scarfFlutter) * 2;
    const scarfDy = -Math.sin(this.moveAngle) * (isMoving ? 4 : 1) + Math.cos(this.scarfFlutter) * 1.5;

    ctx.fillStyle = '#b81d38';
    ctx.beginPath();
    ctx.roundRect(-4, -9, 8, 3, 1.5);
    ctx.fill();

    // Scarf tail flowing behind
    ctx.fillStyle = '#8f142a';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(scarfDx - 3, -7 + scarfDy);
    ctx.lineTo(scarfDx, -4 + scarfDy);
    ctx.lineTo(2, -7);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // 7. Head & Tactical Visor / Helmet in 360°
    ctx.save();
    const headX = sx + Math.cos(aimAngle) * 2;
    const headY = sy - 11.5 + breathe + Math.sin(aimAngle) * 1.5;
    ctx.translate(headX, headY);

    if (isAimingUp) {
      // Looking UP: draw high-tier Kevlar helmet back with comms antenna
      ctx.fillStyle = '#141d2e';
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
      ctx.fill();

      // Helmet rear rim & neck protection
      ctx.fillStyle = '#26344f';
      ctx.fillRect(-5, 1, 10, 4);

      // Comms antenna
      ctx.strokeStyle = '#6c7f9e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(4, -2);
      ctx.lineTo(6, -8);
      ctx.stroke();
    } else {
      // Looking DOWN / SIDEWAYS: face with tactical NVG goggles
      ctx.fillStyle = '#e8bb92';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();

      // Tactical helmet / dark hood
      ctx.fillStyle = '#141d2e';
      ctx.beginPath();
      ctx.arc(0, -2, 6.5, Math.PI * 0.9, Math.PI * 2.1);
      ctx.fill();

      // Tactical Night-Vision Visor / Goggles (Cyan glow)
      const gDx = clamp(Math.cos(aimAngle) * 2, -2.5, 2.5);
      const gDy = clamp(Math.sin(aimAngle) * 1.5, -1, 2);

      // Goggle frame
      ctx.fillStyle = '#0a0d14';
      ctx.beginPath();
      ctx.roundRect(-4 + gDx, -2.5 + gDy, 8, 3.5, 1);
      ctx.fill();

      // Cyan tinted lenses with reflection glow
      ctx.fillStyle = '#5ce1e6';
      ctx.fillRect(-3 + gDx, -2 + gDy, 2.5, 2);
      ctx.fillRect(0.5 + gDx, -2 + gDy, 2.5, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-2.5 + gDx, -2 + gDy, 1, 1);
      ctx.fillRect(1 + gDx, -2 + gDy, 1, 1);

      // Lower face bandana / respirator
      ctx.fillStyle = '#b81d38';
      ctx.beginPath();
      ctx.roundRect(-4 + gDx * 0.5, 1.5 + gDy * 0.5, 8, 4, 1.5);
      ctx.fill();
    }
    ctx.restore();

    // 8. Z-SORTING: If aiming DOWN / SIDEWAYS, draw weapon & arms IN FRONT OF torso!
    if (!isAimingUp) {
      this.renderArmsAndWeapon(ctx, sx, sy, aimAngle, isAiming, false);
    }

    ctx.restore();
  }

  // Draw 360° Ultra-Refined Rotating Arms, Hands, and Equipped Weapon
  private renderArmsAndWeapon(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    aimAngle: number,
    isAiming: boolean,
    isBehind: boolean
  ) {
    const weapon = this.currentWeapon;
    const isFlipped = Math.cos(aimAngle) < 0;

    // Shoulder anchor point with slight 3/4 offset
    const shoulderX = sx;
    const shoulderY = sy - 3;

    // Recoil pushback along opposite aim vector
    const recoilDist = this.recoilKick;
    const recoilX = -Math.cos(aimAngle) * recoilDist;
    const recoilY = -Math.sin(aimAngle) * recoilDist;

    ctx.save();
    ctx.translate(shoulderX + recoilX, shoulderY + recoilY);
    ctx.rotate(aimAngle);

    if (isFlipped) {
      ctx.scale(1, -1);
    }

    // Laser aim guide beam when Aiming Down Sights (Pinpoint Tactical Laser)
    if (isAiming && weapon.type === 'ranged') {
      ctx.save();
      // Laser beam with glowing core
      ctx.strokeStyle = 'rgba(127, 212, 255, 0.25)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(340, 0);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(340, 0);
      ctx.stroke();
      ctx.restore();
    }

    if (weapon.type === 'ranged') {
      // --- 360° ULTRA-REFINED RANGED WEAPON (9mm Tactical Pistol) ---
      // Tactical gloved hands
      ctx.fillStyle = '#1c263b';
      ctx.beginPath();
      ctx.arc(8, 2, 3, 0, Math.PI * 2);
      ctx.arc(12, 2, 3, 0, Math.PI * 2);
      ctx.fill();

      // Gun Frame & Ergonomic Grip
      ctx.fillStyle = '#161c26';
      ctx.fillRect(7, 0, 5, 6);
      ctx.fillStyle = '#263245'; // Grip stippling
      ctx.fillRect(8, 2, 3, 3);

      // Slide (Brushed Gunmetal Titanium finish)
      const slideRecoil = this.recoilKick > 2 ? 3 : 0;
      ctx.fillStyle = '#4f5d75';
      ctx.fillRect(8 - slideRecoil, -2, 14, 4);

      // Slide serrations & ejection port
      ctx.fillStyle = '#2d3748';
      ctx.fillRect(9 - slideRecoil, -1.5, 3, 3);
      ctx.fillStyle = '#111';
      ctx.fillRect(14 - slideRecoil, -2, 3, 2); // Ejection chamber

      // Barrel & Muzzle Crown
      ctx.fillStyle = '#222938';
      ctx.fillRect(17, -1.5, 6, 3);
      // Front Iron Sight
      ctx.fillStyle = '#7fd4ff';
      ctx.fillRect(21, -3, 1.5, 1.5);

      // Muzzle Starburst Flash on high recoil kick
      if (this.recoilKick > 3) {
        ctx.save();
        ctx.translate(24, 0);
        // Outer orange/yellow flare
        ctx.fillStyle = '#ffe082';
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        // Inner white-hot core
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(1, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
        // Star spikes
        ctx.strokeStyle = '#ffe89c';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-2, -8);
        ctx.lineTo(4, 8);
        ctx.moveTo(-2, 8);
        ctx.lineTo(4, -8);
        ctx.stroke();
        ctx.restore();
      }
    } else {
      // --- 360° ULTRA-REFINED MELEE WEAPONS ---
      let swingAngleOffset = 0;
      if (this.attackPhase === 'windup') swingAngleOffset = -0.75;
      if (this.attackPhase === 'active') swingAngleOffset = 0.95;
      if (this.attackPhase === 'recover') swingAngleOffset = 0.3;

      ctx.save();
      ctx.rotate(swingAngleOffset);

      // Gloved hands
      ctx.fillStyle = '#1c263b';
      ctx.beginPath();
      ctx.arc(8, 2, 3, 0, Math.PI * 2);
      ctx.fill();

      if (weapon.id === 'stick') {
        // Heavy reinforced lead/steel pipe with tape grip & rust stains
        ctx.fillStyle = '#4d3725'; // Rusted pipe core
        ctx.fillRect(8, -2, 26, 4.5);
        ctx.fillStyle = '#7a5e45';
        ctx.fillRect(24, -3, 10, 6.5); // Weighted head
        // Metal coupling bolt
        ctx.fillStyle = '#9e8467';
        ctx.fillRect(28, -3.5, 3, 7.5);
        // Grip cloth wrap
        ctx.fillStyle = '#e8dcc8';
        ctx.fillRect(8, -1.5, 8, 3.5);
      } else if (weapon.id === 'knife') {
        // Tactical Combat Knife (Black G10 handle, tanto blade, blood groove)
        ctx.fillStyle = '#111';
        ctx.fillRect(7, -0.5, 5, 4);
        // Steel Blade with cold metallic edge
        ctx.fillStyle = '#8ea8c3';
        ctx.beginPath();
        ctx.moveTo(12, 1);
        ctx.lineTo(26, -1.5);
        ctx.lineTo(24, 4.5);
        ctx.closePath();
        ctx.fill();
        // Sharpened bevel highlight
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(26, -1.5);
        ctx.lineTo(22, 2);
        ctx.closePath();
        ctx.fill();
      } else {
        // Fists: Reinforced Boxing Wrap Gloves
        ctx.fillStyle = '#1c263b';
        ctx.beginPath();
        ctx.arc(12, 1, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b81d38'; // Red knuckle wrap
        ctx.fillRect(10, -1, 3, 4);
      }

      ctx.restore();
    }

    ctx.restore();
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
    const isAimingUp = Math.sin(angle) < -0.15;
    const isMoving = Math.hypot(this.vx, this.vy) > 10;

    ctx.save();

    // 1. Soft Contact Drop Shadow
    const shadowGrad = ctx.createRadialGradient(sx, sy + 13, 2, sx, sy + 13, 16);
    shadowGrad.addColorStop(0, 'rgba(4, 6, 12, 0.75)');
    shadowGrad.addColorStop(1, 'rgba(4, 6, 12, 0)');
    ctx.fillStyle = shadowGrad;
    ctx.beginPath();
    ctx.ellipse(sx, sy + 13, 15, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Alert "!" badge
    if (this.state === 'alert') {
      ctx.fillStyle = '#ffd24d';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('!', sx, sy - 24);
    }

    // 3. Decoupled Legs (Tattered pants + spiked boots)
    const stride = isMoving ? Math.sin(this.walkCycle) * 5 : 0;
    const foot1X = sx - 4 + Math.cos(angle) * stride;
    const foot1Y = sy + 9 + Math.sin(angle) * stride;
    const foot2X = sx + 4 - Math.cos(angle) * stride;
    const foot2Y = sy + 9 - Math.sin(angle) * stride;

    ctx.fillStyle = '#261b1d';
    ctx.fillRect(foot1X - 2.5, foot1Y - 1, 5, 7);
    ctx.fillRect(foot2X - 2.5, foot2Y - 1, 5, 7);

    // 4. Machete Arm (drawn behind if facing up)
    if (isAimingUp) {
      this.renderMachete(ctx, sx, sy, angle);
    }

    // 5. Torso / Spiked Pauldron Body
    ctx.save();
    ctx.translate(sx, sy - 2);

    // Hurt flash white
    if (this.hurtFlash > 0) {
      ctx.fillStyle = '#ffffff';
    } else {
      ctx.fillStyle = '#54151e'; // Blood burgundy scavenger jacket
    }
    ctx.beginPath();
    ctx.roundRect(-7, -8, 14, 16, 4);
    ctx.fill();

    // Metal scrap chestplate with spikes
    ctx.fillStyle = '#360c13';
    ctx.beginPath();
    ctx.roundRect(-6, -6, 12, 12, 3);
    ctx.fill();

    // Metal Spiked Pauldron on right shoulder
    ctx.fillStyle = '#7a8599';
    ctx.beginPath();
    ctx.arc(5, -6, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d4dbe8';
    ctx.fillRect(6, -9, 2, 3); // Spike
    ctx.restore();

    // 6. Head & Red Gas Mask with Breathing Filter (360° rotation)
    ctx.save();
    ctx.translate(sx + Math.cos(angle) * 2, sy - 11.5 + Math.sin(angle) * 1.5);

    if (isAimingUp) {
      ctx.fillStyle = '#260c10';
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#cf9174';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();

      // Gas Mask / Red Menacing Scavenger Mask
      ctx.fillStyle = '#b81d33';
      ctx.fillRect(-5, 0, 10, 6);

      // Dual breathing filter canisters
      ctx.fillStyle = '#111';
      ctx.fillRect(-4, 4, 3, 3);
      ctx.fillRect(1, 4, 3, 3);

      // Glowing Sinister Red Eyes
      const eyeDx = clamp(Math.cos(angle) * 2, -2, 2);
      ctx.fillStyle = '#ff2b48';
      ctx.fillRect(-3 + eyeDx, -2, 2.5, 2);
      ctx.fillRect(0.5 + eyeDx, -2, 2.5, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-2 + eyeDx, -1.5, 1, 1);
      ctx.fillRect(1.5 + eyeDx, -1.5, 1, 1);
    }
    ctx.restore();

    // 7. Machete Arm (drawn in front if facing down/side)
    if (!isAimingUp) {
      this.renderMachete(ctx, sx, sy, angle);
    }

    // 8. Health bar
    if (this.health < this.maxHealth) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(sx - 12, sy - 22, 24, 3);
      ctx.fillStyle = '#ff4d6d';
      ctx.fillRect(sx - 12, sy - 22, (this.health / this.maxHealth) * 24, 3);
    }

    ctx.restore();
  }

  private renderMachete(ctx: CanvasRenderingContext2D, sx: number, sy: number, angle: number) {
    ctx.save();
    ctx.translate(sx, sy - 3);
    ctx.rotate(angle);

    let swingOffset = 0;
    if (this.state === 'windup') swingOffset = -0.85;
    if (this.state === 'attack') swingOffset = 1.05;
    if (this.state === 'recover') swingOffset = 0.3;

    ctx.rotate(swingOffset);

    // Hand
    ctx.fillStyle = '#cf9174';
    ctx.beginPath();
    ctx.arc(8, 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // Heavy Serrated Scavenger Machete (Sawtooth back & blood stains)
    ctx.fillStyle = '#111';
    ctx.fillRect(7, 0, 4, 3.5); // Handle
    ctx.fillStyle = '#7d92ab';
    ctx.beginPath();
    ctx.moveTo(11, 1);
    ctx.lineTo(27, -2);
    ctx.lineTo(25, 5);
    ctx.closePath();
    ctx.fill();

    // Serrated sawteeth on blade back
    ctx.fillStyle = '#3d4a5c';
    ctx.fillRect(15, -2, 2, 2);
    ctx.fillRect(19, -2.5, 2, 2);

    // Blood stains on tip
    ctx.fillStyle = '#b31e33';
    ctx.fillRect(23, -1, 3, 4);

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
  private lockTimer: number = 0;

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

    ctx.save();
    // 3/4 Base elevation & shadow
    ctx.fillStyle = 'rgba(4, 6, 12, 0.7)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 14, 18, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Heavy Hexagonal Cast-Iron Turret Pedestal
    ctx.fillStyle = '#1c2436';
    ctx.beginPath();
    ctx.roundRect(sx - 13, sy - 3, 26, 17, 4);
    ctx.fill();
    ctx.strokeStyle = '#3e4f73';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Hydraulic Stabilizer Struts
    ctx.fillStyle = '#55698f';
    ctx.fillRect(sx - 15, sy + 6, 4, 8);
    ctx.fillRect(sx + 11, sy + 6, 4, 8);

    if (this.dead) {
      // Smoldering destroyed chassis
      ctx.fillStyle = '#10141c';
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Rotating 360° Head
    ctx.save();
    ctx.translate(sx, sy - 3);
    ctx.rotate(this.angle);

    // Scanning Red Laser Guide Beam
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 40, 60, 0.65)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(240, 0);
    ctx.stroke();
    ctx.restore();

    // Twin Machine Gun Barrels with Perforated Cooling Shroud
    ctx.fillStyle = this.hurtFlash > 0 ? '#ffffff' : '#4d5d7d';
    ctx.fillRect(8, -5, 14, 3.5);
    ctx.fillRect(8, 1.5, 14, 3.5);

    // Muzzle crowns
    ctx.fillStyle = '#1c2436';
    ctx.fillRect(20, -5.5, 3, 4.5);
    ctx.fillRect(20, 1, 3, 4.5);

    // Armor Dome
    ctx.fillStyle = this.hurtFlash > 0 ? '#ffffff' : '#2b3952';
    ctx.beginPath();
    ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
    ctx.fill();

    // High-tech red targeting optic lens
    ctx.fillStyle = '#ff2b44';
    ctx.beginPath();
    ctx.arc(4, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4.5, -1, 1, 1);

    ctx.restore();
    ctx.restore();

    // Health bar
    if (this.health < this.maxHealth && !this.dead) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(sx - 14, sy - 24, 28, 3);
      ctx.fillStyle = '#ff8833';
      ctx.fillRect(sx - 14, sy - 24, (this.health / this.maxHealth) * 28, 3);
    }
  }
}

export class NPCZhou {
  public x: number;
  public y: number;
  public radius: number = 14;
  public facingAngle: number = 0; // Smoothly tracks player

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

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, screenW: number, screenH: number, playerDist: number) {
    const sx = this.x - (camX - screenW / 2);
    const sy = this.y - (camY - screenH / 2);

    ctx.save();
    // Warm campfire light
    const grad = ctx.createRadialGradient(sx, sy, 10, sx, sy, 95);
    grad.addColorStop(0, 'rgba(255, 170, 70, 0.25)');
    grad.addColorStop(0.7, 'rgba(255, 140, 40, 0.08)');
    grad.addColorStop(1, 'rgba(255, 170, 70, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, 95, 0, Math.PI * 2);
    ctx.fill();

    // Contact drop shadow
    ctx.fillStyle = 'rgba(4, 6, 12, 0.7)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 14, 15, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Seated survivor torso (Weathered bomber jacket with shearling fur collar)
    ctx.save();
    ctx.translate(sx, sy - 2);
    ctx.fillStyle = '#453526';
    ctx.beginPath();
    ctx.roundRect(-7.5, -8.5, 15, 17, 4);
    ctx.fill();

    // Shearling fleece fur collar
    ctx.fillStyle = '#9e8974';
    ctx.beginPath();
    ctx.roundRect(-8, -9, 16, 4, 2);
    ctx.fill();

    // Work cargo trousers
    ctx.fillStyle = '#261f18';
    ctx.fillRect(-6, 7, 12, 5);
    ctx.restore();

    // Head smoothly turns toward player
    ctx.save();
    ctx.translate(sx + Math.cos(this.facingAngle) * 2, sy - 11.5 + Math.sin(this.facingAngle) * 1.5);
    ctx.fillStyle = '#e8bb92';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();

    // Grey survivor hair & beard with warm campfire side-lighting
    ctx.fillStyle = '#9c9ea6';
    ctx.beginPath();
    ctx.arc(0, -2, 6.2, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
    ctx.fillRect(-3, 2, 6, 3.5);

    // Warm amber ember highlight on face
    ctx.fillStyle = 'rgba(255, 180, 80, 0.4)';
    ctx.fillRect(0, -1, 3, 3);
    ctx.restore();

    // Name & prompt
    ctx.fillStyle = '#ffe082';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('老周', sx, sy - 23);

    if (playerDist < 48) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.fillText('[E] 交談', sx, sy - 35);
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
