# reflex-arc export — the critic's frozen gate, minted to metal (2026-08-26)

> Branch `reflex-arc`. The metal side (firmware, replay harness, board
> ceremony) lives in **quilt-esp32 branch `reflex-arc`** —
> `docs/REFLEX-ARC-2026-08-26.md` there is the full account. This doc is
> the export side: what leaves this repo, in what number format, with what
> provenance, and what the replay proved.

## What was built here

| piece | file | what it does |
|---|---|---|
| .qm exporter | `scripts/export_gate_qm.ts` (`npm run export:gateqm`) | mints `gate/gate-bands.json` → blink-style `critic-gate.qm`, every number an integer micro-unit, sha256 receipt baked in |
| desktop oracle | `scripts/reflex_reference.ts` (`npm run reflex:reference`) | replays corpus vectors through the REAL `cheapCritique` → the reference the metal side must match |
| stock harvester | `scripts/reflex_stock_bars.ts` | reconstructs arranger stock bars (judged by the gate, never logged as notation) through the real `stockBarFor` |
| export tests | `test/reflex_export.test.ts` | µ-grid exactness, sha provenance, oracle semantics (7 tests, 188/188 total green) |

## The number format — micro-units, not Q16.16

Every number the gate sees is decimal by construction: the ear rounds
features to 6 places (plainsong `_round`), the mint moved a band edge to
**0.763**, the gray zone is **0.06**. On the 10⁻⁶ grid all of these are
EXACT as signed 32-bit integers (max 1.6 = 1,600,000 µ). Q16.16 cannot
represent 0.06 or 0.763 (undyadic — ±2.4·10⁻⁶ error at the edges), so
band-edge comparisons could silently flip between desktop floats and metal
fixed point. Micro-units make the export bit-exact **by construction**;
the 500-vector replay then proved it empirically (100% agreement, zero
band-edge divergences).

Penalties ride the same grid: warn 400,000 µ, bad 1,000,000 µ, revise at
≥ 1,000,000 µ — the same threshold crossings as the desktop float sums
(0.4+0.4 = 0.8 < 1; 0.4·3 = 1.2000000000000002 ≥ 1; bad = 1.0 ≥ 1).

`toMicro()` refuses values that would lose information off the grid
(round-trip guard) — a 7th decimal or 1/3 throws at export time, never
silently truncates on metal.

## Provenance — the mint receipt

`critic-gate.qm` carries `source_sha256` = sha256 of the exact
`gate-bands.json` **bytes** it was minted from. The firmware prints it at
boot; the board replay verifies it against the corpus before judging. A
re-minted gate produces a different sha — the board cannot pretend to run
bands it never received. Current receipt:

```
9c896bb021e87b782c6a00121af830db9f86d9ded49ba6b3e6c35c4213a7e3e4   gate/gate-bands.json (v3)
```

## Scope — what is NOT on metal (pre-registered)

The export carries the **6-channel band gate + gray zone only**
(`note_density, syncopation, register_spread, rest_ratio,
harmonic_tension, interval_size` × intent bands). The desktop gate's
cross-bar tissue — voice-leading jumps, the tension-curve breath check,
the librettist arc — stays desktop: it needs multi-bar state and (for the
arc) the outline, and the reflex-arc milestone is the frozen band gate
judging identically. The `.qm`'s `escalations` is empty **honestly**: the
model seam (gray-zone adjudication) is not on metal; the board only flags
gray/dissent back over UART.

## Corpus provenance (the honest accounting)

"≥500 REAL logged critique vectors" met the ledger's actual granularity —
see **finding F1** below. The corpus (built by quilt-esp32
`tools/reflex/build_corpus.py` against this repo's `runs/`):

- 66 distinct `@piano` bars from every run's `.song` (final accepted bars)
- candidate bars from every tick-log `answer_head` (compose + escalated
  arrange), normalized to the piano voice exactly as the driver did
- 7 arranger stock bars reconstructed via the real `stockBarFor` (core
  drift-guarded against the standing `arranger-voicings.json`)
- **80 distinct real bars = 480 channel readings**, re-measured by the
  same deterministic ear (plainsong venv, `analyze_features`, voice=piano)
- all **20 logged `gate` evidence readings** replayed as anchor probes

Per-bar features are strictly bar-local in plainsong (onsets/interval
steps inside the bar window), so re-measuring bars outside their run
context reproduces the run's numbers byte-for-byte. Not assumed —
**validated: all 20 ledger anchors matched the reconstruction exactly**
(0.143 syncopation, 0.313 density, 0.703 tension, every one).

### Finding F1 — ledger granularity (filed, pre-registered class: none)

The tick-log records only violation/gray **evidence** (20 readings across
19 runs), not every vector the gate judged. A ≥500-vector replay required
reconstruction from logged artifacts, anchored to the ledger. If the metal
lane matters going forward, the driver should log the full per-bar trace
per critique (one line, six numbers) — then the next replay reads the
ledger directly. Also: evidence values are rounded to 3dp by the driver
(`r3`) while the gate judges 6dp — the anchors compare at logged
precision; the corpus carries full 6dp.

## Result (host metal-code replay; board numbers in the quilt-esp32 doc)

- **480/480 channel readings agree — 100.0000%**
- **80/80 bar verdicts agree — 100.0000%**
- **20/20 ledger anchors agree — 100.0000%**
- divergences: **zero** — neither pre-registered class (table
  inexpressiveness, band-edge rounding) occurred
- desktop judge latency (-O2, same C as metal, committed evidence
  `tools/reflex/findings.json`): accept p50 20 ns / p99 70 ns · revise
  p50 20 ns / p99 40 ns

## Failures first (the healing log)

- The first `toMicro` grid guard was mathematically dead code
  (`|v·10⁶ − round(v·10⁶)| > 0.5` can never fire — rounding lands ≤ 0.5 by
  definition). Caught by its own unit test; replaced with the round-trip
  guard. Dead guards are worse than no guards: they claim safety they
  cannot provide.
- First corpus pass: 3/20 anchors unmatched. Causes, in order of
  discovery: (1) the driver rounds evidence to 3dp — anchors must compare
  at logged precision; (2) Python's banker's rounding disagreed with JS
  `Math.round` at exactly 0.3125×1000 → the checker now rounds half-up
  like the driver's `r3`; (3) one bar (A7b9 stock) existed only as an
  arranger table serve — reconstructed via `reflex_stock_bars.ts`. After
  all three: 20/20.
- The 500-vector bar was met **exactly** (480+20), not exceeded — the
  runs' real population of distinct judged bars is 80. Padding was
  available (bass/drums bars the gate never judged) and refused: fake
  vectors are worse than a short corpus with a filed finding.

## Reproduce

```sh
npm test                                      # 188/188 incl. export tests
npm run export:gateqm -- --out ../quilt-esp32/firmware/critic-gate.qm
npx tsx scripts/reflex_stock_bars.ts --runs runs --out ../quilt-esp32/tools/reflex/stock-bars.json
# corpus + reference + replay: see quilt-esp32 tools/reflex/ (plainsong venv python)
npx tsx scripts/reflex_reference.ts --corpus ../quilt-esp32/tools/reflex/vectors.jsonl \
    --out ../quilt-esp32/tools/reflex/ref.jsonl
```
