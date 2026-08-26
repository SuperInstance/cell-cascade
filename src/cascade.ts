// cell-cascade — src/cascade.ts
// The pure doctrine math: myelination/promotion, the deterministic rule
// table, lineage walks, wound healing plans, organism health. No I/O —
// everything here is testable without D1.

import { TIERS, TIER_PROFILE, tierIndex, type Tier } from './tiers';

// ── row shapes (as they come back from D1) ──────────────────────────────────

export interface CellRow {
  id: string;
  organism: string;
  name: string;
  tier: Tier;
  role: string;
  sheet_json: string;
  cost_per_call: number;
  latency_ms: number;
  plasticity: number;
  status: 'active' | 'retired';
  created_from: string | null;
  versions: number;
  created_at: number;
}

export interface MyelinRow {
  path_id: string;
  from_cell: string;
  to_cell: string;
  kind: string;
  fire_count: number;
  error_count: number;
  tier_promoted_to: string | null;
  last_fired: number | null;
}

export interface SignalRow {
  id: number;
  from_cell: string;
  to_cell: string;
  kind: string;
  payload: string | null;
  ok: number;
  mode: string | null;        // v0.2: HOW the signal was served (table|model|escalated|...)
  model_log: string | null;   // v0.2: JSON — tokens, latency, cost estimate, provenance
  escalated_from: string | null;
  at: number;
}

export function parseSheet(cell: CellRow): Record<string, unknown> {
  try { return JSON.parse(cell.sheet_json) as Record<string, unknown>; } catch { return {}; }
}

// ── myelination: repeated paths get faster/cheaper, then promote ─────────────

export const MYELIN_THRESHOLD_DEFAULT = 25;    // clean fires needed for auto-promotion
export const MAX_ERROR_RATIO_DEFAULT = 0.05;   // errors must stay under 5% of fires

export interface MyelinVerdict {
  promote: boolean;
  reason: string;
}

/** The auto-promotion gate: a differentiated cell whose signal path has fired
 *  `threshold` times with a clean-enough error ratio scleroses — the tendency
 *  becomes a lookup table, the model call disappears. */
export function shouldMyelinate(
  fire_count: number,
  error_count: number,
  threshold = MYELIN_THRESHOLD_DEFAULT,
  maxErrorRatio = MAX_ERROR_RATIO_DEFAULT,
): MyelinVerdict {
  if (fire_count < threshold) {
    return { promote: false, reason: `fires ${fire_count}/${threshold} — still myelinating` };
  }
  const allowed = fire_count * maxErrorRatio;
  if (error_count > allowed) {
    return {
      promote: false,
      reason: `error ratio too high: ${error_count} errors / ${fire_count} fires exceeds ${maxErrorRatio * 100}% — gardener review needed`,
    };
  }
  return {
    promote: true,
    reason: `myelinated: ${fire_count} fires, ${error_count} errors (<= ${allowed.toFixed(2)} allowed) — tendency promoted to rule table`,
  };
}

// ── the sclerotic rule table — deterministic, no model ───────────────────────

export interface Rule {
  when: { kind?: string; payload_equals?: Record<string, unknown> };
  respond: Record<string, unknown>;
}

export interface RuleMatch {
  hit: boolean;
  rule?: Rule;
  response?: Record<string, unknown>;
}

function subsetMatch(subset: Record<string, unknown>, obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false;
  const target = obj as Record<string, unknown>;
  for (const [k, v] of Object.entries(subset)) {
    if (!(k in target) || JSON.stringify(target[k]) !== JSON.stringify(v)) return false;
  }
  return true;
}

/** Fire a sclerotic cell: pure table lookup, first match wins, zero model
 *  cost, ~1ms. A miss is scar tissue — logged as an error signal, and the
 *  wound-healing path is the answer. */
export function matchRule(rules: Rule[], kind: string, payload: Record<string, unknown>): RuleMatch {
  for (const rule of rules) {
    if (rule.when.kind !== undefined && rule.when.kind !== kind) continue;
    if (rule.when.payload_equals !== undefined && !subsetMatch(rule.when.payload_equals, payload)) continue;
    return { hit: true, rule, response: rule.respond };
  }
  return { hit: false };
}

// ── lineage & wound healing ──────────────────────────────────────────────────

/** Walk a cell's ancestry rootward: [cell, parent, grandparent, ..., zygote]. */
export function lineageOf(cellId: string, parentOf: Map<string, string | null>): string[] {
  const chain: string[] = [];
  let cur: string | null = cellId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return chain;
}

