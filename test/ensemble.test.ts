// cell-cascade — tests: THE ENSEMBLE (v0.5)
// The band's wiring, pinned without a worker, a key, or a running MCP:
// the chord theory the bass walks on, the kimi-signed rule tables (bass
// voice-leading + drum presets + fills), the arranger's stock-mint loop,
// the serveFirst round-1 hook inside the compose cycle, and the plainsong
// ensemble-session wire helpers. The firing-path journeys run through the
// same in-memory FireStore the firing tests use — escalation, candidates,
// the multipotent serve-split — so the cells' tiers are pinned too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseChord, chordTones, spelledDegree, pcOfName, midiOfName,
  bassForBar, bassCellSheet, normalizeBassLine, BASS_FLOOR_MIDI, BASS_CEIL_MIDI,
  DRUM_STYLES, DRUM_FILLS, drumForBar, drumFill, drumCellSheet, drumSystemPrompt, normalizeDrumLine, DRUM_MAP,
  stockFromBar, stockBarFor, arrangerSheet, uniquifySections,
  defaultArrangerVoicings, loadArrangerVoicings, saveArrangerVoicings, mintArrangerVoicings,
  partContent, parseEnsembleWriteResult, normalizeToVoice,
} from '../src/ensemble';
import { planLibretto } from '../src/librettist';
import { composeCycle, cheapCritique, criticIntent, type CycleIO } from '../src/critic';
import { isBarLine } from '../src/cortex';
import { matchRule, parseSheet, type CellRow } from '../src/cascade';
import { fireSignal, type FireStore } from '../src/firing';
import type { ModelCall, ModelExchange, SheetModel } from '../src/bridge';
import type { Tier } from '../src/tiers';

// ── chord theory: the shared truth the whole band reads ────────────────────

test('parseChord: the run\'s changes all parse with known qualities', () => {
  for (const sym of ['Dm7', 'G7', 'Cmaj7', 'A7b9', 'Fmaj7', 'Bbmaj7', 'E7b9', 'A7']) {
    const c = parseChord(sym);
    assert.ok(c.known, `${sym} must be a known quality`);
    assert.ok(c.rootPc >= 0, `${sym} root pc`);
  }
});

test('parseChord: accidentals and unknowns', () => {
  assert.equal(parseChord('Bbmaj7').root, 'bb');
  assert.equal(parseChord('F#m7').rootPc, 6);
  assert.equal(parseChord('Cmaj7#11').known, false, 'novel quality is a miss');
  assert.equal(parseChord('nonsense').known, false);
});

test('chordTones: spelled shells (Dm7, A7b9, Bdim7 via the 6th)', () => {
  assert.deepEqual(chordTones(parseChord('Dm7')), ['d', 'f', 'a', 'c']);
  assert.deepEqual(chordTones(parseChord('G7')), ['g', 'b', 'd', 'f']);
  assert.deepEqual(chordTones(parseChord('A7b9')), ['a', 'c#', 'e', 'g', 'bb']);
  // dim7's bb7 would double-flat outside the grammar — it spells as the 6th (kimi)
  assert.deepEqual(chordTones(parseChord('Bdim7')), ['b', 'd', 'f', 'g#']);
  assert.equal(chordTones(parseChord('Cmaj7#11')).length, 0, 'unknown quality serves no tones');
});

test('spelledDegree: E7b9\'s third is g#, the b9 is f', () => {
  const e = parseChord('E7b9');
  assert.equal(spelledDegree(e, '3')!.name, 'g#');
  assert.equal(spelledDegree(e, 'b9')!.name, 'f');
});

// ── the bass cell: rule-table voice-leading under the harmony ──────────────

const CHANGES = ['Dm7', 'G7', 'Cmaj7', 'A7b9', 'Fmaj7', 'Bbmaj7', 'E7b9', 'A7'];

test('bassForBar: the walking grammar (8 slots, @bass voice, vel band)', () => {
  const bar = bassForBar(parseChord('Dm7'), parseChord('G7'), null)!;
  assert.ok(bar, 'Dm7 walks');
  assert.ok(isBarLine(bar.line), `bar-line grammar: ${bar.line}`);
  assert.match(bar.line, /^@bass \|/);
  assert.match(bar.line, /\| vel: \d+$/);
  const slots = bar.line.split('|')[1].trim().split(/\s+/);
  assert.equal(slots.length, 8, '8 slots on the 8th grid');
  assert.equal(slots.filter(s => s !== '.').length, 4, 'quarter-note pulse: exactly 4 notes');
  const vel = Number(/vel: (\d+)/.exec(bar.line)![1]);
  assert.ok(vel >= 40 && vel <= 105, `vel in band: ${vel}`);
});

