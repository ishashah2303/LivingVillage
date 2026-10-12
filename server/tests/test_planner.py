from fastapi.testclient import TestClient

from app.main import app
from app.planner import SAFE_DISTANCE, RuleBasedPlanner
from app.schemas import SituationReport

SPOTS = [
    {"cmd": "TownSquare", "name": "the Town Square", "x": 0, "z": 0},
    {"cmd": "Marketplace", "name": "the Marketplace", "x": 11.25, "z": -5},
    {"cmd": "Farm", "name": "the Farm", "x": -20, "z": 10},
    {"cmd": "Pond", "name": "the Pond", "x": -15.625, "z": -6.25},
    {"cmd": "ForestClearing", "name": "the Forest clearing", "x": 20, "z": 14.375},
    {"cmd": "House1", "name": "house 1", "x": -10, "z": -7.45},
    {"cmd": "House6", "name": "house 6", "x": 21.25, "z": -9.95},
]


def agent(id, name, role, x, z, rel=None, fleeing=None):
    return {"id": id, "name": name, "role": role, "x": x, "z": z, "activity": "work", "fleeingTo": fleeing, "rel": rel or {}}


def report(**over) -> SituationReport:
    base = {
        "version": 3, "day": 1, "clock": "10:00", "trigger": "fire_started",
        "fires": [{"id": 1, "x": -17, "z": 0, "place": "Pond"}],
        "spots": SPOTS,
        "agents": [
            agent(0, "Maya", "farmer", -18, 4, {"Oskar": 85, "Lina": 74}),
            agent(3, "Elena", "fisher", -15, -5, {"Lina": 78}),
            agent(6, "Oskar", "farmer", -19, 9, {"Maya": 85}),
            agent(2, "Tomas", "guard", 5, -12),
            agent(7, "Lina", "villager", 10, 5, {"Maya": 74, "Elena": 78}),
        ],
    }
    base.update(over)
    return SituationReport.model_validate(base)


def test_guard_evacuation_and_help():
    cmds = RuleBasedPlanner().plan(report())
    by_verb = {}
    for c in cmds:
        by_verb.setdefault(c.verb, []).append(c)
    assert [(c.agent, c.arg) for c in by_verb["INVESTIGATE"]] == [("Tomas", "Fire#1")]
    assert sorted(c.agent for c in by_verb["EVACUATE"]) == ["Elena", "Maya", "Oskar"]
    # Oskar is Maya's best friend but is in danger himself, so Lina goes.
    assert [(c.agent, c.arg) for c in by_verb["HELP_AGENT"]] == [("Lina", "Maya")]


def test_targets_are_safe_and_load_balanced():
    cmds = [c for c in RuleBasedPlanner().plan(report()) if c.verb == "EVACUATE"]
    spots = {s["cmd"]: s for s in SPOTS}
    for c in cmds:
        s = spots[c.arg]
        assert ((s["x"] + 17) ** 2 + s["z"] ** 2) ** 0.5 >= SAFE_DISTANCE
    counts = {}
    for c in cmds:
        counts[c.arg] = counts.get(c.arg, 0) + 1
    assert max(counts.values()) <= 3


def test_sticky_assignment_keeps_a_still_safe_target():
    r = report()
    r.agents[0].fleeingTo = "House6"
    maya = next(c for c in RuleBasedPlanner().plan(r) if c.agent == "Maya")
    assert maya.arg == "House6" and "keep current target" in maya.reason


def test_no_fire_no_commands():
    assert RuleBasedPlanner().plan(report(fires=[])) == []


def test_rest_and_websocket_roundtrip():
    client = TestClient(app)
    assert client.get("/api/health").json()["ok"] is True
    plan = client.post("/api/plan", json=report().model_dump()).json()
    assert plan["planner"] == "Rule-based planner" and len(plan["commands"]) == 5
    with client.websocket_connect("/ws/planner") as ws:
        assert ws.receive_json()["type"] == "hello"
        ws.send_json({"type": "situation", "requestId": "r1", "latencyMs": 50, "report": report().model_dump()})
        reply = ws.receive_json()
        assert reply["type"] == "plan" and reply["requestId"] == "r1" and reply["worldVersion"] == 3
        assert reply["elapsedMs"] >= 50
        ws.send_json({"type": "situation", "requestId": "bad"})
        assert ws.receive_json()["type"] == "error"
