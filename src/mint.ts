// cell-cascade — src/mint.ts
// DISTILLATION MINTING (v0.4). The signal ledger is ore; the gate's bands
// are the mint. Every seam adjudication a critic makes lands in the run
// ledger (runs/*/tick-log.jsonl, the `gate` evidence lines the driver
// writes per compose round). When the SAME channel keeps getting judged
// the SAME direction — the seam repeatedly blessing (or damning) readings
// at one band edge — that judgment is no longer ambiguity, it is TENDENCY,
// and tendency belongs in the frozen gate at cost 0:
//
//   scan ledger ──► evidence points (channel · side · value · judged-by ·
//                   severity, each citing run + line)
//          │
//          ▼
//   find patterns: same channel + same verdict direction, ≥ N repeats
//          │   seam 'ok'  ×N on one edge  → LOOSEN that edge to cover the
//          │                                    blessed readings (they stop
//          │                                    being gray — cost 0 forever)
//          │   seam 'bad' ×N in the gray  → TIGHTEN that edge so the gate
//          │                                    alone flags what it kept
//          │                                    catching the seam catching
//          │   gate 'bad' ×N on ACCEPTED bars → RECALIBRATE toward the
//          │                                    measured reality the organ-
//          │                                    ism actually kept (needs a
//          │                                    musical judgment — kimi)
//          ▼
//   gate-bands.json: VERSIONED. every mint appends a history record that
//   cites its evidence (run:line for every point); rollback restores any
//   prior snapshot as a NEW version — mints are reversible by doctrine.
//
// The frozen gate loads the standing bands at startup (the driver passes
// them into criticIntent); seam-derived mints apply directly because the
// seam IS a musical judgment; recalibrations and operator-override
// adoptions pass through a JUDGER (kimi -p in the mint script) — no band
// moves on measurement alone.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  CRITIC_FEATURES, AMBIGUITY_BAND, criticIntent,
  type CriticChannel, type CriticIntent, type Severity,
} from './critic';

// ── evidence: what the ledger says happened ─────────────────────────────────

/** One judged band reading, with its provenance. Every mint cites these. */
export interface MintEvidencePoint {
  run: string;            // runs/<dir> — where it was judged
  line: number;           // 1-based line in tick-log.jsonl
  tick: number;
  compose: number;
  round: number;
  serve: string;          // 'cheap' | 'seam'
  verdict: string;        // the critique's verdict that round
  channel: string;
  side: 'low' | 'high';   // which band edge the reading pressed
  bar?: number;
  value: number;
  target_lo: number;
  target_hi: number;
  judged: 'gate' | 'seam';
  severity: Severity;
  resolved: boolean;      // seam answered and was merged (false = unresolved gray)
  accepted?: boolean;     // the round's bars ultimately stood
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Read one parsed ledger line's `evidence` array into evidence points.
 *  Only `gate` lines (written by the v0.4 driver after each compose round)
 *  carry evidence; anything else yields []. */
export function evidenceFromLine(
  entry: Record<string, unknown>, run: string, line: number,
): MintEvidencePoint[] {
  if (!Array.isArray(entry.evidence)) return [];
  const out: MintEvidencePoint[] = [];
  for (const raw of entry.evidence as Record<string, unknown>[]) {
    const channel = String(raw?.channel ?? '');
    const value = num(raw?.value), lo = num(raw?.target_lo), hi = num(raw?.target_hi);
    if (!CRITIC_FEATURES.includes(channel as CriticChannel)) continue;
    if (value === null || lo === null || hi === null) continue;
    const side = value < lo ? 'low' : 'high';
    const judged = raw?.judged === 'seam' ? 'seam' : 'gate';
    const severity = raw?.severity === 'bad' ? 'bad' : raw?.severity === 'ok' ? 'ok' : 'warn';
    out.push({
      run, line,
      tick: num(entry.tick) ?? 0, compose: num(entry.compose) ?? 0,
      round: num(entry.round) ?? 0,
      serve: String(entry.serve ?? ''), verdict: String(entry.verdict ?? ''),
      channel, side,
      bar: num(raw?.bar) ?? undefined,
      value, target_lo: lo, target_hi: hi,
      judged, severity,
      resolved: raw?.resolved !== false,
      accepted: typeof raw?.accepted === 'boolean' ? raw.accepted : undefined,
    });
  }
  return out;
}

export interface LedgerScan {
  points: MintEvidencePoint[];
  runs: string[];
  linesRead: number;
  evidenceLines: number;
}

/** Scan run directories for tick-log.jsonl and collect every evidence
 *  point. Tolerant: missing dirs, non-JSON lines, and old (evidence-less)
 *  ledgers simply contribute nothing. */
export function scanLedgers(runDirs: string[]): LedgerScan {
  const points: MintEvidencePoint[] = [];
  const runs: string[] = [];
  let linesRead = 0, evidenceLines = 0;
  for (const dir of runDirs) {
    const logPath = join(dir, 'tick-log.jsonl');
    if (!existsSync(logPath)) continue;
    runs.push(dir);
    const lines = readFileSync(logPath, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      linesRead++;
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(t) as Record<string, unknown>; } catch { continue; }
      const pts = evidenceFromLine(entry, dir, i + 1);
      if (pts.length) { evidenceLines++; points.push(...pts); }
    }
  }
  return { points, runs, linesRead, evidenceLines };
}