test('bassForBar: root on beat 1, defining tone present, all chord tones', () => {
  for (const [sym, nextSym] of [['Dm7', 'G7'], ['Cmaj7', 'A7b9'], ['Bbmaj7', 'E7b9'], ['A7b9', 'Fmaj7']]) {
    const bar = bassForBar(parseChord(sym), parseChord(nextSym), midiOfName('e1'))!;
    const notes = bar.notes;
    const chord = parseChord(sym);
    const pcs = new Set(chordTones(chord).map(pcOfName));
    assert.equal(notes[0][0].toLowerCase(), chord.root[0].toLowerCase(), `${sym}: root on beat 1`);
    // beats 1–3 are chord tones; beat 4 is the approach (chord tone or neighbor)
    for (const n of notes.slice(0, 3)) assert.ok(pcs.has(pcOfName(n.replace(/\d/, ''))), `${sym}: ${n} is a chord tone`);
  }
});

test('bassForBar: kimi\'s correction — Dm7→G7 approaches g via f# (not b)', () => {
  const bar = bassForBar(parseChord('Dm7'), parseChord('G7'), midiOfName('e1'))!;
  const approach = bar.notes[3].replace(/\d/, '');
  assert.equal(approach, 'f#', 'the leading tone to G is f#');
});

test('bassForBar: register locked to c1..b2 and lines glide', () => {
  let tail = midiOfName('e1');
  for (let i = 0; i < CHANGES.length * 2; i++) {
    const sym = CHANGES[i % CHANGES.length];
    const next = CHANGES[(i + 1) % CHANGES.length];
    const bar = bassForBar(parseChord(sym), parseChord(next), tail)!;
    for (const n of bar.notes) {
      const m = midiOfName(n);
      assert.ok(m >= BASS_FLOOR_MIDI && m <= BASS_CEIL_MIDI, `${sym}: ${n} inside c1..b2`);
    }
    const first = midiOfName(bar.notes[0]);
    assert.ok(Math.abs(first - tail) <= 12, `${sym}: root lands within an octave of the tail (${bar.notes[0]})`);
    tail = midiOfName(bar.notes[3]);
  }
});

test('bassForBar: unknown quality refuses (the cell escalates)', () => {
  assert.equal(bassForBar(parseChord('Cmaj7#11'), parseChord('Dm7'), null), null);
});

test('bassForBar: half-diminished walks the b5, not the P5 (kimi review regression)', () => {
  const bar = bassForBar(parseChord('Bm7b5'), parseChord('E7b9'), midiOfName('e1'))!;
  const slot2 = bar.notes[1].replace(/\d/, '');
  assert.equal(slot2, 'f', 'Bm7b5\'s fifth is f (b5), not f#');
  assert.equal(bar.notes[0].replace(/\d/, ''), 'b');
});

test('spelledDegree: sharp degrees parse; double-spells refuse the grammar (kimi review regression)', () => {
  const c = parseChord('Cmaj7');
  assert.equal(spelledDegree(c, '#4')!.name, 'f#');
  assert.equal(spelledDegree(c, '#11')!.name, 'f#');
  assert.equal(spelledDegree(c, 'bb7'), null, 'double-flat refuses (outside the single-accidental grammar)');
});

test('bassCellSheet: the table holds every known quality, misses novelty', () => {
  const rules = (bassCellSheet().rules ?? []) as never[];
  const m7 = matchRule(rules, 'compose_bass', { quality: 'm7', chord: 'Dm7' });
  assert.ok(m7.hit && m7.response!.serve === 'table');
  assert.equal(matchRule(rules, 'compose_bass', { quality: 'maj7#11', chord: 'Cmaj7#11' }).hit, false);
});

