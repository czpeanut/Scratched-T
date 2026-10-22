// WebAudio procedural sound synthesizer for Top-Down Action Shooter

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  public muted: boolean = false;
  private volume: number = 0.35;
  private noiseBuffer: AudioBuffer | null = null;

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.02
      );
    }
    return this.muted;
  }

  private get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private getNoise(): AudioBufferSourceNode {
    if (!this.ctx) throw new Error('No audio context');
    if (!this.noiseBuffer) {
      const len = this.ctx.sampleRate * 0.5;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  tone({
    freq = 440,
    endFreq,
    type = 'square',
    dur = 0.12,
    gain = 0.3,
    delay = 0,
  }: {
    freq?: number;
    endFreq?: number;
    type?: OscillatorType;
    dur?: number;
    gain?: number;
    delay?: number;
  }) {
    if (!this.ctx || this.muted || !this.master) return;
    const t = this.now + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise({
    dur = 0.2,
    gain = 0.25,
    freq = 1200,
    endFreq,
    q = 1,
    delay = 0,
    type = 'lowpass',
  }: {
    dur?: number;
    gain?: number;
    freq?: number;
    endFreq?: number;
    q?: number;
    delay?: number;
    type?: BiquadFilterType;
  }) {
    if (!this.ctx || this.muted || !this.master) return;
    const t = this.now + delay;
    const src = this.getNoise();
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (endFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // Gunshot - sharp crack, punchy low thump, and distance echo
  shoot(isAimed: boolean = false) {
    this.noise({ dur: 0.1, gain: isAimed ? 0.38 : 0.32, freq: 6500, endFreq: 850 });
    this.tone({ freq: isAimed ? 700 : 580, endFreq: 120, type: 'square', dur: 0.08, gain: 0.12 });
    this.tone({ freq: 150, endFreq: 35, type: 'sine', dur: 0.22, gain: isAimed ? 0.42 : 0.32 });
    this.noise({ dur: 0.5, gain: 0.08, freq: 800, endFreq: 140, delay: 0.06 });
  }

  // Aim lock beep when crosshair reaches peak precision
  aimLock() {
    this.tone({ freq: 880, endFreq: 1760, type: 'sine', dur: 0.08, gain: 0.08 });
  }

  // Melee whoosh
  meleeSwing() {
    this.noise({ dur: 0.1, gain: 0.18, freq: 1500, endFreq: 420, type: 'bandpass', q: 1.4 });
  }

  // Melee hit on enemy flesh/bone
  meleeHit() {
    this.tone({ freq: 280, endFreq: 110, type: 'square', dur: 0.09, gain: 0.2 });
    this.noise({ dur: 0.12, gain: 0.22, freq: 2400, endFreq: 300 });
  }

  // Dodge roll / dash
  dash() {
    this.noise({ dur: 0.18, gain: 0.15, freq: 800, endFreq: 220, type: 'lowpass' });
  }

  // Footstep
  footstep() {
    this.noise({ dur: 0.05, gain: 0.06, freq: 500, endFreq: 120, type: 'lowpass' });
  }

  enemyAlert() {
    this.tone({ freq: 440, endFreq: 660, type: 'sawtooth', dur: 0.12, gain: 0.12 });
  }

  enemyHurt() {
    this.tone({ freq: 300, endFreq: 120, type: 'sawtooth', dur: 0.1, gain: 0.15 });
  }

  enemyDie() {
    this.noise({ dur: 0.36, gain: 0.24, freq: 1600, endFreq: 100 });
    this.tone({ freq: 200, endFreq: 50, type: 'sawtooth', dur: 0.32, gain: 0.16 });
  }

  playerHurt() {
    this.tone({ freq: 220, endFreq: 65, type: 'sawtooth', dur: 0.38, gain: 0.3 });
    this.noise({ dur: 0.28, gain: 0.18, freq: 950, endFreq: 100 });
  }

  playerDie() {
    this.tone({ freq: 320, endFreq: 40, type: 'sawtooth', dur: 0.9, gain: 0.3 });
    this.noise({ dur: 0.8, gain: 0.2, freq: 1400, endFreq: 60 });
  }

  pickup() {
    this.tone({ freq: 780, endFreq: 1300, type: 'triangle', dur: 0.18, gain: 0.2 });
  }

  dialogueBeep() {
    this.tone({ freq: 520, type: 'sine', dur: 0.03, gain: 0.05 });
  }

  win() {
    [523, 659, 784, 1046].forEach((f, i) =>
      this.tone({ freq: f, type: 'triangle', dur: 0.45, gain: 0.2, delay: i * 0.12 })
    );
  }
}
