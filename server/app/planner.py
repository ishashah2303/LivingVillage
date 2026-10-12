"""Deliberative planners.

The browser runs the fast, reactive layer (behavior trees at ~2.5 Hz, Detour crowd at 30 Hz).
This service runs the slow layer: it receives a situation report after a significant event and
answers with a few high-level commands. Everything it says is treated as a *suggestion*: the
client re-validates each command against the live world before any villager acts on it.
"""

import math
from typing import Protocol

from .schemas import AgentInfo, Command, SituationReport, SpotInfo

AT_RISK_RADIUS = 14.0
SAFE_DISTANCE = 15.0
SPOT_CAPACITY = 3
CROWD_PENALTY = 6.0
HELP_BOND = 50.0


class Planner(Protocol):
    name: str

    def plan(self, report: SituationReport) -> list[Command]: ...


def _dist(ax: float, az: float, bx: float, bz: float) -> float:
    return math.hypot(ax - bx, az - bz)


class RuleBasedPlanner:
    """Same rules as web/sim/planner.ts (the in-browser fallback); both are tested."""

    name = "Rule-based planner"

    def plan(self, report: SituationReport) -> list[Command]:
        if not report.fires:
            return []

        def fire_dist(x: float, z: float) -> float:
            return min(_dist(x, z, f.x, f.z) for f in report.fires)

        commands: list[Command] = []

        # 1. The guard investigates the newest fire.
        newest = max(report.fires, key=lambda f: f.id)
        for guard in (a for a in report.agents if a.role == "guard"):
            commands.append(Command(agent=guard.name, verb="INVESTIGATE", arg=f"Fire#{newest.id}",
                                    reason=f"guard on duty; fire near the {newest.place}", ttlS=30))

        # 2. Evacuate everyone at risk, spreading them over safe spots.
        at_risk = sorted((a for a in report.agents if a.role != "guard" and fire_dist(a.x, a.z) < AT_RISK_RADIUS),
                         key=lambda a: fire_dist(a.x, a.z))
        safe = [s for s in report.spots if fire_dist(s.x, s.z) >= SAFE_DISTANCE]
        load: dict[str, int] = {}
        for a in at_risk:
            best = self._pick_spot(a, safe, load, fire_dist)
            if best is None:
                continue
            kept = a.fleeingTo == best.cmd
            load[best.cmd] = load.get(best.cmd, 0) + 1
            reason = (f"keep current target, still {round(fire_dist(best.x, best.z))} m from the fire" if kept
                      else f"{best.name} is {round(fire_dist(best.x, best.z))} m from the fire ({load[best.cmd]} assigned)")
            commands.append(Command(agent=a.name, verb="EVACUATE", arg=best.cmd, reason=reason, ttlS=20))

        # 3. The victim's closest friend who is not in danger goes to help.
        if at_risk:
            victim = at_risk[0]
            helpers = [a for a in report.agents
                       if a.role != "guard" and a.name != victim.name and fire_dist(a.x, a.z) >= AT_RISK_RADIUS]
            helpers.sort(key=lambda a: victim.rel.get(a.name, 0), reverse=True)
            if helpers and victim.rel.get(helpers[0].name, 0) > HELP_BOND:
                bond = round(victim.rel[helpers[0].name])
                commands.append(Command(agent=helpers[0].name, verb="HELP_AGENT", arg=victim.name,
                                        reason=f"{victim.name}'s closest friend (bond {bond}) and not in danger", ttlS=25))
        return commands

    @staticmethod
    def _pick_spot(a: AgentInfo, safe: list[SpotInfo], load: dict[str, int], fire_dist) -> SpotInfo | None:
        # Sticky assignment: re-planning should not make villagers change their minds mid-run.
        current = next((s for s in safe if s.cmd == a.fleeingTo), None)
        if current is not None and load.get(current.cmd, 0) < SPOT_CAPACITY:
            return current
        best, best_score = None, math.inf
        for s in safe:
            n = load.get(s.cmd, 0)
            if n >= SPOT_CAPACITY:
                continue
            score = _dist(a.x, a.z, s.x, s.z) + n * CROWD_PENALTY - 0.3 * fire_dist(s.x, s.z)
            if score < best_score:
                best, best_score = s, score
        return best


TTL_BY_VERB = {"EVACUATE": 20.0, "INVESTIGATE": 30.0, "HELP_AGENT": 25.0}

LLM_SYSTEM = """You coordinate the villagers of a small simulated village during emergencies.
You receive a snapshot of the world and reply with a short plan of high-level commands.
The villagers already run their own reflexes (anyone near a fire flees to the nearest safe spot,
the guard runs to fires); your job is coordination the reflexes cannot do.

Commands:
- EVACUATE(target = a safe spot id): the villager goes there and waits until the fire is out.
- INVESTIGATE(target = a fire id such as "Fire#3"): only for the guard; go and put it out.
- HELP_AGENT(target = another villager's name): run to that villager and leave together.

Hard constraints (commands that break them are discarded):
- Only send people to spots whose distance to the nearest fire is at least 15 m.
- At most 3 villagers per spot. Never send someone through or toward a fire if another safe spot exists.
- Only the guard may INVESTIGATE. Only ask someone to help if they are not within 14 m of a fire themselves.

Goals, in order: get everyone within 14 m of a fire to safety; spread them out so no spot is crowded;
keep close friends together when it costs little; send the guard to the newest fire; if a villager is
very close to a fire, ask their closest friend who is safe to come for them.
Leave out villagers who are not affected. Each reason is one short sentence a player will read in the
villager's inspector, written about that villager (for example "The forest clearing is 22 m from the
fire and Oskar is already heading there"). The summary is one sentence describing the whole plan."""


def _round(v: float) -> float:
    return round(v, 1)


