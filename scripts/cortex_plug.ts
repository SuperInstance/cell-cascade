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
  bandleaderSheet, metronomeSheet, tickPayload, composePayload,
  extractNotationBars, assembleScore, mcpToolCall, parseMcpToolResult,
} from '../src/cortex';

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
    tier: 'totipotent', sheet_patch: bandleaderSheet({ model: MODEL, style: STYLE }),
  });
  const metroId = metro.child.id, bandId = band.child.id;
  writeFileSync(join(runDir, 'organism.json'), JSON.stringify({ organism: ORG, zygote, metronome: metroId, bandleader: bandId, every: EVERY, changes: CHANGES, model: MODEL }, null, 2));
  log(`├─ organism grown: zygote ${zygote} · metronome(sclerotic) ${metroId} · bandleader(totipotent) ${bandId}`);

  // ── 2. the clock turns; the tissue works ───────────────────────────────
  const barLines: string[] = [];
  let tokens = 0, modelMs = 0, tableMs = 0, composes = 0, composeErrors = 0;
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
      const payload = composePayload({
        barIndex, changes: CHANGES[barIndex % CHANGES.length], bars: BARS_PER,
        key: KEY, tempo: TEMPO, recent,
      });
      const thought = await api<Fired>('/signal', { from: metroId, to: bandId, kind: 'compose', payload });
      const answer = String((thought.fired?.response as Record<string, unknown> | undefined)?.answer ?? '');
      jlog({
        tick, compose: barIndex, changes: payload.changes, mode: thought.mode, ok: thought.ok,
        tokens: thought.model_log?.total_tokens ?? null, latency_ms: thought.fired?.latency_ms ?? null,
        answer_head: answer.slice(0, 160),
      });
      if (thought.mode === 'model-required') {
        die(`compose ${barIndex}: the boundary stayed honest — "${thought.mode}". Configure sheet.model + MODEL_BASE_URL/MODEL_KEY; nothing was faked.`);
      }
      if (thought.mode !== 'model' || !thought.ok) {
        composeErrors++;
        log(`├─ ✗ compose ${barIndex} (${payload.changes}) served "${thought.mode}" — logged, organism carries on`);
        continue;
      }
      composes++;
      tokens += thought.model_log?.total_tokens ?? 0;
      modelMs += thought.fired?.latency_ms ?? 0;
      const got = extractNotationBars(answer, BARS_PER);
      if (!got.lines.length) {
        composeErrors++;
        log(`├─ ✗ compose ${barIndex}: model answered but zero notation lines survived the extractor — logged raw`);
        writeFileSync(join(runDir, `raw-compose-${barIndex}.txt`), answer);
        continue;
      }
      barLines.push(...got.lines);
      log(`├─ tick ${String(tick).padStart(2)} · downbeat → compose ${String(barIndex).padStart(2)} (${String(payload.changes).padEnd(5)}) · ${thought.model_log?.completion_tokens ?? '?'} tok · ${thought.fired?.latency_ms ?? '?'}ms`);
      log(`│   ${got.lines.join('\n│   ')}`);
    } else {
      log(`├─ tick ${String(tick).padStart(2)} · beat ${tp.beat} · wait`);
    }
    await new Promise(r => setTimeout(r, 120)); // the clock's breath — ticks are audible in the log
  }

  // ── 3. the score the organism wrote ────────────────────────────────────
  log(`╰─ ${TICKS} ticks · ${composes} composes served by the cortex (${composeErrors} failed) · ${tokens} tokens · spine ${tableMs}ms / cortex ${modelMs}ms`);
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
    health: {
      serve_modes_pct: health.serve_modes_pct ?? null,
      zero_cost_serve_pct: health.zero_cost_serve_pct ?? null,
      cost_tumor: health.cost_tumor ?? null,
    },
    wiring: {
      spine: `clock →(tick)→ ${metroId} [sclerotic · rule table · cost 0]`,
      cortex: `${metroId} →(compose)→ ${bandId} [totipotent · model seam · ${MODEL}]`,
      hands: `driver accumulates bars → plainsong MCP compile_score → MIDI`,
    },
  };
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  log(`  report: ${join(runDir, 'report.json')}`);
  log(`\n  THE ORGANISM WROTE A TUNE — ${barLines.length} bars, spine kept time, cortex composed, hands rendered.`);
}

main().catch(e => die(e instanceof Error ? e.message : String(e)));
