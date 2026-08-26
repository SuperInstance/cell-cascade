// cell-cascade — tests: THE CORTEX PLUG
// The wiring that makes the first totipotent cell that composes: the
// metronome's rule table, the bandleader's sheet/voice at the seam, the
// notation extractor, score assembly, the MCP envelope — and the full
// signal flow through an in-memory organism (tick → table, compose → model)
// with a stubbed seam. No network, no live key: the LIVE run is
// scripts/cortex_plug.ts; these pin the wiring it depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bandleaderSystemPrompt, bandleaderSheet, metronomeSheet, tickPayload,
  composePayload, extractNotationBars, assembleScore, isBarLine,
  mcpToolCall, parseMcpToolResult,
} from '../src/cortex';
import { matchRule, parseSheet, type CellRow } from '../src/cascade';
import { fireSignal, type FireStore } from '../src/firing';
import type { ModelCall, SheetModel } from '../src/bridge';

// ── the spine: the metronome is deterministic fate ─────────────────────────

test('metronome table: downbeat composes, everything else waits', () => {
  const sheet = metronomeSheet(4);
  const rules = (parseSheet({ sheet_json: JSON.stringify(sheet) } as CellRow).rules ?? []) as never[];
  for (let tick = 1; tick <= 12; tick++) {
    const { tick: n, beat } = tickPayload(tick, 4);
    const m = matchRule(rules, 'tick', { tick: n, beat });
    assert.ok(m.hit, `tick ${tick} must hit the table`);
    if (beat === 0) {
      assert.equal(m.response!.action, 'compose');
      assert.equal(m.response!.signal_kind, 'compose');
    } else {
      assert.equal(m.response!.action, 'wait');
    }
  }
});

test('metronome table: EVERY=1 makes every tick a downbeat', () => {
  const rules = metronomeSheet(1).rules as never[];
  for (const tick of [1, 2, 3]) {
    const m = matchRule(rules, 'tick', tickPayload(tick, 1));
    assert.equal(m.response!.action, 'compose');
  }
});

test('tickPayload wraps the beat wheel (beat 0 is the downbeat)', () => {
  assert.deepEqual(tickPayload(1, 4), { tick: 1, beat: 0 });
  assert.deepEqual(tickPayload(4, 4), { tick: 4, beat: 3 });
  assert.deepEqual(tickPayload(5, 4), { tick: 5, beat: 0 });
  assert.deepEqual(tickPayload(9, 4), { tick: 9, beat: 0 });
});

test('metronome sheet carries no model config — the spine never thinks', () => {
  assert.equal(metronomeSheet(4).model, undefined);
});

// ── the cortex: the bandleader's voice at the seam ─────────────────────────

test('bandleader prompt freezes the notation contract', () => {
  const p = bandleaderSystemPrompt({ style: 'blue note stride' });
  assert.ok(p.includes('@piano | s s s s s s s s | vel: NN'), 'bar grammar');
  assert.ok(p.includes('8 slots'), '8th-note grid');
  assert.ok(p.includes('NOTATION CONTRACT (frozen'), 'the freeze');
  assert.ok(p.includes('blue note stride'), 'the sound travels');
  assert.ok(/voice-lead/i.test(p), 'voice-leading instruction');
});

test('bandleader sheet is what the seam parses (parseSheetModel round-trip)', async () => {
  const { parseSheetModel } = await import('../src/bridge');
  const sheet = bandleaderSheet({ model: 'glm-5.3', style: 'test sound', maxTokens: 999, temperature: 0.5 });
  const cfg = parseSheetModel(sheet);
  assert.ok(cfg, 'sheet.model must parse');
  assert.equal(cfg!.model, 'glm-5.3');
  assert.equal(cfg!.max_tokens, 999);
  assert.equal(cfg!.temperature, 0.5);
  assert.ok(cfg!.system_prompt.includes('test sound'));
  assert.equal(cfg!.provider, 'openai-compatible');
});

// ── the hands: extraction & assembly never trust prose ─────────────────────

