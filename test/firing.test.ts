// cell-cascade — tests: THE SIGNAL PIPELINE (v0.2)
// Escalation as a path, distillation-candidate recording, the honest
// boundary, myelin/promotion through the new modes — all against an
// in-memory FireStore with a stubbed model seam (no network, no live key).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fireSignal, nearestTotipotentAncestor, growRuleIntoSheet, type FireStore } from '../src/firing';
import type { CellRow, SignalRow } from '../src/cascade';
import type { ModelCall, SheetModel } from '../src/bridge';

function cell(partial: Partial<CellRow>): CellRow {
  return {
    id: 'x', organism: 'org', name: 'x', tier: 'totipotent', role: '',
    sheet_json: '{}', cost_per_call: 1.0, latency_ms: 2000, plasticity: 1.0,
    status: 'active', created_from: null, versions: 1, created_at: 0,
    ...partial,
  };
}

interface RecordedCall { cfg: SheetModel; system: string; user: string }

class MemoryStore implements FireStore {
  cells = new Map<string, CellRow>();
  myelin = new Map<string, { fire_count: number; error_count: number; tier_promoted_to?: string | null }>();
  signals: Array<SignalRow & { payload_obj?: Record<string, unknown> }> = [];
  candidates: Array<Record<string, unknown>> = [];
  distillations: Array<Record<string, unknown>> = [];
  modelCalls: RecordedCall[] = [];
  nextSignalId = 1;
  nextCandidateId = 1;
  // the stubbed seam: env-missing by default (the honest boundary), or a canned responder
  modelEnv: 'missing' | 'ok' | 'fail' = 'missing';
  modelContent = 'GERM LINE ANSWER';

  async getCell(id: string) { return this.cells.get(id) ?? null; }
  async getMyelin(pathId: string) { return this.myelin.get(pathId) ?? null; }
  async upsertMyelin(m: { path_id: string; fire_count: number; error_count: number }) {
    this.myelin.set(m.path_id, { fire_count: m.fire_count, error_count: m.error_count });
  }
  async markPromoted(pathId: string, tier: string) {
    const m = this.myelin.get(pathId); if (m) m.tier_promoted_to = tier;
  }
  async insertSignal(s: Parameters<FireStore['insertSignal']>[0]): Promise<number> {
    const id = this.nextSignalId++;
    this.signals.push({
      id, from_cell: s.from_cell, to_cell: s.to_cell, kind: s.kind,
      payload: JSON.stringify(s.payload), ok: s.ok, mode: s.mode,
      model_log: s.model_log ? JSON.stringify(s.model_log) : null,
      escalated_from: s.escalated_from, at: s.at,
    });
    return id;
  }
  async updateCellTier(c: CellRow, toTier: CellRow['tier']) {
    const t = this.cells.get(c.id)!; t.tier = toTier; t.versions++;
  }
  async insertDistillation(cellId: string, fromTier: string, toTier: string, evidenceRef: string, verdict: string) {
    this.distillations.push({ cell_id: cellId, from_tier: fromTier, to_tier: toTier, evidence_ref: evidenceRef, gardener_verdict: verdict });
  }
  async insertCandidate(c: Parameters<FireStore['insertCandidate']>[0]): Promise<number> {
    const id = this.nextCandidateId++;
    this.candidates.push({ id, ...c });
    return id;
  }
  async callModel(cfg: SheetModel, req: { system: string; user: string }): Promise<ModelCall> {
    if (this.modelEnv === 'missing') {
      return { ok: false, kind: 'env-missing', latency_ms: 0, error: 'model-call-required: MODEL_BASE_URL / MODEL_KEY not configured' };
    }
    this.modelCalls.push({ cfg, ...req }); // recorded only when the seam would actually fetch
    if (this.modelEnv === 'fail') {
      return { ok: false, kind: 'http', latency_ms: 5, error: 'model endpoint 500: boom' };
    }
    return {
      ok: true, content: this.modelContent, latency_ms: 123,
      usage: { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 },
      cost_estimate_usd: 0.0001,
      log: {
        provider: cfg.provider, model: cfg.model, system_prompt: req.system,
        prompt_tokens: 90, completion_tokens: 10, total_tokens: 100,
        latency_ms: 123, cost_estimate_usd: 0.0001, base_url: 'https://stub/v1',
      },
    };
  }
}

