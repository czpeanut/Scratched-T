// Dialogue script data for Chapter 1: 甦醒 (Awakening)

import { DialogueScript } from './types';

export const wakeUpScript: DialogueScript = {
  start: 'a',
  nodes: {
    a: {
      speaker: '你',
      lines: ['……', '…是誰？', '這裡是……哪裡？'],
      next: 'b',
    },
    b: {
      speaker: '旁白',
      lines: [
        '腦袋像是灌了鉛，四肢也不聽使喚。',
        '花了好一段時間，意識才一點一點拼湊回來。',
      ],
      next: 'c',
    },
    c: {
      speaker: '旁白',
      lines: [
        '最後的記憶，停在五年前的那個晚上。',
        '之後的事，全是空白。',
      ],
    },
  },
};

export const foundNoteScript: DialogueScript = {
  start: 'a',
  nodes: {
    a: {
      speaker: '泛黃的公告',
      lines: [
        '牆角散落著一張泛黃的公告，字跡已經模糊。',
        '「因應戰事，即日起實施宵禁與物資管制——」',
        '公告的日期，是五年前。',
      ],
    },
  },
};

export const warningLooterScript: DialogueScript = {
  start: 'a',
  nodes: {
    a: {
      speaker: '直覺',
      lines: ['前方廢墟有動靜——是劫匪（Looter）。小心防備！'],
    },
  },
};

export const findAdrenalineScript: DialogueScript = {
  start: 'a',
  nodes: {
    a: {
      speaker: '醫療箱',
      lines: [
        '地上有一支廢棄的軍用腎上腺素注射筆，指針還沒歸零。',
        '注射之後，躺了五年的雙腿終於恢復了爆發力——解鎖【戰術奔跑】與【翻滾閃避】！',
        '（操作說明：按住 Shift 奔跑，雙擊或按空白鍵翻滾閃避）。',
      ],
      flag: 'found_adrenaline',
      action: (game) => {
        game.story.grantAbility('sprint');
        game.audio.pickup();
        game.hud.showMessage('已解鎖：戰術奔跑 / 翻滾閃避', 3.0);
      },
    },
  },
};

export const warningTurretScript: DialogueScript = {
  start: 'a',
  nodes: {
    a: {
      speaker: '警告',
      lines: [
        '警告：偵測到戰後殘存的軍用自主哨戒砲塔！',
        '它的旋轉紅外雷射正在掃描街道，善用沙袋與掩體靠近或繞行。',
      ],
    },
  },
};

export function getZhouScript(game: any): DialogueScript {
  if (game.story.hasFlag('received_gun')) {
    return {
      start: 'again',
      nodes: {
        again: {
          speaker: '老周',
          lines: [
            '往南邊走，順著舊鐵軌穿過廢棄公路，就能找到車站。',
            '記得用手槍時按住右鍵（或 U 鍵）拉緊準星，遠處的敵人才能一槍擊倒。',
            '路上多保重。',
          ],
        },
      },
    };
  }

  return {
    start: 'greet',
    nodes: {
      greet: {
        speaker: '老周',
        lines: ['……有活人？', '這年頭，能自己站著走進這片死地的，不多了。'],
        next: 'ask1',
      },
      ask1: {
        speaker: '你',
        lines: ['這裡……發生了什麼事？我昏迷了多久？'],
        next: 'explain1',
      },
      explain1: {
        speaker: '老周',
        lines: [
          '整整五年了，兄弟。',
          '五年前，戰事打到了本島，政府一夕之間就垮了。',
          '之後就沒有「之後」了——沒有警察，沒有法律，只剩下搶地盤的人。',
        ],
        next: 'explain2',
      },
      explain2: {
        speaker: '老周',
        lines: [
          '殘部躲進了山裡，三不五時下來巡邏，見人就抓去問話。',
          '劫匪比他們更狠，專挑落單的人下手。',
          '這座城，白天是廢墟，天一黑就成了獵場。',
        ],
        next: 'ask2',
      },
      ask2: {
        speaker: '你',
        lines: ['我的家人呢——我妻子和女兒，你知道她們的下落嗎？'],
        next: 'family',
      },
      family: {
        speaker: '老周',
        lines: [
          '……這名字我聽過。',
          '當年的撤離名單上有登記，但後來怎麼樣，誰也說不準。',
          '往南邊、順著舊鐵軌走，聽說車站那邊還有人聚居。她們要是還活著，也許就在那。',
        ],
        choices: [
          { text: '謝謝，我這就出發。', next: 'give' },
          { text: '這場戰爭，到底是怎麼開始的？', next: 'truth' },
        ],
      },
      truth: {
        speaker: '老周',
        lines: [
          '真相？呵。',
          '每個活下來的人，都有自己的一套說法，沒人說得準哪個才是真的。',
          '你要是真想知道，就得自己去挖——去找當年留下來的黑盒子紀錄。',
        ],
        next: 'give',
      },
      give: {
        speaker: '老周',
        lines: [
          '拿去吧，這把 9mm 軍用手槍我用不上了，這把老骨頭跑不動了。',
          '外面不比從前，該出手的時候別客氣。遠距離射擊時記得先按住右鍵瞄準，等準星縮到最小再開火！',
        ],
        flag: 'received_gun',
        action: (game2) => {
          game2.player.unlockWeapon('pistol');
          game2.player.equipWeapon('pistol');
          game2.audio.pickup();
          game2.hud.showMessage('獲得武器：軍用手槍 (按 4 或滑鼠切換)', 3.5);
        },
        next: 'farewell',
      },
      farewell: {
        speaker: '老周',
        lines: ['小心點，兄弟。', '活著，比什麼都重要。'],
      },
    },
  };
}

export const closingScript: DialogueScript = {
  start: 'a',
  nodes: {
    a: {
      speaker: '旁白',
      lines: [
        '南邊的舊車站，是他目前僅剩的線索。',
        '槍膛裡殘存的火藥味，混合著廢墟沉悶的濕氣。',
        '至於五年前那場浩劫真正的起點——答案，或許就藏在鐵軌彼端更深處的迷霧之中。',
      ],
    },
  },
};
