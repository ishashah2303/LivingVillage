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
        return SimpleNamespace(stop_reason=self.stop_reason, content=[SimpleNamespace(type="text", text=json.dumps(self.payload))])


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
    cmds, summary, dropped = asyncio.run(planner.plan(report()))
    assert summary == "Everyone heads east." and dropped == []
    assert [c.verb for c in cmds] == ["EVACUATE", "HELP_AGENT"]
    sent = client.beta.messages.calls[0]
    assert sent["model"] == "claude-opus-5-5"
    assert sent["output_config"]["format"]["type"] == "json_schema"
    assert sent["fallbacks"] == "default"


def test_refusal_or_error_falls_back_to_rules(monkeypatch):
    monkeypatch.setattr(main, "llm", LLMPlanner(client=fake_client(error=RuntimeError("boom"))))
    name, cmds, summary, notes = asyncio.run(main.make_plan(report()))
    assert name == "Rule-based planner" and len(cmds) == 5 and "Claude unavailable" in notes[0]
    monkeypatch.setattr(main, "llm", LLMPlanner(client=fake_client(payload={}, stop_reason="refusal")))
    name, _, _, notes = asyncio.run(main.make_plan(report()))
    assert name == "Rule-based planner" and "declined" in notes[0]