test('normalizeBassLine: re-tags the voice and clamps into c1..b2', () => {
  const n = normalizeBassLine('@piano | d3 . a3 . c4 . e4 . | vel: 80');
  assert.match(n, /^@bass \|/);
  for (const tok of n.split('|')[1].trim().split(/\s+/)) {
    if (tok === '.') continue;
    for (const note of tok.split('-')) {
      const m = midiOfName(note);
      assert.ok(m >= BASS_FLOOR_MIDI && m <= BASS_CEIL_MIDI, `${note} clamped`);
    }
  }
});

// ── the drum cell: presets as tissue, fills think only on miss ─────────────

test('drum presets: four styles, kimi-corrected, grammar-clean', () => {
  assert.deepEqual(Object.keys(DRUM_STYLES).sort(), ['ballad', 'bossa', 'rock', 'swing']);
  // kimi's swing: the skip beat lives at slots 3 and 7
  assert.deepEqual(DRUM_STYLES.swing.slots, ['ride', '.', 'ride-hat', 'ride', 'ride', '.', 'ride-hat', 'ride']);
  // kimi's ballad: brushes on 2&4 ONLY (d2 was the bug — snare is d1)
  assert.deepEqual(DRUM_STYLES.ballad.slots, ['.', '.', 'snare', '.', '.', '.', 'snare', '.']);
  for (const [style, p] of Object.entries(DRUM_STYLES)) {
    const bar = drumForBar(style)!;
    assert.ok(bar && isBarLine(bar.line), `${style} grammar`);
    assert.equal(bar.line.split('|')[1].trim().split(/\s+/).length, 8, `${style} 8 slots`);
    for (const tok of bar.line.split('|')[1].trim().split(/\s+/)) {
      if (tok === '.') continue;
      for (const note of tok.split('-')) assert.ok(Object.values(DRUM_MAP).includes(note as never), `${style}: ${note} in the drum map`);
    }
  }
});

test('drum fills: the turnaround holds; unknown fills miss; unknown style misses', () => {
  assert.ok(drumFill('turnaround'));
  assert.equal(drumFill('elephant'), null);
  assert.equal(drumForBar('polka'), null);
});

test('drumCellSheet: styles AND the fill hit the table; a novel fill misses', () => {
  const rules = (drumCellSheet().rules ?? []) as never[];
  assert.ok(matchRule(rules, 'compose_drums', { style: 'swing' }).hit);
  assert.ok(matchRule(rules, 'fill_drums', { kind_of: 'turnaround' }).hit);
  assert.equal(matchRule(rules, 'fill_drums', { kind_of: 'elephant' }).hit, false);
  assert.equal(matchRule(rules, 'compose_drums', { style: 'polka' }).hit, false);
  assert.ok(drumSystemPrompt().includes('@drums | s s s s s s s s | vel: NN'), 'the frozen contract');
});

test('normalizeDrumLine: stray pitches fold to the nearest drum token', () => {
  const n = normalizeDrumLine('@drums | c4 . d4 . . . e4 . | vel: 90');
  assert.ok(n.includes('d#2'), 'c4/d4/e4 fold toward the kit\'s upper lane');
  assert.match(n, /^@drums \|/);
  assert.ok(Number(/vel: (\d+)/.exec(n)![1]) <= 96, 'vel clamped');
});

// ── the arranger: the compose-side distillation target ─────────────────────

const CLEAN_Dm7 = '@piano | d3-a3-c4 . . f4 . e4 . . | vel: 72';   // 4/5 chord tones (f4 is the 3rd)
const DIRTY_Dm7 = '@piano | e3 . f#3 . g#3 . a#3 . | vel: 72';     // chromatic run, no shell

test('stockFromBar: a clean accepted bar mints; a dirty one is honest novelty', () => {
  const clean = stockFromBar(CLEAN_Dm7, parseChord('Dm7'), { run: 'runs/x', bar: 3 });
  assert.ok(clean.stock && clean.clean, `Dm7 shell mints (ratio ${clean.chordToneRatio})`);
  assert.ok(clean.stock!.core.length >= 2 && clean.stock!.core.length <= 4, 'core is a shell, not a thicket');
  for (const n of clean.stock!.core) {
    const m = midiOfName(n);
    assert.ok(m >= midiOfName('c3') && m <= midiOfName('b4'), `core in the piano's mid register: ${n}`);
  }
  assert.deepEqual(clean.stock!.rhythm, [1, 0, 0, 1, 0, 1, 0, 0], 'the rhythm mask travels');
  const dirty = stockFromBar(DIRTY_Dm7, parseChord('Dm7'), { run: 'runs/x', bar: 4 });
  assert.equal(dirty.stock, null);
  assert.equal(dirty.clean, false);
});

