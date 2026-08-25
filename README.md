# cell-cascade

**The Differentiation Cascade — the stem-cell doctrine as running infrastructure.**

> "It could work on Cloudflare with workers in the background, and example
> decompositions could be saved from experiments that went well." — Casey

A model is a **stem cell**. Differentiation = **pruning** potential into scope,
not adding capability — every cell has the same DNA (the inherited character
sheet); the tier says how much of it is allowed to be expressed. The grown
musician is the model with most of itself deliberately silenced, and *the
silencing pattern lives in the sheet.*

Most of the organism never needs the full LLM expressed. Tendons express
collagen only. Cheap small specific tissue (reflex cells, cue firers, alarm
clocks) + the full model only at the germ line, the frontal cortex, and wound
healing.

This is a Cloudflare Worker + D1 database: organisms of cells, a signal
ledger (the connectome), myelination counters that **auto-promote repeated
paths into zero-cost rule tables**, fate decisions with provenance, wound
healing that recalls the lineage to totipotency, and a library of **saved
decompositions** — real experiments that went well, re-instantiable as live
organisms.

## The tier ladder

```
 totipotent ────► multipotent ────► differentiated ────► sclerotic
 full model        scoped model      committed fate        rule table only
 plasticity 1.0    0.6               0.3                   0.05
 cost 1.0          0.4               0.15                  0.0
 latency ~2s       ~800ms            ~300ms                ~1ms
 model call ✔      ✔                 ✔                     ✘  (pure lookup)
```

- **Differentiation flows DOWN only** (pruning). Upward movement is *wound
  healing's* job, never the gardener's.
- **Myelination**: a signal path that fires ≥ `MYELIN_THRESHOLD` (default 25)
  times with an error ratio under 5% **auto-promotes** its differentiated
  target to sclerotic — tendency becomes lookup, the model call disappears,
  a distillation event records the promotion.
- **A rule-table miss is scar tissue**: logged as an error signal; the answer
  is wound healing, not silent guessing.

## Endpoints

| method & path | what it does |
|---|---|
| `POST /organism {name}` | create organism + zygote (totipotent) |
| `GET /organisms` | list organisms |
| `POST /cell {organism, name, from_cell, role, tier?}` | **mitosis** — child inherits the sheet, new fate slot (`role`); optional `tier` = early differentiation |
| `GET /cells?organism=` / `GET /cells/{id}` | inspect cells, their signals, myelin paths, fate history, children |
| `POST /signal {from, to, kind, payload}` | log + **fire** — sclerotic targets answer deterministically from the rule table (cost 0, ~1ms); lower tiers defer to the model; myelin counters increment; **auto-promotion** when the path crosses threshold clean |
| `POST /cells/{id}/distill {to_tier, evidence_ref, gardener_verdict}` | explicit fate decision — downward only, **provenance required** |
| `GET /organism/{name}/health` | tier balance, % totipotent load, % zero-cost serve, sclerosis warnings, myelin hot paths |
| `POST /wound {cell_id}` | **wound healing** — retire the wounded cell, recall the lineage to the nearest totipotent ancestor WITH its sheet, grow a multipotent blastema carrying the wounded fate; dedifferentiates the root if no totipotent remains |
| `GET /examples` · `POST /examples` · `POST /examples/{id}/instantiate` | the saved-decomposition library |

`GET /` lists the contract; `GET /health` is liveness.

## Deploy

```bash
npm install
npm run db:create          # wrangler d1 create cell-cascade-db
# paste the printed database_id into wrangler.jsonc
npm run db:migrate:remote  # apply schema.sql
npm run deploy             # wrangler deploy
npm run seed               # WORKER_URL=https://cell-cascade.<subdomain>.workers.dev
```

Local: `npm run db:migrate:local && npm run dev` then `npm run seed`
(defaults to `http://localhost:8787`).

Optional: set `MYELIN_THRESHOLD` as a Worker var to demo faster promotion.

## The seeded examples (real experiments, 2026-08-25)

`npm run seed` loads `examples/seed.json` — each row lands in the `examples`
table **and** instantiates as a live organism with cells, myelin counters
from today's sessions, and distillation provenance:

- **`unheard-duke`** (*gan-rounds*) — totipotent GLM-5.3 → differentiated
  Duke-pianist cell. Sheet = the R3 verdict numbers (velocity_std 0.113→0.200,
  per-bar velstd 0.13–0.26, 116 notes 37–105, swing 66% observed) plus the
  surviving tendencies the critic could no longer wound. Evidence:
  `duke-lab-r3/REPORT.md`.
- **`band-clock`** (*sclerotic-tissue*) — the DO alarm clock as sclerotic
  tissue: rule table = the schedule math (absolute deadlines
  `startMs + N·barMs`, 2500ms bars, catch-up drain), 269/269 boundaries
  fired, worst drift 1ms, zero model calls. Evidence: `BAND_SKELETON.md`.
- **`cue-tokens`** (*myelinated-reflex*) — the Prefix Law as myelin: nod →
  ROGER, trade → WILCO (gated on echo parity), cut/break. The nod path
  myelinated after 34 clean fires and sclerosed; the trade path carries one
  error (the founding defect, bar-13/14) so the error-ratio guard correctly
  holds it differentiated. Evidence: `radio-cue-amendment.md` (A001).
- **`seamstress-eye`** (*multipotent-critic*) — the eye as a multipotent
  cell: the frozen 6-feature gate (note_density, syncopation,
  register_spread, rest_ratio, harmonic_tension, interval_size), Gate 1
  GATE-PASS with the distance curve 7.14σ → 1.69σ — the take landed *inside*
  the canon neighborhood. Evidence: `GATE1-REPORT.md`.

## Add YOUR OWN decomposition

When an experiment goes well, save it:

1. **Append to `examples/seed.json`** (or POST directly to `/examples`):

```json
{
  "id": "your-experiment",
  "name": "Human name for it",
  "kind": "gan-rounds | sclerotic-tissue | myelinated-reflex | multipotent-critic | your-archetype",
  "description": "What was pruned into what, and why it went well.",
  "evidence_ref": "path/to/REPORT.md — no provenance, no example",
  "seed": {
    "organism": "your-experiment",
    "cells": [
      { "id": "zygote", "name": "the germ line", "tier": "totipotent",
        "role": "full model + seed", "sheet": { "model": "..." } },
      { "id": "tissue", "name": "the committed cell", "from": "zygote",
        "tier": "differentiated", "role": "its fate",
        "sheet": { "the numbers that survived the critic": "..." } }
    ],
    "myelin": [
      { "from": "zygote", "to": "tissue", "kind": "signal-kind",
        "fire_count": 34, "error_count": 0, "tier_promoted_to": null }
    ],
    "distillations": [
      { "cell": "tissue", "from_tier": "totipotent", "to_tier": "differentiated",
        "evidence_ref": "path/to/REPORT.md",
        "gardener_verdict": "one line: why this fate, on this evidence" }
    ]
  }
}
```

2. Rules of the format: exactly one cell without `from` (the zygote); tier
   transitions flow down the ladder; sclerotic cells need `sheet.rules`
   (`[{when: {kind, payload_equals?}, respond: {...}}, ...]` — first match
   wins, deterministic); every distillation needs an `evidence_ref`.
3. `npm run seed` — the validator rejects anything that would corrupt the
   library, then the example instantiates as a live organism.

The seed tests (`npm test`) pin all four seeded examples to their real
numbers — if the evidence drifts, the build says so.

## Tests

```bash
npm test         # node:test via tsx — ladder, myelin math, rule table,
                 # lineage/wound healing, health metrics, seed validation
npm run typecheck
```

## Where this points

The quilt is the **neural inter-connector** — axons connect, they don't
store. Myelination is reflex promotion: repeated signal paths get faster and
cheaper until they need no model at all. The frontal cortex appears *last*,
because by then the spine already executes. The paper: the differentiation
cascade is how you grow an organism out of one model without ever losing the
DNA — every cell can still, in principle, become anything; most of them just
never need to.

Design doc: `OpenConstruct/docs/differentiation-cascade-draft.md` (in
flight). Doctrine: workspace memory 2026-08-25, "THE STEM-CELL DOCTRINE."
