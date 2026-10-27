"""LLM backbone benchmark: the same emergencies, planned by each Claude model and by the rules.

    uv run python -m bench.run_bench --reps 2          (from server/; needs ANTHROPIC_API_KEY, spends money)
    uv run python -m bench.run_bench --dry-run         (rules only, free)

Scenarios come from real simulation runs (web/sim/exportScenarios.test.ts writes bench/scenarios.json),
plus two synthetic crowds (24 and 32 villagers, the report's cap) to see how plans scale.

Per plan we measure what matters in the game:
  latency      seconds until the plan arrives (villagers run on reflexes meanwhile)
  cost         list-price USD from the response's token usage
  validity     share of the model's commands that survive server-side grounding
  coverage     share of at-risk villagers (within 14 m of a fire, not the guard) given a safe EVACUATE
  overcrowded  safe spots assigned more than 3 villagers (a hard constraint in the prompt)
  guard        the guard was sent to a burning fire
"""

import argparse
import asyncio
import copy
import json
import math
import statistics
import time
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE.parent / ".env")

from app.planner import AT_RISK_RADIUS, MAX_TOKENS, MODELS, SPOT_CAPACITY, LLMPlanner, RuleBasedPlanner, ground_commands  # noqa: E402
from app.schemas import SituationReport  # noqa: E402

FIRST = ["Ada", "Bo", "Cy", "Dee", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo", "Kai", "Lev", "Mo", "Nia", "Ola", "Pim",
         "Quin", "Rue", "Sol", "Tia", "Uma", "Vic", "Wes", "Xan"]


def crowd(base: dict, size: int, extra_fire: dict | None) -> dict:
    """A synthetic village of `size` villagers: the base cast plus newcomers scattered around them."""
    r = copy.deepcopy(base)
    agents = r["agents"]
    k = 0
    while len(agents) < size:
        src = agents[k % 8]
        ang = 2.4 * k
        agents.append({**copy.deepcopy(src), "id": 100 + k, "name": FIRST[k], "role": "villager" if src["role"] == "guard" else src["role"],
                       "x": src["x"] + 3 * math.cos(ang), "z": src["z"] + 3 * math.sin(ang), "fleeingTo": None})
        k += 1
    names = [a["name"] for a in agents]
    for i, a in enumerate(agents):  # deterministic bonds; a few strong friendships
        a["rel"] = {n: (80 if (i + j) % 11 == 0 else 20 + (i * 7 + j * 13) % 50) for j, n in enumerate(names) if n != a["name"]}
    if extra_fire:
        r["fires"].append(extra_fire)
    return r


def load_scenarios() -> list[dict]:
    real = json.loads((HERE / "scenarios.json").read_text(encoding="utf-8"))
    by_id = {s["id"]: s for s in real}
    synth = [
        {"id": "crowd-24", "about": "Synthetic: 24 villagers at the festival fire",
         "report": crowd(by_id["festival-square"]["report"], 24, None)},
        {"id": "crowd-32", "about": "Synthetic: 32 villagers, two fires",
         "report": crowd(by_id["two-fires"]["report"], 32, None)},
    ]
    return real + synth


def score(report: SituationReport, raw: list[dict]) -> dict:
    kept, dropped = ground_commands(report, raw)

    def fire_dist(x: float, z: float) -> float:
        return min(math.hypot(x - f.x, z - f.z) for f in report.fires)

    at_risk = {a.name for a in report.agents if a.role != "guard" and fire_dist(a.x, a.z) < AT_RISK_RADIUS}
    evac = [c for c in kept if c.verb == "EVACUATE"]
    load: dict[str, int] = {}
    for c in evac:
        load[c.arg] = load.get(c.arg, 0) + 1
    guards = {a.name for a in report.agents if a.role == "guard"}
    return {
        "commands": len(raw),
        "validity": len(kept) / len(raw) if raw else 1.0,
        "coverage": len(at_risk & {c.agent for c in evac}) / len(at_risk) if at_risk else 1.0,
        "atRisk": len(at_risk),
        "overcrowded": sum(1 for n in load.values() if n > SPOT_CAPACITY),
        "guard": any(c.verb == "INVESTIGATE" and c.agent in guards for c in kept),
        "dropped": dropped,
    }


