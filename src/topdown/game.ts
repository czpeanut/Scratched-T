// Top-Down Action Shooter Game Engine & Loop Coordinator

import { VIEW, COLORS, WEAPONS, TILE } from './constants';
import { GameState, DialogueScript, CutsceneStep, WeaponDef } from './types';
import { AudioManager } from './audio';
import { InputManager } from './input';
import { Camera } from './camera';
import { ParticleSystem } from './particles';
import { Reticle } from './reticle';
import { StoryManager } from './story';
import { LevelData, buildTopDownOpening } from './level';
import { Player, EnemyBullet, PickupItem, StoryTrigger } from './entities';
import { TD, FEET_OFFSET, TITLE_LAYERS, drawProp } from './art';
import { dist, clamp, angleDist } from './math';
import { wakeUpScript, getZhouScript, findAdrenalineScript } from './dialogues';

// Old Zhou's oil-drum fire, the one fixed light in the level.
const CAMPFIRE = { x: 52 * TILE + 16, y: 9 * TILE + 16 };

export class GameEngine {
  public ctx: CanvasRenderingContext2D;
  public canvas: HTMLCanvasElement;
  public audio: AudioManager;
  public input: InputManager;
  public camera: Camera;
  public particles: ParticleSystem;
  public reticle: Reticle;
  public story: StoryManager;

  public state: GameState = 'title';
  public level: LevelData;
  public enemyBullets: EnemyBullet[] = [];

  // Hitstop freeze frame
  public hitstopTimer: number = 0;

  // Screen flash
  public flashTimer: number = 0;
  public flashColor: string = 'rgba(255, 255, 255, 0.4)';

  // HUD Message
  public hudMessage: string | null = null;
  public hudMessageTimer: number = 0;

  // Active Dialogue State
  public activeDialogue: {
    script: DialogueScript;
    nodeKey: string;
    lineIdx: number;
    charIdx: number;
    typingTimer: number;
    doneTyping: boolean;
  } | null = null;

  // Cutscene State
  public activeCutscene: {
    steps: CutsceneStep[];
    currentStepIdx: number;
    timer: number;
    fadeAlpha: number;
    fadeDirection: 'in' | 'out' | null;
    onComplete?: () => void;
  } | null = null;

  // Dynamic Lighting System
  private lightCanvas: HTMLCanvasElement;
  private lightCtx: CanvasRenderingContext2D;
  public muzzleFlashTimer: number = 0;
  public muzzleFlashPos: { x: number; y: number } = { x: 0, y: 0 };
  private dustMotes: { x: number; y: number; vx: number; vy: number; size: number; alpha: number }[] = [];

  // Loop
  private lastTime: number = 0;
  private running: boolean = false;
  private animId: number = 0;
  public globalTime: number = 0;

  // React state listeners
  public onStateChange?: (state: GameState) => void;
  public onHudUpdate?: (data: {
    hp: number;
    maxHp: number;
    stamina: number;
    weapon: WeaponDef;
    unlockedWeapons: string[];
    isAiming: boolean;
    aimProgress: number;
  }) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not create 2D canvas context');
    this.ctx = ctx;

    canvas.width = VIEW.width;
    canvas.height = VIEW.height;
    ctx.imageSmoothingEnabled = false;

    // Offscreen lighting canvas for real-time dynamic light cones & occlusion
    this.lightCanvas = document.createElement('canvas');
    this.lightCanvas.width = VIEW.width;
    this.lightCanvas.height = VIEW.height;
    const lCtx = this.lightCanvas.getContext('2d');
    if (!lCtx) throw new Error('Could not create 2D lighting canvas context');
    this.lightCtx = lCtx;

    // Atmospheric airborne dust motes catching flashlight beams
    for (let i = 0; i < 35; i++) {
      this.dustMotes.push({
        x: Math.random() * VIEW.width,
        y: Math.random() * VIEW.height,
        vx: 3 + Math.random() * 6,
        vy: 4 + Math.random() * 6,
        size: 1 + Math.random() * 1.5,
        alpha: 0.15 + Math.random() * 0.35,
      });
    }

    this.audio = new AudioManager();
    this.input = new InputManager();
    this.input.attachCanvas(canvas, VIEW.width, VIEW.height);

    this.camera = new Camera();
    this.particles = new ParticleSystem();
    this.reticle = new Reticle();
    this.story = new StoryManager();

    this.level = buildTopDownOpening();
    this.camera.setBounds(0, 0, this.level.tilemap.widthPx, this.level.tilemap.heightPx);

