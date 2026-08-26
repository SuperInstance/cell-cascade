// cell-cascade — src/cortex.ts
// THE CORTEX PLUG (v0.2.x). The first TOTIPOTENT CELL THAT COMPOSES.
//
// The organism before this: a spine that keeps time, no cortex to spend it
// on. The wiring, end to end, with NO HUMAN in the loop:
//
//   clock (system) ──tick──► METRONOME (sclerotic: rule table, cost 0, ~1ms)
//                                 │  every Nth tick is a downbeat: the table
//                                 │  says "compose" (deterministic fate)
//                                 ▼
//                            BANDLEADER (totipotent: sheet.model carries its
//                                 │  voice; the seam calls the model wearing
//                                 │  that system_prompt)
//                                 ▼
//                          plainsong notation in the signal response,
//                          logged on the ledger with tokens/latency/cost
//                                 │
//                                 ▼
//                       DRIVER (the body): accumulates the bars, hands the
//                           score to the plainsong MCP compile_score → MIDI
//
// Everything here is PURE: prompts, sheets, payload shapes, the notation
// extractor, score assembly, and the MCP JSON-RPC envelope — so tests pin
// the wiring without a worker, a key, or a running MCP.

// ── the bandleader's voice ──────────────────────────────────────────────────

export interface BandleaderVoice {
  style?: string;      // free text: the sound the organism wants
  model?: string;      // sheet.model.model (default glm-5.3, the fleet flag)
  maxTokens?: number;  // reasoning models spend tokens before they speak
  temperature?: number;
}

/**
 * The BANDLEADER system prompt — the cell's voice at the model seam. The
 * notation contract is FROZEN here: the driver strips anything that is not
 * a `@voice | ... | vel:` line, so prose can never corrupt the score, and
 * the model never needs to know the header (the organism owns the header).
 */
export function bandleaderSystemPrompt(voice: BandleaderVoice = {}): string {
  const style = voice.style?.trim() || 'late-quartet lyricism with a pocket groove — spare, singing, never busy';
  return [
    'You are THE BANDLEADER — the cortex of an organism of cells. A metronome',
    'keeps the time; on every downbeat it signals you to write the next bar',
    'of the piece. You answer in PLAINSONG NOTATION ONLY.',
    '',
    'NOTATION CONTRACT (frozen — deviation is a wound):',
    '- Answer with ONLY bar lines. One line per bar:',
    '  `@piano | s s s s s s s s | vel: NN`',
    '- Exactly 8 slots per bar (8th notes, 4/4). Slot grammar:',
    '  rest `.`, single note `g3`, chord `e3-a3-d4-g4` (notes joined with `-`).',
    '- Pitch: letter a–g, optional accidental `#` (sharp) or `b` (flat),',
    '  octave digit 2–5. Examples: `c4`, `f#3`, `bb2`, `e3-g3-b3-d4`.',
    '- Velocity after the second pipe: `vel: NN`, NN in 40–105.',
    '- No prose, no headers, no section markers, no code fences, no chords',
    '  spelled as names. If you are asked for N bars you emit exactly N lines.',
    '',
    'HOW TO DECIDE WHAT TO PLAY: the signal payload carries {bar_index,',
    'changes, key, tempo, recent}. `changes` is the chord for this bar —',
    'voice-lead inside it (shell voicings beat root-position thickeners).',
    '`recent` is what you wrote last — CONTINUE the line: stepwise motion,',
    'call-and-answer across the changes, leave slots empty so the bar',
    'breathes (not every 8th speaks), land some attacks off the beat.',
    'Register spread and rest ratio are the difference between a tune and',
    'an etude. One idea per bar; let the idea travel.',
    '',
    `THE SOUND: ${style}.`,
  ].join('\n');
}

/** The bandleader's sheet.model config — what the seam reads at fire time. */
export function bandleaderSheet(voice: BandleaderVoice = {}): Record<string, unknown> {
  return {
    organ: 'the cortex — composes plainsong on the compose signal',
    model: {
      provider: 'openai-compatible',
      model: voice.model ?? 'glm-5.3',
      system_prompt: bandleaderSystemPrompt(voice),
      // reasoning models spend completion tokens thinking before they write;
      // a tight budget yields an empty content and a wasted call
      max_tokens: voice.maxTokens ?? 2048,
      temperature: voice.temperature ?? 0.8,
    },
  };
}

// ── the metronome — sclerotic tissue, the spine ─────────────────────────────

/**
 * The METRONOME sheet: a rule table, nothing else. Cost 0, ~1ms, no model —
 * the DO-alarm-clock pattern (band-clock): the schedule math IS the table.
 * beat 0 of every `every`-tick cycle is the downbeat → action "compose";
 * every other tick → "wait". First match wins, deterministic forever.
 */