async def run_llm(planner: LLMPlanner, sc: dict, rep: int, sem: asyncio.Semaphore) -> dict:
    """Calls the model the same way LLMPlanner does, but keeps the raw commands so grounding can be scored."""
    from app.planner import LLM_SYSTEM, build_llm_prompt, build_output_schema, usage_of

    report = SituationReport.model_validate(sc["report"])
    extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"} if MODELS[planner.model]["fallback"] else {}
    async with sem:
        t0 = time.perf_counter()
        try:
            resp = await planner._get_client().beta.messages.create(
                model=planner.model, max_tokens=MAX_TOKENS, system=LLM_SYSTEM,
                messages=[{"role": "user", "content": build_llm_prompt(report)}],
                output_config={"effort": planner.effort, "format": {"type": "json_schema", "schema": build_output_schema(report)}},
                **extra,
            )
        except Exception as e:  # noqa: BLE001 - a failed call is a data point, not a crash
            return {"model": planner.model, "scenario": sc["id"], "rep": rep, "error": f"{type(e).__name__}: {str(e)[:160]}"}
        latency = time.perf_counter() - t0
    text = next((b.text for b in resp.content if b.type == "text"), "{}")
    raw = json.loads(text).get("commands", []) if resp.stop_reason == "end_turn" else []
    return {"model": planner.model, "scenario": sc["id"], "rep": rep, "latencyS": latency, "stop": resp.stop_reason,
            "servedBy": getattr(resp, "model", planner.model), **usage_of(resp, planner.model), **score(report, raw)}


def run_rules(sc: dict) -> dict:
    report = SituationReport.model_validate(sc["report"])
    t0 = time.perf_counter()
    cmds = RuleBasedPlanner().plan(report)
    latency = time.perf_counter() - t0
    raw = [{"agent": c.agent, "verb": c.verb, "target": c.arg, "reason": c.reason} for c in cmds]
    return {"model": "rules", "scenario": sc["id"], "rep": 0, "latencyS": latency, "costUsd": 0.0, "inputTokens": 0,
            "outputTokens": 0, **score(report, raw)}


def summarize(rows: list[dict], scenarios: list[dict]) -> str:
    out = ["| Planner | Latency mean (p90) | Cost / plan | Validity | Coverage | Overcrowded spots | Guard sent | Errors |",
           "|---|---|---|---|---|---|---|---|"]
    for model in [*MODELS, "rules"]:
        rs = [r for r in rows if r["model"] == model]
        ok = [r for r in rs if "error" not in r]
        if not rs:
            continue
        lat = sorted(r["latencyS"] for r in ok) or [0]
        p90 = lat[min(len(lat) - 1, int(0.9 * len(lat)))]
        label = MODELS[model]["label"] if model in MODELS else "Rule-based"
        out.append(f"| {label} | {statistics.mean(lat):.1f} s ({p90:.1f} s) | ${statistics.mean(r['costUsd'] for r in ok) if ok else 0:.4f} | "
                   f"{statistics.mean(r['validity'] for r in ok) if ok else 0:.0%} | {statistics.mean(r['coverage'] for r in ok) if ok else 0:.0%} | "
                   f"{sum(r['overcrowded'] for r in ok)} | {sum(r['guard'] for r in ok)}/{len(ok)} | {len(rs) - len(ok)} |")
    out += ["", "Per scenario (mean latency s / coverage / input tokens):", "",
            "| Scenario | Villagers | " + " | ".join(MODELS[m]["label"] for m in MODELS) + " | Rules coverage |",
            "|---|---|" + "---|" * (len(MODELS) + 1)]
    for sc in scenarios:
        cells = []
        for m in MODELS:
            ok = [r for r in rows if r["model"] == m and r["scenario"] == sc["id"] and "error" not in r]
            cells.append(f"{statistics.mean(r['latencyS'] for r in ok):.1f} / {statistics.mean(r['coverage'] for r in ok):.0%} / "
                         f"{statistics.mean(r['inputTokens'] for r in ok):.0f}" if ok else "–")
        rule = next((r for r in rows if r["model"] == "rules" and r["scenario"] == sc["id"]), None)
        out.append(f"| {sc['id']} | {len(sc['report']['agents'])} | " + " | ".join(cells) + f" | {rule['coverage']:.0%} |" if rule else "")
    return "\n".join(out)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=2)
    ap.add_argument("--models", default=",".join(MODELS))
    ap.add_argument("--effort", default="low")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--dry-run", action="store_true", help="rules only, no API calls")
    args = ap.parse_args()

    scenarios = load_scenarios()
    rows = [run_rules(sc) for sc in scenarios]
    if not args.dry_run:
        sem = asyncio.Semaphore(args.concurrency)
        planners = [LLMPlanner(model=m, effort=args.effort, timeout_s=60) for m in args.models.split(",")]
        tasks = [run_llm(p, sc, rep, sem) for p in planners for sc in scenarios for rep in range(args.reps)]
        rows += await asyncio.gather(*tasks)
        # Re-running some models keeps the earlier rows of the others.
        old = HERE / "results.json"
        if old.exists():
            rerun = set(args.models.split(",")) | {"rules"}
            rows += [r for r in json.loads(old.read_text(encoding="utf-8")) if r["model"] not in rerun]
    (HERE / "results.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    table = summarize(rows, scenarios)
    total = sum(r.get("costUsd", 0) for r in rows)
    report = f"# Planner backbone benchmark\n\n{len(scenarios)} scenarios, {args.reps} runs per model, effort={args.effort}. " \
             f"Total spend ${total:.3f} (list price).\n\n{table}\n"
    (HERE / "results.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    asyncio.run(main())