export type HealPlan =
  | { kind: 'self-heal'; wounded: CellRow }
  | { kind: 'recall'; wounded: CellRow; ancestor: CellRow; dedifferentiated: boolean }
  | { kind: 'hopeless'; wounded: CellRow; reason: string };

/** Wound healing: reactivate the lineage to the nearest TOTIPOTENT ancestor
 *  WITH its sheet (the ancestor never lost the DNA). If no totipotent remains,
 *  the lineage root is dedifferentiated back to totipotent — stemness is
 *  recalled on demand. A wound on totipotent tissue self-heals. */
export function healPlan(wounded: CellRow, cellsById: Map<string, CellRow>): HealPlan {
  if (wounded.status !== 'active') {
    return { kind: 'hopeless', wounded, reason: `cell already ${wounded.status}` };
  }
  if (wounded.tier === 'totipotent') {
    return { kind: 'self-heal', wounded };
  }
  const parentOf = new Map([...cellsById.values()].map(c => [c.id, c.created_from] as const));
  for (const id of lineageOf(wounded.id, parentOf).slice(1)) {
    const ancestor = cellsById.get(id);
    if (!ancestor || ancestor.status !== 'active') continue;
    if (ancestor.tier === 'totipotent') {
      return { kind: 'recall', wounded, ancestor, dedifferentiated: false };
    }
  }
  // No totipotent left in the lineage: recall the root.
  const rootId = lineageOf(wounded.id, parentOf).at(-1)!;
  const root = cellsById.get(rootId);
  if (!root || root.status !== 'active') {
    return { kind: 'hopeless', wounded, reason: 'lineage root is not active — organism beyond healing' };
  }
  return { kind: 'recall', wounded, ancestor: root, dedifferentiated: true };
}

// ── organism health ──────────────────────────────────────────────────────────

export interface HealthSnapshot {
  organism: string;
  cells_total: number;
  cells_active: number;
  tier_counts: Record<Tier, number>;
  tier_pct: Record<Tier, number>;
  totipotent_load_pct: number;       // % of recent signals landing on full-model cells (the expensive lane)
  zero_cost_serve_pct: number;       // % of recent signals served with no model call (sclerotic tissue)
  serve_modes_pct: Record<string, number>;   // v0.2: model | table | escalated | model_required | error
  totipotent_serve_pct: number;      // v0.2: model calls to totipotent targets + escalations
  cost_tumor: {
    threshold_pct: number;
    totipotent_serve_pct: number;
    window: number;
    warning: boolean;
    note: string;
  };
  avg_cost_per_call: number;         // mean across ACTIVE cells
  myelin_paths: number;
  sclerosis_warnings: Array<{ cell_id: string; name: string; tier: Tier; note: string }>;
  hot_paths: Array<{ path_id: string; fire_count: number; error_count: number }>;
}

export const COST_TUMOR_THRESHOLD_PCT = 5; // the cancer metric: >5% germ-line serving = tumor

/** How a signal was served — explicit mode when present (v0.2), inferred
 *  from tier/ok for v0.1 legacy rows. */
export function inferServeMode(s: Pick<SignalRow, 'ok' | 'mode'>, targetTier: Tier): string {
  if (s.mode) return s.mode;
  if (s.ok === 0) return 'table-miss';
  return targetTier === 'sclerotic' ? 'table' : 'model_required';
}

function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