export function metronomeSheet(every: number): Record<string, unknown> {
  const n = Math.max(1, Math.floor(every));
  return {
    organ: 'the spine — keeps time, never thinks',
    beats_per_compose: n,
    rules: [
      {
        when: { kind: 'tick', payload_equals: { beat: 0 } },
        respond: { tock: 1, action: 'compose', signal_kind: 'compose', hint: 'downbeat — fire the bandleader' },
      },
      {
        when: { kind: 'tick' },
        respond: { tock: 1, action: 'wait', hint: 'offbeat — the organism breathes' },
      },
    ],
  };
}

/** The clock's tick payload: `beat` wraps the compose cycle — the wheel
 *  the spine turns. beat 0 = downbeat. */
export function tickPayload(tick: number, every: number): { tick: number; beat: number } {
  const n = Math.max(1, Math.floor(every));
  return { tick, beat: ((tick - 1) % n + n) % n };
}

/** The compose payload the metronome forwards to the bandleader. */
export function composePayload(args: {
  barIndex: number;
  changes: string;
  bars: number;
  key?: string;
  tempo?: number;
  recent?: string[];
}): Record<string, unknown> {
  return {
    bar_index: args.barIndex,
    changes: args.changes,
    bars: args.bars,
    ...(args.key ? { key: args.key } : {}),
    ...(args.tempo ? { tempo: args.tempo } : {}),
    ...(args.recent?.length ? { recent: args.recent } : {}),
  };
}

// ── notation extraction & score assembly (the honest hands) ────────────────

export const BAR_LINE = /^@[A-Za-z][A-Za-z0-9 _-]*\|[^|]*\|[^|]*$/;

/** A bare notation bar line, whitespace-tolerant. */
export function isBarLine(line: string): boolean {
  return BAR_LINE.test(line.trim());
}

/**
 * Pull bar lines out of a model reply. The cortex may chatter (prose,
 * fences, restating `recent`) — the hands trust only the notation grammar,
 * and keep the LAST `bars` lines when the model overshoots. Returns the
 * extracted lines and what was rejected, so the run log is honest.
 */
export function extractNotationBars(reply: string, bars: number): {
  lines: string[];
  rejected: number;
  found: number;
} {
  const all = reply
    .split(/\r?\n/)
    .map(l => l.trim().replace(/^```[a-z]*\s*$/, '').trim())
    .filter(Boolean)
    .filter(isBarLine);
  const keep = bars > 0 ? all.slice(-bars) : all;
  return { lines: keep, found: all.length, rejected: Math.max(0, all.length - keep.length) };
}

export interface ScoreHead {
  title: string;
  key?: string;
  tempo?: number;
  meter?: string;
  subdivision?: string;
  swing?: string;
}

/** Assemble the full score text the MCP compiles: header + the bars the
 *  organism wrote. The header is the ORGANISM's, never the model's. */
export function assembleScore(head: ScoreHead, barLines: string[]): string {
  const key = head.key ?? 'C';
  const tempo = head.tempo ?? 100;
  const meter = head.meter ?? '4/4';
  const subdivision = head.subdivision ?? '8th';
  const swing = head.swing ?? '0%';
  return [
    `**TRACK: ${head.title}`,
    '[MetaData]',
    `key: ${key} | tempo: ${tempo} | swing: ${swing} | subdivision: ${subdivision}`,
    `time: ${meter}`,
    '',
    '[A] (what the organism wrote — no human in the loop)',
    ...barLines.map(l => `${l}`),
  ].join('\n') + '\n';
}

// ── the plainsong MCP wire (JSON-RPC 2.0, one message per request) ─────────

/** One JSON-RPC envelope for the MCP over loopback HTTP. */
export function mcpRequest(id: number, method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

export function mcpToolCall(id: number, name: string, args: Record<string, unknown>): string {
  return mcpRequest(id, 'tools/call', { name, arguments: args });
}

/** Parse an MCP tool result: {content: [{type: 'text', text}], isError?}.
 *  A tool failure is a RESULT the driver reads, not a protocol error —
 *  mirror the server's doctrine. */
export function parseMcpToolResult(payload: unknown): { text: string; isError: boolean } {
  if (typeof payload !== 'object' || payload === null) return { text: '', isError: true };
  const r = payload as Record<string, unknown>;
  if (r.error) {
    const e = r.error as Record<string, unknown>;
    return { text: `rpc error ${e.code ?? ''}: ${String(e.message ?? '')}`, isError: true };
  }
  const content = Array.isArray(r.result)
    ? (r.result as Record<string, unknown>[]).find(c => c.type === 'text')
    : Array.isArray((r.result as Record<string, unknown> | undefined)?.content)
      ? (((r.result as Record<string, unknown>).content as Record<string, unknown>[]).find(c => c.type === 'text'))
      : undefined;
  return {
    text: typeof content?.text === 'string' ? content.text : JSON.stringify(r.result ?? r),
    isError: Boolean((r.result as Record<string, unknown> | undefined)?.isError),
  };
}
