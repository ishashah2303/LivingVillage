/** Browser frame samples, separate from the headless fixed-step benchmark. */
export interface FrameSetup {
  villagers: number; birds: number; grid: boolean; speed: number; obstacles: number;
  paths: boolean; navmesh: boolean; perception: boolean; obstacleOverlay: boolean;
  width: number; height: number;
  mode?: 'challenge' | 'sandbox';
}
export interface FrameResult {
  setup: FrameSetup; capturedAt: string; frames: number; seconds: number;
  fps: number; p95FrameMs: number; p95SimMs: number; over33Ms: number;
  dprMin: number; dprMax: number; meanDrawCalls: number;
  obstaclesMin: number; obstaclesMax: number;
}
export const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
};

export class FrameBenchmark {
  active = false;
  message = 'Capture 10 s after a 3 s warm-up. Keep the tab visible and the camera still.';
  results: FrameResult[] = [];
  private setup: FrameSetup | null = null;
  private warmup = 0;
  private elapsed = 0;
  private obstaclesMin = 0;
  private obstaclesMax = 0;
  private samples: { frame: number; sim: number; dpr: number; calls: number }[] = [];

  start(setup: FrameSetup) {
    this.setup = { ...setup };
    this.warmup = 0;
    this.elapsed = 0;
    this.samples = [];
    this.obstaclesMin = this.obstaclesMax = setup.obstacles;
    this.active = true;
    this.message = 'Warming up…';
  }

  cancel(message = 'Capture cancelled: the scene or settings changed.') {
    if (!this.active) return;
    this.active = false;
    this.samples = [];
    this.message = message;
  }

  record(frameMs: number, simMs: number, dpr: number, calls: number, setup: FrameSetup, hidden: boolean) {
    if (!this.active || !this.setup) return;
    if (hidden || frameMs > 1000) return this.cancel('Capture interrupted; keep the tab visible and try again.');
    // Fire Season's director changes obstacles as part of the workload being measured.
    const comparable = this.setup.mode === 'challenge' ? { ...setup, obstacles: this.setup.obstacles } : setup;
    if (JSON.stringify(comparable) !== JSON.stringify(this.setup)) return this.cancel();
    if (this.warmup < 3000) { this.warmup += frameMs; return; }
    this.elapsed += frameMs;
    this.obstaclesMin = Math.min(this.obstaclesMin, setup.obstacles);
    this.obstaclesMax = Math.max(this.obstaclesMax, setup.obstacles);
    this.samples.push({ frame: frameMs, sim: simMs, dpr, calls });
    this.message = `Measuring… ${Math.min(10, this.elapsed / 1000).toFixed(0)} / 10 s`;
    if (this.elapsed < 10000) return;
    const samples = this.samples;
    this.results.unshift({
      setup: this.setup, capturedAt: new Date().toISOString(), frames: samples.length,
      seconds: this.elapsed / 1000, fps: samples.length * 1000 / this.elapsed,
      p95FrameMs: percentile(samples.map(s => s.frame), 0.95),
      p95SimMs: percentile(samples.map(s => s.sim), 0.95),
      over33Ms: samples.filter(s => s.frame > 1000 / 30).length,
      dprMin: Math.min(...samples.map(s => s.dpr)), dprMax: Math.max(...samples.map(s => s.dpr)),
      meanDrawCalls: samples.reduce((sum, s) => sum + s.calls, 0) / samples.length,
      obstaclesMin: this.obstaclesMin, obstaclesMax: this.obstaclesMax,
    });
    this.results = this.results.slice(0, 12);
    this.active = false;
    this.samples = [];
    this.message = 'Capture complete. Results stay here across crowd restarts.';
  }
}
