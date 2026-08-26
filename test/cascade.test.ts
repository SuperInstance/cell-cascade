// cell-cascade — tests: tier ladder, myelin math, rule table, lineage, wounds, health
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS, TIER_PROFILE, isTier, canDistill, tierIndex,
} from '../src/tiers';
import {
  shouldMyelinate, matchRule, lineageOf, healPlan, healthSnapshot,
  MYELIN_THRESHOLD_DEFAULT, type CellRow, type MyelinRow, type SignalRow,
} from '../src/cascade';

function cell(partial: Partial<CellRow>): CellRow {
  return {
    id: 'x', organism: 'org', name: 'x', tier: 'totipotent', role: '',
    sheet_json: '{}', cost_per_call: 1.0, latency_ms: 2000, plasticity: 1.0,
    status: 'active', created_from: null, versions: 1, created_at: 0,
    ...partial,
  };
}

// ── the ladder ────────────────────────────────────────────────────────────────
test('ladder: totipotent > multipotent > differentiated > sclerotic', () => {
  assert.deepEqual([...TIERS], ['totipotent', 'multipotent', 'differentiated', 'sclerotic']);
  assert.equal(tierIndex('totipotent'), 0);
  assert.equal(tierIndex('sclerotic'), 3);
});

test('ladder: cost and latency fall monotonically down the ladder', () => {
  for (let i = 1; i < TIERS.length; i++) {
    assert.ok(TIER_PROFILE[TIERS[i]].cost_per_call < TIER_PROFILE[TIERS[i - 1]].cost_per_call,
      `${TIERS[i]} should be cheaper than ${TIERS[i - 1]}`);
    assert.ok(TIER_PROFILE[TIERS[i]].latency_ms < TIER_PROFILE[TIERS[i - 1]].latency_ms);
    assert.ok(TIER_PROFILE[TIERS[i]].plasticity < TIER_PROFILE[TIERS[i - 1]].plasticity);
  }
  assert.equal(TIER_PROFILE.sclerotic.cost_per_call, 0);
  assert.equal(TIER_PROFILE.sclerotic.model_call, false);
});

test('ladder: isTier rejects garbage', () => {
  assert.ok(isTier('totipotent'));
  assert.ok(!isTier('pluripotent'));
  assert.ok(!isTier(42));
});

test('ladder: fate flows DOWN only', () => {
  assert.ok(canDistill('totipotent', 'multipotent'));
  assert.ok(canDistill('multipotent', 'sclerotic'));
  assert.ok(canDistill('totipotent', 'sclerotic'), 'decisive jumps down are legal fate decisions');
  assert.ok(!canDistill('differentiated', 'multipotent'), 'upward is wound healing\'s job');
  assert.ok(!canDistill('sclerotic', 'sclerotic'), 'same-tier is not a distillation');
});

// ── myelination math ──────────────────────────────────────────────────────────
test('myelin: no promotion below threshold', () => {
  const v = shouldMyelinate(MYELIN_THRESHOLD_DEFAULT - 1, 0);
  assert.equal(v.promote, false);
  assert.match(v.reason, /still myelinating/);
});

test('myelin: clean fires at threshold promote', () => {
  const v = shouldMyelinate(MYELIN_THRESHOLD_DEFAULT, 0);
  assert.equal(v.promote, true);
  assert.match(v.reason, /myelinated/);
});

test('myelin: the error-ratio guard blocks dirty paths', () => {
  // 25 fires, 5% max ratio -> 1.25 allowed -> 1 error ok, 2 errors blocked
  assert.equal(shouldMyelinate(25, 1).promote, true);
  assert.equal(shouldMyelinate(25, 2).promote, false);
  assert.match(shouldMyelinate(25, 2).reason, /error ratio/);
});

test('myelin: high volume dilutes early errors (ratio, not count)', () => {
  // 100 fires, 2 errors = 2% < 5% -> promotes
  assert.equal(shouldMyelinate(100, 2).promote, true);
  // 10 fires, 1 error = 10% > 5% -> blocked (the cue-tokens trade path)
  assert.equal(shouldMyelinate(10, 1).promote, false);
});

// ── the sclerotic rule table ──────────────────────────────────────────────────
const ACK_RULES = [
  { when: { kind: 'nod' }, respond: { ack: 'ROGER' } },
  { when: { kind: 'cut', payload_equals: { priority: 'break' } }, respond: { ack: 'CUT' } },
  { when: { kind: 'trade' }, respond: { ack: 'WILCO' } },
];

