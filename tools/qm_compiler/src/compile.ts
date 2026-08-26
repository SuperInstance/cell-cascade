// qm-compiler — src/compile.ts
// Compile cell-cascade organisms (cells + sheets + myelin signal paths) into
// quilt-VM programs (.qm): a flat list of the 5 opcodes plus declared views.
//
// OPCODE MAPPING
//   BIND   one thing per cell:
//            <cell>          = tier facts + sheet facts minus rules
//                               (the "golden residue stays in the sheet")
//            <cell>:response = null (the rule-table output slot)
//            <cell>:rules    = { count, ordered ids } (compile-time fact)
//   LINK    every myelin signal path (from --signal:<kind>--> to) and every
//           lineage edge (<cell> --lineage--> parent). Dangling signal link
//           (endpoint cell absent from the organism) = LINK-TIME ERROR.
//   EFFECT  every rule {when, respond} -> a guarded effect on <cell>:response.
//           guard = { kind?, payload_equals? }; semantics identical to
//           cascade.ts matchRule: kind equality + subset payload match via
//           canonical JSON, FIRST MATCH WINS in sheet order.
//   VIEW    declared projections: 'response' (current rule-table output),
//           'facts' (bound sheet facts), 'health' (tier + serve stats).
//   TICK    step semantics: signal -> queued EFFECT applied on next TICK,
//           exactly the VM's pending_effects drain.

export interface Rule {
  when: { kind?: string; payload_equals?: Record<string, unknown> };
  respond: Record<string, unknown>;
}

export interface Sheet {
  rules?: Rule[];
  [k: string]: unknown;
}

export interface SeedCell {
  id: string;
  name: string;
  tier: string;
  role?: string;
  from?: string;
  sheet?: Sheet;
  cost_per_call?: number;
  latency_ms?: number;
  plasticity?: number;
}

export interface SeedMyelin {
  from: string;
  to: string;
  kind: string;
  fire_count?: number;
  error_count?: number;
  tier_promoted_to?: string | null;
}

export interface OrganismSeed {
  organism: string;
  cells: SeedCell[];
  myelin?: SeedMyelin[];
}

// ── the .qm program format ──────────────────────────────────────────────────

export type QmOp =
  | { op: 'bind'; target: string; value: unknown }
  | { op: 'link'; from: string; to: string; type: string }
  | { op: 'effect'; target: string; guard: { kind?: string; payload_equals?: Record<string, unknown> }; action: QmAction }
  | { op: 'view'; target: string; viewer: string; project: 'response' | 'facts' | 'health' };

export type QmAction =
  | { set: Record<string, unknown> }                                    // rule.respond verbatim
  | { expr: { op: 'sigma_distance'; features: string; centroid: string; sigma: string; onto: string } }; // gate math

export interface QmView { name: string; target: string; project: 'response' | 'facts' | 'health' }

export interface QmProgram {
  format: 'qm';
  version: 1;
  organism: string;
  ops: QmOp[];
  views: QmView[];
  /** signal routing compiled from myelin paths: kind -> target cell */
  routes: Record<string, string>;
}

export interface CompileError { code: 'DANGLING_LINK' | 'DUPLICATE_CELL' | 'RULE_NOT_OBJECT'; detail: string }

export const responseName = (cell: string) => `${cell}:response`;
export const factsName = (cell: string) => `${cell}:facts`;

/** Canonical JSON stringify (sorted keys at every level) so TS and the Rust
 *  runner agree on payload_equals subset matching. */
export function canonJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonJson).join(',') + ']';
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonJson(o[k])).join(',') + '}';
  }
  return JSON.stringify(v) ?? 'null';
}

/** Rule-table facts for a cell: sheet minus rules, plus tier facts. */
export function cellFacts(cell: SeedCell): Record<string, unknown> {
  const sheet = cell.sheet ?? {};
  const { rules, ...residue } = sheet;
  return {
    name: cell.name,
    tier: cell.tier,
    role: cell.role ?? null,
    cost_per_call: cell.cost_per_call ?? null,
    latency_ms: cell.latency_ms ?? null,
    plasticity: cell.plasticity ?? null,
    sheet_residue: residue, // the golden residue stays in the sheet
    rule_count: rules?.length ?? 0,
  };
}

/** Compile an organism seed into a .qm program. Dangling myelin links are
 *  link-time errors — a signal routed to a nonexistent cell never runs. */
