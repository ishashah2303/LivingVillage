/**
 * The villager's brain: one reactive behavior tree shared by all eight villagers.
 * Priorities, top to bottom: emergencies > helping friends > events > needs > routine.
 */
import type { Villager } from './agents';
import { Action, Condition, Selector, Sequence } from './bt';
import type { Simulation } from './simulation';

export interface Ctx {
  v: Villager;
  sim: Simulation;
}

export const villagerTree = Selector<Ctx>('root', 'Villager brain', [
  Sequence('emergency', 'Emergency', [
    Condition('threat', 'Fire within 11 m, or told to evacuate?', c => c.sim.threatFor(c.v) !== null),
    Selector('respond', 'Respond', [
      Sequence('guardDuty', 'Guard duty', [
        Condition('isGuard', 'Am I the guard?', c => c.v.role === 'guard'),
        Condition('fitToFight', 'Healthy enough to fight it? (above 35)', c => c.v.health > 35),
        Action('douse', 'Put out the fire', c => c.sim.actDouse(c.v)),
      ]),
      Action('flee', 'Flee to a safe spot', c => c.sim.actFlee(c.v)),
    ]),
  ]),
  Sequence('helpFriend', 'Help a friend', [
    Condition('helpAssigned', 'Asked to help a friend in danger?', c => c.sim.helpTarget(c.v) !== null),
    Action('escort', 'Run to them, leave together', c => c.sim.actHelp(c.v)),
  ]),
  Sequence('festival', 'Festival', [
    Condition('festivalOn', 'Festival in the square?', c => c.sim.festival > 0),
    Action('dance', 'Dance with the others', c => c.sim.actDance(c.v)),
  ]),
  Sequence('hunger', 'Hunger', [
    Condition('isHungry', 'Hungry? (above 75 until below 15)', c => c.sim.checkHungry(c.v)),
    Selector('findFood', 'Find food', [
      Action('eatDropped', 'Eat food someone left out', c => c.sim.actEatDropped(c.v)),
      Sequence('shortageBranch', 'Market is empty', [
        Condition('isShortage', 'Food shortage?', c => c.sim.shortage > 0),
        Action('forage', 'Forage at the farm', c => c.sim.actForage(c.v)),
      ]),
      Sequence('marketBranch', 'Market', [
        Condition('marketOpen', 'Market open? (07:00 to 21:00)', c => c.sim.marketOpen()),
        Action('eatMarket', 'Eat at the market', c => c.sim.actEatMarket(c.v)),
      ]),
      Action('eatHome', 'Eat at home', c => c.sim.actEatHome(c.v)),
    ]),
  ]),
  Sequence('fatigue', 'Fatigue', [
    Condition('isTired', 'Exhausted? (below 15 until above 85)', c => c.sim.checkTired(c.v)),
    Action('rest', 'Go home and rest', c => c.sim.actRest(c.v)),
  ]),
  Selector('routine', 'Daily routine', [
    Sequence('nightB', 'Night', [
      Condition('isNight', '22:00 to 06:00?', c => c.sim.hour >= 22 || c.sim.hour < 6),
      Action('sleep', 'Sleep at home', c => c.sim.actSleep(c.v)),
    ]),
    Sequence('morningB', 'Morning', [
      Condition('isMorning', 'Before 08:00?', c => c.sim.hour < 8),
      Action('chores', 'Chores at home', c => c.sim.actChores(c.v)),
    ]),
    Sequence('lunchB', 'Lunch', [
      Condition('isLunch', '12:00 to 13:00 and peckish?', c => c.sim.isLunch(c.v)),
      Action('lunch', 'Lunch at the market', c => c.sim.actEatMarket(c.v, true)),
    ]),
    Sequence('workB', 'Work', [
      Condition('isWork', 'Before 17:00?', c => c.sim.hour < 17),
      Action('work', 'Work, patrol or visit', c => c.sim.actWork(c.v)),
    ]),
    Sequence('eveningB', 'Evening', [
      Condition('isEvening', 'Before 21:00?', c => c.sim.hour < 21),
      Action('socialize', 'Socialize', c => c.sim.actSocialize(c.v)),
    ]),
    Action('windDown', 'Wind down at home', c => c.sim.actWindDown(c.v)),
  ]),
]);
