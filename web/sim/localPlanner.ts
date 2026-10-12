import { ruleBasedPlan, type PlanResult, type SituationReport } from './planner';
import type { PlannerTransport } from './simulation';

/** In-browser fallback when the FastAPI planner is offline. Same rules, same simulated latency. */
export class LocalPlanner implements PlannerTransport {
  readonly name = 'rule-based';

  status() {
    return 'online' as const;
  }

  plan(report: SituationReport, latencyMs: number): Promise<PlanResult> {
    return new Promise(resolve =>
      setTimeout(() => resolve({ source: 'local', planner: 'Rule-based planner', commands: ruleBasedPlan(report) }), latencyMs),
    );
  }
}
