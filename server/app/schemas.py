"""Wire format between the browser simulation and the planner (mirrors web/sim/planner.ts)."""

from typing import Literal

from pydantic import BaseModel, Field

Verb = Literal["EVACUATE", "INVESTIGATE", "HELP_AGENT"]


class FireInfo(BaseModel):
    id: int
    x: float
    z: float
    place: str


class SpotInfo(BaseModel):
    cmd: str
    name: str
    x: float
    z: float


class AgentInfo(BaseModel):
    id: int
    name: str
    role: str
    x: float
    z: float
    activity: str
    fleeingTo: str | None = None
    rel: dict[str, float] = Field(default_factory=dict)


class SituationReport(BaseModel):
    """A snapshot of the world at `version`. By the time a plan comes back, it may be stale."""

    version: int
    day: int
    clock: str
    trigger: str
    fires: list[FireInfo]
    spots: list[SpotInfo]
    agents: list[AgentInfo]


class Command(BaseModel):
    """One high-level command, e.g. EVACUATE(ForestClearing) for Maya."""

    agent: str
    verb: Verb
    arg: str
    reason: str
    ttlS: float = 20


class SituationMessage(BaseModel):
    type: Literal["situation"]
    requestId: str
    latencyMs: int = Field(default=0, ge=0, le=15_000)
    report: SituationReport


class PlanMessage(BaseModel):
    type: Literal["plan"] = "plan"
    requestId: str
    planner: str
    worldVersion: int
    elapsedMs: int
    commands: list[Command]
    summary: str = ""
    """The planner's one-sentence explanation of the whole plan."""
    notes: list[str] = Field(default_factory=list)
    """Why the LLM was skipped, or which of its commands were dropped as ungrounded."""
