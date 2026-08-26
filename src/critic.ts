// cell-cascade — src/critic.ts
// THE CRITIC CELL (v0.3). The multipotent EAR that closes the GAN loop
// inside the organism:
//
//   bandleader composes a bar ──► MCP analyze_features ──► per-bar trace
//        ▲                                                     │
//        │                                                     ▼
//   steering hints                                      THE CRITIC
//   (the next compose                                    [multipotent]
//    payload MUST honor)                        ┌────────────┴─────────────┐
//                                               │ cheap gate (cost 0):     │
//                                               │  feature bands + gray    │
//                                               │  zone + voice-leading    │
//                                               │  math — pure TS          │
//                                               └────────────┬─────────────┘
//                                          clear verdict     ambiguous (gray)
//                                               │              │
//                                          serve 'cheap'   serve 'seam' → the
//                                          (rule table,    model wearing the
//                                           mode 'table')  critic's prompt
//
// The serve-split is the design goal: the frozen gate answers every critique
// whose numbers sit clearly inside or outside the intent bands — only gray-
// zone judgments (within AMBIGUITY_BAND of a band edge) are worth a model
// call. That is what drives the cost-tumor down: judgment distills into
// cost-0 tissue, the seam shrinks to the genuinely ambiguous.
//
// The gate descends from the seamstress-eye (examples/seed.json): a frozen
// 6-feature measurement — note_density, syncopation, register_spread,
// rest_ratio, harmonic_tension, interval_size — the same channels the
// plainsong perception_trace serves per bar.

// ── the frozen gate ─────────────────────────────────────────────────────────

/** The six channels the critic watches (seamstress-eye lineage). */
export const CRITIC_FEATURES = [
  'note_density', 'syncopation', 'register_spread',
  'rest_ratio', 'harmonic_tension', 'interval_size',
] as const;
export type CriticChannel = (typeof CRITIC_FEATURES)[number];

/** Half-width of the gray zone around each band edge. A reading within this
 *  of an edge is AMBIGUOUS — the only case worth a model call. */
export const AMBIGUITY_BAND = 0.06;

/** |Δ avg_pitch| between consecutive bars above this is a voice-leading
 *  penalty (avg_pitch is normalized over the MIDI range; 0.10 ≈ a minor
 *  sixth leap between bar centroids — shells should glide, not teleport). */
export const VOICE_LEADING_JUMP = 0.1;

/** Tension curve must vary at least this much (stdev across bars) once the
 *  window reaches 4 bars — a flat harmonic_tension is an etude, not a tune. */
export const TENSION_MIN_STDDEV = 0.03;

export interface FeatureBand { lo: number; hi: number }

/** What the organism wants each bar (and the piece) to measure. The intent
 *  belongs to the ORGANISM (driver/health), never to the model. Defaults are
 *  CALIBRATED ON MEASUREMENT, not intuition: the v0.2 run's seven bars
 *  (runs/cortex-plug-2026-08-26T05-18-41, the tune the doc praised) through
 *  the same analyze_features — note_density .31–.38, register_spread .08–.15
 *  (the /127 normalization), rest_ratio 0–.125 (sustain-coverage semantics),
 *  interval_size .21–.85, syncopation .4–1.0, tension .54–.65. The bands
 *  hold the neighborhood those bars live in; violations are real wounds. */
export interface CriticIntent extends Record<CriticChannel, FeatureBand> {}

export function criticIntent(partial: Partial<CriticIntent> = {}): CriticIntent {
  const defaults: CriticIntent = {
    note_density: { lo: 0.15, hi: 0.6 },       // sparse ok, wall-to-wall is an etude
    syncopation: { lo: 0.2, hi: 1.0 },         // land some attacks off the beat
    register_spread: { lo: 0.05, hi: 0.25 },   // ~6–32 semitones across the voicing
    rest_ratio: { lo: 0.0, hi: 0.3 },          // sustained-coverage semantics (see above)
    harmonic_tension: { lo: 0.15, hi: 0.75 },  // the changes speak, none scream
    interval_size: { lo: 0.0, hi: 0.65 },      // mean interval ≤ ~8 semitones
  };
  return { ...defaults, ...partial };
}