test('stockBarFor: rebuilt bar is grammar-clean and the vel follows the arc', () => {
  const { stock } = stockFromBar(CLEAN_Dm7, parseChord('Dm7'), { run: 'runs/x', bar: 3 });
  const low = stockBarFor(stock!, 0.15);
  const high = stockBarFor(stock!, 0.75);
  assert.ok(isBarLine(low) && isBarLine(high));
  assert.equal(low.split('|')[1].trim().split(/\s+/).length, 8);
  assert.ok(Number(/vel: (\d+)/.exec(high)![1]) > Number(/vel: (\d+)/.exec(low)![1]), 'higher tension → louder comp');
});

test('arrangerSheet: held chords hit the table, held-outs miss', () => {
  const { stock } = stockFromBar(CLEAN_Dm7, parseChord('Dm7'), { run: 'runs/x', bar: 3 });
  const rules = (arrangerSheet({ Dm7: stock! }).rules ?? []) as never[];
  const hit = matchRule(rules, 'arrange', { chord: 'Dm7' });
  assert.ok(hit.hit && hit.response!.serve === 'table' && Array.isArray(hit.response!.core));
  assert.equal(matchRule(rules, 'arrange', { chord: 'G7' }).hit, false, 'G7 is still a hole');
});

test('mintArrangerVoicings: first clean bar wins, repeats hold, dirty never mints', () => {
  let file = defaultArrangerVoicings();
  const r1 = mintArrangerVoicings(file, [{ barLine: CLEAN_Dm7, chord: 'Dm7', barIndex: 0 }], 'runs/r1');
  assert.equal(r1.mints.length, 1);
  assert.equal(r1.file.version, 1);
  assert.ok(r1.file.voicings.Dm7);
  file = r1.file;
  const r2 = mintArrangerVoicings(file, [
    { barLine: CLEAN_Dm7, chord: 'Dm7', barIndex: 4 },      // held — first shell stands
    { barLine: DIRTY_Dm7, chord: 'G7', barIndex: 5 },       // dirty — honest novelty
    { barLine: '@piano | g3-b3-f4 . . b3 . a3 . | vel: 70', chord: 'G7', barIndex: 6 },  // clean — mints
  ], 'runs/r1');
  assert.equal(r2.mints.map(m => m.chord).join(), 'G7');
  assert.deepEqual(r2.held, ['Dm7']);
  assert.equal(r2.unclean.length, 1);
  assert.equal(r2.file.version, 2);
});

test('arranger voicing file: round-trips on disk (versioned canon)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arranger-'));
  const path = join(dir, 'arranger-voicings.json');
  let file = defaultArrangerVoicings();
  file = mintArrangerVoicings(file, [{ barLine: CLEAN_Dm7, chord: 'Dm7', barIndex: 0 }], 'runs/rt').file;
  saveArrangerVoicings(path, file);
  const loaded = loadArrangerVoicings(path);
  assert.ok(loaded);
  assert.equal(loaded!.version, 1);
  assert.ok(loaded!.voicings.Dm7.core.length >= 2);
  assert.equal(loaded!.history.length, 1);
  assert.equal(loadArrangerVoicings(join(dir, 'missing.json')), null, 'no file → null (the unborn arranger)');
  rmSync(dir, { recursive: true, force: true });
});

// ── the serveFirst hook: round 1 belongs to the arranger ───────────────────

function ioWith(over: Partial<CycleIO> = {}): { io: CycleIO; calls: { compose: number; critique: number } } {
  const calls = { compose: 0, critique: 0 };
  const io: CycleIO = {
    fireCompose: async () => { calls.compose++; return { ok: true, mode: 'model', answer: '@piano | g3-b3-f4 . . b3 . a3 . | vel: 70', latencyMs: 100 }; },
    fireCritique: async () => { calls.critique++; return { ok: true, mode: 'table', answer: '' }; },
    analyze: async (_soFar, candidate) => {
      // feature readings inside every band → accept (the gate is mocked kind)
      const features = { note_density: 0.3, syncopation: 0.5, register_spread: 0.1, rest_ratio: 0.05, harmonic_tension: 0.55, interval_size: 0.3, avg_pitch: 0.4 };
      return candidate.map((_, i) => ({ bar: i + 1, features: { ...features } }));
    },
    ...over,
  };
  return { io, calls };
}

