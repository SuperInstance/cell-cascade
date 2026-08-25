// cell-cascade — src/example.ts
// The saved decompositions: experiments that went well, stored as
// re-instantiable organisms. This module defines the seed format and a
// strict validator shared by the worker (POST /examples), the tests, and
// scripts/seed.ts.

import { isTier, type Tier } from './tiers';
import type { Rule } from './cascade';

export interface SeedCell {
  id: string;                 // local id; instantiated as "{organism}:{id}"
  name: string;
  tier: Tier;
  role: string;
  from?: string;              // local parent id; omitted = zygote
  sheet: Record<string, unknown>;  // must contain `rules: Rule[]` when tier is sclerotic
  cost_per_call?: number;
  latency_ms?: number;
  plasticity?: number;
}

export interface SeedMyelin {
  from: string;               // local cell id
  to: string;
  kind: string;
  fire_count: number;
  error_count?: number;
  tier_promoted_to?: string | null;
}

export interface SeedDistillation {
  cell: string;               // local cell id
  from_tier: Tier;
  to_tier: Tier;
  evidence_ref: string;
  gardener_verdict: string;
}

export interface ExampleSeed {
  organism: string;           // default organism name at instantiation
  cells: SeedCell[];          // exactly one cell must omit `from` (the zygote)
  myelin?: SeedMyelin[];
  distillations?: SeedDistillation[];
}

export interface Example {
  id: string;
  name: string;
  kind: string;
  description: string;
  evidence_ref: string;
  seed: ExampleSeed;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateExample(ex: unknown): ValidationResult {
  const errors: string[] = [];
  const e = ex as Partial<Example>;
  if (typeof e.id !== 'string' || !e.id) errors.push('id: required string');
  if (typeof e.name !== 'string' || !e.name) errors.push('name: required string');
  if (typeof e.kind !== 'string' || !e.kind) errors.push('kind: required string (decomposition archetype)');
  if (typeof e.description !== 'string' || !e.description) errors.push('description: required string');
  if (typeof e.evidence_ref !== 'string' || !e.evidence_ref) errors.push('evidence_ref: required string — no provenance, no example');
  const s = e.seed as Partial<ExampleSeed> | undefined;
  if (!s || typeof s !== 'object') {
    errors.push('seed: required object');
    return { ok: false, errors };
  }
  if (typeof s.organism !== 'string' || !s.organism) errors.push('seed.organism: required string');
  if (!Array.isArray(s.cells) || s.cells.length === 0) {
    errors.push('seed.cells: required non-empty array');
    return { ok: false, errors };
  }

  const ids = new Set<string>();
  let zygotes = 0;
  for (const [i, c] of (s.cells as SeedCell[]).entries()) {
    const where = `seed.cells[${i}]`;
    if (typeof c.id !== 'string' || !c.id) { errors.push(`${where}.id: required string`); continue; }
    if (ids.has(c.id)) errors.push(`${where}.id: duplicate "${c.id}"`);
    ids.add(c.id);
    if (typeof c.name !== 'string' || !c.name) errors.push(`${where}.name: required string`);
    if (!isTier(c.tier)) errors.push(`${where}.tier: must be totipotent|multipotent|differentiated|sclerotic`);
    if (c.from === undefined) zygotes++;
    else if (!Array.isArray(s.cells) || !s.cells.some(x => x.id === c.from)) {
      errors.push(`${where}.from: "${String(c.from)}" is not a local cell id`);
    }
    if (!c.sheet || typeof c.sheet !== 'object') {
      errors.push(`${where}.sheet: required object`);
    } else if (c.tier === 'sclerotic') {
      const rules = (c.sheet as Record<string, unknown>).rules;
      if (!Array.isArray(rules) || rules.length === 0) {
        errors.push(`${where}.sheet.rules: sclerotic cells need a non-empty rule table`);
      } else {
        for (const [j, r] of (rules as Rule[]).entries()) {
          if (!r || typeof r !== 'object' || !r.when || !r.respond) {
            errors.push(`${where}.sheet.rules[${j}]: needs {when, respond}`);
          }
        }
      }
    }
  }
  if (zygotes !== 1) errors.push(`seed.cells: exactly one zygote expected (cell without "from"), found ${zygotes}`);

  if (s.myelin !== undefined) {
    if (!Array.isArray(s.myelin)) errors.push('seed.myelin: must be an array');
    else for (const [i, m] of (s.myelin as SeedMyelin[]).entries()) {
      const where = `seed.myelin[${i}]`;
      if (!ids.has(m.from ?? '')) errors.push(`${where}.from: "${String(m.from)}" is not a local cell id`);
      if (!ids.has(m.to ?? '')) errors.push(`${where}.to: "${String(m.to)}" is not a local cell id`);
      if (typeof m.kind !== 'string' || !m.kind) errors.push(`${where}.kind: required string`);
      if (typeof m.fire_count !== 'number' || m.fire_count < 0) errors.push(`${where}.fire_count: required number >= 0`);
      if ((m.error_count ?? 0) < 0) errors.push(`${where}.error_count: must be >= 0`);
    }
  }

  if (s.distillations !== undefined) {
    if (!Array.isArray(s.distillations)) errors.push('seed.distillations: must be an array');
    else for (const [i, d] of (s.distillations as SeedDistillation[]).entries()) {
      const where = `seed.distillations[${i}]`;
      if (!ids.has(d.cell ?? '')) errors.push(`${where}.cell: "${String(d.cell)}" is not a local cell id`);
      if (!isTier(d.from_tier)) errors.push(`${where}.from_tier: invalid tier`);
      if (!isTier(d.to_tier)) errors.push(`${where}.to_tier: invalid tier`);
      if (typeof d.evidence_ref !== 'string' || !d.evidence_ref) errors.push(`${where}.evidence_ref: required string`);
      if (typeof d.gardener_verdict !== 'string' || !d.gardener_verdict) errors.push(`${where}.gardener_verdict: required string`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function parseExampleFile(text: string): { examples: Example[]; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { examples: [], errors: [`invalid JSON: ${(err as Error).message}`] };
  }
  const arr = Array.isArray(raw) ? raw : (raw as { examples?: unknown })?.examples;
  if (!Array.isArray(arr)) return { examples: [], errors: ['expected a JSON array (or {examples: []})'] };
  const examples: Example[] = [];
  const errors: string[] = [];
  for (const [i, ex] of arr.entries()) {
    const v = validateExample(ex);
    if (v.ok) examples.push(ex as Example);
    else errors.push(`example[${i}]: ${v.errors.join('; ')}`);
  }
  return { examples, errors };
}
