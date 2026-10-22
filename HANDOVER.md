# 焦土台灣 (Hollow Runner) - 3/4 俯視角末日動作射擊開發交接與架構文件 (HANDOVER)

本文件專為接手的 AI Agent 與工程師編寫，詳細記錄將遊戲重構為 **3/4 俯視角（3/4 Overhead Perspective，似《Enter the Gungeon》、《Zelda》風格）戰術末日生存射擊動作遊戲** 的所有架構、狀態機、AI 逐禎運動貼圖與擴展指引。

---

## 1. 遊戲背景與核心重構目標

* **遊戲題材**：《焦土台灣：第一章 甦醒》—— 主角在戰後五年昏迷甦醒於廢墟醫院，面對廢土掠奪者、軍用自動哨戒砲塔，並偶遇老周取得武器與生存情報。
* **視角風格**：**3/4 俯視角 (3/4 Overhead Perspective)**
  - 角色與敵人立體直立呈現（非垂直頭頂純鳥瞰），具備前後側面貌、四肢運動、手持武器與投射在地面的橢圓接觸陰影。
  - 深度排序（Y-Sorting）：實體依據 `y` 座標動態排序繪製，角色在掩體或敵人前方時自然覆蓋，在後方時呈現真實遮擋。
  - 牆體立面（Wall Facades）：具備 3D 立面高度、混擬土裂痕材質（`tile_fill.png`）、頂部雜草封蓋（`tile_cap.png`）與向南面的投射陰影。
* **AI 逐禎運動貼圖 (Frame-by-Frame Motion Sprites)**：
  - **主角 (Player)**：載入 `/assets/ai/player.png` (64x48) 包含 12 行狀態動畫：`idle` (4 禎)、`run` (6 禎)、`dash` (2 禎)、`punch` (3 禎)、`stick` (3 禎)、`knife` (3 禎)、`gunStand` (4 禎)、`gunRun` (6 禎)、`hurt` (2 禎)。
  - **手槍手臂 (Gun Arm)**：載入 `/assets/ai/gun_arm.png` (48x48)，在 3/4 視角中繞角色肩膀 360 度精準跟隨滑鼠/十字準星轉向，並帶有槍口火焰與退殼粒子。
  - **掠奪者劫匪 (Enemy Looter)**：載入 `/assets/ai/walker.png` (48x48) 包含 `walk` (4 禎巡邏潛行)、`charge` (2 禎衝刺)、`attack` (4 禎揮刀斬擊)。
  - **老周 (NPC Zhou)**：載入 `/assets/ai/zhou.png` (48x48) 包含 3 禎坐在暖色營火旁呼吸烤火的動畫。
  - **場景貼圖**：整合 `/assets/ai/tile_fill.png` 與 `/assets/ai/tile_cap.png` 為公路、走廊、廢墟瓦礫提供紋理。
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
        ├── tilemap.ts            # 格狀地圖系統、阻擋碰撞、光線射線檢測 (Raycasting)
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
   - 顯示「AIM LOCK」提示與琥珀色高亮。
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

## 7. 雙搖桿 360° 轉向與解耦肢體系統 (Twin-Stick Decoupled Articulation)

為達到商業市售 2D 動作遊戲（如《Enter the Gungeon》、《Hades》、《Nuclear Throne》）標準，角色與實體採用徹底解耦的關節化 360 度轉動架構：
1. **雙腿獨立步態 (Decoupled Walking Gait)**：
   - 步態角度完全獨立由運動向量 $\theta_{\text{move}} = \text{atan2}(v_y, v_x)$ 決定。
   - 雙腳依 $\sin(\text{walkCycle})$ 沿移動法向交替擺動邁步，奔跑時步頻提升，停步時自然歸位。
2. **軀幹與前傾 (Torso Lean & Posture)**：
   - 軀幹依衝刺加速度與移動方向產生傾角，並呈現微幅呼吸起伏。
3. **頭部 360° 視線鎖定 (Head Tracking)**：
   - 頭部精確鎖定十字準星，眼睛瞳孔隨視角旋轉偏移；朝上瞄準時自動轉為後腦兜帽立體陰影。
