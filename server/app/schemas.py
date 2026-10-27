"""Wire format between the browser simulation and the planner (mirrors web/sim/planner.ts)."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator

Verb = Literal["EVACUATE", "INVESTIGATE", "HELP_AGENT"]

# Size caps: the report becomes the LLM prompt, so a public endpoint must bound it.
Name = Annotated[str, Field(max_length=40)]


class FireInfo(BaseModel):
    id: int
    x: float
    z: float
    place: Name


class SpotInfo(BaseModel):
    cmd: Name
    name: Name
    x: float
    z: float


class AgentInfo(BaseModel):
    id: int
    name: Name
    role: Name
    x: float
    z: float
    activity: Name
    fleeingTo: str | None = Field(default=None, max_length=40)
    rel: dict[str, float] = Field(default_factory=dict)

    @field_validator("rel")
    @classmethod
    def _few_relationships(cls, rel: dict[str, float]) -> dict[str, float]:
        if len(rel) > 32 or any(len(k) > 40 for k in rel):
            raise ValueError("at most 32 relationships with short names")
        return rel


class SituationReport(BaseModel):
    """A snapshot of the world at `version`. By the time a plan comes back, it may be stale."""

    version: int
    day: int
    clock: str = Field(max_length=10)
    trigger: Name
    fires: list[FireInfo] = Field(max_length=16)
    spots: list[SpotInfo] = Field(max_length=32)
    agents: list[AgentInfo] = Field(max_length=32)


class Command(BaseModel):
    """One high-level command, e.g. EVACUATE(ForestClearing) for Maya."""

    agent: str
    verb: Verb
    arg: str
    reason: str
    ttlS: float = 20


class SituationMessage(BaseModel):
    type: Literal["situation"]
    requestId: str = Field(max_length=64)
    latencyMs: int = Field(default=0, ge=0, le=15_000)
    model: str | None = Field(default=None, max_length=40)
    """Backbone picked in the start menu: a key of planner.MODELS, "rules", or None for the server default."""
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
    model: str = ""
    """Model id that answered ("rules" for the rule-based planner)."""
    usage: dict | None = None
    """inputTokens, outputTokens and list-price costUsd of the LLM call, if there was one."""
