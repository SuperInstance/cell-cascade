// cell-cascade — tests: THE CRITIC CELL (v0.3)
// The multipotent ear that closes the GAN loop: the frozen feature gate
// (cheap, cost 0), the gray-zone seam escalation, steering hints, the
// multipotent tendency-first serve in the firing pipeline, the serve-split
// health watch — and the JOURNEY: a full compose cycle through an in-memory
// organism whose seam is stubbed, proving round 2's payload differs from
// round 1 BECAUSE of a critique.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRITIC_FEATURES, AMBIGUITY_BAND, criticIntent, cheapCritique, critiqueServe,
  criticSystemPrompt, criticSheet, parseCriticAnswer, mergeSeamAdjudication,
  steeringFromCritique, critiqueSignalPayload, traceFromReport, composeCycle,
  type TraceBar, type CriticIntent,
} from '../src/critic';
import { matchRule, parseSheet, healthSnapshot, type CellRow, type SignalRow } from '../src/cascade';
import { fireSignal, type FireStore } from '../src/firing';
import { composePayload, bandleaderSystemPrompt } from '../src/cortex';
import type { ModelCall, SheetModel } from '../src/bridge';

// ── fixtures: synthetic traces, no MCP needed ───────────────────────────────

/** A mid-band bar: every gate channel sits comfortably inside the default
 *  intent — the gate must call it clean. */
function goodBar(bar = 1): TraceBar {
  return {
    bar, onsets: 4,
    features: {
      note_density: 0.38, syncopation: 0.3, register_spread: 0.45,
      rest_ratio: 0.45, harmonic_tension: 0.4, interval_size: 0.25,
      avg_pitch: 0.5, velocity_mean: 0.6, velocity_std: 0.2,
    },
  };
}

/** The etude bar: wall-to-wall notes, no rests, leaping intervals. */
function denseBar(bar = 1): TraceBar {
  return {
    bar, onsets: 8,
    features: {
      note_density: 0.85, syncopation: 0.3, register_spread: 0.45,
      rest_ratio: 0.06, harmonic_tension: 0.4, interval_size: 0.7,
      avg_pitch: 0.5,
    },
  };
}

/** Gray zone: density just below the low edge (0.2 - 0.03). */
function grayBar(bar = 1): TraceBar {
  return { ...goodBar(bar), features: { ...goodBar(bar).features, note_density: 0.17 } };
}

// ── the frozen gate ─────────────────────────────────────────────────────────

test('gate: a mid-band bar is clean — accept, cheap serve, no findings', () => {
  const c = cheapCritique([goodBar(1)], criticIntent());
  assert.equal(c.verdict, 'accept');
  assert.equal(critiqueServe(c), 'cheap');
  assert.equal(c.observations.length, 0);
  assert.equal(c.summary, 'clean against the gate');
});

test('gate: the etude bar is a clear revise — density/rest/interval all bad', () => {
  const c = cheapCritique([denseBar(1)], criticIntent());
  assert.equal(c.verdict, 'revise');
  assert.equal(critiqueServe(c), 'cheap');            // clear violations need no model
  const channels = c.observations.filter(o => o.severity === 'bad').map(o => o.channel).sort();
  assert.deepEqual(channels, ['interval_size', 'note_density', 'rest_ratio']);
  assert.ok(c.penalties.total >= 3, 'three bad findings ≥ 3 penalty');
  const st = steeringFromCritique(c, 1);
  assert.ok(st.directives.some(d => /thin the texture/.test(d)), 'density directive present');
  assert.ok(st.directives.some(d => /breath/.test(d)), 'rest directive present');
  assert.ok(st.directives.some(d => /stepwise/.test(d)), 'voice-leading directive present');
  assert.equal(st.verdict, 'revise');
});

test('gate: gray-zone readings are ambiguous — the only case that buys the seam', () => {
  const c = cheapCritique([grayBar(1)], criticIntent());
  assert.equal(critiqueServe(c), 'seam');
  assert.equal(c.ambiguous.length, 1);
  assert.equal(c.ambiguous[0].channel, 'note_density');
  assert.equal(c.ambiguous[0].severity, 'warn');      // provisional until the seam speaks
  // a gray warn alone is not a revise (penalty 0.4 < 1) — the seam decides
  assert.equal(c.verdict, 'accept');
});

