# edge-benchmarks — the .qm modules BELOW the cloud

**Branch:** `edge-benchmarks` (off `qm-bridge`, 11/11 green)
**Date:** 2026-08-25 · **Lane:** on-the-metal
**Question:** do the cell→qm bridge's compiled rule tables actually serve
reflexes on the edge metal at ~µs, and by how much does that beat the cloud
Worker that grew them?

## Verdict up front

| lane | status | ROGER serve (steady p50) |
|---|---|---|
| **C** — quilt-vm-c, gcc -O2, WSL2 | ✅ builds, runs, **equivalent to the Rust reference** | **110 ns** |
| **WASM** — quilt-vm-wasm, wasm-pack `nodejs`, node 22 | ✅ builds fresh (21.6 s), runs in node, **equivalent** | **3.6 µs** |
| **Cloud** — cell-cascade Worker `/signal` (table mode) | ✅ live, ROGER verified | **1.0 ms server-side / 197 ms keep-alive RTT / 310 ms new-conn** |

**The headline ratio (cue-tokens ROGER, `nod` → `{"ack":"ROGER",...}`):**

- C on-metal vs Worker server-side: **~9,100×** (110 ns vs 1.0 ms)
- C on-metal vs full HTTPS keep-alive round trip: **~1,790,000×** (110 ns vs 197 ms)
- WASM (the boat-tablet lane) vs Worker server-side: **~280×** (3.6 µs vs 1.0 ms)
- WASM vs full HTTPS keep-alive round trip: **~55,000×**

The tendon, quantified: the same sclerotic table serves in **a ten-thousandth
of a millisecond** where the cloud axle takes a millisecond of its own time —
before the last-mile nerves even fire. That gap is why the organism grows
tendons: the reflex lives where the stimulus lands.

## What ran

The four bridge modules (`../examples/*.qm`) were served through **the real
VMs** — no reimplementation. Serve semantics mirror `qm-runner` (the Rust
lane) exactly: route to `<to>:response`, first matching guard wins (kind
equality + canonical-JSON subset `payload_equals`), hit → `effect`+`tick`
applies the response (the C VM's pending-effects drain IS the rule-table
step), miss → `{"miss":true}` in-VM, results report `null`.

- **C lane:** `qm2c.py` compiles a `.qm` + fixture into C static tables
  (values canonicalized at compile time — sorted keys, UTF-8, no spaces;
  the C serve path is `strcmp` guard match + `qvm_effect`/`qvm_tick`/
  `qvm_view` on quilt-vm-c). No JSON parser on the target — that is the
  point of sclerotic tissue.
- **WASM lane:** the live organism state (facts, response slots, links,
  effect records, ticks) lives on quilt-vm-wasm; the host (node) does the
  table scan, every state change crosses the JS↔WASM boundary through the
  opcode exports. One representational seam: the wasm VM's `effect` records
  name-strings (no closures on wasm32-unknown-unknown), so the response
  write is a `bind` overwrite + `effect` record + `tick`.
- **Cloud lane:** `POST /signal` from this host (WSL2, Alaska last-mile),
  `environment → cue-tokens:cue-ack, kind=nod` → `mode:table`,
  `ack:ROGER`, `cost_per_call:0`. Server-reported `latency_ms: 1` includes
  the Worker's D1 round trips — **the rule table itself lives in D1, not in
  the isolate** — so 1 ms is the cloud's own floor for this serve,
  independent of client networking.

## The timing table (medians over runs; ns unless stated)

Protocol: **cold** = first serve in-process (includes first-touch/lazy
binding, not fork+exec — process spawn adds ~ms and was not counted);
**warm** = mean of serves 2–1000; **steady** = 10,000 serves of the
canonical signal, per-serve `CLOCK_MONOTONIC` / `hrtime.bigint()`.
C: 5 fresh binary runs; WASM: 3 fresh node runs; cloud: 30 reqs/mode.
Host: AMD Ryzen AI 9 HX 370, WSL2.

### C — quilt-vm-c (gcc -O2, -std=c99)

| organism | canonical signal | load | cold | warm | steady mean | steady p50 | steady p99 |
|---|---|---|---|---|---|---|---|
| band-clock | do-alarm/bar-tick | 30 µs | 1.1 µs | 235 ns | 224 ns | **111 ns** | 1.8 µs |
| **cue-tokens** | **cue-ack/nod → ROGER** | 36 µs | 2.8 µs | 308 ns | 214 ns | **110 ns** | 1.8 µs |
| seamstress-eye | eye/gate-check (σ-math) | 38 µs | 17.0 µs | 923 ns | 1.23 µs | **821 ns** | 3.7 µs |
| unheard-duke | duke-pianist/tendency-query (miss) | 83 µs | 772 ns | 299 ns | 249 ns | **140 ns** | 2.0 µs |