// ── the trace the critic reads ──────────────────────────────────────────────

/** One bar of the perception trace (analyze_features per_bar shape, trimmed
 *  to what the gate needs). */
export interface TraceBar {
  bar: number;
  onsets?: number;
  features: Record<string, number>;
}

/** Pull TraceBars out of a raw analyze_features/perception_trace report —
 *  O(per_bar), tolerant of missing channels (absent channel = no judgment). */
export function traceFromReport(report: unknown): TraceBar[] {
  if (typeof report !== 'object' || report === null) return [];
  const r = report as Record<string, unknown>;
  if (!Array.isArray(r.per_bar)) return [];
  const out: TraceBar[] = [];
  for (const raw of r.per_bar as Record<string, unknown>[]) {
    const f = raw?.features;
    if (typeof f !== 'object' || f === null) continue;
    const features: Record<string, number> = {};
    for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) features[k] = v;
    }
    out.push({ bar: Number(raw.bar ?? 0), onsets: Number(raw.onsets ?? 0), features });
  }
  return out;
}

// ── the critique ────────────────────────────────────────────────────────────

export type Severity = 'ok' | 'warn' | 'bad';

export interface CritiqueObservation {
  kind: 'band' | 'voice-leading' | 'tension-curve';
  channel: string;              // feature channel (or 'avg_pitch' / 'harmonic_tension' for curve checks)
  bar?: number;                 // 1-based bar in the review window
  value: number;
  target_lo?: number;
  target_hi?: number;
  delta: number;                // signed distance past the violated edge (0 when ok)
  severity: Severity;
  directive: string;            // imperative the bandleader can honor
  note: string;                 // human-readable evidence
}

export interface Critique {
  bars_reviewed: number;
  observations: CritiqueObservation[];
  ambiguous: CritiqueObservation[];   // gray-zone items routed to the seam
  penalties: { voice_leading: number; bands: number; total: number };
  verdict: 'accept' | 'revise';
  summary: string;
}

const PENALTY: Record<Severity, number> = { ok: 0, warn: 0.4, bad: 1 };
const REVISE_PENALTY = 1;       // total penalty ≥ this → revise

function bandDirective(channel: string, side: 'low' | 'high'): string {
  const up: Partial<Record<CriticChannel, string>> = {
    note_density: 'add more sounding slots — the texture is too sparse to carry the line',
    syncopation: 'displace some attacks off the beat — the bar lands square',
    register_spread: 'open the voicing across registers — everything sits in one lane',
    rest_ratio: 'the bar never breathes — leave more slots empty',
    harmonic_tension: 'let the harmony speak — use the color tones of the change',
    interval_size: 'voice-lead stepwise — mean intervals are leaping',
  };
  const down: Partial<Record<CriticChannel, string>> = {
    note_density: 'thin the texture — leave more slots empty, one idea per bar',
    syncopation: 'settle some attacks back on the beat — the push is constant',
    register_spread: 'tighten the voicing — the hands are spread past the pocket',
    rest_ratio: 'fill more slots — the line drops out entirely',
    harmonic_tension: 'relieve the harmony — plain chord tones this bar',
    interval_size: 'the line is leaping — keep the mean interval stepwise',
  };
  return (side === 'low' ? up : down)[channel as CriticChannel] ?? `move ${channel} back inside the band`;
}

/** The frozen gate: judge every bar against the intent, mark gray-zone
 *  readings ambiguous, check cross-bar voice-leading and the tension curve.
 *  v0.4: when the librettist planned the piece, `opts.tensionTargets`
 *  (aligned bar-for-bar with `trace`) adds the ARC check — each bar's
 *  harmonic_tension against the outline's target — the outline's first
 *  consumer. Pure TS, O(bars × channels) — cost 0, ~1ms, no model. */