test('gate: cross-bar voice-leading — a register teleport between bars is a wound', () => {
  const a = goodBar(1);
  const b = { ...goodBar(2), features: { ...goodBar(2).features, avg_pitch: 0.5 + 0.2 } };
  const c = cheapCritique([a, b], criticIntent());
  const vl = c.observations.find(o => o.kind === 'voice-leading');
  assert.ok(vl, 'voice-leading observation exists');
  assert.equal(vl!.severity, 'bad');                  // 0.15 > jump + ambiguity band
  assert.equal(c.verdict, 'revise');
  assert.ok(vl!.directive.includes('glide'));
});

test('gate: a flat tension curve across 4+ bars is an etude, not a tune', () => {
  const bars = [1, 2, 3, 4].map(n => ({ ...goodBar(n), features: { ...goodBar(n).features, harmonic_tension: 0.4 } }));
  const c = cheapCritique(bars, criticIntent());
  const t = c.observations.find(o => o.kind === 'tension-curve');
  assert.ok(t, 'tension-curve observation exists');
  assert.equal(t!.severity, 'warn');
});

test('gate: intent is overridable per channel (the organism owns the intent)', () => {
  const intent: CriticIntent = criticIntent({ note_density: { lo: 0.8, hi: 1 } });
  const c = cheapCritique([denseBar(1)], intent);
  assert.ok(!c.observations.some(o => o.channel === 'note_density'), 'dense is now in-band');
});

test('traceFromReport reads analyze_features per_bar; garbage degrades to []', () => {
  const report = { per_bar: [{ bar: 1, onsets: 4, features: { note_density: 0.4 }, vector: [0.4] }] };
  assert.equal(traceFromReport(report).length, 1);
  assert.deepEqual(traceFromReport({}), []);
  assert.deepEqual(traceFromReport({ per_bar: 'nope' }), []);
});

// ── the seam: parse + merge, honestly ───────────────────────────────────────

test('parseCriticAnswer: frozen JSON contract, fences tolerated, garbage rejected', () => {
  const good = parseCriticAnswer('```json\n{"adjudications":[{"channel":"note_density","bar":1,"severity":"bad","directive":"fill more slots"}],"verdict":"revise","summary":"too sparse to carry"}\n```');
  assert.ok(good);
  assert.equal(good!.adjudications.length, 1);
  assert.equal(good!.verdict, 'revise');
  assert.equal(parseCriticAnswer('I think it swings, honestly.'), null);
  assert.equal(parseCriticAnswer('{"verdict":"accept"}'), null, 'no adjudications = no answer');
});

test('mergeSeamAdjudication: the seam flips a gray warn to bad; unadjudicated grays stay warns', () => {
  const cheap = cheapCritique([grayBar(1), grayBar(2)], criticIntent());
  assert.equal(cheap.ambiguous.length, 2);
  const merged = mergeSeamAdjudication(cheap, {
    adjudications: [
      { channel: 'note_density', bar: 1, severity: 'bad', directive: 'add a moving inner voice' },
      { channel: 'note_density', bar: 2, severity: 'ok' },
    ],
    verdict: 'revise', summary: 'bar 1 too sparse, bar 2 fine',
  });
  assert.equal(merged.merged, 2);
  assert.equal(merged.critique.verdict, 'revise');     // the bad adjudication forces revise
  const obs = merged.critique.observations.filter(o => o.note.startsWith('seam:'));
  assert.equal(obs.length, 2);
});

// ── the critic's sheet + the multipotent serve-split in the pipeline ────────

test('critic sheet: model config parses at the seam; prompt freezes the JSON contract', async () => {
  const { parseSheetModel } = await import('../src/bridge');
  const sheet = criticSheet({ model: 'glm-5.3', maxTokens: 512, temperature: 0.1 });
  const cfg = parseSheetModel(sheet);
  assert.ok(cfg);
  assert.equal(cfg!.model, 'glm-5.3');
  assert.equal(cfg!.max_tokens, 512);
  assert.equal(cfg!.temperature, 0.1);
  assert.ok(cfg!.system_prompt.includes('THE CRITIC'));
  assert.ok(cfg!.system_prompt.includes('"adjudications"'), 'frozen answer contract');
  assert.ok((sheet.gate as { features: string[] }).features.length === 6, 'six frozen channels');
});

