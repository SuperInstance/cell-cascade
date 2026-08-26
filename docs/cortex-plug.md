# THE CORTEX PLUG — the first totipotent cell that composes

*v0.3, 2026-08-26. The GAN loop is closed INSIDE the organism: the
bandleader composes, a multipotent EAR judges the bars against a frozen
feature gate at cost 0, and the critique steers the next compose payload.
v0.2.x history below.*

## v0.3 — THE CRITIC CELL: the loop listens to itself

```
  bandleader ──compose──► bars ──analyze_features──► per-bar trace (16 ch)
      ▲                                                   │
      │ steering (MUST honor)                        THE CRITIC [multipotent]
      │                                    ┌────────────┴──────────────┐
      │                                    │ frozen gate (cost 0):     │
      ╰────────────────────────────────────│  6 bands · gray zone ·    │
                                           │  voice-leading · tension  │
                                           └────────────┬──────────────┘
                                        clear verdict   ambiguous (gray)
                                        mode 'table'    mode 'model' (seam,
                                        cost 0, ~1ms    critic's own prompt)
```

What shipped (`src/critic.ts`, commits `9eddfe9`/`57f3d9e`):

- **The frozen gate** — seamstress-eye lineage, six channels (note_density,
  syncopation, register_spread, rest_ratio, harmonic_tension, interval_size)
  judged against intent bands, a ±0.06 gray zone at every band edge,
  cross-bar voice-leading (avg_pitch jumps) and the tension curve. Pure TS,
  cost 0, ~1ms. Intent defaults are CALIBRATED ON MEASUREMENT — the v0.2
  run's own bars through the same analyze_features (pinned by a test: the
  praised tune must read clean; naive bands wounded every bar — see live
  lesson 1 below).
- **The serve-split** — `firing.ts` v0.3: multipotent cells carrying a rule
  table serve TENDENCY FIRST (table hit = cost 0; miss = their own scoped
  model through the seam, wearing their own prompt). The critic's table
  hits on `serve:'cheap'`; only gray-zone critiques miss and think. That is
  judgment DISTILLING: the clear cases are permanent cost-0 tissue.
- **Steering** — the critique folds into `steering` hints inside the next
  `compose` payload; the bandleader's frozen prompt carries a binding
  STEERING contract. Up to `GAN_ROUNDS` (default 2) rounds per downbeat;
  round 2 fires ONLY on a revise verdict — a bar that stands saves a model
  call. A failed revision never erases a served bar (`acceptedVia:
  'fallback'` — the bars stand, the critique carries to the next cycle).
- **The serve-split watch** — the health endpoint reports per-kind
  table-vs-seam percentages beside the cost-tumor watch.

### The evidence (real runs, 2026-08-26 ~15:56–16:00 UTC — GLM-5.3)

**The clean run** (`cortex-plug-v03c`, TICKS=16 EVERY=4 GAN_ROUNDS=2):

```
@piano | d3 . f3-c4 . . e4 . . | vel: 60      ← Dm7   [accept · cheap]
@piano | . d4 . b3 . f3-g3 . . | vel: 56      ← G7    [accept · cheap]
@piano | . e3-g3 . c4 . b3 . . | vel: 58      ← Cmaj7 [accept · cheap]
@piano | . a2 . bb3 a3 . g3 . | vel: 59       ← A7b9  [accept · cheap]
```

- 4/4 compose cycles served, 0 failures — and **4/4 critiques served by
  the frozen gate at cost 0** (~1ms each; the seam never fired for the
  ear). 6,488 tokens, spine 16ms / cortex+ear 62.2s.
- Health serve-split (window 24): `tick 100% table · critique 100% table ·
  compose 100% seam` — the ear is free; only writing costs.