export function cheapCritique(
  trace: TraceBar[],
  intent: CriticIntent,
  opts: { tensionTargets?: number[] } = {},
): Critique {
  const observations: CritiqueObservation[] = [];

  for (const b of trace) {
    for (const channel of CRITIC_FEATURES) {
      const v = b.features[channel];
      if (v === undefined) continue;
      const { lo, hi } = intent[channel];
      if (v < lo - AMBIGUITY_BAND || v > hi + AMBIGUITY_BAND) {
        const low = v < lo;
        observations.push({
          kind: 'band', channel, bar: b.bar, value: v, target_lo: lo, target_hi: hi,
          delta: low ? v - lo : v - hi,
          severity: 'bad',
          directive: bandDirective(channel, low ? 'low' : 'high'),
          note: `${channel} ${v.toFixed(3)} vs band [${lo}, ${hi}] — clear violation`,
        });
      } else if (v < lo || v > hi) {
        const low = v < lo;
        observations.push({
          kind: 'band', channel, bar: b.bar, value: v, target_lo: lo, target_hi: hi,
          delta: low ? v - lo : v - hi,
          severity: 'warn',            // provisional — the seam adjudicates
          directive: bandDirective(channel, low ? 'low' : 'high'),
          note: `${channel} ${v.toFixed(3)} sits in the gray zone at the ${low ? 'low' : 'high'} edge of [${lo}, ${hi}]`,
        });
      }
    }
  }

  // cross-bar voice-leading: consecutive bar centroids must glide
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1].features['avg_pitch'];
    const b = trace[i].features['avg_pitch'];
    if (a === undefined || b === undefined) continue;
    const jump = Math.abs(b - a);
    if (jump > VOICE_LEADING_JUMP) {
      observations.push({
        kind: 'voice-leading', channel: 'avg_pitch', bar: trace[i].bar,
        value: jump, delta: jump - VOICE_LEADING_JUMP,
        severity: jump > VOICE_LEADING_JUMP + AMBIGUITY_BAND ? 'bad' : 'warn',
        directive: 'voice-lead inside the change — the register teleported between bars; glide the shells stepwise',
        note: `avg_pitch jumped ${jump.toFixed(3)} between bars ${trace[i - 1].bar}→${trace[i].bar} (> ${VOICE_LEADING_JUMP})`,
      });
    }
  }

  // the tension curve: the piece (not one bar) must breathe harmonically
  if (trace.length >= 4) {
    const ts = trace.map(b => b.features['harmonic_tension']).filter((v): v is number => v !== undefined);
    if (ts.length === trace.length) {
      const mean = ts.reduce((a, v) => a + v, 0) / ts.length;
      const std = Math.sqrt(ts.reduce((a, v) => a + (v - mean) ** 2, 0) / ts.length);
      if (std < TENSION_MIN_STDDEV) {
        observations.push({
          kind: 'tension-curve', channel: 'harmonic_tension',
          value: std, delta: TENSION_MIN_STDDEV - std,
          severity: 'warn',
          directive: 'shape the tension across bars — lean into one change, back off the next; a flat curve is an etude',
          note: `harmonic_tension stdev ${std.toFixed(3)} across ${ts.length} bars (< ${TENSION_MIN_STDDEV}) — the piece does not breathe`,
        });
      }
    }
  }

  // v0.4 — the librettist's arc: each bar against the outline's target
  if (opts.tensionTargets?.length) {
    observations.push(...arcObservations(trace, opts.tensionTargets));
  }

  return finishCritique(trace.length, observations);
}

