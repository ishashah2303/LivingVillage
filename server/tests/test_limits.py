import asyncio

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.limits import LLMBudget, client_id
from app.planner import LLMPlanner
from app.schemas import SituationReport
from tests.test_planner import report


def test_budget_caps_each_client_and_the_service_over_a_sliding_hour():
    now = [0.0]
    b = LLMBudget(per_client=2, total=3, clock=lambda: now[0])
    assert b.take("a") is None and b.take("a") is None
    assert "this client" in b.take("a")
    assert b.take("b") is None
    assert "service-wide" in b.take("c")
    now[0] = 3600.0  # the window slides: old calls no longer count
    assert b.take("a") is None


def test_client_id_prefers_the_proxy_header():
    assert client_id({"x-forwarded-for": "1.2.3.4, 10.0.0.1"}, "10.0.0.1") == "1.2.3.4"
    assert client_id({}, "127.0.0.1") == "127.0.0.1"


def test_over_budget_answers_with_rules_without_calling_claude(monkeypatch):
    class Boom:
        name = "Claude (test)"
        timeout_s = 1

        async def plan(self, report):
            raise AssertionError("Claude must not be called over budget")

    monkeypatch.setattr(main, "llm", Boom())
    monkeypatch.setattr(main, "budget", LLMBudget(per_client=0, total=10))
    name, cmds, _, notes, _ = asyncio.run(main.make_plan(report(), client="x"))
    assert name == "Rule-based planner" and len(cmds) == 5 and "limit" in notes[0]


def test_no_fire_spends_no_budget(monkeypatch):
    monkeypatch.setattr(main, "llm", LLMPlanner(client=object()))
    monkeypatch.setattr(main, "budget", LLMBudget(per_client=1, total=1))
    asyncio.run(main.make_plan(report(fires=[]), client="x"))
    assert main.budget.take("x") is None


def test_websocket_refuses_foreign_origins():
    client = TestClient(main.app)
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect("/ws/planner", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()
    assert e.value.code == 1008
    with client.websocket_connect("/ws/planner", headers={"origin": "http://localhost:3000"}) as ws:
        assert ws.receive_json()["type"] == "hello"


def test_oversized_reports_are_rejected():
    big = report().model_dump()
    big["agents"] = big["agents"] * 20
    with pytest.raises(ValueError):
        SituationReport.model_validate(big)
    long_name = report().model_dump()
    long_name["agents"][0]["name"] = "x" * 500
    with pytest.raises(ValueError):
        SituationReport.model_validate(long_name)
