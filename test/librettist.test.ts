// cell-cascade — tests: THE LIBRETTIST (v0.4)
// The score-level memory cell: the form, the tension arc, the narrative —
// planned once (sclerotic, cost 0), served into every compose payload, and
// consumed by the critic's tension-curve check. The outline evolves: drift
// off the arc nudges the remaining targets toward the music.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planLibretto, outlineForBar, librettistSheet, nudgeTargets, arcObservations,
  ARC_DRIFT_TOL, TENSION_TARGET_TOL,
} from '../src/librettist';
import { cheapCritique, criticIntent, composeCycle, type TraceBar, type CycleIO } from '../src/critic';
import { composePayload, bandleaderSystemPrompt } from '../src/cortex';
import { matchRule } from '../src/cascade';

// ── the plan ────────────────────────────────────────────────────────────────

test('libretto: 8 bars default to AABA; sections span the piece; arc peaks mid-piece', () => {
  const lib = planLibretto({ bars: 8 });
  assert.equal(lib.form, 'AABA');
  assert.equal(lib.sections.length, 4);
  assert.equal(lib.sections.reduce((a, s) => a + s.bars, 0), 8);
  assert.equal(lib.tension_targets.length, 8);
  const max = Math.max(...lib.tension_targets);
  const peak = lib.tension_targets.indexOf(max);
  assert.ok(peak >= 2 && peak <= 5, `peak mid-piece, got bar ${peak}`);
  assert.ok(max > lib.tension_targets[0], 'the arc rises');
  assert.ok(max > lib.tension_targets[7], 'the arc releases at the end');
  assert.ok(lib.tension_targets.every(t => t >= 0.15 && t <= 0.75), 'targets stay inside the gate band');
  assert.ok(lib.narrative.includes('AABA'));
});

test('libretto: 4 bars → AB; 1 bar → A; explicit form wins', () => {
  assert.equal(planLibretto({ bars: 4 }).form, 'AB');
  assert.equal(planLibretto({ bars: 1 }).form, 'A');
  assert.equal(planLibretto({ bars: 12, form: 'ABAC' }).form, 'ABAC');
  assert.equal(planLibretto({ bars: 12, form: 'ABAC' }).sections.length, 4);
});

test('outlineForBar: names the section, the position, the target, the arc phase', () => {
  const lib = planLibretto({ bars: 8 });
  const o = outlineForBar(lib, 0);
  assert.equal(o.section, 'A');
  assert.equal(o.bar_in_section, 1);
  assert.equal(o.tension_target, lib.tension_targets[0]);
  assert.equal(o.arc, 'rising');
  const peak = lib.tension_targets.indexOf(Math.max(...lib.tension_targets));
  assert.equal(outlineForBar(lib, peak).arc, 'peaking');
  assert.equal(outlineForBar(lib, 7).arc, 'settling');
  assert.equal(outlineForBar(lib, 8).bar_in_piece, 1, 'choruses wrap');
  // nudged targets serve through the same window
  const nudged = outlineForBar(lib, 0, lib.tension_targets.map(t => t + 0.05));
  assert.ok(Math.abs(nudged.tension_target - (lib.tension_targets[0] + 0.05)) < 1e-9);
});

// ── the cell ────────────────────────────────────────────────────────────────

test('librettist sheet: sclerotic tissue — outline signals serve the plan at cost 0', () => {
  const lib = planLibretto({ bars: 8 });
  const sheet = librettistSheet(lib);
  const rules = (sheet.rules ?? []) as Parameters<typeof matchRule>[0];
  const hit = matchRule(rules, 'outline', {});
  assert.ok(hit.hit, 'any outline signal hits');
  const resp = hit.response as Record<string, unknown>;
  assert.equal(resp.form, 'AABA');
  assert.deepEqual(resp.tension_targets, lib.tension_targets);
  assert.ok(!('model' in sheet), 'the plan never thinks');
});

// ── the arc check: the critic consumes the outline ──────────────────────────

function barWith(tension: number, n = 1): TraceBar {
  return {
    bar: n, onsets: 4,
    features: {
      note_density: 0.35, syncopation: 0.4, register_spread: 0.12,
      rest_ratio: 0.1, harmonic_tension: tension, interval_size: 0.3, avg_pitch: 0.5,
    },
  };
}

test('arc check: a bar on the arc reads clean; off the arc is flagged with the target named', () => {
  const target = 0.5;
  const onArc = arcObservations([barWith(0.55)], [target]);
  assert.equal(onArc.length, 0, 'inside tolerance — the arc is a target, not a cage');
  const off = arcObservations([barWith(0.75)], [target]);
  assert.equal(off.length, 1);
  assert.equal(off[0].kind, 'tension-curve');
  assert.equal(off[0].severity, 'bad', '0.25 off is double tolerance');
  assert.ok(off[0].directive.includes('0.50'), 'the directive names the target');
  assert.ok(off[0].directive.includes('back off'), 'too hot → ease');
  const under = arcObservations([barWith(0.3)], [target]);
  assert.ok(under[0].directive.includes('lean into'), 'too cool → build');
  const slight = arcObservations([barWith(0.65)], [target]);
  assert.equal(slight[0].severity, 'warn', 'just outside tolerance warns');
});

