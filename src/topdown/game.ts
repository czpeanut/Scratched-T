// Top-Down Action Shooter Game Engine & Loop Coordinator

import { VIEW, COLORS, WEAPONS } from './constants';
import { GameState, DialogueScript, CutsceneStep, WeaponDef } from './types';
import { AudioManager } from './audio';
import { InputManager } from './input';
import { Camera } from './camera';
import { ParticleSystem } from './particles';
import { Reticle } from './reticle';
import { StoryManager } from './story';
import { LevelData, buildTopDownOpening } from './level';
import { Player, EnemyBullet, PickupItem, StoryTrigger } from './entities';
import { dist, clamp, angleDist } from './math';
import { wakeUpScript, getZhouScript, findAdrenalineScript } from './dialogues';

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
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 6 - 2,
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
    const muzzleX = player.x + Math.cos(shotAngle) * 16;
    const muzzleY = player.y + Math.sin(shotAngle) * 16;

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

    // 3. 3/4 Perspective Walls with vertical facades & 3D overhangs
    this.level.tilemap.renderWalls(ctx, camX, camY, VIEW.width, VIEW.height);

    // 4. 3/4 Perspective Obstacles with contact shadows (sandbags, crates, beds, campfire, vehicle)
    this.level.tilemap.renderObstacles(ctx, camX, camY, VIEW.width, VIEW.height, this.globalTime);

    // 5. Y-Sorted 3/4 Entities (Pickups, NPC Old Zhou, Enemies, Turrets, Player)
    type Renderable = { y: number; render: () => void };
    const renderables: Renderable[] = [];

    // Pickups
    for (const p of this.level.pickups) {
      if (!p.collected) {
        renderables.push({
          y: p.y,
          render: () => {
            const sx = p.x - (camX - VIEW.width / 2);
            const sy = p.y - (camY - VIEW.height / 2);
            const bob = Math.sin(this.globalTime * 5) * 2;
            ctx.save();
            ctx.translate(sx, sy + bob);
            ctx.fillStyle = 'rgba(127, 212, 255, 0.25)';
            ctx.beginPath();
            ctx.arc(0, 0, 10, 0, Math.PI * 2);
            ctx.fill();

            if (p.type === 'weapon') {
              ctx.fillStyle = '#ffe082';
              ctx.fillRect(-7, -2, 14, 4);
            } else {
              ctx.fillStyle = '#6eff9e';
              ctx.fillRect(-3, -6, 6, 12);
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(-1, -8, 2, 3);
            }

            ctx.fillStyle = '#cfe4ff';
            ctx.font = '8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(p.name, 0, -12);
            ctx.restore();
          },
        });
      }
    }

    // NPC Old Zhou
    const zhouDist = dist(this.player.x, this.player.y, this.level.npcZhou.x, this.level.npcZhou.y);
    renderables.push({
      y: this.level.npcZhou.y,
      render: () => this.level.npcZhou.render(ctx, camX, camY, VIEW.width, VIEW.height, zhouDist),
    });

    // Enemies
    for (const enemy of this.level.enemies) {
      if (!enemy.dead) {
        renderables.push({
          y: enemy.y,
          render: () => enemy.render(ctx, camX, camY, VIEW.width, VIEW.height),
        });
      }
    }

    // Turrets
    for (const turret of this.level.turrets) {
      renderables.push({
        y: turret.y,
        render: () => turret.render(ctx, camX, camY, VIEW.width, VIEW.height),
      });
    }

    // Player Character
    renderables.push({
      y: this.player.y,
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
      ctx.fillStyle = '#ff3366';
      ctx.beginPath();
      ctx.arc(sx, sy, b.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff99b0';
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
      ctx.fillStyle = `rgba(5, 7, 14, ${this.activeCutscene.fadeAlpha})`;
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
      ctx.fillStyle = 'rgba(10, 16, 28, 0.85)';
      ctx.strokeStyle = '#435a82';
      ctx.lineWidth = 1;
      const tw = ctx.measureText(this.hudMessage).width + 32;
      ctx.strokeRect(VIEW.width / 2 - tw / 2, 42, tw, 26);
      ctx.fillRect(VIEW.width / 2 - tw / 2, 42, tw, 26);

      ctx.fillStyle = '#ffe082';
      ctx.font = 'bold 11px monospace';
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

  private renderLightingAndAtmosphere(ctx: CanvasRenderingContext2D) {
    const lCtx = this.lightCtx;
    lCtx.clearRect(0, 0, VIEW.width, VIEW.height);

    // 1. Ambient darkness base layer
    lCtx.fillStyle = 'rgba(5, 7, 14, 0.88)';
    lCtx.fillRect(0, 0, VIEW.width, VIEW.height);

    // Carve out lighting apertures using destination-out
    lCtx.save();
    lCtx.globalCompositeOperation = 'destination-out';

    // 2. Tactical Flashlight Cone from Player
    const pScreen = this.camera.worldToScreen(this.player.x, this.player.y);
    const aimAngle = this.player.facingAngle;
    const isAimed = this.reticle.isAimed;
    const beamLength = isAimed ? 350 : 270;
    const halfCone = isAimed ? 0.35 : 0.52; // ~40° focused when aiming down sights vs 60° regular

    // Main cone cutout with radial falloff
    const flashGrad = lCtx.createRadialGradient(
      pScreen.x,
      pScreen.y,
      12,
      pScreen.x,
      pScreen.y,
      beamLength
    );
    flashGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
    flashGrad.addColorStop(0.35, 'rgba(0, 0, 0, 0.95)');
    flashGrad.addColorStop(0.75, 'rgba(0, 0, 0, 0.7)');
    flashGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    lCtx.fillStyle = flashGrad;
    lCtx.beginPath();
    lCtx.moveTo(pScreen.x, pScreen.y);
    lCtx.arc(pScreen.x, pScreen.y, beamLength, aimAngle - halfCone, aimAngle + halfCone);
    lCtx.closePath();
    lCtx.fill();

    // Soft penumbra edge cutout
    const penumbraGrad = lCtx.createRadialGradient(
      pScreen.x,
      pScreen.y,
      10,
      pScreen.x,
      pScreen.y,
      beamLength * 1.15
    );
    penumbraGrad.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    penumbraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    lCtx.fillStyle = penumbraGrad;
    lCtx.beginPath();
    lCtx.moveTo(pScreen.x, pScreen.y);
    lCtx.arc(pScreen.x, pScreen.y, beamLength * 1.15, aimAngle - halfCone * 1.3, aimAngle + halfCone * 1.3);
    lCtx.closePath();
    lCtx.fill();

    // 3. Player Close Footing Aura (soft 44px radial so footsteps & floor are visible)
    const auraGrad = lCtx.createRadialGradient(pScreen.x, pScreen.y, 4, pScreen.x, pScreen.y, 46);
    auraGrad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
    auraGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.5)');
    auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    lCtx.fillStyle = auraGrad;
    lCtx.beginPath();
    lCtx.arc(pScreen.x, pScreen.y, 46, 0, Math.PI * 2);
    lCtx.fill();

    // 4. Old Zhou's Campfire Point Light (Warm radial cutout with natural flicker)
    const campWorldX = 52 * 32 + 16;
    const campWorldY = 9 * 32 + 16;
    const campScreen = this.camera.worldToScreen(campWorldX, campWorldY);
    const campFlicker = Math.sin(this.globalTime * 9) * 8 + Math.cos(this.globalTime * 14) * 4;
    const campRadius = Math.max(70, 145 + campFlicker);

    const campCutGrad = lCtx.createRadialGradient(
      campScreen.x,
      campScreen.y,
      8,
      campScreen.x,
      campScreen.y,
      campRadius
    );
    campCutGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
    campCutGrad.addColorStop(0.55, 'rgba(0, 0, 0, 0.85)');
    campCutGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    lCtx.fillStyle = campCutGrad;
    lCtx.beginPath();
    lCtx.arc(campScreen.x, campScreen.y, campRadius, 0, Math.PI * 2);
    lCtx.fill();

    // 5. Muzzle Flash Dynamic Light Burst
    if (this.muzzleFlashTimer > 0) {
      const mScreen = this.camera.worldToScreen(this.muzzleFlashPos.x, this.muzzleFlashPos.y);
      const intensity = clamp(this.muzzleFlashTimer / 0.08, 0, 1);
      const burstRadius = 190 * intensity;
      const burstGrad = lCtx.createRadialGradient(
        mScreen.x,
        mScreen.y,
        4,
        mScreen.x,
        mScreen.y,
        burstRadius
      );
      burstGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
      burstGrad.addColorStop(0.6, 'rgba(0, 0, 0, 0.75)');
      burstGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      lCtx.fillStyle = burstGrad;
      lCtx.beginPath();
      lCtx.arc(mScreen.x, mScreen.y, burstRadius, 0, Math.PI * 2);
      lCtx.fill();
    }

    lCtx.restore();

    // 6. Draw the masked dynamic darkness over the scene
    ctx.drawImage(this.lightCanvas, 0, 0);

    // 7. Atmospheric Color Lighting Passes (Additive blending)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Flashlight volumetric beam glow (subtle tactical cyan tint)
    const beamGlow = ctx.createRadialGradient(
      pScreen.x,
      pScreen.y,
      8,
      pScreen.x,
      pScreen.y,
      beamLength
    );
    beamGlow.addColorStop(0, 'rgba(160, 215, 255, 0.08)');
    beamGlow.addColorStop(0.5, 'rgba(120, 185, 255, 0.035)');
    beamGlow.addColorStop(1, 'rgba(80, 150, 255, 0)');
    ctx.fillStyle = beamGlow;
    ctx.beginPath();
    ctx.moveTo(pScreen.x, pScreen.y);
    ctx.arc(pScreen.x, pScreen.y, beamLength, aimAngle - halfCone, aimAngle + halfCone);
    ctx.closePath();
    ctx.fill();

    // Campfire warm amber illumination glow
    const campWarmGrad = ctx.createRadialGradient(
      campScreen.x,
      campScreen.y,
      4,
      campScreen.x,
      campScreen.y,
      campRadius * 0.95
    );
    campWarmGrad.addColorStop(0, 'rgba(255, 175, 75, 0.24)');
    campWarmGrad.addColorStop(0.45, 'rgba(255, 125, 35, 0.11)');
    campWarmGrad.addColorStop(1, 'rgba(255, 60, 0, 0)');
    ctx.fillStyle = campWarmGrad;
    ctx.beginPath();
    ctx.arc(campScreen.x, campScreen.y, campRadius * 0.95, 0, Math.PI * 2);
    ctx.fill();

    // Muzzle Flash warm white tint burst
    if (this.muzzleFlashTimer > 0) {
      const mScreen = this.camera.worldToScreen(this.muzzleFlashPos.x, this.muzzleFlashPos.y);
      const intensity = clamp(this.muzzleFlashTimer / 0.08, 0, 1);
      ctx.fillStyle = `rgba(255, 235, 190, ${0.28 * intensity})`;
      ctx.beginPath();
      ctx.arc(mScreen.x, mScreen.y, 160 * intensity, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // 8. Floating dust motes illuminated in the light beam
    this.renderDustMotes(ctx, pScreen.x, pScreen.y, aimAngle, halfCone, beamLength);

    // 9. Edge Vignette
    const vigGrad = ctx.createRadialGradient(
      VIEW.width / 2,
      VIEW.height / 2,
      VIEW.height * 0.45,
      VIEW.width / 2,
      VIEW.height / 2,
      VIEW.width * 0.72
    );
    vigGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vigGrad.addColorStop(1, 'rgba(2, 4, 8, 0.7)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  }

  private renderDustMotes(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    aimAngle: number,
    halfCone: number,
    beamLength: number
  ) {
    ctx.save();
    for (const m of this.dustMotes) {
      const dx = m.x - px;
      const dy = m.y - py;
      const d = Math.hypot(dx, dy);

      // Check if mote is inside the flashlight beam cone
      let inBeam = false;
      if (d <= beamLength && d > 12) {
        const moteAngle = Math.atan2(dy, dx);
        const diff = Math.abs(angleDist(aimAngle, moteAngle));
        if (diff <= halfCone) {
          inBeam = true;
        }
      }

      if (inBeam) {
        // High visibility shimmering particle in beam
        const shimmer = 0.5 + Math.sin(this.globalTime * 6 + m.x) * 0.3;
        ctx.fillStyle = `rgba(200, 235, 255, ${m.alpha * 1.8 * shimmer})`;
        ctx.fillRect(m.x, m.y, m.size, m.size);
      } else {
        // Faint ambient dust in darkness
        ctx.fillStyle = `rgba(130, 160, 200, ${m.alpha * 0.35})`;
        ctx.fillRect(m.x, m.y, m.size * 0.8, m.size * 0.8);
      }
    }
    ctx.restore();
  }

  private renderDialogueOverlay(ctx: CanvasRenderingContext2D) {
    if (!this.activeDialogue) return;
    const node = this.activeDialogue.script.nodes[this.activeDialogue.nodeKey];
    if (!node) return;

    const boxX = 36;
    const boxY = VIEW.height - 110;
    const boxW = VIEW.width - 72;
    const boxH = 92;

    // Background panel
    ctx.fillStyle = 'rgba(8, 12, 22, 0.94)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#5a73a3';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Speaker tag
    const speaker = node.speaker ?? '你';
    ctx.fillStyle = '#18243b';
    ctx.fillRect(boxX + 12, boxY - 11, 74, 18);
    ctx.strokeStyle = '#7fd4ff';
    ctx.strokeRect(boxX + 12, boxY - 11, 74, 18);

    ctx.fillStyle = '#7fd4ff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(speaker, boxX + 49, boxY + 2);

    // Dialogue text (typewritten)
    const currentLine = node.lines[this.activeDialogue.lineIdx] ?? '';
    const typedText = currentLine.slice(0, this.activeDialogue.charIdx);

    ctx.fillStyle = '#e8f1ff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(typedText, boxX + 16, boxY + 30);

    // Choices if available
    if (node.choices && this.activeDialogue.doneTyping && this.activeDialogue.lineIdx === node.lines.length - 1) {
      ctx.fillStyle = '#ffe082';
      ctx.font = '10px monospace';
      node.choices.forEach((c, idx) => {
        ctx.fillText(`[${idx + 1}]  ${c.text}`, boxX + 24, boxY + 52 + idx * 18);
      });
    } else {
      // Continue prompt
      ctx.fillStyle = '#6b7d9e';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('▼ 按空白鍵 / E 繼續', boxX + boxW - 14, boxY + boxH - 10);
    }
  }

  private renderTitleScreen() {
    const ctx = this.ctx;
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);

    // Decorative grid
    ctx.strokeStyle = 'rgba(40, 56, 92, 0.2)';
    ctx.lineWidth = 1;
    for (let x = 0; x < VIEW.width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, VIEW.height);
      ctx.stroke();
    }
    for (let y = 0; y < VIEW.height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(VIEW.width, y);
      ctx.stroke();
    }

    // Title text
    ctx.fillStyle = '#e8f1ff';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('焦土台灣', VIEW.width / 2, 105);

    ctx.fillStyle = '#7fd4ff';
    ctx.font = '14px monospace';
    ctx.fillText('第一章：甦醒  (俯視角末日戰術動作)', VIEW.width / 2, 135);

    // Aim mechanic highlight badge
    ctx.fillStyle = 'rgba(255, 224, 130, 0.15)';
    ctx.strokeStyle = '#ffe082';
    ctx.fillRect(VIEW.width / 2 - 190, 155, 380, 24);
    ctx.strokeRect(VIEW.width / 2 - 190, 155, 380, 24);

    ctx.fillStyle = '#ffe082';
    ctx.font = '11px monospace';
    ctx.fillText('★ 核心機制：右鍵瞄準縮小準星 · 遠距高精準打擊', VIEW.width / 2, 171);

    // Controls table
    const controls = [
      'WASD / 方向鍵  ·  八方向移動',
      '左鍵 / J  ·  近戰揮擊 / 槍械射擊',
      '右鍵 / U  ·  【瞄準縮小準星】(長按提升射程與精準度)',
      '空白鍵  ·  戰術翻滾閃避  /  Shift 奔跑',
      '1/2/3/4  ·  切換拳頭、棍棒、軍刀、手槍',
      'E  ·  調查公告 / 與倖存者老周對話',
    ];

    ctx.fillStyle = '#9cb4d8';
    ctx.font = '10px monospace';
    controls.forEach((c, idx) => {
      ctx.fillText(c, VIEW.width / 2, 215 + idx * 16);
    });

    // Start prompt button
    const pulse = Math.sin(this.globalTime * 4) * 0.2 + 0.8;
    ctx.fillStyle = `rgba(127, 212, 255, ${pulse})`;
    ctx.font = 'bold 13px monospace';
    ctx.fillText('▶ 點擊畫面 或 按空白鍵 開始冒險 ◀', VIEW.width / 2, 328);
  }

  private renderEndingScreen(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(5, 7, 14, 0.92)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);

    ctx.fillStyle = '#e8c98a';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('第一章：甦醒　完結', VIEW.width / 2, 110);

    ctx.fillStyle = '#cfe4ff';
    ctx.font = '12px monospace';
    ctx.fillText('恭喜清除檢查哨，順著舊鐵軌抵達通往南站的避難隧道。', VIEW.width / 2, 150);
    ctx.fillText('你在戰後五年的廢墟中跨出了求生的第一步。', VIEW.width / 2, 175);
    ctx.fillText('妻子與女兒的去向，以及那場戰火的真相，將在下一章揭曉。', VIEW.width / 2, 200);

    ctx.fillStyle = '#7fd4ff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('按 [R] 鍵重新遊玩第一章', VIEW.width / 2, 270);
  }
}