4. **武器與手臂 360° 軌道旋轉與 Z 軸深度排序 (Z-Sorted Orbiting Weapons)**：
   - 武器與雙手沿肩膀關節 360° 自由軌道旋轉，對準準星。
   - **前後深度遮擋**：當 $\sin(\theta_{\text{aim}}) < -0.15$（朝上或後方瞄準）時，武器與雙臂自動渲染於身體**後方**（Behind Body）；當 $\sin(\theta_{\text{aim}}) \ge -0.15$ 時，渲染於身體**前方**。
   - 開火時具備軸向反作用力後座力位移（Recoil Kick）與槍口火光。
5. **敵人平滑角速度追蹤 (Smooth Angular Slerp for Enemies)**：
   - 掠奪者透過 `rotateAngle` 平滑旋轉朝向玩家，不再生硬翻轉；警戒時身體前傾並顯示警惕面朝標記。
   - NPC 老周接近時頭部與視線平滑注視玩家。

---

## 8. 動態戰術光照與廢土環境細節 (Dynamic Lighting & High-Fidelity Ruins)

為達到現代獨立神作（如《Signalis》、《Synthetik》、《Teleglitch》、《Hotline Miami》）的沉浸光影氛圍，本專案實作了即時離屏遮罩動態光照系統（Offscreen Destination-Out Lighting Pipeline）：

1. **離屏光照畫布 (Offscreen Light Canvas)**：
   - 建立獨立離屏畫布 `lightCanvas` (640x360)，每禎預填廢土夜幕低光環境色 `rgba(5, 7, 14, 0.88)`。
   - 使用 `globalCompositeOperation = 'destination-out'` 物理剔除黑暗，呈現平滑光衰（Radial Gradient Falloff）。
2. **戰術手電筒光錐 (Tactical Flashlight Cone)**：
   - 從主角頭部向瞄準角 `facingAngle` 360° 投射 60° 寬廣錐形光束（長度 270px），外帶微光半影（Penumbra）。
   - 當長按右鍵/U/觸控進入**遠射瞄準 (ADS)** 時，光束自動聚焦收窄至 40°，長度延伸至 350px，增強遠程探索視野。
   - 疊加 `lighter` 加法混合之微光藍色體積光錐 (`rgba(160, 215, 255, 0.08)`)。
   - 包含角色的 46px 腳下近身微光環（Aura），確保黑暗中足部與地面落差清晰可見。
3. **老周營火點光源 (Campfire Point Light)**：
   - 老周營地 `(52, 9)` 之鋼桶營火釋放半徑 145px 之動態暖光。
   - 結合雙正弦物理呼吸閃爍 `sin(9t) * 8 + cos(14t) * 4`，自然模擬柴火躍動。
   - 加法混合層疊加暖琥珀色環境色散 (`rgba(255, 175, 75, 0.24)`)，照亮周圍老周、沙袋與廢墟箱。
4. **槍口火光動態爆閃 (Muzzle Flash Dynamic Illumination)**：
   - 玩家或哨戒砲塔開火瞬間，0.08 秒內在槍口爆發 190px 半徑之強烈暖白閃光，瞬間照亮周圍房間與敵人輪廓。
5. **光束懸浮灰塵微粒 (Illuminated Airborne Dust Motes)**：
   - 畫面飄浮 35 顆微粒，隨風在廢土緩慢漂移。
   - 當微粒進入手電筒光錐範圍內時，透明度與反光即時提高（高亮微光閃爍），營造戰術廢墟電影感。
6. **高品質廢墟場景紋理 (High-Fidelity Environment Tiles)**：
   - **醫院病房地面**：交錯防滑地磚、老化裂痕、破碎藥水玻璃碎片（微光白點與藍色反光）。
   - **公路瀝青**：深色碎石瀝青、龜裂紋理、黃色雙虛線、以及積水雨漥（帶有陰天天空鏡面反光亮條）。
   - **瓦礫荒地**：深綠雜草苔蘚、碎石瓦礫塊。
   - **混擬土破壁**：受損牆角露出外露生鏽鋼筋（Rusty Rebar Rods）、軍用標記 `[WARD 01]`、`[OUTPOST]`、底層垂直 3D 立面投射接觸陰影。
   - **鐵絲網圍欄**：頂部環形刺絲滾網、加固鋼柱。
   - **障礙物細節**：麻袋交叉縫線、醫療病床外掛點滴注射架（含半透明生理食鹽水袋）、軍規木箱鋼角鉚釘與噴漆標號 `[S-4]`、巡邏車殘骸碎裂蛛網擋風玻璃與毀損警報紅藍燈。
