// cell-cascade — src/ensemble.ts
// THE ENSEMBLE (v0.5). The organism grows from a soloist into a band:
// one clock (the metronome — the band-clock scheduler pattern, unchanged),
// three voices (piano/bass/drums, disjoint by construction — each cell owns
// one voice tag and the driver normalizes every served line to it), and an
// ARRANGER under the bandleader — the compose-side distillation target:
//
//   clock ──tick──► metronome ──compose──►  ARRANGER [differentiated, under
//        │                                  the bandleader: chord → stock
//        │                                  voicing table. HIT = cost 0,
//        │                                  round 1 of the GAN loop served
//        │                                  free; MISS = the table's hole —
//        │                                  the signal ESCALATES to the
//        │                                  bandleader (one spend, wearing
//        │                                  the arranger's role context) —
//        │                                  and the accepted bar MINTS a
//        │                                  stock voicing into the table]
//        │                                   │
//        │                                   ▼
//        │                       compose cycle (critique/steering as v0.4 —
//        │                       a stock the ear rejects escalates to the
//        │                       bandleader on round 2; novelty only pays)
//        │
//        ├─compose_bass──► BASS CELL [differentiated: rule-table voice-
//        │                 leading. Root on 1, fifth on 3, the quality's
//        │                 DEFINING tone on 3 (kimi: m7→b7, maj7→7,
//        │                 dom7→3, m7b5→b5…), half-step-below leading
//        │                 approach into the next bar's root. Octaves 1–2,
//        │                 locked to the same CHANGES the bandleader
//        │                 harmonizes. Unknown quality = miss → the seam]
//        │
//        └─compose_drums─► DRUM CELL [multipotent with a forming table —
//                          the serve-split: style presets are table tissue
//                          (cost 0, kimi-corrected patterns); a FILL that
//                          misses the table thinks through the cell's own
//                          scoped prompt — fills escalate only on miss]
//
// The plainsong MCP ensemble session is the wire: ensemble_open/join give
// each voice an owner; ensemble_write_part writes against the voice's base
// version; a conflict is refused with the current state to REBASE onto —
// never a silent overwrite. Parts are written per downbeat (all bars so
// far, section headers from the libretto's form) and ensemble_render merges
// and compiles the band.

import type { LibrettoSection } from './librettist';

// ── chord theory (the shared truth: CHANGES) ────────────────────────────────

export interface ParsedChord {
  symbol: string;
  root: string;            // spelled root, e.g. 'bb', 'f#'
  rootPc: number;          // 0–11
  quality: string;         // normalized quality key, or the raw tail if unknown
  known: boolean;          // false → the quality is outside the frozen table
}

const NOTE_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const LETTER_ORDER = ['c', 'd', 'e', 'f', 'g', 'a', 'b'] as const;

