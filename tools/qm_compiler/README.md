# qm-compiler — cell-cascade → quilt-VM bridge

Compile cell-cascade organisms (cells + sheets + myelin signal paths) into
**.qm programs** — flat lists of the five quilt opcodes — and run them on a
**real quilt VM** (quilt-vm-rust, via the `qm-runner` binary). Divergence
from cell-cascade's own `/signal` rule-table serving is measured by the
round-trip tests: **zero** (as of this commit, band-clock & cue-tokens,
including `payload_equals` guard-miss cases).

## Opcode mapping

| quilt | compile source | .qm shape |
|---|---|---|
| **BIND** | cell + sheet (facts minus rules) | `<cell>` = tier facts + `sheet_residue` (the golden residue stays in the sheet); `<cell>:response` = null (output slot); `<cell>:facts` mirror |
| **LINK** | myelin paths + lineage | `from --signal:<kind>--> to`, `<cell> --lineage--> parent`. **Dangling signal link = link-time error** (a route to a nonexistent cell never runs) |
| **EFFECT** | each rule `{when, respond}` | guarded effect on `<cell>:response`; guard semantics identical to `cascade.ts matchRule` (kind equality + subset `payload_equals` by canonical JSON, **first match wins**). `sigma_distance` expr effect for gate math |
| **VIEW** | declared projections | `<cell>/{facts,response,health}` |
| **TICK** | step semantics | signal → `vm.effect` queued → `vm.tick(1.0)` applies — the VM's pending-effects drain *is* the rule-table step |

## Layout

- `src/compile.ts` — compiler + canonical JSON + reference interpreter
- `src/build_examples.ts` — compiles the four seeded organisms → `examples/*.qm` + signal fixtures
- `qm-runner/` — Rust binary, path-dep on `/home/eileen/projects/quilt-vm-rust`
- `test/qm.test.ts` — compiler units + round-trip equivalence (runner ≡ `matchRule`)

## Example

```sh
npx tsx tools/qm_compiler/src/build_examples.ts
cargo build --release --manifest-path tools/qm_compiler/qm-runner/Cargo.toml
tools/qm_compiler/qm-runner/target/release/qm-runner \
  tools/qm_compiler/examples/cue-tokens.qm \
  tools/qm_compiler/test/fixtures/cue-tokens.signals.json
npx tsx --test tools/qm_compiler/test/qm.test.ts
```

## Round-trip verdicts (2026-08-25)

- **band-clock** — IDENTICAL (3 table + 1 miss, vs `matchRule`)
- **cue-tokens** — IDENTICAL (6 table incl. `cut`+`priority=break` subset guard, 1 guard-miss)
- **seamstress-eye** — gate math verified against closed form on the VM: features=centroid → 0σ, +6σ on one axis → 6σ, +1σ on all six → √6σ (exact to 1e-12)
- **unheard-duke** — no rules exist on the sheet (by design: the sheet is the silencing pattern, golden residue). The 5 deterministic surviving tendencies and full R3 verdict round-trip **whole** through the facts VIEW (`deepEqual` vs the seed sheet); signals serve an honest `table-miss`. Escalation/model seam remains cell-cascade runtime concern, not compiler output.

## Format-freeze notes (from cross-VM review, session_42831fc9)

- **Miss-slot rule**: every signal overwrites `<cell>:response` — a hit sets the rule's `respond`, a miss sets `{"miss":true}` inside the VM (results report `null`, matching `matchRule`). No stale response can leak between signals.
- **Escalation seam is in the format**: differentiated cells compile a declarative `escalate` link to their nearest totipotent ancestor (`program.escalations`) — WHERE misses go is part of the organism's observable contract; HOW the model is called stays runtime.
- **Stability**: `format:"qm", version:1` first keys; canonical serialization = UTF-8, sorted keys (see `canonJson`/runner `canon` — identical algorithms on both sides); unknown keys ignored, unknown opcodes rejected; the format stays data-only (one frozen expression, `sigma_distance`).
