# 焦土台灣 (Hollow Runner) - 3/4 俯視角末日動作射擊開發交接與架構文件 (HANDOVER)

本文件專為接手的 AI Agent 與工程師編寫，詳細記錄將遊戲重構為 **3/4 俯視角（3/4 Overhead Perspective，似《Enter the Gungeon》、《Zelda》風格）戰術末日生存射擊動作遊戲** 的所有架構、狀態機、AI 逐禎運動貼圖與擴展指引。

---

## 1. 遊戲背景與核心重構目標

* **遊戲題材**：《焦土台灣：第一章 甦醒》—— 主角在戰後五年昏迷甦醒於廢墟醫院，面對廢土掠奪者、軍用自動哨戒砲塔，並偶遇老周取得武器與生存情報。
* **視角風格**：**3/4 俯視角 (3/4 Overhead Perspective)**
  - 角色與敵人立體直立呈現（非垂直頭頂純鳥瞰），具備前後側面貌、四肢運動、手持武器與投射在地面的橢圓接觸陰影。
  - 深度排序（Y-Sorting）：牆、障礙物、拾取物與角色一起依「接地點」排序（角色用腳底 `y + FEET_OFFSET`，牆與道具用格子底緣），站在牆後會被牆擋住、站在牆前會蓋住牆。
  - 3/4 牆體：牆的頂面是格子往上平移 `WALL_H = 24px`，只有下方不是牆的格子才畫正立面；病房牆面用綠白醫院牆貼圖。
* **AI 美術（俯視角專用，`public/assets/td/`）**：全部由 Gemini 產生原圖、`tools/td_art.py` 後製（去背、切格、縮放、描邊、無縫化）。詳見第 9 節。
  - **主角 / 掠奪者**：`player.png`、`looter.png`，第 0–4 列走路（正面、背面、右側面、右下、右上）× 5 欄（待機 + 4 禎走路），每格 40x44，往左的三個方向用鏡像，共 8 個方向；第 5–7 列是單手揮擊（前搖、出手、收招），分別從斜前方、側面、背面看，往右揮，往左揮時鏡像。主角另有第 8–11 列：單手持槍瞄準（站立 + 4 禎走路），從斜前方、側面、背面看，以及正面朝鏡頭瞄準（這一列連槍都畫在圖上）。
  - **老周**：`zhou.png`，第 0 列 3 禎（待機、呼吸、玩家靠近時揮手），第 1 列 5 個方向的站姿，讓他能轉向說話對象。
  - **手持武器**：`weapon_stick/knife/pistol.png`，平常拿在角色圖本身的手上（各方向的手位置由 `td_art.py` 量出，寫入 `src/topdown/char-rig.ts`）。
  - **道具**：`prop_*.png`（病床、辦公桌、木箱、瓦礫、垃圾袋、沙包、汽車殘骸、機車、紅色塑膠椅、油桶火、哨戒砲塔、拾取物圖示）。
  - **地面 / 牆面材質**：`tex_*.png`（磨石子、柏油、紅磚、雜草石板、鐵軌、牆頂、牆面、醫院牆）。地面每 4x4 格隨機選一個鏡像版本，打散 128px 重複感。
* **近戰系統 (Melee)**：拳頭 (Fists)、廢墟棍棒 (Stick)、戰術軍刀 (Knife)。具備前搖 (windup)、打擊判定 (active arc)、硬直與擊退 (knockback & hitstop)。
* **槍械系統 (Ranged)**：軍用 9mm 手槍 (Pistol)。
* **核心射擊機制：遠射時瞄準縮小準星 (Aim-Down-Sights Dynamic Reticle)**：
  - **腰射 (Hip-fire)**：準星較大 (`spreadMax: 0.38 rad`)，移動與連發後座力會產生擴散 (bloom)。
  - **長按瞄準 (ADS)**：按住滑鼠右鍵、U 鍵或觸控「瞄準」按鈕，進入戰術瞄準姿態。準星四角標記與擴散圈平滑向中心收窄縮小至極限針尖 (`spreadMin: 0.015 rad`)。
  - **瞄準鎖定 (AIM LOCK)**：當瞄準進度到達 98% 以上時，發出鎖定音效，射程增加 25%，造成暴擊增傷與高穿透彈道，附帶雷射瞄準導引線。
* **技術架構**：React 19 + TypeScript + Vite，dev server 監聽 `0.0.0.0:3000` (配置 `allowedHosts: true`)。

---

## 2. 專案目錄與模組職責

