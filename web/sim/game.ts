/**
 * The game loop around the simulation: the start menu picks a mode, the active state runs it,
 * and the end state reports how it went (win / loss / session summary).
 *
 * - Fire Season (challenge): hold out until the rains come. A director starts fires faster and
 *   faster, unattended fires spread, and smoke hurts. The village is lost if it burns down
 *   (integrity 0) or three villagers are hurt. The player has water buckets, food baskets and an
 *   alarm bell; the villagers' own brains and the planner do the rest.
 * - Sandbox: the world editor from Assignment 3 with no rules; "End session" shows a summary.
 *
 * Framework-free like the simulation, so headless tests can play whole games.
 */
import { HOUSES, PLACE_LIST } from './layout';
import { dist, type V2 } from './math';
import type { Fire, Simulation } from './simulation';

export type Mode = 'challenge' | 'sandbox';

export interface Outcome {
  result: 'won' | 'lost' | 'ended';
  title: string;
  reason: string;
  /** 0 for a loss or a sandbox session, otherwise 1 to 3. */
  stars: number;
  score: number;
}

export const SEASON = {
  /** Seconds of simulated time to hold out (about 1.6 in-game days at 1x). */
  duration: 240,
  maxInjured: 3,
  water: { max: 3, recharge: 10, power: 6 },
  food: { max: 2, recharge: 45 },
  alarmCooldown: 30,
  /** Integrity lost per second for each burning fire, plus `houseDrain` if it is within `houseRadius` of a house. */
  drain: 0.3,
  houseDrain: 0.6,
  houseRadius: 6,
};

type Wave = 'near' | 'random' | 'double' | 'shortage';
/** Scripted opening; after it the director keeps the pressure up on its own. */
const OPENING: [number, Wave][] = [[6, 'near'], [36, 'random'], [66, 'shortage'], [88, 'double']];

let games = 0;

export class Game {
  /** Distinguishes games, so the UI remounts its scene for a new one. */
  readonly id = ++games;
  /** Seconds of simulated time since the game started. */
  elapsed = 0;
  integrity = 100;
  /** Fractional charges; a tool is usable at 1 or more. */
  water = SEASON.water.max;
  food = SEASON.food.max;
  alarmIn = 0;
  outcome: Outcome | null = null;
  onEnd: ((o: Outcome) => void) | null = null;
  private wave = 0;
  private nextWaveAt = OPENING[0][0];

  constructor(readonly sim: Simulation, readonly mode: Mode) {
    if (mode === 'challenge') {
      sim.rules.harm = true;
      sim.rules.spread = true;
      sim.log_('🌧 Fire Season: hold out until the rains come. Water a fire by clicking it; ring the bell to evacuate.', 'alert');
    }
    sim.onStep = dt => this.update(dt);
  }

  get remaining() {
    return Math.max(0, SEASON.duration - this.elapsed);
  }

  get injured() {
    return this.sim.villagers.filter(v => v.injured).length;
  }

  update(dt: number) {
    if (this.outcome || this.mode !== 'challenge') return;
    this.elapsed += dt;
    this.water = Math.min(SEASON.water.max, this.water + dt / SEASON.water.recharge);
    this.food = Math.min(SEASON.food.max, this.food + dt / SEASON.food.recharge);
    this.alarmIn = Math.max(0, this.alarmIn - dt);

    for (const f of this.sim.aliveFires()) this.integrity -= (SEASON.drain + (nearHouse(f) ? SEASON.houseDrain : 0)) * dt;
    this.integrity = Math.max(0, this.integrity);

    if (this.elapsed >= this.nextWaveAt) this.runDirector();

    if (this.integrity <= 0) this.finish('lost', 'The village burned down', 'Too many fires burned for too long.');
    else if (this.injured >= SEASON.maxInjured)
      this.finish('lost', 'Too many villagers were hurt', `${this.injured} villagers collapsed in the smoke.`);
    else if (this.elapsed >= SEASON.duration) this.finish('won', 'The rains came', 'The village made it through the fire season.');
  }

  private runDirector() {
    const kind: Wave = this.wave < OPENING.length ? OPENING[this.wave][1] : this.wave % 3 === 2 ? 'double' : 'random';
    this.wave++;
    if (kind === 'shortage') this.sim.setShortage(true);
    else if (kind === 'near') this.fireNearSomeone() ?? this.randomFire();
    else {
      this.randomFire();
      if (kind === 'double') this.randomFire();
    }
    // Pressure rises: waves every 22 s, every 15 s in the last minute.
    this.nextWaveAt = this.wave < OPENING.length ? OPENING[this.wave][0] : this.elapsed + (this.remaining > 60 ? 22 : 15);
  }

  private fireNearSomeone(): Fire | null {
    const out = this.sim.villagers.filter(v => v.visible && !v.injured && v.role !== 'guard');
    if (!out.length) return null;
    return this.sim.startFireNear(this.sim.rng.pick(out).name);
  }

  /** A fire somewhere people live or work, not on top of another one. */
  private randomFire(): Fire | null {
    const anchors: V2[] = [...PLACE_LIST.filter(p => p.key !== 'square'), ...HOUSES.map(h => h.door)];
    for (let k = 0; k < 30; k++) {
      const a = this.sim.rng.pick(anchors), ang = this.sim.rng.range(0, Math.PI * 2), r = this.sim.rng.range(2, 6);
      const p = { x: a.x + Math.cos(ang) * r, z: a.z + Math.sin(ang) * r };
      if (this.sim.aliveFires().some(f => dist(f, p) < 6)) continue;
      const f = this.sim.startFire(p);
      if (f) return f;
    }
    return null;
  }

  /* ---------------- player tools ---------------- */

  useWater(p: V2) {
    if (this.outcome || this.water < 1) return null;
    const f = this.sim.douseAt(p, SEASON.water.power);
    if (f) this.water -= 1;
    return f;
  }

  useFood(p: V2) {
    if (this.outcome || this.food < 1) return null;
    const it = this.sim.dropFood(p);
    if (it) this.food -= 1;
    return it;
  }

  ringAlarm() {
    if (this.outcome || this.alarmIn > 0 || !this.sim.aliveFires().length) return false;
    this.sim.soundAlarm();
    this.alarmIn = SEASON.alarmCooldown;
    return true;
  }

  /** Sandbox "End session", or quitting a challenge from the pause menu. */
  end() {
    const { firesStarted: n, accepted } = this.sim.stats;
    if (!this.outcome) this.finish('ended', 'Session over', `${n} fire${n === 1 ? '' : 's'}, ${accepted} planner command${accepted === 1 ? '' : 's'} accepted.`);
  }

  private finish(result: Outcome['result'], title: string, reason: string) {
    const safe = this.sim.villagers.length - this.injured;
    const score = result === 'ended' ? 0 : Math.round(this.integrity * 10 + safe * 100 + this.sim.stats.firesOut * 50);
    const stars = result !== 'won' ? 0 : this.integrity >= 60 && this.injured === 0 ? 3 : this.integrity >= 30 || this.injured <= 1 ? 2 : 1;
    this.outcome = { result, title, reason, stars, score };
    this.sim.log_(`${result === 'won' ? '🌧' : result === 'lost' ? '💀' : '⏹'} ${title}. ${reason}`, result === 'lost' ? 'alert' : 'info');
    this.sim.speed = 0;
    this.onEnd?.(this.outcome);
  }
}

const nearHouse = (f: V2) => HOUSES.some(h => dist(h, f) < SEASON.houseRadius);