(The README's "0.11 ms gold demo" claim covers all 8 polyformalisms
*including five printfs*; the per-serve numbers here are consistent with
that — a single table serve is ~0.1–0.3 µs.)

### WASM — quilt-vm-wasm in node v22 (JS↔WASM boundary per serve)

| organism | cold | warm | steady mean | steady p50 | steady p99 |
|---|---|---|---|---|---|
| band-clock | 0.72 ms | 11.4 µs | 8.8 µs | **5.9 µs** | 41 µs |
| **cue-tokens** | 1.11 ms | 9.1 µs | 5.5 µs | **3.6 µs** | 32 µs |
| seamstress-eye | 0.68 ms | 10.6 µs | 4.3 µs | **2.7 µs** | 22 µs |
| unheard-duke | 0.19 ms | 14.9 µs | 5.1 µs | **2.8 µs** | 20 µs |

Browser/boat-tablet story **today**: the pkg builds, loads and serves in
node CJS; `www/index.html` demos the opcodes in-browser. The bench harness
itself is node-only so far (browser port = swap `require` for the pkg's
bundler build — unmeasured here, and honestly flagged as such).

### Cloud — the floor to beat

| mode | mean | p50 | min | server-reported |
|---|---|---|---|---|
| new conn (DNS+TCP+TLS+HTTP) | 336 ms | 310 ms | 266 ms | 1.0 ms |
| keep-alive | 224 ms | 197 ms | 171 ms | 1.0 ms |

## Cross-VM equivalence (the honesty check)

15 fixture signals across all four organisms:
**rust `qm-runner` ≡ C `quilt-vm-c` ≡ WASM `quilt-vm-wasm` — PASS**
(modes identical; responses structurally equal, floats at 1e-9; seamstress
σ-math exact: 0σ, 6σ, √6σ — matches the closed forms in the qm-bridge
verdicts). Reproduce: `check_equivalence.py` (rust json vs C vs WASM).

## Honest floors — what's still missing

1. **ESP32/boat: UNTESTED.** No xtensa/esp-idf toolchain on this host.
   `quilt-esp32` (separate repo) is a *no_std reactive engine*, not this
   5-opcode VM; the C VM is C99 + malloc/printf only (no OS calls in the
   serve path), so an xtensa port of quilt-vm-c + a `qm2c`-generated
   firmware table is the shortest path — needs the toolchain, a board, and
   a serial/serve loop. The numbers above say the VM core itself is
   already ~1000× inside a 1 ms reflex budget at 240 MHz-class clocks,
   even at a 50–100× MCU clock penalty.
2. **WASM-in-browser serve: UNMEASURED** (builds + opcode demo work; the
   bench harness is node-only). Expected same order as node lane; needs
   the browser harness to claim it.
3. **Process-cold not measured:** in-process cold only. A fresh-process
   first serve adds exec+dynamic-link (~ms on Linux) — irrelevant for a
   resident embedded loop, dominant for a CLI-per-serve design.
4. **Cloud floor is D1-bound:** the Worker's 1 ms is mostly its D1 round
   trip (rule lookup + logging). Even an in-isolate table would still pay
   the network RTT (~170–200 ms from here); the *axle*, not the bearing.
5. The WASM VM's `effect` is record-only (name strings) — the response
   write is a bind overwrite; the C/Rust VMs apply through a real
   pending-effects drain. Same observable contract today, but a wasm-side
   drain would make the lanes mechanically identical.

## Reproduce

```sh
# C lane (needs /home/eileen/projects/quilt-vm-c)
bash run_c_bench.sh

# cross-VM equivalence (needs the rust qm-runner built)
for n in band-clock cue-tokens seamstress-eye unheard-duke; do
  ../qm-runner/target/release/qm-runner ../examples/$n.qm \
    ../test/fixtures/$n.signals.json > build_c/$n/rust_out.json
  python3 check_equivalence.py build_c/$n/rust_out.json \
    build_c/$n/out.json.txt build_wasm/$n.out.txt
done

# WASM lane (fresh build; the Cargo.toml patch is default=["wasm"], wasm=[])
cd /tmp && cp -r ~/projects/quilt-vm-wasm qvm-wasm-build && cd qvm-wasm-build
sed -i 's/^default = \[\]/default = ["wasm"]/; s/^wasm = \["wasm-bindgen"\]/wasm = []/' Cargo.toml
wasm-pack build --target nodejs --release
cd - && for n in band-clock cue-tokens seamstress-eye unheard-duke; do
  node wasm_bench.cjs /tmp/qvm-wasm-build/pkg ../examples/$n.qm \
    ../test/fixtures/$n.signals.json 0 > build_wasm/$n.out.txt
done

# cloud floor
python3 cloud_bench.py 30
```

Machine-readable: `results.json`. Raw artifacts: `build_c/*/out.json.txt`,
`build_wasm/*.out.txt`.
