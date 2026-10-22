// Scripted screenshots of the top-down game at fixed spots, for checking art
// changes. Needs the dev server running (npm run dev) and Playwright.
//
//   node tools/td_screens.mjs [url] [outDir]
//
// Each shot teleports the player, points the aim, lets a few frames run and
// saves the 640x360 canvas scaled 2x.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const outDir = process.argv[3] ?? 'screens';
mkdirSync(outDir, { recursive: true });

const T = 32;
const SHOTS = [
  { name: 'ward', x: 6 * T, y: 13.5 * T, aim: 0 },
  { name: 'corridor', x: 20 * T, y: 13.5 * T, aim: 0.2, weapon: 'stick' },
  { name: 'courtyard', x: 44 * T, y: 13 * T, aim: -0.6, weapon: 'knife' },
  { name: 'campfire', x: 50 * T, y: 11.5 * T, aim: -0.2 },
  { name: 'highway', x: 63 * T, y: 13 * T, aim: 0.1, weapon: 'pistol', aimDown: true },
  { name: 'checkpoint', x: 90 * T, y: 13 * T, aim: 0, weapon: 'pistol' },
  { name: 'railway', x: 108 * T, y: 13 * T, aim: 0.3 },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__engine);
await page.waitForTimeout(800);

const canvas = await page.$('canvas');
await canvas.screenshot({ path: `${outDir}/title.png` });
// The opening: fade in, then the first dialogue line types out.
await page.evaluate(() => window.__engine.startGamePlay());
await page.waitForTimeout(3500);
await canvas.screenshot({ path: `${outDir}/dialogue.png` });
console.log('shot title, dialogue');

for (const s of SHOTS) {
  await page.evaluate((s) => {
    const e = window.__engine;
    e.activeDialogue = null;
    e.activeCutscene = null;
    e.hudMessage = null;
    e.state = 'playing';
    const p = e.player;
    p.x = s.x;
    p.y = s.y;
    p.vx = p.vy = 0;
    for (const w of ['stick', 'knife', 'pistol']) p.unlockWeapon(w);
    p.equipWeapon(s.weapon ?? 'fists');
    // Story triggers would pop dialogues mid-shot.
    for (const t of e.level.triggers) t.fired = true;
    e.camera.x = s.x;
    e.camera.y = s.y;
    // Aim: put the pointer where the angle says, 120px out.
    const scr = e.camera.worldToScreen(s.x + Math.cos(s.aim) * 120, s.y + Math.sin(s.aim) * 120);
    e.input.mouseViewX = scr.x;
    e.input.mouseViewY = scr.y;
    e.input.isDown = ((orig) => (a) => (a === 'aim' && s.aimDown) || orig.call(e.input, a))(
      Object.getPrototypeOf(e.input).isDown
    );
  }, s);
  await page.waitForTimeout(700);
  await canvas.screenshot({ path: `${outDir}/${s.name}.png` });
  console.log('shot', s.name);
}
await browser.close();
if (errors.length) {
  console.error('page errors:\n' + errors.join('\n'));
  process.exit(1);
}
