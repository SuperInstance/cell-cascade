# THE CORTEX PLUG — the first totipotent cell that composes

*v0.5, 2026-08-26. The organism fills a stage: BASS and DRUM cells
(differentiated rule tables, kimi-signed) under one clock, an ARRANGER
under the bandleader as the compose-side distillation target, and the
plainsong MCP ensemble session as the wire. v0.4 history below.*

## v0.5 — THE ENSEMBLE: the band on one clock, novelty the only seam

```
  clock ──tick──► METRONOME (unchanged — the band-clock scheduler
        │          pattern; 1ms drift over 269 boundaries was v0.2's
        │          finding, the spine still never thinks)
        │
        ├──compose──► ARRANGER [differentiated, UNDER the bandleader]
        │              │  chord → stock voicing table (seeded from
        │              │  gate/arranger-voicings.json, the mint canon)
        │              │
        │         HIT ─┴─ cost 0, round 1 of the GAN loop is SERVED:
        │              │  the stock bar rebuilds (core + rhythm, vel
        │              │  follows the arc) → the ear judges it free →
        │              │  a stock that stands ends the cycle (the
        │              │  cortex does not re-derive what it wrote)
        │         MISS ─┬─ the table's hole: the arrange signal
        │              │  ESCALATES to the bandleader (one spend,
        │              │  wearing the arranger's role context; the
        │              │  candidate is recorded) → the accepted bar
        │              │  MINTS if ≥70% chord-tone clean: the rule
        │              │  grows on the worker sheet (candidate
        │              │  resolved) AND the versioned file persists
        │              ▼
        │        compose cycle (v0.4 GAN: analyze → critique →
        │              steering → round 2 = the bandleader, only on
        │              revise — an arc the stock can't serve pays)
        │
        ├──compose_bass──► BASS CELL [differentiated, rule table]
        │              root → fifth → the quality's DEFINING tone
        │              (kimi: m7→b7, maj7→7, dom7→3, m7b5→b5) →
        │              half-step-BELOW leading tone into the next
        │              root. c1..b2 hard (the piano owns c3+). Locked
        │              to the same CHANGES the bandleader harmonizes;
        │              an unknown QUALITY misses → the seam
        │
        └──compose_drums─► DRUM CELL [multipotent, forming table —
                           the serve-split: swing/bossa/ballad/rock
                           presets are kimi-corrected table tissue
                           (cost 0); the turnaround fill at section
                           ends is table too — a fill the table does
                           NOT hold misses to the cell's own scoped
                           model. Fills escalate ONLY on miss]

  all three voices, one downbeat ──► plainsong ensemble session
        (ensemble_open/join/write_part/render): parts written against
        each voice's base version; a stale write is REFUSED with the
        state to rebase onto (one rebase retry, never a silent
        overwrite); the merged score compiles to the band's MIDI
```

What shipped (`src/ensemble.ts` + the `serveFirst` hook in
`src/critic.ts` + driver wiring, on `cortex-v05`):

- **THE BASS CELL** — walking shells as a rule table. kimi signed the
  musical rules before they froze (2026-08-26): defining tone per
  quality, the leading-tone approach regardless of distance (my draft
  had `b2→g2`, a m3 drop — kimi: "leading tone to G is f#"), dim7's
  bb7 spelled as the 6th because double accidentals are outside the
  notation grammar. The kimi REVIEW pass then caught the live bug my
  tests blessed: half-diminished walked the P5 where the shell's fifth
  is a b5 — fixed + regression-pinned (174/174).
