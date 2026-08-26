// cell-cascade — scripts/mint_bands.ts
// THE MINT PASS — distillation mints the gate's bands from the ledger.
//
//   npm run mint:bands                       # scan all runs/, mint what repeats
//   npm run mint:bands -- --min 2            # looser repeat threshold
//   npm run mint:bands -- --run runs/cortex-plug-...   # one run only
//   npm run mint:bands -- --dry              # propose, write nothing
//   npm run mint:bands -- --rollback [v]     # restore a prior version (as a new one)
//   npm run mint:bands -- --no-kimi          # no musical judger (auto-only mints)
//
// Every applied mint cites its evidence (run:line per point) in both the
// versioned gate/gate-bands.json and the human-readable gate/mint-log.md.
// Seam-derived mints apply directly (the seam IS musical judgment);

import { readdirSync, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  scanLedgers, findMintPatterns, defaultGateBands, loadGateBands, writeGateBands,
  applyMint, rollbackGateBands, renderMintRecord,
  type MintPattern, type GateBandsFile,
} from '../src/mint';

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};

const GATE_PATH = opt('gate') ?? 'gate/gate-bands.json';
const LOG_PATH = opt('log') ?? 'gate/mint-log.md';
const MIN = Math.max(1, Number(opt('min') ?? 3));
const RUNS_DIR = opt('runs-dir') ?? 'runs';

// ── the musical judger: kimi (K3) signs the judgment calls ──────────────────

function kimiJudger(pattern: MintPattern): Promise<{ verdict: 'approve' | 'reject' | 'unavailable'; note: string }> {
  const a = pattern.adjustment;
  const evidenceLines = pattern.evidence
    .map(e => `  - ${pattern.channel} ${e.value.toFixed(3)} at tick ${e.tick} (bar kept: ${e.accepted ?? 'n/a'}) — judged ${e.severity} by ${e.judged}`)
    .join('\n');
  const prompt = [
    'You are the musical judgment call in a distillation pipeline for an generative jazz organism.',
    `A critic's frozen feature gate measured the channel "${pattern.channel}" against the band ${evidenceOf(pattern)}.`,
    '',
    `Repeated evidence (${pattern.evidence_total} occurrences, direction: ${pattern.kind}):`,
    evidenceLines,
    '',
    `Proposed adjustment: move the ${pattern.side} edge of the "${pattern.channel}" band from ${a.from} to ${a.to}.`,
    `Rationale: ${pattern.rationale}`,
    '',
    'Channel semantics: note_density (fraction of sounding slots), syncopation (off-beat attack fraction),',
    'register_spread (voicing width, /127 normalized), rest_ratio (sustain coverage), harmonic_tension',
    '(0-1 chord color/tension), interval_size (mean melodic interval, /12 normalized).',
    '',
    'Question: is this band adjustment musically SOUND for a spare, late-quartet piano organism?',
    'Answer FIRST with exactly one word — SOUND or UNSOUND — then one short sentence why.',
  ].join('\n');
  return new Promise(resolve => {
    if (flag('no-kimi')) return resolve({ verdict: 'unavailable', note: '--no-kimi passed' });
    const r = spawnSync('kimi', ['-p', prompt], { timeout: 180_000, encoding: 'utf8', maxBuffer: 1 << 20 });
    if (r.error || r.status !== 0 || !r.stdout?.trim()) {
      return resolve({ verdict: 'unavailable', note: `kimi unavailable (${r.error?.message ?? `exit ${r.status}`})` });
    }
    const out = r.stdout.trim();
    const first = out.split(/\s+/)[0]?.toUpperCase().replace(/[^A-Z]/g, '') ?? '';
    if (first.startsWith('SOUND') && !first.startsWith('UNSOUND')) resolve({ verdict: 'approve', note: out.slice(0, 200) });
    else if (first.startsWith('UNSOUND')) resolve({ verdict: 'reject', note: out.slice(0, 200) });
    else resolve({ verdict: 'unavailable', note: `kimi answered without SOUND/UNSOUND: ${out.slice(0, 120)}` });
  });
}