    // Initial camera placement on player
    this.camera.x = this.level.player.x;
    this.camera.y = this.level.player.y;
  }

  get player(): Player {
    return this.level.player;
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    this.animId = requestAnimationFrame(this.loop.bind(this));
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.animId);
  }

  startGamePlay() {
    this.audio.unlock();
    this.state = 'cutscene';
    this.notifyState();

    // Opening cinematic wake up cutscene
    this.openCutscene(
      [
        { type: 'fadeIn', seconds: 1.8 },
        { type: 'wait', seconds: 0.3 },
        { type: 'dialogue', script: wakeUpScript },
      ],
      () => {
        this.state = 'playing';
        this.notifyState();
        this.showMessage('WASD 移動  ·  左鍵近戰/攻擊  ·  右鍵(U)瞄準縮小準星', 4.5);
      }
    );
  }

  restartLevel() {
    this.level = buildTopDownOpening();
    this.camera.setBounds(0, 0, this.level.tilemap.widthPx, this.level.tilemap.heightPx);
    this.camera.x = this.level.player.x;
    this.camera.y = this.level.player.y;
    this.particles = new ParticleSystem();
    this.enemyBullets = [];
    this.state = 'playing';
    this.notifyState();
    this.showMessage('已重新開始第一章：甦醒', 2.0);
  }

  showMessage(msg: string, duration: number = 2.5) {
    this.hudMessage = msg;
    this.hudMessageTimer = duration;
  }

  notifyState() {
    this.onStateChange?.(this.state);
  }

  openDialogue(script: DialogueScript) {
    this.state = 'dialogue';
    this.notifyState();
    this.activeDialogue = {
      script,
      nodeKey: script.start,
      lineIdx: 0,
      charIdx: 0,
      typingTimer: 0,
      doneTyping: false,
    };
    this.audio.dialogueBeep();
  }

  openCutscene(steps: CutsceneStep[], onComplete?: () => void) {
    this.state = 'cutscene';
    this.notifyState();
    this.activeCutscene = {
      steps,
      currentStepIdx: 0,
      timer: 0,
      fadeAlpha: 0,
      fadeDirection: null,
      onComplete,
    };
    this.processCutsceneStep();
  }

  private processCutsceneStep() {
    if (!this.activeCutscene) return;
    const step = this.activeCutscene.steps[this.activeCutscene.currentStepIdx];
    if (!step) {
      const onComp = this.activeCutscene.onComplete;
      this.activeCutscene = null;
      if (onComp) onComp();
      else {
        this.state = 'playing';
        this.notifyState();
      }
      return;
    }

    if (step.type === 'fadeIn') {
      this.activeCutscene.fadeAlpha = 1.0;
      this.activeCutscene.fadeDirection = 'in';
      this.activeCutscene.timer = step.seconds ?? 1.5;
    } else if (step.type === 'fadeOut') {
      this.activeCutscene.fadeAlpha = 0.0;
      this.activeCutscene.fadeDirection = 'out';
      this.activeCutscene.timer = step.seconds ?? 1.5;
    } else if (step.type === 'wait') {
      this.activeCutscene.timer = step.seconds ?? 0.5;
    } else if (step.type === 'dialogue') {
      const scr = typeof step.script === 'function' ? step.script() : step.script;
      if (scr) this.openDialogue(scr);
    }
  }

  private loop(now: number) {
    if (!this.running) return;

    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Clamp delta to prevent huge jumps on tab switch
    dt = Math.min(dt, 0.08);

    this.globalTime += dt;
    this.update(dt);
    this.render();

    this.animId = requestAnimationFrame(this.loop.bind(this));
  }

  update(dt: number) {
    this.input.poll();

    // Global hotkeys
    if (this.input.isPressed('mute')) {
      const muted = this.audio.toggleMute();
      this.showMessage(muted ? '音效已關閉' : '音效已開啟', 1.5);
    }

    if (this.input.isPressed('pause')) {
      if (this.state === 'playing') {
        this.state = 'paused';
        this.notifyState();
      } else if (this.state === 'paused') {
        this.state = 'playing';
        this.notifyState();
      }
    }

    if (this.input.isPressed('restart') && (this.state === 'dead' || this.state === 'paused' || this.state === 'playing')) {
      this.restartLevel();
      return;
    }

    // Hitstop freeze frame
    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      return;
    }

    if (this.flashTimer > 0) this.flashTimer -= dt;
    if (this.hudMessageTimer > 0) this.hudMessageTimer -= dt;
    if (this.muzzleFlashTimer > 0) this.muzzleFlashTimer -= dt;

    // Update ambient dust motes
    for (const m of this.dustMotes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.x < 0) m.x += VIEW.width;
      if (m.x > VIEW.width) m.x -= VIEW.width;
      if (m.y < 0) m.y += VIEW.height;
      if (m.y > VIEW.height) m.y -= VIEW.height;
    }

    // Handle Cutscene
    if (this.state === 'cutscene' && this.activeCutscene) {
      const step = this.activeCutscene.steps[this.activeCutscene.currentStepIdx];
      if (step) {
        if (this.activeCutscene.fadeDirection === 'in') {
          this.activeCutscene.fadeAlpha = Math.max(0, this.activeCutscene.fadeAlpha - dt / (step.seconds ?? 1.5));
          if (this.activeCutscene.fadeAlpha <= 0) {
            this.activeCutscene.fadeDirection = null;
            this.activeCutscene.currentStepIdx++;
            this.processCutsceneStep();
          }
        } else if (this.activeCutscene.fadeDirection === 'out') {
          this.activeCutscene.fadeAlpha = Math.min(1.0, this.activeCutscene.fadeAlpha + dt / (step.seconds ?? 1.5));
          if (this.activeCutscene.fadeAlpha >= 1.0) {
            this.activeCutscene.fadeDirection = null;
            this.activeCutscene.currentStepIdx++;
            this.processCutsceneStep();
          }
        } else if (step.type === 'wait') {
          this.activeCutscene.timer -= dt;
          if (this.activeCutscene.timer <= 0) {
            this.activeCutscene.currentStepIdx++;
            this.processCutsceneStep();
          }
        }
      }
      return;
    }

    // Handle Dialogue
    if (this.state === 'dialogue' && this.activeDialogue) {
      this.updateDialogue(dt);
      return;
    }

    if (this.state !== 'playing') return;

    // --- Playing State Updates ---
    const player = this.level.player;

    // 1. Weapon selection
    if (this.input.isPressed('slot1')) player.equipWeapon('fists');
    if (this.input.isPressed('slot2')) player.equipWeapon('stick');
    if (this.input.isPressed('slot3')) player.equipWeapon('knife');
    if (this.input.isPressed('slot4')) player.equipWeapon('pistol');
    if (this.input.isPressed('swap')) player.cycleWeapon(1);

    // 2. Aim & Reticle updates
    const isAimingInput = this.input.isDown('aim');
    const isMoving = Math.hypot(player.vx, player.vy) > 20;

    this.reticle.update(dt, isAimingInput, isMoving, player.currentWeapon, () => {
      this.audio.aimLock();
    });

    // 3. Pointer coords in world space
    const mouseWorld = this.camera.screenToWorld(this.input.mouseViewX, this.input.mouseViewY);

    // 4. Dash / Roll action
    if (this.input.isPressed('dash')) {
      player.tryDash(this.story.canSprint(), this.audio, this.particles);
    }

    // 5. Update Player
    const isSprinting = this.input.isDown('sprint');
    player.update(
      dt,
      this.input.moveX,
      this.input.moveY,
      mouseWorld.x,
      mouseWorld.y,
      isSprinting,
      this.story.canSprint(),
      this.reticle.isAimed,
      this.level.tilemap,
      this.particles,
      this.audio
    );

    // 6. Combat: Attacks
    if (this.input.isPressed('fire')) {
      this.handlePlayerAttack(mouseWorld.x, mouseWorld.y);
    }

    // Resolve Melee active hit
    if (player.attackPhase === 'active' && !player.attackHitDone) {
      this.resolveMeleeHit();
    }

    this.updateVisibility(dt);

    // 7. Update Camera
    this.camera.update(dt, player.x, player.y, player.facingAngle, this.reticle.isAimed);

    // 8. Update Enemies
    for (const enemy of this.level.enemies) {
      enemy.update(dt, player, this.level.tilemap, this.particles, this.audio);
    }

    // 9. Update Turrets
    for (const turret of this.level.turrets) {
      turret.update(dt, player, this.level.tilemap, this.enemyBullets, this.audio, this.particles);
    }

    // 10. Update Enemy Bullets
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Check wall collision
      const tx = Math.floor(b.x / 32);
      const ty = Math.floor(b.y / 32);
      if (this.level.tilemap.isSolid(tx, ty) || b.life <= 0) {
        this.particles.spawnSparks(b.x, b.y, Math.atan2(b.vy, b.vx), 4);
        this.enemyBullets.splice(i, 1);
        continue;
      }

      // Check player collision
      if (dist(b.x, b.y, player.x, player.y) < b.radius + player.radius) {
        player.takeDamage(b.damage, Math.atan2(b.vy, b.vx), this.audio, this.particles);
        this.particles.spawnBlood(player.x, player.y, Math.atan2(b.vy, b.vx), 6);
        this.enemyBullets.splice(i, 1);
      }
    }

    // 11. Pickups interaction
    for (const pickup of this.level.pickups) {
      if (pickup.collected) continue;
      if (dist(player.x, player.y, pickup.x, pickup.y) < pickup.radius + player.radius + 8) {
        pickup.collected = true;
        this.audio.pickup();

        if (pickup.type === 'weapon' && pickup.payload) {
          player.unlockWeapon(pickup.payload);
          player.equipWeapon(pickup.payload);
          this.showMessage(`獲得武器：${pickup.name}`, 3.0);
        } else if (pickup.type === 'adrenaline') {
          this.story.grantAbility('sprint');
          this.openDialogue(findAdrenalineScript);
        }
      }
    }

    // 12. NPC Zhou interaction & tracking
    this.level.npcZhou.update(dt, player.x, player.y);
    const zhouDist = dist(player.x, player.y, this.level.npcZhou.x, this.level.npcZhou.y);
    if (zhouDist < 48 && this.input.isPressed('interact')) {
      const script = getZhouScript(this);
      this.openDialogue(script);
    }

    // 13. Story triggers
    for (const trig of this.level.triggers) {
      if (trig.fired || this.story.hasFlag(trig.flag)) continue;

      if (
        player.x >= trig.rx &&
        player.x <= trig.rx + trig.rw &&
        player.y >= trig.ry &&
        player.y <= trig.ry + trig.rh
      ) {
        if (trig.prompt && !this.input.isPressed('interact')) {
          // Requires prompt press
        } else {
          trig.fired = true;
          this.story.setFlag(trig.flag);
          trig.onEnter(this);
        }
      }
    }

    // 14. Update Particles
    this.particles.update(dt);

    // 15. Check Player Death
    if (player.health <= 0 && this.state === 'playing') {
      this.state = 'dead';
      this.notifyState();
      this.audio.playerDie();
      this.particles.spawnBlood(player.x, player.y, 0, 24);
      this.camera.addTrauma(0.5);
    }

    // 16. Notify React HUD
    this.onHudUpdate?.({
      hp: player.health,
      maxHp: player.maxHealth,
      stamina: player.stamina,
      weapon: player.currentWeapon,
      unlockedWeapons: player.unlockedWeapons,
      isAiming: this.reticle.isAimed,
      aimProgress: this.reticle.aimProgress,
    });
  }

  private handlePlayerAttack(targetX: number, targetY: number) {
    const player = this.player;
    const weapon = player.currentWeapon;

    if (weapon.type === 'melee') {
      player.startMeleeAttack();
      return;
    }

    // Ranged (Pistol)
    if (player.attackCooldown > 0) return;
    player.attackCooldown = weapon.fireRate ?? 0.3;

    // Recoil kick & bloom
    this.reticle.addBloom(weapon.bloom ?? 0.24);
    this.camera.addTrauma(weapon.trauma ?? 0.3);

    const baseAngle = Math.atan2(targetY - player.y, targetX - player.x);
    // Draw shot angle uniformly from current spread cone
    const spreadAngle = (Math.random() - 0.5) * 2 * this.reticle.currentSpread;
    const shotAngle = baseAngle + spreadAngle;

    // Recoil push player back slightly & kick gun back
    player.vx -= Math.cos(shotAngle) * (weapon.recoil ?? 80);
    player.vy -= Math.sin(shotAngle) * (weapon.recoil ?? 80);
    player.recoilKick = 8;

    // Muzzle position
    const { x: muzzleX, y: muzzleY } = player.muzzlePoint(shotAngle);

    // Raycast shot line out to range
    const maxRange = this.reticle.isAimed ? (weapon.range * 1.25) : weapon.range;
    const endX = muzzleX + Math.cos(shotAngle) * maxRange;
    const endY = muzzleY + Math.sin(shotAngle) * maxRange;

    const tileRay = this.level.tilemap.raycast(muzzleX, muzzleY, endX, endY);
    let hitX = tileRay.hit ? tileRay.x : endX;
    let hitY = tileRay.hit ? tileRay.y : endY;
    let hitDist = tileRay.hit ? tileRay.dist : maxRange;

    let hitTarget: { enemy?: any; turret?: any } | null = null;

    // Test enemy intersection along ray
    for (const enemy of this.level.enemies) {
      if (enemy.dead) continue;
      const d = dist(muzzleX, muzzleY, enemy.x, enemy.y);
      if (d > hitDist) continue;

      const angleToEnemy = Math.atan2(enemy.y - muzzleY, enemy.x - muzzleX);
      const angleDiff = Math.abs(angleDist(shotAngle, angleToEnemy));
      const crossDist = Math.sin(angleDiff) * d;

      if (crossDist <= enemy.radius && Math.cos(angleDiff) > 0) {
        hitDist = d;
        hitX = enemy.x;
        hitY = enemy.y;
        hitTarget = { enemy };
      }
    }

    // Test turret intersection
    for (const turret of this.level.turrets) {
      if (turret.dead) continue;
      const d = dist(muzzleX, muzzleY, turret.x, turret.y);
      if (d > hitDist) continue;

      const angleToTurret = Math.atan2(turret.y - muzzleY, turret.x - muzzleX);
      const angleDiff = Math.abs(angleDist(shotAngle, angleToTurret));
      const crossDist = Math.sin(angleDiff) * d;

      if (crossDist <= turret.radius && Math.cos(angleDiff) > 0) {
        hitDist = d;
        hitX = turret.x;
        hitY = turret.y;
        hitTarget = { turret };
      }
    }

    // Apply hit damage
    if (hitTarget?.enemy) {
      const isCritical = this.reticle.aimProgress > 0.9;
      const dmg = isCritical ? (weapon.damage + 2) : weapon.damage;
      hitTarget.enemy.takeDamage(dmg, shotAngle, this.audio, this.particles);
      this.hitstopTimer = 0.05;
    } else if (hitTarget?.turret) {
      hitTarget.turret.takeDamage(weapon.damage, shotAngle, this.audio, this.particles);
      this.hitstopTimer = 0.05;
    } else if (tileRay.hit) {
      this.particles.spawnSparks(hitX, hitY, shotAngle, 6);
    }

    // Sound, tracer, muzzle flash lighting & ejection
    this.muzzleFlashTimer = 0.08;
    this.muzzleFlashPos = { x: muzzleX, y: muzzleY };
    this.audio.shoot(this.reticle.isAimed);
    this.particles.spawnMuzzleFlash(muzzleX, muzzleY, shotAngle);
    this.particles.spawnTracer(muzzleX, muzzleY, hitX, hitY, this.reticle.isAimed);
    this.particles.spawnShellCasing(player.x, player.y, player.facingAngle);
  }

  private resolveMeleeHit() {
    const player = this.player;
    const weapon = player.currentWeapon;
    player.attackHitDone = true;

    const reach = weapon.range;
    const swingAngle = player.meleeSwingAngle;
    const arcSpan = Math.PI * 0.8;

    let hitAny = false;

    // Test enemies
    for (const enemy of this.level.enemies) {
      if (enemy.dead) continue;
      const d = dist(player.x, player.y, enemy.x, enemy.y);
      if (d > reach + enemy.radius) continue;

      const angleToEnemy = Math.atan2(enemy.y - player.y, enemy.x - player.x);
      if (Math.abs(angleDist(swingAngle, angleToEnemy)) <= arcSpan / 2) {
        enemy.takeDamage(weapon.damage, swingAngle, this.audio, this.particles);
        hitAny = true;
      }
    }

    // Test turrets
    for (const turret of this.level.turrets) {
      if (turret.dead) continue;
      const d = dist(player.x, player.y, turret.x, turret.y);
      if (d > reach + turret.radius) continue;

      const angleToTurret = Math.atan2(turret.y - player.y, turret.x - player.x);
      if (Math.abs(angleDist(swingAngle, angleToTurret)) <= arcSpan / 2) {
        turret.takeDamage(weapon.damage, swingAngle, this.audio, this.particles);
        hitAny = true;
      }
    }

    if (hitAny) {
      this.hitstopTimer = weapon.hitstop ?? 0.05;
      this.camera.addTrauma(0.18);
    }
  }

  private updateDialogue(dt: number) {
    if (!this.activeDialogue) return;
    const node = this.activeDialogue.script.nodes[this.activeDialogue.nodeKey];
    if (!node) {
      this.activeDialogue = null;
      this.state = 'playing';
      this.notifyState();
      return;
    }

    const currentLine = node.lines[this.activeDialogue.lineIdx] ?? '';

    // Typing effect
    if (!this.activeDialogue.doneTyping) {
      this.activeDialogue.typingTimer += dt;
      if (this.activeDialogue.typingTimer > 0.025) {
        this.activeDialogue.typingTimer = 0;
        this.activeDialogue.charIdx++;
        if (this.activeDialogue.charIdx % 3 === 0) {
          this.audio.dialogueBeep();
        }
        if (this.activeDialogue.charIdx >= currentLine.length) {
          this.activeDialogue.doneTyping = true;
        }
      }
    }

    // Advance dialogue on Space / E / Fire / Click
    const advance = this.input.isPressed('fire') || this.input.isPressed('interact') || this.input.isPressed('dash');
    if (advance) {
      if (!this.activeDialogue.doneTyping) {
        // Instant complete line
        this.activeDialogue.charIdx = currentLine.length;
        this.activeDialogue.doneTyping = true;
      } else {
        // Next line or next node
        if (this.activeDialogue.lineIdx < node.lines.length - 1) {
          this.activeDialogue.lineIdx++;
          this.activeDialogue.charIdx = 0;
          this.activeDialogue.doneTyping = false;
        } else {
          // Node ended: trigger node action if any
          if (node.action) node.action(this);
          if (node.flag) this.story.setFlag(node.flag);

          // If choices exist, stay until choice selected (handled in React or render)
          if (node.choices && node.choices.length > 0) {
            // Wait for choice
          } else if (node.next) {
            this.activeDialogue.nodeKey = node.next;
            this.activeDialogue.lineIdx = 0;
            this.activeDialogue.charIdx = 0;
            this.activeDialogue.doneTyping = false;
          } else {
            // Dialogue complete
            this.activeDialogue = null;
            if (this.activeCutscene) {
              this.activeCutscene.currentStepIdx++;
              this.processCutsceneStep();
            } else {
              this.state = 'playing';
              this.notifyState();
            }
          }
        }
      }
    }
  }

  public selectDialogueChoice(idx: number) {
    if (!this.activeDialogue) return;
    const node = this.activeDialogue.script.nodes[this.activeDialogue.nodeKey];
    if (node?.choices && node.choices[idx]) {
      const choice = node.choices[idx];
      this.activeDialogue.nodeKey = choice.next;
      this.activeDialogue.lineIdx = 0;
      this.activeDialogue.charIdx = 0;
      this.activeDialogue.doneTyping = false;
    }
  }

  // --- RENDERING PIPELINE ---
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, VIEW.width, VIEW.height);

    if (this.state === 'title') {
      this.renderTitleScreen();
      return;
    }

    const camX = this.camera.x;
    const camY = this.camera.y;

    // 1. 3/4 Perspective Floors & ground
    this.level.tilemap.renderFloors(ctx, camX, camY, VIEW.width, VIEW.height);

    // 2. Floor decals (blood stains, bullet craters)
    this.particles.renderDecals(ctx, camX, camY, VIEW.width, VIEW.height);

    // 3. Everything with height, sorted by where it touches the ground:
    //    walls, props, pickups and characters (feet).
    type Renderable = { y: number; render: () => void };
    const renderables: Renderable[] = [];
    this.level.tilemap.collectRenderables(ctx, camX, camY, VIEW.width, VIEW.height, this.globalTime, renderables);

    for (const p of this.level.pickups) {
      if (p.collected) continue;
      renderables.push({ y: p.y, render: () => this.renderPickup(ctx, p, camX, camY) });
    }

    const zhouDist = dist(this.player.x, this.player.y, this.level.npcZhou.x, this.level.npcZhou.y);
    renderables.push({
      y: this.level.npcZhou.y + FEET_OFFSET,
      render: () => this.level.npcZhou.render(ctx, camX, camY, VIEW.width, VIEW.height, zhouDist),
    });

    for (const enemy of this.level.enemies) {
      if (enemy.dead || enemy.seen <= 0.02) continue;
      renderables.push({
        y: enemy.y + FEET_OFFSET,
        render: () => {
          ctx.save();
          ctx.globalAlpha = enemy.seen;
          enemy.render(ctx, camX, camY, VIEW.width, VIEW.height);
          ctx.restore();
        },
      });
    }

    for (const turret of this.level.turrets) {
      renderables.push({
        y: turret.y + FEET_OFFSET,
        render: () => turret.render(ctx, camX, camY, VIEW.width, VIEW.height),
      });
    }

    renderables.push({
      y: this.player.y + FEET_OFFSET,
      render: () => this.player.render(ctx, camX, camY, VIEW.width, VIEW.height, this.reticle.isAimed),
    });

    // Perform Depth Y-Sorting
    renderables.sort((a, b) => a.y - b.y);
    for (const r of renderables) {
      r.render();
    }

    // 6. Enemy Bullets in 3/4 space
    for (const b of this.enemyBullets) {
      const sx = b.x - (camX - VIEW.width / 2);
      const sy = b.y - (camY - VIEW.height / 2);

      ctx.save();
      ctx.fillStyle = '#ff7a3c';
      ctx.beginPath();
      ctx.arc(sx, sy, b.radius - 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffd9a0';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    // 7. Particles, slashes, tracers, and smoke
    this.particles.render(ctx, camX, camY, VIEW.width, VIEW.height);

    // 8. Dynamic Lighting & Tactical Atmosphere
    this.renderLightingAndAtmosphere(ctx);

    // 11. Dynamic Reticle (遠射瞄準縮小準星)
    const mouseWorld = this.camera.screenToWorld(this.input.mouseViewX, this.input.mouseViewY);
    const distToPlayer = dist(this.player.x, this.player.y, mouseWorld.x, mouseWorld.y);
    this.reticle.render(
      ctx,
      this.input.mouseViewX,
      this.input.mouseViewY,
      distToPlayer,
      this.player.currentWeapon
    );

    // 12. Cutscene Fade Overlay
    if (this.activeCutscene && this.activeCutscene.fadeAlpha > 0) {
      ctx.fillStyle = `rgba(10, 6, 4, ${this.activeCutscene.fadeAlpha})`;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }

    // 13. Screen flash effect on hurt
    if (this.flashTimer > 0) {
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }

    // 14. In-Game HUD Message
    if (this.hudMessage && this.hudMessageTimer > 0) {
      ctx.save();
      ctx.font = 'bold 11px monospace';
      const tw = ctx.measureText(this.hudMessage).width + 32;
      ctx.globalAlpha = clamp(this.hudMessageTimer * 3, 0, 1);
      ctx.fillStyle = 'rgba(23, 15, 10, 0.82)';
      ctx.fillRect(VIEW.width / 2 - tw / 2, 42, tw, 26);
      ctx.fillStyle = 'rgba(232, 184, 106, 0.6)';
      ctx.fillRect(VIEW.width / 2 - tw / 2, 42, tw, 1);
      ctx.fillRect(VIEW.width / 2 - tw / 2, 67, tw, 1);

      ctx.fillStyle = '#f2dcb4';
      ctx.textAlign = 'center';
      ctx.fillText(this.hudMessage, VIEW.width / 2, 59);
      ctx.restore();
    }

    // 15. Dialogue Box Overlay
    if (this.state === 'dialogue' && this.activeDialogue) {
      this.renderDialogueOverlay(ctx);
    }

    // 16. Ending Screen Overlay
    if (this.state === 'ending') {
      this.renderEndingScreen(ctx);
    }
  }

  private renderPickup(ctx: CanvasRenderingContext2D, p: PickupItem, camX: number, camY: number) {
    const sx = p.x - (camX - VIEW.width / 2);
    const sy = p.y - (camY - VIEW.height / 2);
    const bob = Math.round(Math.sin(this.globalTime * 4 + p.x) * 1.5);
    const prop = p.type === 'weapon' ? String(p.payload) : 'adrenaline';

    // A faint warm glint on the ground so items read in the dark.
    const pulse = 0.5 + Math.sin(this.globalTime * 3 + p.x) * 0.2;
    const g = ctx.createRadialGradient(sx, sy, 1, sx, sy, 14);
    g.addColorStop(0, `rgba(255, 210, 130, ${0.35 * pulse})`);
    g.addColorStop(1, 'rgba(255, 210, 130, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(16, 10, 6, 0.4)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 1, 6, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!drawProp(ctx, TD.props[prop], sx, sy - 2 + bob)) {
      ctx.fillStyle = '#e8c98a';
      ctx.fillRect(sx - 5, sy - 6 + bob, 10, 4);
    }

    // Name only when close enough to matter.
    if (dist(this.player.x, this.player.y, p.x, p.y) < 70) {
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20, 12, 8, 0.85)';
      ctx.fillStyle = '#f2cf8a';
      ctx.strokeText(p.name, sx, sy - 24);
      ctx.fillText(p.name, sx, sy - 24);
    }
  }

  // What the player can see: a cone toward the aim plus a small circle
  // around them, both cut off by walls.
  private viewParams() {
    const aimed = this.reticle.isAimed;
    return {
      ox: this.player.x,
      oy: this.player.y - 4,
      aim: this.player.facingAngle,
      far: aimed ? 330 : 260,
      near: 84,
      halfCone: aimed ? 0.7 : 0.95,
    };
  }

  private viewRange(v: ReturnType<GameEngine['viewParams']>, angle: number): number {
    const rel = Math.abs(angleDist(v.aim, angle));
    const t = clamp((rel - v.halfCone) / 0.45, 0, 1);
    return v.far + (v.near - v.far) * t * t * (3 - 2 * t);
  }

  private canSee(x: number, y: number, radius: number): boolean {
    const v = this.viewParams();
    const d = dist(v.ox, v.oy, x, y);
    const camp = dist(x, y, CAMPFIRE.x, CAMPFIRE.y) < 110;
    if (!camp && d > this.viewRange(v, Math.atan2(y - v.oy, x - v.ox)) + radius) return false;
    return !this.level.tilemap.raycast(v.ox, v.oy, x, y, true).hit;
  }

  private updateVisibility(dt: number) {
    const k = Math.min(1, dt * 8);
    for (const e of this.level.enemies) {
      if (e.dead) continue;
      let target = this.canSee(e.x, e.y, e.radius) ? 1 : 0;
      // An enemy closing in is heard, if not seen: show a faint shape.
      if (!target && (e.state === 'chase' || e.state === 'windup') && dist(e.x, e.y, this.player.x, this.player.y) < 150) {
        target = 0.4;
      }
      e.seen += (target - e.seen) * k;
    }
  }

  private viewPolygon(): { x: number; y: number }[] {
    const v = this.viewParams();
    const tm = this.level.tilemap;
    const pts: { x: number; y: number }[] = [];
    const N = 180;
    for (let i = 0; i < N; i++) {
      const a = v.aim - Math.PI + (i / N) * Math.PI * 2;
      const range = this.viewRange(v, a);
      const ex = v.ox + Math.cos(a) * range;
      const ey = v.oy + Math.sin(a) * range;
      const hit = tm.raycast(v.ox, v.oy, ex, ey, true);
      // Let the light spill a little past the hit so wall faces are lit.
      const d = hit.hit ? Math.min(range, hit.dist + 14) : range;
      pts.push({ x: v.ox + Math.cos(a) * d, y: v.oy + Math.sin(a) * d });
    }
    return pts;
  }

  private renderLightingAndAtmosphere(ctx: CanvasRenderingContext2D) {
    const lCtx = this.lightCtx;
    const v = this.viewParams();
    lCtx.clearRect(0, 0, VIEW.width, VIEW.height);

    // 1. Out of sight is dim, warm and still readable - not black.
    lCtx.fillStyle = 'rgba(18, 10, 6, 0.72)';
    lCtx.fillRect(0, 0, VIEW.width, VIEW.height);

    lCtx.save();
    lCtx.globalCompositeOperation = 'destination-out';

    // 2. Line-of-sight polygon, brightest near the player.
    const o = this.camera.worldToScreen(v.ox, v.oy);
    const poly = this.viewPolygon();
    const g = lCtx.createRadialGradient(o.x, o.y, 8, o.x, o.y, v.far);
    g.addColorStop(0, 'rgba(0, 0, 0, 1)');
    g.addColorStop(0.5, 'rgba(0, 0, 0, 0.92)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    lCtx.fillStyle = g;
    lCtx.filter = 'blur(3px)';
    lCtx.beginPath();
    poly.forEach((pt, i) => {
      const s = this.camera.worldToScreen(pt.x, pt.y);
      if (i === 0) lCtx.moveTo(s.x, s.y);
      else lCtx.lineTo(s.x, s.y);
    });
    lCtx.closePath();
    lCtx.fill();
    lCtx.filter = 'none';

    // 3. Old Zhou's fire lights its corner of the courtyard.
    const campScreen = this.camera.worldToScreen(CAMPFIRE.x, CAMPFIRE.y);
    const campFlicker = Math.sin(this.globalTime * 9) * 6 + Math.cos(this.globalTime * 14) * 3;
    const campRadius = 130 + campFlicker;
    const campCut = lCtx.createRadialGradient(campScreen.x, campScreen.y, 6, campScreen.x, campScreen.y, campRadius);
    campCut.addColorStop(0, 'rgba(0, 0, 0, 1)');
    campCut.addColorStop(0.5, 'rgba(0, 0, 0, 0.8)');
    campCut.addColorStop(1, 'rgba(0, 0, 0, 0)');
    lCtx.fillStyle = campCut;
    lCtx.beginPath();
    lCtx.arc(campScreen.x, campScreen.y, campRadius, 0, Math.PI * 2);
    lCtx.fill();

    // 4. Muzzle flash lights everything around for a moment.
    if (this.muzzleFlashTimer > 0) {
      const m = this.camera.worldToScreen(this.muzzleFlashPos.x, this.muzzleFlashPos.y);
      const intensity = clamp(this.muzzleFlashTimer / 0.08, 0, 1);
      const r = 170 * intensity;
      const mg = lCtx.createRadialGradient(m.x, m.y, 4, m.x, m.y, r);
      mg.addColorStop(0, 'rgba(0, 0, 0, 1)');
      mg.addColorStop(1, 'rgba(0, 0, 0, 0)');
      lCtx.fillStyle = mg;
      lCtx.beginPath();
      lCtx.arc(m.x, m.y, r, 0, Math.PI * 2);
      lCtx.fill();
    }
    lCtx.restore();

    ctx.drawImage(this.lightCanvas, 0, 0);

    // 5. Warm light colour: the fire and the muzzle flash.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const warm = ctx.createRadialGradient(campScreen.x, campScreen.y, 4, campScreen.x, campScreen.y, campRadius);
    warm.addColorStop(0, 'rgba(255, 150, 60, 0.22)');
    warm.addColorStop(0.5, 'rgba(255, 110, 30, 0.08)');
    warm.addColorStop(1, 'rgba(255, 80, 0, 0)');
    ctx.fillStyle = warm;
    ctx.beginPath();
    ctx.arc(campScreen.x, campScreen.y, campRadius, 0, Math.PI * 2);
    ctx.fill();
    if (this.muzzleFlashTimer > 0) {
      const m = this.camera.worldToScreen(this.muzzleFlashPos.x, this.muzzleFlashPos.y);
      const intensity = clamp(this.muzzleFlashTimer / 0.08, 0, 1);
      ctx.fillStyle = `rgba(255, 200, 120, ${0.22 * intensity})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 120 * intensity, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 6. Dusk grade: pull the whole frame toward amber.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#fbe6cf';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    ctx.restore();

    this.renderDustMotes(ctx, o.x, o.y, v);

    // 7. Vignette
    const vig = ctx.createRadialGradient(
      VIEW.width / 2, VIEW.height / 2, VIEW.height * 0.42,
      VIEW.width / 2, VIEW.height / 2, VIEW.width * 0.7
    );
    vig.addColorStop(0, 'rgba(20, 10, 4, 0)');
    vig.addColorStop(1, 'rgba(20, 10, 4, 0.6)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  }

  // Drifting ash, brighter where it crosses the player's view.
  private renderDustMotes(ctx: CanvasRenderingContext2D, px: number, py: number, v: ReturnType<GameEngine['viewParams']>) {
    for (const m of this.dustMotes) {
      const d = Math.hypot(m.x - px, m.y - py);
      const inView = d < this.viewRange(v, Math.atan2(m.y - py, m.x - px));
      const shimmer = 0.6 + Math.sin(this.globalTime * 3 + m.x) * 0.3;
      ctx.fillStyle = inView
        ? `rgba(240, 214, 176, ${m.alpha * 1.2 * shimmer})`
        : `rgba(170, 140, 110, ${m.alpha * 0.35})`;
      ctx.fillRect(Math.round(m.x), Math.round(m.y), m.size > 1.8 ? 2 : 1, 1);
    }
  }

  private renderDialogueOverlay(ctx: CanvasRenderingContext2D) {
    if (!this.activeDialogue) return;
    const node = this.activeDialogue.script.nodes[this.activeDialogue.nodeKey];
    if (!node) return;

    const boxX = 36;
    const boxY = VIEW.height - 110;
    const boxW = VIEW.width - 72;
    const boxH = 92;

    // Panel: dark warm paper with a thin amber rule top and bottom.
    ctx.fillStyle = 'rgba(22, 14, 9, 0.92)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = 'rgba(232, 184, 106, 0.55)';
    ctx.fillRect(boxX, boxY, boxW, 1);
    ctx.fillRect(boxX, boxY + boxH - 1, boxW, 1);

    // Speaker name
    const speaker = node.speaker ?? '你';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8b86a';
    ctx.fillText(speaker, boxX + 16, boxY + 16);

    // Dialogue text (typewritten)
    const currentLine = node.lines[this.activeDialogue.lineIdx] ?? '';
    const typedText = currentLine.slice(0, this.activeDialogue.charIdx);

    ctx.fillStyle = '#f4e6cf';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(typedText, boxX + 16, boxY + 36);

    // Choices if available
    if (node.choices && this.activeDialogue.doneTyping && this.activeDialogue.lineIdx === node.lines.length - 1) {
      ctx.fillStyle = '#f2cf8a';
      ctx.font = '10px monospace';
      node.choices.forEach((c, idx) => {
        ctx.fillText(`${idx + 1}.  ${c.text}`, boxX + 24, boxY + 56 + idx * 16);
      });
    } else {
      // Continue prompt
      ctx.fillStyle = `rgba(201, 176, 138, ${0.55 + Math.sin(this.globalTime * 4) * 0.3})`;
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('▼ 按空白鍵 / E 繼續', boxX + boxW - 14, boxY + boxH - 10);
    }
  }

  private renderTitleScreen() {
    const ctx = this.ctx;
    ctx.fillStyle = '#1a100a';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);

    // Dusk backdrop, drifting slowly.
    const [sky, far, mid] = TITLE_LAYERS;
    const drift = this.globalTime * 6;
    const layer = (img: typeof sky, speed: number, bottom: number) => {
      if (!img.loaded) return;
      const w = img.img.width;
      const x = -((drift * speed) % w);
      for (let dx = x; dx < VIEW.width; dx += w) ctx.drawImage(img.img, Math.round(dx), bottom - img.img.height);
    };
    layer(sky, 0.1, VIEW.height);
    layer(far, 0.3, VIEW.height + 10);
    layer(mid, 0.7, VIEW.height + 40);

    // Darken toward the bottom where the text sits.
    const g = ctx.createLinearGradient(0, 0, 0, VIEW.height);
    g.addColorStop(0, 'rgba(20, 10, 5, 0.25)');
    g.addColorStop(0.55, 'rgba(20, 10, 5, 0.55)');
    g.addColorStop(1, 'rgba(14, 7, 4, 0.92)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);

    const text = (str: string, y: number, font: string, color: string) => {
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(16, 8, 4, 0.85)';
      ctx.strokeText(str, VIEW.width / 2, y);
      ctx.fillStyle = color;
      ctx.fillText(str, VIEW.width / 2, y);
    };
    text('焦土台灣', 108, 'bold 34px monospace', '#f4e6cf');
    text('第一章　甦醒', 138, '13px monospace', '#e8b86a');

    const controls = [
      'WASD 移動　·　Shift 奔跑　·　空白鍵 翻滾',
      '左鍵 攻擊 / 射擊　·　右鍵 瞄準（準星收窄）',
      '1–4 切換武器　·　E 調查 / 交談　·　ESC 暫停',
    ];
    controls.forEach((c, i) => text(c, 236 + i * 17, '10px monospace', '#c9b08a'));

    const pulse = Math.sin(this.globalTime * 3) * 0.25 + 0.75;
    text('點擊畫面或按空白鍵開始', 318, 'bold 12px monospace', `rgba(242, 207, 138, ${pulse})`);
  }

  private renderEndingScreen(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(16, 9, 5, 0.92)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);

    ctx.fillStyle = '#e8b86a';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('第一章：甦醒　完結', VIEW.width / 2, 110);

    ctx.fillStyle = '#f4e6cf';
    ctx.font = '12px monospace';
    ctx.fillText('恭喜清除檢查哨，順著舊鐵軌抵達通往南站的避難隧道。', VIEW.width / 2, 150);
    ctx.fillText('你在戰後五年的廢墟中跨出了求生的第一步。', VIEW.width / 2, 175);
    ctx.fillText('妻子與女兒的去向，以及那場戰火的真相，將在下一章揭曉。', VIEW.width / 2, 200);

    ctx.fillStyle = '#c9b08a';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('按 [R] 鍵重新遊玩第一章', VIEW.width / 2, 270);
  }
}
