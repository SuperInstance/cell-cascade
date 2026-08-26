// cell-cascade — tests: DISTILLATION MINTING (v0.4)
// The ledger is ore, the gate's bands are the mint: repeated seam verdicts
// in one direction mint themselves into gate-bands.json — versioned,
// evidence-cited, reversible. Recalibrations and operator-override
// adoptions need a musical judgment (the judger) before they move a band.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evidenceFromLine, scanLedgers, findMintPatterns, defaultGateBands, loadGateBands,
  writeGateBands, applyMint, rollbackGateBands, renderMintRecord, MAX_EDGE_MOVE,
  type MintEvidencePoint,
} from '../src/mint';
import { criticIntent, AMBIGUITY_BAND } from '../src/critic';

// ── fixtures ────────────────────────────────────────────────────────────────

function seamOk(channel: string, value: number, target: { lo: number; hi: number }, over: Partial<MintEvidencePoint> = {}): MintEvidencePoint {
  return {
    run: 'runs/x', line: 1, tick: 1, compose: 0, round: 1, serve: 'seam', verdict: 'accept',
    channel, side: value < target.lo ? 'low' : 'high', bar: 1,
    value, target_lo: target.lo, target_hi: target.hi,
    judged: 'seam', severity: 'ok', resolved: true,
    ...over,
  };
}

function seamBad(channel: string, value: number, target: { lo: number; hi: number }, over: Partial<MintEvidencePoint> = {}): MintEvidencePoint {
  return { ...seamOk(channel, value, target, over), severity: 'bad' };
}

function gateBad(channel: string, value: number, target: { lo: number; hi: number }, over: Partial<MintEvidencePoint> = {}): MintEvidencePoint {
  return { ...seamOk(channel, value, target, over), judged: 'gate', serve: 'cheap', severity: 'bad' };
}

function tmpLedger(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'mint-'));
  writeFileSync(join(dir, 'tick-log.jsonl'), lines.join('\n') + '\n');
  return dir;
}

// a v0.4 driver gate-evidence line: seam adjudicated a gray-low density read OK
function gateLine(tick: number, evidence: Array<Record<string, unknown>>, over: Record<string, unknown> = {}): string {
  return JSON.stringify({ gate: true, tick, compose: Math.floor(tick / 4), round: 1, serve: 'seam', verdict: 'accept', ...over, evidence });
}

// ── evidence extraction ─────────────────────────────────────────────────────

test('evidenceFromLine: reads gate evidence lines; old ledgers yield nothing', () => {
  const line = JSON.parse(gateLine(5, [
    { channel: 'note_density', side: 'low', bar: 1, value: 0.28, target_lo: 0.32, target_hi: 0.6, judged: 'seam', severity: 'ok', resolved: true, accepted: true },
  ]));
  const pts = evidenceFromLine(line, 'runs/demo', 7);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].channel, 'note_density');
  assert.equal(pts[0].side, 'low');
  assert.equal(pts[0].judged, 'seam');
  assert.equal(pts[0].line, 7);
  assert.equal(pts[0].run, 'runs/demo');
  // old-format lines (no evidence array) contribute nothing — honestly
  assert.deepEqual(evidenceFromLine({ tick: 1, critique: 0, serve: 'seam', mode: 'model' }, 'runs/old', 1), []);
  // non-channel keys are ignored
  assert.deepEqual(evidenceFromLine({ evidence: [{ channel: 'avg_pitch', value: 0.5, target_lo: 0, target_hi: 1 }] }, 'r', 1), []);
});

