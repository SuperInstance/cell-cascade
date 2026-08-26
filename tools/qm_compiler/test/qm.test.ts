// qm-compiler — test/qm.test.ts
// Round-trip equivalence: for identical signal inputs, cell-cascade's own
// rule-table logic (cascade.ts matchRule — the same function POST /signal
// uses for sclerotic serving) and the compiled .qm program executed on the
// REAL quilt-vm-rust (qm-runner binary) must produce identical responses.
// Plus compiler unit tests (dangling links, first-match order, canon JSON).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { compileOrganism, canonJson, refServe, cellFacts, type QmProgram } from '../src/compile';
import { matchRule, type Rule } from '../../../src/cascade';

const ROOT = join(__dirname, '../../..');
const RUNNER = join(__dirname, '../qm-runner/target/release/qm-runner');
const EX = join(ROOT, 'tools/qm_compiler/examples');
const FX = join(__dirname, 'fixtures');
const seeds = JSON.parse(readFileSync(join(ROOT, 'examples/seed.json'), 'utf8'));

function runOnVM(example: string) {
  return JSON.parse(
    execFileSync(RUNNER, [join(EX, `${example}.qm`), join(FX, `${example}.signals.json`)], {
      encoding: 'utf8',
    }),
  );
}

/** cell-cascade ground truth for a sclerotic-style serve: matchRule over the
 *  target cell's sheet rules, first match wins — the exact table path used
 *  by the /signal pipeline for tier=sclerotic. */
function cascadeServe(exampleId: string, kind: string, payload: Record<string, unknown>, to: string) {
  const ex = seeds.find((s: any) => s.id === exampleId);
  const cell = ex.seed.cells.find((c: any) => c.id === to);
  const rules: Rule[] = cell?.sheet?.rules ?? [];
  const m = matchRule(rules, kind, payload);
  return m.hit ? { mode: 'table', response: m.response } : { mode: 'table-miss', response: null };
}

// ── compiler units ──────────────────────────────────────────────────────────

