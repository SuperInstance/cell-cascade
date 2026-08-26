// cell-cascade — scripts/export_gate_qm.ts
// MINT-TO-METAL EXPORT (reflex-arc lane, 2026-08-26). The frozen gate's
// bands live in gate/gate-bands.json — a decimal artifact the mint grew.
// This exporter mints them into a blink-style .qm program whose every
// number is an INTEGER micro-unit (1 µ = 1e-6), so the ESP32-S3 side can
// judge with zero floating point anywhere on the target.
//
//   npm run export:gateqm [-- --out ../quilt-esp32/firmware/critic-gate.qm]
//
// NUMBER FORMAT — micro-units, not Q16.16 (the documented better choice):
//   Every number the gate sees is decimal by construction. The ear rounds
//   features to 6 places (plainsong _round), the bands are 3-decimal
//   (the mint moved an edge to 0.763), the gray zone is 0.06. On the 10⁻⁶
//   grid all of these are EXACT as signed 32-bit integers (max value
//   1.6 = 1,600,000 µ, comfortably inside int32). Q16.16 cannot represent
//   0.06 or 0.763 (not dyadic): band edges would carry ±2.4e-6 rounding
//   error and desktop↔metal comparisons could flip at the edge. Micro-
//   units make the export bit-exact against the desktop's decimal floats
//   by design — the replay proves it empirically.
//
// PROVENANCE: the sha256 of gate-bands.json's exact bytes is baked into
// the artifact AND printed by the firmware at boot — the mint's receipt
// on metal. A re-minted gate produces a different sha; the board refuses
// to pretend it is running bands it has not received.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  CRITIC_FEATURES, AMBIGUITY_BAND,
  type CriticChannel,
} from '../src/critic';
import { loadGateBands } from '../src/mint';

/** Fixed-point scale: 1 unit = 10⁻⁶. Documented above — decimal grid. */
export const GATE_QM_SCALE = 1_000_000;
/** Warn/bad penalties and the revise threshold in µ (0.4 / 1.0 — exact on
 *  the 10⁻⁶ grid, and float accumulation of these on desktop (0.4+0.4=0.8,
 *  0.4×3=1.2000000000000002) crosses the threshold 1 identically to the
 *  integer sums — verified by the replay, not assumed. */
export const PENALTY_WARN_U = 400_000;
export const PENALTY_BAD_U = 1_000_000;
export const REVISE_THRESHOLD_U = 1_000_000;
/** Dissent epsilon (stretch seed, Claude): readings within this of a band
 *  edge are flagged for the escalation ledger — the seam's embryo. */
export const DISSENT_EPSILON_U = 20_000;

/** Decimal value → exact micro-unit integer. The input is always a short
 *  decimal (≤6 places), so scaling by 10⁶ and rounding is exact. */
export function toMicro(v: number): number {
  if (!Number.isFinite(v)) throw new Error(`not a finite number: ${v}`);
  const u = Math.round(v * GATE_QM_SCALE);
  // round-trip guard: the µ integer must represent v exactly (to float
  // noise). A 7th decimal (0.1234567) or an irrational (1/3) fails here —
  // the exporter refuses to mint numbers the metal grid cannot carry.
  if (Math.abs(u / GATE_QM_SCALE - v) > 1e-9) throw new Error(`off the µ grid: ${v}`);
  return u;
}

export interface GateQmOptions {
  /** path to gate-bands.json (default gate/gate-bands.json) */
  gatePath?: string;
  /** output .qm path */
  out?: string;
}

/** Mint the standing bands into a blink-style .qm (data-only artifact —
 *  the metal side compiles this into C tables; the judge stays dedicated
 *  fixed-point C, the VM's frozen sigma_distance expr is float and stays
 *  out of the numeric path by format-freeze doctrine). */
