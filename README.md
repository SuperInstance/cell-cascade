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
| `POST /signal {from, to, kind, payload}` | log + **fire** — sclerotic targets answer deterministically from the rule table (cost 0, ~1ms); totipotent/multipotent/differentiated targets **think through the model seam** when sheet config + worker env are both present (tokens/latency/cost logged on the signal); differentiated rule-table misses **escalate UP** to the germ line; myelin counters increment; **auto-promotion** when the path crosses threshold clean |
| `POST /cells/{id}/distill {to_tier, evidence_ref, gardener_verdict}` | explicit fate decision — downward only, **provenance required** |
| `GET /organism/{name}/health` | tier balance, % totipotent load, % zero-cost serve, **serve-mode split (model / table / escalated / deferred / error)**, **cost-tumor watch** (warns when germ-line serving > 5%), sclerosis warnings, myelin hot paths |
| `POST /wound {cell_id}` | **wound healing** — retire the wounded cell, recall the lineage to the nearest totipotent ancestor WITH its sheet, grow a multipotent blastema carrying the wounded fate; dedifferentiates the root if no totipotent remains |
| `GET /organism/{name}/candidates` | **the escalation ledger (v0.2)** — every rule-table miss the germ line successfully covered, recorded as a distillation candidate: the hole's kind, payload shape, question, and the answer that should become a rule |
| `POST /candidates/{id}/resolve {status, rule?, evidence_ref, gardener_verdict}` | **grow the table** — distill a candidate into a deterministic rule appended to the cell's sheet (provenance required); the next signal of that kind hits the table at cost 0 |
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

Upgrading a v0.1 database to v0.2 (signals mode/model_log columns + the
distillation_candidates table):

```bash
wrangler d1 execute cell-cascade-db --remote --file migrations/2026-08-25-v0.2-model-seam.sql
```

### The model seam (v0.2) — letting totipotent tissue actually think

The v0.1 honest gap: signals to non-sclerotic cells returned
`model-call-required`. v0.2 closes it **gated and observable**:

1. **Cell sheets carry model config** — `{ model: { provider, model, system_prompt, max_tokens?, temperature? } }`
   (provider is informational; the v0.2 contract is any openai-compatible
   `/chat/completions` endpoint).
2. **The worker carries the keys as secrets** (the fleet pattern):

```bash
wrangler secret put MODEL_BASE_URL      # e.g. https://api.deepseek.com  or  https://api.z.ai/api/coding/paas/v4
wrangler secret put MODEL_KEY
# optional: wrangler secret put MODEL_TIMEOUT_MS (default 20000, hard abort)
#           wrangler secret put MODEL_PRICE_IN_PER_MTOK   # USD per 1M tokens, enables cost_estimate_usd
#           wrangler secret put MODEL_PRICE_OUT_PER_MTOK
```

3. **POST /signal to a model tier** now actually calls the model, wearing the
   sheet's system prompt, with a hard 20s timeout. Every exchange is logged on
   the signal: `mode: "model"`, prompt/completion tokens, latency, cost
   estimate (null if prices unconfigured — honest about what we know).
4. **If either side is missing — sheet config OR worker env — the boundary
   stays honest**: still the clear `model-call-required` response, nothing
   fetched, no silent guessing.

**Escalation as a path**: a *differentiated* cell may carry a forming rule
 table (`sheet.rules`). A hit serves deterministically at cost 0. A **miss
 routes UP** to the lineage's nearest active totipotent ancestor
 (`created_from` chain), which answers via the model bridge wearing **its
 own system prompt composed with the failed child's role context** — the germ
 line answers *in the child's scope of fate*. The signal is logged with
 `mode: "escalated"`, `escalated_from: <child>`, and the missed-rule +
 successful-escalation pair is recorded as a **distillation candidate**:
 evidence the rule table has a hole the organism should grow into. The
 gardener resolves candidates via `POST /candidates/{id}/resolve`, appending
 the distilled answer as a deterministic rule — the next signal of that kind
 hits the table at cost 0. That's the whole growth loop: **miss → germ line
 covers → candidate → rule grown → tendency myelinates → sclerotic tissue.**

**Cost tumor watch** (the cancer metric): `GET /organism/{name}/health?window=N`
 (default 100) reports the serve-mode split and `totipotent_serve_pct` — the
 share of recent signals served by germ-line thinking (model calls to
 totipotent targets **plus** escalations). Above **5%** it flags
 `cost_tumor.warning`: the organism is leaning on its stem cells; differentiate
 dedicated tissue or grow rule tables from the candidates. A healthy organism
 keeps the germ line rare — wound healing and genuine novelty only.```

Local: `npm run db:migrate:local && npm run dev` then `npm run seed`
(defaults to `http://localhost:8787`).

Optional: set `MYELIN_THRESHOLD` as a Worker var to demo faster promotion.

## THE CORTEX PLUG (v0.2.x) — the organism writes a tune

The seam, closed end to end: a **sclerotic metronome** (rule table, cost 0)
keeps time; every Nth tick its table says *compose*; the signal fires at a
**totipotent bandleader** whose `sheet.model.system_prompt` is a frozen
plainsong-notation contract; the model answers **through the v0.2 seam**
(tokens/latency/cost logged on the signal); the driver accumulates the bars
and the **plainsong MCP** (`compile_score`) renders them to MIDI. Real run,
no human in the loop: 32 ticks, 7 bars, 10.7k tokens of GLM-5.3.

```bash
npm run cortex:plug   # WORKER_URL + PLAINSONG_MCP + .dev.vars MODEL_* — see docs/cortex-plug.md
```

Wiring diagram, the bars the organism wrote, and the v0.3 needs (critic
cell, compositional memory, distillation of the cortex, real-time spine,
ensemble): **[docs/cortex-plug.md](docs/cortex-plug.md)**.

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

`npm run seed` also loads `examples/fleet-instinct-seed.json` (2026-08-25
night watch):

- **`fleet-instinct`** (*mined-reflex-organism*) — the corpus's clearest
  finding seeded: the fleet's strongest reflexes are **conversational, not
  musical**. Six cells grown from `plainsong-mcp/docs/reflex-mining-report.md`,
  every sheet carrying its mined evidence (observed count, sources):
  **sacred-space** (sclerotic; declared space honored or asked-into — 6
  decisions, 4 agents, zero violations), **honesty-gate** (differentiated;
  claims resolve to artifacts or the gap is declared in the artifact — 8
  instances, 5 contexts, provenance pinned to the report's own count),
  **room-entry** (differentiated; enter at or below the room's established
  floor — the strictly-descending chain 66 → 46 → 52), **critique-budget**
  (sclerotic counter; one ask per iteration, exactly 3 per round, ≤5 per
  spec — 15+ bounded critiques across 4 models), **verify-from-outside**
  (differentiated ensign-watch; a system reporting its own success is not
  evidence — 6 instances), and the **ensign-watchlist** (differentiated ON
  PURPOSE: all 8 failure signatures answer on sight, but a new-signature
  report escalates to the germ line and becomes a distillation candidate —
  the table grows; sclerotic here would make growth scar tissue). The two
  closed laws sclerosed by gardener distillation; the myelin counters carry
  the real observed counts — nothing claims a promotion it didn't earn.
  Five watchlist rows are honestly flag-only (enforcement needs external
  state — the obligations ledger's job), and the reflexes that didn't fit
  the cell model (#7 build-the-tool, #9 perception-before-steering, #10
  env-canary) are named in the sheet, not buried.

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