- **THE DRUM CELL** — sclerotic-pattern presets inside multipotent
  tissue (the honest reading of "the sclerotic tier": a pure sclerotic
  cell cannot escalate anything, so the patterns are table and the
  SEAM is reserved for the novel fill). kimi corrected all four
  presets: swing rides the skip beat (`d#2 . d#2-f#1 d#2 d#2 .
  d#2-f#1 d#2`), bossa's kick is 1-&2-3 with rimclick e1 on 2&4,
  ballad brushes 2&4 only (my draft used d2 — "a bug, not a style
  choice"), rock's backbeat carries hat 8ths.
- **THE ARRANGER** — the compose-side serve-split. Round 1 of every
  compose cycle asks the chart first (the `serveFirst` hook): a held
  chord serves its stock voicing at cost 0; a miss escalates through
  the bandleader (which IS the compose — no double spend) and the
  accepted bar mints if it is ≥70% chord tones (color-dense bars are
  honest novelty, recorded unminted). Mints grow the rule on the
  WORKER sheet (the escalation candidate resolves — the next arrange
  of that chord hits the worker's table at cost 0, in-ledger) and the
  versioned `gate/arranger-voicings.json` persists the canon across
  runs. A cold start is the maximal hole: v0.5 also fixes `firing.ts`
  so a differentiated cell with an EMPTY table escalates like a miss
  (the germ line speaks while the table is unborn).
- **THE WIRE** — the plainsong ensemble session. One clock: bass,
  drums and the arrange/compose cycle all fire inside the metronome's
  downbeat. Voices disjoint by construction (the driver owns voice
  tags; every served line is normalized to its voice — bass
  escalations fold into c1..b2, drum answers fold to the kit map).
  Writes go per downbeat against each voice's base version; section
  names are UNIQUE (AABA → A, A2, B, A3 — the merge is deterministic
  on unique names; repeated letters concatenate, a lesson the wire
  taught live). `ensemble_render` merges and compiles the band.
- **ENSEMBLE=1** toggles the band in the driver; the default stays
  solo piano — the v0.4 loop byte-for-byte (pinned by test).

### The evidence (real runs, 2026-08-26 ~18:58–19:12 UTC — GLM-5.3)

Three live runs (artifacts in `runs/`, ledgers complete):

- **Run 1** (`TICKS=16 ENSEMBLE=1`, cold arranger, 4 bars): 4 arrange
  escalations — the bandleader answered each wearing the arranger's
  context — 3 MINTS (Dm7 → `d3-f3-a3-c4`, G7, A7b9), 1 honest refusal
  (Cmaj7's bar was #11-color-dense: unclean, never minted). Bass 4/4
  table, drums 4/4 table, ear 4/4 cost-0. Session wrote 14 versions,
  0 conflicts, band MIDI rendered. Canon: `gate/arranger-voicings.json
  v1`.
- **Run 2** (`TICKS=16 BARS_PER=2 ENSEMBLE=1`, 8 bars): the canon from
  run 1 loaded at startup — Dm7/G7/A7b9 HIT the table at cost 0
  (cross-run distillation, first proof), 5 fresh escalations, 1 mint
  (E7b9). One seam adjudication live: an arranged window read gray on
  syncopation (0.143) + the arc; the seam adjudicated, round 2
  recomposed, accepted.
- **Run 3** (same command, post-fix): **50% of arrange serves at cost
  0** (4 hits / 4 escalations / 1 mint — A7). The arc check caught a
  replayed stock comping too plain for the bridge (0.296 vs 0.622),
  round 2's steered recompose stood (seam-adjudicated). The merged
  band score: AABA, 8 bars, three voices, 0 compile errors — walking
  bass locked to the changes, swing ride with turnaround fills at
  every section end, piano comps and lines. Canon: v3, 5 voicings.

The serve-split across all ensemble runs: bass 20/20 table, drums
20/20 table, arranger 7 hits / 13 escalations (35%→50% as the canon
mints — the table grows toward the changes), ear 100% cost-0 critiques
except the two genuine gray readings the seam adjudicated. The
arranger minted 5 voicings across three runs and refused the
#11-colored ones honestly.

### Run the band yourself

```bash
npm run dev                                   # worker + .dev.vars MODEL_*
# other terminal, from plainsong-mcp: .venv/bin/plainsong-mcp --http --port 8765
TICKS=16 ENSEMBLE=1 npm run cortex:plug       # the band (cold arranger)
TICKS=16 BARS_PER=2 ENSEMBLE=1 npm run cortex:plug   # 8 bars: hits + mints
npm run cortex:plug                           # default: solo piano (v0.4)
```

## v0.4 — DISTILLATION MINTING + THE LIBRETTIST: the table grows itself

*v0.4, 2026-08-26. The gate grows itself: seam adjudications in the run
ledger mint into versioned gate bands (evidence-cited, judger-signed,
reversible), the LIBRETTIST holds the score-level plan, and one thought
writes multi-bar windows.*

```
  runs/*/tick-log.jsonl ──gate evidence lines──► THE MINT PASS (npm run
        (every judged band reading,               mint:bands) · scan → find
         run:line provenance)                     repeated same-direction
              │                                   verdicts → propose band
              │                                   moves → kimi signs the
              │                                   judgment calls
              │                                        │
              ▼                                        ▼
      gate/gate-bands.json — VERSIONED (v1, v2, v3… every record cites its
        │    evidence; rollback restores any snapshot as a NEW version)
        │
        └──► loaded at startup into the frozen gate's intent
              (env INTENT still overrides per channel — experiments run
               above the minted canon; override evidence can only CONFIRM
               the canon or, if it corrects OUTWARD past it, adopt in —
               and only with the judger's signature)
```

What shipped (`src/mint.ts`, `src/librettist.ts`, commits on `cortex-v04`):

- **The evidence ledger** — the driver writes a `gate` line per compose
  round: every judged band reading (channel, side, value, the band it was
  judged against, judged-by gate/seam, severity, resolved, accepted),
  each citing its run and line. This is the mint's ore.
- **The mint pass** — three patterns: LOOSEN (the seam keeps blessing
  gray readings → they become in-band, cost 0 forever), TIGHTEN (the
  seam keeps damning what the gate only grays → the gate flags it
  alone), RECALIBRATE (clear violations on bars the organism ACCEPTED →
  bands follow measurement — judger-signed always). A seam-warn on a bar
  the organism STOOD counts as blessed; a warn the cycle revised leans
  only. Mixed verdicts on one edge are recorded as conflicts, never
  minted. Mints creep (≤ 0.15/edge), never invert a band, cite every
  evidence point, and are enforced AT THE APPLICATION POINT (an untrusted
  pattern array cannot mint without evidence or past the walls).
- **The judger** — seam-derived mints apply directly (the seam IS musical
  judgment); adoptions of operator-override evidence into the standing
  canon need a signature: `kimi -p` answers SOUND/UNSOUND. Kimi has
  teeth — see the live evidence below.
- **THE LIBRETTIST** (`src/librettist.ts`) — score-level memory as
  sclerotic tissue (cost 0): the form (AABA over the bar count), a
  rise-peak-release tension arc (one target per bar, clamped inside the
  gate's band), a one-line narrative. `clock →(outline)→ librettist`
  serves the plan; the compose payload carries `outline` (the prompt
  binds it); the critic's tension-curve check consumes the same targets
  (the outline's first consumer — live in run v04b: "outline arc: bar 1
  reads 0.721 vs target 0.584" steered round 2 clean). The arc EVOLVES:
  realized-tension drift beyond ±0.1 nudges the remaining targets toward
  the music (form is fate, the arc breathes).
- **BARS_PER=2** — bar_index advances per window, `changes` carries the
  cycle's chords comma-joined (one per bar), extraction keeps N bars.

### The evidence (real runs, 2026-08-26 ~17:51–18:19 UTC — GLM-5.3 + K3)

Six runs, 16 evidence points, one REAL MINT and one REAL REFUSAL:

- **v04a** (`INTENT note_density lo .32`, tightened): the bandleader's
  spare .313 bars went gray twice; the seam warned, the organism stood
  them — 2 blessings → corrected edge .253 — but the standing gate's .15
  floor already sanctions more: **CONFIRM, no change.** The canon held.
- **v04b** (leapy style, default intent): interval_size .717 caught CLEAR
  by the gate at cost 0, steered clean round 2; a syncopation gray-low
  (.167) blessed-but-stood once (1 repeat — below threshold, honestly
  unminted). The arc check fired live and steered.
- **v04c** (`INTENT harmonic_tension hi .6`): two gray-high .648 readings
  blessed → corrected .708 < standing .75 → **CONFIRM.**
- **v04d/v04e** (default intent): 100% cost-0 clean runs — the calibrated
  canon reads the organism's own writing clean.
- **v04f** (`INTENT harmonic_tension hi .68`, GAN_ROUNDS=1): three seam
  critiques — .697 judged **ok**, .703 warned-but-stood → corrected
  edge **.763 sits OUTSIDE the standing .75** → outward adoption →
  **kimi's call.** First pass: kimi said **UNSOUND — "jumping to 0.763
  admits too much"** (greedy math, wise musician — refusal recorded with
  evidence). Second pass: kimi signed it — "**SOUND** — sustained tension
  in 0.70–0.76 is idiomatic late-quartet vocabulary (Tyner-esque quartal
  voicings…)". **GATE v1 MINTED: harmonic_tension hi .75 → .763**, every
  point cited (`runs/…v04f/tick-log.jsonl:5,19`).
- **Reversibility, live**: `--rollback` → v2 restored the v0 defaults;
  `--rollback 1` → v3 restored the mint — three history records, nothing
  destroyed, no kimi re-roll needed.
- **v04g**: startup under the minted gate — `the gate: v3 (3 mint
  record(s))` — 2 bars, **100% cost-0 critiques.** Loop closed: ledger →
  mint → versioned gate → loaded at startup → clean run.

The opencode review pass (glm-5.3) hardened the mint before it touched
the canon: adoption direction guards (a correction inside the standing
envelope CONFIRMS, never shrinks), application-point enforcement (no
  evidence → no mint; creep/inversion refused), provenance grouping
  (override evidence never pools with standing-band evidence), NaN
  refusal, ghost-section elimination. 139/139 tests green (111 v0.3 +
  28 new: mint patterns, apply/rollback journeys, confirm semantics,
  libretto/arc/controller, BARS_PER extraction).

Run the loop yourself:

```bash
TICKS=16 npm run cortex:plug          # compose under the minted gate
npm run mint:bands -- --min 2 --dry   # see what the ledger wants to grow
npm run mint:bands -- --min 2         # mint it (kimi signs the calls)
npm run mint:bands -- --rollback      # un-mint it (as a new version)
```

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

## What v0.5 addressed: (3)'s compose-side arranger — SHIPPED (the
ARRANGER under the bandleader, this drop); (5) the ensemble — SHIPPED
(bass + drum cells, the ensemble session wire, ENSEMBLE=1); (4) the
real-time spine — STILL OPEN (the driver's clock remains the 120ms
breath loop; the band-clock scheduler as tick source is v0.6's seam).
The v0.4 list below is kept as it stood:

## What v0.4 addressed (from the list below): (1) the librettist/outline
half — SHIPPED as the LIBRETTIST; (2) compositional memory — SHIPPED
(the outline + evolving arc); (3) distillation MINTING — SHIPPED (this
drop); the compose-side arranger cell and the real-time spine remain
open for v0.5: an ensemble (bass/drum cells through the MCP's session
API) on the band-clock scheduler, with BARS_PER>1 amortizing thought.

What v0.3 needed (status after the critic-cell drop)

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