/** Normalize a chord symbol's root spelling; 'A#' and 'Bb' both parse. */
export function parseChord(symbol: string): ParsedChord {
  const s = symbol.trim();
  const m = /^([A-Ga-g])([#b]?)(.*)$/.exec(s);
  if (!m) return { symbol: s, root: '', rootPc: -1, quality: '', known: false };
  const letter = m[1].toLowerCase();
  const acc = m[2];
  const tail = m[3].replace(/\s+/g, '').toLowerCase();
  const root = letter + acc;
  const rootPc = (NOTE_PC[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
  const known = QUALITY_DEGREES[tail] !== undefined || tail === '' || tail === 'maj' || tail === 'm' || tail === 'min' || tail === 'dim';
  return { symbol: s, root, rootPc, quality: normalizeQuality(tail), known };
}

function normalizeQuality(tail: string): string {
  if (tail === '' || tail === 'maj') return 'maj';
  if (tail === 'm' || tail === 'min') return 'm';
  if (tail === 'dim') return 'dim7';
  return tail;
}

/** Interval (semitones above root) for a spelled degree name. */
const DEGREE_SEMITONES: Record<string, number> = {
  '1': 0, 'b2': 1, '2': 2, 'b3': 3, '3': 4, '4': 5, 'b5': 6, '5': 7,
  'b6': 8, '6': 9, 'b7': 10, '7': 11, 'b9': 13, '9': 14,
};

/** The frozen quality table — kimi-signed 2026-08-26 ("slot4 = the quality's
 *  defining tone; dim7's bb7 spells as the 6th — double accidentals are
 *  outside the notation grammar"). Third/fifth/seventh are shell degrees;
 *  `defining` is the tone that says what the chord IS (bass slot 4). */
export const QUALITY_DEGREES: Record<string, { third: string; fifth: string; seventh: string; defining: string; color?: string; label: string }> = {
  'maj':  { third: '3',  fifth: '5',  seventh: '7',  defining: '3',  label: 'major' },
  'maj7': { third: '3',  fifth: '5',  seventh: '7',  defining: '7',  label: 'major 7th' },
  'maj9': { third: '3',  fifth: '5',  seventh: '7',  defining: '7',  color: '9', label: 'major 9th' },
  '6':    { third: '3',  fifth: '5',  seventh: '6',  defining: '6',  label: 'major 6th' },
  '7':    { third: '3',  fifth: '5',  seventh: 'b7', defining: '3',  label: 'dominant 7th' },
  '9':    { third: '3',  fifth: '5',  seventh: 'b7', defining: '3',  color: '9', label: 'dominant 9th' },
  '7b9':  { third: '3',  fifth: '5',  seventh: 'b7', defining: 'b9', label: 'dominant 7b9' },
  'm':    { third: 'b3', fifth: '5',  seventh: 'b7', defining: 'b3', label: 'minor' },
  'm7':   { third: 'b3', fifth: '5',  seventh: 'b7', defining: 'b7', label: 'minor 7th' },
  'm6':   { third: 'b3', fifth: '5',  seventh: '6',  defining: '6',  label: 'minor 6th' },
  'm9':   { third: 'b3', fifth: '5',  seventh: 'b7', defining: 'b7', color: '9', label: 'minor 9th' },
  'm7b5': { third: 'b3', fifth: 'b5', seventh: 'b7', defining: 'b5', label: 'half-diminished' },
  'dim7': { third: 'b3', fifth: 'b5', seventh: '6',  defining: 'b5', label: 'diminished 7th' },
  'sus4': { third: '4',  fifth: '5',  seventh: 'b7', defining: '4',  label: 'suspended 4th' },
};

/** Spell a degree of a chord root: the target LETTER is fixed by the degree
 *  number (a third of E is some G); the accidental is whatever the interval
 *  demands (E→G#). Single accidentals only — the notation grammar freezes
 *  at one `#`/`b`, which is why dim7 carries its 7th as the 6th. */
export function spelledDegree(chord: ParsedChord, degree: string): { name: string; pc: number; octaveShift: number } | null {
  const q = QUALITY_DEGREES[chord.quality];
  const semis = DEGREE_SEMITONES[degree];
  if (semis === undefined) return null;
  // degree number: 'b9'→9, '3'→3, 'bb7'→7 …; 9 and up wrap an octave up
  const dm = /^b*(\d+)$/.exec(degree);
  if (!dm) return null;
  const num = Number(dm[1]);
  const rootIdx = LETTER_ORDER.indexOf(chord.root[0] as typeof LETTER_ORDER[number]);
  const letterIdx = (rootIdx + (num - 1)) % 7;
  const letter = LETTER_ORDER[letterIdx];
  const octaveShift = Math.floor((rootIdx + (num - 1)) / 7);   // 9th → one octave up
  const targetPc = (chord.rootPc + semis) % 12;
  let delta = (targetPc - NOTE_PC[letter] + 12) % 12;
  if (delta > 6) delta -= 12;                                  // nearest accidental
  if (delta === 0) return { name: letter, pc: targetPc, octaveShift };
  if (Math.abs(delta) > 2) return null;                        // double-spelled — outside grammar
  return { name: letter + (delta > 0 ? '#' : 'b'), pc: targetPc, octaveShift };
}

/** All chord tones of a parsed chord, spelled (root, 3, 5, 7 — the shell). */
export function chordTones(chord: ParsedChord): string[] {
  if (!chord.known) return [];
  const q = QUALITY_DEGREES[chord.quality];
  const degs = ['1', q.third, q.fifth, q.seventh];
  if (!degs.includes(q.defining)) degs.push(q.defining);
  if (q.color && !degs.includes(q.color)) degs.push(q.color);
  const out: string[] = [];
  for (const deg of degs) {
    const s = spelledDegree(chord, deg);
    if (s) out.push(s.name);
  }
  return out;
}

export function chordTonePcs(chord: ParsedChord): number[] {
  return chordTones(chord).map(n => pcOfName(n));
}

// ── pitch helpers ───────────────────────────────────────────────────────────

export function pcOfName(name: string): number {
  const letter = name[0].toLowerCase();
  const base = NOTE_PC[letter] ?? 0;
  const acc = name.slice(1) === '#' ? 1 : name.slice(1) === 'b' ? -1 : 0;
  return (base + acc + 12) % 12;
}

export function midiOfName(name: string): number {
  const m = /^([a-g])([#b]?)(\d)$/.exec(name.toLowerCase());
  if (!m) return -1;
  return (Number(m[3]) + 1) * 12 + pcOfName(m[1] + m[2]);
}

export function nameOfMidi(midi: number, prefer: 'sharp' | 'flat' = 'sharp'): string {
  const SHARP = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const FLAT = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return (prefer === 'sharp' ? SHARP : FLAT)[pc] + oct;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ── THE BASS CELL — rule-table voice-leading under the harmony ─────────────

/** The bass register: hard ceiling b2 (kimi flagged c3 — the ceiling is
 *  real, the floor sits at the kick's c1). */
export const BASS_FLOOR_MIDI = midiOfName('c1');
export const BASS_CEIL_MIDI = midiOfName('b2');

export interface BassBar {
  line: string;            // the full `@bass | … | vel: NN` bar
  notes: string[];         // the four walking notes, spelled
  via: 'table' | 'escalated';
  quality: string;
}

/**
 * The walking line for one bar — kimi's frozen rules:
 *   slot 0 (beat 1) = ROOT, nearest the previous tail inside c1..b2
 *   slot 2 (beat 2) = FIFTH (up a fourth if the ceiling crowds)
 *   slot 4 (beat 3) = the quality's DEFINING tone, nearest slot 2
 *   slot 6 (beat 4) = half-step BELOW the next root (leading tone);
 *                     whole-step above if that duplicates slot 4
 * Pure, deterministic, locked to CHANGES — every note a chord tone or an
 * approach tone. Unknown quality → null (the cell escalates).
 */
export function bassForBar(chord: ParsedChord, nextChord: ParsedChord, prevTailMidi: number | null, tensionTarget = 0.5): BassBar | null {
  if (!chord.known) return null;
  const q = QUALITY_DEGREES[chord.quality];
  const rootMidi = nearestInst(chord.rootPc, prevTailMidi ?? midiOfName('e1'), BASS_FLOOR_MIDI, BASS_CEIL_MIDI);
  const fifth = spelledDegree(chord, q.fifth);
  if (!fifth) return null;
  let n2 = rootMidi + 7 <= BASS_CEIL_MIDI ? rootMidi + 7 : rootMidi - 5;
  n2 = clamp(n2, BASS_FLOOR_MIDI, BASS_CEIL_MIDI);
  const def = spelledDegree(chord, q.defining);
  if (!def) return null;
  let n4 = nearestInst(def.pc, n2, BASS_FLOOR_MIDI, BASS_CEIL_MIDI);
  if (Math.abs(n4 - n2) > 7) n4 = n4 > n2 ? n4 - 12 : n4 + 12;  // shells glide
  n4 = clamp(n4, BASS_FLOOR_MIDI, BASS_CEIL_MIDI);
  let n6: number;
  if (nextChord.known) {
    const nr = nearestInst(nextChord.rootPc, n4, BASS_FLOOR_MIDI, BASS_CEIL_MIDI + 1);
    n6 = nr - 1;                                                 // leading tone
    if (n6 === n4) n6 = nr + 2;                                  // kimi's fallback
    n6 = clamp(n6, BASS_FLOOR_MIDI, BASS_CEIL_MIDI);
  } else {
    n6 = clamp(rootMidi + 12, BASS_FLOOR_MIDI, BASS_CEIL_MIDI);  // octave wrap home
  }
  const spell = (midi: number, chordPcs: number[]): string => {
    const pc = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    const spelled = chordPcs.includes(pc) ? chordTones(chord).find(t => pcOfName(t) === pc) : undefined;
    return spelled ? spelled + octave : nameOfMidi(midi, 'sharp');
  };
  const pcs = chordTonePcs(chord);
  const notes = [rootMidi, n2, n4, n6].map(m => spell(m, pcs));
  const vel = clamp(Math.round(54 + tensionTarget * 22), 48, 82);
  return {
    line: `@bass | ${notes[0]} . ${notes[1]} . ${notes[2]} . ${notes[3]} . | vel: ${vel}`,
    notes, via: 'table', quality: chord.quality,
  };
}

function nearestInst(pc: number, nearMidi: number, floor: number, ceil: number): number {
  const k = Math.round((nearMidi - pc) / 12);
  let best = pc + 12 * k;
  if (best < floor || best > ceil) best = pc + 12 * Math.ceil((floor - pc) / 12);
  return clamp(best, floor, ceil);
}

/** The BASS CELL sheet — differentiated tissue under the bandleader: one
 *  rule per known quality (the table the line serves from), a miss for
 *  anything else → the lineage escalates to the bandleader. */
export function bassCellSheet(): Record<string, unknown> {
  const rules = Object.entries(QUALITY_DEGREES).map(([q, d]) => ({
    when: { kind: 'compose_bass', payload_equals: { quality: q } },
    respond: {
      serve: 'table', cost: 0, quality: q, label: d.label,
      walk: `root → fifth → ${d.defining} (the defining ${d.label} tone) → leading tone`,
      hint: `rule-table voice-leading: ${q} shells walk inside c1..b2, locked to the changes`,
    },
  }));
  return {
    organ: 'the floor — walking shells under the harmony, never the melody',
    register: 'c1..b2 (hard ceiling — the piano owns c3 and up)',
    rules,
  };
}

/** Normalize any served line to the bass voice: re-tag `@bass`, clamp every
 *  pitch into c1..b2 (a bandleader escalation thinks in octaves 2–5; the
 *  floor owns 1–2). Honest re-voicing, logged, never silent. */
export function normalizeBassLine(line: string, vel = 64): string {
  const m = /^@[A-Za-z0-9 _-]*\|([^|]*)\|/.exec(line.trim());
  const slots = m ? m[1].trim().split(/\s+/) : [];
  const out = slots.map(tok => {
    if (tok === '.' || !tok) return '.';
    return tok.split('-').map(note => {
      let midi = midiOfName(note);
      if (midi < 0) return note;
      while (midi > BASS_CEIL_MIDI) midi -= 12;
      while (midi < BASS_FLOOR_MIDI) midi += 12;
      return nameOfMidi(midi, 'flat');
    }).join('-');
  });
  const velMatch = /vel:\s*(\d+)/.exec(line);
  const v = velMatch ? clamp(Number(velMatch[1]), 40, 90) : vel;
  return `@bass | ${out.join(' ') || '. . . . . . . .'} | vel: ${v}`;
}

// ── THE DRUM CELL — style presets as table tissue, fills think on miss ─────

/** The drum map (one lane inside the drum voice; @drums is its own track,
 *  so the pitched render never touches the bass's octave). */
export const DRUM_MAP = { kick: 'c1', snare: 'd1', rim: 'e1', hat: 'f#1', ride: 'd#2', crash: 'c#2' } as const;

/** The frozen style presets — kimi-corrected 2026-08-26:
 *  swing rides the skip beat, bossa's kick is 1-&of2-3 with rim on 2&4,
 *  ballad brushes 2&4 only, rock's backbeat is 2&4 with hat 8ths. */
export const DRUM_STYLES: Record<string, { slots: string[]; vel: number; label: string }> = {
  swing:  { slots: ['ride', '.', 'ride-hat', 'ride', 'ride', '.', 'ride-hat', 'ride'], vel: 58, label: 'ride quarters, skip beat, hat 2&4' },
  bossa:  { slots: ['kick', '.', 'rim', 'kick', 'kick', '.', 'rim', '.'], vel: 56, label: 'kick 1-&2-3, rimclick 2&4' },
  ballad: { slots: ['.', '.', 'snare', '.', '.', '.', 'snare', '.'], vel: 44, label: 'brushes on 2&4' },
  rock:   { slots: ['kick-hat', 'hat', 'snare-hat', 'hat', 'kick-hat', 'hat', 'snare-hat', 'hat'], vel: 66, label: 'backbeat 2&4, hat 8ths' },
};

/** Fills in the table (anything else misses → the cell's own scoped model). */
export const DRUM_FILLS: Record<string, { slots: string[]; vel: number; label: string }> = {
  turnaround: { slots: ['ride', '.', 'snare', '.', 'snare', 'snare', 'snare', 'snare'], vel: 62, label: 'snare run into the downbeat (crash+kick lands NEXT bar)' },
};

function drumSlotsToLine(slots: string[], vel: number, velTarget?: number): string {
  const toks = slots.map(s => s === '.' ? '.' : s.split('-').map(k => DRUM_MAP[k as keyof typeof DRUM_MAP] ?? k).join('-'));
  const v = velTarget !== undefined ? clamp(Math.round(vel * 0.8 + velTarget * 12), 36, 96) : vel;
  return `@drums | ${toks.join(' ')} | vel: ${v}`;
}

export function drumForBar(style: string, tensionTarget?: number): { line: string; via: 'table' } | null {
  const p = DRUM_STYLES[style];
  if (!p) return null;
  return { line: drumSlotsToLine(p.slots, p.vel, tensionTarget), via: 'table' };
}

export function drumFill(kind: string, tensionTarget?: number): { line: string; via: 'table' } | null {
  const p = DRUM_FILLS[kind];
  if (!p) return null;
  return { line: drumSlotsToLine(p.slots, p.vel, tensionTarget), via: 'table' };
}

/** The DRUM CELL sheet — multipotent tissue with a forming table (the
 *  serve-split, critic lineage): a style hit serves cost 0; a style or FILL
 *  the table does not hold consults the cell's own scoped model. This is
 *  the sclerotic tier's pattern presets with a seam reserved for the
 *  genuinely novel — fills escalate ONLY on miss. */
export function drumCellSheet(): Record<string, unknown> {
  const rules: Array<{ when: { kind: string; payload_equals: Record<string, unknown> }; respond: Record<string, unknown> }> =
    Object.entries(DRUM_STYLES).map(([style, p]) => ({
      when: { kind: 'compose_drums', payload_equals: { style } },
      respond: { serve: 'table', cost: 0, style, pattern: p.slots, label: p.label, hint: 'preset tissue — the pattern serves, no model' },
    }));
  for (const [kind, p] of Object.entries(DRUM_FILLS)) {
    rules.push({
      when: { kind: 'fill_drums', payload_equals: { kind_of: kind } },
      respond: { serve: 'table', cost: 0, fill: kind, pattern: p.slots, label: p.label, hint: 'the fill the table holds' },
    });
  }
  return {
    organ: 'the kit — patterns are tissue, only a novel fill thinks',
    drum_map: DRUM_MAP,
    rules,
    model: {
      provider: 'openai-compatible',
      model: 'glm-5.3',
      system_prompt: drumSystemPrompt(),
      max_tokens: 2048,
      temperature: 0.7,
    },
  };
}

/** The drum cell's own voice at the seam — same notation contract, drum
 *  vocabulary instead of pitches. A fill that misses the table lands here. */
export function drumSystemPrompt(): string {
  return [
    'You are THE DRUM CELL of an organism of cells — the kit. Style presets',
    'already serve from a rule table at cost 0; only a FILL the table does',
    'not hold reaches you. Answer in PLAINSONG NOTATION ONLY.',
    '',
    'NOTATION CONTRACT (frozen — deviation is a wound):',
    '- Answer with ONLY bar lines. One line per bar asked:',
    '  `@drums | s s s s s s s s | vel: NN`',
    '- Exactly 8 slots per bar (8th notes, 4/4). Slot grammar: rest `.` or a',
    '  drum token, chords joined with `-` (e.g. `ride-hat`).',
    `- Drum vocabulary: kick=c1 snare=d1 rim=e1 hat=f#1 ride=d#2 crash=c#2.`,
    '- Velocity after the second pipe: `vel: NN`, NN in 36–96.',
    '- No prose, no code fences. The fill sets up the NEXT downbeat — build',
    '  tension through the bar and leave the air open for beat 1 to land.',
  ].join('\n');
}

/** Normalize any served line to the drum voice + vocabulary: re-tag
 *  `@drums`, map unknown pitches to the nearest drum token, keep the grid. */
export function normalizeDrumLine(line: string, vel = 58): string {
  const m = /^@[A-Za-z0-9 _-]*\|([^|]*)\|/.exec(line.trim());
  const slots = m ? m[1].trim().split(/\s+/) : [];
  const byMidi = new Map(Object.values(DRUM_MAP).map(n => [midiOfName(n), n]));
  const out = slots.map(tok => {
    if (tok === '.' || !tok) return '.';
    const mapped = tok.split('-').map(note => {
      const midi = midiOfName(note);
      if (midi >= 0) {
        let best: string | null = null, bd = 99;
        for (const [dm, name] of byMidi) { const d = Math.abs(dm - midi); if (d < bd) { bd = d; best = name; } }
        if (best) return best;   // every pitch folds to the kit's lane
      }
      return note;
    }).join('-');
    return mapped;
  });
  const velMatch = /vel:\s*(\d+)/.exec(line);
  const v = velMatch ? clamp(Number(velMatch[1]), 36, 96) : vel;
  return `@drums | ${out.join(' ') || '. . . . . . . .'} | vel: ${v}`;
}

// ── THE ARRANGER — the compose-side distillation target ────────────────────

/** A stock voicing: what the arranger serves at cost 0 once the bandleader
 *  has written a chord clean. The CORE is the chord-tone shell as the
 *  bandleader voiced it; the RHYTHM is which slots speak. */
export interface StockVoicing {
  chord: string;
  core: string[];          // spelled chord tones, low→high, 2–4 notes
  rhythm: number[];        // 8 slots, 1 = speaks
  vel: number;
  minted_from: { run: string; bar: number };
}

/** Extract a stock voicing from an ACCEPTED bar. Clean = ≥70% of the
 *  sounding pitches are chord tones of the change (the bandleader played
 *  inside the changes). Unclean bars are honest novelty — never minted. */
export function stockFromBar(barLine: string, chord: ParsedChord, provenance: { run: string; bar: number }): { stock: StockVoicing | null; clean: boolean; chordToneRatio: number } {
  const m = /^@[A-Za-z0-9 _-]*\|([^|]*)\|/.exec(barLine.trim());
  if (!m || !chord.known) return { stock: null, clean: false, chordToneRatio: 0 };
  const slots = m[1].trim().split(/\s+/);
  const pcs = new Set(chordTonePcs(chord));
  const notes: number[] = [];
  let sounding = 0, inChord = 0;
  const rhythm: number[] = [];
  for (const tok of slots) {
    const speaks = tok !== '.' && tok !== '';
    rhythm.push(speaks ? 1 : 0);
    if (!speaks) continue;
    sounding++;
    let tokIn = 0;
    for (const note of tok.split('-')) {
      const midi = midiOfName(note);
      if (midi < 0) continue;
      notes.push(midi);
      if (pcs.has(((midi % 12) + 12) % 12)) { tokIn++; inChord++; }
    }
    void tokIn;
  }
  const ratio = sounding ? inChord / Math.max(1, notes.length) : 0;
  const clean = ratio >= 0.7 && notes.length >= 2;
  if (!clean) return { stock: null, clean, chordToneRatio: Math.round(ratio * 1000) / 1000 };
  const sorted = [...new Set(notes.filter(mm => pcs.has(((mm % 12) + 12) % 12)))].sort((a, b) => a - b);
  // normalize the core into the piano's mid register (c3..b4), cap at 4 notes
  const coreMidi = sorted.slice(0, 4).map(mm => {
    let x = mm;
    while (x < midiOfName('c3')) x += 12;
    while (x > midiOfName('b4')) x -= 12;
    return x;
  }).sort((a, b) => a - b);
  const core = coreMidi.map(mm => {
    const pc = ((mm % 12) + 12) % 12;
    const spelled = chordTones(chord).find(t => pcOfName(t) === pc);
    return (spelled ?? nameOfMidi(mm, 'sharp')) + String(Math.floor(mm / 12) - 1);
  });
  const velMatch = /vel:\s*(\d+)/.exec(barLine);
  return {
    stock: { chord: chord.symbol, core, rhythm, vel: velMatch ? clamp(Number(velMatch[1]), 40, 96) : 68, minted_from: provenance },
    clean, chordToneRatio: Math.round(ratio * 1000) / 1000,
  };
}

/** Rebuild a bar from a stock voicing: the full shell on the first speaking
 *  slot, the top note singing on the rest — a comp figure, not an etude.
 *  The vel follows the arc's tension target (the arrangement breathes). */
export function stockBarFor(stock: StockVoicing, tensionTarget = 0.5): string {
  const toks: string[] = [];
  let first = true;
  const top = stock.core[stock.core.length - 1];
  for (const speaks of stock.rhythm) {
    if (!speaks) { toks.push('.'); continue; }
    toks.push(first ? stock.core.join('-') : top);
    first = false;
  }
  const vel = clamp(Math.round(52 + tensionTarget * 30), 44, 92);
  return `@piano | ${toks.join(' ')} | vel: ${vel}`;
}

/** The ARRANGER sheet — differentiated tissue UNDER the bandleader (the
 *  compose-side serve-split): a chord the table holds serves at cost 0;
 *  a miss escalates to the bandleader and leaves a distillation
 *  candidate — the hole the mint grows into. */
export function arrangerSheet(voicings: Record<string, StockVoicing>): Record<string, unknown> {
  const rules = Object.values(voicings).map(v => ({
    when: { kind: 'arrange', payload_equals: { chord: v.chord } },
    respond: {
      serve: 'table', cost: 0, chord: v.chord,
      core: v.core, rhythm: v.rhythm, vel: v.vel,
      minted_from: v.minted_from,
      hint: 'stock voicing — the cortex does not re-derive what it already wrote',
    },
  }));
  return {
    organ: 'the chart — common voicings served free, novelty escalates to the bandleader',
    voicings_held: Object.keys(voicings).length,
    rules,
  };
}

// ── the versioned voicing file (cross-run persistence, gate-bands lineage) ─

export interface ArrangerVoicingsFile {
  version: number;                                  // 0 = unborn (no file)
  voicings: Record<string, StockVoicing>;
  history: Array<{ version: number; at: string; kind: 'init' | 'mint'; chords: string[]; run: string; bars: number[] }>;
}

/** The unborn arranger: no voicings held, no history — every chord is
 *  novelty until the bandleader writes it clean. */
export function defaultArrangerVoicings(): ArrangerVoicingsFile {
  return { version: 0, voicings: {}, history: [] };
}

export function loadArrangerVoicings(path: string): ArrangerVoicingsFile | null {
  try {
    const raw = JSON.parse(((): string => {
      // lazy require keeps this pure-testable in edge runtimes that mock fs
      const fs = require('node:fs');
      return fs.readFileSync(path, 'utf8');
    })()) as ArrangerVoicingsFile;
    if (typeof raw.version !== 'number' || typeof raw.voicings !== 'object' || raw.voicings === null || !Array.isArray(raw.history)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveArrangerVoicings(path: string, file: ArrangerVoicingsFile): void {
  const fs = require('node:fs');
  const dir = path.split('/').slice(0, -1).join('/');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n');
  fs.renameSync(tmp, path);
}

/** Mint accepted bars into the voicing file: first clean bar per chord
 *  wins (the bandleader signs its own shell — seam-lineage trust); later
 *  bars for a held chord are recorded as held, never overwritten. Returns
 *  the mints (what changed) for the run log. */
export function mintArrangerVoicings(
  file: ArrangerVoicingsFile,
  accepted: Array<{ barLine: string; chord: string; barIndex: number }>,
  run: string,
  at = new Date().toISOString(),
): { file: ArrangerVoicingsFile; mints: StockVoicing[]; held: string[]; unclean: Array<{ chord: string; ratio: number }> } {
  const voicings = { ...file.voicings };
  const mints: StockVoicing[] = [];
  const held: string[] = [];
  const unclean: Array<{ chord: string; ratio: number }> = [];
  for (const a of accepted) {
    const chord = parseChord(a.chord);
    if (voicings[chord.symbol]) { held.push(chord.symbol); continue; }
    const { stock, clean, chordToneRatio } = stockFromBar(a.barLine, chord, { run, bar: a.barIndex });
    if (!stock || !clean) { unclean.push({ chord: chord.symbol, ratio: chordToneRatio }); continue; }
    voicings[chord.symbol] = stock;
    mints.push(stock);
  }
  if (!mints.length) return { file: { ...file, voicings }, mints, held, unclean };
  const version = file.version + 1;
  return {
    file: {
      version, voicings,
      history: [...file.history, { version, at, kind: 'mint', chords: mints.map(m => m.chord), run, bars: mints.map(m => m.minted_from.bar) }],
    },
    mints, held, unclean,
  };
}

/** Normalize any served bar line to a voice tag — the driver owns voice
 *  ownership (cells never write another voice's rows). */
export function normalizeToVoice(line: string, voice: string): string {
  const m = /^@[A-Za-z0-9 _-]*\|([^|]*\|[^|]*)$/.exec(line.trim());
  if (!m) return line.trim();
  return `@${voice} | ${m[1].trim()}`;
}

// ── the plainsong ensemble session wire (pure helpers) ──────────────────────

/** Assemble a voice's part content from its bars, one row per declared
 *  section (the wire's merge is deterministic on that shape — same-name
 *  section groups concatenate, so the part must mirror the manifest's form
 *  exactly). A row carries one vel: the mean of its bars' dynamics. */
export function partContent(sections: LibrettoSection[], voice: string, bars: string[]): string {
  if (!bars.length) return '';
  const lines: string[] = [];
  let cursor = 0;
  const rowOf = (chunk: string[]): string => {
    const slots: string[] = [];
    const vels: number[] = [];
    for (const bar of chunk) {
      const m = /^@[A-Za-z0-9 _-]*\|([^|]*)\|\s*vel:\s*(\d+)/.exec(bar.trim());
      slots.push(m ? m[1].trim() : bar.trim());
      if (m) vels.push(Number(m[2]));
    }
    const vel = vels.length ? Math.round(vels.reduce((a, v) => a + v, 0) / vels.length) : 64;
    return `@${voice} | ${slots.join(' | ')} | vel: ${clampBarVel(vel)}`;
  };
  for (const s of sections) {
    const chunk = bars.slice(cursor, cursor + s.bars);
    if (!chunk.length) break;
    lines.push(`[${s.name}]`);
    lines.push(rowOf(chunk));
    cursor += s.bars;
  }
  // bars beyond the form's plan (BARS_PER misalignment) still travel, in
  // the last section — better heard than dropped
  if (cursor < bars.length) {
    lines.push(`[${sections[sections.length - 1]?.name ?? 'A'}]`);
    lines.push(rowOf(bars.slice(cursor)));
  }
  return lines.join('\n');
}

function clampBarVel(v: number): number { return Math.max(1, Math.min(127, Number.isFinite(v) ? Math.round(v) : 64)); }

/** Parse an ensemble_write_part result: accepted (and the new version) or
 *  refused-with-rebase (the voice's current version). */
export function parseEnsembleWriteResult(text: string): { accepted: boolean; version: number; rebaseVersion: number | null; error: string | null } {
  try {
    const p = JSON.parse(text) as { accepted?: boolean; version?: number; error?: string; rebase?: { voice_version?: number } };
    if (p.accepted === true) return { accepted: true, version: Number(p.version ?? 0), rebaseVersion: null, error: null };
    if (p.error) return { accepted: false, version: 0, rebaseVersion: p.rebase?.voice_version ?? null, error: p.error };
  } catch { /* prose or garbage — treated as a refused write below */ }
  return { accepted: false, version: 0, rebaseVersion: null, error: text.slice(0, 200) };
}