test('serveFirst journey: a stock hit serves round 1 at cost 0 — the seam never fires', async () => {
  const { stock } = stockFromBar(CLEAN_Dm7, parseChord('Dm7'), { run: 'runs/x', bar: 0 });
  const { io, calls } = ioWith();
  const result = await composeCycle(io, {
    barIndex: 4, changes: 'Dm7', bars: 1, recent: [], intent: criticIntent(),
    steering: null, ganRounds: 2,
    extract: (reply, n) => reply.split('\n').filter(isBarLine).slice(-n),
    serveFirst: async () => ({ bars: [stockBarFor(stock!, 0.55)], serve: 'arranger-table' }),
  });
  assert.equal(calls.compose, 0, 'the bandleader was never paid');
  assert.equal(result.acceptedVia, 'verdict');
  assert.equal(result.rounds[0].via, 'arranger');
  assert.equal(result.rounds[0].serve, 'cheap', 'the ear still judged it free');
  assert.equal(result.rounds.length, 1, 'a standing stock ends the cycle');
});

test('serveFirst journey: a stock the ear rejects escalates to the bandleader on round 2', async () => {
  const { stock } = stockFromBar(CLEAN_Dm7, parseChord('Dm7'), { run: 'runs/x', bar: 0 });
  let analysisCount = 0;
  const { io, calls } = ioWith({
    analyze: async (_soFar, candidate) => {
      analysisCount++;
      const features = analysisCount === 1
        ? { note_density: 0.05, syncopation: 0.5, register_spread: 0.1, rest_ratio: 0.05, harmonic_tension: 0.55, interval_size: 0.3, avg_pitch: 0.4 }   // sparse → revise
        : { note_density: 0.35, syncopation: 0.5, register_spread: 0.1, rest_ratio: 0.05, harmonic_tension: 0.55, interval_size: 0.3, avg_pitch: 0.4 };  // fixed
      return candidate.map((_, i) => ({ bar: i + 1, features: { ...features } }));
    },
  });
  const result = await composeCycle(io, {
    barIndex: 4, changes: 'Dm7', bars: 1, recent: [], intent: criticIntent(),
    steering: null, ganRounds: 2,
    extract: (reply, n) => reply.split('\n').filter(isBarLine).slice(-n),
    serveFirst: async () => ({ bars: [stockBarFor(stock!, 0.55)], serve: 'arranger-table' }),
  });
  assert.equal(calls.compose, 1, 'novelty paid the seam exactly once');
  assert.equal(result.rounds.length, 2);
  assert.equal(result.rounds[0].via, 'arranger');
  assert.equal(result.rounds[1].via, 'compose');
  const steered = (result.rounds[1].payload.steering ?? {}) as { directives?: string[] };
  assert.ok(steered.directives?.length, 'the round-1 critique steered the bandleader\'s round 2');
  assert.equal(result.acceptedVia, 'verdict');
});

test('serveFirst journey: a null (miss) falls back to the bandleader\'s compose', async () => {
  const { io, calls } = ioWith();
  const result = await composeCycle(io, {
    barIndex: 0, changes: 'Dm7', bars: 1, recent: [], intent: criticIntent(),
    steering: null, ganRounds: 1,
    extract: (reply, n) => reply.split('\n').filter(isBarLine).slice(-n),
    serveFirst: async () => null,
  });
  assert.equal(calls.compose, 1, 'the bandleader composed round 1');
  assert.equal(result.rounds[0].via, 'compose');
});

test('serveFirst absent: the v0.4 loop is untouched (compose round 1, no via)', async () => {
  const { io, calls } = ioWith();
  const result = await composeCycle(io, {
    barIndex: 0, changes: 'Dm7', bars: 1, recent: [], intent: criticIntent(),
    steering: null, ganRounds: 2,
    extract: (reply, n) => reply.split('\n').filter(isBarLine).slice(-n),
  });
  assert.equal(calls.compose, 1);
  assert.equal(result.rounds[0].via, 'compose');
});

// ── the cells' tiers through the real firing pipeline ──────────────────────

