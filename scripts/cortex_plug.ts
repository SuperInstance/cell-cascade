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
import { planLibretto, librettistSheet, outlineForBar, nudgeTargets, ARC_DRIFT_TOL } from '../src/librettist';
import {
  parseChord, bassForBar, bassCellSheet, normalizeBassLine,
  drumForBar, drumFill, drumCellSheet, normalizeDrumLine,
  arrangerSheet, stockBarFor, loadArrangerVoicings, saveArrangerVoicings, mintArrangerVoicings,
  partContent, parseEnsembleWriteResult, midiOfName, normalizeToVoice, uniquifySections,
  defaultArrangerVoicings, type StockVoicing,
} from '../src/ensemble';

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
// v0.5: ENSEMBLE=1 grows the full band (bass cell, drum cell, arranger under
// the bandleader, plainsong ensemble session). Default stays SOLO PIANO —
// the v0.4 loop byte-for-byte.
const ENSEMBLE = ['1', 'true', 'yes'].includes(String(env.ENSEMBLE ?? '').toLowerCase());
const DRUM_STYLE = env.DRUM_STYLE ?? 'swing';
const ARRANGER_PATH = env.ARRANGER_VOICINGS ?? 'gate/arranger-voicings.json';
const arrangerFile = ENSEMBLE ? loadArrangerVoicings(ARRANGER_PATH) ?? defaultArrangerVoicings() : null;
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
  candidate_id: number | null;   // v0.5: escalations leave distillation candidates
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

/** The last note of a voice's latest bar (the bass's walking tail — what
 *  the next line voice-leads from). */