// ── patterns: repeated verdict directions become proposals ──────────────────

export interface BandAdjustment {
  channel: CriticChannel;
  side: 'low' | 'high';
  from: number;           // the edge the evidence was judged against
  to: number;             // the proposed standing edge
}

export interface MintPattern {
  kind: 'loosen' | 'tighten' | 'recalibrate';
  channel: CriticChannel;
  side: 'low' | 'high';
  counts: { ok: number; bad: number; gate_bad: number };
  evidence: MintEvidencePoint[];       // capped at EVIDENCE_CAP for the record
  evidence_total: number;
  adjustment: BandAdjustment;
  rationale: string;
  /** true → the proposal needs a musical judgment (kimi) before it moves
   *  a STANDING band it did not directly test. */
  needsJudgment: boolean;
  conflict?: string;                   // set when recorded-but-not-proposed
}

/** Max evidence points cited per pattern record (the log stays human). */
export const EVIDENCE_CAP = 8;
/** A single mint may move one edge at most this far — mints creep, they
 *  never leap. Repeated evidence can mint again next pass. */
export const MAX_EDGE_MOVE = 0.15;
/** Edges stay sane: a band never inverts and never thins past this. */
export const MIN_BAND_WIDTH = 0.05;

function groupKey(p: MintEvidencePoint): string {
  return `${p.channel}|${p.side}`;
}

/** Find repeated verdict patterns in the evidence. Returns proposals AND
 *  skipped conflicts (mixed seam verdicts on one edge are noise, not
 *  tendency — they are recorded, never minted). */
