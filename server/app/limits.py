"""Spend protection for a publicly hosted planner.

Every Claude call costs money, and a public WebSocket can be reached by anyone. Claude calls are
capped per client and for the whole service over a sliding hour; over either cap the rule-based
planner answers instead, so the village keeps working and nothing is spent.
"""

import time
from collections import deque

WINDOW_S = 3600.0


class LLMBudget:
    def __init__(self, per_client: int, total: int, window_s: float = WINDOW_S, clock=time.monotonic):
        self.per_client = per_client
        self.total = total
        self.window_s = window_s
        self._clock = clock
        self._all: deque[float] = deque()
        self._by_client: dict[str, deque[float]] = {}

    def _prune(self, q: deque[float], now: float) -> None:
        while q and now - q[0] >= self.window_s:
            q.popleft()

    def take(self, client: str) -> str | None:
        """Spend one call for `client`. Returns None if allowed, otherwise why it was refused."""
        now = self._clock()
        self._prune(self._all, now)
        mine = self._by_client.setdefault(client, deque())
        self._prune(mine, now)
        if len(self._all) >= self.total:
            return f"the service-wide limit of {self.total} Claude plans per hour is used up"
        if len(mine) >= self.per_client:
            return f"this client's limit of {self.per_client} Claude plans per hour is used up"
        self._all.append(now)
        mine.append(now)
        if len(self._by_client) > 1000:  # forget idle clients
            for k in [k for k, q in self._by_client.items() if not q]:
                del self._by_client[k]
        return None


def client_id(headers, peer: str | None) -> str:
    """The caller's address; behind a hosting proxy it is the first X-Forwarded-For entry."""
    forwarded = headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return peer or "unknown"
