/**
 * The simulation core. Framework-free, so the same code runs in the browser (React Three Fiber
 * reads it every frame) and in Node (Vitest scenario tests).
 *
 *   world event -> perception -> behavior tree + memory -> (async) planner -> navigation -> animation
 */
import type { Obstacle } from 'recast-navigation';
import { bond, createVillagers, say, type Activity, type FleeTarget, type Goal, type Villager } from './agents';
import type { Status } from './bt';
import { Flock } from './boids';
import { HOUSES, PLACES, SAFE_SPOTS, WORLD, placeName, spotByCmd, type PlaceKey, type SafeSpot } from './layout';
import { Rng, clamp, dist, distXZ, lerpAngle, type V2 } from './math';
import { AGENT_RADIUS, NavWorld } from './nav';
import { allSpots, inDanger, validateCommand, type Command, type GateWorld, type PlanResult, type SituationReport } from './planner';
import { villagerTree } from './villagerTree';

/** Fixed simulation step (s). Rendering interpolates between steps. */
export const DT = 1 / 30;
/** Seconds of simulated time per in-game day (at 1x, a day lasts 2.5 minutes). */
export const DAY_SECONDS = 150;
export const THINK_INTERVAL = 0.4;
/** Villagers notice fires within this distance; the guard responds village-wide. */
export const PERCEPTION = 11;
export const GUARD_RANGE = 45;
export const FIRE = { radius: 1.3, blockRadius: 2.1, life: 45, hp: 10, douseRange: 3.8 };

const WORK: Partial<Record<Villager['role'], PlaceKey>> = { farmer: 'farm', merchant: 'market', fisher: 'pond', woodcutter: 'forest' };
const CHAT = ['Morning!', 'Good harvest?', 'Heard the news?', 'Nice weather.', 'Prices are up.', 'See you later.'];

export interface Fire {
  id: number; kind: 'fire'; x: number; z: number; place: string; placeKey: PlaceKey;
  hp: number; life: number; alive: boolean; fade: number; removeAt: number | null;
  fled: Set<number>; obstacle: Obstacle | null; startedAt: number; safeAt: Record<number, number>;
}
export interface Rock { id: number; kind: 'rock'; x: number; z: number; r: number; rot: number; obstacle: Obstacle | null }
export interface Well { id: number; kind: 'well'; x: number; z: number; r: number; obstacle: Obstacle | null }
export interface Food { id: number; kind: 'food'; x: number; z: number; servings: number }
export type Item = Fire | Rock | Well | Food;

export type LogKind = 'info' | 'alert' | 'plan' | 'reject' | 'nav' | 'memory';
export interface LogEntry { id: number; t: string; text: string; kind: LogKind }

export interface PlannerTransport {
  readonly name: string;
  status(): 'online' | 'offline' | 'connecting';
  plan(report: SituationReport, latencyMs: number): Promise<PlanResult>;
}

export interface SimStats {
  goalSwitches: number;
  stuckRecoveries: number;
  accepted: number;
  rejected: number;
  rebuilds: number;
  lastRebuildMs: number;
  lastTimeToSafety: number | null;
}

/** Smoothed cost of one fixed step, in milliseconds, split by system (for the performance overlay). */
export interface StepPerf {
  brainMs: number;
  navMs: number;
  boidsMs: number;
}

const ema = (avg: number, x: number) => avg + (x - avg) * 0.1;

const PLACE_KEY_BY_NAME = Object.fromEntries(Object.values(PLACES).map(p => [p.name, p.key])) as Record<string, PlaceKey>;
const now = () => performance.now();

export class Simulation implements GateWorld {
  readonly rng: Rng;
  readonly villagers: Villager[];
  readonly flock: Flock;
  readonly tree = villagerTree;
  items: Item[] = [];
  day = 1;
  hour = 7.5;
  simTime = 0;
  speed = 1;
  festival = 0;
  shortage = 0;
  /** Bumped on every world change; planner replies carry the version they were computed for. */
  worldVersion = 0;
  plannerLatencyMs = 1500;
  pendingPlans = 0;
  planner: PlannerTransport | null = null;
  log: LogEntry[] = [];
  stats: SimStats = { goalSwitches: 0, stuckRecoveries: 0, accepted: 0, rejected: 0, rebuilds: 0, lastRebuildMs: 0, lastTimeToSafety: null };
  perf: StepPerf = { brainMs: 0, navMs: 0, boidsMs: 0 };
  /** 0..1 progress between the last two fixed steps, for render interpolation. */
  alpha = 0;
  private acc = 0;
  private uid = 1;
  private logId = 1;

  private constructor(readonly nav: NavWorld, seed: number) {
    this.rng = new Rng(seed);
    this.villagers = createVillagers(this.rng, home => {
      const d = HOUSES[home].door;
      return { x: d.x + this.rng.range(-1, 1), z: d.z + this.rng.range(0.3, 1.2) };
    });
    for (const v of this.villagers) this.spawnAgent(v);
    this.flock = new Flock(this.rng);
    this.log_('The village wakes up. Pick a tool on the left and change the world.');
  }

  static async create(opts: { seed?: number; nav?: NavWorld } = {}) {
    const nav = opts.nav ?? (await NavWorld.create());
    return new Simulation(nav, opts.seed ?? 5);
  }

  /* ---------------- time ---------------- */

