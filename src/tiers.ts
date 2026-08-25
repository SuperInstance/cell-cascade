// cell-cascade — src/tiers.ts
// The tier ladder. Differentiation = PRUNING potential into scope, not adding
// capability. Every cell has the same DNA (the inherited sheet); the tier says
// how much of it may be expressed. Down the ladder = cheaper, faster, narrower.

export const TIERS = ['totipotent', 'multipotent', 'differentiated', 'sclerotic'] as const;
export type Tier = (typeof TIERS)[number];

export interface TierProfile {
  plasticity: number;      // how much fate can still change
  cost_per_call: number;   // relative model cost (0 = no model call at all)
  latency_ms: number;      // expected response latency
  model_call: boolean;     // does firing this cell need the full LLM expressed?
  note: string;
}

export const TIER_PROFILE: Record<Tier, TierProfile> = {
  totipotent: {
    plasticity: 1.0, cost_per_call: 1.0, latency_ms: 2000, model_call: true,
    note: 'full model + seed — can become anything (germ line, wound healing)',
  },
  multipotent: {
    plasticity: 0.6, cost_per_call: 0.4, latency_ms: 800, model_call: true,
    note: 'scoped model — a tissue family, not the whole organism (the eye, planners)',
  },
  differentiated: {
    plasticity: 0.3, cost_per_call: 0.15, latency_ms: 300, model_call: true,
    note: 'committed fate — sheet carries the tendency, model still consulted',
  },
  sclerotic: {
    plasticity: 0.05, cost_per_call: 0.0, latency_ms: 1, model_call: false,
    note: 'rule table only — deterministic lookup, no model call, tendons express collagen',
  },
};

export function isTier(x: unknown): x is Tier {
  return typeof x === 'string' && (TIERS as readonly string[]).includes(x);
}

export function tierIndex(t: Tier): number {
  return TIERS.indexOf(t);
}

/** Fate decisions only flow DOWN the ladder (differentiation = pruning).
 *  Any strictly-downward step is a legal distillation. Upward movement is
 *  wound healing's job, not the gardener's. */
export function canDistill(from: Tier, to: Tier): boolean {
  return tierIndex(to) > tierIndex(from);
}
