// cell-cascade — tests: the mined fleet-instinct organism loads, validates,
// and carries the mining report's REAL numbers. The report is provenance law:
// if these counts drift from plainsong-mcp/docs/reflex-mining-report.md, the
// build says so. The honesty-gate's own provenance is pinned hardest — that
// cell must never hallucinate its evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseExampleFile, type Example } from '../src/example';
import { matchRule, type Rule } from '../src/cascade';
import { canDistill } from '../src/tiers';

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(here, '..', 'examples', 'fleet-instinct-seed.json'), 'utf8');

const { examples, errors } = parseExampleFile(text);
const ex = examples[0] as Example | undefined;

test('fleet-instinct: parses and validates whole', () => {
  assert.deepEqual(errors, []);
  assert.equal(examples.length, 1);
  assert.equal(ex!.id, 'fleet-instinct');
  assert.equal(ex!.seed.organism, 'fleet-instinct');
  assert.equal(ex!.seed.cells.length, 7, 'zygote + six reflex cells');
});

test('fleet-instinct: exactly one zygote; every cell cites its evidence', () => {
  const cells = ex!.seed.cells;
  assert.equal(cells.filter(c => c.from === undefined).length, 1);
  assert.equal(cells.find(c => c.from === undefined)!.id, 'fleet-germ');
  // provenance is law: every sheet carries a mined block with observed_count + sources/report_ref
  for (const c of cells) {
    const mined = (c.sheet as Record<string, any>).mined;
    assert.ok(mined, `${c.id}: sheet.mined required — no provenance, no cell`);
    assert.equal(typeof mined.observed_count, 'number', `${c.id}: observed_count required`);
    assert.ok(Array.isArray(mined.sources) && mined.sources.length > 0, `${c.id}: sources[] required`);
    assert.match(mined.report_ref ?? '', /reflex-mining-report\.md/, `${c.id}: report_ref required`);
  }
});

test('fleet-instinct: every distillation is a legal downward fate decision with provenance', () => {
  assert.equal(ex!.seed.distillations!.length, 6, 'one per reflex cell');
  for (const d of ex!.seed.distillations!) {
    assert.ok(canDistill(d.from_tier, d.to_tier), `${d.cell}: ${d.from_tier}->${d.to_tier} must flow DOWN`);
    assert.match(d.evidence_ref, /reflex-mining-report\.md/, `${d.cell}: evidence must point at the mining report`);
    assert.ok(d.gardener_verdict.length > 20, `${d.cell}: verdict must say why, on what evidence`);
  }
});

test('fleet-instinct: myelin counters carry the real observed counts from the report', () => {
  const m = ex!.seed.myelin!;
  const count = (from: string, to: string, kind: string) =>
    m.find(x => x.from === from && x.to === to && x.kind === kind);
  // the report's own numbers — no inflation, no rounding up to thresholds
  assert.equal(count('fleet-germ', 'sacred-space', 'declare-space')!.fire_count, 6);        // #1: 6 decisions
  assert.equal(count('fleet-germ', 'honesty-gate', 'capability-claim')!.fire_count, 8);     // #2: 8 instances
  assert.equal(count('fleet-germ', 'room-entry', 'join')!.fire_count, 4);                   // #3: 4 entries
  assert.equal(count('fleet-germ', 'room-entry', 'counter-offer')!.fire_count, 1);          // #3: +1 refusal = 5
  assert.equal(count('fleet-germ', 'critique-budget', 'critique')!.fire_count, 16);         // #4: 10+3+3 (report: 15+)
  assert.equal(count('fleet-germ', 'verify-from-outside', 'green-tick-claim')!.fire_count, 6); // #5: 6 instances
  for (const row of m) {
    assert.equal(row.error_count, 0, `${row.kind}: every occurrence in the corpus was clean`);
    // honesty about promotion: nothing here crossed the 25-fire auto-threshold,
    // so nothing claims tier_promoted_to — sclerotic fates were gardener decisions
    assert.equal(row.tier_promoted_to ?? null, null, `${row.kind}: no unearned promotion flag`);
  }
});

// ── the cells, pinned to their mined laws ─────────────────────────────────────