test('extractNotationBars: keeps the last N bars from a chatty reply', () => {
  const reply = [
    'Here is the bar you asked for:',
    '```',
    '@piano | c4 e4 g4 . e4 . d4 . | vel: 88',
    '@piano | . b3 d4 g4 . a4 . . | vel: 72',
    '```',
    'I aimed for a singing line against the Dm7.',
  ].join('\n');
  const got = extractNotationBars(reply, 1);
  assert.equal(got.lines.length, 1);
  assert.equal(got.lines[0], '@piano | . b3 d4 g4 . a4 . . | vel: 72');
  assert.equal(got.found, 2);
  assert.equal(got.rejected, 1);
});

test('extractNotationBars: zero lines from prose-only (honest, no faking)', () => {
  const got = extractNotationBars('Sorry, I cannot write music today.', 1);
  assert.deepEqual(got.lines, []);
  assert.equal(got.found, 0);
});

test('BARS_PER=2: one thought writes a two-bar window — extraction and prompt both speak it', () => {
  const reply = [
    'Two bars, as asked:',
    '@piano | d3 . f3-c4 . . e4 . . | vel: 60',
    '@piano | . d4 . b3 . f3-g3 . . | vel: 56',
  ].join('\n');
  const got = extractNotationBars(reply, 2);
  assert.equal(got.lines.length, 2, 'the whole window survives');
  assert.equal(got.rejected, 0);
  // the payload carries the cycle\'s chords comma-joined (one per bar)
  const p = composePayload({ barIndex: 0, changes: 'Dm7, G7', bars: 2 });
  assert.equal(p.bars, 2);
  assert.equal(p.changes, 'Dm7, G7');
  // the prompt tells the bandleader how to read a multi-bar changes list
  assert.ok(bandleaderSystemPrompt({}).includes('one'), 'multi-bar changes are named');
  assert.ok(bandleaderSystemPrompt({}).includes('per bar in order'));
});

test('isBarLine accepts chords/rests/flats, rejects headers and chatter', () => {
  assert.ok(isBarLine('@piano | . e3-a3-d4-g4 . . . . e3-a3-d4-g4 g3 | vel: 70'));
  assert.ok(isBarLine('@bass | bb2 . f#3 . . c3 - - | vel: 55'));
  assert.ok(!isBarLine('[MetaData]'));
  assert.ok(!isBarLine('key: C | tempo: 100'));
  assert.ok(!isBarLine('vel: 70'));
  assert.ok(!isBarLine('Here is your bar | with pipes | vel: 70'));
});

test('assembleScore: the header belongs to the organism, not the model', () => {
  const score = assembleScore(
    { title: 'test tune', key: 'C', tempo: 96 },
    ['@piano | c4 . e4 . g4 . . . | vel: 80', '@piano | . b3 d4 g4 . . a4 . | vel: 64'],
  );
  const lines = score.split('\n');
  assert.equal(lines[0], '**TRACK: test tune');
  assert.ok(lines.includes('[MetaData]'));
  assert.equal(lines[3], 'time: 4/4');
  assert.equal(lines.filter(isBarLine).length, 2);
  assert.ok(score.endsWith('\n'));
});

// ── the wire: MCP JSON-RPC envelope ────────────────────────────────────────

test('mcpToolCall speaks JSON-RPC 2.0 tools/call', () => {
  const env = JSON.parse(mcpToolCall(7, 'compile_score', { content: 'x' }));
  assert.equal(env.jsonrpc, '2.0');
  assert.equal(env.id, 7);
  assert.equal(env.method, 'tools/call');
  assert.deepEqual(env.params, { name: 'compile_score', arguments: { content: 'x' } });
});

test('parseMcpToolResult: text results, tool failures, rpc errors', () => {
  const ok = parseMcpToolResult({ result: { content: [{ type: 'text', text: 'compiled 4 bars' }] } });
  assert.equal(ok.text, 'compiled 4 bars');
  assert.equal(ok.isError, false);
  const failed = parseMcpToolResult({ result: { content: [{ type: 'text', text: 'error: notation has errors' }], isError: true } });
  assert.equal(failed.isError, true);
  const rpc = parseMcpToolResult({ error: { code: -32602, message: 'unknown tool' } });
  assert.equal(rpc.isError, true);
  assert.ok(rpc.text.includes('unknown tool'));
});

// ── the organism: full signal flow through the pipeline ────────────────────

