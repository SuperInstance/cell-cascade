// cell-cascade — scripts/cortex_plug.ts
// THE CORTEX PLUG DRIVER — the organism's body. Starts the organism on the
// worker (zygote → metronome + bandleader), turns the clock, and lets the
// tissue work: ticks hit the SCLEROTIC metronome (rule table, cost 0);
// downbeats forward a `compose` signal to the TOTIPOTENT bandleader, which
// thinks through the model seam and answers in plainsong notation. The
// driver accumulates the bars and hands the finished score to the plainsong
// MCP (compile_score) for rendering. No human in the loop — the driver is
// started once and then only watches.
//
//   npm run cortex:plug
//   WORKER_URL=http://localhost:8787 PLAINSONG_MCP=http://127.0.0.1:8765 \
//   TICKS=16 EVERY=4 CHANGES="Dm7,G7,Cmaj7,A7" npm run cortex:plug
//
// Honest exits: if the seam is unconfigured (model-required), the model
// errors, or the MCP is down, the run REPORTS the failure and exits 1 —
// never a silent shim, never fake bars.

import { mkdirSync, writeFileSync, appendFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bandleaderSheet, metronomeSheet, tickPayload,
  extractNotationBars, assembleScore, mcpToolCall, parseMcpToolResult,
} from '../src/cortex';
import {
  criticSheet, criticIntent, composeCycle, traceFromReport,
  type CriticIntent, type SteeringHints, type TraceBar,
} from '../src/critic';
import { loadGateBands } from '../src/mint';

const env = process.env;
const WORKER_URL = (env.WORKER_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const MCP_URL = (env.PLAINSONG_MCP ?? 'http://127.0.0.1:8765').replace(/\/+$/, '');
const TICKS = Math.max(1, Number(env.TICKS ?? 16));
const EVERY = Math.max(1, Number(env.EVERY ?? 4));
const CHANGES = (env.CHANGES ?? 'Dm7,G7,Cmaj7,A7b9,Fmaj7,Bbmaj7,E7b9,A7').split(',').map((s: string) => s.trim()).filter(Boolean);
const KEY = env.KEY ?? 'C';
const TEMPO = Number(env.TEMPO ?? 100);
const BARS_PER = Math.max(1, Number(env.BARS_PER ?? 1));
const STYLE = env.STYLE ?? '';
const MODEL = env.MODEL ?? 'glm-5.3';
// steered re-compositions make reasoning models think HARDER: the first live
// v0.3 run burned 2048 tokens thinking and answered empty. The budget rises
// with the loop — the seam timeout (MODEL_TIMEOUT_MS) is the real ceiling.
const MAX_TOKENS = Math.max(1024, Number(env.MAX_TOKENS ?? 6144));
const CRITIC_MODEL = env.CRITIC_MODEL ?? MODEL;
// v0.3: GAN rounds per compose cycle (1 = compose blind, v0.2 semantics;
// 2 = compose → critique → recompose-if-wounded; the default). Round 2 only
// fires when the critic says REVISE — a bar that stands saves a model call.
const GAN_ROUNDS = Math.max(1, Math.min(4, Number(env.GAN_ROUNDS ?? 2)));
// v0.4: the standing gate — gate/gate-bands.json is what the mint grew.
// The frozen gate loads it at startup; env INTENT (operator override)
// still wins per channel, so experiments can run above the minted canon.
const GATE_PATH = env.GATE_BANDS ?? 'gate/gate-bands.json';
const gateFile = loadGateBands(GATE_PATH);
const INTENT: CriticIntent = (() => {
  const standing = gateFile ? gateFile.bands : {};
  let override: Partial<CriticIntent> = {};
  try { override = env.INTENT ? JSON.parse(env.INTENT) : {}; } catch { override = {}; }
  return criticIntent({ ...standing, ...override });
})();
const ORG = env.ORGANISM ?? `cortex-plug-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
const RUNS = env.RUNS_DIR ?? 'runs';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = join(RUNS, `cortex-plug-${stamp}`);
mkdirSync(runDir, { recursive: true });
const tickLog = join(runDir, 'tick-log.jsonl');
const log = (line: string) => console.log(line);
const jlog = (obj: unknown) => appendFileSync(tickLog, JSON.stringify(obj) + '\n');

interface Fired {
  fired: { mode: string; response: Record<string, unknown>; cost_per_call: number; latency_ms: number };
  signal_id: number; ok: boolean; mode: string;
  model_log: { prompt_tokens: number; completion_tokens: number; total_tokens: number; latency_ms: number; cost_estimate_usd: number | null } | null;
  myelin: { fire_count: number };
}

async function api<T = unknown>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data as T;
}

async function mcpCall(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const res = await fetch(`${MCP_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: mcpToolCall(Date.now() % 1e9, name, args),
  });
  if (!res.ok) return { text: `mcp http ${res.status}`, isError: true };
  return parseMcpToolResult(await res.json().catch(() => null));
}

