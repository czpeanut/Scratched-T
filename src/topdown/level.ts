// Top-Down Level Construction for Chapter 1: 甦醒 (Awakening)

import { Tilemap, TileType } from './tilemap';
import { Player, EnemyLooter, SentryTurret, NPCZhou, PickupItem, StoryTrigger } from './entities';
import { TILE } from './constants';
import {
  foundNoteScript,
  warningLooterScript,
  findAdrenalineScript,
  warningTurretScript,
  getZhouScript,
  closingScript,
} from './dialogues';

export interface LevelData {
  name: string;
  tilemap: Tilemap;
  player: Player;
  enemies: EnemyLooter[];
  turrets: SentryTurret[];
  npcZhou: NPCZhou;
  pickups: PickupItem[];
  triggers: StoryTrigger[];
}

export function buildTopDownOpening(): LevelData {
  const cols = 120;
  const rows = 26;
  const tilemap = new Tilemap(cols, rows);

  // Default fill: Void outside
  tilemap.fillRect(0, 0, cols - 1, rows - 1, TileType.VOID);

  // Boundary walls
  const buildRoom = (x1: number, y1: number, x2: number, y2: number, floorType: TileType) => {
    tilemap.fillRect(x1, y1, x2, y2, floorType);
    for (let x = x1; x <= x2; x++) {
      tilemap.set(x, y1, TileType.WALL_CONCRETE);
      tilemap.set(x, y2, TileType.WALL_CONCRETE);
    }
    for (let y = y1; y <= y2; y++) {
      tilemap.set(x1, y, TileType.WALL_CONCRETE);
      tilemap.set(x2, y, TileType.WALL_CONCRETE);
    }
  };

  // 1. Hospital Ward (Cols 2 - 16, Rows 8 - 18)
  buildRoom(2, 8, 16, 18, TileType.FLOOR_WARD);
  // Opening door to corridor
  tilemap.set(16, 13, TileType.FLOOR_WARD);
  tilemap.set(16, 14, TileType.FLOOR_WARD);

  // Beds in ward
  tilemap.set(4, 10, TileType.DECOR_BED);
  tilemap.set(4, 13, TileType.DECOR_BED);
  tilemap.set(4, 16, TileType.DECOR_BED);
  tilemap.set(8, 10, TileType.DECOR_BED);

  // Desk with note
  tilemap.set(13, 10, TileType.DECOR_DESK);

  // 2. Ruined Corridor & Rubble Passage (Cols 16 - 32, Rows 11 - 16)
  buildRoom(16, 11, 32, 16, TileType.FLOOR_WARD);
  tilemap.set(16, 13, TileType.FLOOR_WARD);
  tilemap.set(16, 14, TileType.FLOOR_WARD);
  tilemap.set(32, 13, TileType.FLOOR_MOSS);
  tilemap.set(32, 14, TileType.FLOOR_MOSS);

  // Rubble crates
  tilemap.set(22, 12, TileType.COVER_CRATE);
  tilemap.set(27, 15, TileType.COVER_CRATE);

  // 3. Hospital Courtyard & Outpost (Cols 32 - 58, Rows 6 - 20)
  buildRoom(32, 6, 58, 20, TileType.FLOOR_MOSS);
  tilemap.set(32, 13, TileType.FLOOR_MOSS);
  tilemap.set(32, 14, TileType.FLOOR_MOSS);
  // Exit to highway
  tilemap.set(58, 12, TileType.FLOOR_ASPHALT);
  tilemap.set(58, 13, TileType.FLOOR_ASPHALT);
  tilemap.set(58, 14, TileType.FLOOR_ASPHALT);

  // Courtyard sandbags & barriers
  tilemap.fillRect(38, 9, 38, 12, TileType.COVER_SANDBAG);
  tilemap.fillRect(40, 16, 43, 16, TileType.COVER_SANDBAG);

  // Old Zhou's campsite shelter (corner of courtyard)
  tilemap.fillRect(48, 7, 56, 12, TileType.FLOOR_MOSS);
  tilemap.set(52, 9, TileType.DECOR_CAMPFIRE);
  tilemap.set(50, 7, TileType.COVER_CRATE);
  tilemap.set(55, 7, TileType.COVER_CRATE);

  // 4. Highway Intersection & Ambulance (Cols 58 - 86, Rows 8 - 18)
  buildRoom(58, 8, 86, 18, TileType.FLOOR_ASPHALT);
  tilemap.set(58, 12, TileType.FLOOR_ASPHALT);
  tilemap.set(58, 13, TileType.FLOOR_ASPHALT);
  tilemap.set(58, 14, TileType.FLOOR_ASPHALT);

  // Gate to military outpost
  tilemap.set(86, 12, TileType.FLOOR_ASPHALT);
  tilemap.set(86, 13, TileType.FLOOR_ASPHALT);

  // Vehicles & obstacles on highway
  tilemap.set(65, 11, TileType.DECOR_VEHICLE);
  tilemap.set(73, 14, TileType.DECOR_VEHICLE);
  tilemap.set(78, 10, TileType.COVER_SANDBAG);
  tilemap.set(78, 11, TileType.COVER_SANDBAG);

  // 5. Military Checkpoint & Turret Zone (Cols 86 - 105, Rows 7 - 19)
  buildRoom(86, 7, 105, 19, TileType.FLOOR_ASPHALT);
  tilemap.set(86, 12, TileType.FLOOR_ASPHALT);
  tilemap.set(86, 13, TileType.FLOOR_ASPHALT);

  // Heavy sandbag defensive line
  tilemap.fillRect(94, 8, 94, 11, TileType.COVER_SANDBAG);
  tilemap.fillRect(94, 15, 94, 18, TileType.COVER_SANDBAG);
  tilemap.set(97, 13, TileType.WALL_FENCE);

  // Exit to railway
  tilemap.set(105, 12, TileType.FLOOR_MOSS);
  tilemap.set(105, 13, TileType.FLOOR_MOSS);
  tilemap.set(105, 14, TileType.FLOOR_MOSS);

  // 6. Railway to South Station (Cols 105 - 118, Rows 9 - 17)
  buildRoom(105, 9, 118, 17, TileType.DECOR_RAILS);
  tilemap.set(105, 12, TileType.DECOR_RAILS);
  tilemap.set(105, 13, TileType.DECOR_RAILS);
  tilemap.set(105, 14, TileType.DECOR_RAILS);

  // Player start (Hospital bed)
  const player = new Player(6 * TILE, 13 * TILE);

  // Pickups
  const pickups: PickupItem[] = [
    // 1. Wooden stick in the rubble corridor
    {
      id: 'pickup_stick',
      type: 'weapon',
      payload: 'stick',
      x: 24 * TILE,
      y: 13.5 * TILE,
      radius: 12,
      name: '廢墟棍棒 (Stick)',
      collected: false,
    },
    // 2. Combat knife hidden near courtyard crates
    {
      id: 'pickup_knife',
      type: 'weapon',
      payload: 'knife',
      x: 44 * TILE,
      y: 8 * TILE,
      radius: 12,
      name: '戰術軍刀 (Combat Knife)',
      collected: false,
    },
    // 3. Adrenaline injector near abandoned ambulance
    {
      id: 'pickup_adrenaline',
      type: 'adrenaline',
      x: 74 * TILE,
      y: 11 * TILE,
      radius: 12,
      name: '軍用腎上腺素 (Adrenaline)',
      collected: false,
    },
  ];

  // Enemies
  const enemies: EnemyLooter[] = [
    // First looter in courtyard
    new EnemyLooter(37 * TILE, 14 * TILE),
    // Second looter patrolling highway intersection
    new EnemyLooter(68 * TILE, 13 * TILE),
    // Third looter near ambulance
    new EnemyLooter(77 * TILE, 15 * TILE),
  ];

  // Sentry Turret
  const turrets: SentryTurret[] = [
    new SentryTurret(98 * TILE, 13 * TILE),
  ];

  // NPC Old Zhou
  const npcZhou = new NPCZhou(52 * TILE, 10 * TILE);

  // Triggers
  const triggers: StoryTrigger[] = [
    // Trigger 1: Found note on desk
    {
      id: 'found_note',
      flag: 'found_note',
      rx: 11 * TILE,
      ry: 9 * TILE,
      rw: 4 * TILE,
      rh: 4 * TILE,
      prompt: '[E] 閱讀公告',
      fired: false,
      onEnter: (game) => {
        game.openDialogue(foundNoteScript);
      },
    },
    // Trigger 2: Warn looter 1
    {
      id: 'warn_looter',
      flag: 'warn_looter',
      rx: 31 * TILE,
      ry: 11 * TILE,
      rw: 2 * TILE,
      rh: 5 * TILE,
      fired: false,
      onEnter: (game) => {
        game.openDialogue(warningLooterScript);
      },
    },
    // Trigger 3: Adrenaline trigger
    {
      id: 'found_adrenaline',
      flag: 'found_adrenaline',
      rx: 72 * TILE,
      ry: 10 * TILE,
      rw: 4 * TILE,
      rh: 3 * TILE,
      fired: false,
      onEnter: (game) => {
        game.openDialogue(findAdrenalineScript);
      },
    },
    // Trigger 4: Warn turret
    {
      id: 'warn_turret',
      flag: 'warn_turret',
      rx: 88 * TILE,
      ry: 10 * TILE,
      rw: 2 * TILE,
      rh: 6 * TILE,
      fired: false,
      onEnter: (game) => {
        game.openDialogue(warningTurretScript);
      },
    },
    // Trigger 5: Chapter exit on railway
    {
      id: 'chapter_end',
      flag: 'chapter_end',
      rx: 115 * TILE,
      ry: 10 * TILE,
      rw: 3 * TILE,
      rh: 6 * TILE,
      prompt: '前往舊車站（完成第一章）',
      fired: false,
      onEnter: (game) => {
        game.openCutscene([
          { type: 'dialogue', script: closingScript },
          { type: 'fadeOut', seconds: 1.5 },
        ], () => {
          game.state = 'ending';
          game.audio.win();
        });
      },
    },
  ];

  return {
    name: '第一章：甦醒',
    tilemap,
    player,
    enemies,
    turrets,
    npcZhou,
    pickups,
    triggers,
  };
}