test('rule table: kind match is deterministic and free', () => {
  for (let i = 0; i < 3; i++) {
    const m = matchRule(ACK_RULES, 'nod', {});
    assert.equal(m.hit, true);
    assert.deepEqual(m.response, { ack: 'ROGER' });
  }
});

test('rule table: payload_equals gates parameterized cues', () => {
  assert.equal(matchRule(ACK_RULES, 'cut', { priority: 'break' }).response!.ack, 'CUT');
  assert.equal(matchRule(ACK_RULES, 'cut', { priority: 'normal' }).hit, false, 'no payload match, no later kind match');
});

test('rule table: first match wins', () => {
  const rules = [
    { when: { kind: 'x', payload_equals: { a: 1 } }, respond: { first: true } },
    { when: { kind: 'x' }, respond: { first: false } },
  ];
  assert.deepEqual(matchRule(rules, 'x', { a: 1 }).response, { first: true });
  assert.deepEqual(matchRule(rules, 'x', {}).response, { first: false });
});

test('rule table: unknown cue is a miss (scar tissue)', () => {
  const m = matchRule(ACK_RULES, 'never-seen-cue', {});
  assert.equal(m.hit, false);
});

// ── lineage & wound healing ───────────────────────────────────────────────────
test('lineage: walks rootward through created_from', () => {
  const parentOf = new Map<string, string | null>([
    ['a', 'b'], ['b', 'c'], ['c', null],
  ]);
  assert.deepEqual(lineageOf('a', parentOf), ['a', 'b', 'c']);
  assert.deepEqual(lineageOf('c', parentOf), ['c']);
});

test('wound: differentiated tissue recalls nearest totipotent ancestor', () => {
  const cells = new Map([
    ['zygote', cell({ id: 'zygote', tier: 'totipotent' })],
    ['mid', cell({ id: 'mid', tier: 'multipotent', created_from: 'zygote' })],
    ['hand', cell({ id: 'hand', tier: 'differentiated', created_from: 'mid' })],
  ]);
  const plan = healPlan(cells.get('hand')!, cells);
  assert.equal(plan.kind, 'recall');
  if (plan.kind === 'recall') {
    assert.equal(plan.ancestor.id, 'zygote');
    assert.equal(plan.dedifferentiated, false, 'zygote still totipotent — no dedifferentiation needed');
  }
});

test('wound: dead lineage root triggers dedifferentiation recall', () => {
  const cells = new Map([
    ['root', cell({ id: 'root', tier: 'differentiated', created_from: null })],
    ['tissue', cell({ id: 'tissue', tier: 'sclerotic', created_from: 'root' })],
  ]);
  const plan = healPlan(cells.get('tissue')!, cells);
  assert.equal(plan.kind, 'recall');
  if (plan.kind === 'recall') {
    assert.equal(plan.ancestor.id, 'root');
    assert.equal(plan.dedifferentiated, true, 'root recalled to stemness');
  }
});

test('wound: totipotent tissue self-heals', () => {
  const z = cell({ id: 'zygote', tier: 'totipotent' });
  assert.equal(healPlan(z, new Map([[z.id, z]])).kind, 'self-heal');
});

test('wound: retired cells cannot be wounded again', () => {
  const r = cell({ id: 'scar', tier: 'sclerotic', status: 'retired' });
  assert.equal(healPlan(r, new Map([[r.id, r]])).kind, 'hopeless');
});