export function findMintPatterns(
  points: MintEvidencePoint[],
  standing: CriticIntent,
  minRepeats: number,
): { patterns: MintPattern[]; skipped: MintPattern[] } {
  const byEdge = new Map<string, MintEvidencePoint[]>();
  for (const p of points) {
    if (!p.resolved) continue;                    // unresolved grays judge nothing
    byEdge.set(groupKey(p), [...(byEdge.get(groupKey(p)) ?? []), p]);
  }

  const patterns: MintPattern[] = [];
  const skipped: MintPattern[] = [];

  for (const [key, pts] of byEdge) {
    const [channel, side] = key.split('|') as [CriticChannel, 'low' | 'high'];
    const seamOk = pts.filter(p => p.judged === 'seam' && p.severity === 'ok');
    const seamBad = pts.filter(p => p.judged === 'seam' && p.severity === 'bad');
    const seamWarn = pts.filter(p => p.judged === 'seam' && p.severity === 'warn');
    const gateBad = pts.filter(p => p.judged === 'gate' && p.severity === 'bad');

    // conflicts: the seam blessed AND damned the same edge → no tendency
    if (seamOk.length >= 1 && seamBad.length >= 1) {
      skipped.push({
        kind: 'loosen', channel, side,
        counts: { ok: seamOk.length, bad: seamBad.length, gate_bad: gateBad.length },
        evidence: pts.slice(0, EVIDENCE_CAP), evidence_total: pts.length,
        adjustment: { channel, side, from: 0, to: 0 },
        rationale: `mixed seam verdicts on the ${side} edge of ${channel} (${seamOk.length} ok / ${seamBad.length} bad) — ambiguity is real here, the seam keeps it`,
        needsJudgment: false, conflict: 'mixed verdicts',
      });
      continue;
    }

    const evidenceBand = { lo: pts[0].target_lo, hi: pts[0].target_hi };
    const standingBand = standing[channel];

    // ── LOOSEN: the seam keeps blessing readings the gate calls gray ──
    if (seamOk.length >= minRepeats) {
      const values = seamOk.map(p => p.value);
      const extreme = side === 'low' ? Math.min(...values) : Math.max(...values);
      const raw = side === 'low' ? extreme - AMBIGUITY_BAND : extreme + AMBIGUITY_BAND;
      const oldEdge = side === 'low' ? evidenceBand.lo : evidenceBand.hi;
      const move = side === 'low' ? Math.max(raw, oldEdge - MAX_EDGE_MOVE) : Math.min(raw, oldEdge + MAX_EDGE_MOVE);
      const to = r3(Math.max(0, Math.min(1, move)));
      const sane = side === 'low' ? to < evidenceBand.hi - MIN_BAND_WIDTH : to > evidenceBand.lo + MIN_BAND_WIDTH;
      const targetsStanding = Math.abs((side === 'low' ? standingBand.lo : standingBand.hi) - oldEdge) < 1e-9;
      patterns.push({
        kind: 'loosen', channel, side,
        counts: { ok: seamOk.length, bad: seamBad.length, gate_bad: gateBad.length },
        evidence: seamOk.slice(0, EVIDENCE_CAP), evidence_total: seamOk.length,
        adjustment: { channel, side, from: r3(oldEdge), to },
        rationale: `the seam blessed ${seamOk.length} reading(s) at ${channel}'s ${side} edge (extreme ${r3(extreme)}) — readings the gate called gray. ` +
          `Move the ${side} edge to ${to} so they sit inside the band: future identical readings judge clean at cost 0. ` +
          (targetsStanding
            ? 'The evidence tested the standing band directly.'
            : `The evidence tested an operator intent override ([${evidenceBand.lo}, ${evidenceBand.hi}]) — adopting into the standing band needs musical judgment.`),
        needsJudgment: !targetsStanding,
      });
      if (!sane) skipped.push(patterns.pop()!);
      continue;
    }

    // ── TIGHTEN: the seam keeps damning readings the gate only grays ──
    if (seamBad.length >= minRepeats && seamOk.length === 0) {
      const values = seamBad.map(p => p.value);
      // only meaningful when the damned readings sat in the GRAY zone
      // (clear violations the gate already flags at cost 0)
      const allGray = seamBad.every(p =>
        p.judged === 'seam' && (side === 'low'
          ? p.value >= p.target_lo - AMBIGUITY_BAND && p.value < p.target_lo
          : p.value <= p.target_hi + AMBIGUITY_BAND && p.value > p.target_hi));
      if (allGray) {
        const extreme = side === 'low' ? Math.min(...values) : Math.max(...values);
        const oldEdge = side === 'low' ? evidenceBand.lo : evidenceBand.hi;
        const raw = side === 'low' ? extreme + AMBIGUITY_BAND + 0.01 : extreme - AMBIGUITY_BAND - 0.01;
        const move = side === 'low' ? Math.min(raw, oldEdge + MAX_EDGE_MOVE) : Math.max(raw, oldEdge - MAX_EDGE_MOVE);
        const to = r3(Math.max(0, Math.min(1, move)));
        const sane = side === 'low' ? to < evidenceBand.hi - MIN_BAND_WIDTH : to > evidenceBand.lo + MIN_BAND_WIDTH;
        const targetsStanding = Math.abs((side === 'low' ? standingBand.lo : standingBand.hi) - oldEdge) < 1e-9;
        const p: MintPattern = {
          kind: 'tighten', channel, side,
          counts: { ok: seamOk.length, bad: seamBad.length, gate_bad: gateBad.length },
          evidence: seamBad.slice(0, EVIDENCE_CAP), evidence_total: seamBad.length,
          adjustment: { channel, side, from: r3(oldEdge), to },
          rationale: `the seam damned ${seamBad.length} gray reading(s) at ${channel}'s ${side} edge (extreme ${r3(extreme)}) — the gate kept missing what the ear kept catching. ` +
            `Move the ${side} edge to ${to} so the gate alone flags them: clear violations, cost 0, no seam.`,
          needsJudgment: !targetsStanding,
        };
        if (sane) patterns.push(p);
        continue;
      }
    }

    // ── RECALIBRATE: clear gate violations the organism kept anyway ──
    const keptBads = gateBad.filter(p => p.accepted === true);
    if (keptBads.length >= minRepeats && seamOk.length === 0) {
      const values = keptBads.map(p => p.value);
      const sorted = [...values].sort((a, b) => a - b);
      const median = r3(sorted[Math.floor(sorted.length / 2)]);
      const oldEdge = side === 'low' ? evidenceBand.lo : evidenceBand.hi;
      const raw = side === 'low' ? median - AMBIGUITY_BAND : median + AMBIGUITY_BAND;
      const move = side === 'low' ? Math.max(raw, oldEdge - MAX_EDGE_MOVE) : Math.min(raw, oldEdge + MAX_EDGE_MOVE);
      const to = r3(Math.max(0, Math.min(1, move)));
      const sane = side === 'low' ? to < evidenceBand.hi - MIN_BAND_WIDTH : to > evidenceBand.lo + MIN_BAND_WIDTH;
      if (sane) {
        patterns.push({
          kind: 'recalibrate', channel, side,
          counts: { ok: seamOk.length, bad: seamBad.length, gate_bad: gateBad.length },
          evidence: keptBads.slice(0, EVIDENCE_CAP), evidence_total: keptBads.length,
          adjustment: { channel, side, from: r3(oldEdge), to },
          rationale: `${keptBads.length} clear ${channel} violation(s) on the ${side} side sat in bars the organism ACCEPTED (median ${median}) — the intent fought the music and the music won. ` +
            `Recalibrate the ${side} edge to ${to}: bands calibrated on measurement, not wishful intent (the v0.3 doctrine). This is a musical judgment — the judger must sign it.`,
          needsJudgment: true,
        });
      }
    }

    // near-miss accounting: warn-heavy edges with not enough repeats are
    // recorded in the scan, not proposed — nothing to do here.
    void seamWarn;
  }

  return { patterns, skipped };
}