const GERMSHEET = JSON.stringify({
  dna: 'germ line',
  model: { provider: 'openai-compatible', model: 'glm-5.3', system_prompt: 'You are the organism germ line.' },
});
const CHILDSHEET = JSON.stringify({
  dna: 'germ line',
  rules: [{ when: { kind: 'nod' }, respond: { ack: 'ROGER' } }],
});

function seededStore(): MemoryStore {
  const s = new MemoryStore();
  s.cells.set('zygote', cell({ id: 'zygote', tier: 'totipotent', sheet_json: GERMSHEET, name: 'germ' }));
  s.cells.set('mid', cell({ id: 'mid', tier: 'multipotent', created_from: 'zygote', sheet_json: GERMSHEET, name: 'mid' }));
  s.cells.set('hand', cell({
    id: 'hand', tier: 'differentiated', created_from: 'mid', sheet_json: CHILDSHEET,
    name: 'ack-tissue', role: 'radio acknowledgements', cost_per_call: 0.15,
  }));
  return s;
}

// ── the bridge, live through the pipeline ─────────────────────────────────────
test('signal: totipotent + model config + env -> REAL model call, logged', async () => {
  const s = seededStore();
  s.modelEnv = 'ok';
  const r = await fireSignal(s, { from: 'environment', to: 'zygote', kind: 'plan', payload: { q: 'what next' } }, { now: 100, threshold: 25 });
  assert.equal(r.mode, 'model');
  assert.equal(r.ok, true);
  assert.equal(r.response.answer, 'GERM LINE ANSWER');
  assert.equal(s.modelCalls.length, 1);
  assert.equal(s.modelCalls[0].cfg.model, 'glm-5.3');
  assert.match(s.modelCalls[0].system, /organism germ line/, 'the sheet voice traveled with the prompt');
  assert.match(s.modelCalls[0].user, /what next/);
  // the exchange is logged on the signal: tokens, latency, cost
  const sig = s.signals.find(x => x.id === r.signal_id)!;
  assert.equal(sig.mode, 'model');
  const log = JSON.parse(sig.model_log!);
  assert.equal(log.total_tokens, 100);
  assert.equal(log.latency_ms, 123);
  assert.equal(log.cost_estimate_usd, 0.0001);
  assert.equal(r.model_log?.provider, 'openai-compatible');
});

test('signal: env missing -> the boundary stays honest (model-required, no call)', async () => {
  const s = seededStore();
  s.modelEnv = 'missing';
  const r = await fireSignal(s, { from: 'environment', to: 'zygote', kind: 'plan', payload: {} }, { now: 100, threshold: 25 });
  assert.equal(r.mode, 'model-required');
  assert.equal(r.ok, true, 'deferred boundary is not an error (v0.1 semantics)');
  assert.equal(s.modelCalls.length, 0, 'nothing fetched');
  assert.match((r.response as { reason: string }).reason, /MODEL_BASE_URL \/ MODEL_KEY/);
});

test('signal: no sheet.model config -> honest model-required', async () => {
  const s = seededStore();
  s.modelEnv = 'ok';
  s.cells.get('zygote')!.sheet_json = JSON.stringify({ dna: 'no model here' });
  const r = await fireSignal(s, { from: 'environment', to: 'zygote', kind: 'plan', payload: {} }, { now: 100, threshold: 25 });
  assert.equal(r.mode, 'model-required');
  assert.equal(s.modelCalls.length, 0);
  assert.match((r.response as { hint: string }).hint, /sheet\.model/);
});

test('signal: differentiated rule hit -> deterministic table, cost 0', async () => {
  const s = seededStore();
  const r = await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'nod', payload: {} }, { now: 100, threshold: 25 });
  assert.equal(r.mode, 'table');
  assert.deepEqual(r.response, { ack: 'ROGER' });
  assert.equal(r.cost_per_call, 0);
  assert.equal(s.modelCalls.length, 0);
});

