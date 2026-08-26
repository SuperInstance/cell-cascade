// cell-cascade — src/firing.ts
// THE SIGNAL PIPELINE (v0.2). Everything POST /signal does, extracted from
// the router so the whole doctrine is testable without D1: a FireStore
// interface (the worker implements it over D1, tests over memory) plus the
// firing decision tree:
//
//   sclerotic        rule table hit  -> 'table'      (cost 0, deterministic)
//                    rule table miss -> 'table-miss' (scar tissue, ok=0)
//   differentiated   rule table hit  -> 'table'      (the tendency is forming)
//                    rule table miss -> ESCALATE UP: nearest totipotent
//                                      ancestor answers via the model bridge
//                                      wearing its own system prompt composed
//                                      with the child's role context. Logged
//                                      with escalated_from + a DISTILLATION
//                                      CANDIDATE (the hole the organism
//                                      should grow into).
//   multipotent      rule table hit  -> 'table'      (v0.3: the critic's
//                    (with rules)       distilled judgment, cost 0)
//                    rule table miss -> 'model' wearing its OWN scoped
//                                      prompt (tendency first, seam second —
//                                      the serve-split that shrinks the tumor)
//   totipotent/      sheet.model config + worker env -> 'model' (real call,
//   multipotent      tokens/latency/cost logged)
//                    either side missing -> 'model-required' (honest boundary)
//
// No silent guessing anywhere: every serve mode is logged on the signal.

import { TIER_PROFILE, type Tier } from './tiers';
import { matchRule, shouldMyelinate, parseSheet, type Rule, type CellRow } from './cascade';
import {
  parseSheetModel, composeEscalationSystem, type SheetModel, type ModelCall, type ModelExchange,
} from './bridge';

export interface SignalInput {
  from: string;
  to: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface SignalInsert {
  from_cell: string;
  to_cell: string;
  kind: string;
  payload: Record<string, unknown>;
  ok: number;
  mode: string;
  model_log: ModelExchange | null;
  escalated_from: string | null;
  at: number;
}

export interface CandidateInsert {
  organism: string;
  cell_id: string;
  escalated_to: string;
  signal_id: number;
  kind: string;
  payload_shape: string;
  question: string;
  answer: string;
  at: number;
}

/** Everything the pipeline needs from storage + the model seam. The worker
 *  implements this over D1 (with the real bridge); tests over memory. */
export interface FireStore {
  getCell(id: string): Promise<CellRow | null>;
  getMyelin(pathId: string): Promise<{ fire_count: number; error_count: number } | null>;
  upsertMyelin(m: { path_id: string; from_cell: string; to_cell: string; kind: string; fire_count: number; error_count: number; last_fired: number }): Promise<void>;
  markPromoted(pathId: string, tier: Tier): Promise<void>;
  insertSignal(s: SignalInsert): Promise<number>;
  updateCellTier(cell: CellRow, toTier: Tier, at: number): Promise<void>;
  insertDistillation(cellId: string, fromTier: Tier, toTier: Tier, evidenceRef: string, verdict: string, at: number): Promise<void>;
  insertCandidate(c: CandidateInsert): Promise<number>;
  callModel(cfg: SheetModel, req: { system: string; user: string }): Promise<ModelCall>;
}

export type FireMode =
  | 'table'            // deterministic rule hit (sclerotic or differentiated)
  | 'table-miss'       // sclerotic miss: scar tissue, wound-heal
  | 'model'            // the bridge answered, wearing this cell's prompt
  | 'model-required'   // honest boundary: sheet config or worker env missing
  | 'model-error'      // the bridge was attempted and failed (timeout/http)
  | 'escalated'        // germ line answered for a differentiated child
  | 'escalation-failed'; // child missed, no capable ancestor, nothing served

export interface FireResult {
  signal_id: number;
  ok: boolean;
  mode: FireMode;
  response: Record<string, unknown>;
  cost_per_call: number;    // relative tier cost (escalated serves at the ANCESTOR's cost)
  latency_ms: number;       // measured for model modes, ~1 for table
  model_log: ModelExchange | null;
  escalated_from: string | null;
  answered_by: string | null;
  candidate_id: number | null;
  target_tier_before: Tier;
  myelin: { path_id: string; fire_count: number; error_count: number; threshold: number };
  promotion: Record<string, unknown> | null;
}

const MAX_LINEAGE_HOPS = 32;

/** Walk created_from rootward for the nearest ACTIVE totipotent ancestor.
 *  (Signal-time escalation never dedifferentiates — that is wound
 *  healing's job; here the chain must actually contain a germ cell.) */
export async function nearestTotipotentAncestor(
  start: CellRow,
  getCell: (id: string) => Promise<CellRow | null>,
): Promise<CellRow | null> {
  const seen = new Set<string>([start.id]);
  let cur = start.created_from;
  for (let hops = 0; cur && hops < MAX_LINEAGE_HOPS; hops++) {
    if (seen.has(cur)) return null; // cycle guard
    seen.add(cur);
    const cell = await getCell(cur);
    if (!cell) return null;
    if (cell.status === 'active' && cell.tier === 'totipotent') return cell;
    cur = cell.created_from;
  }
  return null;
}

function userPayload(input: SignalInput): string {
  return JSON.stringify({ kind: input.kind, payload: input.payload, from: input.from }, null, 2);
}

function payloadShape(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).sort();
  return keys.length ? keys.join(',') : '(empty)';
}