// ── gate-bands.json: the versioned standing gate ────────────────────────────

export interface MintRecord {
  version: number;                  // the version this record created
  at: string;                       // ISO timestamp
  kind: 'init' | 'mint' | 'rollback';
  scanned: string[];                // run dirs scanned
  lines_read: number;
  evidence_lines: number;
  evidence_points: number;
  min_repeats: number;
  applied: Array<BandAdjustment & { kind: MintPattern['kind']; rationale: string; evidence: Array<{ run: string; line: number; tick: number; channel: string; value: number; severity: string }> }>;
  rejected: Array<{ channel: string; side: string; kind: string; reason: string; judgment?: string }>;
  skipped: Array<{ channel: string; side: string; rationale: string }>;
  restored_from?: number;           // rollback: the version whose snapshot stands again
  snapshot: CriticIntent;           // the FULL effective bands after this record
}

export interface GateBandsFile {
  version: number;                  // current version (0 = unborn, defaults)
  bands: CriticIntent;              // the standing bands the gate loads
  history: MintRecord[];            // every version, newest last
}

/** The unborn gate: the v0.3 calibrated defaults, no history. */
export function defaultGateBands(): GateBandsFile {
  return { version: 0, bands: criticIntent(), history: [] };
}

/** Load a gate-bands.json; corrupt/missing → null (caller falls back to
 *  defaults — the organism never starts from garbage). */