test('sacred-space: sclerotic cue-reflex — declare-space → confirm-honor', () => {
  const cell = ex!.seed.cells.find(c => c.id === 'sacred-space')!;
  assert.equal(cell.tier, 'sclerotic');
  assert.equal(cell.cost_per_call, 0);
  const rules = cell.sheet.rules as Rule[];
  const declare = matchRule(rules, 'declare-space', { bar: 9 });
  assert.equal(declare.hit, true);
  assert.equal(declare.response!.ack, 'HONORED');
  assert.equal(declare.response!.confirm_honor, true);
  const enter = matchRule(rules, 'enter-space', { bar: 9 });
  assert.equal(enter.response!.ack, 'ASK-FIRST', 'entering is a question, not an assumption');
  const mined = cell.sheet.mined as Record<string, any>;
  assert.equal(mined.observed_count, 6);
  assert.equal(mined.violations, 0);
  assert.equal(mined.agents, 4);
});

test('honesty-gate: differentiated check; its own provenance cannot drift', () => {
  const cell = ex!.seed.cells.find(c => c.id === 'honesty-gate')!;
  assert.equal(cell.tier, 'differentiated', 'mechanical check + escalation for misses');
  const rules = cell.sheet.rules as Rule[];
  const claim = matchRule(rules, 'capability-claim', {});
  assert.equal(claim.response!.verdict, 'CHECK');
  assert.equal(claim.response!.on_fail, 'DECLARE-GAP — write the gap into the artifact itself, never simulate past it');
  const gap = matchRule(rules, 'declare-gap', {});
  assert.equal(gap.response!.verdict, 'HONORED');
  // THE PIN: the cell's count is the report's own count, labeled as such
  const mined = cell.sheet.mined as Record<string, any>;
  assert.equal(mined.observed_count, 8);
  assert.equal(mined.contexts, 5);
  assert.match(mined.count_provenance, /THE MINING REPORT'S OWN COUNT/);
  assert.equal(mined.evidence_bullets.length, 5, 'the five evidence bullets from the report, not a re-count');
  for (const b of mined.evidence_bullets as string[]) {
    assert.ok(b.length > 30, 'bullets carry substance, not titles');
  }
  // the three v0.2 honest answers are named together, as in the report
  const v02 = (mined.evidence_bullets as string[]).find(b => b.includes('v0.2'));
  assert.ok(v02 && v02.includes('model-call-required') && v02.includes('cost_estimate_usd'), 'v0.2 bullet intact');
});

test('room-entry: the floor law with the strictly-descending chain', () => {
  const cell = ex!.seed.cells.find(c => c.id === 'room-entry')!;
  assert.equal(cell.tier, 'differentiated');
  const rules = cell.sheet.rules as Rule[];
  const join = matchRule(rules, 'join', {});
  assert.equal(join.response!.ack, 'UNDER-THE-FLOOR');
  assert.match(String(join.response!.floor_evidence), /66 → 46 → 52/);
  const lab = matchRule(rules, 'lab-reading-offered', {});
  assert.equal(lab.response!.ack, 'DECLINED', 'the room outranks the lab');
  const counter = matchRule(rules, 'counter-offer', {});
  assert.equal(counter.response!.ack, 'DECLINED');
  assert.equal((cell.sheet.mined as Record<string, any>).observed_count, 5, '4 entries + 1 refusal — the count from the report');
});

test('critique-budget: sclerotic counter — scoped budgets resolve before the default', () => {
  const cell = ex!.seed.cells.find(c => c.id === 'critique-budget')!;
  assert.equal(cell.tier, 'sclerotic');
  assert.equal(cell.cost_per_call, 0);
  const rules = cell.sheet.rules as Rule[];
  assert.equal(matchRule(rules, 'critique', { scope: 'growth-loop' }).response!.points, 1);
  assert.equal(matchRule(rules, 'critique', { scope: 'gan-round' }).response!.points, 3);
  const spec = matchRule(rules, 'critique', { scope: 'spec-review' }).response!;
  assert.equal(spec.points_max, 5);
  assert.deepEqual(spec.tags, ['NEW', 'REFINED']);
  // first-match-wins: the scoped rules MUST be ordered before the bare default
  const kinds = rules.map(r => r.when.kind);
  assert.deepEqual(kinds, ['critique', 'critique', 'critique', 'critique'], 'all four keyed on critique');
  const defaultIdx = rules.findIndex(r => r.when.payload_equals === undefined);
  assert.ok(rules.slice(0, defaultIdx).every(r => r.when.payload_equals !== undefined),
    'scoped rules before the unscoped default, or the default swallows everything');
  assert.equal(matchRule(rules, 'critique', {}).response!.points, 1, 'default: one ask per iteration');
});

test('verify-from-outside: the green-tick trap reflex flags, never trusts', () => {
  const cell = ex!.seed.cells.find(c => c.id === 'verify-from-outside')!;
  assert.equal(cell.tier, 'differentiated', 'the flag is a table; outside-enough is judgment (escalates)');
  const rules = cell.sheet.rules as Rule[];
  const green = matchRule(rules, 'green-tick-claim', {});
  assert.equal(green.response!.verdict, 'FLAGGED');
  assert.equal(green.response!.verify, 'against-source');
  assert.ok((green.response!.outside_sources as string[]).length >= 3,
    'PyPI itself, blind critic, clean install, production soak');
  const ship = matchRule(rules, 'ship-claim', {});
  assert.equal(ship.response!.verify, 'external-artifact-required');
  assert.equal((cell.sheet.mined as Record<string, any>).observed_count, 6);
});

test('ensign-watchlist: all 8 failure signatures from the report, each with watch rule + evidence', () => {
  const cell = ex!.seed.cells.find(c => c.id === 'ensign-watchlist')!;
  assert.equal(cell.tier, 'differentiated', 'seeded OPEN so new signatures escalate into candidates, not scar tissue');
  const rules = cell.sheet.rules as Rule[];
  const signatures = ['spec-lie', 'green-tick-trap', 'tag-commit-drift', 'obligations-void',
    'env-rot', 'blind-steering', 'undeployed-work', 'grinding-past-returns'];
  assert.deepEqual(rules.map(r => r.when.kind), signatures, 'the Part 4 table, all 8 rows');
  for (const r of rules) {
    assert.equal(r.respond!.ack, 'WATCH');
    assert.ok(typeof r.respond!.watch_rule === 'string' && (r.respond!.watch_rule as string).length > 20,
      `${r.when.kind}: a watch rule is a rule, not a quote`);
    assert.ok(typeof r.respond!.evidence === 'string' && r.respond!.evidence.length > 10,
      `${r.when.kind}: instances cited`);
  }
  // green-tick-trap delegates to its specialist cell
  assert.equal(matchRule(rules, 'green-tick-trap', {}).response!.delegates_to, 'fleet-instinct:verify-from-outside');
  // the honest gap is IN the sheet: which rows can only flag, and which reflexes did not fit
  const boundary = cell.sheet.enforcement_boundary as Record<string, any>;
  assert.match(boundary.honest_gap, /obligations ledger/);
  assert.match(boundary.ledger_note, /build-the-tool-dont-argue|perception-before-steering|env-canary/);
  assert.ok(['tag-commit-drift', 'obligations-void', 'env-rot', 'blind-steering', 'undeployed-work']
    .every(sig => (rules.find(r => r.when.kind === sig)!.respond!.enforcement as string).includes('flag only')
      || (rules.find(r => r.when.kind === sig)!.respond!.enforcement as string).includes('flag-only')),
    'the five external-state rows say so out loud');
});

test('fleet-germ: the zygote wears the fleet DNA and can answer escalations', () => {
  const germ = ex!.seed.cells.find(c => c.id === 'fleet-germ')!;
  assert.equal(germ.tier, 'totipotent');
  const model = (germ.sheet as Record<string, any>).model;
  assert.ok(model, 'sheet.model config — the escalation path needs a thinking zygote');
  assert.ok((model.max_tokens as number) >= 2048,
    'reasoning models think before they write — a tight token budget yields an empty escalation answer (learned live, signal 78)');
  assert.ok(typeof model.temperature === 'number' && model.temperature <= 0.6,
    'rule-shaped answers, not creative ones');
  assert.match(model.system_prompt, /distillation candidate/, 'it knows its answers grow the tables');
  assert.match(model.system_prompt, /nothing named-then-buried/, 'the converged protocol from the seminar, carried');
  assert.match(model.system_prompt, /scope/i, 'answers IN THE SCOPE OF THE CHILD');
  // the count on the zygote is honest arithmetic on the report, spelled out
  const mined = germ.sheet.mined as Record<string, any>;
  assert.equal(mined.observed_count, 49, '6+8+5+16+6 instances + 8 signature rows');
  assert.match(mined.observed_count_note, /arithmetic/);
});