export function compileOrganism(seed: OrganismSeed): { program: QmProgram; errors: CompileError[] } {
  const errors: CompileError[] = [];
  const ids = new Set<string>();
  for (const c of seed.cells) {
    if (ids.has(c.id)) errors.push({ code: 'DUPLICATE_CELL', detail: c.id });
    ids.add(c.id);
  }

  const ops: QmOp[] = [];
  const views: QmView[] = [];
  const routes: Record<string, string> = {};

  // BIND: facts + response slot per cell
  for (const c of seed.cells) {
    ops.push({ op: 'bind', target: c.id, value: cellFacts(c) });
    ops.push({ op: 'bind', target: factsName(c.id), value: cellFacts(c) });
    ops.push({ op: 'bind', target: responseName(c.id), value: null });
    views.push({ name: `${c.id}/facts`, target: factsName(c.id), project: 'facts' });
    views.push({ name: `${c.id}/response`, target: responseName(c.id), project: 'response' });
    views.push({ name: `${c.id}/health`, target: c.id, project: 'health' });
  }

  // LINK: lineage edges, then myelin signal paths (with dangling detection)
  for (const c of seed.cells) {
    if (c.from) {
      if (!ids.has(c.from)) {
        errors.push({ code: 'DANGLING_LINK', detail: `lineage: ${c.id} -> ${c.from} (parent not in organism)` });
      } else {
        ops.push({ op: 'link', from: c.id, to: c.from, type: 'lineage' });
      }
    }
  }
  for (const m of seed.myelin ?? []) {
    if (!ids.has(m.from) || !ids.has(m.to)) {
      errors.push({
        code: 'DANGLING_LINK',
        detail: `signal ${m.kind}: ${m.from} -> ${m.to} (${!ids.has(m.from) ? 'from' : 'to'} cell not in organism)`,
      });
      continue;
    }
    ops.push({ op: 'link', from: m.from, to: m.to, type: `signal:${m.kind}` });
    routes[m.kind] = m.to;
  }

  // EFFECT: rules -> guarded effects on the response slot (sheet order)
  for (const c of seed.cells) {
    for (const rule of c.sheet?.rules ?? []) {
      if (!rule || typeof rule !== 'object' || !rule.when) {
        errors.push({ code: 'RULE_NOT_OBJECT', detail: `${c.id}: malformed rule` });
        continue;
      }
      ops.push({
        op: 'effect',
        target: responseName(c.id),
        guard: { kind: rule.when.kind, payload_equals: rule.when.payload_equals },
        action: { set: rule.respond },
      });
    }
  }

  return { program: { format: 'qm', version: 1, organism: seed.organism, ops, views, routes }, errors };
}

/** Gate-math compilation for critic sheets (seamstress-eye): a guarded
 *  effect that computes the σ-normalized euclidean distance exactly as the
 *  sheet's method line describes. centroid/sigma are bound things, so the
 *  same math runs against any canon. */
export function compileGateMath(cellId: string, guard: { kind: string }): QmOp {
  return {
    op: 'effect',
    target: responseName(cellId),
    guard,
    action: {
      expr: {
        op: 'sigma_distance',
        features: 'payload.features',
        centroid: `${cellId}:canon_centroid`,
        sigma: `${cellId}:canon_sigma`,
        onto: responseName(cellId),
      },
    },
  };
}

// ── the reference interpreter (used by the TS-side equivalence harness) ──────
// Mirrors what the Rust runner does on the real quilt-vm. DO NOT import
// cascade.ts matchRule here — equivalence must be measured, not assumed.

export function sigmaDistance(features: number[], centroid: number[], sigma: number[]): number {
  let s = 0;
  for (let i = 0; i < features.length; i++) {
    const d = (features[i] - centroid[i]) / sigma[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export interface RefResult {
  to: string;
  kind: string;
  mode: 'table' | 'table-miss';
  response: unknown;
}

/** Serve one signal against a compiled program using the reference
 *  semantics: route by kind, first matching guard wins, subset match by
 *  canonical JSON, miss = scar tissue. */
export function refServe(program: QmProgram, sig: { from: string; kind: string; payload: Record<string, unknown> }): RefResult | null {
  const to = program.routes[sig.kind];
  if (!to) return null;
  const effects = program.ops.filter(
    (o) => o.op === 'effect' && o.target === responseName(to),
  ) as Extract<QmOp, { op: 'effect' }>[];
  for (const e of effects) {
    if (e.guard.kind !== undefined && e.guard.kind !== sig.kind) continue;
    if (e.guard.payload_equals !== undefined) {
      let ok = true;
      for (const [k, v] of Object.entries(e.guard.payload_equals)) {
        if (!(k in sig.payload) || canonJson(sig.payload[k]) !== canonJson(v)) { ok = false; break; }
      }
      if (!ok) continue;
    }
    if (e.action.set) return { to, kind: sig.kind, mode: 'table', response: e.action.set };
    if (e.action.expr && e.action.expr.op === 'sigma_distance') {
      // the bound centroid/sigma come from the program's bind ops
      const bind = program.ops.find((o) => o.op === 'bind' && o.target === e.action.expr!.centroid);
      const bindS = program.ops.find((o) => o.op === 'bind' && o.target === e.action.expr!.sigma);
      const c = (bind as { value: number[] }).value;
      const sg = (bindS as { value: number[] }).value;
      const f = sig.payload.features as number[];
      return { to, kind: sig.kind, mode: 'table', response: { sigma_distance: sigmaDistance(f, c, sg) } };
    }
  }
  return { to, kind: sig.kind, mode: 'table-miss', response: null };
}
