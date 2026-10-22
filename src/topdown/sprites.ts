// Image loading and generic sprite-sheet helpers. The top-down art set
// itself is declared in art.ts.

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