test('arc check: cheapCritique folds arc observations into the verdict (opt-in, v0.3 callers unchanged)', () => {
  const intent = criticIntent();
  const trace = [barWith(0.8, 1), barWith(0.8, 2)];
  // without targets: v0.3 semantics — two bars, no curve check (needs 4)
  const before = cheapCritique(trace, intent);
  assert.equal(before.observations.filter(o => o.kind === 'tension-curve').length, 0);
  // with targets: the arc speaks
  const after = cheapCritique(trace, intent, { tensionTargets: [0.4, 0.4] });
  const arc = after.observations.filter(o => o.kind === 'tension-curve');
  assert.equal(arc.length, 2);
  assert.equal(after.verdict, 'revise', '0.4 off target × 2 bars forces a revise');
});

// ── the payload: the outline reaches the bandleader ─────────────────────────

test('composePayload: outline is additive — absent changes no key set; present it binds', () => {
  const plain = composePayload({ barIndex: 0, changes: 'Dm7', bars: 1 });
  assert.deepEqual(Object.keys(plain).sort(), ['bar_index', 'bars', 'changes'].sort());
  const lib = planLibretto({ bars: 8 });
  const withOutline = composePayload({ barIndex: 3, changes: 'G7', bars: 1, outline: outlineForBar(lib, 3) });
  assert.ok(withOutline.outline);
  assert.equal((withOutline.outline as { form: string }).form, 'AABA');
  const prompt = bandleaderSystemPrompt({});
  assert.ok(prompt.includes('OUTLINE'), 'the prompt names the outline contract');
  assert.ok(prompt.includes('tension_target'), 'the prompt binds the arc target');
});

// ── the controller: the outline evolves ─────────────────────────────────────

test('nudgeTargets: drift beyond tolerance nudges remaining targets toward the music; small drift stands', () => {
  const targets = [0.5, 0.6, 0.7, 0.6, 0.5];
  // the piece ran hot by +0.2 on the first two bars → future targets ease 0.08
  const hot = nudgeTargets(targets, [0.7, 0.8]);
  assert.equal(hot.drift, 0.2);
  assert.equal(hot.nudge, -0.08, 'clamped at ARC_NUDGE_MAX');
  assert.equal(hot.targets[2], 0.62);
  assert.deepEqual(hot.targets.slice(0, 2), targets.slice(0, 2), 'realized bars keep their history');
  const still = nudgeTargets(targets, [0.55, 0.65]);
  assert.equal(still.nudge, 0, `inside tolerance (${ARC_DRIFT_TOL}) the arc stands`);
  // clamped to the gate band
  const wild = nudgeTargets([0.2, 0.2, 0.2, 0.2], [0.9, 0.9]);
  assert.ok(wild.targets.slice(2).every(t => t >= 0.15 && t <= 0.75));
});

// ── the journey: the outline travels through a real compose cycle ───────────

test('JOURNEY: the compose payload carries the outline; the critique consumes its targets', async () => {
  const lib = planLibretto({ bars: 4 });
  const BAR = '@piano | d3 . f3-c4 . . e4 . . | vel: 60';
  const seen: Array<Record<string, unknown>> = [];
  const io: CycleIO = {
    fireCompose: async payload => {
      seen.push(payload);
      return { ok: true, mode: 'model', answer: BAR, latencyMs: 1 };
    },
    fireCritique: async () => ({ ok: true, mode: 'table', answer: '' }),
    analyze: async (_soFar, candidate) => candidate.map((_, i) => barWith(0.5, i + 1)),
  };
  const cycle = await composeCycle(io, {
    barIndex: 1, changes: 'G7', bars: 1, recent: [],
    intent: criticIntent(), steering: null, ganRounds: 1,
    extract: () => [BAR],
    outline: outlineForBar(lib, 1) as unknown as Record<string, unknown>,
    tensionTargets: [lib.tension_targets[1]],
  });
  assert.ok(cycle.rounds[0].payload.outline, 'the outline reached the bandleader');
  assert.equal((cycle.rounds[0].payload.outline as { form: string }).form, 'AB');
  // tension .5 vs target (≈.6 for bar 2 of an AB) — within tol, accepted clean
  assert.equal(cycle.finalCritique!.observations.filter(o => o.kind === 'tension-curve').length,
    Math.abs(0.5 - lib.tension_targets[1]) > TENSION_TARGET_TOL ? 1 : 0);
  assert.equal(seen.length, 1);
});