export function loadGateBands(path: string): GateBandsFile | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as GateBandsFile;
    if (typeof raw.version !== 'number' || typeof raw.bands !== 'object' || raw.bands === null || !Array.isArray(raw.history)) return null;
    // validate every channel band shape
    const bands = criticIntent();
    for (const ch of CRITIC_FEATURES) {
      const b = (raw.bands as Record<string, unknown>)[ch] as { lo?: unknown; hi?: unknown } | undefined;
      if (b && typeof b.lo === 'number' && typeof b.hi === 'number') bands[ch] = { lo: b.lo, hi: b.hi };
    }
    return { version: raw.version, bands, history: raw.history };
  } catch {
    return null;
  }
}

/** Atomic write (temp + rename) — a mint never half-lands. */
export function writeGateBands(path: string, file: GateBandsFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n');
  renameSync(tmp, path);
}

/** Apply a mint: new version, bands carry the applied adjustments, history
 *  gains the record. Patterns rejected by the judger (or needing judgment
 *  with none available) land in `rejected` — recorded, never silently lost. */
export function applyMint(args: {
  file: GateBandsFile;
  patterns: MintPattern[];
  skipped: MintPattern[];
  scan: LedgerScan;
  minRepeats: number;
  at?: string;
  /** Musical judgment on needsJudgment patterns. Returns 'approve' | 'reject' | 'unavailable' + note. */
  judger?: (pattern: MintPattern) => Promise<{ verdict: 'approve' | 'reject' | 'unavailable'; note: string }>;
}): Promise<{ file: GateBandsFile; record: MintRecord }> {
  const { file, patterns, skipped, scan, minRepeats } = args;
  const at = args.at ?? new Date().toISOString();
  const bands: CriticIntent = { ...file.bands };
  const applied: MintRecord['applied'] = [];
  const rejected: MintRecord['rejected'] = [];

  const apply = (p: MintPattern): void => {
    const band = bands[p.channel];
    bands[p.channel] = p.side === 'low'
      ? { lo: p.adjustment.to, hi: band.hi }
      : { lo: band.lo, hi: p.adjustment.to };
    applied.push({
      kind: p.kind, channel: p.channel, side: p.side,
      from: p.adjustment.from, to: p.adjustment.to,
      rationale: p.rationale,
      evidence: p.evidence.map(e => ({ run: e.run, line: e.line, tick: e.tick, channel: e.channel, value: r3(e.value), severity: e.severity })),
    });
  };

  return (async () => {
    for (const p of patterns) {
      if (!p.needsJudgment) { apply(p); continue; }
      if (!args.judger) {
        rejected.push({ channel: p.channel, side: p.side, kind: p.kind, reason: 'needs musical judgment — none available (run with the judger, or judge it yourself)' });
        continue;
      }
      const j = await args.judger(p);
      if (j.verdict === 'approve') { apply(p); rejected.push({ channel: p.channel, side: p.side, kind: p.kind, reason: `judged: APPROVED — ${j.note}`, judgment: j.note }); }
      else if (j.verdict === 'reject') rejected.push({ channel: p.channel, side: p.side, kind: p.kind, reason: `judged: REJECTED — ${j.note}`, judgment: j.note });
      else rejected.push({ channel: p.channel, side: p.side, kind: p.kind, reason: `judger unavailable — ${j.note}` });
    }

    // nothing applied → no new version (the log records the empty pass)
    if (!applied.length) {
      const record: MintRecord = {
        version: file.version, at, kind: file.version === 0 ? 'init' : 'mint',
        scanned: scan.runs, lines_read: scan.linesRead, evidence_lines: scan.evidenceLines,
        evidence_points: scan.points.length, min_repeats: minRepeats,
        applied: [], rejected, skipped: skipped.map(s => ({ channel: s.channel, side: s.side, rationale: s.rationale })),
        snapshot: { ...file.bands },
      };
      return { file, record };
    }

    const version = file.version + 1;
    const record: MintRecord = {
      version, at, kind: 'mint',
      scanned: scan.runs, lines_read: scan.linesRead, evidence_lines: scan.evidenceLines,
      evidence_points: scan.points.length, min_repeats: minRepeats,
      applied, rejected,
      skipped: skipped.map(s => ({ channel: s.channel, side: s.side, rationale: s.rationale })),
      snapshot: { ...bands },
    };
    return { file: { version, bands, history: [...file.history, record] }, record };
  })();
}