**The full GAN round, live** (`cortex-plug-v03-dense`, intent demanding
note_density ≥ 0.45 against the bandleader's spare instinct):

```
r1  @piano | d3-a3 . . e4 f4 . . a4 | vel: 74    ← gate: density .313 — clear
                                                    violation → REVISE (cheap,
                                                    cost 0, 1ms)
r2  @piano | d3-a3-c4 . e4 f4 . g4 a4 | vel: 72  ← STEERED recompose — the bar
                                                    densified as directed; the
                                                    new reading sat GRAY → the
                                                    SEAM adjudicated → ACCEPT ✓
```

One cycle, both serve modes: the gate revised for free, the seam judged one
genuinely ambiguous bar, and round 2's payload provably differed from round
1 because of the critique. The same loop is pinned by three journey tests
with the seam mocked (`test/critic.test.ts`): steering round 2, seam flip,
honest degradation.

**Across all live runs**: 12 critiques — 9 cheap (75%), 3 seam, 0 seam
failures after the budget fix; clean runs buy zero revision rounds. The
cost-tumor watch still fires on `compose` — writing is the bandleader's
irreducible job — but the NEW organ runs at cost 0 by design, and every
seam adjudication lands in the signal ledger where v0.4's distillation
will mine it.

**Three live lessons** (run 1, `cortex-plug-v03`, kept honestly in `runs/`):

1. Calibrate the gate on measurement: register_spread normalizes /127 (real
   piano shells read .08–.15), rest_ratio is sustain-coverage (0–.125) —
   intuition-written bands flagged every bar the v0.2 doc praised.
2. Reasoning models think HARDER when steered: 2048-token composes came
   back empty; 30s seam timeouts aborted steered recomposes at the wall.
   Budgets now: compose 6144 tokens, critic adjudication 2048, seam 60s.
3. The seam critic's frozen JSON contract needs its reasoning budget too —
   a 768-token adjudication returned unusable prose; at 2048 it answers
   clean JSON and its verdicts flip real cycles (the dense run's r2).

Run it:

```bash
TICKS=16 GAN_ROUNDS=2 npm run cortex:plug                        # default intent
INTENT='{"note_density":{"lo":0.45,"hi":0.9}}' TICKS=4 npm run cortex:plug  # provoke revisions
```

## The wiring (v0.2)

```
            (system sender)
   clock ────────tick{n, beat}──────►  METRONOME  [sclerotic · rule table · cost 0 · ~1ms]
                                        │  table: beat 0 → {action: "compose"}   (deterministic fate)
                                        │         else  → {action: "wait"}
                                        │  every Nth tick is a downbeat
                                        ▼
                                     compose{bar_index, changes, bars, key, tempo, recent}
                                        │
                                        ▼
                                   BANDLEADER  [totipotent · sheet.model · the SEAM]
                                        │  fireSignal → callModel wearing the sheet's
                                        │  system_prompt (the frozen notation contract)
                                        │  → GLM-5.3 via MODEL_BASE_URL/MODEL_KEY
                                        ▼
                              answer: plainsong bar lines, logged on the
                              signal ledger (mode "model", tokens, latency, cost)
                                        │
                                        ▼
                                   DRIVER (the body — scripts/cortex_plug.ts)
                                        │  accumulates bars · extracts only `@voice | … | vel:` lines
                                        │  (prose can never corrupt the score)
                                        ▼
                              plainsong MCP (127.0.0.1:8765) · tools/call compile_score
                                        │
                                        ▼
                                   MIDI — the organism's tune, rendered
```

Three pieces of tissue, one organism (`cortex-plug-*` on the worker):

- **metronome** — sclerotic. `sheet.rules` IS the schedule math (the
  band-clock pattern): `{kind:"tick", payload_equals:{beat:0}}` → compose,
  else wait. First match wins, forever, at cost 0.
- **bandleader** — totipotent. `sheet.model` carries the voice:
  `bandleaderSystemPrompt()` freezes the notation contract (8 slots,
  8th-note grid, pitch grammar, `vel:` annotation) and the musical
  doctrine (voice-lead inside `changes`, continue `recent`, let bars
  breathe). The seam (`src/bridge.ts` v0.2) does the rest — no worker
  changes were needed.
- **driver** — `scripts/cortex_plug.ts`, the hands. Turns the clock,
  forwards nothing, judges nothing: it reads the metronome's table verdict,
  sends the compose signal, extracts bar lines from the model's reply
  (trusting only the notation grammar), assembles the score (the header
  belongs to the organism, never the model), and hands it to the MCP's
  `compile_score` for rendering. Every signal mode, token count, and
  latency lands in `runs/<run>/tick-log.jsonl`.

## The evidence (real run, 2026-08-26 05:18 UTC — GLM-5.3 through the seam)

`TICKS=32 EVERY=4 CHANGES=Dm7,G7,Cmaj7,A7b9,Fmaj7,Bbmaj7,E7b9,A7`:

- 32 ticks → 32 table serves (spine total: **32ms**)
- 8 downbeats → 8 compose signals → **7 served by the cortex**
  (one transient model-error; the organism carried on and re-composed the
  same bar at the next downbeat — the failure is in the log, not hidden)
- 10,683 tokens · cortex total 125.9s (~18s/bar — reasoning models think
  before they write; the seam budget is 60s)
- score compiled clean by the MCP → `cortex-plug-051841.mid`

What the organism wrote (7 bars, in full — this IS the tune):

```
@piano | d3-a3-c4 . . f4 . e4 . . | vel: 72     ← Dm7
@piano | . d4 . g3-b3-f4 . b3 . a3 | vel: 70    ← G7 (the retried downbeat)
@piano | e3-g3-b3 . . . . c4 . d4 | vel: 68     ← Cmaj7
@piano | d4 . . c#4 . a2 . g3-bb3 | vel: 69     ← A7b9 (the b9 is there: bb3)
@piano | . e4 . c4 . a3 . f3-a3 | vel: 66       ← Fmaj7
@piano | bb2 . d4 . . f4 . d3-a3 | vel: 70      ← Bbmaj7
@piano | . e3 . g#3-d4 . f4 . e4 | vel: 70      ← E7b9 (g#3 = the 3rd, speaking)
```

Voice-leading happened (shell voicings move stepwise; register spreads),
syncopation happened (slots rest), the changes are spelled in the bars.
The health endpoint's honest verdict on the same window: serve split
**80% table / 17.5% model / 2.5% error**, and the cost-tumor watch fired —
the cortex is 1 cell but it served 17.5% of signals. That is the doctrine
working, not failing: the cure is v0.3.

Run it yourself (worker + MCP + key):

```bash
npm run dev                                   # .dev.vars carries MODEL_BASE_URL/KEY
# other terminal, from plainsong-mcp: .venv/bin/plainsong-mcp --http --port 8765
TICKS=32 EVERY=4 npm run cortex:plug          # → runs/cortex-plug-*/
```

With the seam unconfigured the driver dies at the first downbeat with the
honest `model-required` boundary — nothing is shimmed, nothing faked
(pinned in `test/cortex.test.ts`).

## What v0.3 needed (status after the critic-cell drop)

1. **A critic in the loop — SHIPPED** (see the v0.3 section above). The
   librettist/outline half of this item remains open.
2. **Compositional memory — OPEN.** `recent` is 2 bars by driver choice; the
   bandleader has no score-level plan (form, contour, tension curve).
   Either the payload carries an evolving outline, or a dedicated
   "librettist" cell holds it. The critic's tension-curve check is the
   natural first consumer.
3. **Distillation, not myelination — HALF-SHIPPED.** The serve-split is the
   mechanism (the critic's table grows every time a clear verdict repeats);
   what remains is MINTING: repeated critique patterns and seam
   adjudications should write themselves into the gate's bands/tables
   automatically from the escalation ledger. The compose side (a
   differentiated arranger cell under the bandleader to miss first) is
   still open.
4. **Real-time spine — OPEN.** The driver's clock is a loop with a 120ms breath;
   band-clock showed 1ms drift over 269 boundaries. The tick source
   should be that scheduler, and `BARS_PER > 1` (multi-bar composes)
   amortizes the ~15–20s latency of thinking.
5. **Ensemble, not a soloist — OPEN.** One bandleader, one voice. The MCP's
   ensemble session (join/write_part/render with conflict rebasing) is
   the natural next plug: a bass cell, a drum cell — an organism that
   fills a stage, voices disjoint, one clock.