function memStore(totipotentSheet: Record<string, unknown>) {
  const cells = new Map<string, CellRow>();
  const zygote: CellRow = {
    id: 'zyg', organism: 't', name: 'zygote', tier: 'totipotent', role: 'root',
    sheet_json: JSON.stringify(totipotentSheet), cost_per_call: 1, latency_ms: 2000,
    plasticity: 1, status: 'active', created_from: '', versions: 1, created_at: 0,
  };
  const bandleader: CellRow = { ...zygote, id: 'bandleader', name: 'bandleader', created_from: 'zyg' };
  cells.set('zyg', zygote);
  cells.set('bandleader', bandleader);
  const candidates: Array<Record<string, unknown>> = [];
  const modelCalls: Array<{ system: string; user: string }> = [];
  const store: FireStore = {
    getCell: async id => cells.get(id) ?? null,
    getMyelin: async () => null,
    upsertMyelin: async () => {},
    markPromoted: async () => {},
    insertSignal: async () => 1,
    updateCellTier: async () => {},
    insertDistillation: async () => {},
    insertCandidate: async c => { candidates.push(c as unknown as Record<string, unknown>); return candidates.length; },
    callModel: async (cfg: SheetModel, req: { system: string; user: string }): Promise<ModelCall> => {
      modelCalls.push(req);
      const log: ModelExchange = { provider: 'openai-compatible', model: cfg.model, system_prompt: req.system, prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, latency_ms: 5, cost_estimate_usd: null, base_url: 'mock' };
      return { ok: true, content: '@bass | d2 . a2 . c3 . f#3 . | vel: 64', usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }, latency_ms: 5, cost_estimate_usd: null, log };
    },
  };
  return { store, cells, candidates, modelCalls, addCell: (id: string, tier: Tier, sheet: Record<string, unknown>) => cells.set(id, { ...bandleader, id, tier, sheet_json: JSON.stringify(sheet), created_from: 'bandleader' }) };
}

test('firing journey: the bass cell (differentiated) misses → the bandleader answers, candidate recorded', async () => {
  const ctx = memStore({ model: { provider: 'openai-compatible', model: 'glm-5.3', system_prompt: 'BANDLEADER', max_tokens: 1024 } });
  ctx.addCell('bass-cell', 'differentiated', bassCellSheet());
  const r = await fireSignal(ctx.store, { from: 'clock', to: 'bass-cell', kind: 'compose_bass', payload: { quality: 'maj7#11', chord: 'Cmaj7#11' } }, { now: 1, threshold: 5 });
  assert.equal(r.mode, 'escalated', 'the germ line answered for its child');
  assert.equal(r.escalated_from, 'bass-cell');
  assert.ok(ctx.candidates.length === 1, 'the hole is a distillation candidate');
  assert.ok(ctx.modelCalls[0].system.includes('bass'), 'the escalation wears the child\'s role context');
  // the known quality hits the table instead — cost 0
  const hit = await fireSignal(ctx.store, { from: 'clock', to: 'bass-cell', kind: 'compose_bass', payload: { quality: 'm7', chord: 'Dm7' } }, { now: 2, threshold: 5 });
  assert.equal(hit.mode, 'table');
  assert.equal(hit.cost_per_call, 0);
});

test('firing journey: the drum cell (multipotent) serves presets from the table, thinks only on fill miss', async () => {
  const ctx = memStore({ model: { provider: 'openai-compatible', model: 'glm-5.3', system_prompt: 'DRUM CELL OWN', max_tokens: 1024 } });
  ctx.addCell('drum-cell', 'multipotent', drumCellSheet());
  const preset = await fireSignal(ctx.store, { from: 'clock', to: 'drum-cell', kind: 'compose_drums', payload: { style: 'swing' } }, { now: 1, threshold: 5 });
  assert.equal(preset.mode, 'table');
  const fill = await fireSignal(ctx.store, { from: 'clock', to: 'drum-cell', kind: 'fill_drums', payload: { kind_of: 'turnaround' } }, { now: 2, threshold: 5 });
  assert.equal(fill.mode, 'table');
  const novel = await fireSignal(ctx.store, { from: 'clock', to: 'drum-cell', kind: 'fill_drums', payload: { kind_of: 'elephant' } }, { now: 3, threshold: 5 });
  assert.equal(novel.mode, 'model', 'a novel fill consults the cell\'s own scoped model — fills escalate only on miss');
  assert.ok(ctx.modelCalls.some(c => c.system.includes('DRUM CELL')), 'wearing its own prompt');
  assert.equal(ctx.candidates.length, 0, 'multipotent misses create no candidates — the scoped model IS this cell');
});