test('critic sheet rule table: serve=cheap hits (cost 0); serve=seam misses', () => {
  const rules = (criticSheet().rules ?? []) as never[];
  const hit = matchRule(rules, 'critique', { serve: 'cheap', bar_index: 3, verdict: 'revise' });
  assert.ok(hit.hit, 'cheap serve hits the table regardless of other payload');
  assert.equal(hit.response!.serve, 'cheap');
  const miss = matchRule(rules, 'critique', { serve: 'seam' });
  assert.ok(!miss.hit, 'seam serve misses — routes to the scoped model');
});

function cell(p: Partial<CellRow> & { sheet?: Record<string, unknown> }): CellRow {
  const { sheet, ...rest } = p;
  return {
    id: 'x', organism: 'critic-test', name: 'x', tier: 'multipotent', role: '',
    sheet_json: '{}', cost_per_call: 0.4, latency_ms: 800, plasticity: 0.6,
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
  modelContent: string | ((req: { system: string; user: string }) => string) = '';

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
    this.modelCalls.push({ cfg, ...req });
    const content = typeof this.modelContent === 'function' ? this.modelContent(req) : this.modelContent;
    return {
      ok: true, content, latency_ms: 99,
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      cost_estimate_usd: null,
      log: {
        provider: cfg.provider, model: cfg.model, system_prompt: req.system,
        prompt_tokens: 100, completion_tokens: 40, total_tokens: 140,
        latency_ms: 99, cost_estimate_usd: null, base_url: 'https://stub/v1',
      },
    };
  }
}

test('firing: multipotent critic serves cheap critiques from the table at cost 0', async () => {
  const store = new MemoryStore();
  const critic = cell({ id: 'ear', name: 'critic', tier: 'multipotent', sheet: criticSheet({ model: 'stub-critic' }) });
  store.cells.set(critic.id, critic);
  const r = await fireSignal(store, { from: 'band', to: 'ear', kind: 'critique', payload: { serve: 'cheap', verdict: 'accept' } }, { now: 1, threshold: 25 });
  assert.equal(r.mode, 'table');
  assert.equal(r.cost_per_call, 0);
  assert.equal(r.latency_ms, 1);
  assert.equal(store.modelCalls.length, 0, 'the gate answered — no model call');
});

test('firing: ambiguous critique misses the table and the seam answers wearing the critic voice', async () => {
  const store = new MemoryStore();
  const critic = cell({ id: 'ear', name: 'critic', tier: 'multipotent', sheet: criticSheet({ model: 'stub-critic' }) });
  store.cells.set(critic.id, critic);
  store.modelContent = '{"adjudications":[{"channel":"note_density","bar":1,"severity":"ok"}],"verdict":"accept","summary":"serves the tune"}';
  const r = await fireSignal(store, { from: 'band', to: 'ear', kind: 'critique', payload: { serve: 'seam', ambiguous: [{ channel: 'note_density', bar: 1 }] } }, { now: 1, threshold: 25 });
  assert.equal(r.mode, 'model');
  assert.equal(store.modelCalls.length, 1);
  assert.ok(store.modelCalls[0].system.includes('THE CRITIC'), 'the seam wore the critic voice');
  assert.ok(store.modelCalls[0].user.includes('note_density'), 'the ambiguity traveled');
});

test('firing: ruleless multipotent cells still go straight to the seam (v0.2 semantics)', async () => {
  const store = new MemoryStore();
  const planner = cell({ id: 'plan', name: 'planner', tier: 'multipotent', sheet: { model: { provider: 'openai-compatible', model: 'stub', system_prompt: 'plan' } } });
  store.cells.set(planner.id, planner);
  store.modelContent = 'a plan';
  const r = await fireSignal(store, { from: 'x', to: 'plan', kind: 'plan', payload: {} }, { now: 1, threshold: 25 });
  assert.equal(r.mode, 'model');
});

// ── steering reaches the bandleader ─────────────────────────────────────────

