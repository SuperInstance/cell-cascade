#!/usr/bin/env node
/* wasm_bench.cjs — run a .qm program on the REAL quilt-vm-wasm (the 5
 * opcodes as wasm-bindgen exports; nothing reimplemented).
 *
 * Serve semantics mirror qm-runner (the Rust lane):
 *   - route to "<to>:response"
 *   - first matching guard wins (kind equality + canonical-JSON subset
 *     payload_equals match — canon() identical algorithm)
 *   - hit:  vm.bind("<to>:response", result)  [response slot update ON the
 *           VM — the wasm VM's effect records name strings, not closures,
 *           so the write is a re-bind overwrite] + vm.effect(...) record +
 *           vm.tick(1.0)
 *   - miss: {"miss":true} written to the slot in-VM; results report null
 *   - response read back via vm.view (VIEW opcode)
 *
 * Timing protocol (process.hrtime.bigint, ns):
 *   load / cold / warm / steady — identical to qm_bench.c.
 *
 * Usage: node wasm_bench.cjs <pkg_dir> <prog.qm> <signals.json> <canonical_idx>
 */
"use strict";
const fs = require("fs");
const path = require("path");

const [pkgDir, progPath, sigPath, canonIdxArg] = process.argv.slice(2);
const canonIdx = parseInt(canonIdxArg || "0", 10);
const { WasmQuiltVM } = require(path.join(pkgDir, "quilt_vm_wasm.js"));

function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}

const prog = JSON.parse(fs.readFileSync(progPath, "utf8"));
const signals = JSON.parse(fs.readFileSync(sigPath, "utf8"));

/* ── program load: BIND/LINK every op onto the VM ── */
const tLoad0 = process.hrtime.bigint();
const vm = new WasmQuiltVM();
const rules = []; /* {target, guard:{kind,pe}, action} — the host-side table */
for (const op of prog.ops) {
  if (op.op === "bind") vm.bind(op.target, op.value);
  else if (op.op === "link") vm.link(op.from, op.to, op.type);
  else if (op.op === "effect") rules.push(op);
  /* views are projected at the end */
}
const loadNs = Number(process.hrtime.bigint() - tLoad0);

function bound(name) {
  return deepPlain(vm.view(name, "anyone")); /* VIEW opcode */
}

/* serde-wasm-bindgen hands JSON objects back as JS Map — deep-convert */
function deepPlain(v) {
  if (v instanceof Map) {
    const o = {};
    for (const [k, x] of v) o[k] = deepPlain(x);
    return o;
  }
  if (Array.isArray(v)) return v.map(deepPlain);
  return v;
}

function sigmaDistance(f, c, s) {
  if (f.length !== c.length || f.length !== s.length)
    throw new Error("dimension mismatch");
  let acc = 0;
  for (let i = 0; i < f.length; i++) {
    const d = (f[i] - c[i]) / s[i];
    acc += d * d;
  }
  return Math.sqrt(acc);
}

/* ── ONE serve ── */
function serve(sig) {
  const target = sig.to + ":response";
  const hit = rules.find((r) => {
    if (r.target !== target) return false;
    const g = r.guard || {};
    if (g.kind && g.kind !== sig.kind) return false;
    const pe = g.payload_equals || {};
    for (const k of Object.keys(pe))
      if (canon((sig.payload || {})[k]) !== canon(pe[k])) return false;
    return true;
  });
  if (hit) {
    let result;
    const a = hit.action;
    if (a.set !== undefined) result = a.set;
    else {
      const e = a.expr;
      const c = bound(e.centroid);
      const s = bound(e.sigma);
      const f = (sig.payload || {}).features || [];
      result = { sigma_distance: sigmaDistance(f, c, s) };
    }
    vm.bind(target, result);      /* response slot update ON the wasm VM */
    vm.effect(target, "table-hit", "reset"); /* EFFECT record on the VM */
    vm.tick(1.0);                 /* TICK — the step */
    return { mode: "table", response: bound(target) };
  }
  vm.bind(target, { miss: true }); /* stays inside the VM */
  vm.effect(target, "table-miss", "reset");
  vm.tick(1.0);
  return { mode: "table-miss", response: null };
}

const now = () => Number(process.hrtime.bigint());

/* ── timing protocol (same as C lane) ── */
const canonSig = signals[canonIdx];
const tCold0 = now();
let r = serve(canonSig);
const coldNs = now() - tCold0;

for (let i = 0; i < 999; i++) serve(canonSig);
const tWarm0 = now();
for (let i = 0; i < 1000; i++) serve(canonSig);
const warmNs = (now() - tWarm0) / 1000;

const N = 10000;
const samples = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const t0 = now();
  serve(canonSig);
  samples[i] = now() - t0;
}
const sorted = Float64Array.from(samples).sort();
const mean = samples.reduce((a, b) => a + b, 0) / N;
const pct = (p) => sorted[Math.min(N - 1, Math.floor(N * p))];

/* ── correctness pass over the whole fixture (untimed) ── */
console.log("results [");
signals.forEach((s, i) => {
  const out = serve(s);
  console.log(
    `  {"to": "${s.to}", "kind": "${s.kind}", "mode": "${out.mode}", "response": ${JSON.stringify(out.response)}}${i + 1 < signals.length ? "," : ""}`
  );
});
console.log("]");

console.log("views {");
(prog.views || []).forEach((v, i) => {
  const val = bound(v.target);
  console.log(`  "${v.name}": ${JSON.stringify(val === undefined ? null : val)}${i + 1 < prog.views.length ? "," : ""}`);
});
console.log("}");

console.log(
  `timing {"organism": "${prog.organism}", "canonical_signal": "${canonSig.to}/${canonSig.kind}", ` +
    `"load_ns": ${loadNs}, "cold_ns": ${coldNs}, "warm_mean_ns": ${warmNs.toFixed(0)}, ` +
    `"steady_mean_ns": ${mean.toFixed(0)}, "steady_min_ns": ${sorted[0].toFixed(0)}, ` +
    `"steady_p50_ns": ${pct(0.5).toFixed(0)}, "steady_p99_ns": ${pct(0.99).toFixed(0)}, ` +
    `"steady_max_ns": ${sorted[N - 1].toFixed(0)}}`
);
vm.free();