test('dangling signal link to nonexistent cell is a link-time error', () => {
  const { errors } = compileOrganism({
    organism: 'x',
    cells: [{ id: 'a', name: 'a', tier: 'sclerotic' }],
    myelin: [{ from: 'a', to: 'ghost', kind: 'nod' }],
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'DANGLING_LINK');
  assert.match(errors[0].detail, /ghost/);
});

test('dangling lineage link is also caught', () => {
  const { errors } = compileOrganism({
    organism: 'x',
    cells: [{ id: 'a', name: 'a', tier: 'sclerotic', from: 'nope' }],
  });
  assert.ok(errors.some((e) => e.code === 'DANGLING_LINK' && e.detail.includes('nope')));
});

test('rules compile to guarded effects in sheet order (first match wins)', () => {
  const { program } = compileOrganism({
    organism: 'x',
    cells: [{
      id: 'c', name: 'c', tier: 'sclerotic',
      sheet: { rules: [
        { when: { kind: 'cut', payload_equals: { priority: 'break' } }, respond: { ack: 'BREAK' } },
        { when: { kind: 'cut' }, respond: { ack: 'SOFT' } },
      ] },
    }],
  });
  const fx = program.ops.filter((o) => o.op === 'effect') as any[];
  assert.equal(fx.length, 2);
  assert.equal(fx[0].guard.payload_equals.priority, 'break');
  const r1 = refServe(program, { from: 'x', to: 'c', kind: 'cut', payload: { priority: 'break' } });
  const r2 = refServe(program, { from: 'x', to: 'c', kind: 'cut', payload: { priority: 'routine' } });
  assert.equal((r1!.response as any).ack, 'BREAK');
  assert.equal((r2!.response as any).ack, 'SOFT');
});

test('canonJson is key-order independent (TS/Rust subset-match parity)', () => {
  assert.equal(canonJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

test('golden residue stays in the sheet: facts exclude rules, keep tendencies', () => {
  const duke = seeds.find((s: any) => s.id === 'unheard-duke').seed.cells
    .find((c: any) => c.id === 'duke-pianist');
  const facts = cellFacts(duke);
  assert.equal(facts.rule_count, 0);
  const residue = facts.sheet_residue as any;
  assert.equal(residue.surviving_tendencies.length, 5);
  assert.match(residue.surviving_tendencies[0], /rows under every bar/);
});

// ── round-trip equivalence on the real VM ──────────────────────────────────

for (const example of ['band-clock', 'cue-tokens']) {
  test(`round-trip ${example}: qm-runner on quilt-vm-rust ≡ cell-cascade matchRule`, () => {
    const out = runOnVM(example);
    const signals = JSON.parse(readFileSync(join(FX, `${example}.signals.json`), 'utf8'));
    assert.equal(out.results.length, signals.length);
    for (let i = 0; i < signals.length; i++) {
      const truth = cascadeServe(example, signals[i].kind, signals[i].payload, signals[i].to);
      assert.equal(out.results[i].mode, truth.mode,
        `${example} signal ${i} (${signals[i].kind}): mode diverged`);
      assert.deepEqual(out.results[i].response, truth.response,
        `${example} signal ${i} (${signals[i].kind}): response diverged`);
    }
  });
}

test('round-trip cue-tokens: reference interpreter also agrees with both', () => {
  const program: QmProgram = JSON.parse(readFileSync(join(EX, 'cue-tokens.qm'), 'utf8'));
  const signals = JSON.parse(readFileSync(join(FX, 'cue-tokens.signals.json'), 'utf8'));
  for (const s of signals) {
    const r = refServe(program, s);
    const truth = cascadeServe('cue-tokens', s.kind, s.payload, s.to);
    assert.equal(r!.mode, truth.mode, `${s.kind}: ref mode diverged`);
    assert.deepEqual(r!.response, truth.response, `${s.kind}: ref response diverged`);
  }
});

test('round-trip seamstress-eye: gate math on the VM matches closed form', () => {
  const out = runOnVM('seamstress-eye');
  const [d0, d6, dsqrt6] = out.results.map((r: any) => r.response.sigma_distance);
  assert.equal(d0, 0);               // features == centroid -> 0 sigma
  assert.equal(d6, 6);               // +6 sigma on one axis -> 6 sigma
  assert.ok(Math.abs(dsqrt6 - Math.sqrt(6)) < 1e-12); // +1 sigma on all six -> sqrt(6)
});

test('round-trip unheard-duke: deterministic tendencies round-trip as facts', () => {
  const out = runOnVM('unheard-duke');
  // no rules on the sheet: the bridge serves an honest miss, and the five
  // deterministic tendencies are projected whole through the facts VIEW.
  assert.equal(out.results[0].mode, 'table-miss');
  const facts = out.views['duke-pianist/facts'];
  assert.equal(facts.sheet_residue.surviving_tendencies.length, 5);
  const sheet = seeds.find((s: any) => s.id === 'unheard-duke').seed.cells
    .find((c: any) => c.id === 'duke-pianist').sheet;
  assert.deepEqual(facts.sheet_residue.surviving_tendencies, sheet.surviving_tendencies);
  assert.deepEqual(facts.sheet_residue.r3_verdict, sheet.r3_verdict);
});

test('escalation seam is declarative: differentiated cell links to nearest totipotent ancestor', () => {
  const { program, errors } = compileOrganism({
    organism: 'x',
    cells: [
      { id: 'root', name: 'r', tier: 'totipotent' },
      { id: 'mid', name: 'm', tier: 'multipotent', from: 'root' },
      { id: 'leaf', name: 'l', tier: 'differentiated', from: 'mid',
        sheet: { rules: [{ when: { kind: 'q' }, respond: { a: 1 } }] } },
    ],
  });
  assert.equal(errors.length, 0);
  assert.deepEqual(program.escalations, { leaf: 'root' });
  assert.ok(program.ops.some((o) => o.op === 'link' && o.from === 'leaf' && o.to === 'root' && o.type === 'escalate'));
  // and the real seed: duke-pianist (differentiated) escalates to glm5.3
  const duke = compileOrganism(seeds.find((s: any) => s.id === 'unheard-duke').seed);
  assert.deepEqual(duke.program.escalations, { 'duke-pianist': 'glm5.3' });
});