```
/
├── metadata.json                 # AI Studio 規格檔 (名稱、能力聲明)
├── vite.config.ts                # Vite 設定 (React 插件、Port 3000、0.0.0.0)
├── tsconfig.json                 # TypeScript 設定
├── package.json                  # 依賴 (React 19, Vite, TypeScript 等)
├── index.html                    # 遊戲 HTML 入口，像素級 Canvas 設定
├── HANDOVER.md                   # 本交接文件
├── assets/td/src/                # Gemini 原圖（縮小存放），td_art.py 的輸入
├── public/assets/td/             # 遊戲實際載入的俯視角美術（td_art.py 輸出）
├── tools/td_art.py               # 俯視角美術後製（不需 API 金鑰）
├── tools/td_screens.mjs          # 固定位置截圖，檢查美術改動
└── src/
    ├── main.tsx                  # React 應用根入口
    ├── App.tsx                   # 主 UI 元件 (Canvas 掛載、HUD、觸控搖桿按鈕、暫停/死亡面板)
    ├── index.css                 # 像素渲染 CSS、Tailwind 設定
    └── topdown/                  # 俯視角遊戲引擎核心
        ├── types.ts              # 武器、對話、剪輯狀態型別
        ├── constants.ts          # 視口常數 (640x360)、武器數值、顏色配置
        ├── math.ts               # 2D 向量、圓形與 AABB 碰撞、角度運算
        ├── audio.ts              # 零依賴 WebAudio 聲音合成器 (槍聲、揮擊、命中、警報、鎖定音)
        ├── input.ts              # 統一輸入管理器 (鍵盤、滑鼠右鍵瞄準、觸控手勢、搖桿)
        ├── reticle.ts            # 【核心】動態縮圈準星渲染與精度運算
        ├── camera.ts             # 俯視角相機平滑跟隨、瞄準前瞻 (look-ahead) 與螢幕震動 (trauma)
        ├── particles.ts          # 地面血跡 Decal、彈道殘影 Tracer、刀光 Slash、彈殼 Shell、煙霧火花
        ├── tilemap.ts            # 格狀地圖、碰撞、射線（子彈 / 視線）、地面與 3/4 牆體 / 道具繪製
        ├── art.ts                # 俯視角美術資源表與繪製工具（角色朝向、道具、武器、受擊閃白）
        ├── dialogues.ts          # 第一章完整對話節點與分支腳本
        ├── story.ts              # 劇情 Flag 與能力解鎖管理 (sprint, received_gun 等)
        ├── level.ts              # 第一章地圖建造器 (病房、走廊、中庭、老周營地、公路、防禦哨塔、鐵軌)
        ├── entities.ts           # 角色 (Player)、劫匪 (EnemyLooter)、哨塔 (SentryTurret)、老周 (NPCZhou)、掉落物 (Pickup)
        └── game.ts               # 主遊戲循環 (60Hz Loop、狀態機、戰鬥判定、UI 渲染管線)
```

---

## 3. 核心戰鬥與準星縮小運算邏輯 (`src/topdown/reticle.ts` & `src/topdown/game.ts`)

### 準星收窄公式
1. `aimProgress` 在瞄準鍵按下時隨時間增加：
   $$\text{aimProgress} = \text{clamp}(\text{aimProgress} + \frac{dt}{\text{aimRampTime}}, 0, 1)$$
2. 有效散布角（弧度）：
   $$\text{baseSpread} = \text{lerp}(\text{spreadMax}, \text{spreadMin}, \text{aimProgress})$$
   $$\text{currentSpread} = \text{clamp}(\text{baseSpread} + \text{bloom} + \text{moveExtra}, \text{spreadMin}, \text{spreadMax} + 0.2)$$
3. 準星繪製半徑（像素）：
   $$\text{spreadRadiusPx} = \text{clamp}(\text{currentSpread} \times \min(dist, 300) \times 0.4 + 5, 4, 38)$$
4. 當 `aimProgress >= 0.98` 時：
   - 準星四角標記由外圍鎖定至中央（半徑僅約 4-5px）。
   - 顯示「鎖定」提示與琥珀色高亮。
   - 觸發 `audio.aimLock()` 提示音。
   - 開火時射線散布接近零，傷害 +2 暴擊，射程由 480px 延伸至 600px。

---

## 4. 操作鍵位對照表 (Controls)

