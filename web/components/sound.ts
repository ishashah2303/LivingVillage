/** Quiet procedural audio: no downloads, created only inside a user gesture. */
class VillageSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rain: GainNode | null = null;
  private fire: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;

  activate(muted: boolean) {
    this.muted = muted;
    if (muted || typeof AudioContext === 'undefined') return;
    try {
      if (!this.ctx) {
        const ctx = this.ctx = new AudioContext();
        this.master = ctx.createGain();
        this.master.gain.value = 0.45;
        this.master.connect(ctx.destination);
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.rain = this.noiseLoop('lowpass', 1600);
        this.fire = this.noiseLoop('lowpass', 400);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    } catch { /* Audio is optional on unsupported devices. */ }
  }

  private noiseLoop(type: BiquadFilterType, frequency: number) {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = this.noise;
    source.loop = true;
    filter.type = type;
    filter.frequency.value = frequency;
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master!);
    source.start();
    return gain;
  }

  mix(muted: boolean, audible: boolean, rain: boolean, fires: number) {
    this.muted = muted;
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(muted || !audible ? 0 : 0.45, t, 0.03);
    this.rain?.gain.setTargetAtTime(rain ? 0.16 : 0, t, 0.3);
    this.fire?.gain.setTargetAtTime(Math.min(fires, 4) * 0.035, t, 0.2);
  }

  cue(kind: 'bell' | 'water' | 'won' | 'lost') {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted || document.hidden) return;
    const t = ctx.currentTime;
    if (kind === 'water') {
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      source.buffer = this.noise;
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2300, t);
      filter.frequency.exponentialRampToValueAtTime(500, t + 0.35);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      source.connect(filter).connect(gain).connect(this.master!);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start(); source.stop(t + 0.42);
      return;
    }
    const notes = kind === 'bell' ? [660, 1320, 1848] : kind === 'won' ? [392, 494, 587, 784] : [294, 247, 196];
    notes.forEach((hz, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      const start = t + (kind === 'bell' ? 0 : i * 0.18);
      osc.type = 'sine'; osc.frequency.value = hz;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(kind === 'bell' ? 0.12 / (i + 1) : 0.13, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 1.2);
      osc.connect(gain).connect(this.master!);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      osc.start(start); osc.stop(start + 1.25);
    });
  }

  dispose() {
    if (this.ctx) void this.ctx.close().catch(() => {});
    this.ctx = null; this.master = this.rain = this.fire = null; this.noise = null;
  }
}

export const villageSound = new VillageSound();
