# THE CORTEX PLUG — the first totipotent cell that composes

*v0.2.x, 2026-08-25/26. The seam is closed: an organism whose spine keeps
time, whose cortex composes, and whose hands render — no human in the loop.*

## The wiring

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

## What v0.3 needs

1. **A critic in the loop.** The bandleader composes blind to features;
   the MCP already serves `analyze_features`/`perception_trace` (sixteen
   channels per bar). A multipotent ear cell should read the trace and
   shape the next `compose` payload — the GAN-rounds pattern, closed
   inside the organism.
2. **Compositional memory.** `recent` is 2 bars by driver choice; the
   bandleader has no score-level plan (form, contour, tension curve).
   Either the payload carries an evolving outline, or a dedicated
   "librettist" cell holds it.
3. **Myelination of the cortex is NOT the goal — distillation is.** The
   cost tumor (17.5% germ-line serving) is the metric to drive down:
   grow rule tables from what the bandleader repeats. The escalation
   ledger already records candidates; composing is a place to mint them:
   common voicings/rhythms the cortex re-derives at 18s apiece should
   become differentiated-arranger tissue at cost 0. The seam's
   `compose` misses can route up today; the wiring just needs a
   differentiated arranger cell under the bandleader to miss first.
4. **Real-time spine.** The driver's clock is a loop with a 120ms breath;
   band-clock showed 1ms drift over 269 boundaries. The tick source
   should be that scheduler, and `BARS_PER > 1` (multi-bar composes)
   amortizes the 18s latency of thinking.
5. **Ensemble, not a soloist.** One bandleader, one voice. The MCP's
   ensemble session (join/write_part/render with conflict rebasing) is
   the natural next plug: a bass cell, a drum cell — an organism that
   fills a stage, voices disjoint, one clock.