| 動作 | 鍵盤 / 滑鼠 | 觸控按鈕 (Touch) | 說明 |
| :--- | :--- | :--- | :--- |
| **移動** | `W` `A` `S` `D` / 方向鍵 | 左下方虛擬十字鍵 (D-Pad) | 8 方向平滑移動，對角自動歸一化 |
| **攻擊 / 開火** | 滑鼠左鍵 (LMB) / `J` / `Z` | 右側【攻擊】按鈕 | 近戰揮擊或槍械射擊 |
| **【核心】瞄準縮圈** | 滑鼠右鍵 (RMB) / `U` / `X` | 右側【瞄準】按鈕 (長按) | 長按收窄準星，進入精準遠射模式 |
| **翻滾閃避** | 空白鍵 (`Space`) | 右側【翻滾】按鈕 | 獲得腎上腺素後解鎖，短暫無敵位移 |
| **戰術奔跑** | `Shift` / `L` | 右側【奔跑】按鈕 | 消耗體力加速移動 |
| **武器切換** | 數字鍵 `1` `2` `3` `4` / `Q` | 右側【換槍】按鈕 或 頂部 HUD | 拳頭、棍棒、軍刀、手槍切換 |
| **調查 / 交談** | `E` | 右側【交談】按鈕 | 閱讀公告、與老周對話、拾取道具 |
| **暫停** | `ESC` / `P` | 暫停選單 | 打開暫停畫面 |
| **靜音** | `M` | 頂部音效按鈕 | 切換 WebAudio 輸出 |
| **重新開始** | `R` | 死亡畫面按鈕 | 重新載入本章節 |

---

## 5. 後續 Agent 接手擴展指南

1. **新增後續章節關卡（例如第二章：舊車站）**：
   - 在 `src/topdown/level.ts` 中新增 `buildTopDownChapter2()` 函數。
   - 定義地圖尺寸（如 `cols = 160, rows = 30`），設置站台、月台、列車車廂遮擋等地圖塊。
   - 在 `src/topdown/dialogues.ts` 新增對應劇本。
2. **新增武器類型（例如散彈槍 Shotgun 或 突擊步槍 Rifle）**：
   - 在 `src/topdown/constants.ts` 的 `WEAPONS` 物件中新增武器定義（調整 `type: 'ranged'`, `spreadMax`, `spreadMin`, `aimRampTime`, `fireRate`, `damage`）。
   - 在 `Player.unlockedWeapons` 中提供解鎖邏輯即可在 HUD 與選單中無縫切換。
3. **新增敵人類型（例如持槍巡邏隊或遠程狙擊手）**：
   - 在 `src/topdown/entities.ts` 繼承或參照 `EnemyLooter` 與 `SentryTurret`，實作巡邏與射擊 AI。

---

## 6. 維運與問題排查紀錄 (Troubleshooting)

* **Vite 6+ / 8+ DNS Rebinding & Host 阻擋問題**：
  - **問題現象**：AI Studio 預覽環境外部 Host（`*.run.app`）發送請求時，Vite 預設安全機制會回傳 `403 Forbidden ("Blocked request. This host is not allowed.")`，造成畫面顯示 "The dev server didn't start"。
  - **解決方法**：在 `vite.config.ts` 的 `server` 與 `preview` 中設定 `allowedHosts: true`，允許容器在 Cloud Run / 反向代理下正常轉發請求。已驗證回傳 `HTTP 200 OK` 正常運作。

---

## 7. 角色繪製 (Directional Sprites)

1. **朝向**：依瞄準角 `facingAngle` 分成 8 個 45° 扇區（`art.ts` 的 `facingOf`），對應正面、右下、右、右上、背面五列，往左的三個方向鏡像。
2. **走路**：移動時欄位 = `1 + floor(walkCycle / 1.6) % 4`，靜止用第 0 欄。
3. **武器**：畫面上**永遠不另畫手臂**，只畫武器本身，放在角色圖自己的手上：
   - 平常：近戰武器拿在該朝向、該走路禎量出的那隻手上（`char-rig.ts` 的 `WEAPON_HAND[角色][列][欄]`），所以走路時會跟著手擺；往下垂、尖端朝面向的一側。空手時什麼都不畫。
   - 手槍：拿出手槍時角色改用持槍瞄準的列（`aimFacing`），手臂舉到肩膀高度，手槍畫在伸出去的手上指向準星（`AIM_HAND`）；往正下方瞄準用正面那列，槍已畫在圖上，不另畫手槍。槍口位置由 `Player.muzzlePoint` 計算，射擊判定與槍口火光共用；瞄準時有暗紅雷射線。
   - 揮擊時（前搖、出手、收招）角色換成第 5–7 列的揮擊動作圖（`attackFacing`：正面與斜前用斜前方那組、側面用側面、背面與斜後用背面），武器放在那一禎揮出去的拳頭上，順著前臂方向（`SWING_HAND`）。空手時揮擊圖本身就是出拳。
   - 走路時背對鏡頭（背面、右上、左上），武器畫在身體後面。