test('composePayload carries steering; the bandleader prompt makes it binding', () => {
  const c = cheapCritique([denseBar(1)], criticIntent());
  const steering = steeringFromCritique(c, 1);
  const payload = composePayload({ barIndex: 2, changes: 'G7', bars: 1, recent: ['@piano | c4 . e4 . g4 . . . | vel: 80'], steering });
  assert.ok(payload.steering);
  assert.equal((payload.steering as typeof steering).verdict, 'revise');
  assert.deepEqual(Object.keys(payload).sort(), ['bar_index', 'changes', 'recent', 'bars', 'steering'].sort());
  const p = bandleaderSystemPrompt({});
  assert.ok(p.includes('STEERING'), 'prompt names the steering contract');
  assert.ok(p.includes('MUST honor'), 'steering is binding, not a suggestion');
});

test('critiqueSignalPayload: cheap payloads stay small; seam payloads carry the evidence', () => {
  const cheap = cheapCritique([denseBar(1)], criticIntent());
  const cheapPayload = critiqueSignalPayload({ barIndex: 0, round: 1, serve: 'cheap', intent: criticIntent(), critique: cheap, trace: [denseBar(1)] });
  assert.equal(cheapPayload.serve, 'cheap');
  assert.ok(!('bars' in cheapPayload), 'no trace payload on the cheap path');
  const gray = cheapCritique([grayBar(1)], criticIntent());
  const seamPayload = critiqueSignalPayload({ barIndex: 0, round: 1, serve: 'seam', intent: criticIntent(), critique: gray, trace: [grayBar(1)] });
  assert.ok(Array.isArray(seamPayload.ambiguous), 'the seam sees the ambiguity');
  assert.ok(Array.isArray(seamPayload.bars), 'the seam sees the bars');
});

// ── the serve-split health watch ────────────────────────────────────────────

test('healthSnapshot serve_split: the critic ledger reads table vs seam per kind', () => {
  const cells = [
    cell({ id: 'metro', tier: 'sclerotic', cost_per_call: 0, latency_ms: 1, sheet: { rules: [{ when: { kind: 'tick' }, respond: { action: 'wait' } }] } }),
    cell({ id: 'ear', tier: 'multipotent', sheet: criticSheet() }),
  ];
  const sig = (kind: string, mode: string, to: string): SignalRow =>
    ({ id: 0, from_cell: 'x', to_cell: to, kind, payload: null, ok: 1, mode, model_log: null, escalated_from: null, at: 0 });
  const signals = [
    sig('tick', 'table', 'metro'), sig('tick', 'table', 'metro'), sig('tick', 'table', 'metro'), sig('tick', 'table', 'metro'),
    sig('critique', 'table', 'ear'), sig('critique', 'table', 'ear'), sig('critique', 'table', 'ear'),
    sig('critique', 'model', 'ear'),
  ];
  const snap = healthSnapshot('org', cells, [], signals);
  assert.equal(snap.serve_split.by_kind.critique.signals, 4);
  assert.equal(snap.serve_split.by_kind.critique.table_pct, 75);
  assert.equal(snap.serve_split.by_kind.critique.model_pct, 25);
  assert.equal(snap.serve_split.by_kind.tick.table_pct, 100);
  assert.equal(snap.serve_split.worst_offender, 'critique');
  assert.ok(snap.serve_split.note.includes('critique 75% table / 25% seam'));
});

// ── THE JOURNEY: the GAN loop steers round 2 through a mocked seam ─────────

