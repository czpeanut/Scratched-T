// 3/4 Top-Down Frame-by-Frame Sprite Animation System

export interface AnimationDef {
  row: number;
  frames: number;
  fps?: number;
  loop?: boolean;
}

export class ImageAsset {
  public img: HTMLImageElement;
  public loaded: boolean = false;

  constructor(src: string) {
    this.img = new Image();
    this.img.src = src;
    this.img.onload = () => {
      this.loaded = true;
    };
  }
}

export class SpriteSheet {
  public asset: ImageAsset;
  public frameW: number;
  public frameH: number;

  constructor(src: string, frameW: number, frameH: number) {
    this.asset = new ImageAsset(src);
    this.frameW = frameW;
    this.frameH = frameH;
  }

  get loaded(): boolean {
    return this.asset.loaded;
  }

  drawFrame(
    ctx: CanvasRenderingContext2D,
    row: number,
    frame: number,
    dx: number,
    dy: number,
    flipX: boolean = false,
    alpha: number = 1.0
  ) {
    if (!this.loaded) return;

    const sx = (frame % 8) * this.frameW;
    const sy = row * this.frameH;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(dx, dy);
    if (flipX) ctx.scale(-1, 1);

    ctx.drawImage(
      this.asset.img,
      sx,
      sy,
      this.frameW,
      this.frameH,
      -this.frameW / 2,
      -this.frameH / 2,
      this.frameW,
      this.frameH
    );
    ctx.restore();
  }
}

export class SpriteAnimator {
  public sheet: SpriteSheet;
  public currentAnim: string = 'idle';
  public anims: Record<string, AnimationDef>;
  public frameIndex: number = 0;
  public timer: number = 0;

  constructor(sheet: SpriteSheet, anims: Record<string, AnimationDef>) {
    this.sheet = sheet;
    this.anims = anims;
  }

  play(animName: string, resetIfSame: boolean = false) {
    if (this.currentAnim === animName && !resetIfSame) return;
    this.currentAnim = animName;
    this.frameIndex = 0;
    this.timer = 0;
  }

  update(dt: number) {
    const def = this.anims[this.currentAnim] ?? this.anims['idle'];
    if (!def) return;

    const fps = def.fps ?? 8;
    this.timer += dt;
    const frameDuration = 1 / fps;

    if (this.timer >= frameDuration) {
      this.timer -= frameDuration;
      if (def.loop ?? true) {
        this.frameIndex = (this.frameIndex + 1) % def.frames;
      } else {
        this.frameIndex = Math.min(this.frameIndex + 1, def.frames - 1);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, dx: number, dy: number, flipX: boolean = false, alpha: number = 1.0) {
    const def = this.anims[this.currentAnim] ?? this.anims['idle'];
    if (!def) return;
    this.sheet.drawFrame(ctx, def.row, this.frameIndex, dx, dy, flipX, alpha);
  }
}

// Global Art Assets Manager
export class ArtAssets {
  public static playerSheet: SpriteSheet = new SpriteSheet('/assets/ai/player.png', 64, 48);
  public static gunArmImage: ImageAsset = new ImageAsset('/assets/ai/gun_arm.png');
  public static walkerSheet: SpriteSheet = new SpriteSheet('/assets/ai/walker.png', 48, 48);
  public static zhouSheet: SpriteSheet = new SpriteSheet('/assets/ai/zhou.png', 48, 48);
  public static tileFill: ImageAsset = new ImageAsset('/assets/ai/tile_fill.png');
  public static tileCap: ImageAsset = new ImageAsset('/assets/ai/tile_cap.png');
}

export const PLAYER_ANIMS: Record<string, AnimationDef> = {
  idle: { row: 0, frames: 4, fps: 6, loop: true },
  run: { row: 1, frames: 6, fps: 10, loop: true },
  jump: { row: 2, frames: 2, fps: 6, loop: false },
  fall: { row: 3, frames: 2, fps: 6, loop: false },
  dash: { row: 4, frames: 2, fps: 12, loop: false },
  hurt: { row: 6, frames: 2, fps: 8, loop: false },
  punch: { row: 7, frames: 3, fps: 12, loop: false },
  stick: { row: 8, frames: 3, fps: 9, loop: false },
  knife: { row: 9, frames: 3, fps: 12, loop: false },
  gunStand: { row: 10, frames: 4, fps: 6, loop: true },
  gunRun: { row: 11, frames: 6, fps: 10, loop: true },
};

export const WALKER_ANIMS: Record<string, AnimationDef> = {
  walk: { row: 0, frames: 4, fps: 7, loop: true },
  charge: { row: 1, frames: 2, fps: 9, loop: true },
  attack: { row: 2, frames: 4, fps: 10, loop: false },
};

export const ZHOU_ANIMS: Record<string, AnimationDef> = {
  idle: { row: 0, frames: 3, fps: 4, loop: true },
};