test('scanLedgers: cites run dirs + line numbers, skips garbage lines', () => {
  const dir = tmpLedger([
    '{"tick":1,"beat":0,"mode":"table"}',
    gateLine(5, [{ channel: 'note_density', side: 'low', value: 0.28, target_lo: 0.32, target_hi: 0.6, judged: 'seam', severity: 'ok' }]),
    'not json at all',
    gateLine(9, [{ channel: 'syncopation', side: 'low', value: 0.16, target_lo: 0.2, target_hi: 1.0, judged: 'gate', severity: 'bad', accepted: true }]),
  ]);
  const scan = scanLedgers([dir, join(tmpdir(), 'no-such-run')]);
  assert.equal(scan.runs.length, 1);
  assert.equal(scan.points.length, 2);
  assert.equal(scan.points[0].line, 2);
  assert.equal(scan.points[0].value, 0.28);
  assert.equal(scan.linesRead, 4);
  rmSync(dir, { recursive: true, force: true });
});

// ── pattern finding ─────────────────────────────────────────────────────────

test('pattern: repeated seam-ok on one edge → LOOSEN covers the blessed readings', () => {
  const standing = criticIntent();
  const target = { lo: standing.note_density.lo, hi: standing.note_density.hi };
  const pts = [0.06, 0.08, 0.1].map((v, i) => seamOk('note_density', v, target, { tick: i + 1, line: i + 1 }));
  const { patterns, skipped } = findMintPatterns(pts, standing, 3);
  assert.equal(skipped.length, 0);
  assert.equal(patterns.length, 1);
  const p = patterns[0];
  assert.equal(p.kind, 'loosen');
  assert.equal(p.channel, 'note_density');
  assert.equal(p.side, 'low');
  // new lo = min(values) - gray margin = 0.06 - 0.06 = 0
  assert.equal(p.adjustment.to, 0);
  assert.equal(p.needsJudgment, false, 'evidence tested the standing band — seam sanction suffices');
  assert.ok(p.rationale.includes('cost 0'));
});

test('pattern: repeated seam-ok under an operator override → needs musical judgment', () => {
  const standing = criticIntent();                        // standing lo 0.15
  const override = { lo: 0.32, hi: 0.6 };                 // the run's env INTENT
  const pts = [0.28, 0.3, 0.29].map((v, i) => seamOk('note_density', v, override, { tick: i + 1 }));
  const { patterns } = findMintPatterns(pts, standing, 3);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].needsJudgment, true, 'evidence tested an override, not the standing band');
});

test('pattern: mixed seam verdicts on one edge are a conflict — recorded, never minted', () => {
  const standing = criticIntent();
  const t = { lo: standing.note_density.lo, hi: standing.note_density.hi };
  const pts = [
    seamOk('note_density', 0.1, t), seamOk('note_density', 0.11, t),
    seamBad('note_density', 0.09, t), seamBad('note_density', 0.12, t),
  ];
  const { patterns, skipped } = findMintPatterns(pts, standing, 2);
  assert.equal(patterns.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].conflict, 'mixed verdicts');
});

test('pattern: repeated seam-bad in the gray → TIGHTEN so the gate flags it alone', () => {
  const standing = criticIntent();
  const t = { lo: standing.syncopation.lo, hi: standing.syncopation.hi };  // lo 0.2
  // gray-low readings: [0.2-0.06, 0.2) — the seam keeps damning them
  const pts = [0.16, 0.17, 0.18].map((v, i) => seamBad('syncopation', v, t, { tick: i + 1 }));
  const { patterns } = findMintPatterns(pts, standing, 3);
  assert.equal(patterns.length, 1);
  const p = patterns[0];
  assert.equal(p.kind, 'tighten');
  assert.equal(p.side, 'low');
  // new lo = min(0.16) + gray + margin = 0.23 → 0.16 sits clear below 0.23-0.06
  assert.equal(p.adjustment.to, 0.23);
  assert.ok(p.adjustment.to - p.adjustment.from <= MAX_EDGE_MOVE + 1e-9, 'mints creep, never leap');
});

