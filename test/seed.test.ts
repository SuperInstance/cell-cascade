// cell-cascade — tests: the four saved decompositions load, validate, and
// carry real provenance. A saved example that fails here never reaches D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseExampleFile, validateExample, type Example } from '../src/example';
import { matchRule, type Rule } from '../src/cascade';
import { canDistill } from '../src/tiers';

const here = dirname(fileURLToPath(import.meta.url));
const seedText = readFileSync(join(here, '..', 'examples', 'seed.json'), 'utf8');

test('seed file: parses and validates whole', () => {
  const { examples, errors } = parseExampleFile(seedText);
  assert.deepEqual(errors, []);
  assert.equal(examples.length, 4);
  assert.deepEqual(examples.map(e => e.id), ['unheard-duke', 'band-clock', 'cue-tokens', 'seamstress-eye']);
});

test('seed file: every distillation is a legal downward fate decision', () => {
  const { examples } = parseExampleFile(seedText);
  for (const ex of examples) {
    for (const d of ex.seed.distillations ?? []) {
      assert.ok(canDistill(d.from_tier, d.to_tier),
        `${ex.id}: distillation ${d.from_tier}->${d.to_tier} must flow DOWN the ladder`);
    }
  }
});

test('seed file: every myelin endpoint is a real cell; sclerotic targets have rule tables', () => {
  const { examples } = parseExampleFile(seedText);
  for (const ex of examples) {
    const ids = new Set(ex.seed.cells.map(c => c.id));
    for (const m of ex.seed.myelin ?? []) {
      assert.ok(ids.has(m.from) && ids.has(m.to), `${ex.id}: myelin endpoints must be local cells`);
      assert.ok(m.fire_count >= 0);
    }
    for (const c of ex.seed.cells) {
      if (c.tier === 'sclerotic') {
        const rules = c.sheet.rules as Rule[];
        assert.ok(Array.isArray(rules) && rules.length > 0, `${ex.id}:${c.id} sclerotic without rules`);
      }
    }
  }
});

// ── the four examples, as loaded rows ─────────────────────────────────────────
const { examples } = parseExampleFile(seedText);
const byId = new Map<string, Example>(examples.map(e => [e.id, e]));

test('unheard-duke: GAN-rounds differentiation with the R3 verdict in the sheet', () => {
  const ex = byId.get('unheard-duke')!;
  assert.equal(ex.kind, 'gan-rounds');
  const duke = ex.seed.cells.find(c => c.id === 'duke-pianist')!;
  assert.equal(duke.tier, 'differentiated');
  assert.equal(duke.from, 'glm5.3', 'mitosis from the germ line');
  const sheet = duke.sheet as Record<string, any>;
  assert.match(JSON.stringify(sheet.r3_verdict), /0\.200/);       // velocity_std R3
  assert.match(JSON.stringify(sheet.r3_verdict), /CONVERGED: Duke\?/);
  assert.ok((sheet.surviving_tendencies as string[]).length >= 4, 'tendencies survived the critic');
  const d = ex.seed.distillations![0];
  assert.equal(d.from_tier, 'totipotent');
  assert.equal(d.to_tier, 'differentiated');
  assert.match(d.evidence_ref, /duke-lab-r3/);
});

test('band-clock: sclerotic schedule math — 269 fires, 1ms drift, zero model calls', () => {
  const ex = byId.get('band-clock')!;
  assert.equal(ex.kind, 'sclerotic-tissue');
  const clock = ex.seed.cells.find(c => c.id === 'do-alarm')!;
  assert.equal(clock.tier, 'sclerotic');
  assert.equal(clock.cost_per_call, 0);
  const rules = clock.sheet.rules as Rule[];
  const hit = matchRule(rules, 'bar-tick', {});
  assert.equal(hit.hit, true);
  assert.equal(hit.response!.bar_ms, 2500);
  assert.equal(hit.response!.model_call, false);
  const m = ex.seed.myelin![0];
  assert.equal(m.fire_count, 269);      // today's soak, real
  assert.equal(m.error_count, 0);
  assert.equal(m.tier_promoted_to, 'sclerotic');
});

test('cue-tokens: nod promoted clean, trade held by the error-ratio guard', () => {
  const ex = byId.get('cue-tokens')!;
  assert.equal(ex.kind, 'myelinated-reflex');
  const nod = ex.seed.myelin!.find(m => m.kind === 'nod')!;
  const trade = ex.seed.myelin!.find(m => m.kind === 'trade')!;
  assert.equal(nod.fire_count, 34);
  assert.equal(nod.error_count, 0);
  assert.equal(nod.tier_promoted_to, 'sclerotic', '34 clean fires — promoted');
  assert.equal(trade.error_count, 1, 'the founding defect: bar-13/14');
  assert.equal(trade.tier_promoted_to, null, 'error ratio 1/12 > 5% — guard holds it');
  const ack = ex.seed.cells.find(c => c.id === 'cue-ack')!;
  const roger = matchRule(ack.sheet.rules as Rule[], 'nod', {});
  assert.deepEqual(roger.response!.ack, 'ROGER');
  const cut = matchRule(ack.sheet.rules as Rule[], 'cut', { priority: 'break' });
  assert.equal(cut.response!.ack, 'CUT / BREAK-BREAK');
});

test('seamstress-eye: multipotent critic, frozen 6-feature gate', () => {
  const ex = byId.get('seamstress-eye')!;
  assert.equal(ex.kind, 'multipotent-critic');
  const eye = ex.seed.cells.find(c => c.id === 'eye')!;
  assert.equal(eye.tier, 'multipotent');
  assert.equal(eye.from, 'seamstress');
  const features = eye.sheet.six_features as string[];
  assert.equal(features.length, 6);
  assert.deepEqual(features, ['note_density', 'syncopation', 'register_spread', 'rest_ratio', 'harmonic_tension', 'interval_size']);
  const curve = (eye.sheet.gate1_result as { distance_curve_sigma: number[] }).distance_curve_sigma;
  assert.equal(curve.length, 10, 'ten stitches');
  assert.ok(curve[0] > 7 && curve.at(-1)! < 1.7, '7.14σ → 1.69σ');
  const d = ex.seed.distillations![0];
  assert.equal(d.from_tier, 'totipotent');
  assert.equal(d.to_tier, 'multipotent');
});

// ── validator: rejects examples that would corrupt the library ────────────────
test('validator: no zygote, no example', () => {
  const v = validateExample({
    id: 'x', name: 'x', kind: 'x', description: 'x', evidence_ref: 'x',
    seed: { organism: 'x', cells: [{ id: 'a', name: 'a', tier: 'totipotent', role: '', sheet: {}, from: 'a' }] },
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.includes('zygote')));
});

test('validator: sclerotic cells without rule tables are rejected', () => {
  const v = validateExample({
    id: 'x', name: 'x', kind: 'x', description: 'x', evidence_ref: 'x',
    seed: { organism: 'x', cells: [
      { id: 'z', name: 'z', tier: 'totipotent', role: '', sheet: {} },
      { id: 's', name: 's', tier: 'sclerotic', from: 'z', role: '', sheet: { no_rules: true } },
    ] },
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.includes('rule table')));
});

test('validator: provenance is not optional', () => {
  const v = validateExample({
    id: 'x', name: 'x', kind: 'x', description: 'x', evidence_ref: '',
    seed: { organism: 'x', cells: [{ id: 'z', name: 'z', tier: 'totipotent', role: '', sheet: {} }] },
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.includes('evidence_ref')));
});