export function exportGateQm(opts: GateQmOptions = {}): {
  outPath: string;
  sha256: string;
  gateVersion: number;
  channels: Array<{ name: CriticChannel; lo: number; hi: number }>;
} {
  const gatePath = resolve(opts.gatePath ?? 'gate/gate-bands.json');
  const gateBytes = readFileSync(gatePath);
  const sha256 = createHash('sha256').update(gateBytes).digest('hex');
  const gateFile = loadGateBands(gatePath);
  if (!gateFile) throw new Error(`gate bands not loadable: ${gatePath}`);

  const channels = CRITIC_FEATURES.map((name) => {
    const b = gateFile.bands[name];
    if (!b) throw new Error(`gate-bands.json v${gateFile.version} is missing channel ${name}`);
    return { name, lo: toMicro(b.lo), hi: toMicro(b.hi) };
  });

  const ambiguityU = toMicro(AMBIGUITY_BAND);
  const facts = {
    gate_version: gateFile.version,
    source: 'gate/gate-bands.json',
    source_sha256: sha256,
    exported_at: new Date().toISOString(),
    fixed_point: {
      format: 'micro-units: signed 32-bit integers, 1 unit = 1e-6',
      scale: GATE_QM_SCALE,
      why_not_q16_16: 'bands and the gray zone are decimal (0.06, 0.763) — exact on the 1e-6 grid, inexact in Q16.16 (±2.4e-6 at the edges)',
      ambiguity_band: ambiguityU,
      penalty: { ok: 0, warn: PENALTY_WARN_U, bad: PENALTY_BAD_U },
      revise_threshold: REVISE_THRESHOLD_U,
      dissent_epsilon: DISSENT_EPSILON_U,
    },
    channel_order: channels.map(c => c.name),
    channels: channels.map(c => ({ name: c.name, lo: c.lo, hi: c.hi })),
    severity_rules: [
      'bad:  v < lo - ambiguity_band or v > hi + ambiguity_band',
      'warn: else v < lo or v > hi   (the gray zone — seam territory)',
      'ok:   lo <= v <= hi',
    ],
    scope: '6-channel band gate only; voice-leading / tension-curve / arc checks are desktop cross-bar tissue and stay off-metal (pre-registered)',
  };

  const rootFacts = {
    name: 'critic-root', tier: 'totipotent',
    role: 'minimal spine — no rules, escalation target of record',
    rule_count: 0,
  };
  const gateCell = {
    name: 'critic-gate', tier: 'sclerotic',
    role: 'the frozen ear — 6-channel band gate, integer micro-units, cost 0',
    cost_per_call: 0, latency_ns: 0, rule_count: channels.length,
  };

  const prog = {
    format: 'qm',
    version: 1,
    organism: 'critic-gate',
    ops: [
      { op: 'bind', target: 'critic-root', value: rootFacts },
      { op: 'bind', target: 'critic-root:facts', value: rootFacts },
      { op: 'bind', target: 'critic-root:response', value: null },
      { op: 'bind', target: 'critic-gate', value: gateCell },
      { op: 'bind', target: 'critic-gate:facts', value: facts },
      { op: 'bind', target: 'critic-gate:response', value: null },
      { op: 'link', from: 'critic-gate', to: 'critic-root', type: 'lineage' },
    ],
    views: [
      { name: 'critic-gate/facts', target: 'critic-gate:facts', project: 'facts' },
      { name: 'critic-gate/response', target: 'critic-gate:response', project: 'response' },
      { name: 'critic-root/response', target: 'critic-root:response', project: 'response' },
    ],
    routes: { critique: 'critic-gate' },
    // honest: the model seam (gray-zone adjudication) is NOT on metal —
    // the gate flags gray/dissent; escalation stays a desktop concern.
    escalations: {},
  };

  const outPath = resolve(opts.out ?? 'gate/critic-gate.qm');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(prog, null, 2) + '\n', 'utf8');
  return { outPath, sha256, gateVersion: gateFile.version, channels };
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const gatePath = args.includes('--gate') ? args[args.indexOf('--gate') + 1] : undefined;
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
  const r = exportGateQm({ gatePath, out });
  console.log(`critic-gate.qm ← gate-bands.json v${r.gateVersion}`);
  console.log(`  sha256 ${r.sha256}`);
  console.log(`  channels (µ): ${r.channels.map(c => `${c.name}[${c.lo}, ${c.hi}]`).join(' ')}`);
  console.log(`  wrote ${r.outPath}`);
}