/** Serve a non-sclerotic cell through the bridge wearing its own prompt. */
async function serveViaModel(
  store: FireStore, cell: CellRow, input: SignalInput, note?: string,
): Promise<Pick<FireResult, 'ok' | 'mode' | 'response' | 'cost_per_call' | 'model_log' | 'answered_by'>> {
  const cfg = parseSheetModel(parseSheet(cell));
  if (!cfg) {
    return {
      ok: true, mode: 'model-required',
      response: {
        deferred: true, boundary: 'model-call-required',
        cost_per_call: cell.cost_per_call, latency_ms: cell.latency_ms,
        hint: `${cell.tier} tissue consults the model — configure sheet.model {provider, model, system_prompt} to let it think`,
        ...(note ? { note } : {}),
      },
      cost_per_call: cell.cost_per_call, model_log: null, answered_by: null,
    };
  }
  const call = await store.callModel(cfg, { system: cfg.system_prompt, user: userPayload(input) });
  if (!call.ok) {
    if (call.kind === 'env-missing') {
      return {
        ok: true, mode: 'model-required',
        response: {
          deferred: true, boundary: 'model-call-required',
          cost_per_call: cell.cost_per_call, latency_ms: cell.latency_ms,
          hint: `${cell.tier} tissue has model config (${cfg.model}) but the worker has no MODEL_BASE_URL/MODEL_KEY`,
          reason: call.error,
          ...(note ? { note } : {}),
        },
        cost_per_call: cell.cost_per_call, model_log: null, answered_by: null,
      };
    }
    return {
      ok: false, mode: 'model-error',
      response: { error: call.error, kind: call.kind, hint: 'the bridge was attempted and failed — signal not served' },
      cost_per_call: cell.cost_per_call, model_log: null, answered_by: null,
    };
  }
  return {
    ok: true, mode: 'model',
    response: { answer: call.content, ...(note ? { note } : {}) },
    cost_per_call: cell.cost_per_call, model_log: call.log, answered_by: cell.id,
  };
}

/** The full pipeline: decide serve mode, fire (model/table/escalation),
 *  update myelin, maybe auto-promote, log the signal (+ candidate). */