test('JOURNEY: compose → gate critique → round-2 payload differs because of the critique', async () => {
  const store = new MemoryStore();
  const zygote = cell({ id: 'zygote', tier: 'totipotent', name: 'germ' });
  const band = cell({
    id: 'band', name: 'bandleader', tier: 'totipotent', created_from: 'zygote',
    sheet: { model: { provider: 'openai-compatible', model: 'stub-band', system_prompt: 'YOU ARE THE BANDLEADER' } },
  });
  const ear = cell({ id: 'ear', name: 'critic', tier: 'multipotent', created_from: 'zygote', sheet: criticSheet({ model: 'stub-critic' }) });
  store.cells.set('zygote', zygote); store.cells.set('band', band); store.cells.set('ear', ear);

  // the stub bandleader: round 1 writes an etude bar, round 2 (only when
  // STEERED) writes the thinned, breathing bar the critic demanded
  const ETUDE = '@piano | c4 e4 g4 e4 c4 e4 g4 e4 | vel: 90';
  const THINNED = '@piano | c4 . g3 . . e4 . . | vel: 72';
  store.modelContent = (req: { user: string }) =>
    req.user.includes('"steering"') ? `Take two:\n${THINNED}` : `Here it comes:\n${ETUDE}`;

  // the ear: fixture analysis — the etude bar is dense; the thinned bar is clean
  const analyze = async (_soFar: string[], candidate: string[]): Promise<TraceBar[] | null> => {
    if (candidate[0] === THINNED) return [goodBar(1)];
    const f = { ...denseBar(1).features, harmonic_tension: 0.4, avg_pitch: 0.5 };
    return [{ bar: 1, onsets: 8, features: f }];
  };

  const cycle = await composeCycle({
    fireCompose: async payload => {
      const r = await fireSignal(store, { from: 'metro', to: 'band', kind: 'compose', payload }, { now: 1, threshold: 25 });
      return {
        ok: r.ok && r.mode === 'model',
        mode: r.mode,
        answer: String((r.response as Record<string, unknown>).answer ?? ''),
        latencyMs: r.latency_ms,
      };
    },
    fireCritique: async payload => {
      const r = await fireSignal(store, { from: 'band', to: 'ear', kind: 'critique', payload }, { now: 1, threshold: 25 });
      return {
        ok: r.ok && r.mode === 'model',
        mode: r.mode,
        answer: String((r.response as Record<string, unknown>).answer ?? ''),
      };
    },
    analyze,
  }, {
    barIndex: 0, changes: 'Dm7', bars: 1, recent: [],
    intent: criticIntent(), steering: null, ganRounds: 2,
    key: 'C', tempo: 100,
    extract: (reply, n) => {
      const lines = reply.split('\n').filter(l => l.trim().startsWith('@piano'));
      return lines.slice(-n);
    },
  });

  // the loop: two rounds, round 2 steered
  assert.equal(cycle.rounds.length, 2, 'the critique bought a second round');
  const r1 = cycle.rounds[0], r2 = cycle.rounds[1];
  assert.equal(r1.bars[0], ETUDE);
  assert.equal(r2.bars[0], THINNED, 'round 2 recomposed');
  assert.ok(!('steering' in r1.payload), 'round 1 composed blind');
  assert.ok('steering' in r2.payload, 'round 2 carried steering');
  assert.notEqual(JSON.stringify(r1.payload), JSON.stringify(r2.payload), 'the payloads differ because of the critique');
  const st = r2.payload.steering as ReturnType<typeof steeringFromCritique>;
  assert.ok(st.directives.some(d => /thin the texture/.test(d)), 'the density directive steered');

  // the seam: exactly 2 model calls (both composes); the critique served CHEAP
  assert.equal(store.modelCalls.length, 2);
  assert.ok(store.modelCalls.every(c => c.system.includes('BANDLEADER')), 'composes wore the bandleader voice');
  const critiqueSigs = store.signals.filter(s => s.kind === 'critique');
  assert.equal(critiqueSigs.length, 2);
  assert.ok(critiqueSigs.every(s => s.mode === 'table'), 'both critiques served by the gate at cost 0');

  // the verdict: round 2 accepted clean
  assert.equal(r2.accepted, true);
  assert.deepEqual(cycle.acceptedBars, [THINNED]);
  assert.equal(cycle.finalCritique!.verdict, 'accept');
  assert.equal(cycle.steering!.verdict, 'accept');   // carried forward: empty directives, next bar composes fresh
  assert.equal(cycle.steering!.directives.length, 0);
});