function evidenceOf(p: MintPattern): string {
  const e = p.evidence[0];
  return e ? `[${e.target_lo}, ${e.target_hi}]` : '(unknown band)';
}

// ── the pass itself ─────────────────────────────────────────────────────────

function resolveRunDirs(): string[] {
  const one = opt('run');
  if (one) return [one];
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .filter(d => d.startsWith('cortex-plug-'))
    .map(d => join(RUNS_DIR, d));
}

async function main(): Promise<void> {
  const log = (s: string) => console.log(s);

  // rollback path: restore and exit
  if (flag('rollback')) {
    const current = loadGateBands(GATE_PATH) ?? defaultGateBands();
    const to = opt('rollback') ? Number(opt('rollback')) : undefined;
    const { file, record } = rollbackGateBands(current, to);
    writeGateBands(GATE_PATH, file);
    appendFileSync(LOG_PATH, '\n' + renderMintRecord(record) + '\n');
    log(`↩ rollback minted: gate now v${file.version}, bands restored from v${record.restored_from}`);
    log(renderMintRecord(record));
    return;
  }

  const runDirs = resolveRunDirs();
  if (!runDirs.length) { log('no run directories to scan — nothing to mint'); return; }

  const file: GateBandsFile = loadGateBands(GATE_PATH) ?? defaultGateBands();
  log(`╭─ THE MINT PASS — gate v${file.version} at ${GATE_PATH}`);
  log(`├─ scanning ${runDirs.length} run(s), min repeats ${MIN}${flag('no-kimi') ? ' · no judger' : ' · kimi judges the calls'}`);

  const scan = scanLedgers(runDirs);
  log(`├─ ledger: ${scan.linesRead} lines · ${scan.evidenceLines} evidence line(s) · ${scan.points.length} evidence point(s) across ${scan.runs.length} run(s)`);
  if (!scan.points.length) {
    log('╰─ no evidence in the ledger (v0.4 runs write `gate` evidence lines after each compose round) — nothing to mint, nothing faked');
    return;
  }

  const { patterns, skipped } = findMintPatterns(scan.points, file.bands, MIN);
  log(`├─ patterns: ${patterns.length} proposal(s) · ${skipped.length} skipped (conflicts)`);
  for (const p of patterns) {
    log(`│   • ${p.kind} ${p.channel}/${p.side}: edge ${p.adjustment.from} → ${p.adjustment.to} (${p.evidence_total} repeats${p.needsJudgment ? ', NEEDS JUDGMENT' : ''})`);
  }
  for (const s of skipped) log(`│   … skip ${s.channel}/${s.side}: ${s.conflict}`);

  if (!patterns.length) { log('╰─ no repeated verdict patterns — the seam stays the seam; pass recorded'); }

  const { file: next, record } = await applyMint({
    file, patterns, skipped, scan, minRepeats: MIN,
    judger: flag('no-kimi') ? undefined : kimiJudger,
  });

  if (flag('dry')) {
    log('╰─ DRY RUN — nothing written. What would land:');
    log(renderMintRecord(record));
    return;
  }

  if (record.applied.length) {
    writeGateBands(GATE_PATH, next);
    if (!existsSync(LOG_PATH)) writeFileSync(LOG_PATH, '# THE MINT LOG — every band the gate grew, and its evidence\n');
    appendFileSync(LOG_PATH, '\n' + renderMintRecord(record) + '\n');
    log(`├─ MINTED: gate v${next.version} — ${record.applied.length} band(s) moved`);
    log(`├─ mint log: ${LOG_PATH}`);
    log('╰─ reversible: npm run mint:bands -- --rollback');
  } else {
    log('╰─ nothing minted (proposals rejected or empty) — gate version unchanged');
    if (record.rejected.length || record.skipped.length) {
      log(renderMintRecord(record));
    }
  }
}

main().catch(e => { console.error(`✗ mint failed: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