export async function fireSignal(
  store: FireStore,
  input: SignalInput,
  opts: { now: number; threshold: number },
): Promise<FireResult> {
  const { now, threshold } = opts;
  const target = await store.getCell(input.to);
  if (!target) throw new Error(`to cell "${input.to}" not found`);
  if (target.status !== 'active') throw new Error(`target cell ${input.to} is ${target.status}`);

  let ok: boolean;
  let mode: FireMode;
  let response: Record<string, unknown>;
  let costPerCall = target.cost_per_call;
  let latencyMs = target.latency_ms;
  let modelLog: ModelExchange | null = null;
  let escalatedFrom: string | null = null;
  let answeredBy: string | null = null;
  let candidateId: number | null = null;

  const sheet = parseSheet(target);
  const rules = Array.isArray(sheet.rules) ? (sheet.rules as Rule[]) : [];

  if (!TIER_PROFILE[target.tier].model_call) {
    // ── sclerotic: pure table, miss = scar tissue (v0.1 doctrine unchanged)
    const m = matchRule(rules, input.kind, input.payload);
    if (m.hit) {
      mode = 'table'; ok = true; response = m.response!;
      costPerCall = 0; latencyMs = 1;
    } else {
      mode = 'table-miss'; ok = false;
      response = { miss: true, hint: 'sclerotic tissue with no rule for this signal — wound-heal or extend the table' };
    }
  } else if (target.tier === 'differentiated' && rules.length > 0) {
    // ── differentiated with a forming table: tendency first, lineage second
    const m = matchRule(rules, input.kind, input.payload);
    if (m.hit) {
      mode = 'table'; ok = true; response = m.response!;
      costPerCall = 0; latencyMs = 1;
    } else {
      // THE ESCALATION PATH: route UP to the nearest totipotent ancestor.
      const ancestor = await nearestTotipotentAncestor(target, (id) => store.getCell(id));
      const ancCfg = ancestor ? parseSheetModel(parseSheet(ancestor)) : null;
      if (ancestor && ancCfg) {
        const system = composeEscalationSystem(
          ancCfg.system_prompt,
          { name: target.name, role: target.role, tier: target.tier },
          input.kind,
        );
        const call = await store.callModel(ancCfg, { system, user: userPayload(input) });
        if (call.ok) {
          mode = 'escalated'; ok = true;
          modelLog = call.log; modelLog.escalated_from = target.id; modelLog.answered_by = ancestor.id;
          escalatedFrom = target.id; answeredBy = ancestor.id;
          costPerCall = ancestor.cost_per_call; latencyMs = call.latency_ms;
          response = {
            answer: call.content,
            escalated_from: target.id,
            answered_by: { id: ancestor.id, name: ancestor.name, tier: 'totipotent' },
            hint: 'the germ line answered for its differentiated child — hole recorded as a distillation candidate',
          };
        } else if (call.kind === 'env-missing') {
          // ancestor exists but the worker can't think: honest boundary
          mode = 'escalation-failed'; ok = false;
          response = {
            miss: true, boundary: 'model-call-required',
            escalated_toward: { id: ancestor.id, name: ancestor.name },
            reason: call.error,
            hint: 'differentiated cell missed its table and the ancestor bridge is unconfigured — signal NOT served',
          };
        } else {
          mode = 'escalation-failed'; ok = false;
          response = { miss: true, error: call.error, kind: call.kind, hint: 'escalation attempted — the bridge failed' };
        }
      } else {
        // no capable ancestor: fall back to the cell's own model (it is
        // still a model tier). If even that can't serve — the table already
        // missed, so the signal is NOT served: honest failure, not a defer.
        const fallbackNote = ancestor
          ? 'ancestor lacks sheet.model config — cell consulted the model directly'
          : 'no totipotent ancestor in lineage — cell consulted the model directly';
        const via = await serveViaModel(store, target, input, fallbackNote);
        ({ ok, mode, response, cost_per_call: costPerCall, model_log: modelLog, answered_by: answeredBy } = via);
        if (mode === 'model-required') {
          mode = 'escalation-failed'; ok = false;
          response = {
            ...response, miss: true,
            reason: 'rule table missed and no model was reachable to serve the signal',
            hint: 'wound-heal the lineage to recall a germ cell, or configure sheet.model / MODEL_BASE_URL+MODEL_KEY',
          };
        }
      }
    }
  } else if (target.tier === 'multipotent' && rules.length > 0) {
    // ── v0.3: multipotent tissue with a forming table — TENDENCY FIRST,
    //    SEAM SECOND (the critic cell's serve-split). A table hit is the
    //    distilled judgment: cost 0, ~1ms, no model. A miss is not an
    //    escalation upward (a scoped model IS this cell's expression) —
    //    the cell consults its own model config wearing its own prompt.
    //    This is what lets judgment distill: repeated clear verdicts hit
    //    the table forever; only genuine ambiguity pays the seam.
    const m = matchRule(rules, input.kind, input.payload);
    if (m.hit) {
      mode = 'table'; ok = true; response = m.response!;
      costPerCall = 0; latencyMs = 1;
    } else {
      const via = await serveViaModel(store, target, input, 'rule table missed — the scoped model adjudicates');
      ({ ok, mode, response, cost_per_call: costPerCall, model_log: modelLog, answered_by: answeredBy } = via);
      if (mode === 'model-required') ok = false; // the boundary stays honest: NOT served
      latencyMs = modelLog?.latency_ms ?? latencyMs;
    }
  } else {
    // ── totipotent / ruleless multipotent & differentiated: the bridge
    const via = await serveViaModel(store, target, input);
    ({ ok, mode, response, cost_per_call: costPerCall, model_log: modelLog, answered_by: answeredBy } = via);
    latencyMs = modelLog ? modelLog.latency_ms : latencyMs;
  }
  if (mode === 'model' || mode === 'escalated') latencyMs = modelLog?.latency_ms ?? latencyMs;

  // ── myelin: the path ledger (every fire counts, misses count against)
  const pathId = `${input.from}->${input.to}::${input.kind}`;
  const before = await store.getMyelin(pathId);
  const fireCount = (before?.fire_count ?? 0) + 1;
  const errorCount = (before?.error_count ?? 0) + (ok ? 0 : 1);
  await store.upsertMyelin({
    path_id: pathId, from_cell: input.from, to_cell: input.to, kind: input.kind,
    fire_count: fireCount, error_count: errorCount, last_fired: now,
  });

  // ── log the signal (the connectome sees HOW the organism served it)
  const signalId = await store.insertSignal({
    from_cell: input.from, to_cell: input.to, kind: input.kind, payload: input.payload,
    ok: ok ? 1 : 0, mode, model_log: modelLog, escalated_from: escalatedFrom, at: now,
  });

  // ── THE DOCTRINE: a successful escalation is a DISTILLATION CANDIDATE —
  //    evidence the rule table has a hole the organism should grow into.
  if (mode === 'escalated') {
    candidateId = await store.insertCandidate({
      organism: target.organism,
      cell_id: target.id,
      escalated_to: answeredBy ?? '',
      signal_id: signalId,
      kind: input.kind,
      payload_shape: payloadShape(input.payload),
      question: `${input.kind} ${JSON.stringify(input.payload)}`.slice(0, 500),
      answer: String((response as { answer?: string }).answer ?? '').slice(0, 2000),
      at: now,
    });
  }

  // ── auto-promotion: differentiated path that myelinated clean scleroses
  let promotion: Record<string, unknown> | null = null;
  const verdict = shouldMyelinate(fireCount, errorCount, threshold);
  if (ok && target.tier === 'differentiated' && verdict.promote) {
    await store.updateCellTier(target, 'sclerotic', now);
    await store.markPromoted(pathId, 'sclerotic');
    await store.insertDistillation(target.id, 'differentiated', 'sclerotic',
      `myelin:${pathId} fires=${fireCount} errors=${errorCount}`,
      `auto: ${verdict.reason}`, now);
    promotion = { cell: target.id, from: 'differentiated', to: 'sclerotic', reason: verdict.reason, cost_now: 0, latency_now_ms: 1 };
  }

  return {
    signal_id: signalId,
    ok, mode, response,
    cost_per_call: costPerCall,
    latency_ms: latencyMs,
    model_log: modelLog,
    escalated_from: escalatedFrom,
    answered_by: answeredBy,
    candidate_id: candidateId,
    target_tier_before: target.tier,
    myelin: { path_id: pathId, fire_count: fireCount, error_count: errorCount, threshold },
    promotion,
  };
}

/** Grow a resolved candidate's rule into a cell's sheet — the organism
 *  filling the hole the escalation exposed. Returns the new sheet. */
export function growRuleIntoSheet(
  sheet: Record<string, unknown>,
  rule: { when: Rule['when']; respond: Record<string, unknown> },
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...sheet };
  const rules = Array.isArray(next.rules) ? [...(next.rules as Rule[])] : [];
  rules.push(rule);
  next.rules = rules;
  return next;
}