def build_llm_prompt(report: SituationReport) -> str:
    """A compact JSON view of the world with distances precomputed (models are poor at geometry)."""
    import json

    def fire_dist(x: float, z: float) -> float:
        return min((_dist(x, z, f.x, f.z) for f in report.fires), default=math.inf)

    agents = []
    for a in report.agents:
        top_friends = sorted(a.rel.items(), key=lambda kv: kv[1], reverse=True)[:3]
        agents.append({
            "name": a.name, "role": a.role, "activity": a.activity,
            "distance_to_fire_m": _round(fire_dist(a.x, a.z)),
            "currently_fleeing_to": a.fleeingTo,
            "closest_friends": {n: round(v) for n, v in top_friends},
        })
    spots = [{
        "id": s.cmd, "name": s.name,
        "distance_to_fire_m": _round(fire_dist(s.x, s.z)),
        "distance_from": {a.name: _round(_dist(a.x, a.z, s.x, s.z)) for a in report.agents
                          if a.role != "guard" and fire_dist(a.x, a.z) < AT_RISK_RADIUS},
    } for s in report.spots]
    fires = [{"id": f"Fire#{f.id}", "near": f.place} for f in report.fires]
    world = {"clock": report.clock, "event": report.trigger, "fires": fires, "villagers": agents, "safe_spots": spots}
    return "Current world state:\n" + json.dumps(world, indent=1)


def build_output_schema(report: SituationReport) -> dict:
    """Constrained decoding: every name the model can emit is enumerated from the live report."""
    names = sorted(a.name for a in report.agents)
    targets = sorted({s.cmd for s in report.spots} | set(names) | {f"Fire#{f.id}" for f in report.fires})
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "commands": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "agent": {"type": "string", "enum": names},
                        "verb": {"type": "string", "enum": ["EVACUATE", "INVESTIGATE", "HELP_AGENT"]},
                        "target": {"type": "string", "enum": targets},
                        "reason": {"type": "string"},
                    },
                    "required": ["agent", "verb", "target", "reason"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["summary", "commands"],
        "additionalProperties": False,
    }


def ground_commands(report: SituationReport, raw: list[dict]) -> tuple[list[Command], list[str]]:
    """Server-side grounding: keep only commands whose verb, agent and target fit together."""
    agents = {a.name: a for a in report.agents}
    spots = {s.cmd: s for s in report.spots}
    fire_ids = {f"Fire#{f.id}" for f in report.fires}

    def fire_dist(x: float, z: float) -> float:
        return min((_dist(x, z, f.x, f.z) for f in report.fires), default=math.inf)

    kept: list[Command] = []
    dropped: list[str] = []
    seen: set[str] = set()
    for c in raw:
        agent, verb, target = c.get("agent"), c.get("verb"), c.get("target")
        label = f"{verb}({target}) for {agent}"
        a = agents.get(agent)
        problem = None
        if a is None:
            problem = "unknown villager"
        elif agent in seen:
            problem = "second command for the same villager"
        elif verb == "EVACUATE" and target not in spots:
            problem = "EVACUATE needs a safe spot"
        elif verb == "EVACUATE" and fire_dist(spots[target].x, spots[target].z) < SAFE_DISTANCE:
            problem = "spot is too close to a fire"
        elif verb == "INVESTIGATE" and (target not in fire_ids or a.role != "guard"):
            problem = "only the guard may investigate a burning fire"
        elif verb == "HELP_AGENT" and (target not in agents or target == agent):
            problem = "HELP_AGENT needs another villager"
        elif verb == "HELP_AGENT" and fire_dist(a.x, a.z) < AT_RISK_RADIUS:
            problem = "helper is in danger too"
        if problem:
            dropped.append(f"{label}: {problem}")
            continue
        seen.add(agent)
        kept.append(Command(agent=agent, verb=verb, arg=target, reason=str(c.get("reason", "")).strip()[:240],
                            ttlS=TTL_BY_VERB[verb]))
    return kept, dropped


class LLMPlanner:
    """Claude coordinates the village; the browser's safety gate still re-checks every command.

    Grounding happens three times: the output schema enumerates every legal name, `ground_commands`
    drops verb/target mismatches here, and the client gate re-validates against the live world
    when the (seconds-old) answer arrives.
    """

    def __init__(self, model: str = "claude-opus-5-5", effort: str = "low", timeout_s: float = 25.0, client=None):
        self.model = model
        self.effort = effort
        self.timeout_s = timeout_s
        self._client = client
        self.name = f"Claude ({model})"

    def _get_client(self):
        if self._client is None:
            import anthropic

            # Credentials come from ANTHROPIC_API_KEY (server/.env) or an `ant auth login` profile.
            self._client = anthropic.AsyncAnthropic(timeout=self.timeout_s, max_retries=1)
        return self._client

    async def plan(self, report: SituationReport) -> tuple[list[Command], str, list[str]]:
        """Returns (commands, one-sentence summary, dropped-command notes). Raises on any API failure."""
        import json

        if not report.fires:
            return [], "No fire is burning.", []
        response = await self._get_client().beta.messages.create(
            model=self.model,
            max_tokens=4096,
            system=LLM_SYSTEM,
            messages=[{"role": "user", "content": build_llm_prompt(report)}],
            output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": build_output_schema(report)}},
            # Opt-in server-side fallback: a safety-classifier decline is retried on another model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if response.stop_reason == "refusal":
            raise RuntimeError("the model declined the request")
        if response.stop_reason == "max_tokens":
            raise RuntimeError("the plan was cut off (max_tokens)")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise RuntimeError("no text block in the response")
        data = json.loads(text)
        commands, dropped = ground_commands(report, data.get("commands", []))
        return commands, str(data.get("summary", "")).strip(), dropped