test('pattern: repeated gate-bad on ACCEPTED bars → RECALIBRATE (needs judgment)', () => {
  const standing = criticIntent();
  const t = { lo: standing.register_spread.lo, hi: standing.register_spread.hi };  // lo 0.05
  const pts = [0.0, 0.01, 0.02].map((v, i) => gateBad('register_spread', v, t, { tick: i + 1, accepted: true }));
  const { patterns } = findMintPatterns(pts, standing, 3);
  assert.equal(patterns.length, 1);
  const p = patterns[0];
  assert.equal(p.kind, 'recalibrate');
  assert.equal(p.needsJudgment, true, 'measurement alone never moves a band — the judger signs it');
  // rejected bars (not accepted) never recalibrate
  const rejectedPts = [0.0, 0.01, 0.02].map((v, i) => gateBad('register_spread', v, t, { tick: i + 1, accepted: false }));
  assert.equal(findMintPatterns(rejectedPts, standing, 3).patterns.length, 0);
});

test('pattern: unresolved grays judge nothing', () => {
  const standing = criticIntent();
  const t = { lo: standing.note_density.lo, hi: standing.note_density.hi };
  const pts = [0.1, 0.11, 0.12].map((v, i) => seamOk('note_density', v, t, { tick: i + 1, resolved: false }));
  assert.equal(findMintPatterns(pts, standing, 3).patterns.length, 0);
});

// ── the versioned file: apply, load, rollback ───────────────────────────────

test('applyMint: version increments, snapshot carries the moved edge, evidence cited', async () => {
  const file = defaultGateBands();
  const t = { lo: file.bands.note_density.lo, hi: file.bands.note_density.hi };
  const scan = { points: [0.06, 0.08, 0.1].map((v, i) => seamOk('note_density', v, t, { tick: i + 1, line: i + 2 })), runs: ['runs/x'], linesRead: 9, evidenceLines: 3 };
  const { patterns, skipped } = findMintPatterns(scan.points, file.bands, 3);
  const { file: next, record } = await applyMint({ file, patterns, skipped, scan, minRepeats: 3, at: '2026-08-26T00:00:00Z' });
  assert.equal(next.version, 1);
  assert.equal(record.applied.length, 1);
  assert.ok(next.bands.note_density.lo < file.bands.note_density.lo, 'the low edge loosened');
  assert.equal(next.history.length, 1);
  const cited = record.applied[0].evidence;
  assert.equal(cited.length, 3);
  assert.ok(cited.every(e => e.line > 0 && e.run === 'runs/x'), 'every mint cites its evidence');
  // render: a human can read it
  const md = renderMintRecord(record);
  assert.ok(md.includes('LOOSEN note_density'));
  assert.ok(md.includes('tick-log.jsonl:'));
});

test('applyMint: needsJudgment without a judger → rejected, version unchanged', async () => {
  const file = defaultGateBands();
  const override = { lo: 0.32, hi: 0.6 };
  const scan = { points: [0.28, 0.29, 0.3].map(v => seamOk('note_density', v, override)), runs: ['runs/x'], linesRead: 3, evidenceLines: 3 };
  const { patterns, skipped } = findMintPatterns(scan.points, file.bands, 3);
  assert.equal(patterns[0].needsJudgment, true);
  const { file: next, record } = await applyMint({ file, patterns, skipped, scan, minRepeats: 3 });
  assert.equal(next.version, 0, 'nothing applied — no version');
  assert.equal(record.applied.length, 0);
  assert.match(record.rejected[0].reason, /musical judgment/);
});

test('applyMint: the judger approves an adoption / rejects another — both recorded', async () => {
  const file = defaultGateBands();
  const override = { lo: 0.32, hi: 0.6 };
  const scan = { points: [0.28, 0.29, 0.3].map(v => seamOk('note_density', v, override)), runs: ['runs/x'], linesRead: 3, evidenceLines: 3 };
  const { patterns, skipped } = findMintPatterns(scan.points, file.bands, 3);
  const approve = await applyMint({
    file, patterns, skipped, scan, minRepeats: 3,
    judger: async () => ({ verdict: 'approve', note: 'density .28 at the low edge is a breathing piano line — sound' }),
  });
  assert.equal(approve.file.version, 1);
  assert.equal(approve.record.applied.length, 1);
  const reject = await applyMint({
    file, patterns, skipped, scan, minRepeats: 3,
    judger: async () => ({ verdict: 'reject', note: 'that sparse is a different organism' }),
  });
  assert.equal(reject.file.version, 0);
  assert.match(reject.record.rejected[0].reason, /REJECTED/);
});