4. **回饋**：受擊用 `drawCharacterFlash` 把當前禎蓋一層淡色剪影；翻滾殘影也用同一剪影。掠奪者前搖時下沉並抖動，頭上顯示紅色「!」。
5. **砲塔**：`prop_turret.png`，依槍管方向左右鏡像，摧毀後變暗壓扁成殘骸。
6. **對話**：和老周交談時，兩人會立刻轉向對方，主角停止走動。選項可用數字鍵 1–4、W/S 加 E / 空白鍵、滑鼠移過去後點擊，或在觸控螢幕上直接點選；做出選擇時才執行該段對話的劇情動作。

---

## 8. 視線光照與色調 (Line-of-Sight Lighting)

1. **看得到的範圍**（`game.ts` 的 `viewParams` / `viewPolygon`）：朝瞄準方向約 ±55° 的視錐（260px，瞄準時 330px、±40°）加上身邊 84px 的近身範圍，兩者平滑銜接。180 條射線用 `raycast(..., sightOnly = true)` 只被牆擋住（病床、沙包、圍欄看得過去），命中點再多照 14px 讓牆面被照亮。
2. **看不到的地方**：疊一層暖暗色 `rgba(18, 10, 6, 0.72)`，變暗但仍看得出地形。視線多邊形以 `destination-out` 挖開並模糊 3px。
3. **敵人可見度**：每個掠奪者有 `seen`（0..1，平滑過渡）。在視線內才顯示；在背後追來時只顯示 40% 的淡影。
4. **光源**：老周的油桶火（固定點光源、閃爍）、槍口火光，都是暖色。
5. **色調**：整個畫面乘上一層淡琥珀色 (`multiply #fbe6cf`)；飄落灰燼、暖色暗角。標題、對話框、HUD、準星都改成同一套暖色（琥珀 `#e8b86a`、米白 `#f4e6cf`、深褐底）。
6. **介面**：觸控按鈕只在觸控裝置顯示（`pointer: coarse` 或有觸控點）；拾取物名稱只在靠近時出現；移除了牆上的英文標語。

---

## 9. 美術管線 (Art Pipeline)

* **布景陰影**：每個道具的陰影是它自己的輪廓，往右下偏移 3、2 像素畫在底下（`art.ts` 的 `drawCastShadow`），能貼住 3/4 視角物件所有碰到地面的邊。
* **側面持槍圖**：Gemini 那次沒照指示用洋紅背景，存進 `assets/td/src/` 前已從四邊填色換成洋紅。若重新生成，記得檢查背景。
* **揮擊動作圖**：Gemini 對「正下」和「右上」方向的揮擊常畫錯（轉成側身或露出正臉），所以只用斜前方、側面、背面三組。若某組的動作順序不同，用 `td_art.py` 的 `SWING_ORDER` 重新排列。
* **重建**（只做後製，不需 API 金鑰，約 3 秒）：`python3 tools/td_art.py`（需要 Pillow）。讀 `assets/td/src/`，寫入 `public/assets/td/`。
* **重新生成原圖**：`GEMINI_API_KEY=... python3 tools/gemini_gen.py OUT.png "prompt" --ref 參考圖.png`，模型 `gemini-3-pro-image`。角色一律附上參考圖以保持外觀一致；背景要求純洋紅 `#FF00FF` 方便去背。**金鑰只放環境變數，不要寫進任何檔案。**
* **新增道具**：在 `td_art.py` 的 `PROPS` 加一列（來源圖、第幾個物件、遊戲內寬度），在 `art.ts` 的道具清單加名字，然後在 `tilemap.ts` 的 `collectRenderables` 指定哪種格子用它，或在 `level.ts` 用 `tilemap.decor.push(...)` 自由擺放（要擋路就同時放一格 `PROP_SOLID`）。
* **檢查**：`npm run dev` 後執行 `node tools/td_screens.mjs http://127.0.0.1:3000/ screens`，會在 7 個固定地點加標題、對話各截一張圖，頁面有錯誤時以非零狀態結束。
