/**
 * Browser transport to the FastAPI planner (WebSocket). Falls back to the in-browser
 * rule-based planner whenever the server is unreachable, so the village never depends on it.
 */
import { LocalPlanner } from './localPlanner';
import type { PlanResult, SituationReport } from './planner';
import type { PlannerTransport } from './simulation';

type Pending = { resolve: (r: PlanResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export const DEFAULT_PLANNER_URL = process.env.NEXT_PUBLIC_PLANNER_URL ?? 'ws://localhost:8000/ws/planner';

export class PlannerClient implements PlannerTransport {
  serverInfo: { planner: string; version: string; llm: boolean } | null = null;
  private ws: WebSocket | null = null;
  private state: 'connecting' | 'online' | 'offline' = 'connecting';
  private pending = new Map<string, Pending>();
  private local = new LocalPlanner();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private seq = 0;
  /** Reconnect backoff: 2 s, 4 s, 8 s ... capped at 8 s, reset on success. */
  private backoffMs = 2000;

  constructor(private url = DEFAULT_PLANNER_URL) {
    this.connect();
  }

  get name() {
    if (this.state !== 'online') return 'in-browser fallback';
    return this.serverInfo?.llm ? 'Claude (via FastAPI)' : 'FastAPI';
  }

  status() {
    return this.state;
  }

  private connect() {
    if (this.disposed) return;
    this.state = 'connecting';
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.state = 'offline';
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.state = 'online';
      this.backoffMs = 2000;
    };
    ws.onmessage = e => {
      const msg = JSON.parse(String(e.data));
      if (msg.type === 'hello') this.serverInfo = { planner: msg.planner, version: msg.version, llm: !!msg.llm };
      if (msg.type !== 'plan') return;
      const p = this.pending.get(msg.requestId);
      if (!p) return;
      this.pending.delete(msg.requestId);
      clearTimeout(p.timer);
      p.resolve({ source: 'server', planner: msg.planner, commands: msg.commands, summary: msg.summary, notes: msg.notes });
    };
    ws.onclose = () => {
      this.ws = null;
      this.state = 'offline';
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('connection to the planner closed'));
      }
      this.pending.clear();
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.disposed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, 8000);
  }

  plan(report: SituationReport, latencyMs: number): Promise<PlanResult> {
    const ws = this.ws;
    if (this.state !== 'online' || !ws) return this.local.plan(report, latencyMs);
    const requestId = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('planner timed out'));
      }, latencyMs + 8000);
      this.pending.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: 'situation', requestId, latencyMs, report }));
    });
  }

  dispose() {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
  }
}
