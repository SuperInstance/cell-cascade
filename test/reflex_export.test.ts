// cell-cascade — test/reflex_export.test.ts
// The mint-to-metal export contract: the .qm artifact carries the standing
// bands as EXACT micro-unit integers, the sha256 receipt of the very bytes
// it was minted from, and the frozen semantics the metal side compiles.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportGateQm, toMicro, PENALTY_WARN_U, PENALTY_BAD_U, DISSENT_EPSILON_U } from '../scripts/export_gate_qm';
import { referenceIntent, referenceLine } from '../scripts/reflex_reference';
import { CRITIC_FEATURES, AMBIGUITY_BAND } from '../src/critic';

const GATE = 'gate/gate-bands.json';

describe('toMicro (the fixed-point choice)', () => {
  it('is exact for every decimal the gate ever sees', () => {
    assert.equal(toMicro(0.15), 150000);
    assert.equal(toMicro(0.763), 763000);   // the mint's moved edge
    assert.equal(toMicro(0.06), 60000);
    assert.equal(toMicro(0), 0);
    assert.equal(toMicro(1), 1000000);
    assert.equal(toMicro(0.143), 143000);   // a logged evidence reading
    assert.equal(toMicro(0.703), 703000);
  });
  it('refuses values that would lose information off the 1e-6 grid', () => {
    assert.throws(() => toMicro(0.1234567));   // 7th decimal would be silently lost
    assert.equal(toMicro(0.333333), 333333);  // 6dp values always land exact
  });
});

describe('exportGateQm (blink-style .qm from gate-bands.json)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gateqm-'));
  const out = join(tmp, 'critic-gate.qm');

  it('bakes the standing bands in µ, in critic channel order', () => {
    const r = exportGateQm({ gatePath: GATE, out });
    const qm = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(qm.format, 'qm');
    assert.equal(qm.version, 1);
    assert.equal(qm.organism, 'critic-gate');
    assert.equal(qm.routes.critique, 'critic-gate');
    const facts = qm.ops.find((o: any) => o.op === 'bind' && o.target === 'critic-gate:facts').value;
    assert.deepEqual(facts.channel_order, [...CRITIC_FEATURES]);
    assert.equal(facts.channels.length, 6);
    for (const c of facts.channels) {
      assert.ok(CRITIC_FEATURES.includes(c.name));
      assert.ok(Number.isInteger(c.lo) && Number.isInteger(c.hi));
      assert.ok(c.lo <= c.hi);
    }
    // the harmonic_tension high edge is the mint's 0.763 — exact on the µ grid
    const ht = facts.channels.find((c: any) => c.name === 'harmonic_tension');
    assert.equal(ht.hi, 763000);
    assert.equal(facts.fixed_point.ambiguity_band, Math.round(AMBIGUITY_BAND * 1e6));
    assert.equal(facts.fixed_point.penalty.warn, PENALTY_WARN_U);
    assert.equal(facts.fixed_point.penalty.bad, PENALTY_BAD_U);
    assert.equal(facts.fixed_point.dissent_epsilon, DISSENT_EPSILON_U);
    // return value agrees with the artifact
    assert.equal(r.channels.find(c => c.name === 'harmonic_tension')!.hi, 763000);
  });

  it('carries the sha256 receipt of the exact gate-bands.json bytes', () => {
    const r = exportGateQm({ gatePath: GATE, out: join(tmp, 'again.qm') });
    const sha = createHash('sha256').update(readFileSync(GATE)).digest('hex');
    assert.equal(r.sha256, sha);
    const qm = JSON.parse(readFileSync(join(tmp, 'again.qm'), 'utf8'));
    const facts = qm.ops.find((o: any) => o.op === 'bind' && o.target === 'critic-gate:facts').value;
    assert.equal(facts.source_sha256, sha);
    // and a DIFFERENT gate file yields a different receipt — no stale provenance
    const alt = join(tmp, 'alt-bands.json');
    writeFileSync(alt, JSON.stringify({ version: 4, bands: JSON.parse(readFileSync(GATE, 'utf8')).bands, history: [] }));
    const r2 = exportGateQm({ gatePath: alt, out: join(tmp, 'alt.qm') });
    const sha2 = createHash('sha256').update(readFileSync(alt)).digest('hex');
    assert.notEqual(r2.sha256, sha);
    assert.equal(r2.sha256, sha2);
  });
});

describe('desktop reference (the comparison oracle)', () => {
  const intent = referenceIntent(GATE);

  it('judges a clean bar ok/accept', () => {
    const r = referenceLine({ id: 0, bar: 'x', features: {
      note_density: 340000, syncopation: 500000, register_spread: 120000,
      rest_ratio: 50000, harmonic_tension: 600000, interval_size: 400000,
    } }, intent);
    assert.equal(r.verdict, 'accept');
    assert.equal(Object.values(r.sev as any).every(s => s === 'ok'), true);
    assert.equal(r.pen_u, 0);
  });

  it('marks a gray-zone reading warn and a clear violation bad', () => {
    // syncopation 0.19 vs band [0.2, 1.0]: 0.01 under lo, inside gray (≤0.06)
    // note_density 0.01 vs [0.15, 0.6]: 0.14 under lo — far past the gray zone
    const r = referenceLine({ id: 1, bar: 'x', features: {
      note_density: 10000, syncopation: 190000, register_spread: 120000,
      rest_ratio: 50000, harmonic_tension: 600000, interval_size: 400000,
    } }, intent);
    const sev = r.sev as Record<string, string>;
    assert.equal(sev.syncopation, 'warn');
    assert.equal((r.gray as Record<string, boolean>).syncopation, true);
    assert.equal(sev.note_density, 'bad');
    assert.equal(r.pen_u, PENALTY_WARN_U + PENALTY_BAD_U);
    assert.equal(r.verdict, 'revise');
  });

  it('treats the band edges as inclusive (lo == ok)', () => {
    const r2 = referenceLine({ id: 2, bar: 'x', features: {
      note_density: 150000, syncopation: 200000, register_spread: 50000,
      rest_ratio: 0, harmonic_tension: 150000, interval_size: 0,
    } }, intent);
    assert.equal(Object.values(r2.sev as Record<string, string>).every(s => s === 'ok'), true);
    assert.equal(r2.verdict, 'accept');
  });
});
