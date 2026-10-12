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
  LV_ALLOWED_ORIGINS  extra comma-separated CORS origins (e.g. the Vercel URL)
"""

import asyncio
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from .planner import LLMPlanner, RuleBasedPlanner  # noqa: E402
from .schemas import Command, PlanMessage, SituationMessage, SituationReport  # noqa: E402

VERSION = "0.3.0"

app = FastAPI(title="Living Village planner", version=VERSION)
origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
origins += [o.strip() for o in os.getenv("LV_ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

rules = RuleBasedPlanner()


def _make_llm() -> LLMPlanner | None:
    if os.getenv("LV_PLANNER", "llm") != "llm":
        return None
    if not (os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN") or os.getenv("ANTHROPIC_PROFILE")):
        return None
    return LLMPlanner(model=os.getenv("LV_MODEL", "claude-opus-5-5"), effort=os.getenv("LV_EFFORT", "low"))


llm = _make_llm()


def planner_name() -> str:
    return llm.name if llm else rules.name


async def make_plan(report: SituationReport, simulated_latency_ms: int = 0) -> tuple[str, list[Command], str, list[str]]:
    """Ask Claude; on any failure answer with the rules so the village never waits on the API."""
    if llm is not None:
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
    return {"ok": True, "service": "living-village-planner", "version": VERSION, "planner": planner_name(), "llm": llm is not None}


@app.get("/api/commands")
def commands() -> dict:
    return {
        "EVACUATE(place)": "go to a named safe place and stay until the danger is over",
        "INVESTIGATE(Fire#id)": "guard only: go and put out that fire",
        "HELP_AGENT(name)": "run to a villager in danger and leave together",
    }


@app.post("/api/plan")
async def plan_once(report: SituationReport) -> PlanMessage:
    started = time.perf_counter()
    name, cmds, summary, notes = await make_plan(report)
    return PlanMessage(requestId="rest", planner=name, worldVersion=report.version,
                       elapsedMs=round((time.perf_counter() - started) * 1000), commands=cmds, summary=summary, notes=notes)


@app.websocket("/ws/planner")
async def planner_socket(ws: WebSocket) -> None:
    await ws.accept()
    await ws.send_json({"type": "hello", "planner": planner_name(), "version": VERSION, "llm": llm is not None})
    tasks: set[asyncio.Task] = set()

    async def answer(msg: SituationMessage) -> None:
        started = time.perf_counter()
        name, cmds, summary, notes = await make_plan(msg.report, msg.latencyMs)
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
            # Answer concurrently: a slow plan must not block newer situation reports.
            task = asyncio.create_task(answer(msg))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
    except WebSocketDisconnect:
        for task in tasks:
            task.cancel()