// ── organism health ───────────────────────────────────────────────────────────
function healthFixture() {
  const cells: CellRow[] = [
    cell({ id: 'zygote', tier: 'totipotent', cost_per_call: 1.0 }),
    cell({ id: 'clock', tier: 'sclerotic', cost_per_call: 0, created_from: 'zygote' }),
    cell({ id: 'critic', tier: 'differentiated', cost_per_call: 0.15, created_from: 'zygote' }),
    cell({ id: 'dead', tier: 'differentiated', status: 'retired', created_from: 'zygote' }),
  ];
  const myelin: MyelinRow[] = [
    { path_id: 'zygote->clock::tick', from_cell: 'zygote', to_cell: 'clock', kind: 'tick', fire_count: 269, error_count: 0, tier_promoted_to: 'sclerotic', last_fired: 1 },
    { path_id: 'zygote->critic::ask', from_cell: 'zygote', to_cell: 'critic', kind: 'ask', fire_count: 20, error_count: 0, tier_promoted_to: null, last_fired: 1 },
    { path_id: 'zygote->clock::novel', from_cell: 'zygote', to_cell: 'clock', kind: 'novel', fire_count: 3, error_count: 2, tier_promoted_to: null, last_fired: 1 },
  ];
  const signals: SignalRow[] = [
    { id: 1, from_cell: 'zygote', to_cell: 'clock', kind: 'tick', payload: null, ok: 1, mode: 'table', model_log: null, escalated_from: null, at: 1 },
    { id: 2, from_cell: 'zygote', to_cell: 'clock', kind: 'tick', payload: null, ok: 1, mode: 'table', model_log: null, escalated_from: null, at: 2 },
    { id: 3, from_cell: 'zygote', to_cell: 'zygote', kind: 'plan', payload: null, ok: 1, mode: 'model', model_log: null, escalated_from: null, at: 3 },
    { id: 4, from_cell: 'zygote', to_cell: 'clock', kind: 'novel', payload: null, ok: 0, mode: 'table-miss', model_log: null, escalated_from: null, at: 4 },
  ];
  return { cells, myelin, signals };
}

test('health: tier balance counts active cells only', () => {
  const { cells, myelin, signals } = healthFixture();
  const h = healthSnapshot('org', cells, myelin, signals);
  assert.equal(h.cells_total, 4);
  assert.equal(h.cells_active, 3);
  assert.equal(h.tier_counts.totipotent, 1);
  assert.equal(h.tier_counts.sclerotic, 1);
  assert.equal(h.tier_pct.sclerotic, 33.3);
});

test('health: load split — expensive lane vs zero-cost tissue', () => {
  const { cells, myelin, signals } = healthFixture();
  const h = healthSnapshot('org', cells, myelin, signals);
  assert.equal(h.totipotent_load_pct, 25, '1 of 4 signals hit the full-model cell');
  assert.equal(h.zero_cost_serve_pct, 75, '3 of 4 signals served with no model call');
});

test('health: warnings — approaching threshold, scar tissue, germline load', () => {
  const { cells, myelin, signals } = healthFixture();
  const h = healthSnapshot('org', cells, myelin, signals, 25);
  const notes = h.sclerosis_warnings.map(w => `${w.cell_id}: ${w.note}`).join('\n');
  assert.match(notes, /critic.*approaching threshold \(20\/25 fires, 0 errors\)/, 'critic at 20/25 clean fires is approaching promotion');
  assert.match(notes, /clock.*scar tissue.*2 rule-table miss/, 'sclerotic cell with errors is scar tissue');
  assert.ok(!/zygote.*germ line carrying routine load/.test(notes), 'zygote only saw 1 inbound — no warning');
});

test('health: hot paths rank by fire count', () => {
  const { cells, myelin, signals } = healthFixture();
  const h = healthSnapshot('org', cells, myelin, signals);
  assert.equal(h.hot_paths[0].path_id, 'zygote->clock::tick');
  assert.equal(h.hot_paths[0].fire_count, 269);
});