// ── ESCALATION AS A PATH ──────────────────────────────────────────────────────
test('signal: differentiated rule miss ESCALATES to the nearest totipotent ancestor', async () => {
  const s = seededStore();
  s.modelEnv = 'ok';
  const r = await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'trade', payload: { parity: 'even' } }, { now: 100, threshold: 25 });
  assert.equal(r.mode, 'escalated');
  assert.equal(r.ok, true);
  assert.equal(r.escalated_from, 'hand');
  assert.equal(r.answered_by, 'zygote', 'walked hand -> mid -> zygote, stopped at the first germ cell');
  // the ancestor wore ITS system prompt COMPOSED with the child's role context
  assert.equal(s.modelCalls.length, 1);
  assert.match(s.modelCalls[0].system, /organism germ line/);
  assert.match(s.modelCalls[0].system, /ack-tissue/);
  assert.match(s.modelCalls[0].system, /radio acknowledgements/);
  assert.match(s.modelCalls[0].system, /trade/);
  // cost is the ANCESTOR's tier cost (the germ line did the thinking)
  assert.equal(r.cost_per_call, 1.0);
  // the signal carries the escalation provenance
  const sig = s.signals.find(x => x.id === r.signal_id)!;
  assert.equal(sig.mode, 'escalated');
  assert.equal(sig.escalated_from, 'hand');
  const log = JSON.parse(sig.model_log!);
  assert.equal(log.escalated_from, 'hand');
  assert.equal(log.answered_by, 'zygote');
});

test('signal: successful escalation records a DISTILLATION CANDIDATE', async () => {
  const s = seededStore();
  s.modelEnv = 'ok';
  const r = await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'trade', payload: { parity: 'odd', bar: 13 } }, { now: 100, threshold: 25 });
  assert.equal(r.candidate_id, 1);
  assert.equal(s.candidates.length, 1);
  const c = s.candidates[0];
  assert.equal(c.cell_id, 'hand', 'the cell whose table has the hole');
  assert.equal(c.escalated_to, 'zygote', 'the germ cell that covered it');
  assert.equal(c.signal_id, r.signal_id);
  assert.equal(c.kind, 'trade');
  assert.equal(c.payload_shape, 'bar,parity', 'sorted payload keys = the hole\'s shape');
  assert.equal(c.answer, 'GERM LINE ANSWER', 'the answer is the seed of the future rule');
  assert.equal((c as { status: string }).status ?? 'open', 'open');
});

test('signal: miss + env missing -> escalation-failed, signal NOT served, no candidate', async () => {
  const s = seededStore();
  s.modelEnv = 'missing';
  const r = await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'trade', payload: {} }, { now: 100, threshold: 25 });
  assert.equal(r.mode, 'escalation-failed');
  assert.equal(r.ok, false, 'the table missed and nothing answered — not a defer');
  assert.equal(s.candidates.length, 0, 'no candidate without a successful escalation');
  assert.match((r.response as { reason: string }).reason, /model-call-required/);
});

test('signal: miss + bridge failure mid-escalation -> honest failure', async () => {
  const s = seededStore();
  s.modelEnv = 'fail';
  const r = await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'trade', payload: {} }, { now: 100, threshold: 25 });
  assert.equal(r.mode, 'escalation-failed');
  assert.equal(r.ok, false);
  assert.equal(s.candidates.length, 0);
});

test('signal: miss + no totipotent ancestor -> falls back to own model config', async () => {
  const s = seededStore();
  s.modelEnv = 'ok';
  s.cells.get('zygote')!.tier = 'multipotent'; // lineage has no germ cell left
  const handSheet = { ...JSON.parse(CHILDSHEET), model: { provider: 'openai-compatible', model: 'deepseek-chat', system_prompt: 'hand thinks' } };
  s.cells.get('hand')!.sheet_json = JSON.stringify(handSheet);
  const r = await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'trade', payload: {} }, { now: 100, threshold: 25 });
  assert.equal(r.mode, 'model');
  assert.equal(r.escalated_from, null);
  assert.match((r.response as { note: string }).note, /no totipotent ancestor/);
});

test('signal: miss + no ancestor + no own config -> escalation-failed, wound-heal hint', async () => {
  const s = seededStore();
  s.modelEnv = 'ok';
  s.cells.get('zygote')!.tier = 'multipotent';
  const r = await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'trade', payload: {} }, { now: 100, threshold: 25 });
  assert.equal(r.mode, 'escalation-failed');
  assert.equal(r.ok, false);
  assert.match((r.response as { hint: string }).hint, /wound-heal/);
});