function cell(p: Partial<CellRow> & { sheet?: Record<string, unknown> }): CellRow {
  const { sheet, ...rest } = p;
  return {
    id: 'x', organism: 'cortex-test', name: 'x', tier: 'totipotent', role: '',
    sheet_json: '{}', cost_per_call: 1.0, latency_ms: 2000, plasticity: 1.0,
    status: 'active', created_from: null, versions: 1, created_at: 0,
    ...rest,
    ...(sheet ? { sheet_json: JSON.stringify(sheet) } : {}),
  };
}

class MemoryStore implements FireStore {
  cells = new Map<string, CellRow>();
  myelin = new Map<string, { fire_count: number; error_count: number }>();
  signals: Array<{ from_cell: string; to_cell: string; kind: string; mode: string; ok: number }> = [];
  modelCalls: Array<{ cfg: SheetModel; system: string; user: string }> = [];
  modelEnv: 'missing' | 'ok' = 'missing';
  modelContent = '';

  async getCell(id: string) { return this.cells.get(id) ?? null; }
  async getMyelin(pathId: string) { return this.myelin.get(pathId) ?? null; }
  async upsertMyelin(m: { path_id: string; fire_count: number; error_count: number }) {
    this.myelin.set(m.path_id, { fire_count: m.fire_count, error_count: m.error_count });
  }
  async markPromoted() {}
  async insertSignal(s: Parameters<FireStore['insertSignal']>[0]): Promise<number> {
    this.signals.push({ from_cell: s.from_cell, to_cell: s.to_cell, kind: s.kind, mode: s.mode, ok: s.ok });
    return this.signals.length;
  }
  async updateCellTier(c: CellRow, t: CellRow['tier']) { this.cells.get(c.id)!.tier = t; }
  async insertDistillation() {}
  async insertCandidate(): Promise<number> { return 1; }
  async callModel(cfg: SheetModel, req: { system: string; user: string }): Promise<ModelCall> {
    if (this.modelEnv === 'missing') {
      return { ok: false, kind: 'env-missing', latency_ms: 0, error: 'model-call-required' };
    }
    this.modelCalls.push({ cfg, ...req });
    return {
      ok: true, content: this.modelContent, latency_ms: 321,
      usage: { prompt_tokens: 200, completion_tokens: 60, total_tokens: 260 },
      cost_estimate_usd: null,
      log: {
        provider: cfg.provider, model: cfg.model, system_prompt: req.system,
        prompt_tokens: 200, completion_tokens: 60, total_tokens: 260,
        latency_ms: 321, cost_estimate_usd: null, base_url: 'https://stub/v1',
      },
    };
  }
}

function growOrganism(store: MemoryStore): { metro: CellRow; band: CellRow } {
  const zygote = cell({ id: 'zygote', name: 'germ line' });
  const metro = cell({
    id: 'metro', name: 'metronome', tier: 'sclerotic', role: 'the spine',
    cost_per_call: 0, latency_ms: 1, plasticity: 0.05, created_from: 'zygote',
    sheet: metronomeSheet(4),
  });
  const band = cell({
    id: 'band', name: 'bandleader', tier: 'totipotent', role: 'the cortex',
    created_from: 'zygote',
    sheet: bandleaderSheet({ model: 'stub-model', style: 'test' }),
  });
  store.cells.set(zygote.id, zygote);
  store.cells.set(metro.id, metro);
  store.cells.set(band.id, band);
  return { metro, band };
}

const STUB_REPLY = [
  'Sure — the bar for Dm7:',
  '@piano | f3 a3 c4 e4 . d4 . . | vel: 76',
  'Hope the line sings!',
].join('\n');