  /** Advance by real elapsed seconds; runs fixed steps and updates the interpolation alpha. */
  advance(realDt: number) {
    if (this.speed <= 0) return;
    this.acc += Math.min(realDt, 0.1) * this.speed;
    let steps = 0;
    while (this.acc >= DT && steps < 12) {
      this.step(DT);
      this.acc -= DT;
      steps++;
    }
    if (steps === 12) this.acc = 0;
    this.alpha = this.acc / DT;
  }

  clock(hour = this.hour) {
    const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  step(dt: number) {
    this.simTime += dt;
    this.hour += (dt * 24) / DAY_SECONDS;
    if (this.hour >= 24) { this.hour -= 24; this.day++; }
    if (this.festival > 0 && (this.festival -= dt) <= 0) this.setFestival(false);
    if (this.shortage > 0 && (this.shortage -= dt) <= 0) this.setShortage(false);
    this.updateFires(dt);

    const t0 = now();
    for (const v of this.villagers) {
      this.updateNeeds(v, dt);
      if ((v.thinkIn -= dt) <= 0) {
        v.thinkIn = THINK_INTERVAL;
        this.think(v);
      }
      this.updateHelp(v);
      if (v.act === 'douse') this.douse(v, dt);
      if (v.sayT > 0) v.sayT -= dt;
    }

    const t1 = now();
    if (this.nav.flush()) this.onNavRebuilt();
    this.nav.step(dt);
    for (const v of this.villagers) this.syncAgent(v, dt);
    const t2 = now();
    this.flock.step(dt, { time: this.simTime, hour: this.hour, fires: this.aliveFires() }, this.rng);
    const t3 = now();
    this.perf.brainMs = ema(this.perf.brainMs, t1 - t0);
    this.perf.navMs = ema(this.perf.navMs, t2 - t1);
    this.perf.boidsMs = ema(this.perf.boidsMs, t3 - t2);
  }

  /* ---------------- perception & cognition ---------------- */

  private think(v: Villager) {
    const trace = new Map<string, Status>();
    this.tree.tick({ v, sim: this }, trace);
    v.trace = trace;
    // Small talk between socializing villagers builds relationships.
    if ((v.act === 'social' || v.act === 'dance') && this.rng.next() < 0.12) {
      const o = this.villagers.find(o => o !== v && o.visible && (o.act === 'social' || o.act === 'dance') && dist(o.pos, v.pos) < 4);
      if (o) {
        say(v, v.act === 'dance' ? 'What a party!' : this.rng.next() < 0.3 ? `Hi ${o.name}!` : this.rng.pick(CHAT));
        bond(v, o, 1);
        v.social = Math.max(0, v.social - 10);
      }
    }
    if (v.act === 'douse' && this.rng.next() < 0.2) say(v, 'Stand back!');
  }

  private updateNeeds(v: Villager, dt: number) {
    const asleep = v.act === 'sleep';
    v.hunger = clamp(v.hunger + dt * (asleep ? 0.12 : 0.45) * (this.shortage > 0 ? 2 : 1), 0, 100);
    v.energy = clamp(v.energy + dt * (asleep ? 3 : v.act === 'work' || v.act === 'dance' ? -0.5 : -0.25), 0, 100);
    v.social = clamp(v.social + dt * (asleep ? 0.05 : 0.3), 0, 100);
    if (v.act === 'eat') v.hunger = clamp(v.hunger - dt * 16, 0, 100);
    if (v.act === 'forage') v.hunger = clamp(v.hunger - dt * 5, 0, 100);
  }

  remember(v: Villager, text: string, importance: number) {
    if (v.memory[0]?.text === text) return;
    v.memory.unshift({ day: this.day, t: `D${this.day} ${this.clock()}`, text, importance });
    v.memory.length = Math.min(v.memory.length, 8);
  }

  aliveFires(): Fire[] {
    return this.items.filter((i): i is Fire => i.kind === 'fire' && i.alive);
  }

  private nearestFire(p: V2, within = Infinity) {
    let best: Fire | null = null, bd = within;
    for (const f of this.aliveFires()) {
      const d = dist(p, f);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  /** The fire this villager is reacting to, if any. */
  threatFor(v: Villager): Fire | null {
    const fires = this.aliveFires();
    if (!fires.length) return null;
    if (v.role === 'guard') return fires.find(f => f.id === v.investigate) ?? this.nearestFire(v.pos, GUARD_RANGE);
    for (const f of fires) if (v.flee[f.id]) return f;
    return this.nearestFire(v.pos, PERCEPTION);
  }

  isAfraidOf(v: Villager, key: PlaceKey) {
    return (v.fear[key] ?? 0) > this.day;
  }

  /* ---------------- behavior tree actions ---------------- */

  /** Applies a goal chosen by the tree. Same key = keep going; new key = new destination. */
  intend(v: Villager, g: Goal): Status {
    if (!v.goal || v.goal.key !== g.key) this.setGoal(v, g);
    else {
      const moved = g.follow != null && v.target && distXZ(g.x, g.z, v.target.x, v.target.z) > 1.5;
      v.goal = g;
      if (moved) this.moveTo(v, g.x, g.z, !!g.run);
    }
    return 'running';
  }

  private setGoal(v: Villager, g: Goal) {
    if (v.goal) this.stats.goalSwitches++;
    v.goal = g;
    v.act = 'walk';
    if (!this.moveTo(v, g.x, g.z, !!g.run)) v.act = g.act;
    if (g.cmd && g.cmd !== v.lastCmd && g.source !== 'planner') this.log_(`${v.name} (${g.source}): \`${g.cmd}\``, 'plan');
    v.lastCmd = g.cmd ?? null;
  }

  private spot(key: PlaceKey, v: Villager): V2 {
    const P = PLACES[key];
    if (P.ring) {
      const r = 3.1 + v.rad * 2;
      return { x: P.x + Math.cos(v.ang) * r, z: P.z + Math.sin(v.ang) * r };
    }
    return { x: P.x + v.ox * P.r, z: P.z + v.oz * P.r };
  }

  /**
   * Routine goals never lead into a fire. Waiting in place turned out to be a bad idea (idle
   * agents block corridors, see nudgeBlockers), so villagers wait at home or in the square.
   */
  private avoidFire(v: Villager, g: Goal): Goal {
    const f = this.nearestFire(g, 10);
    if (!f) return g;
    const home = HOUSES[v.home].door;
    const refuges: [V2, string, string][] = [
      [{ x: home.x + v.ox, z: home.z + 0.8 }, 'home', 'home'],
      [this.spot('square', v), 'the Town Square', 'square'],
    ];
    for (const [p, name, k] of refuges)
      if (!this.nearestFire(p, 12)) return { key: `avoid${f.id}:${k}`, label: `Keeping clear of the fire, waiting at ${name}`, x: p.x, z: p.z, act: 'idle', source: 'reflex' };
    return { key: `avoid${f.id}`, label: 'Keeping clear of the fire', x: v.pos.x, z: v.pos.z, act: 'idle', source: 'reflex' };
  }

  /** Reflex: best safe spot by distance alone (no coordination, so everyone may pick the same one). */
  pickSafe(v: Villager, f: V2): SafeSpot {
    let best = SAFE_SPOTS[0], bs = -Infinity;
    const fires = this.aliveFires();
    for (const s of SAFE_SPOTS) {
      const df = Math.min(dist(s, f), ...fires.map(o => dist(s, o)));
      const score = (df > 15 ? 100 : 0) + df - 0.4 * dist(s, v.pos);
      if (score > bs) { bs = score; best = s; }
    }
    return best;
  }

  actFlee(v: Villager): Status {
    const f = this.threatFor(v);
    if (!f) return 'failure';
    let t = v.flee[f.id];
    if (!t) {
      t = { ...this.pickSafe(v, f), source: 'reflex' };
      v.flee[f.id] = t;
      f.fled.add(v.id);
      this.remember(v, `Saw a fire near the ${f.place} and ran`, 8);
      v.fear[f.placeKey] = this.day + 1;
      say(v, 'Fire!');
    }
    return this.intend(v, {
      key: `flee${f.id}:${t.cmd}`, label: `Escaping to ${t.name}`, x: t.x + v.ox * 1.2, z: t.z + v.oz * 1.2,
      act: 'shelter', run: true, cmd: `EVACUATE(${t.cmd})`, source: t.source, fireId: f.id,
    });
  }

  actDouse(v: Villager): Status {
    const f = this.threatFor(v);
    if (!f) return 'failure';
    const d = dist(v.pos, f) || 1;
    const standoff = FIRE.blockRadius + AGENT_RADIUS + 0.6;
    return this.intend(v, {
      key: `douse${f.id}`, label: 'Putting out the fire', x: f.x + ((v.pos.x - f.x) / d) * standoff, z: f.z + ((v.pos.z - f.z) / d) * standoff,
      act: 'douse', run: true, cmd: `INVESTIGATE(Fire#${f.id})`, source: v.investigate === f.id ? 'planner' : 'reflex', fireId: f.id,
    });
  }

  helpTarget(v: Villager): Villager | null {
    const h = v.help;
    if (!h) return null;
    const f = this.items.find(i => i.id === h.fireId) as Fire | undefined;
    if (!f?.alive || this.simTime > h.until) {
      v.help = null;
      return null;
    }
    return this.villagers[h.victim];
  }

  actHelp(v: Villager): Status {
    const victim = this.helpTarget(v);
    if (!victim) return 'failure';
    return this.intend(v, {
      key: `help${victim.id}`, label: `Running to help ${victim.name}`, x: victim.pos.x, z: victim.pos.z,
      act: 'idle', run: true, cmd: `HELP_AGENT(${victim.name})`, source: 'planner', follow: victim.id,
    });
  }

  private updateHelp(v: Villager) {
    const victim = v.help ? this.villagers[v.help.victim] : null;
    if (!v.help || !victim || dist(v.pos, victim.pos) > 1.8) return;
    const fireId = v.help.fireId;
    this.remember(v, `Helped ${victim.name} escape the fire`, 9);
    this.remember(victim, `${v.name} came back to help during the fire`, 9);
    bond(v, victim, 12);
    say(v, `${victim.name}, this way!`);
    this.log_(`🤝 ${v.name} reached ${victim.name} and they left together (bond +12).`, 'memory');
    const f = this.items.find(i => i.id === fireId) as Fire | undefined;
    v.flee[fireId] = victim.flee[fireId] ?? { ...this.pickSafe(v, f ?? victim.pos), source: 'reflex' };
    f?.fled.add(v.id);
    v.help = null;
    v.thinkIn = 0;
  }

  actDance(v: Villager): Status {
    return this.intend(v, this.avoidFire(v, { key: 'dance', label: 'Dancing at the festival', ...this.spot('square', v), act: 'dance', source: 'event' }));
  }

  checkHungry(v: Villager) {
    if (v.hunger > 75) v.hungry = true;
    if (v.hunger < 15) v.hungry = false;
    return v.hungry;
  }

  checkTired(v: Villager) {
    if (v.energy < 15) v.tired = true;
    if (v.energy > 85) v.tired = false;
    return v.tired;
  }

  actEatDropped(v: Villager): Status {
    let pile: Food | null = null, pd = Infinity;
    for (const it of this.items) if (it.kind === 'food' && it.servings > 0 && dist(it, v.pos) < pd) { pd = dist(it, v.pos); pile = it; }
    if (!pile) return 'failure';
    return this.intend(v, {
      key: `food${pile.id}`, label: 'Going to the food someone left out', x: pile.x + Math.cos(v.ang), z: pile.z + Math.sin(v.ang),
      act: 'eat', source: 'need', pileId: pile.id,
    });
  }

  actForage(v: Villager): Status {
    return this.intend(v, this.avoidFire(v, { key: 'forage', label: 'Foraging at the farm (market is empty)', ...this.spot('farm', v), act: 'forage', source: 'need' }));
  }

  actEatMarket(v: Villager, lunch = false): Status {
    return this.intend(v, this.avoidFire(v, {
      key: lunch ? 'lunch' : 'eat', label: lunch ? 'Lunch at the market' : 'Getting food at the market', ...this.spot('market', v),
      act: 'eat', source: lunch ? 'routine' : 'need',
    }));
  }

  marketOpen() {
    return this.hour >= 7 && this.hour < 21;
  }

  actEatHome(v: Villager): Status {
    const d = HOUSES[v.home].door;
    return this.intend(v, this.avoidFire(v, { key: 'eatHome', label: 'Eating at home (market is closed)', x: d.x, z: d.z, act: 'eat', source: 'need', indoors: true }));
  }

  isLunch(v: Villager) {
    return this.hour >= 12 && this.hour < 13 && v.hunger > 25 && this.shortage <= 0;
  }

  actRest(v: Villager): Status {
    const d = HOUSES[v.home].door;
    return this.intend(v, { key: 'rest', label: 'Exhausted, going home to rest', x: d.x, z: d.z, act: 'sleep', source: 'need' });
  }

  actSleep(v: Villager): Status {
    const d = HOUSES[v.home].door;
    return this.intend(v, { key: 'sleep', label: 'Sleeping at home', x: d.x, z: d.z, act: 'sleep', source: 'routine' });
  }

  actChores(v: Villager): Status {
    const d = HOUSES[v.home].door;
    return this.intend(v, { key: 'chores', label: 'Morning chores at home', x: d.x + v.ox * 1.5, z: d.z + 0.8, act: 'chores', source: 'routine' });
  }

  actWork(v: Villager): Status {
    if (v.role === 'guard') {
      const route: PlaceKey[] = ['post', 'square', 'market'], k = Math.floor(this.simTime / 12) % 3;
      return this.intend(v, this.avoidFire(v, { key: `patrol${k}`, label: `Patrolling the ${PLACES[route[k]].name}`, ...this.spot(route[k], v), act: 'idle', source: 'routine' }));
    }
    if (v.role === 'villager') {
      const all: PlaceKey[] = ['square', 'pond', 'market', 'forest'];
      const safe = all.filter(k => !this.isAfraidOf(v, k));
      const route = safe.length ? safe : all;
      const k = route[Math.floor(this.simTime / 16) % route.length];
      return this.intend(v, this.avoidFire(v, { key: `visit${k}`, label: `Visiting the ${PLACES[k].name}`, ...this.spot(k, v), act: 'social', source: 'routine' }));
    }
    const workKey = WORK[v.role]!;
    if (this.isAfraidOf(v, workKey)) {
      // Memory changes behavior: after a fire at the workplace, work somewhere else for the rest of the day.
      const alt: PlaceKey = workKey === 'market' ? 'square' : 'market';
      return this.intend(v, this.avoidFire(v, {
        key: `workAlt${alt}`, label: `Helping at the ${PLACES[alt].name} (avoiding the ${PLACES[workKey].name} after the fire)`,
        ...this.spot(alt, v), act: 'work', source: 'routine',
      }));
    }
    return this.intend(v, this.avoidFire(v, { key: 'work', label: `Working at the ${PLACES[workKey].name}`, ...this.spot(workKey, v), act: 'work', source: 'routine' }));
  }

  actSocialize(v: Villager): Status {
    let best = { ...this.spot('square', v), name: 'the Town Square' };
    for (const it of this.items)
      if (it.kind === 'well' && dist(it, v.pos) < dist(best, v.pos))
        best = { x: it.x + Math.cos(v.ang) * 2, z: it.z + Math.sin(v.ang) * 2, name: 'the new well' };
    return this.intend(v, this.avoidFire(v, { key: `social:${best.name}`, label: `Chatting at ${best.name}`, x: best.x, z: best.z, act: 'social', source: 'routine' }));
  }

  actWindDown(v: Villager): Status {
    const d = HOUSES[v.home].door;
    return this.intend(v, { key: 'evening', label: 'Winding down at home', x: d.x + v.ox, z: d.z + 0.8, act: 'idle', source: 'routine' });
  }

  /* ---------------- navigation & movement ---------------- */

  private spawnAgent(v: Villager) {
    v.agent = this.nav.addAgent(v.pos, {
      radius: AGENT_RADIUS, height: 1.8, maxSpeed: v.walkSpeed, maxAcceleration: 8,
      collisionQueryRange: 2.5, pathOptimizationRange: 10, separationWeight: 1.5, updateFlags: 31,
    });
    const p = v.agent.position();
    v.pos = { x: p.x, z: p.z };
    v.prev = { ...v.pos };
  }

  private moveTo(v: Villager, x: number, z: number, run: boolean) {
    if (!v.agent) {
      v.visible = true;
      this.spawnAgent(v);
    }
    const target = this.nav.snap({ x, z }, 3) ?? this.nav.snap({ x, z }, 8);
    if (!target || !v.agent) return false;
    v.target = target;
    v.moveT = 0;
    v.stuckT = 0;
    v.retries = 0;
    v.detourT = 0;
    v.nudged = false;
    v.agent.updateParameters({ maxSpeed: run ? v.runSpeed : v.walkSpeed, maxAcceleration: run ? 14 : 8 });
    v.agent.requestMoveTarget({ x: target.x, y: 0.2, z: target.z });
    return true;
  }

  private arrive(v: Villager) {
    const g = v.goal;
    v.target = null;
    v.agent?.resetMoveTarget();
    if (!g) return;
    v.act = g.act;
    if (g.pileId != null) {
      const pile = this.items.find(i => i.id === g.pileId) as Food | undefined;
      if (pile && pile.servings > 0) {
        pile.servings--;
        say(v, 'Thank you!');
        if (this.shortage > 0) this.remember(v, 'Found food someone left out during the shortage', 6);
        if (pile.servings <= 0) this.removeItem(pile);
      } else v.goal = null;
    }
    if (g.act === 'shelter') {
      say(v, 'Safe here.');
      const f = this.items.find(i => i.id === g.fireId) as Fire | undefined;
      if (f && f.safeAt[v.id] == null) f.safeAt[v.id] = this.simTime - f.startedAt;
    }
    if ((g.act === 'sleep' || g.indoors) && v.agent) {
      this.nav.crowd.removeAgent(v.agent);
      v.agent = null;
      v.visible = false;
    }
  }

  private syncAgent(v: Villager, dt: number) {
    if (!v.agent) return;
    const p = v.agent.position(), vel = v.agent.velocity();
    v.prev = v.pos;
    v.pos = { x: p.x, z: p.z };
    v.speed = Math.hypot(vel.x, vel.z);
    if (v.speed > 0.2) v.heading = lerpAngle(v.heading, Math.atan2(vel.x, vel.z), Math.min(1, dt * 10));
    else if (v.act === 'douse' && v.goal?.fireId != null) {
      const f = this.items.find(i => i.id === v.goal!.fireId);
      if (f) v.heading = lerpAngle(v.heading, Math.atan2(f.x - v.pos.x, f.z - v.pos.z), Math.min(1, dt * 6));
    }
    v.stride += v.speed * dt;
    if (v.act !== 'walk' || !v.target) return;

    // Arrival and stuck handling: DetourCrowd is local avoidance, not a global planner, so agents
    // can stall behind idle villagers (who never yield on their own) or around fresh obstacles.
    v.moveT += dt;
    const d = dist(v.pos, v.target);
    if (d < 0.6 || (d < 2.2 && v.speed < 0.08 && v.moveT > 0.8)) return this.arrive(v);
    if (v.detourT > 0 && (v.detourT -= dt) <= 0) this.resume(v);
    if (v.speed > 0.1) { v.stuckT = 0; return; }
    v.stuckT += dt;
    if (v.stuckT > 0.8 && !v.nudged) {
      v.nudged = true;
      this.nudgeBlockers(v);
    }
    if (v.stuckT < 2) return;
    v.stuckT = 0;
    v.nudged = false;
    this.stats.stuckRecoveries++;
    if (++v.retries > 4) {
      this.log_(`${v.name} could not reach "${v.goal?.label}", stopping here.`, 'nav');
      return this.arrive(v);
    }
    // Sidestep to a random nearby point, then resume the real target.
    const side = this.nav.randomNear(v.pos, 2.5);
    if (side) {
      v.agent.requestMoveTarget({ x: side.x, y: 0.2, z: side.z });
      v.detourT = 1.2;
    } else this.resume(v);
  }

  private resume(v: Villager) {
    v.detourT = 0;
    if (!v.agent || !v.target) return;
    const t = this.nav.snap(v.target, 6);
    if (t) v.agent.requestMoveTarget({ x: t.x, y: 0.2, z: t.z });
  }

  /** Politeness: idle villagers standing in a stuck agent's way step aside. */
  private nudgeBlockers(v: Villager) {
    if (!v.agent || !v.target) return;
    const dv = v.agent.desiredVelocity();
    let dx = dv.x, dz = dv.z, len = Math.hypot(dx, dz);
    if (len < 0.01) { dx = v.target.x - v.pos.x; dz = v.target.z - v.pos.z; len = Math.hypot(dx, dz) || 1; }
    dx /= len; dz /= len;
    for (const o of this.villagers) {
      if (o === v || !o.agent || o.act === 'walk') continue;
      const rx = o.pos.x - v.pos.x, rz = o.pos.z - v.pos.z;
      if (Math.hypot(rx, rz) > 2.2 || rx * dx + rz * dz < -0.2) continue;
      const side = rx * -dz + rz * dx >= 0 ? 1 : -1;
      const p = this.nav.snap({ x: o.pos.x - dz * side * 1.6 + dx * 0.4, z: o.pos.z + dx * side * 1.6 + dz * 0.4 }, 1.5);
      if (!p) continue;
      o.agent.updateParameters({ maxSpeed: o.walkSpeed });
      o.agent.requestMoveTarget({ x: p.x, y: 0.2, z: p.z });
      say(o, 'Oh, sorry!', 1.5);
    }
  }

  /** New obstacles must not bury agents: push anyone inside the footprint to its edge first. */
  private clearFootprint(x: number, z: number, r: number) {
    for (const v of this.villagers) {
      if (!v.agent) continue;
      const d = distXZ(v.pos.x, v.pos.z, x, z);
      const edge = r + AGENT_RADIUS + 0.6;
      if (d >= edge) continue;
      const dx = d > 0.01 ? (v.pos.x - x) / d : 1, dz = d > 0.01 ? (v.pos.z - z) / d : 0;
      const p = this.nav.snap({ x: x + dx * edge, z: z + dz * edge }, 2);
      if (!p) continue;
      v.agent.teleport({ x: p.x, y: 0.2, z: p.z });
      v.pos = { ...p };
      v.prev = { ...p };
      if (v.target) this.moveTo(v, v.target.x, v.target.z, !!v.goal?.run);
    }
  }

  private onNavRebuilt() {
    this.stats.rebuilds++;
    this.stats.lastRebuildMs = this.nav.lastRebuildMs;
    // Detour replans corridors that crossed rebuilt tiles; re-issue targets that fell inside obstacles.
    for (const v of this.villagers)
      if (v.agent && v.target && v.act === 'walk') {
        const t = this.nav.snap(v.target, 1);
        if (!t || dist(t, v.target) > 0.5) this.moveTo(v, v.target.x, v.target.z, !!v.goal?.run);
      }
  }

  reachable(from: V2, to: V2) {
    return this.nav.path(from, to, 2) !== null;
  }

  /* ---------------- world editing ---------------- */

  canPlace(p: V2) {
    const s = this.nav.snap(p, 0.4);
    return !!s && dist(s, p) < 0.4;
  }

  private placeKeyAt(p: V2): PlaceKey {
    return PLACE_KEY_BY_NAME[placeName(p)];
  }

  startFire(p: V2) {
    if (!this.canPlace(p)) return null;
    this.clearFootprint(p.x, p.z, FIRE.blockRadius);
    const place = placeName(p);
    const f: Fire = {
      id: this.uid++, kind: 'fire', x: p.x, z: p.z, place, placeKey: this.placeKeyAt(p), hp: FIRE.hp, life: FIRE.life,
      alive: true, fade: 1, removeAt: null, fled: new Set(), obstacle: null, startedAt: this.simTime, safeAt: {},
    };
    f.obstacle = this.nav.addObstacle({ kind: 'cyl', x: p.x, z: p.z, r: FIRE.blockRadius });
    this.items.push(f);
    this.worldVersion++;
    this.flock.startle = 1;
    this.nav.flush() && this.onNavRebuilt();
    this.log_(`🔥 A fire broke out near the ${place}. NavMesh tiles rebuilt in ${this.nav.lastRebuildMs.toFixed(1)} ms.`, 'alert');
    for (const v of this.villagers) v.thinkIn = Math.min(v.thinkIn, this.rng.range(0, 0.25));
    this.requestPlan('fire_started');
    return f;
  }

  /** Demo helper: a fire a few meters from a villager who is out and about. */
  startFireNear(name = 'Maya') {
    const v = this.villagers.find(o => o.name === name && o.visible) ?? this.villagers.find(o => o.visible);
    if (!v) return null;
    for (let k = 0; k < 24; k++) {
      const a = v.heading + Math.PI + (k % 2 ? 1 : -1) * Math.floor(k / 2) * 0.4;
      const p = { x: v.pos.x + Math.sin(a) * 4.5, z: v.pos.z + Math.cos(a) * 4.5 };
      if (this.canPlace(p)) return this.startFire(p);
    }
    return null;
  }

  private endFire(f: Fire, byGuard: boolean) {
    f.alive = false;
    if (f.obstacle) this.nav.removeObstacle(f.obstacle);
    f.obstacle = null;
    f.removeAt = this.simTime + 6;
    this.worldVersion++;
    const times = Object.values(f.safeAt);
    const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
    this.stats.lastTimeToSafety = mean;
    this.log_(
      `${byGuard ? '🧯 The fire near the ' + f.place + ' was put out.' : 'The fire near the ' + f.place + ' burned out.'}` +
        (times.length ? ` ${times.length} reached safety, mean ${mean!.toFixed(1)} s.` : ''),
      'info',
    );
    for (const id of f.fled) {
      const v = this.villagers[id];
      this.remember(v, `Survived the fire near the ${f.place}`, 7);
      delete v.flee[f.id];
      v.thinkIn = 0;
    }
    for (const v of this.villagers)
      if (v.goal?.fireId === f.id && v.act === 'douse') {
        this.remember(v, `Put out the fire near the ${f.place}`, 7);
        say(v, 'All clear!');
      }
    for (const v of this.villagers) if (v.investigate === f.id) v.investigate = null;
  }

  private updateFires(dt: number) {
    for (const it of [...this.items]) {
      if (it.kind !== 'fire') continue;
      if (it.alive) {
        it.life -= dt;
        if (it.hp <= 0) this.endFire(it, true);
        else if (it.life <= 0) this.endFire(it, false);
      } else {
        it.fade = Math.max(0, it.fade - dt * 0.8);
        if (it.removeAt != null && this.simTime >= it.removeAt) this.items.splice(this.items.indexOf(it), 1);
      }
    }
  }

  private douse(v: Villager, dt: number) {
    const f = this.items.find(i => i.id === v.goal?.fireId) as Fire | undefined;
    if (f?.alive && dist(v.pos, f) < FIRE.douseRange) f.hp -= dt;
  }

  addRock(p: V2) {
    return this.addBlocking(p, 'rock', 1.25, '🪨 An obstacle was dropped');
  }

  addWell(p: V2) {
    return this.addBlocking(p, 'well', 1.1, '⛲ A new well was built; it becomes an evening gathering spot');
  }

  private addBlocking(p: V2, kind: 'rock' | 'well', r: number, msg: string, quiet = false) {
    if (!this.canPlace(p)) return null;
    this.clearFootprint(p.x, p.z, r);
    const obstacle = this.nav.addObstacle({ kind: 'cyl', x: p.x, z: p.z, r });
    const it = kind === 'rock'
      ? { id: this.uid++, kind, x: p.x, z: p.z, r, rot: this.rng.range(0, 6), obstacle } as Rock
      : { id: this.uid++, kind, x: p.x, z: p.z, r, obstacle } as Well;
    this.items.push(it);
    this.worldVersion++;
    this.nav.flush() && this.onNavRebuilt();
    if (!quiet) this.log_(`${msg}. NavMesh tiles rebuilt in ${this.nav.lastRebuildMs.toFixed(1)} ms; villagers reroute.`, 'nav');
    return it;
  }

  dropFood(p: V2) {
    if (!this.canPlace(p)) return null;
    const it: Food = { id: this.uid++, kind: 'food', x: p.x, z: p.z, servings: 3 };
    this.items.push(it);
    this.worldVersion++;
    this.log_('🧺 Food was left out. Hungry villagers will come for it.');
    return it;
  }

  removeItem(it: Item) {
    const i = this.items.indexOf(it);
    if (i < 0) return;
    if (it.kind === 'fire') {
      if (it.alive) this.endFire(it, false);
      this.items.splice(this.items.indexOf(it), 1);
    } else {
      this.items.splice(i, 1);
      if ('obstacle' in it && it.obstacle) this.nav.removeObstacle(it.obstacle);
    }
    this.worldVersion++;
    if (this.nav.flush()) this.onNavRebuilt();
  }

  removeNear(p: V2) {
    let best: Item | null = null, bd = 2.5;
    for (const it of this.items) if (dist(it, p) < bd) { bd = dist(it, p); best = it; }
    if (best) {
      this.removeItem(best);
      this.log_(`Removed the ${best.kind === 'food' ? 'food basket' : best.kind}.`, 'nav');
    }
    return best;
  }

  /* ---------------- stress test ---------------- */

  setBirdCount(n: number) {
    this.flock.resize(n, this.rng);
    this.log_(`Stress test: the flock now has ${this.flock.birds.length} birds.`);
  }

  /** Drops up to `n` rocks at random free spots, each one a separate TileCache edit and rebuild. */
  scatterObstacles(n: number) {
    let placed = 0, worst = 0;
    const t0 = now();
    for (let k = 0; k < n * 20 && placed < n; k++) {
      const p = { x: this.rng.range(WORLD.minX + 2, WORLD.maxX - 2), z: this.rng.range(WORLD.minZ + 2, WORLD.maxZ - 2) };
      if (this.addBlocking(p, 'rock', 1.25, '', true)) {
        placed++;
        worst = Math.max(worst, this.nav.lastRebuildMs);
      }
    }
    this.log_(
      `Stress test: dropped ${placed} obstacles in ${(now() - t0).toFixed(0)} ms (slowest tile rebuild ${worst.toFixed(1)} ms); ` +
        `the navmesh now has ${this.nav.obstacleCount} obstacles.`,
      'nav',
    );
    return placed;
  }

  clearObstacles() {
    const rocks = this.items.filter(i => i.kind === 'rock');
    for (const r of rocks) this.removeItem(r);
    if (rocks.length) this.log_(`Removed ${rocks.length} obstacles.`, 'nav');
    return rocks.length;
  }

  setFestival(on: boolean) {
    this.festival = on ? 35 : 0;
    this.worldVersion++;
    if (on) this.log_('🎉 A festival began in the Town Square.');
    else {
      this.log_('The festival ended.');
      const dancers = this.villagers.filter(v => v.act === 'dance');
      for (const v of dancers) {
        this.remember(v, 'Danced at the festival', 4);
        for (const o of dancers) if (o !== v) v.rel[o.id] = clamp(v.rel[o.id] + 4, 0, 100);
      }
    }
    for (const v of this.villagers) v.thinkIn = Math.min(v.thinkIn, this.rng.range(0, 0.3));
  }

  setShortage(on: boolean) {
    this.shortage = on ? 50 : 0;
    this.worldVersion++;
    if (on) {
      this.log_('🌾 Food shortage: the market is empty and hunger rises twice as fast.', 'alert');
      for (const v of this.villagers) this.remember(v, 'The market ran out of food', 5);
    } else this.log_('The shortage is over. The market is restocked.');
    for (const v of this.villagers) v.thinkIn = Math.min(v.thinkIn, this.rng.range(0, 0.3));
  }

  /* ---------------- deliberative planner ---------------- */

  villagerByName(name: string) {
    return this.villagers.find(v => v.name.toLowerCase() === name.toLowerCase());
  }

  fireById(id: number) {
    return this.items.find((i): i is Fire => i.kind === 'fire' && i.id === id);
  }

  situationReport(trigger: string): SituationReport {
    return {
      version: this.worldVersion, day: this.day, clock: this.clock(), trigger,
      fires: this.aliveFires().map(f => ({ id: f.id, x: f.x, z: f.z, place: f.place })),
      spots: allSpots(),
      agents: this.villagers.map(v => ({
        id: v.id, name: v.name, role: v.role, x: v.pos.x, z: v.pos.z, activity: v.act,
        fleeingTo: Object.values(v.flee)[0]?.cmd ?? null,
        rel: Object.fromEntries(this.villagers.filter(o => o !== v).map(o => [o.name, v.rel[o.id]])),
      })),
    };
  }

  requestPlan(trigger: string) {
    const planner = this.planner;
    if (!planner) return;
    const report = this.situationReport(trigger);
    const sentAt = now();
    this.pendingPlans++;
    this.log_(`🧠 Asked the ${planner.name} planner to coordinate (world v${report.version}); reflexes act meanwhile.`, 'plan');
    planner
      .plan(report, this.plannerLatencyMs)
      .then(res => this.applyPlan(res, report.version, sentAt))
      .catch(err => this.log_(`Planner unavailable (${err instanceof Error ? err.message : err}); villagers rely on reflexes.`, 'alert'))
      .finally(() => this.pendingPlans--);
  }

  applyPlan(res: PlanResult, version: number, sentAt: number) {
    const latencyMs = now() - sentAt;
    const stale = this.worldVersion !== version;
    this.log_(
      `🧠 ${res.planner} (${res.source}) replied after ${(latencyMs / 1000).toFixed(1)} s with ${res.commands.length} commands` +
        (stale ? `; the world changed since (v${version} → v${this.worldVersion}), so each is re-validated.` : '.'),
      'plan',
    );
    for (const note of res.notes ?? []) this.log_(`Planner note: ${note}.`, 'nav');
    if (res.summary) this.log_(`🧠 Plan: ${res.summary}`, 'plan');
    for (const c of res.commands) {
      const verdict = validateCommand(this, c, latencyMs / 1000);
      if (!verdict.ok) {
        this.stats.rejected++;
        this.log_(`✗ Rejected \`${c.verb}(${c.arg})\` for ${c.agent}: ${verdict.reason}.`, 'reject');
        continue;
      }
      this.stats.accepted++;
      this.applyCommand(c, latencyMs, res.planner);
      this.log_(`✓ ${c.agent}: \`${c.verb}(${c.arg})\` (${c.reason}).`, 'plan');
    }
  }

  private applyCommand(c: Command, latencyMs: number, planner: string) {
    const v = this.villagerByName(c.agent)!;
    v.thinkIn = 0;
    v.plannerNote = { cmd: `${c.verb}(${c.arg})`, reason: c.reason, planner, latencyMs };
    if (c.verb === 'EVACUATE') {
      const s = spotByCmd(c.arg)!;
      const f = this.nearestFire(v.pos);
      if (!f) return;
      const wasFleeing = !!v.flee[f.id];
      const t: FleeTarget = { name: s.name, cmd: s.cmd, x: s.x, z: s.z, source: 'planner', latencyMs };
      v.flee[f.id] = t;
      f.fled.add(v.id);
      if (!wasFleeing) this.remember(v, `Told to evacuate to ${s.name}`, 5);
    } else if (c.verb === 'INVESTIGATE') {
      v.investigate = Number(c.arg.replace(/^Fire#/, ''));
    } else if (c.verb === 'HELP_AGENT') {
      const victim = this.villagerByName(c.arg)!;
      const f = this.nearestFire(victim.pos);
      if (f) v.help = { victim: victim.id, fireId: f.id, until: this.simTime + 25, source: 'planner' };
    }
  }

  /* ---------------- misc ---------------- */

  log_(text: string, kind: LogKind = 'info') {
    this.log.unshift({ id: this.logId++, t: `D${this.day} ${this.clock()}`, text, kind });
    if (this.log.length > 80) this.log.length = 80;
  }

  /** Short explanation of why a villager does what it does, from its decision source. */
  explain(v: Villager) {
    const g = v.goal;
    if (!g) return 'Deciding…';
    switch (g.source) {
      case 'planner': {
        // Show the planner's own reasoning (Claude's, when the LLM is on) for the command being executed.
        const n = v.plannerNote;
        if (n && g.cmd === n.cmd)
          return `${n.planner}: "${n.reason}" (arrived after ${(n.latencyMs / 1000).toFixed(1)} s; passed the safety gate)`;
        if (g.key.startsWith('help')) return 'The planner asked for help with a friend in danger; the command passed the safety gate.';
        return 'Coordinated plan from the planner; it passed the safety gate.';
      }
      case 'reflex':
        if (g.key.startsWith('douse')) return 'Guard reflex: respond to any fire within 45 m, without waiting for the planner.';
        if (g.key.startsWith('flee')) return 'Reflex: a fire within 11 m, so run to the nearest safe spot now; the planner may refine it.';
        return 'Reflex: keep clear of fires.';
      case 'need':
        return 'A need crossed its threshold (hysteresis stops flip-flopping).';
      case 'event':
        return 'A village event outranks the daily routine.';
      default:
        return `Daily routine for ${this.clock()}.`;
    }
  }
}

export const ACTIVITY_LABEL: Record<Activity, string> = {
  walk: 'Walking', idle: 'Standing around', chores: 'Doing chores', work: 'Working', eat: 'Eating', forage: 'Foraging',
  sleep: 'Indoors, asleep', social: 'Socializing', dance: 'Dancing', shelter: 'Sheltering', douse: 'Fighting the fire',
};

export { inDanger };
