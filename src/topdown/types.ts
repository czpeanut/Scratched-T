// Types and interfaces for the Top-Down Action Shooter (焦土台灣)

export type WeaponType = 'melee' | 'ranged';

export interface WeaponDef {
  id: string;
  name: string;
  type: WeaponType;
  damage: number;
  range: number;
  // Melee specific
  windup?: number;
  active?: number;
  recover?: number;
  cooldown?: number;
  lunge?: number;
  hitstop?: number;
  knockback: number;
  anim?: string;
  // Ranged specific
  fireRate?: number;
  aimRampTime?: number; // Time in seconds to reach minimum spread (pinpoint aim)
  spreadMax?: number;   // Maximum spread angle in radians (hip-fire / moving)
  spreadMin?: number;   // Minimum spread angle in radians (steadied aim)
  bloom?: number;       // Recoil spread added per shot
  moveSpread?: number;  // Additional spread added when moving
  kick?: number;        // Camera kick in pixels
  trauma?: number;      // Screen shake trauma
  recoil?: number;      // Backward velocity kick to player
  tracerColor?: string;
}

export interface DialogueChoice {
  text: string;
  next: string;
}

export interface DialogueNode {
  speaker?: string;
  lines: string[];
  choices?: DialogueChoice[];
  next?: string;
  flag?: string;
  action?: (game: any) => void;
}

export interface DialogueScript {
  start: string;
  nodes: Record<string, DialogueNode>;
}

export interface CutsceneStep {
  type: 'fadeIn' | 'fadeOut' | 'wait' | 'dialogue';
  seconds?: number;
  script?: DialogueScript | (() => DialogueScript);
}

export type GameState = 'title' | 'playing' | 'dialogue' | 'cutscene' | 'paused' | 'dead' | 'won' | 'ending';
