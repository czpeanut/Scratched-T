import { WeaponDef } from './types';

export const TILE = 32;

export const VIEW = {
  width: 640,
  height: 360,
};

export const COLORS = {
  bgVoid: '#04060c',
  floorTile: '#121724',
  floorAlt: '#181f30',
  floorRubble: '#1a2238',
  wallSolid: '#2a3550',
  wallTop: '#3b4b72',
  wallHighlight: '#53699c',
  coverObstacle: '#463c32',
  coverTop: '#68594b',
  hazardSpike: '#852b3e',

  player: '#e8f1ff',
  playerCore: '#7fd4ff',
  playerAimGuide: 'rgba(127, 212, 255, 0.45)',
  playerLaserAimed: 'rgba(255, 210, 122, 0.75)',

  enemyLooter: '#e64c65',
  enemyAlert: '#ffd24d',
  enemyTurret: '#ff9233',

  blood: '#b31e3b',
  bloodDark: '#6b0d20',
  muzzleFlash: '#ffe885',
  bulletTracer: '#ffe082',
  bulletTracerAimed: '#fff3c2',
  bulletEnemy: '#ff6688',

  hudHp: '#7fd4ff',
  hudStamina: '#ffe169',
  hudText: '#d8e5ff',
  hudDim: '#6c7c9e',
};

export const PLAYER_CONFIG = {
  radius: 11,
  runSpeed: 155,
  sprintSpeed: 245,
  aimSpeedMult: 0.65, // Slower deliberate tactical movement while aiming
  accel: 2200,
  friction: 2600,

  // Dodge-roll / Tactical dash
  dashSpeed: 380,
  dashDuration: 0.22,
  dashCooldown: 0.55,
  dashStaminaCost: 0.28,

  // Stamina
  staminaDrain: 0.32,
  staminaRegen: 0.28,
  staminaRegenDelay: 0.5,
  windedRecover: 0.35,

  maxHealth: 5,
  invulnOnHit: 1.1,
  knockbackDecay: 1800,
};

export const WEAPONS: Record<string, WeaponDef> = {
  fists: {
    id: 'fists',
    name: '赤手拳頭',
    type: 'melee',
    damage: 1,
    range: 30,
    windup: 0.06,
    active: 0.08,
    recover: 0.12,
    cooldown: 0.26,
    lunge: 90,
    hitstop: 0.04,
    knockback: 100,
  },
  stick: {
    id: 'stick',
    name: '廢墟棍棒',
    type: 'melee',
    damage: 2,
    range: 42,
    windup: 0.12,
    active: 0.1,
    recover: 0.18,
    cooldown: 0.42,
    lunge: 75,
    hitstop: 0.07,
    knockback: 180,
  },
  knife: {
    id: 'knife',
    name: '戰術軍刀',
    type: 'melee',
    damage: 3,
    range: 34,
    windup: 0.05,
    active: 0.06,
    recover: 0.1,
    cooldown: 0.22,
    lunge: 110,
    hitstop: 0.05,
    knockback: 80,
  },
  pistol: {
    id: 'pistol',
    name: '軍用手槍 (9mm)',
    type: 'ranged',
    damage: 4,
    knockback: 260,
    range: 480,
    fireRate: 0.3,
    // Aiming mechanic: holding aim tightens spread from spreadMax (hip-fire) to spreadMin (pinpoint)
    aimRampTime: 1.4, // Seconds to reach peak pinpoint accuracy
    spreadMax: 0.38,   // ~21.7 degrees half-angle spread (hip fire)
    spreadMin: 0.015,  // ~0.85 degrees pinpoint accuracy (steady aim)
    bloom: 0.24,       // Recoil kicks spread open on firing
    moveSpread: 0.12,  // Extra spread when moving while firing
    kick: 6,
    trauma: 0.32,
    recoil: 90,
    tracerColor: '#ffe48f',
  },
};