// ── v0.2: COST TUMOR WATCH (the cancer metric) ───────────────────────────────
test('health: serve-mode breakdown — model vs deterministic vs escalated', () => {
  const { cells, myelin } = healthFixture();
  const signals: SignalRow[] = [
    { id: 1, from_cell: 'clock', to_cell: 'clock', kind: 'tick', payload: null, ok: 1, mode: 'table', model_log: null, escalated_from: null, at: 1 },
    { id: 2, from_cell: 'clock', to_cell: 'clock', kind: 'tick', payload: null, ok: 1, mode: 'table', model_log: null, escalated_from: null, at: 2 },
    { id: 3, from_cell: 'clock', to_cell: 'clock', kind: 'tick', payload: null, ok: 1, mode: 'table', model_log: null, escalated_from: null, at: 3 },
    { id: 4, from_cell: 'clock', to_cell: 'zygote', kind: 'plan', payload: null, ok: 1, mode: 'model', model_log: null, escalated_from: null, at: 4 },
    { id: 5, from_cell: 'zygote', to_cell: 'critic', kind: 'ask', payload: null, ok: 1, mode: 'escalated', model_log: null, escalated_from: 'critic', at: 5 },
    { id: 6, from_cell: 'clock', to_cell: 'clock', kind: 'novel', payload: null, ok: 0, mode: 'table-miss', model_log: null, escalated_from: null, at: 6 },
  ];
  const h = healthSnapshot('org', cells, myelin, signals);
  assert.equal(h.serve_modes_pct.table, 50);        // 3 of 6
  assert.equal(h.serve_modes_pct.model, 16.7);      // 1 of 6
  assert.equal(h.serve_modes_pct.escalated, 16.7);  // 1 of 6
  assert.equal(h.serve_modes_pct.error, 16.7);      // 1 of 6 (table-miss)
  assert.equal(h.serve_modes_pct.model_required, 0);
  // germ-line serving = model calls to totipotent targets + escalations = 2/6 = 33.3%
  assert.equal(h.totipotent_serve_pct, 33.3);
  assert.equal(h.cost_tumor.warning, true, '33.3% > 5% — the tumor is flagged');
  assert.match(h.cost_tumor.note, /COST TUMOR/);
  assert.equal(h.cost_tumor.window, 6);
});

test('health: a healthy organism stays under the tumor threshold', () => {
  const { cells, myelin } = healthFixture();
  const signals: SignalRow[] = [
    { id: 1, from_cell: 'clock', to_cell: 'clock', kind: 'tick', payload: null, ok: 1, mode: 'table', model_log: null, escalated_from: null, at: 1 },
    { id: 2, from_cell: 'clock', to_cell: 'clock', kind: 'tick', payload: null, ok: 1, mode: 'table', model_log: null, escalated_from: null, at: 2 },
    { id: 3, from_cell: 'clock', to_cell: 'critic', kind: 'ask', payload: null, ok: 1, mode: 'model', model_log: null, escalated_from: null, at: 3 },
    { id: 4, from_cell: 'clock', to_cell: 'clock', kind: 'tick', payload: null, ok: 1, mode: 'table', model_log: null, escalated_from: null, at: 4 },
    { id: 5, from_cell: 'clock', to_cell: 'clock', kind: 'tick', payload: null, ok: 1, mode: 'table', model_log: null, escalated_from: null, at: 5 },
    { id: 6, from_cell: 'clock', to_cell: 'clock', kind: 'tick', payload: null, ok: 1, mode: 'table', model_log: null, escalated_from: null, at: 6 },
    { id: 7, from_cell: 'clock', to_cell: 'clock', kind: 'tick', payload: null, ok: 1, mode: 'table', model_log: null, escalated_from: null, at: 7 },
    { id: 8, from_cell: 'clock', to_cell: 'clock', kind: 'tick', payload: null, ok: 1, mode: 'table', model_log: null, escalated_from: null, at: 8 },
  ];
  const h = healthSnapshot('org', cells, myelin, signals);
  // one model call, but to the DIFFERENTIATED critic — not germ-line serving
  assert.equal(h.totipotent_serve_pct, 0);
  assert.equal(h.cost_tumor.warning, false);
  assert.match(h.cost_tumor.note, /healthy/);
});

test('health: legacy v0.1 signals (no mode) are inferred, not crashed on', () => {
  const { cells, myelin, signals } = healthFixture();
  const legacy = signals.map(({ mode, model_log, escalated_from, ...rest }) => rest) as SignalRow[];
  const h = healthSnapshot('org', cells, myelin, legacy);
  assert.equal(h.serve_modes_pct.table, 50);        // 2 ok-signals to sclerotic clock of 4
  assert.equal(h.serve_modes_pct.error, 25);        // ok=0 -> table-miss -> error
  assert.equal(h.totipotent_serve_pct, 0, 'legacy defer to zygote is model_required, not germ-serving');
});

// ── the doctrine, stated as an invariant ──────────────────────────────────────
test('doctrine: sclerotic is the only tier that answers without the model', () => {
  for (const t of TIERS) {
    const prof = TIER_PROFILE[t];
    if (t === 'sclerotic') {
      assert.equal(prof.model_call, false);
      assert.equal(prof.cost_per_call, 0);
    } else {
      assert.equal(prof.model_call, true);
      assert.ok(prof.cost_per_call > 0);
    }
  }
});
