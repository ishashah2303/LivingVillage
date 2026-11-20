/**
 * Browser transport to the FastAPI planner (WebSocket). Falls back to the in-browser
 * rule-based planner whenever the server is unreachable, so the village never depends on it.
 */
import { ruleBasedPlan, type PlanResult, type SituationReport } from './planner';
import type { PlannerTransport } from './simulation';

type Pending = {
  resolve: (r: PlanResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>;
  report: SituationReport; refreshReport?: () => SituationReport | null;
};

export const DEFAULT_PLANNER_URL = process.env.NEXT_PUBLIC_PLANNER_URL || 'ws://localhost:8000/ws/planner';
/** Planner backbones offered in the start menu (the server keeps the same list in planner.MODELS). */
export const BACKBONES = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'strongest plans, slowest; $4 / $20 per M tokens' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'balanced; $2 / $10 per M tokens' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'fastest and cheapest; $0.10 / $0.50 per M tokens' },
  { id: 'rules', label: 'Rule-based only', note: 'no LLM: instant and free' },
] as const;

export const backboneLabel = (id: string) => BACKBONES.find(b => b.id === id)?.label ?? id;

/** The server gives up on Claude after 30 s and answers with its rules, so this always outlasts it. */
const LLM_TIMEOUT_MS = 35_000;

export class PlannerClient implements PlannerTransport {
  serverInfo: { planner: string; version: string; llm: boolean } | null = null;
  /** Backbone picked in the start menu, sent with every situation report. */
  model: string | null = null;
  private ws: WebSocket | null = null;
  private state: 'connecting' | 'online' | 'offline' = 'connecting';
  private pending = new Map<string, Pending>();
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
    if (!this.serverInfo?.llm || this.model === 'rules') return 'FastAPI rule-based';
    return `${backboneLabel(this.model ?? 'claude-opus-5-5')} (via FastAPI)`;
  }

  status() {
    return this.state;
  }

  private connect() {
    if (this.disposed) return;
    this.state = 'connecting';
    this.serverInfo = null;
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
      if (this.disposed || this.ws !== ws) return;
      this.state = 'online';
      this.backoffMs = 2000;
    };
    ws.onmessage = e => {
      if (this.disposed || this.ws !== ws) return;
      let msg;
      try { msg = JSON.parse(String(e.data)); }
      catch { this.disconnect(ws, 'Invalid server response'); return; }
      if (!msg || typeof msg !== 'object') { this.disconnect(ws, 'Invalid server response'); return; }
      if (msg.type === 'hello' && typeof msg.planner === 'string' && typeof msg.version === 'string')
        this.serverInfo = { planner: msg.planner, version: msg.version, llm: msg.llm === true };
      if (msg.type !== 'plan' && msg.type !== 'error') return;
      if (typeof msg.requestId !== 'string') {
        this.disconnect(ws, 'Server response missing request ID');
        return;
      }
      const p = this.pending.get(msg.requestId);
      if (!p) return;
      if (msg.type === 'error') { this.fallback(msg.requestId, 'Server could not complete the request'); return; }
      if (!validPlan(msg)) { this.fallback(msg.requestId, 'Invalid server plan'); return; }
      this.pending.delete(msg.requestId);
      clearTimeout(p.timer);
      p.resolve({
        source: 'server', planner: msg.planner, commands: msg.commands, summary: msg.summary, notes: msg.notes, model: msg.model, usage: msg.usage,
      });
    };
    ws.onclose = () => this.disconnect(ws, 'Planner connection closed');
    ws.onerror = () => this.disconnect(ws, 'Planner connection failed');
  }

  private disconnect(ws: WebSocket, reason: string) {
    if (this.ws !== ws) return;
    this.ws = null;
    this.state = 'offline';
    this.serverInfo = null;
    ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
    ws.close();
    for (const id of this.pending.keys()) this.fallback(id, reason);
    this.scheduleRetry();
  }

  /** Remove the request before settling it: late/duplicate server replies cannot apply twice. */
  private fallback(id: string, reason: string) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (this.disposed) { p.reject(new Error('planner disposed')); return; }
    try {
      const report = p.refreshReport ? p.refreshReport() : p.report;
      if (!report) { p.reject(new Error('game no longer active')); return; }
      p.resolve({ source: 'local', planner: 'Browser rule-based fallback', commands: ruleBasedPlan(report),
        model: 'rules', summary: `${reason}; browser rules took over.`, notes: [reason] });
    } catch (e) { p.reject(e instanceof Error ? e : new Error(String(e))); }
  }

  private scheduleRetry() {
    if (this.disposed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, 8000);
  }

  plan(report: SituationReport, latencyMs: number, refreshReport?: () => SituationReport | null): Promise<PlanResult> {
    if (this.disposed) return Promise.reject(new Error('planner disposed'));
    const ws = this.ws;
    // The hosted schema caps reports at 32 agents. Large sandbox crowds stay local.
    const local = report.agents.length > 32 || this.state !== 'online' || !ws || ws.readyState !== WebSocket.OPEN;
    const requestId = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      const reason = local ? report.agents.length > 32 ? 'Large crowd uses local planning' : 'Planner server unavailable' : 'Planner request timed out';
      const timer = setTimeout(() => this.fallback(requestId, reason),
        local ? latencyMs : this.serverInfo?.llm && this.model !== 'rules' ? LLM_TIMEOUT_MS : latencyMs + 8000);
      this.pending.set(requestId, { resolve, reject, timer, report, refreshReport });
      if (!local && ws) {
        try { ws.send(JSON.stringify({ type: 'situation', requestId, latencyMs, model: this.model, report })); }
        catch { this.disconnect(ws, 'Planner request could not be sent'); }
      }
    });
  }

  dispose() {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('planner disposed'));
    }
    this.pending.clear();
    if (this.ws) this.disconnect(this.ws, 'Planner closed');
    this.state = 'offline';
  }
}

/** Validate the transport envelope; live command safety still belongs to the simulation gate. */
function validPlan(msg: Record<string, unknown>) {
  const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const usage = msg.usage as Record<string, unknown> | null | undefined;
  return typeof msg.planner === 'string' && Array.isArray(msg.commands) && msg.commands.every(c =>
    c && typeof c === 'object' && ['agent', 'verb', 'arg', 'reason'].every(k => typeof c[k] === 'string') && number(c.ttlS)) &&
    (msg.summary === undefined || typeof msg.summary === 'string') &&
    (msg.notes === undefined || Array.isArray(msg.notes) && msg.notes.every(n => typeof n === 'string')) &&
    (msg.model === undefined || typeof msg.model === 'string') &&
    (usage == null || typeof usage === 'object' && number(usage.inputTokens) && number(usage.outputTokens) && number(usage.costUsd));
}