test('signal: sclerotic miss stays scar tissue (v0.1 doctrine unchanged)', async () => {
  const s = seededStore();
  s.cells.get('hand')!.tier = 'sclerotic';
  s.modelEnv = 'ok';
  const r = await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'trade', payload: {} }, { now: 100, threshold: 25 });
  assert.equal(r.mode, 'table-miss');
  assert.equal(r.ok, false);
  assert.equal(s.modelCalls.length, 0, 'sclerotic tissue NEVER consults the model');
  assert.equal(s.candidates.length, 0);
});

test('signal: myelin counts every fire; escalation misses count as errors only when unserved', async () => {
  const s = seededStore();
  s.modelEnv = 'ok';
  await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'trade', payload: {} }, { now: 100, threshold: 25 });
  let m = s.myelin.get('zygote->hand::trade')!;
  assert.deepEqual([m.fire_count, m.error_count], [1, 0], 'a served escalation is a clean fire');
  s.modelEnv = 'missing';
  await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'trade', payload: {} }, { now: 200, threshold: 25 });
  m = s.myelin.get('zygote->hand::trade')!;
  assert.deepEqual([m.fire_count, m.error_count], [2, 1], 'unserved miss = error on the path');
});

test('signal: auto-promotion still works through the seam (threshold 1)', async () => {
  const s = seededStore();
  s.modelEnv = 'ok';
  const r = await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'nod', payload: {} }, { now: 100, threshold: 1 });
  assert.equal(r.promotion?.to, 'sclerotic', 'clean differentiated fire at threshold scleroses');
  assert.equal(s.cells.get('hand')!.tier, 'sclerotic');
  assert.equal(s.distillations.length, 1);
  assert.match(String(s.distillations[0].gardener_verdict), /auto:/);
});

test('lineage: nearestTotipotentAncestor walks created_from, skips non-germ and retired', async () => {
  const s = seededStore();
  const anc = await nearestTotipotentAncestor(s.cells.get('hand')!, (id) => s.getCell(id));
  assert.equal(anc?.id, 'zygote');
  // zygote retired -> nothing (signal-time escalation never dedifferentiates)
  s.cells.get('zygote')!.status = 'retired';
  assert.equal(await nearestTotipotentAncestor(s.cells.get('hand')!, (id) => s.getCell(id)), null);
});

// ── growing the table from a candidate ────────────────────────────────────────
test('resolve: growRuleIntoSheet appends the rule, keeps the sheet DNA', () => {
  const sheet = JSON.parse(CHILDSHEET);
  const next = growRuleIntoSheet(sheet, { when: { kind: 'trade' }, respond: { ack: 'WILCO' } });
  assert.equal((next.rules as unknown[]).length, 2);
  assert.deepEqual((next.rules as Array<{ when: { kind: string } }>)[1].when, { kind: 'trade' });
  assert.equal(next.dna, 'germ line', 'the DNA survives the surgery');
  // a ruleless sheet gains its first rule (the hole starts the table)
  const fresh = growRuleIntoSheet({}, { when: { kind: 'x' }, respond: { y: 1 } });
  assert.deepEqual(fresh.rules, [{ when: { kind: 'x' }, respond: { y: 1 } }]);
});

// ── end-to-end doctrine: miss -> escalate -> candidate -> grow -> table hit ───
test('doctrine: the escalation cycle closes — grown rule serves deterministically', async () => {
  const s = seededStore();
  s.modelEnv = 'ok';
  // 1. the miss escalates and records the candidate
  const r1 = await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'trade', payload: { parity: 'even' } }, { now: 100, threshold: 25 });
  assert.equal(r1.mode, 'escalated');
  assert.ok(r1.candidate_id);
  // 2. the gardener distills the candidate into a rule
  const hand = s.cells.get('hand')!;
  const sheet = growRuleIntoSheet(JSON.parse(hand.sheet_json), { when: { kind: 'trade' }, respond: { ack: 'WILCO' } });
  hand.sheet_json = JSON.stringify(sheet);
  // 3. the same signal now hits the table: cost 0, no model, no escalation
  const r2 = await fireSignal(s, { from: 'zygote', to: 'hand', kind: 'trade', payload: { parity: 'even' } }, { now: 200, threshold: 25 });
  assert.equal(r2.mode, 'table');
  assert.deepEqual(r2.response, { ack: 'WILCO' });
  assert.equal(r2.cost_per_call, 0);
  assert.equal(s.modelCalls.length, 1, 'exactly one model call in the whole cycle');
  assert.equal(s.candidates.length, 1, 'the hole grew shut — no new candidate');
});