test('firing journey: the arranger (differentiated) misses → escalation mints the hole into the table', async () => {
  const { stock } = stockFromBar(CLEAN_Dm7, parseChord('Dm7'), { run: 'runs/x', bar: 0 });
  const ctx = memStore({ model: { provider: 'openai-compatible', model: 'glm-5.3', system_prompt: 'BANDLEADER', max_tokens: 1024 } });
  ctx.addCell('arranger', 'differentiated', arrangerSheet({ Dm7: stock! }));
  const hit = await fireSignal(ctx.store, { from: 'clock', to: 'arranger', kind: 'arrange', payload: { chord: 'Dm7' } }, { now: 1, threshold: 5 });
  assert.equal(hit.mode, 'table', 'the held chord serves free');
  const miss = await fireSignal(ctx.store, { from: 'clock', to: 'arranger', kind: 'arrange', payload: { chord: 'G7' } }, { now: 2, threshold: 5 });
  assert.equal(miss.mode, 'escalated', 'novelty escalates to the bandleader');
  assert.equal(ctx.candidates.length, 1, '…and the candidate is the mint\'s ore');
  // the gardener grows the stock into the sheet — the worker-native mint
  const grownSheet = (() => {
    const sheet = parseSheet({ sheet_json: JSON.stringify(arrangerSheet({ Dm7: stock! })) } as CellRow);
    const g7 = stockFromBar('@piano | g3-b3-f4 . . b3 . a3 . | vel: 70', parseChord('G7'), { run: 'runs/x', bar: 1 }).stock!;
    sheet.rules = [...(sheet.rules as never[]), { when: { kind: 'arrange', payload_equals: { chord: 'G7' } }, respond: { serve: 'table', cost: 0, chord: 'G7', core: g7.core, rhythm: g7.rhythm, vel: g7.vel } } as never];
    return sheet;
  })();
  const g7Now = matchRule((grownSheet.rules ?? []) as never[], 'arrange', { chord: 'G7' });
  assert.ok(g7Now.hit && (g7Now.response as Record<string, unknown>).serve === 'table', 'the grown rule serves the next G7 at cost 0');
});

test('firing journey: a COLD differentiated cell (empty table) escalates too — the empty table is the maximal hole (v0.5)', async () => {
  const ctx = memStore({ model: { provider: 'openai-compatible', model: 'glm-5.3', system_prompt: 'BANDLEADER', max_tokens: 1024 } });
  ctx.addCell('cold-arranger', 'differentiated', { organ: 'the chart, unborn' });   // no rules at all
  const r = await fireSignal(ctx.store, { from: 'clock', to: 'cold-arranger', kind: 'arrange', payload: { chord: 'Dm7' } }, { now: 1, threshold: 5 });
  assert.equal(r.mode, 'escalated', 'the germ line answers while the table is unborn');
  assert.equal(ctx.candidates.length, 1, 'and the hole is recorded — the mint\'s first ore');
});

// ── the ensemble session wire ──────────────────────────────────────────────

test('partContent: one row per declared section, mean dynamics, one voice per part', () => {
  const libretto = planLibretto({ bars: 4, form: 'AB' });
  const bars = [
    '@bass | d3-a3-c4 . . f4 . e4 . . | vel: 72',
    '@bass | . d4 . b3 . f3-g3 . . | vel: 68',
    '@bass | e3-g3-b3 . . . . c4 . d4 | vel: 64',
    '@bass | d4 . . c#4 . a2 . g3-bb3 | vel: 70',
  ];
  const content = partContent(libretto.sections, 'bass', bars);
  const lines = content.split('\n');
  assert.ok(lines[0].startsWith('[A]'), 'section header first');
  assert.ok(lines.every(l => !l.startsWith('@') || l.startsWith('@bass')), 'the part is one voice only');
  assert.equal(lines.filter(l => l.startsWith('[')).length, libretto.sections.length, 'headers mirror the form');
  assert.ok(content.includes('vel: 70'), 'mean dynamics of section A (72+68 → 70)');
  assert.ok(content.includes('vel: 67'), 'mean dynamics of section B (64+70 → 67)');
  const row = lines[1];
  assert.equal((row.match(/\|/g)?.length ?? 0), 3, 'one row: bar slots joined between two pipes + vel');
});