/** Rollback: restore a prior version's snapshot AS A NEW VERSION — the
 *  undo is itself recorded; nothing is ever destroyed. toVersion defaults
 *  to the version before current. */
export function rollbackGateBands(
  file: GateBandsFile, toVersion?: number, at = new Date().toISOString(),
): { file: GateBandsFile; record: MintRecord } {
  const target = toVersion ?? Math.max(0, file.version - 1);
  if (target === file.version) throw new Error(`already at version ${file.version}`);
  const snap = target === 0
    ? criticIntent()
    : file.history.find(r => r.version === target)?.snapshot;
  if (!snap) throw new Error(`no snapshot for version ${target} — history holds versions ${file.history.map(r => r.version).join(', ') || '(none)'}`);
  const version = file.version + 1;
  const record: MintRecord = {
    version, at, kind: 'rollback', restored_from: target,
    scanned: [], lines_read: 0, evidence_lines: 0, evidence_points: 0, min_repeats: 0,
    applied: [], rejected: [],
    skipped: [{ channel: '*', side: '*', rationale: `rollback — version ${version} restores the bands of version ${target}; the mint that made ${file.version} stays in history, reversible again` }],
    snapshot: { ...snap },
  };
  return { file: { version, bands: { ...snap }, history: [...file.history, record] }, record };
}

// ── the human-readable mint log ─────────────────────────────────────────────

/** Render one mint record as markdown for gate/mint-log.md — the mint a
 *  human can read, evidence and all. */
export function renderMintRecord(r: MintRecord): string {
  const head = r.kind === 'rollback'
    ? `## v${r.version} — ROLLBACK → restores v${r.restored_from} (${r.at})`
    : r.applied.length
      ? `## v${r.version} — MINT: ${r.applied.length} band(s) moved (${r.at})`
      : `## v${r.version} — PASS, nothing minted (${r.at})`;
  const lines = [head];
  if (r.kind !== 'rollback') {
    lines.push(`- scanned ${r.scanned.length} run(s) · ${r.lines_read} ledger lines · ${r.evidence_lines} evidence line(s) · ${r.evidence_points} evidence point(s) · min repeats ${r.min_repeats}`);
  }
  for (const a of r.applied) {
    lines.push('');
    lines.push(`- **${a.kind.toUpperCase()} ${a.channel} ${a.side} edge: ${a.from} → ${a.to}**`);
    lines.push(`  - ${a.rationale}`);
    lines.push(`  - evidence (${a.evidence.length} cited):`);
    for (const e of a.evidence) {
      lines.push(`    - \`${e.run}/tick-log.jsonl:${e.line}\` tick ${e.tick} · ${e.channel} ${e.value} → seam ${e.severity}`);
    }
  }
  for (const x of r.rejected) lines.push(`- ✗ ${x.kind} ${x.channel}/${x.side} NOT minted — ${x.reason}`);
  for (const s of r.skipped) lines.push(`- … ${s.channel}/${s.side}: ${s.rationale}`);
  return lines.join('\n');
}