test('JOURNEY (seam escalation): a gray bar buys the critic a model call, the merge flips the verdict', async () => {
  const store = new MemoryStore();
  const zygote = cell({ id: 'zygote', tier: 'totipotent' });
  const band = cell({ id: 'band', tier: 'totipotent', created_from: 'zygote', sheet: { model: { provider: 'openai-compatible', model: 'stub-band', system_prompt: 'BAND' } } });
  const ear = cell({ id: 'ear', tier: 'multipotent', created_from: 'zygote', sheet: criticSheet({ model: 'stub-critic' }) });
  store.cells.set('zygote', zygote); store.cells.set('band', band); store.cells.set('ear', ear);

  const GRAYBAR = '@piano | d3 . a3 . . c4 . . | vel: 70';
  store.modelContent = `here:\n${GRAYBAR}`;
  const analyze = async (): Promise<TraceBar[]> => [grayBar(1)];  // always gray on density

  // seam stub answers by prompt: the critic prompt gets JSON, the band prompt gets a bar
  const realCall = store.callModel.bind(store);
  store.callModel = async (cfg, req) => {
    if (cfg.system_prompt.includes('CRITIC')) {
      store.modelContent = '{"adjudications":[{"channel":"note_density","bar":1,"severity":"bad","directive":"add a moving inner voice"}],"verdict":"revise","summary":"too spare"}';
    } else {
      store.modelContent = `again:\n${GRAYBAR}`;
    }
    return realCall(cfg, req);
  };

  const cycle = await composeCycle({
    fireCompose: async payload => {
      const r = await fireSignal(store, { from: 'metro', to: 'band', kind: 'compose', payload }, { now: 1, threshold: 25 });
      return { ok: r.ok && r.mode === 'model', mode: r.mode, answer: String((r.response as Record<string, unknown>).answer ?? ''), latencyMs: 0 };
    },
    fireCritique: async payload => {
      const r = await fireSignal(store, { from: 'band', to: 'ear', kind: 'critique', payload }, { now: 1, threshold: 25 });
      return { ok: r.ok && r.mode === 'model', mode: r.mode, answer: String((r.response as Record<string, unknown>).answer ?? '') };
    },
    analyze,
  }, {
    barIndex: 0, changes: 'Cmaj7', bars: 1, recent: [],
    intent: criticIntent(), steering: null, ganRounds: 2,
    extract: (reply, n) => reply.split('\n').filter(l => l.trim().startsWith('@piano')).slice(-n),
  });

  // both rounds gray → both critiques SEAM-served; round-1 merge said revise
  const seamServes = store.signals.filter(s => s.kind === 'critique' && s.mode === 'model');
  assert.equal(seamServes.length, 2, 'gray critiques route through the seam');
  assert.equal(cycle.rounds[0].serve, 'seam');
  assert.equal(cycle.rounds[0].critique!.verdict, 'revise', 'the seam adjudication flipped the verdict');
  assert.ok(cycle.rounds[0].critique!.summary.includes('seam'));
  assert.ok(store.modelCalls.some(c => c.system.includes('CRITIC')), 'the critic thought through the seam');
  // cap reached: round 2 accepted with the critique carried forward
  assert.equal(cycle.acceptedBars[0], GRAYBAR);
  assert.equal(cycle.steering!.verdict, 'revise');
});

test('JOURNEY (honest degradation): the ear unavailable → v0.2 semantics, no critique invented', async () => {
  const store = new MemoryStore();
  const band = cell({ id: 'band', tier: 'totipotent', sheet: { model: { provider: 'openai-compatible', model: 'stub-band', system_prompt: 'BAND' } } });
  store.cells.set('band', band);
  const BAR = '@piano | c4 . e4 . g4 . . . | vel: 80';
  store.modelContent = `ok:\n${BAR}`;
  const cycle = await composeCycle({
    fireCompose: async payload => {
      const r = await fireSignal(store, { from: 'metro', to: 'band', kind: 'compose', payload }, { now: 1, threshold: 25 });
      return { ok: r.ok && r.mode === 'model', mode: r.mode, answer: String((r.response as Record<string, unknown>).answer ?? ''), latencyMs: 0 };
    },
    fireCritique: async () => { throw new Error('must not fire — no trace means no critique'); },
    analyze: async () => null,
  }, {
    barIndex: 0, changes: 'Dm7', bars: 1, recent: [],
    intent: criticIntent(), steering: null, ganRounds: 2,
    extract: (reply, n) => reply.split('\n').filter(l => l.trim().startsWith('@piano')).slice(-n),
  });
  assert.equal(cycle.rounds.length, 1, 'accepted on round 1 — no trace, no critique, no second round');
  assert.equal(cycle.rounds[0].serve, 'none');
  assert.equal(cycle.rounds[0].critique, null);
  assert.deepEqual(cycle.acceptedBars, [BAR]);
  assert.equal(cycle.steering, null, 'nothing to carry — honest');
});
