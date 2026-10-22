#!/usr/bin/env node
// Generates assets/player.png - the placeholder sprite sheet.
//
// The art is drawn parametrically so every frame stays consistent: one
// `drawCharacter` function takes a pose (bob, lean, leg positions, jacket
// sway) and each animation frame is just a different pose. Replace the
// generated PNG with your own art and the game will use it as long as the
// grid still matches FRAME_W x FRAME_H and the row order in
// src/game/player-anims.js.
//
//   node tools/make-spritesheet.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Pixels } from './png.mjs';

const FRAME_W = 32;
const FRAME_H = 40;

// Row order must match ANIMS in src/game/player-anims.js.
const ROWS = [
  { name: 'idle', frames: 4 },
  { name: 'run', frames: 6 },
  { name: 'jump', frames: 2 },
  { name: 'fall', frames: 2 },
  { name: 'dash', frames: 2 },
  { name: 'wall', frames: 2 },
  { name: 'hurt', frames: 2 },
];

const COLS = Math.max(...ROWS.map((r) => r.frames));

// An ordinary man in worn survivor's clothes - no mask, no cloak. Kept
// deliberately light/warm rather than a moodier, darker palette: the
// background is dark navy, and (as the previous cloak design found the hard
// way) a low-contrast outfit makes the character disappear into it. Warm tan
// reads clearly against cool navy at any point in the frame.
const C = {
  jacketMid: [198, 180, 142, 255],
  jacketDark: [148, 130, 98, 255],
  jacketEdge: [232, 220, 192, 255],
  pants: [92, 86, 80, 255],
  pantsDark: [64, 60, 56, 255],
  shoe: [40, 36, 34, 255],
  skin: [222, 176, 140, 255],
  skinShade: [184, 140, 108, 255],
  hair: [58, 42, 32, 255],
  eye: [22, 18, 16, 255],
  white: [255, 255, 255, 255],
};

// Draws the character into a frame cell. `o` is the pose.
function drawCharacter(px, ox, oy, o = {}) {
  const {
    bob = 0,
    lean = 0,
    flare = 0,
    legL = 0,
    legR = 0,
    armSwing = 0,
    squashY = 0,
    flash = false,
    facing = 1,
  } = o;

  const jacket = flash ? C.white : C.jacketMid;
  const jacketDark = flash ? C.white : C.jacketDark;
  const jacketEdge = flash ? C.white : C.jacketEdge;
  const pants = flash ? C.white : C.pants;
  const pantsDark = flash ? C.white : C.pantsDark;
  const skin = flash ? C.white : C.skin;
  const hair = flash ? C.white : C.hair;

  const cx = ox + FRAME_W / 2 + lean;
  const feet = oy + FRAME_H - 1;
  const headY = oy + 9 + bob + squashY;
  const torsoTop = oy + 15 + bob + squashY;
  const torsoBot = oy + 27 + squashY * 0.4;

  // Legs, drawn first so the jacket hem overlaps their tops. Each leg spans
  // from the waist down to the feet; legL/legR offset the *top* of the
  // stride leg upward and shorten it, which is what sells a forward step
  // when animated across a run cycle.
  px.rect(cx - 5, torsoBot + legL, 3, feet - (torsoBot + legL) - 2, pants);
  px.rect(cx + 2, torsoBot + legR, 3, feet - (torsoBot + legR) - 2, pants);
  // A darker inseam edge gives the legs some form instead of reading as flat
  // bars.
  px.rect(cx - 3, torsoBot + legL + 1, 1, feet - (torsoBot + legL) - 3, pantsDark);
  // Shoes.
  px.rect(cx - 6, feet - 2, 4, 2, C.shoe);
  px.rect(cx + 2, feet - 2, 4, 2, C.shoe);

  // Arms, swinging opposite the legs during a run.
  px.rect(cx - 8 - armSwing, torsoTop + 2, 3, 9, jacketDark);
  px.rect(cx + 5 + armSwing, torsoTop + 2, 3, 9, jacketDark);

  // Jacket torso - a short trapezoid (hem sways a little with `flare`)
  // instead of the old cloak's dramatic flare, plus a rim-light edge on the
  // facing side for readability against the dark backdrop.
  px.trapezoid(cx, torsoTop, 11, torsoBot, 13 + flare, jacket);
  px.trapezoid(cx, torsoBot - 3, 12 + flare * 0.6, torsoBot, 13 + flare, jacketDark);
  for (let y = torsoTop; y <= torsoBot; y++) {
    const t = (y - torsoTop) / Math.max(1, torsoBot - torsoTop);
    const w = 11 + (13 + flare - 11) * t;
    px.set(cx + (facing > 0 ? w / 2 - 1 : -w / 2), y, jacketEdge);
  }

  // Head: skin, a short-hair cap, and simple eyes biased toward facing. The
  // hair and eyes need a clear gap between them - drawing them too close
  // let the hair's bottom edge eat the top row of the eye pixels, leaving
  // barely a sliver visible.
  px.ellipse(cx, headY, 6, 6, skin);
  px.ellipse(cx, headY - 4, 6, 3.5, hair);
  if (!flash) {
    const ex = cx + facing * 1;
    px.rect(ex - 3, headY + 1, 2, 2, C.eye);
    px.rect(ex + 1, headY + 1, 2, 2, C.eye);
  }
}