export function healthSnapshot(
  organism: string,
  cells: CellRow[],
  myelin: MyelinRow[],
  signals: SignalRow[],
  threshold = MYELIN_THRESHOLD_DEFAULT,
): HealthSnapshot {
  const active = cells.filter(c => c.status === 'active');
  const tier_counts = { totipotent: 0, multipotent: 0, differentiated: 0, sclerotic: 0 } as Record<Tier, number>;
  for (const c of active) tier_counts[c.tier]++;
  const tier_pct = { ...tier_counts };
  for (const t of TIERS) {
    tier_pct[t] = active.length ? Math.round((tier_counts[t] / active.length) * 1000) / 10 : 0;
  }

  const byId = new Map(cells.map(c => [c.id, c] as const));
  let toTip = 0, toZero = 0, total = 0;
  const modeCounts: Record<string, number> = {
    model: 0, table: 0, escalated: 0, model_required: 0, error: 0,
  };
  let germServing = 0; // model calls landing on totipotent targets + escalations
  for (const s of signals) {
    const target = byId.get(s.to_cell);
    if (!target) continue;
    total++;
    if (target.tier === 'totipotent') toTip++;
    if (!TIER_PROFILE[target.tier].model_call) toZero++;
    const m = inferServeMode(s, target.tier);
    if (m in modeCounts) modeCounts[m]++;
    else if (m === 'table-miss' || m === 'model-error' || m === 'escalation-failed') modeCounts.error++;
    if (m === 'model' && target.tier === 'totipotent') germServing++;
    if (m === 'escalated') germServing++;
  }
  const serve_modes_pct: Record<string, number> = {};
  for (const [k, v] of Object.entries(modeCounts)) serve_modes_pct[k] = pct(v, total);
  const totipotent_serve_pct = pct(germServing, total);
  const cost_tumor = {
    threshold_pct: COST_TUMOR_THRESHOLD_PCT,
    totipotent_serve_pct,
    window: total,
    warning: total > 0 && totipotent_serve_pct > COST_TUMOR_THRESHOLD_PCT,
    note: total === 0
      ? 'no recent signals — nothing to watch'
      : totipotent_serve_pct > COST_TUMOR_THRESHOLD_PCT
        ? `COST TUMOR: the germ line served ${totipotent_serve_pct}% of the last ${total} signals (> ${COST_TUMOR_THRESHOLD_PCT}%) — the organism is leaning on its stem cells; differentiate dedicated tissue or grow rule tables from distillation candidates`
        : `healthy: germ line served ${totipotent_serve_pct}% of the last ${total} signals (<= ${COST_TUMOR_THRESHOLD_PCT}%)`,
  };

  const myelinByTarget = new Map<string, MyelinRow[]>();
  for (const m of myelin) {
    const arr = myelinByTarget.get(m.to_cell) ?? [];
    arr.push(m);
    myelinByTarget.set(m.to_cell, arr);
  }
  const sclerosis_warnings: HealthSnapshot['sclerosis_warnings'] = [];
  for (const c of active) {
    const paths = myelinByTarget.get(c.id) ?? [];
    const fires = paths.reduce((a, m) => a + m.fire_count, 0);
    const errors = paths.reduce((a, m) => a + m.error_count, 0);
    if (c.tier === 'differentiated' && fires >= 0.6 * threshold) {
      const v = shouldMyelinate(fires, errors, threshold);
      sclerosis_warnings.push({
        cell_id: c.id, name: c.name, tier: c.tier,
        note: v.promote
          ? `ready to sclerose: ${fires} fires, ${errors} errors — ${v.reason}`
          : `approaching threshold (${fires}/${threshold} fires, ${errors} errors): ${v.reason}`,
      });
    }
    if (c.tier === 'sclerotic' && errors > 0) {
      sclerosis_warnings.push({
        cell_id: c.id, name: c.name, tier: c.tier,
        note: `scar tissue: ${errors} rule-table miss(es) — wound-heal or extend the table`,
      });
    }
    if (c.tier === 'totipotent' && fires > threshold * 2) {
      sclerosis_warnings.push({
        cell_id: c.id, name: c.name, tier: c.tier,
        note: `germ line carrying routine load (${fires} fires) — differentiate dedicated tissue`,
      });
    }
  }

  const hot_paths = [...myelin]
    .sort((a, b) => b.fire_count - a.fire_count)
    .slice(0, 5)
    .map(m => ({ path_id: m.path_id, fire_count: m.fire_count, error_count: m.error_count }));

  return {
    organism,
    cells_total: cells.length,
    cells_active: active.length,
    tier_counts,
    tier_pct,
    totipotent_load_pct: pct(toTip, total),
    zero_cost_serve_pct: pct(toZero, total),
    serve_modes_pct,
    totipotent_serve_pct,
    cost_tumor,
    avg_cost_per_call: active.length
      ? Math.round((active.reduce((a, c) => a + c.cost_per_call, 0) / active.length) * 1000) / 1000
      : 0,
    myelin_paths: myelin.length,
    sclerosis_warnings,
    hot_paths,
  };
}

// ── tier ladder sanity (kept here so tests can assert the doctrine) ─────────

export function ladderWidestGap(): [Tier, Tier] {
  return [TIERS[0], TIERS[tierIndex('sclerotic')]];
}