function midiOfLast(line: string): number | null {
  const toks = line.split('|')[1]?.trim().split(/\s+/) ?? [];
  for (let i = toks.length - 1; i >= 0; i--) {
    if (toks[i] === '.') continue;
    const notes = toks[i].split('-');
    const midi = midiOfName(notes[notes.length - 1]);
    if (midi > 0) return midi;
  }
  return null;
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
  // v0.4: THE LIBRETTIST — score-level memory, sclerotic tissue (the plan
  // IS a rule table, cost 0). Holds form + tension arc + narrative; the
  // driver tracks the cursor and lets the arc evolve (nudgeTargets).
  const TOTAL_BARS = Math.max(1, Math.ceil(TICKS / EVERY)) * BARS_PER;
  const libretto = planLibretto({ bars: TOTAL_BARS, form: env.FORM || undefined });
  let arcTargets = [...libretto.tension_targets];
  const realizedTensions: number[] = [];
  const lib = await api<{ child: { id: string } }>('/cell', {
    organism: ORG, name: 'librettist', from_cell: zygote, role: 'the plan — holds the form and the tension arc',
    tier: 'sclerotic', sheet_patch: librettistSheet(libretto),
  });
  const libId = lib.child.id;
  let metroId = metro.child.id, bandId = band.child.id, criticId = critic.child.id;

  // ── 1b. v0.5: ENSEMBLE=1 grows the band — arranger under the bandleader,
  // bass + drum cells, and a plainsong ensemble session (the wire). Voices
  // disjoint: @piano belongs to the compose cycle, @bass to the bass cell,
  // @drums to the drum cell — and every served line is normalized to its
  // voice before it reaches the session. ONE CLOCK: all of it hangs off the
  // same metronome downbeat the solo loop already turns on.
  let bassId: string | null = null, drumId: string | null = null, arrangerId: string | null = null;
  let session: string | null = null;
  const voiceVersion: Record<string, number> = { piano: 0, bass: 0, drums: 0 };
  const voiceBars: Record<string, string[]> = { piano: [], bass: [], drums: [] };
  let ensWrites = 0, ensRebases = 0, ensWriteFailures = 0;
  // the wire's section names are UNIQUE (AABA → A, A2, B, A3): the session
  // merge is deterministic on unique names — repeated letters concatenate
  const sessionSections = uniquifySections(libretto.sections);
  const arrStats = { hits: 0, misses: 0, escalations: 0, mints: 0, held: 0, unclean: 0 };
  const bassStats = { table: 0, escalated: 0, failed: 0 };
  const drumStats = { table: 0, seam: 0, seamFailures: 0 };
  const pendingCandidates: Array<{ id: number; chord: string; stock: StockVoicing }> = [];
  let arrVoicings = arrangerFile ? { ...arrangerFile.voicings } : {};

  async function writePart(voice: 'piano' | 'bass' | 'drums'): Promise<boolean> {
    if (!session) return false;
    const content = partContent(sessionSections, voice, voiceBars[voice]);
    if (!content) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await mcpCall('ensemble_write_part', {
        session, voice: `@${voice}`, agent: ORG, base_version: voiceVersion[voice], content,
        summary: `${voice} — bars ${voiceBars[voice].length} so far`,
      });
      const parsed = parseEnsembleWriteResult(res.text);
      if (parsed.accepted) { voiceVersion[voice] = parsed.version; ensWrites++; jlog({ ens_write: true, voice, version: parsed.version, bars: voiceBars[voice].length }); return true; }
      if (parsed.rebaseVersion !== null) {
        ensRebases++;
        jlog({ ens_write: false, voice, rebase: true, voice_version: parsed.rebaseVersion, error: parsed.error });
        voiceVersion[voice] = parsed.rebaseVersion;
        continue;             // rebase onto the current state, write again
      }
      ensWriteFailures++;
      jlog({ ens_write: false, voice, error: parsed.error ?? res.text.slice(0, 200) });
      return false;
    }
    ensWriteFailures++;
    return false;
  }

  if (ENSEMBLE) {
    // the arranger: differentiated UNDER the bandleader — seeded with any
    // voicings the mint file holds (cross-run canon), everything else is a
    // hole the escalation ledger records.
    const arr = await api<{ child: { id: string } }>('/cell', {
      organism: ORG, name: 'arranger', from_cell: bandId, role: 'the chart — stock voicings served free, novelty escalates',
      tier: 'differentiated', sheet_patch: arrangerSheet(arrVoicings),
    });
    arrangerId = arr.child.id;
    const bassCell = await api<{ child: { id: string } }>('/cell', {
      organism: ORG, name: 'bass', from_cell: bandId, role: 'the floor — walking shells locked to the changes',
      tier: 'differentiated', sheet_patch: bassCellSheet(),
    });
    bassId = bassCell.child.id;
    const drumCell = await api<{ child: { id: string } }>('/cell', {
      organism: ORG, name: 'drums', from_cell: bandId, role: 'the kit — preset tissue, fills think',
      tier: 'multipotent', sheet_patch: drumCellSheet(),
    });
    drumId = drumCell.child.id;

    // the wire: one session, three voices, one owner (the driver) — the
    // conflict protocol still stands: writes go against the voice version,
    // a stale write is refused and rebased, never silently overwritten.
    session = `${ORG}-band`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const opened = await mcpCall('ensemble_open', {
      session, title: `${ORG} — what the organism wrote`, key: KEY, tempo: TEMPO,
      bars: TOTAL_BARS,
      sections: sessionSections.map(s => ({ name: s.name, description: `${s.role} — ${s.bars} Bars`, bars: s.bars })),
      voices: ['@piano', '@bass', '@drums'],
    });
    if (opened.isError) die(`ensemble_open refused: ${opened.text.slice(0, 200)}`);
    for (const voice of ['piano', 'bass', 'drums'] as const) {
      const joined = await mcpCall('ensemble_join', { session, voice: `@${voice}`, agent: ORG });
      if (joined.isError) die(`ensemble_join @${voice} refused: ${joined.text.slice(0, 200)}`);
    }
    log(`├─ the band: arranger(differentiated) ${arrangerId} · bass(differentiated) ${bassId} · drums(multipotent) ${drumId}`);
    log(`├─ the wire: plainsong ensemble session "${session}" — @piano/@bass/@drums claimed, ${Object.keys(arrVoicings).length} stock voicing(s) held`);
  }
  writeFileSync(join(runDir, 'organism.json'), JSON.stringify({ organism: ORG, zygote, metronome: metroId, bandleader: bandId, critic: criticId, librettist: libId, ...(ENSEMBLE ? { arranger: arrangerId, bass: bassId, drums: drumId, ensemble_session: session } : {}), every: EVERY, changes: CHANGES, model: MODEL, critic_model: CRITIC_MODEL, gan_rounds: GAN_ROUNDS, ensemble: ENSEMBLE, libretto: { form: libretto.form, sections: libretto.sections, narrative: libretto.narrative }, gate_bands: { version: gateFile?.version ?? 0, path: gateFile ? GATE_PATH : null }, arranger_voicings: { version: arrangerFile?.version ?? 0, held: Object.keys(arrVoicings).length }, intent: INTENT }, null, 2));
  log(`├─ organism grown: zygote ${zygote} · metronome(sclerotic) ${metroId} · bandleader(totipotent) ${bandId} · critic(multipotent) ${criticId} · librettist(sclerotic) ${libId}`);
  log(`├─ the plan: ${libretto.form} over ${TOTAL_BARS} bars — ${libretto.narrative}`);

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
      // v0.4: BARS_PER > 1 amortizes compose latency — one thought writes a
      // multi-bar window; bar_index advances by BARS_PER per served cycle,
      // and `changes` spans the cycle's chords comma-joined (one per bar).
      const barIndex = composes * BARS_PER;
      const cycleChanges = Array.from({ length: BARS_PER }, (_, i) => CHANGES[(barIndex + i) % CHANGES.length]).join(', ');
      const recent = barLines.slice(-2);

      // v0.4: consult the librettist — the outline signal serves the plan
      // from sclerotic tissue (cost 0), and the driver merges the cursor.
      const plan = await api<Fired>('/signal', { from: 'clock', to: libId, kind: 'outline', payload: { tick, bar: barIndex } });
      const planMode = plan.mode;
      const outline = outlineForBar(libretto, barIndex, arcTargets);
      jlog({ tick, outline: barIndex, mode: planMode, section: outline.section, arc: outline.arc, tension_target: outline.tension_target, latency_ms: plan.fired?.latency_ms ?? null });
      if (planMode !== 'table') log(`├─ ⚠ librettist served "${planMode}" (expected table) — the plan stands driver-side`);

      // v0.3: ONE COMPOSE CYCLE = up to GAN_ROUNDS rounds through the ear.
      // The loop lives in src/critic.ts (composeCycle); the driver supplies
      // only IO: the worker's /signal and the MCP's analyze_features.
      // Round 2+ fires only when the critic says revise — a bar that stands
      // on round 1 saves a model call (that is the tumor going down).
      let lastTrace: TraceBar[] | null = null;   // realized tension for the arc controller
      const windowChords = Array.from({ length: BARS_PER }, (_, i) => CHANGES[(barIndex + i) % CHANGES.length]);
      const serveFirst = ENSEMBLE && arrangerId ? async (payload: Record<string, unknown>) => {
        const bars: string[] = [];
        let anyEscalated = false;
        for (let i = 0; i < BARS_PER; i++) {
          const chord = windowChords[i];
          const tTarget = arcTargets[(barIndex + i) % arcTargets.length] ?? 0.5;
          const arranged = await api<Fired>('/signal', {
            from: metroId, to: arrangerId!, kind: 'arrange',
            payload: { ...payload, chord, bar_index: barIndex + i, changes: chord, bars: 1, tension_target: tTarget },
          });
          const resp = (arranged.fired?.response ?? {}) as Record<string, unknown>;
          if (arranged.mode === 'table') {
            arrStats.hits++;
            const stock = arrVoicings[chord];
            jlog({ tick, arrange: barIndex + i, chord, mode: 'table', voicing: stock?.core ?? resp.core ?? null });
            if (stock) { bars.push(stockBarFor(stock, tTarget)); continue; }
            // table hit but the driver holds no stock — impossible unless
            // the sheet was hand-edited; fall through to escalation below.
          }
          // MISS: the arranger's hole — either the worker escalated to the
          // bandleader (mode 'escalated', the real spend) or it could not
          // (escalation-failed) → null lets the bandleader compose instead.
          arrStats.misses++;
          if (arranged.mode === 'escalated' && arranged.ok) {
            arrStats.escalations++;
            anyEscalated = true;
            tokens += arranged.model_log?.total_tokens ?? 0;
            modelMs += arranged.fired?.latency_ms ?? 0;
            const answer = String(resp.answer ?? '');
            jlog({ tick, arrange: barIndex + i, chord, mode: arranged.mode, answered_by: (resp.answered_by as Record<string, unknown>)?.name ?? 'bandleader', candidate: arranged.candidate_id, tokens: arranged.model_log?.total_tokens ?? null, answer_head: answer.slice(0, 160) });
            const ex = extractNotationBars(answer, 1).lines;
            if (!ex.length) continue;                     // honest: nothing served this bar
            const normalized = normalizeToVoice(ex[0], 'piano');
            bars.push(normalized);
            if (arranged.candidate_id) pendingCandidates.push({ id: arranged.candidate_id, chord, stock: { chord, core: [], rhythm: [], vel: 68, minted_from: { run: runDir, bar: barIndex + i } } });
          } else {
            jlog({ tick, arrange: barIndex + i, chord, mode: arranged.mode, ok: arranged.ok, error: resp.error ?? resp.reason ?? null });
            return null;                                  // the bandleader composes the window
          }
        }
        return bars.length === BARS_PER ? { bars, serve: (anyEscalated ? 'arranger-escalated' : 'arranger-table') as 'arranger-escalated' | 'arranger-table' } : null;
      } : undefined;
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
            lastTrace = trace.slice(-candidate.length);
            return lastTrace;
          } catch { analyzeFailures++; return null; }
        },
      }, {
        barIndex, changes: cycleChanges, bars: BARS_PER,
        recent, intent: INTENT, steering: carriedSteering, ganRounds: GAN_ROUNDS,
        key: KEY, tempo: TEMPO,
        outline: outline as unknown as Record<string, unknown>,
        tensionTargets: arcTargets.slice(barIndex, barIndex + BARS_PER),
        extract: (reply, n) => extractNotationBars(reply, n).lines,
        serveFirst,
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
        log(`│   r${r.round}${r.via === 'arranger' ? ' [arranged]' : ''}${r.critique ? ` [${r.critique.verdict}${r.serve !== 'none' ? ` · ${r.serve}` : ''}]${r.accepted ? ' ✓' : ''}` : ' [ear unavailable]'}`);
        log(`│   ${r.bars.join('\n│   ')}`);
        if (r.critique && r.critique.verdict === 'revise') {
          for (const o of r.critique.observations.filter(x => x.severity !== 'ok').slice(0, 3)) {
            log(`│     ⌐ ${o.channel}: ${o.note}`);
          }
        }
      }

      // ── v0.5: the band answers the same downbeat — bass walks, drums
      // keep the style (a fill only at the section's edge), and every part
      // lands in the ensemble session against its base version. ONE CLOCK:
      // all of it inside the same tick the metronome rang.
      if (ENSEMBLE && session && bassId && drumId) {
        const pianoVia = servedRounds[servedRounds.length - 1].via ?? 'compose';
        for (let i = 0; i < BARS_PER; i++) {
          const bi = barIndex + i;
          const chord = parseChord(windowChords[i]);
          const next = parseChord(windowChords[(i + 1) % Math.max(1, BARS_PER)] ?? CHANGES[(bi + 1) % CHANGES.length]);
          const tTarget = arcTargets[bi % arcTargets.length] ?? 0.5;

          // BASS: the walking table serves the shell line (cost 0); an
          // unknown quality misses → the lineage escalates to the
          // bandleader, and the answer is normalized into c1..b2.
          const bassBar = await (async () => {
            const walked = bassForBar(chord, next, voiceBars.bass.length ? midiOfLast(voiceBars.bass[voiceBars.bass.length - 1]) : null, tTarget);
            const bassFired = await api<Fired>('/signal', {
              from: metroId, to: bassId!, kind: 'compose_bass',
              payload: { chord: chord.symbol, quality: chord.quality, bar_index: bi, next: next.symbol, known: chord.known },
            });
            jlog({ tick, bass: bi, chord: chord.symbol, quality: chord.quality, mode: bassFired.mode, ok: bassFired.ok });
            if (bassFired.mode === 'table') {
              bassStats.table++;
              return walked?.line ?? null;   // the sheet and the driver share the frozen table
            }
            bassStats.escalated++;
            const answer = String(((bassFired.fired?.response ?? {}) as Record<string, unknown>).answer ?? '');
            const ex = extractNotationBars(answer, 1).lines;
            if (bassFired.mode === 'escalated' && ex.length) {
              tokens += bassFired.model_log?.total_tokens ?? 0;
              modelMs += bassFired.fired?.latency_ms ?? 0;
              return normalizeBassLine(ex[0]);
            }
            bassStats.failed++;
            return walked?.line ?? null;     // the pure line stands — the shell never drops out
          })();
          if (bassBar) voiceBars.bass.push(bassBar);

          // DRUMS: preset tissue (cost 0). At the section's edge the driver
          // asks for the turnaround fill — a fill the table does not hold
          // misses to the cell's own scoped model (fills escalate ONLY on
          // miss, and the default run never misses).
          const outlineThis = outlineForBar(libretto, bi, arcTargets);
          const atSectionEnd = outlineThis.bar_in_section === outlineThis.bars_in_section;
          const drumBar = await (async () => {
            const kind = atSectionEnd ? 'fill_drums' : 'compose_drums';
            const payload = atSectionEnd ? { kind_of: 'turnaround', bar_index: bi } : { style: DRUM_STYLE, bar_index: bi };
            const drumFired = await api<Fired>('/signal', { from: metroId, to: drumId!, kind, payload });
            jlog({ tick, drums: bi, kind, ...(atSectionEnd ? { fill: 'turnaround' } : { style: DRUM_STYLE }), mode: drumFired.mode, ok: drumFired.ok });
            if (drumFired.mode === 'table') { drumStats.table++; return (atSectionEnd ? drumFill('turnaround', tTarget) : drumForBar(DRUM_STYLE, tTarget))?.line ?? null; }
            drumStats.seam++;
            const answer = String(((drumFired.fired?.response ?? {}) as Record<string, unknown>).answer ?? '');
            const ex = extractNotationBars(answer, 1).lines;
            if (ex.length) { tokens += drumFired.model_log?.total_tokens ?? 0; modelMs += drumFired.fired?.latency_ms ?? 0; return normalizeDrumLine(ex[0]); }
            drumStats.seamFailures++;
            return (atSectionEnd ? drumFill('turnaround', tTarget) : drumForBar(DRUM_STYLE, tTarget))?.line ?? null;
          })();
          if (drumBar) voiceBars.drums.push(drumBar);
        }
        voiceBars.piano.push(...final.bars);
        for (const v of ['piano', 'bass', 'drums'] as const) await writePart(v);

        // THE ARRANGER MINT: the accepted piano bars (stock or bandleader-
        // written) whose chord the chart does not hold mint in — the
        // bandleader signs its own shells (seam-lineage trust). The grown
        // rule resolves the escalation candidate on the worker (the next
        // arrange of this chord HITS the worker table at cost 0) and the
        // versioned file persists the canon across runs.
        const mintable = final.bars.map((line, i) => ({ barLine: line, chord: windowChords[i] ?? CHANGES[(barIndex + i) % CHANGES.length], barIndex: barIndex + i }));
        const mintRes = mintArrangerVoicings({ version: arrangerFile?.version ?? 0, voicings: arrVoicings, history: arrangerFile?.history ?? [] }, mintable, runDir);
        arrVoicings = mintRes.file.voicings;
        arrStats.mints += mintRes.mints.length;
        arrStats.held += mintRes.held.length;
        arrStats.unclean += mintRes.unclean.length;
        for (const m of mintRes.mints) {
          log(`│   ◆ arranger mint: ${m.chord} → ${m.core.join('-')} (rhythm ${m.rhythm.map(x => x ? 'x' : '·').join('')})`);
          const pend = pendingCandidates.find(p => p.chord === m.chord);
          if (pend) {
            const resolved = await api<{ rules_now: number }>('/candidates/' + pend.id + '/resolve', {
              status: 'distilled',
              rule: {
                when: { kind: 'arrange', payload_equals: { chord: m.chord } },
                respond: { serve: 'table', cost: 0, chord: m.chord, core: m.core, rhythm: m.rhythm, vel: m.vel, hint: `grown from run ${runDir} bar ${m.minted_from.bar} — the bandleader's own shell` },
              },
              evidence_ref: `${runDir}/tick-log.jsonl arrange ${m.minted_from.bar} (${m.chord})`,
              gardener_verdict: `arranger mint: ${m.chord} shell distilled from the accepted bar`,
            }).catch(() => null);
            jlog({ arranger_mint: true, chord: m.chord, core: m.core, candidate: pend.id, resolved: Boolean(resolved), piano_via: pianoVia });
            pendingCandidates.splice(pendingCandidates.indexOf(pend), 1);
          } else {
            jlog({ arranger_mint: true, chord: m.chord, core: m.core, candidate: null, piano_via: pianoVia });
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

  // ── 4b. v0.5: render the BAND through the ensemble session and persist
  // the arranger's grown canon. The session merge is the wire's own; the
  // parts were written per downbeat against their base versions.
  let ensRender: { ok: boolean; midi: string | null; summary: string } | null = null;
  if (ENSEMBLE && session) {
    const rendered = await mcpCall('ensemble_render', { session });
    writeFileSync(join(runDir, 'ensemble-render.txt'), rendered.text);
    if (rendered.isError) {
      log(`  ✗ ensemble_render refused: ${rendered.text.slice(0, 200)}`);
      ensRender = { ok: false, midi: null, summary: rendered.text.split('\n')[0].slice(0, 200) };
    } else {
      try {
        const r = JSON.parse(rendered.text) as { midi?: string; summary?: Record<string, unknown> };
        if (r.midi && existsSync(r.midi)) {
          copyFileSync(r.midi, join(runDir, `${ORG}-band.mid`));
          log(`  band midi: ${join(runDir, `${ORG}-band.mid`)} (ensemble_render: ${session})`);
        }
        ensRender = { ok: true, midi: r.midi ?? null, summary: JSON.stringify(r.summary ?? {}).slice(0, 300) };
      } catch {
        ensRender = { ok: true, midi: null, summary: rendered.text.split('\n')[0].slice(0, 200) };
      }
    }
    // persist the arranger canon (versioned, reversible-by-history)
    if (arrStats.mints > 0 && arrangerFile) {
      const before = Object.keys(arrangerFile.voicings ?? {});
      const mintedChords = Object.keys(arrVoicings).filter(c => !before.includes(c));
      const persisted = {
        version: (arrangerFile.version || 0) + 1,
        voicings: arrVoicings,
        history: [...(arrangerFile.history ?? []), {
          version: (arrangerFile.version || 0) + 1, at: new Date().toISOString(), kind: 'mint' as const,
          chords: mintedChords, run: runDir,
          bars: mintedChords.map(c => arrVoicings[c]?.minted_from.bar ?? 0),
        }],
      };
      saveArrangerVoicings(ARRANGER_PATH, persisted);
      log(`  arranger canon: ${ARRANGER_PATH} v${persisted.version} — ${Object.keys(arrVoicings).length} voicing(s) held (${arrStats.mints} minted this run)`);
    }
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
    ...(ENSEMBLE ? {
      ensemble: {
        session, drum_style: DRUM_STYLE,
        voices: { piano: voiceBars.piano.length, bass: voiceBars.bass.length, drums: voiceBars.drums.length },
        writes: ensWrites, rebases: ensRebases, write_failures: ensWriteFailures,
        render: ensRender,
        arranger: {
          file_version_before: arrangerFile?.version ?? 0,
          held_at_start: arrangerFile ? Object.keys(arrangerFile.voicings).length : 0,
          held_at_end: Object.keys(arrVoicings).length,
          hits: arrStats.hits, misses: arrStats.misses, escalations: arrStats.escalations,
          mints: arrStats.mints, held: arrStats.held, unclean: arrStats.unclean,
          voicings: arrVoicings,
        },
        bass: { ...bassStats },
        drums: { ...drumStats },
      },
    } : {}),
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
      plan: `clock →(outline)→ ${libId} [sclerotic · ${libretto.form} · tension arc · cost 0]`,
      loop: `outline → compose → analyze_features → critique (bands + arc) → steering → next compose payload (${GAN_ROUNDS} round cap)`,
      mint: `gate evidence lines → tick-log.jsonl → npm run mint:bands → gate-bands.json v${gateFile?.version ?? 0} (loaded at startup)`,
      ...(ENSEMBLE ? {
        arranger: `${metroId} →(arrange)→ ${arrangerId} [differentiated · under the bandleader · stock hits cost 0 · misses escalate + mint]`,
        floor: `${metroId} →(compose_bass)→ ${bassId} [differentiated · rule-table voice-leading · c1..b2 · unknown quality escalates]`,
        kit: `${metroId} →(compose_drums|fill_drums)→ ${drumId} [multipotent · style presets cost 0 · fills think only on miss]`,
        wire: `plainsong ensemble session "${session}" — join/write_part (base_version, conflict rebase)/render · ONE CLOCK: the metronome's downbeat fires the whole band`,
      } : {}),
      hands: `driver accumulates bars → plainsong MCP compile_score → MIDI`,
    },
  };
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  log(`  report: ${join(runDir, 'report.json')}`);
  if (ENSEMBLE) {
    const arrPct = (arrStats.hits + arrStats.misses) ? Math.round(arrStats.hits / (arrStats.hits + arrStats.misses) * 100) : null;
    log(`\n  THE ORGANISM WROTE A BAND — ${barLines.length} bars × 3 voices on one clock · arranger: ${arrStats.hits} stock hit(s) / ${arrStats.escalations} escalation(s) / ${arrStats.mints} mint(s)${arrPct !== null ? ` (${arrPct}% cost 0)` : ''} · bass ${bassStats.table} table / ${bassStats.escalated} escalated · drums ${drumStats.table} table / ${drumStats.seam} seam · session ${session} (v${voiceVersion.piano}, ${ensRebases} rebase(s)).`);
  } else {
    log(`\n  THE ORGANISM WROTE A TUNE — ${barLines.length} bars, spine kept time, cortex composed, the EAR judged ${critiques} time(s) at ${critiques ? Math.round((cheapServes / critiques) * 100) : 100}% cost 0.`);
  }
}

main().catch(e => die(e instanceof Error ? e.message : String(e)));