// Motion streaks behind a dashing character.
function drawStreaks(px, ox, oy, facing) {
  for (let i = 0; i < 5; i++) {
    const y = oy + 14 + i * 4;
    const len = 6 + ((i * 5) % 9);
    const x = facing > 0 ? ox + 2 : ox + FRAME_W - 2 - len;
    px.rect(x, y, len, 1, [198, 180, 142, 150 - i * 18]);
  }
}

function poseFor(anim, i) {
  switch (anim) {
    case 'idle':
      // A slow two-up two-down breathing bob.
      return { bob: [0, 1, 1, 0][i] };

    case 'run': {
      // Six-frame cycle: legs opposed, arms swinging opposite the legs, body
      // leaning into the run.
      const legL = [0, -2, -3, -1, 0, 0][i];
      const legR = [-2, -1, 0, 0, -1, -3][i];
      const armSwing = [2, 1, -1, -2, -1, 1][i];
      return { bob: [0, 1, 0, 0, 1, 0][i], lean: 1, flare: 2, legL, legR, armSwing };
    }

    case 'jump':
      // Stretched upward, legs tucked. The rise is kept to one pixel so the
      // head stays inside the frame.
      return { bob: -1, squashY: -1, legL: -3, legR: -2 - i, armSwing: -2 };

    case 'fall':
      // Legs reach down, arms trail up for balance.
      return { bob: 1, legL: 0, legR: -1, armSwing: 2 };

    case 'dash':
      return { lean: 2 + i, flare: 1, squashY: 1, legL: -3, legR: -3, armSwing: -3 };

    case 'wall':
      // Pressed against a wall.
      return { lean: -2, flare: 0, legL: -1, legR: -2, armSwing: 1 };

    case 'hurt':
      return { flash: i === 0, bob: 1, lean: -1, legL: -1, legR: -1 };

    default:
      return {};
  }
}

const sheet = new Pixels(COLS * FRAME_W, ROWS.length * FRAME_H);

ROWS.forEach((row, r) => {
  for (let i = 0; i < row.frames; i++) {
    // Each frame is drawn into its own cell-sized buffer, then blitted. A pose
    // that overshoots the cell is clipped at the cell edge rather than spilling
    // into the neighbouring animation row.
    const cell = new Pixels(FRAME_W, FRAME_H);
    if (row.name === 'dash') drawStreaks(cell, 0, 0, 1);
    drawCharacter(cell, 0, 0, { ...poseFor(row.name, i), facing: 1 });
    sheet.blit(cell, i * FRAME_W, r * FRAME_H);
  }
});

const out = resolve(import.meta.dirname, '..', 'assets', 'player.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, sheet.toPNG());

console.log(`wrote ${out}`);
console.log(`  grid   ${COLS} x ${ROWS.length} frames of ${FRAME_W}x${FRAME_H}`);
console.log(`  size   ${sheet.width}x${sheet.height}px`);
ROWS.forEach((r, i) => console.log(`  row ${i}  ${r.name} (${r.frames} frames)`));
