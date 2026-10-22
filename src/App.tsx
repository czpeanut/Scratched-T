import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine } from './topdown/game';
import { VIEW, WEAPONS } from './topdown/constants';
import { GameState, WeaponDef } from './topdown/types';

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameState, setGameState] = useState<GameState>('title');
  const [hp, setHp] = useState<number>(5);
  const [maxHp, setMaxHp] = useState<number>(5);
  const [stamina, setStamina] = useState<number>(1.0);
  const [weapon, setWeapon] = useState<WeaponDef>(WEAPONS.fists);
  const [unlockedWeapons, setUnlockedWeapons] = useState<string[]>(['fists']);
  const [isAiming, setIsAiming] = useState<boolean>(false);
  const [aimProgress, setAimProgress] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [canvasStyle, setCanvasStyle] = useState<{ width: string; height: string }>({
    width: `${VIEW.width * 2}px`,
    height: `${VIEW.height * 2}px`,
  });

  // Responsive Canvas Sizing (Integer/half-step scaling)
  const handleResize = useCallback(() => {
    const scale = Math.min(window.innerWidth / VIEW.width, window.innerHeight / VIEW.height);
    const snapped = scale >= 2 ? Math.floor(scale) : scale >= 1 ? Math.floor(scale * 2) / 2 : scale;
    setCanvasStyle({
      width: `${Math.floor(VIEW.width * snapped)}px`,
      height: `${Math.floor(VIEW.height * snapped)}px`,
    });
  }, []);

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  // Mount Game Engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine(canvas);
    engineRef.current = engine;

    engine.onStateChange = (state) => {
      setGameState(state);
    };

    engine.onHudUpdate = (data) => {
      setHp(data.hp);
      setMaxHp(data.maxHp);
      setStamina(data.stamina);
      setWeapon(data.weapon);
      setUnlockedWeapons(data.unlockedWeapons);
      setIsAiming(data.isAiming);
      setAimProgress(data.aimProgress);
    };

    engine.start();

    // Direct canvas click to start from title
    const handleCanvasClick = () => {
      if (engine.state === 'title') {
        engine.startGamePlay();
      }
    };
    canvas.addEventListener('click', handleCanvasClick);

    return () => {
      canvas.removeEventListener('click', handleCanvasClick);
      engine.stop();
    };
  }, []);

  // Handle Touch Controls
  const handleTouchDown = (action: string) => {
    engineRef.current?.audio.unlock();
    engineRef.current?.input.touchDown(action);
    if (gameState === 'title') {
      engineRef.current?.startGamePlay();
    }
  };

  const handleTouchUp = (action: string) => {
    engineRef.current?.input.touchUp(action);
  };

  const handleWeaponSelect = (id: string) => {
    engineRef.current?.player.equipWeapon(id);
  };

  const toggleMute = () => {
    if (engineRef.current) {
      const muted = engineRef.current.audio.toggleMute();
      setIsMuted(muted);
    }
  };

  const handleRestart = () => {
    engineRef.current?.restartLevel();
  };

  return (
    <div className="relative w-screen h-screen flex items-center justify-center bg-[#05070e] overflow-hidden select-none">
      {/* 2D Canvas */}
      <canvas
        ref={canvasRef}
        id="game"
        className="pixel-canvas block z-0"
        style={canvasStyle}
      />

      {/* Top Floating HUD (Only shown during playing, dialogue, or paused) */}
      {gameState !== 'title' && (
        <div className="absolute top-3 left-4 right-4 flex items-center justify-between pointer-events-none z-10 text-xs">
          {/* Left: Health & Stamina */}
          <div className="flex flex-col gap-1.5 bg-[#0b101c]/80 border border-[#23314f] p-2 rounded shadow-lg backdrop-blur-sm pointer-events-auto">
            {/* Health Hearts/Blocks */}
            <div className="flex items-center gap-1.5">
              <span className="text-[#7fd4ff] font-bold text-[10px] tracking-wider">HP</span>
              <div className="flex gap-1">
                {Array.from({ length: maxHp }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-3.5 h-3.5 rounded-sm border ${
                      i < hp
                        ? 'bg-[#7fd4ff] border-[#b0e7ff] shadow-[0_0_6px_#7fd4ff]'
                        : 'bg-[#1b2336] border-[#2c3852]'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Stamina Bar */}
            <div className="flex items-center gap-1.5">
              <span className="text-[#ffe169] font-bold text-[10px] tracking-wider">體力</span>
              <div className="w-24 h-2 bg-[#1b2336] border border-[#3b4760] rounded-sm overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#e6b830] to-[#ffe680] transition-all duration-75"
                  style={{ width: `${Math.round(stamina * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Center: Aim Reticle Precision Status */}
          {weapon.type === 'ranged' && (
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-all duration-150 backdrop-blur-sm ${
                aimProgress > 0.95
                  ? 'bg-[#ffe082]/20 border-[#ffe082] text-[#ffe082] shadow-[0_0_10px_rgba(255,224,130,0.4)]'
                  : isAiming
                  ? 'bg-[#7fd4ff]/15 border-[#7fd4ff] text-[#7fd4ff]'
                  : 'bg-[#0b101c]/60 border-[#23314f] text-[#6c7c9e]'
              }`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  aimProgress > 0.95
                    ? 'bg-[#ffe082] animate-ping'
                    : isAiming
                    ? 'bg-[#7fd4ff]'
                    : 'bg-[#3b4760]'
                }`}
              />
              <span className="font-bold text-[11px] tracking-wide">
                {aimProgress > 0.95
                  ? '★ 準星鎖定 (最高精準 / 長射程)'
                  : isAiming
                  ? `瞄準中 ${(aimProgress * 100).toFixed(0)}% (準星收窄)`
                  : '腰射狀態 (按住右鍵或U縮小準星)'}
              </span>
            </div>
          )}

          {/* Right: Equipped Weapon Selector & Mute */}
          <div className="flex items-center gap-2 pointer-events-auto">
            <div className="flex gap-1 bg-[#0b101c]/80 border border-[#23314f] p-1.5 rounded shadow-lg backdrop-blur-sm">
              {['fists', 'stick', 'knife', 'pistol'].map((id, idx) => {
                const w = WEAPONS[id];
                const isUnlocked = unlockedWeapons.includes(id);
                const isEquipped = weapon.id === id;
                return (
                  <button
                    key={id}
                    onClick={() => isUnlocked && handleWeaponSelect(id)}
                    disabled={!isUnlocked}
                    className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${
                      isEquipped
                        ? 'bg-[#7fd4ff] text-[#080a14] shadow-[0_0_8px_#7fd4ff]'
                        : isUnlocked
                        ? 'bg-[#18233b] text-[#cfe4ff] hover:bg-[#233355]'
                        : 'bg-[#10141e] text-[#3e485e] cursor-not-allowed opacity-50'
                    }`}
                  >
                    [{idx + 1}] {w.name}
                  </button>
                );
              })}
            </div>

            <button
              onClick={toggleMute}
              className="px-2.5 py-1.5 rounded bg-[#0b101c]/80 border border-[#23314f] text-[#9bb3d9] hover:text-white hover:border-[#7fd4ff] transition-colors"
              title="切換靜音 (M)"
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
          </div>
        </div>
      )}

      {/* Bottom Controls Hint Bar (Keyboard users) */}
      {gameState === 'playing' && (
        <div className="fixed bottom-2 left-0 right-0 text-center text-[#4a5a80] text-[11px] pointer-events-none select-none tracking-wide hidden md:block">
          WASD 移動 &nbsp;·&nbsp; 空白鍵 翻滾 &nbsp;·&nbsp; LMB / J 攻擊 &nbsp;·&nbsp;
          <span className="text-[#ffe082]"> RMB / U 瞄準縮小準星</span> &nbsp;·&nbsp;
          Shift 奔跑 &nbsp;·&nbsp; 1-4 換武器 &nbsp;·&nbsp; E 調查/交談 &nbsp;·&nbsp; ESC 暫停
        </div>
      )}

      {/* Touch Controls Overlay (Mobile / Touch devices) */}
      <div className="fixed inset-0 pointer-events-none touch-none z-20 md:opacity-90">
        {/* D-Pad (Bottom Left) */}
        <div className="fixed left-4 bottom-4 grid grid-cols-3 grid-rows-3 gap-2 w-36 h-36 pointer-events-auto">
          <div />
          <button
            onPointerDown={() => handleTouchDown('up')}
            onPointerUp={() => handleTouchUp('up')}
            className="flex items-center justify-center rounded-full bg-[#12182a]/75 border border-[#7fd4ff]/35 active:bg-[#7fd4ff]/40 text-[#cfe4ff] text-base font-bold shadow-md"
          >
            ▲
          </button>
          <div />
          <button
            onPointerDown={() => handleTouchDown('left')}
            onPointerUp={() => handleTouchUp('left')}
            className="flex items-center justify-center rounded-full bg-[#12182a]/75 border border-[#7fd4ff]/35 active:bg-[#7fd4ff]/40 text-[#cfe4ff] text-base font-bold shadow-md"
          >
            ◀
          </button>
          <div />
          <button
            onPointerDown={() => handleTouchDown('right')}
            onPointerUp={() => handleTouchUp('right')}
            className="flex items-center justify-center rounded-full bg-[#12182a]/75 border border-[#7fd4ff]/35 active:bg-[#7fd4ff]/40 text-[#cfe4ff] text-base font-bold shadow-md"
          >
            ▶
          </button>
          <div />
          <button
            onPointerDown={() => handleTouchDown('down')}
            onPointerUp={() => handleTouchUp('down')}
            className="flex items-center justify-center rounded-full bg-[#12182a]/75 border border-[#7fd4ff]/35 active:bg-[#7fd4ff]/40 text-[#cfe4ff] text-base font-bold shadow-md"
          >
            ▼
          </button>
          <div />
        </div>

        {/* Action Buttons (Bottom Right) */}
        <div className="fixed right-4 bottom-4 grid grid-cols-3 grid-rows-2 gap-2 pointer-events-auto">
          {/* Aim Down Sights (瞄準 - Crucial Feature) */}
          <button
            onPointerDown={() => handleTouchDown('aim')}
            onPointerUp={() => handleTouchUp('aim')}
            className={`w-14 h-14 rounded-full border text-xs font-bold shadow-lg transition-all flex flex-col items-center justify-center ${
              isAiming
                ? 'bg-[#ffe082]/40 border-[#ffe082] text-[#ffe082] scale-95 shadow-[0_0_12px_#ffe082]'
                : 'bg-[#142138]/80 border-[#7fd4ff]/50 text-[#7fd4ff]'
            }`}
          >
            <span>瞄準</span>
            <span className="text-[9px] opacity-75">縮圈</span>
          </button>

          <button
            onPointerDown={() => handleTouchDown('interact')}
            onPointerUp={() => handleTouchUp('interact')}
            className="w-14 h-14 rounded-full bg-[#12182a]/75 border border-[#7fd4ff]/35 active:bg-[#7fd4ff]/40 text-[#cfe4ff] text-xs font-bold shadow-md"
          >
            交談
          </button>

          <button
            onPointerDown={() => handleTouchDown('sprint')}
            onPointerUp={() => handleTouchUp('sprint')}
            className="w-14 h-14 rounded-full bg-[#12182a]/75 border border-[#7fd4ff]/35 active:bg-[#7fd4ff]/40 text-[#cfe4ff] text-xs font-bold shadow-md"
          >
            奔跑
          </button>

          {/* Fire / Melee Attack */}
          <button
            onPointerDown={() => handleTouchDown('fire')}
            onPointerUp={() => handleTouchUp('fire')}
            className="w-14 h-14 rounded-full bg-[#3d1824]/85 border border-[#ff4d6d]/60 active:bg-[#ff4d6d]/40 text-[#ffcad4] text-xs font-bold shadow-lg"
          >
            攻擊
          </button>

          {/* Dash / Roll */}
          <button
            onPointerDown={() => handleTouchDown('dash')}
            onPointerUp={() => handleTouchUp('dash')}
            className="w-14 h-14 rounded-full bg-[#12182a]/75 border border-[#7fd4ff]/35 active:bg-[#7fd4ff]/40 text-[#cfe4ff] text-xs font-bold shadow-md"
          >
            翻滾
          </button>

          {/* Weapon Swap */}
          <button
            onPointerDown={() => handleTouchDown('swap')}
            onPointerUp={() => handleTouchUp('swap')}
            className="w-14 h-14 rounded-full bg-[#1d2740]/80 border border-[#7fd4ff]/40 active:bg-[#7fd4ff]/50 text-[#ffe082] text-xs font-bold shadow-md"
          >
            換槍
          </button>
        </div>
      </div>

      {/* Dead Overlay */}
      {gameState === 'dead' && (
        <div className="absolute inset-0 bg-[#080204]/85 backdrop-blur-sm flex flex-col items-center justify-center z-30">
          <h2 className="text-3xl font-black text-[#ff3355] tracking-widest mb-2">你在廢墟中倒下了</h2>
          <p className="text-sm text-[#d48b99] mb-6">廢土沒有憐憫。整裝，重新出發。</p>
          <button
            onClick={handleRestart}
            className="px-6 py-2.5 rounded bg-[#ff3355] text-white font-bold tracking-wider hover:bg-[#ff4d6d] shadow-[0_0_15px_#ff3355] transition-all"
          >
            重新挑戰第一章 (R)
          </button>
        </div>
      )}

      {/* Pause Menu Modal */}
      {gameState === 'paused' && (
        <div className="absolute inset-0 bg-[#05070e]/80 backdrop-blur-sm flex flex-col items-center justify-center z-30">
          <div className="bg-[#0b1120] border border-[#233355] p-6 rounded-lg shadow-2xl max-w-sm w-full text-center">
            <h2 className="text-xl font-bold text-[#7fd4ff] mb-4">遊戲已暫停</h2>
            <div className="flex flex-col gap-2 mb-6">
              <button
                onClick={() => {
                  if (engineRef.current) {
                    engineRef.current.state = 'playing';
                    engineRef.current.notifyState();
                  }
                }}
                className="w-full py-2 bg-[#1b2b48] hover:bg-[#233962] text-[#e8f1ff] rounded font-bold transition-colors"
              >
                繼續遊戲
              </button>
              <button
                onClick={handleRestart}
                className="w-full py-2 bg-[#1b2b48] hover:bg-[#233962] text-[#e8f1ff] rounded font-bold transition-colors"
              >
                重新開始本章
              </button>
            </div>
            <p className="text-[11px] text-[#607294]">按 ESC 或 P 鍵隨時暫停 / 恢復</p>
          </div>
        </div>
      )}
    </div>
  );
};
