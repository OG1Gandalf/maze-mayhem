/** Tiny WebAudio synth: every sound is generated, no asset files. */
interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  slideTo?: number;
  delay?: number;
}

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, o: ToneOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type ?? 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
    gain.gain.setValueAtTime(o.vol ?? 0.2, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol = 0.25): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.buffer = buf;
    src.connect(gain).connect(this.master);
    src.start();
  }

  shoot(near = true) { this.tone(880, 0.08, { slideTo: 220, vol: near ? 0.12 : 0.05 }); }
  hit() { this.tone(300, 0.1, { type: 'sawtooth', slideTo: 120, vol: 0.15 }); }
  hurt() { this.noise(0.18, 0.3); this.tone(140, 0.2, { type: 'sawtooth', slideTo: 60, vol: 0.2 }); }
  coin() { this.tone(988, 0.07, { type: 'triangle', vol: 0.2 }); this.tone(1319, 0.12, { type: 'triangle', vol: 0.2, delay: 0.07 }); }
  bump() { this.tone(90, 0.05, { type: 'sine', vol: 0.12 }); }
  encounter() { this.tone(392, 0.12, { type: 'triangle' }); this.tone(330, 0.18, { type: 'triangle', delay: 0.12 }); }
  bribeOk() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', delay: i * 0.08 })); }
  bribeFail() { this.tone(220, 0.25, { type: 'sawtooth', slideTo: 110, vol: 0.18 }); }
  kill() { this.noise(0.3, 0.35); }
  tick() { this.tone(660, 0.08, { type: 'sine', vol: 0.2 }); }
  go() { this.tone(1046, 0.25, { type: 'sine', vol: 0.25 }); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, { type: 'triangle', delay: i * 0.12 })); }
  lose() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.25, { type: 'sawtooth', vol: 0.12, delay: i * 0.15 })); }
  notify() { this.tone(740, 0.1, { type: 'sine', vol: 0.15 }); }
}

export const sfx = new Sfx();