test('the flow: tick serves table, compose serves model, notation survives', async () => {
  const store = new MemoryStore();
  const { metro, band } = growOrganism(store);
  store.modelEnv = 'ok';
  store.modelContent = STUB_REPLY;

  // ticks 1..3: offbeats — table tissue, no model
  for (let tick = 2; tick <= 4; tick++) {
    const r = await fireSignal(store, { from: 'clock', to: metro.id, kind: 'tick', payload: tickPayload(tick, 4) }, { now: tick, threshold: 25 });
    assert.equal(r.mode, 'table');
    assert.equal(r.response.action, 'wait');
  }
  assert.equal(store.modelCalls.length, 0, 'the spine never thinks');

  // tick 5: downbeat → the metronome forwards compose
  const t5 = await fireSignal(store, { from: 'clock', to: metro.id, kind: 'tick', payload: tickPayload(5, 4) }, { now: 5, threshold: 25 });
  assert.equal(t5.mode, 'table');
  assert.equal(t5.response.action, 'compose');

  // the cortex thinks through the seam, wearing its own voice
  const payload = composePayload({ barIndex: 0, changes: 'Dm7', bars: 1, key: 'C', tempo: 100, recent: [] });
  const c = await fireSignal(store, { from: metro.id, to: band.id, kind: 'compose', payload }, { now: 6, threshold: 25 });
  assert.equal(c.mode, 'model');
  assert.ok(c.ok);
  assert.equal(c.model_log!.model, 'stub-model');
  assert.equal(c.model_log!.total_tokens, 260);
  assert.equal(store.modelCalls.length, 1);
  assert.ok(store.modelCalls[0].system.includes('BANDLEADER'), 'the seam wore the sheet voice');
  assert.ok(store.modelCalls[0].user.includes('"changes": "Dm7"'));

  // the hands: notation extracted from the chatty answer, score assembled
  const got = extractNotationBars(String(c.response.answer), 1);
  assert.equal(got.lines.length, 1);
  assert.equal(got.lines[0], '@piano | f3 a3 c4 e4 . d4 . . | vel: 76');
  const score = assembleScore({ title: 'flow test', key: 'C', tempo: 100 }, got.lines);
  assert.equal(score.split('\n').filter(isBarLine).length, 1);

  // the connectome saw it all, myelin counted every fire
  assert.equal(store.signals.filter(s => s.kind === 'tick').length, 4);
  assert.equal(store.signals.filter(s => s.kind === 'compose').length, 1);
  assert.equal(store.myelin.get(`clock->${metro.id}::tick`)!.fire_count, 4);
  assert.equal(store.myelin.get(`${metro.id}->${band.id}::compose`)!.fire_count, 1);
});

test('the honest boundary: seam unconfigured → model-required, nothing faked', async () => {
  const store = new MemoryStore();
  const { band } = growOrganism(store);
  store.modelEnv = 'missing'; // worker carries no MODEL_BASE_URL/KEY

  const c = await fireSignal(store, { from: 'metro', to: band.id, kind: 'compose', payload: composePayload({ barIndex: 0, changes: 'Dm7', bars: 1 }) }, { now: 1, threshold: 25 });
  assert.equal(c.mode, 'model-required');
  assert.equal(store.modelCalls.length, 0, 'no fetch when the env is missing');
  assert.equal(c.response.deferred, true);
  assert.equal(extractNotationBars(String(c.response.answer ?? ''), 1).lines.length, 0, 'no bars exist — the driver would die honestly');
});

test('escalation still works if a rule-missing differentiated musician appears', async () => {
  // the cortex plug does not need escalation, but the doctrine must survive
  // the new wiring: a differentiated child that misses routes to the germ
  // line — here the bandleader zygote itself — which answers via the seam.
  const store = new MemoryStore();
  const { band } = growOrganism(store);
  const zygote = store.cells.get('zygote')!;
  zygote.sheet_json = JSON.stringify(bandleaderSheet({ model: 'stub-model' }));
  store.modelEnv = 'ok';
  store.modelContent = STUB_REPLY;
  const sideman = cell({
    id: 'sideman', name: 'horn section', tier: 'differentiated', role: 'stabs',
    created_from: 'band', sheet: { rules: [{ when: { kind: 'stab' }, respond: { note: 'yes' } }] },
  });
  store.cells.set(sideman.id, sideman);

  const r = await fireSignal(store, { from: 'metro', to: sideman.id, kind: 'riff', payload: {} }, { now: 1, threshold: 25 });
  // nearest totipotent ancestor is the zygote (band is totipotent too, but
  // the chain goes rootward: sideman -> band; band IS totipotent — the horn
  // grew from the bandleader, so the bandleader answers for its child)
  assert.equal(r.mode, 'escalated');
  assert.equal(r.escalated_from, sideman.id);
  assert.equal(r.answered_by, 'band');
});
