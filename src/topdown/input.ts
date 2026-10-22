// Top-Down Unified Input Handler

export class InputManager {
  public keys: Set<string> = new Set();
  public mouseButtons: Set<number> = new Set();
  public touchActions: Set<string> = new Set();

  public mouseViewX: number = 0;
  public mouseViewY: number = 0;
  public pointerActive: boolean = false;

  private pendingKeys: Set<string> = new Set();
  private pendingMouse: Set<number> = new Set();
  private pendingTouch: Set<string> = new Set();

  private activeActions: Set<string> = new Set();
  private prevActions: Set<string> = new Set();
  private pressedActions: Set<string> = new Set();
  private releasedActions: Set<string> = new Set();

  public moveX: number = 0;
  public moveY: number = 0;

  constructor() {
    this.bindEvents();
  }

  private bindEvents() {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
      if (!e.repeat) this.pendingKeys.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('contextmenu', (e) => {
      // Prevent browser context menu on right click (used for aiming)
      e.preventDefault();
    });
  }

  public attachCanvas(canvas: HTMLCanvasElement, viewW: number, viewH: number) {
    const updatePointer = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = viewW / rect.width;
      const scaleY = viewH / rect.height;
      this.mouseViewX = (e.clientX - rect.left) * scaleX;
      this.mouseViewY = (e.clientY - rect.top) * scaleY;
      this.pointerActive = true;
    };

    canvas.addEventListener('mousemove', updatePointer);

    canvas.addEventListener('mousedown', (e) => {
      updatePointer(e);
      this.mouseButtons.add(e.button);
      this.pendingMouse.add(e.button);
    });

    window.addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button);
    });
  }

  public touchDown(action: string) {
    this.touchActions.add(action);
    this.pendingTouch.add(action);
  }

  public touchUp(action: string) {
    this.touchActions.delete(action);
  }

  public poll() {
    this.prevActions = new Set(this.activeActions);
    this.activeActions.clear();

    // Map keyboard
    const checkKey = (codes: string[], action: string) => {
      if (codes.some((c) => this.keys.has(c) || this.pendingKeys.has(c))) {
        this.activeActions.add(action);
      }
    };

    checkKey(['KeyW', 'ArrowUp'], 'up');
    checkKey(['KeyS', 'ArrowDown'], 'down');
    checkKey(['KeyA', 'ArrowLeft'], 'left');
    checkKey(['KeyD', 'ArrowRight'], 'right');
    checkKey(['Space'], 'dash');
    checkKey(['ShiftLeft', 'ShiftRight', 'KeyL'], 'sprint');
    checkKey(['KeyE'], 'interact');
    checkKey(['KeyJ', 'KeyZ'], 'fire');
    checkKey(['KeyU', 'KeyX'], 'aim');
    checkKey(['KeyR'], 'restart');
    checkKey(['Escape', 'KeyP'], 'pause');
    checkKey(['KeyM'], 'mute');

    // Weapon select keys
    checkKey(['Digit1'], 'slot1');
    checkKey(['Digit2'], 'slot2');
    checkKey(['Digit3'], 'slot3');
    checkKey(['Digit4'], 'slot4');
    checkKey(['KeyQ'], 'swap');

    // Mouse buttons
    if (this.mouseButtons.has(0) || this.pendingMouse.has(0)) this.activeActions.add('fire');
    if (this.mouseButtons.has(2) || this.pendingMouse.has(2)) this.activeActions.add('aim');

    // Touch actions
    for (const a of this.touchActions) {
      this.activeActions.add(a);
    }
    for (const a of this.pendingTouch) {
      this.activeActions.add(a);
    }

    // Determine just pressed & just released
    this.pressedActions.clear();
    this.releasedActions.clear();

    for (const a of this.activeActions) {
      if (!this.prevActions.has(a)) {
        this.pressedActions.add(a);
      }
    }
    for (const a of this.prevActions) {
      if (!this.activeActions.has(a)) {
        this.releasedActions.add(a);
      }
    }

    this.pendingKeys.clear();
    this.pendingMouse.clear();
    this.pendingTouch.clear();

    // Direction vector
    let dx = 0;
    let dy = 0;
    if (this.activeActions.has('left')) dx -= 1;
    if (this.activeActions.has('right')) dx += 1;
    if (this.activeActions.has('up')) dy -= 1;
    if (this.activeActions.has('down')) dy += 1;

    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.SQRT2;
      dx *= inv;
      dy *= inv;
    }
    this.moveX = dx;
    this.moveY = dy;
  }

  public isDown(action: string): boolean {
    return this.activeActions.has(action);
  }

  public isPressed(action: string): boolean {
    return this.pressedActions.has(action);
  }

  public isReleased(action: string): boolean {
    return this.releasedActions.has(action);
  }
}