/** Recompute penalties + verdict from (possibly seam-merged) observations. */
function finishCritique(bars: number, observations: CritiqueObservation[]): Critique {
  const ambiguous = observations.filter(o => o.note.includes('gray zone'));
  const bands = observations.reduce((a, o) => a + PENALTY[o.severity], 0);
  const vl = observations
    .filter(o => o.kind === 'voice-leading')
    .reduce((a, o) => a + PENALTY[o.severity], 0);
  const total = bands; // bands already sums every observation's penalty
  const verdict: Critique['verdict'] = total >= REVISE_PENALTY ? 'revise' : 'accept';
  const summary = verdict === 'revise'
    ? `${observations.filter(o => o.severity !== 'ok').length} finding(s): ${observations.filter(o => o.severity === 'bad').map(o => o.channel).join(', ') || 'gray-zone accumulations'}`
    : observations.length
      ? `no violations — ${observations.filter(o => o.severity !== 'ok').length} gray-zone item(s)`
      : 'clean against the gate';
  return {
    bars_reviewed: bars, observations, ambiguous,
    penalties: { voice_leading: vl, bands: total - vl, total }, verdict, summary,
  };
}

/** How the critique is served: 'seam' only when a gray-zone item exists. */
export function critiqueServe(critique: Critique): 'cheap' | 'seam' {
  return critique.ambiguous.length > 0 ? 'seam' : 'cheap';
}

// ── the critic's voice at the seam ──────────────────────────────────────────