test('applyMint: empty pass mints nothing — no version inflation', async () => {
  const file = defaultGateBands();
  const scan = { points: [], runs: ['runs/x'], linesRead: 5, evidenceLines: 0 };
  const { file: next, record } = await applyMint({ file, patterns: [], skipped: [], scan, minRepeats: 3 });
  assert.equal(next.version, 0);
  assert.equal(next.history.length, 0);
  assert.equal(record.applied.length, 0);
});

test('gate-bands.json roundtrip: atomic write, tolerant load, corrupt → null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  const path = join(dir, 'gate-bands.json');
  const file = defaultGateBands();
  file.bands.note_density = { lo: 0.1, hi: 0.55 };
  writeGateBands(path, file);
  const back = loadGateBands(path);
  assert.ok(back);
  assert.equal(back!.version, file.version);
  assert.deepEqual(back!.bands.note_density, { lo: 0.1, hi: 0.55 });
  assert.equal(loadGateBands(join(dir, 'missing.json')), null);
  writeFileSync(path, '{ this is not json');
  assert.equal(loadGateBands(path), null, 'corrupt file → null → defaults, never garbage');
  rmSync(dir, { recursive: true, force: true });
});

test('rollback: restores the prior snapshot AS A NEW VERSION — reversible reversal', async () => {
  let file = defaultGateBands();
  const t = { lo: file.bands.note_density.lo, hi: file.bands.note_density.hi };
  const scan = { points: [0.06, 0.08, 0.1].map(v => seamOk('note_density', v, t)), runs: ['runs/x'], linesRead: 3, evidenceLines: 3 };
  const { patterns, skipped } = findMintPatterns(scan.points, file.bands, 3);
  const minted = await applyMint({ file, patterns, skipped, scan, minRepeats: 3, at: '2026-08-26T00:00:00Z' });
  file = minted.file;
  assert.equal(file.version, 1);
  const before = file.bands.note_density.lo;

  const rb = rollbackGateBands(file, undefined, '2026-08-26T01:00:00Z');
  assert.equal(rb.file.version, 2, 'rollback is itself a new version');
  assert.equal(rb.record.kind, 'rollback');
  assert.equal(rb.record.restored_from, 0);
  assert.equal(rb.file.bands.note_density.lo, defaultGateBands().bands.note_density.lo, 'the minted edge came back');
  assert.equal(rb.file.history.length, 2, 'the mint stays in history — nothing destroyed');
  assert.notEqual(rb.file.bands.note_density.lo, before);
  // and rolling forward again is just another mint — evidence permitting
  assert.ok(renderMintRecord(rb.record).includes('ROLLBACK'));
});

test('mint pass on a real-shape ledger fixture: gray-low density thrice → the gate grows', () => {
  const dir = tmpLedger([
    ...[1, 5, 9].map((tick, i) => gateLine(tick, [
      { channel: 'note_density', side: 'low', bar: 1, value: 0.28 - i * 0.01, target_lo: 0.32, target_hi: 0.6, judged: 'seam', severity: 'ok', resolved: true, accepted: true },
    ])),
  ]);
  const scan = scanLedgers([dir]);
  const standing = criticIntent();   // standing lo 0.15 ≠ evidence lo 0.32 → judgment needed
  const { patterns } = findMintPatterns(scan.points, standing, 3);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].needsJudgment, true);
  rmSync(dir, { recursive: true, force: true });
});
