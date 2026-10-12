"""Living Village planner service.

Run:  uv run uvicorn app.main:app --port 8000        (from the server/ folder)

REST:      GET  /api/health     service + planner info
           GET  /api/commands   the command grammar the planner may emit
           POST /api/plan       one-shot planning (handy for curl and tests)
WebSocket: /ws/planner          what the browser uses; replies can arrive out of order

Configuration (environment or server/.env):
  ANTHROPIC_API_KEY   enables the Claude planner (otherwise the rule-based planner answers)
  LV_PLANNER          "llm" (default) or "rules"
  LV_MODEL            Claude model id (default claude-opus-5-5)
  LV_EFFORT           low | medium | high (default low: the plan is short, latency matters)
  LV_ALLOWED_ORIGINS  extra comma-separated browser origins allowed to call the service, e.g.
                      https://harjeet-chahal.github.io (no path); applies to REST (CORS) and the WebSocket
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
from .planner import LLMPlanner, RuleBasedPlanner  # noqa: E402
from .schemas import Command, PlanMessage, SituationMessage, SituationReport  # noqa: E402

VERSION = "0.3.0"

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


def planner_name() -> str:
    return llm.name if llm else rules.name


async def make_plan(report: SituationReport, simulated_latency_ms: int = 0,
                    client: str = "local") -> tuple[str, list[Command], str, list[str]]:
    """Ask Claude; on any failure or over budget answer with the rules so the village never waits on the API."""
    if llm is not None and report.fires:
        refused = budget.take(client)
        if refused:
            return rules.name, rules.plan(report), "", [f"Claude skipped: {refused}; used the rule-based planner"]
        try:
            cmds, summary, dropped = await asyncio.wait_for(llm.plan(report), timeout=llm.timeout_s + 5)
            notes = [f"dropped {d}" for d in dropped]
            return llm.name, cmds, summary, notes
        except Exception as e:  # network, auth, timeout, refusal, bad JSON: all degrade the same way
            note = f"Claude unavailable ({type(e).__name__}: {str(e)[:120]}); used the rule-based planner"
            return rules.name, rules.plan(report), "", [note]
    # Rules only: optional stand-in delay so the client's staleness handling can still be demonstrated.
    await asyncio.sleep(simulated_latency_ms / 1000)
    return rules.name, rules.plan(report), "", []


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "service": "living-village-planner", "version": VERSION, "planner": planner_name(), "llm": llm is not None,
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
    name, cmds, summary, notes = await make_plan(report, client=client_id(request.headers, peer))
    return PlanMessage(requestId="rest", planner=name, worldVersion=report.version,
                       elapsedMs=round((time.perf_counter() - started) * 1000), commands=cmds, summary=summary, notes=notes)


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
    await ws.send_json({"type": "hello", "planner": planner_name(), "version": VERSION, "llm": llm is not None})
    tasks: set[asyncio.Task] = set()

    async def answer(msg: SituationMessage) -> None:
        started = time.perf_counter()
        name, cmds, summary, notes = await make_plan(msg.report, msg.latencyMs, client)
        reply = PlanMessage(requestId=msg.requestId, planner=name, worldVersion=msg.report.version,
                            elapsedMs=round((time.perf_counter() - started) * 1000), commands=cmds,
                            summary=summary, notes=notes)
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