export interface CriticVoice {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/** The CRITIC system prompt — asked to adjudicate ONLY the ambiguous items
 *  the frozen gate could not. The answer contract is frozen JSON. */
export function criticSystemPrompt(): string {
  return [
    'You are THE CRITIC — the ear of an organism of cells. A frozen feature',
    'gate (pure math, cost 0) already judged every clear reading; only',
    'AMBIGUOUS observations — values sitting in the gray zone at a band edge —',
    'reach you. Adjudicate them as a working musician would: does the number',
    'serve the tune, or is it a wound?',
    '',
    'ANSWER CONTRACT (frozen — deviation is a wound): answer with ONE JSON',
    'object and nothing else — no prose, no code fences:',
    '{"adjudications":[{"channel":"<feature>","bar":<n>,"severity":"ok|warn|bad","directive":"<imperative the bandleader can honor>"}],"verdict":"accept|revise","summary":"<one line>"}',
    '',
    'Adjudicate every observation you were given. "ok" = the gray reading',
    'serves the music; "bad" = it must be fixed next round; "warn" = keep an',
    'ear on it. The verdict is "revise" only if some adjudication is bad.',
    'Directives must name the fix, not the feeling ("thin the texture: leave',
    'slots 4 and 7 empty" beats "make it airier").',
  ].join('\n');
}

/** The critic's sheet: multipotent tissue — a forming rule table (the cheap
 *  gate serve) UNDER the scoped model (the seam, for ambiguity only). */
export function criticSheet(voice: CriticVoice = {}): Record<string, unknown> {
  return {
    organ: 'the ear — judges the bars the bandleader wrote',
    gate: {
      version: 'v0.3', features: [...CRITIC_FEATURES],
      ambiguity_band: AMBIGUITY_BAND,
      voice_leading_jump: VOICE_LEADING_JUMP,
      intent_defaults: criticIntent(),
    },
    rules: [
      {
        when: { kind: 'critique', payload_equals: { serve: 'cheap' } },
        respond: {
          serve: 'cheap', via: 'frozen feature gate', cost: 0,
          hint: 'clear bands — the gate answers, no model needed',
        },
      },
    ],
    model: {
      provider: 'openai-compatible',
      model: voice.model ?? 'glm-5.3',
      system_prompt: criticSystemPrompt(),
      // adjudication is narrow but reasoning models THINK first: the budget
      // must cover the thinking or the answer comes back empty (live-run
      // lesson 2026-08-26: 768 tokens → empty content, verdict stood cheap)
      max_tokens: voice.maxTokens ?? 2048,
      temperature: voice.temperature ?? 0.2,
    },
  };
}

// ── seam answers: parse, merge, stay honest ─────────────────────────────────

export interface SeamAdjudication {
  channel: string;
  bar?: number;
  severity: Severity;
  directive?: string;
}

/** Extract the JSON object from a seam reply (tolerant of fences/prose),
 *  validate the shape. Invalid → null; the cheap verdict then stands. */
export function parseCriticAnswer(text: string): { adjudications: SeamAdjudication[]; verdict: 'accept' | 'revise'; summary: string } | null {
  const stripped = text.replace(/```[a-z]*\n?/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(stripped.slice(start, end + 1)); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p.adjudications)) return null;
  const adjudications: SeamAdjudication[] = [];
  for (const raw of p.adjudications as Record<string, unknown>[]) {
    if (typeof raw?.channel !== 'string') continue;
    if (raw.severity !== 'ok' && raw.severity !== 'warn' && raw.severity !== 'bad') continue;
    adjudications.push({
      channel: raw.channel,
      bar: typeof raw.bar === 'number' ? raw.bar : undefined,
      severity: raw.severity,
      directive: typeof raw.directive === 'string' ? raw.directive : undefined,
    });
  }
  if (!adjudications.length) return null;
  return {
    adjudications,
    verdict: p.verdict === 'revise' ? 'revise' : 'accept',
    summary: typeof p.summary === 'string' ? p.summary : 'seam adjudication',
  };
}

/** Merge a seam adjudication into a cheap critique. Every ambiguous item the
 *  seam left unadjudicated stays a warn (honest: unresolved ambiguity is not
 *  an accept). Returns the merged critique + whether the merge took. */
export function mergeSeamAdjudication(
  cheap: Critique,
  answer: { adjudications: SeamAdjudication[]; verdict: string; summary: string },
): { critique: Critique; merged: number } {
  const byKey = new Map<string, SeamAdjudication>();
  for (const a of answer.adjudications) byKey.set(`${a.channel}#${a.bar ?? -1}`, a);
  let mergedCount = 0;
  const observations = cheap.observations.map(o => {
    const a = byKey.get(`${o.channel}#${o.bar ?? -1}`);
    if (!a || !o.note.includes('gray zone')) return o;
    mergedCount++;
    return {
      ...o,
      severity: a.severity,
      directive: a.directive?.trim() || o.directive,
      note: `seam: ${o.note} → ${a.severity}`,
    };
  });
  const next = finishCritique(cheap.bars_reviewed, observations);
  return { critique: { ...next, summary: `${answer.summary} (seam, ${mergedCount} adjudicated)` }, merged: mergedCount };
}

// ── steering: the critique becomes the next compose payload ─────────────────

export interface SteeringHints {
  from_round: number;
  verdict: 'accept' | 'revise';
  directives: string[];        // imperatives the bandleader MUST honor
  channels: Array<{ channel: string; value: number; target_lo: number; target_hi: number; severity: Severity }>;
  summary: string;
}

/** Fold a critique into steering hints. Only non-ok observations steer —
 *  an accept leaves directives empty (the bar stood on its own). */
export function steeringFromCritique(critique: Critique, round: number): SteeringHints {
  const findings = critique.observations.filter(o => o.severity !== 'ok');
  const directives: string[] = [];
  for (const o of findings) {
    if (!directives.includes(o.directive)) directives.push(o.directive);
  }
  return {
    from_round: round,
    verdict: critique.verdict,
    directives,
    channels: findings.map(o => ({
      channel: o.channel, value: o.value,
      target_lo: o.target_lo ?? 0, target_hi: o.target_hi ?? 1,
      severity: o.severity,
    })),
    summary: critique.summary,
  };
}

/** The payload for the critique signal. `serve` decides the tissue: 'cheap'
 *  hits the critic's rule table (cost 0); 'seam' misses it and routes up
 *  through the model wearing the critic's prompt. The payload itself carries
 *  the full evidence — the signal ledger remembers what was judged. */
export function critiqueSignalPayload(args: {
  barIndex: number;
  round: number;
  serve: 'cheap' | 'seam';
  intent: CriticIntent;
  critique: Critique;
  trace: TraceBar[];
}): Record<string, unknown> {
  return {
    serve: args.serve,
    bar_index: args.barIndex,
    round: args.round,
    intent: args.intent,
    verdict: args.critique.verdict,
    summary: args.critique.summary,
    ...(args.serve === 'seam'
      ? {
          ambiguous: args.critique.ambiguous.map(o => ({
            channel: o.channel, bar: o.bar ?? null, value: o.value,
            target: [o.target_lo ?? 0, o.target_hi ?? 1], note: o.note,
          })),
          bars: args.trace.map(b => ({ bar: b.bar, features: b.features })),
        }
      : {
          findings: args.critique.observations.filter(o => o.severity !== 'ok').length,
        }),
  };
}

// ── the compose cycle: the GAN loop as one testable orchestration ───────────

import { arcObservations } from './librettist';

/** Injected IO so the driver (HTTP + MCP) and tests (memory + fixtures) run
 *  the SAME loop. O(bars) memory: only the accepted bars and last critique
 *  are held; rejected rounds are reported by reference, not accumulated. */
export interface CycleIO {
  /** Fire the compose signal; return the raw model answer. */
  fireCompose(payload: Record<string, unknown>): Promise<{ ok: boolean; mode: string; answer: string; latencyMs: number }>;
  /** Fire the critique signal; return serve mode + the seam answer if any. */
  fireCritique(payload: Record<string, unknown>): Promise<{ ok: boolean; mode: string; answer: string }>;
  /** Analyze candidate bars against the accepted score so far; null = the
   *  ear is unavailable (MCP down / notation refused) — the loop degrades
   *  honestly to v0.2 (compose without critique), never invents a trace. */
  analyze(acceptedSoFar: string[], candidate: string[]): Promise<TraceBar[] | null>;
}

export interface CycleRound {
  round: number;
  payload: Record<string, unknown>;
  bars: string[];
  serve: 'cheap' | 'seam' | 'none';
  critique: Critique | null;
  accepted: boolean;
  seamFailed: boolean;
  /** v0.5: who wrote round 1's bars — 'compose' (the bandleader through
   *  the seam) or 'arranger' (stock tissue at cost 0, or the arranger's
   *  escalation wearing the bandleader's voice). Rounds 2+ are 'compose'. */
  via?: 'compose' | 'arranger';
}

export interface CycleResult {
  rounds: CycleRound[];
  acceptedBars: string[];
  acceptedVia: 'verdict' | 'cap' | 'fallback' | 'none';  // how the bars were accepted
  finalCritique: Critique | null;
  steering: SteeringHints | null;   // feeds the NEXT compose payload
  composeErrors: number;
}

/**
 * One compose cycle = up to `ganRounds` GAN rounds. Round r: compose (with
 * steering, if any) → the ear reads the trace → the critique steers round
 * r+1. Revision only buys another round while rounds remain; at the cap the
 * last bars stand and the critique carries to the NEXT cycle. The verdict
 * 'accept' ends the cycle early — a bar that stands saves a model call.
 */
export async function composeCycle(io: CycleIO, args: {
  barIndex: number;
  changes: string;
  bars: number;
  recent: string[];
  intent: CriticIntent;
  steering: SteeringHints | null;
  ganRounds: number;
  extract: (reply: string, bars: number) => string[];
  key?: string;
  tempo?: number;
  outline?: Record<string, unknown>;
  tensionTargets?: number[];
  /** v0.5 — the ARRANGER hook: if present, ROUND 1 asks the arranger first
   *  (stock table hit = cost 0; a miss escalates through the bandleader
   *  wearing the arranger's context — one spend). Returning null (or empty
   *  bars) falls back to the bandleader's own compose for the window. */
  serveFirst?: (payload: Record<string, unknown>) => Promise<{ bars: string[]; serve: 'arranger-table' | 'arranger-escalated' } | null>;
}): Promise<CycleResult> {
  const rounds: CycleRound[] = [];
  const acceptedSoFar: string[] = [];
  let steering = args.steering;
  let composeErrors = 0;
  let lastServed: CycleRound | null = null;   // fallback: a failed revision never erases a served bar

  for (let round = 1; round <= args.ganRounds; round++) {
    const payload: Record<string, unknown> = {
      bar_index: args.barIndex, changes: args.changes, bars: args.bars,
      recent: args.recent,
      ...(args.key ? { key: args.key } : {}),
      ...(args.tempo !== undefined ? { tempo: args.tempo } : {}),
      ...(steering ? { steering } : {}),
      ...(args.outline ? { outline: args.outline } : {}),
    };
    const fired = await (async () => {
      // v0.5: round 1 may arrive from the arranger — stock tissue at cost 0
      // or its own escalation through the bandleader. Failure is honest:
      // null/empty falls through to the bandleader's compose.
      if (round === 1 && args.serveFirst) {
        const served = await args.serveFirst(payload);
        if (served && served.bars.length) {
          return { ok: true, mode: served.serve, answer: served.bars.join('\n'), latencyMs: 0 };
        }
      }
      return await io.fireCompose(payload);
    })();
    const via: CycleRound['via'] = fired.mode === 'arranger-table' || fired.mode === 'arranger-escalated' ? 'arranger' : 'compose';
    if (!fired.ok) {
      composeErrors++;
      rounds.push({ round, payload, bars: [], serve: 'none', critique: null, accepted: false, seamFailed: false });
      break;                       // honest: nothing served, nothing faked
    }
    const bars = fired.mode === 'arranger-table' || fired.mode === 'arranger-escalated'
      ? fired.answer.split(/\r?\n/).filter(Boolean)   // already-extracted bars
      : args.extract(fired.answer, args.bars);
    if (!bars.length) {
      composeErrors++;
      rounds.push({ round, payload, bars: [], serve: 'none', critique: null, accepted: false, seamFailed: false });
      break;   // served nothing — fall back to the last served bars below
    }

    const trace = await io.analyze(acceptedSoFar, bars);
    let critique: Critique | null = null;
    let serve: CycleRound['serve'] = 'none';
    let seamFailed = false;
    if (trace && trace.length) {
      critique = cheapCritique(trace, args.intent, args.tensionTargets ? { tensionTargets: args.tensionTargets } : {});
      serve = critiqueServe(critique);
      const sig = await io.fireCritique(critiqueSignalPayload({
        barIndex: args.barIndex, round, serve, intent: args.intent, critique, trace,
      }));
      if (serve === 'seam') {
        if (sig.ok && sig.answer) {
          const parsed = parseCriticAnswer(sig.answer);
          if (parsed) {
            const merged = mergeSeamAdjudication(critique, parsed);
            critique = merged.critique;
          } else {
            seamFailed = true;     // seam answered garbage: cheap verdict stands
          }
        } else {
          seamFailed = true;
        }
      }
    }

    const isLast = round === args.ganRounds;
    const accepted = critique === null // ear unavailable → v0.2 semantics
      ? true
      : critique.verdict === 'accept' || isLast;
    const cycleRound: CycleRound = { round, payload, bars, serve, critique, accepted, seamFailed, via };
    rounds.push(cycleRound);
    lastServed = cycleRound;
    if (accepted) {
      return {
        rounds, acceptedBars: bars, acceptedVia: critique && critique.verdict === 'accept' ? 'verdict' : 'cap',
        finalCritique: critique,
        steering: critique ? steeringFromCritique(critique, round) : null,
        composeErrors,
      };
    }
    if (critique) steering = steeringFromCritique(critique, round);   // round r+1 must honor it
    acceptedSoFar.push(...bars); // context for the next round's analysis window
  }
  return {
    rounds,
    // a revision round failed — the last SERVED bars stand (they were
    // composed, the critique is logged); its directives carry to the next
    // cycle. Honest fallback, never a blank.
    acceptedBars: lastServed?.bars ?? [],
    acceptedVia: lastServed ? 'fallback' : 'none',
    finalCritique: lastServed?.critique ?? null,
    steering: lastServed?.critique ? steeringFromCritique(lastServed.critique, lastServed.round) : null,
    composeErrors,
  };
}