function die(msg: string): never {
  log(`\n✗ ${msg}`);
  log(`  run artifacts (what did happen): ${runDir}`);
  process.exit(1);
  throw new Error(msg); // unreachable in practice; satisfies the never
}

async function main(): Promise<void> {
  log(`╭─ THE CORTEX PLUG — ${ORG}`);
  log(`├─ worker ${WORKER_URL} · mcp ${MCP_URL}`);
  log(`├─ ${TICKS} ticks · compose every ${EVERY} · changes [${CHANGES.join(' → ')}] · ${BARS_PER} bar(s) per compose`);
  log(`├─ the gate: ${gateFile ? `v${gateFile.version} (${GATE_PATH}, ${gateFile.history.length} mint record(s))` : `v0 calibrated defaults (no ${GATE_PATH})`}${env.INTENT ? ' · operator INTENT override active' : ''}`);

  // ── 0. both organs must be alive before anything grows ─────────────────
  const workerAlive = await fetch(`${WORKER_URL}/health`).then(r => r.ok).catch(() => false);
  if (!workerAlive) die(`worker not answering at ${WORKER_URL} (npm run dev, with .dev.vars MODEL_* for the seam)`);
  const mcpInfo = await fetch(`${MCP_URL}/`).then(r => r.json()).catch(() => null);
  if (!mcpInfo || String((mcpInfo as Record<string, unknown>).server ?? '') !== 'plainsong') {
    die(`plainsong MCP not answering at ${MCP_URL} (.venv/bin/plainsong-mcp --http --port 8765)`);
  }
  log(`├─ both organs alive: cell-cascade worker + plainsong-mcp ${(mcpInfo as { version?: string }).version ?? ''}`);

  // ── 1. grow the organism: zygote → spine + cortex ──────────────────────
  const org = await api<{ zygote: { id: string } }>('/organism', { name: ORG });
  const zygote = org.zygote.id;
  const metro = await api<{ child: { id: string } }>('/cell', {
    organism: ORG, name: 'metronome', from_cell: zygote, role: 'the spine — keeps time',
    tier: 'sclerotic', sheet_patch: metronomeSheet(EVERY),
  });
  const band = await api<{ child: { id: string } }>('/cell', {
    organism: ORG, name: 'bandleader', from_cell: zygote, role: 'the cortex — composes on the downbeat',
    tier: 'totipotent', sheet_patch: bandleaderSheet({ model: MODEL, style: STYLE, maxTokens: MAX_TOKENS }),
  });
  const critic = await api<{ child: { id: string } }>('/cell', {
    organism: ORG, name: 'critic', from_cell: zygote, role: 'the ear — judges the bars the bandleader wrote',
    tier: 'multipotent', sheet_patch: criticSheet({ model: CRITIC_MODEL }),
  });
  const metroId = metro.child.id, bandId = band.child.id, criticId = critic.child.id;
  writeFileSync(join(runDir, 'organism.json'), JSON.stringify({ organism: ORG, zygote, metronome: metroId, bandleader: bandId, critic: criticId, every: EVERY, changes: CHANGES, model: MODEL, critic_model: CRITIC_MODEL, gan_rounds: GAN_ROUNDS, gate_bands: { version: gateFile?.version ?? 0, path: gateFile ? GATE_PATH : null }, intent: INTENT }, null, 2));
  log(`├─ organism grown: zygote ${zygote} · metronome(sclerotic) ${metroId} · bandleader(totipotent) ${bandId} · critic(multipotent) ${criticId}`);

  // ── 2. the clock turns; the tissue works ───────────────────────────────
  const barLines: string[] = [];
  let tokens = 0, modelMs = 0, tableMs = 0, composes = 0, composeErrors = 0;
  // v0.3 counters: the critic's serve-split and the GAN ledger
  let cheapServes = 0, seamServes = 0, seamFailures = 0, critiques = 0;
  let revisions = 0, earlyAccepts = 0, analyzeFailures = 0;
  const acceptedVia: Record<string, number> = {};
  let carriedSteering: SteeringHints | null = null;
  for (let tick = 1; tick <= TICKS; tick++) {
    const tp = tickPayload(tick, EVERY);
    const fired = await api<Fired>('/signal', { from: 'clock', to: metroId, kind: 'tick', payload: tp });
    tableMs += fired.fired?.latency_ms ?? 0;
    const action = String((fired.fired?.response as Record<string, unknown> | undefined)?.action ?? '');
    jlog({ tick, beat: tp.beat, mode: fired.mode, action, latency_ms: fired.fired?.latency_ms, myelin: fired.myelin?.fire_count });
    if (fired.mode !== 'table') die(`tick ${tick}: metronome served "${fired.mode}" — the spine must be table tissue`);
    if (action === 'compose') {
      const barIndex = composes;
      const recent = barLines.slice(-2);

      // v0.3: ONE COMPOSE CYCLE = up to GAN_ROUNDS rounds through the ear.
      // The loop lives in src/critic.ts (composeCycle); the driver supplies
      // only IO: the worker's /signal and the MCP's analyze_features.
      // Round 2+ fires only when the critic says revise — a bar that stands
      // on round 1 saves a model call (that is the tumor going down).
      const cycle = await composeCycle({
        fireCompose: async payload => {
          const thought = await api<Fired>('/signal', { from: metroId, to: bandId, kind: 'compose', payload });
          const answer = String((thought.fired?.response as Record<string, unknown> | undefined)?.answer ?? '');
          const round = payload.steering ? ((payload.steering as SteeringHints).from_round + 1) : 1;
          jlog({ tick, compose: payload.bar_index, round, changes: payload.changes, mode: thought.mode, ok: thought.ok, tokens: thought.model_log?.total_tokens ?? null, latency_ms: thought.fired?.latency_ms ?? null, steered: Boolean(payload.steering), answer_head: answer.slice(0, 160) });
          if (thought.mode === 'model-required') {
            die(`compose ${payload.bar_index}: the boundary stayed honest — "${thought.mode}". Configure sheet.model + MODEL_BASE_URL/MODEL_KEY; nothing was faked.`);
          }
          if (thought.mode !== 'model' || !thought.ok) return { ok: false, mode: thought.mode, answer: '', latencyMs: thought.fired?.latency_ms ?? 0 };
          tokens += thought.model_log?.total_tokens ?? 0;
          modelMs += thought.fired?.latency_ms ?? 0;
          return { ok: true, mode: thought.mode, answer, latencyMs: thought.fired?.latency_ms ?? 0 };
        },
        fireCritique: async payload => {
          const serve = String(payload.serve);
          const fired = await api<Fired>('/signal', { from: bandId, to: criticId, kind: 'critique', payload });
          const answer = String((fired.fired?.response as Record<string, unknown> | undefined)?.answer ?? '');
          jlog({ tick, critique: payload.bar_index, round: payload.round, serve, mode: fired.mode, ok: fired.ok, verdict: payload.verdict, latency_ms: fired.fired?.latency_ms ?? null });
          critiques++;
          if (serve === 'cheap') cheapServes++;
          else { seamServes++; if (fired.mode !== 'model' || !fired.ok) seamFailures++; }
          if (fired.mode === 'model' && fired.ok) {
            tokens += fired.model_log?.total_tokens ?? 0;
            modelMs += fired.fired?.latency_ms ?? 0;
          }
          return { ok: fired.ok && fired.mode === 'model', mode: fired.mode, answer };
        },
        analyze: async (acceptedSoFar, candidate) => {
          const partial = assembleScore({ title: 'review', key: KEY, tempo: TEMPO }, [...acceptedSoFar, ...candidate]);
          const res = await mcpCall('analyze_features', { content: partial, voice: 'piano' });
          if (res.isError || res.text.startsWith('error:')) {
            analyzeFailures++;
            log(`├─ ✗ ear unavailable (analyze_features: ${res.text.slice(0, 120)}) — cycle degrades honestly to v0.2, no critique invented`);
            return null;
          }
          try {
            const trace = traceFromReport(JSON.parse(res.text));
            return trace.slice(-candidate.length);
          } catch { analyzeFailures++; return null; }
        },
      }, {
        barIndex, changes: CHANGES[barIndex % CHANGES.length], bars: BARS_PER,
        recent, intent: INTENT, steering: carriedSteering, ganRounds: GAN_ROUNDS,
        key: KEY, tempo: TEMPO,
        extract: (reply, n) => extractNotationBars(reply, n).lines,
      });

      const servedRounds = cycle.rounds.filter(r => r.bars.length > 0);
      if (!servedRounds.length) {
        composeErrors++;
        log(`├─ ✗ compose ${barIndex} served nothing — logged, organism carries on`);
        continue;
      }
      composes++;
      const final = servedRounds[servedRounds.length - 1];
      barLines.push(...final.bars);
      if (servedRounds.length > 1) revisions++; else earlyAccepts++;
      acceptedVia[cycle.acceptedVia] = (acceptedVia[cycle.acceptedVia] ?? 0) + 1;
      carriedSteering = cycle.steering;   // the critique feeds the NEXT compose payload
      // v0.4: the MINT'S ORE — every judged band reading lands in the
      // ledger with its provenance. The mint pass scans these `gate` lines;
      // repeated same-direction verdicts grow the gate's bands.
      for (const r of cycle.rounds) {
        if (!r.critique) continue;
        const evidence = r.critique.observations
          .filter(o => o.kind === 'band')
          .map(o => ({
            channel: o.channel, side: o.value < (o.target_lo ?? 0) ? 'low' : 'high',
            bar: o.bar ?? null, value: Math.round(o.value * 1000) / 1000,
            target_lo: o.target_lo, target_hi: o.target_hi,
            judged: o.note.startsWith('seam:') ? 'seam' : 'gate',
            severity: o.severity,
            resolved: !o.note.includes('gray zone') || o.note.startsWith('seam:'),
            accepted: r.accepted,
          }));
        if (evidence.length) {
          jlog({ gate: true, tick, compose: barIndex, round: r.round, serve: r.serve, verdict: r.critique.verdict, gate_version: gateFile?.version ?? 0, evidence });
        }
      }
      log(`├─ tick ${String(tick).padStart(2)} · downbeat → compose ${String(barIndex).padStart(2)} (${String(CHANGES[barIndex % CHANGES.length]).padEnd(5)}) · ${servedRounds.length} round(s) · critic: ${final.critique?.verdict ?? 'unheard'} · accepted: ${cycle.acceptedVia}${final.seamFailed ? ' (seam answer unusable — the cheap verdict stood)' : ''}`);
      for (const r of servedRounds) {
        log(`│   r${r.round}${r.critique ? ` [${r.critique.verdict}${r.serve !== 'none' ? ` · ${r.serve}` : ''}]${r.accepted ? ' ✓' : ''}` : ' [ear unavailable]'}`);
        log(`│   ${r.bars.join('\n│   ')}`);
        if (r.critique && r.critique.verdict === 'revise') {
          for (const o of r.critique.observations.filter(x => x.severity !== 'ok').slice(0, 3)) {
            log(`│     ⌐ ${o.channel}: ${o.note}`);
          }
        }
      }
    } else {
      log(`├─ tick ${String(tick).padStart(2)} · beat ${tp.beat} · wait`);
    }
    await new Promise(r => setTimeout(r, 120)); // the clock's breath — ticks are audible in the log
  }

  // ── 3. the score the organism wrote ────────────────────────────────────
  log(`╰─ ${TICKS} ticks · ${composes} compose cycles served (${composeErrors} failed) · ${tokens} tokens · spine ${tableMs}ms / cortex+ear ${modelMs}ms`);
  log(`  the ear: ${critiques} critiques — ${cheapServes} served by the frozen gate (cost 0), ${seamServes} through the seam${seamFailures ? ` (${seamFailures} seam failures, cheap verdict stood)` : ''} · ${revisions} revision round(s), ${earlyAccepts} stood on round 1`);
  if (!barLines.length) die('the organism wrote no bars — see tick-log.jsonl; nothing was faked');
  const title = `${ORG} — what the organism wrote`;
  const score = assembleScore({ title, key: KEY, tempo: TEMPO }, barLines);
  const songPath = join(runDir, `${ORG}.song`);
  writeFileSync(songPath, score);
  log(`  score: ${songPath} (${barLines.length} bars)`);

  // ── 4. render through the plainsong MCP — compile_score ────────────────
  const compiled = await mcpCall('compile_score', { content: score });
  writeFileSync(join(runDir, 'compile-result.txt'), compiled.text);
  if (compiled.isError) die(`compile_score refused the score: ${compiled.text.slice(0, 400)}`);
  log(`  rendered: ${compiled.text.split('\n')[0]}`);

  // the MCP writes MIDI into ITS sandbox; the result text prints the path —
  // copy the artifact next to the run so the tune travels with its evidence
  const midiPath = /midi\s+(\S+\.mid)/.exec(compiled.text)?.[1];
  if (midiPath && existsSync(midiPath)) {
    copyFileSync(midiPath, join(runDir, `${ORG}.mid`));
    log(`  midi:    ${join(runDir, `${ORG}.mid`)}`);
  }

  // ── 5. the run report — what the connectome now knows ──────────────────
  const health = await api<Record<string, unknown>>(`/organism/${ORG}/health`, undefined, 'GET');
  const report = {
    organism: ORG, run: runDir, ticks: TICKS, every: EVERY,
    bars_written: barLines.length, composes_served: composes, compose_errors: composeErrors,
    tokens, model_ms: modelMs, table_ms: tableMs,
    changes: CHANGES, model: MODEL,
    compile: compiled.text.split('\n')[0],
    gan: {
      rounds_configured: GAN_ROUNDS,
      accepted_via: acceptedVia,
      gate_bands: { version: gateFile?.version ?? 0, path: gateFile ? GATE_PATH : null, standing: gateFile?.bands ?? null, intent_run: INTENT },
      critique_serve: {
        critiques, cheap: cheapServes, seam: seamServes, seam_failures: seamFailures,
        cheap_pct: critiques ? Math.round((cheapServes / critiques) * 1000) / 10 : null,
        seam_pct: critiques ? Math.round((seamServes / critiques) * 1000) / 10 : null,
      },
      revision_rounds: revisions, early_accepts: earlyAccepts, analyze_failures: analyzeFailures,
      intent: INTENT,
    },
    health: {
      serve_modes_pct: health.serve_modes_pct ?? null,
      zero_cost_serve_pct: health.zero_cost_serve_pct ?? null,
      cost_tumor: health.cost_tumor ?? null,
      serve_split: health.serve_split ?? null,
    },
    wiring: {
      spine: `clock →(tick)→ ${metroId} [sclerotic · rule table · cost 0]`,
      cortex: `${metroId} →(compose)→ ${bandId} [totipotent · model seam · ${MODEL}]`,
      ear: `${bandId} →(critique)→ ${criticId} [multipotent · frozen gate cost 0 · seam ${CRITIC_MODEL} only on ambiguity]`,
      loop: `compose → analyze_features → critique → steering → next compose payload (${GAN_ROUNDS} round cap)`,
      hands: `driver accumulates bars → plainsong MCP compile_score → MIDI`,
    },
  };
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  log(`  report: ${join(runDir, 'report.json')}`);
  log(`\n  THE ORGANISM WROTE A TUNE — ${barLines.length} bars, spine kept time, cortex composed, the EAR judged ${critiques} time(s) at ${critiques ? Math.round((cheapServes / critiques) * 100) : 100}% cost 0.`);
}

main().catch(e => die(e instanceof Error ? e.message : String(e)));