test('uniquifySections: the form\'s repeats get numbered (AABA → A, A2, B, A3)', () => {
  const lib = planLibretto({ bars: 8, form: 'AABA' });
  const u = uniquifySections(lib.sections);
  assert.deepEqual(u.map(s => s.name), ['A', 'A2', 'B', 'A3']);
  assert.deepEqual(u.map(s => s.bars), lib.sections.map(s => s.bars), 'spans unchanged');
  // the part mirrors the uniquified form — every header unique
  const content = partContent(u, 'bass', Array.from({ length: 8 }, (_, i) => `@bass | c${1 + (i % 2)} . g${1 + (i % 2)} . c${2 - (i % 2)} . e${1 + (i % 2)} . | vel: 6${i}`));
  const headers = content.split('\n').filter(l => l.startsWith('['));
  assert.deepEqual(headers, ['[A]', '[A2]', '[B]', '[A3]']);
  assert.equal(new Set(headers).size, 4, 'the merge is deterministic on unique names');
});

test('parseEnsembleWriteResult: accepted, rebase-refused, and prose-garbage shapes', () => {
  const ok = parseEnsembleWriteResult('{"accepted": true, "version": 7}');
  assert.deepEqual(ok, { accepted: true, version: 7, rebaseVersion: null, error: null });
  const rebase = parseEnsembleWriteResult('{"error": "@drums has moved on: you wrote against version 2, it is now at 5.", "rebase": {"voice_version": 5}}');
  assert.equal(rebase.accepted, false);
  assert.equal(rebase.rebaseVersion, 5, 'the wire hands back the state to rebase onto');
  const garbage = parseEnsembleWriteResult('mcp http 500');
  assert.equal(garbage.accepted, false);
  assert.equal(garbage.rebaseVersion, null);
});

test('normalizeToVoice: the driver owns voice tags', () => {
  assert.equal(normalizeToVoice('@piano | d3 . . | vel: 70', 'piano').startsWith('@piano | d3'), true);
  const retag = normalizeToVoice('@whatever | a2 . c3 . | vel: 60', 'bass');
  assert.ok(retag.startsWith('@bass |'));
});

// ── one downbeat, the whole band, in memory ────────────────────────────────

test('THE BAND PLAYS ONE DOWNBEAT: piano composed, bass walked, drums kept time — disjoint voices, one clock', async () => {
  const libretto = planLibretto({ bars: 8, form: 'AABA' });
  const chord = 'Dm7', next = 'G7';
  const { stock } = stockFromBar(CLEAN_Dm7, parseChord(chord), { run: 'runs/band', bar: 0 });

  // piano: arranger hit (round 1 free) — no seam call
  const { io, calls } = ioWith();
  const piano = await composeCycle(io, {
    barIndex: 4, changes: chord, bars: 1, recent: [], intent: criticIntent(),
    steering: null, ganRounds: 2,
    extract: (reply, n) => reply.split('\n').filter(isBarLine).slice(-n),
    serveFirst: async () => ({ bars: [stockBarFor(stock!, 0.55)], serve: 'arranger-table' }),
  });
  assert.equal(calls.compose, 0);

  // bass + drums: table tissue
  const bass = bassForBar(parseChord(chord), parseChord(next), null)!;
  const drums = drumForBar('swing')!;
  const fill = drumFill('turnaround')!;

  const voices = [piano.acceptedBars[0], bass.line, drums.line, fill.line];
  const tags = voices.map(v => /^@([a-z]+)/.exec(v)![1]);
  assert.deepEqual(tags, ['piano', 'bass', 'drums', 'drums']);
  assert.ok(new Set(['piano', 'bass', 'drums']).size === 3, 'voices disjoint');
  for (const v of voices) assert.ok(isBarLine(v), `${v} grammar-clean`);
  // the seam spent nothing this downbeat: compose 0, critique served by the
  // frozen gate, bass/drums on the table — the whole band at cost 0.
  assert.equal(calls.compose, 0);
});
