"""Living Village planner service.

Run:  uv run uvicorn app.main:app --port 8000        (from the server/ folder)

REST:      GET  /api/health     service + planner info
           GET  /api/commands   the command grammar the planner may emit
           POST /api/plan       one-shot planning (handy for curl and tests)
WebSocket: /ws/planner          what the browser uses; replies can arrive out of order

Configuration (environment or server/.env):
  ANTHROPIC_API_KEY   enables the Claude planner (otherwise the rule-based planner answers)
  LV_PLANNER          "llm" (default) or "rules"
  LV_MODEL            default Claude model id (default claude-opus-5-5); the browser may pick another
                      backbone from planner.MODELS per request (start menu), or "rules"
  LV_EFFORT           low | medium | high (default low: the plan is short, latency matters)
  LV_ALLOWED_ORIGINS  extra comma-separated browser origins allowed to call the service, e.g.
                      https://ishashah2303.github.io (no path); applies to REST (CORS) and the WebSocket
  LV_LLM_PER_CLIENT   Claude plans per client per hour (default 20); over it the rules answer
  LV_LLM_PER_HOUR     Claude plans per hour for the whole service (default 120)
"""

import asyncio
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from .limits import LLMBudget, client_id  # noqa: E402
from .planner import MODELS, LLMPlanner, RuleBasedPlanner  # noqa: E402
from .schemas import Command, PlanMessage, SituationMessage, SituationReport  # noqa: E402

VERSION = "0.4.0"

app = FastAPI(title="Living Village planner", version=VERSION)
origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
origins += [o.strip() for o in os.getenv("LV_ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

rules = RuleBasedPlanner()
budget = LLMBudget(per_client=int(os.getenv("LV_LLM_PER_CLIENT", "20")), total=int(os.getenv("LV_LLM_PER_HOUR", "120")))
MAX_IN_FLIGHT = 4  # plans per connection; the browser sends one per significant event


def _make_llm() -> LLMPlanner | None:
    if os.getenv("LV_PLANNER", "llm") != "llm":
        return None
    if not (os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN") or os.getenv("ANTHROPIC_PROFILE")):
        return None
    return LLMPlanner(model=os.getenv("LV_MODEL", "claude-opus-5-5"), effort=os.getenv("LV_EFFORT", "low"))


llm = _make_llm()
_backbones: dict[str, LLMPlanner] = {}


def planner_name() -> str:
    return llm.name if llm else rules.name


def planner_for(model: str | None) -> LLMPlanner | None:
    """The Claude planner for a menu choice (None or unknown: the default backbone). None means rules."""
    if llm is None or model == "rules":
        return None
    if model is None or model == llm.model or model not in MODELS:
        return llm
    if model not in _backbones:
        _backbones[model] = LLMPlanner(model=model, effort=llm.effort, timeout_s=llm.timeout_s)
    return _backbones[model]


async def make_plan(report: SituationReport, simulated_latency_ms: int = 0, client: str = "local",
                    model: str | None = None) -> tuple[str, list[Command], str, list[str], dict | None]:
    """Ask Claude; on any failure or over budget answer with the rules so the village never waits on the API.

    Returns (planner name, commands, summary, notes, usage); usage is None when no LLM call was billed.
    """
    planner = planner_for(model)
    if planner is not None and report.fires:
        refused = budget.take(client)
        if refused:
            return rules.name, rules.plan(report), "", [f"Claude skipped: {refused}; used the rule-based planner"], None
        try:
            cmds, summary, dropped, usage = await asyncio.wait_for(planner.plan(report), timeout=planner.timeout_s + 5)
            notes = [f"dropped {d}" for d in dropped]
            return planner.name, cmds, summary, notes, usage
        except Exception as e:  # network, auth, timeout, refusal, bad JSON: all degrade the same way
            note = f"{planner.name} unavailable ({type(e).__name__}: {str(e)[:120]}); used the rule-based planner"
            return rules.name, rules.plan(report), "", [note], None
    # Rules only: optional stand-in delay so the client's staleness handling can still be demonstrated.
    await asyncio.sleep(simulated_latency_ms / 1000)
    return rules.name, rules.plan(report), "", [], None


def _model_id(name: str) -> str:
    return next((k for k, m in MODELS.items() if m["label"] == name), "rules" if name == rules.name else name)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "service": "living-village-planner", "version": VERSION, "planner": planner_name(), "llm": llm is not None,
            "models": list(MODELS) if llm else [], "defaultModel": llm.model if llm else "rules",
            "limits": {"perClientPerHour": budget.per_client, "perHour": budget.total}}


@app.get("/api/commands")
def commands() -> dict:
    return {
        "EVACUATE(place)": "go to a named safe place and stay until the danger is over",
        "INVESTIGATE(Fire#id)": "guard only: go and put out that fire",
        "HELP_AGENT(name)": "run to a villager in danger and leave together",
    }


@app.post("/api/plan")
async def plan_once(report: SituationReport, request: Request) -> PlanMessage:
    started = time.perf_counter()
    peer = request.client.host if request.client else None
    name, cmds, summary, notes, usage = await make_plan(report, client=client_id(request.headers, peer))
    return PlanMessage(requestId="rest", planner=name, worldVersion=report.version,
                       elapsedMs=round((time.perf_counter() - started) * 1000), commands=cmds, summary=summary, notes=notes,
                       model=_model_id(name), usage=usage)


@app.websocket("/ws/planner")
async def planner_socket(ws: WebSocket) -> None:
    # Browsers always send Origin; refuse pages we do not serve. (Non-browser clients can set any
    # Origin, which is why the Claude budget, not this check, is what protects the API key.)
    origin = ws.headers.get("origin")
    if origin is not None and origin not in origins:
        await ws.close(code=1008)
        return
    client = client_id(ws.headers, ws.client.host if ws.client else None)
    await ws.accept()
    await ws.send_json({"type": "hello", "planner": planner_name(), "version": VERSION, "llm": llm is not None,
                        "models": list(MODELS) if llm else []})
    tasks: set[asyncio.Task] = set()

    async def answer(msg: SituationMessage) -> None:
        started = time.perf_counter()
        name, cmds, summary, notes, usage = await make_plan(msg.report, msg.latencyMs, client, msg.model)
        reply = PlanMessage(requestId=msg.requestId, planner=name, worldVersion=msg.report.version,
                            elapsedMs=round((time.perf_counter() - started) * 1000), commands=cmds,
                            summary=summary, notes=notes, model=_model_id(name), usage=usage)
        await ws.send_json(reply.model_dump())

    try:
        while True:
            raw = await ws.receive_json()
            try:
                msg = SituationMessage.model_validate(raw)
            except ValidationError as e:
                await ws.send_json({"type": "error", "detail": e.errors(include_url=False)})
                continue
            if len(tasks) >= MAX_IN_FLIGHT:
                await ws.send_json({"type": "error", "requestId": msg.requestId, "detail": "too many plans in flight"})
                continue
            # Answer concurrently: a slow plan must not block newer situation reports.
            task = asyncio.create_task(answer(msg))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
    except WebSocketDisconnect:
        for task in tasks:
            task.cancel()
