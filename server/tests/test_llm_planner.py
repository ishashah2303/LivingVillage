import asyncio
import json
from types import SimpleNamespace

from app import main
from app.planner import LLMPlanner, build_llm_prompt, build_output_schema, ground_commands
from tests.test_planner import report


class FakeMessages:
    def __init__(self, payload=None, error=None, stop_reason="end_turn"):
        self.payload, self.error, self.stop_reason, self.calls = payload, error, stop_reason, []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return SimpleNamespace(stop_reason=self.stop_reason, model=kwargs["model"],
                               usage=SimpleNamespace(input_tokens=2000, output_tokens=500),
                               content=[SimpleNamespace(type="text", text=json.dumps(self.payload))])


def fake_client(**kw):
    return SimpleNamespace(beta=SimpleNamespace(messages=FakeMessages(**kw)))


def test_schema_enumerates_only_live_names():
    schema = build_output_schema(report())
    item = schema["properties"]["commands"]["items"]["properties"]
    assert item["agent"]["enum"] == ["Elena", "Lina", "Maya", "Oskar", "Tomas"]
    assert "Fire#1" in item["target"]["enum"] and "ForestClearing" in item["target"]["enum"]
    assert "Castle" not in item["target"]["enum"]


def test_prompt_precomputes_distances():
    prompt = build_llm_prompt(report())
    assert '"distance_to_fire_m"' in prompt and '"Fire#1"' in prompt


def test_grounding_drops_unsafe_and_mismatched_commands():
    kept, dropped = ground_commands(report(), [
        {"agent": "Maya", "verb": "EVACUATE", "target": "ForestClearing", "reason": "far from the fire"},
        {"agent": "Elena", "verb": "EVACUATE", "target": "Pond", "reason": "x"},          # 3.5 m from the fire
        {"agent": "Lina", "verb": "INVESTIGATE", "target": "Fire#1", "reason": "x"},      # not the guard
        {"agent": "Oskar", "verb": "HELP_AGENT", "target": "Maya", "reason": "x"},        # in danger himself
        {"agent": "Maya", "verb": "EVACUATE", "target": "House6", "reason": "x"},         # second command
        {"agent": "Tomas", "verb": "INVESTIGATE", "target": "Fire#1", "reason": "guard"},
    ])
    assert [(c.agent, c.verb, c.arg) for c in kept] == [("Maya", "EVACUATE", "ForestClearing"), ("Tomas", "INVESTIGATE", "Fire#1")]
    assert len(dropped) == 4 and kept[0].ttlS == 20


def test_llm_planner_returns_grounded_plan_and_sends_constrained_request():
    client = fake_client(payload={"summary": "Everyone heads east.", "commands": [
        {"agent": "Maya", "verb": "EVACUATE", "target": "ForestClearing", "reason": "Far from the fire."},
        {"agent": "Lina", "verb": "HELP_AGENT", "target": "Maya", "reason": "Maya's friend and safe."},
    ]})
    planner = LLMPlanner(client=client)
    cmds, summary, dropped, usage = asyncio.run(planner.plan(report()))
    assert summary == "Everyone heads east." and dropped == []
    assert usage == {"inputTokens": 2000, "outputTokens": 500, "costUsd": 0.018}  # $4 / $20 per MTok
    assert [c.verb for c in cmds] == ["EVACUATE", "HELP_AGENT"]
    sent = client.beta.messages.calls[0]
    assert sent["model"] == "claude-opus-5-5"
    assert sent["output_config"]["format"]["type"] == "json_schema"
    assert sent["fallbacks"] == "default"


def test_refusal_or_error_falls_back_to_rules(monkeypatch):
    monkeypatch.setattr(main, "llm", LLMPlanner(client=fake_client(error=RuntimeError("boom"))))
    name, cmds, summary, notes, usage = asyncio.run(main.make_plan(report()))
    assert name == "Rule-based planner" and len(cmds) == 5 and "unavailable" in notes[0] and usage is None
    monkeypatch.setattr(main, "llm", LLMPlanner(client=fake_client(payload={}, stop_reason="refusal")))
    name, _, _, notes, _ = asyncio.run(main.make_plan(report()))
    assert name == "Rule-based planner" and "declined" in notes[0]


def test_menu_picks_the_backbone_and_haiku_skips_the_fallback(monkeypatch):
    payload = {"summary": "s", "commands": [{"agent": "Tomas", "verb": "INVESTIGATE", "target": "Fire#1", "reason": "guard"}]}
    default = LLMPlanner(client=fake_client(payload=payload))
    monkeypatch.setattr(main, "llm", default)
    haiku = LLMPlanner(model="claude-haiku-5-5", client=fake_client(payload=payload))
    monkeypatch.setattr(main, "_backbones", {"claude-haiku-5-5": haiku})
    name, cmds, _, _, usage = asyncio.run(main.make_plan(report(), model="claude-haiku-5-5"))
    sent = haiku._client.beta.messages.calls[0]
    assert name == "Claude Haiku 5.5" and sent["model"] == "claude-haiku-5-5" and "fallbacks" not in sent
    assert usage["costUsd"] == round((2000 * 0.10 + 500 * 0.50) / 1e6, 6)
    name, _, _, _, usage = asyncio.run(main.make_plan(report(), model="rules"))
    assert name == "Rule-based planner" and usage is None and not default._client.beta.messages.calls
    name, _, _, _, _ = asyncio.run(main.make_plan(report(), model="gpt-9"))  # unknown: the default backbone
    assert name == "Claude Opus 5.5"


def test_grounding_enforces_spot_capacity():
    raw = [{"agent": n, "verb": "EVACUATE", "target": "ForestClearing", "reason": "x"} for n in ["Maya", "Elena", "Oskar", "Lina"]]
    kept, dropped = ground_commands(report(), raw)
    assert [c.agent for c in kept] == ["Maya", "Elena", "Oskar"]
    assert dropped == ["EVACUATE(ForestClearing) for Lina: spot is full (3 already assigned)"]
