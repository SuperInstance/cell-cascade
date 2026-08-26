// cell-cascade — src/librettist.ts
// THE LIBRETTIST (v0.4) — the score-level memory cell. The organism had a
// spine (the metronome), a cortex (the bandleader), and an ear (the
// critic), but no PLAN: every bar was composed against `recent` alone, no
// form, no tension curve, no idea where the piece is going. The librettist
// holds the outline — the form (AABA), the per-bar tension targets of the
// arc, the narrative — and the outline travels into every compose payload:
//
//   clock ──outline──► LIBRETTIST [sclerotic: the plan IS a rule table,
//                                    cost 0, ~1ms]
//                          │ respond: form · sections · tension_targets
//                          ▼
//                      driver merges the cursor (which bar, realized
//                      tension so far) → the payload's `outline` field
//                          │
//                          ├─► BANDLEADER composes INSIDE the arc
//                          │     (the prompt binds the outline)
//                          ▼
//                      CRITIC: the tension-curve check consumes the same
//                      targets — the first outline-driven gate channel
//
// The outline EVOLVES: after each accepted bar the driver measures the
// realized harmonic_tension, and if the piece drifts off the arc the
// remaining targets nudge to meet the music where it actually lives
// (nudgeTargets — a gentle controller, clamped, logged). Form is fate;
// the arc breathes.

import { type TraceBar, type Critique, CritiqueObservation, type Severity } from './critic';

// ── the plan ────────────────────────────────────────────────────────────────

export interface LibrettoSection {
  name: string;             // the form letter
  bars: number;
  tension_target: number;   // mean of the section's per-bar targets
  role: string;             // statement / restate / bridge / return …
}

export interface Libretto {
  form: string;                       // e.g. 'AABA'
  sections: LibrettoSection[];
  tension_targets: number[];          // one per bar — the arc the critic checks
  narrative: string;                  // one human line: the piece's story
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function roleFor(letter: string, form: string, idx: number): string {
  const first = form.indexOf(letter);
  const last = form.lastIndexOf(letter);
  if (form.length > 1 && first === last) return idx === Math.floor(form.length * 2 / 3) ? 'the bridge — lean in' : 'the contrast';
  if (idx === first) return 'the statement';
  if (idx === last) return 'the return — settle';
  return 'the restate — build on it';
}

/**
 * Plan the piece: form letters carve the bars into sections, and a smooth
 * tension arc (rise → peak mid-piece → release) sets one target per bar.
 * Deterministic, cost 0 — the librettist is sclerotic tissue: the plan is
 * a table, not a thought. Targets stay inside the critic's
 * harmonic_tension band (0.15–0.75) so the arc never fights the gate.
 */
export function planLibretto(args: { bars: number; form?: string }): Libretto {
  const bars = Math.max(1, Math.floor(args.bars));
  const form = (args.form ?? (bars >= 8 ? 'AABA' : bars >= 4 ? 'AB' : 'A')).replace(/[^A-Z]/gi, '').toUpperCase() || 'A';
  const letters = form.split('');

  // even-ish spans: earlier sections absorb the remainder
  const spans = letters.map(() => Math.floor(bars / letters.length));
  for (let i = 0; i < bars % letters.length; i++) spans[i % letters.length]++;

  // the arc: sin curve across the WHOLE piece — rises, peaks mid, releases
  const tension_targets = Array.from({ length: bars }, (_, b) =>
    Math.round(clamp(0.5 + 0.22 * Math.sin(Math.PI * (b + 0.5) / bars), 0.15, 0.75) * 1000) / 1000);

  let cursor = 0;
  const sections: LibrettoSection[] = letters.map((letter, i) => {
    const span = spans.slice(0, i + 1).reduce((a, v) => a + v, 0);
    const slice = tension_targets.slice(cursor, span);
    cursor = span;
    const mean = slice.reduce((a, v) => a + v, 0) / Math.max(1, slice.length);
    return { name: letter, bars: spans[i], tension_target: Math.round(mean * 1000) / 1000, role: roleFor(letter, form, i) };
  });

  const peak = tension_targets.indexOf(Math.max(...tension_targets));
  const narrative = `a ${bars}-bar ${form}: the statement opens spare, the arc peaks at bar ${peak + 1} where the harmony leans in, and the last section settles the piece home`;

  return { form, sections, tension_targets, narrative };
}

/** What the compose payload's `outline` field carries for one bar. */
export interface OutlineForBar {
  form: string;
  section: string;
  section_role: string;
  bar_in_section: number;
  bars_in_section: number;
  bar_in_piece: number;
  bars_total: number;
  tension_target: number;
  arc: 'rising' | 'peaking' | 'easing' | 'settling';
  narrative: string;
}

/** The outline at one bar (0-based barInPiece; wraps choruses). */
export function outlineForBar(libretto: Libretto, barInPiece: number, targets?: number[]): OutlineForBar {
  const total = libretto.tension_targets.length;
  const bar = ((barInPiece % total) + total) % total;
  const tgt = (targets ?? libretto.tension_targets)[bar];
  let acc = 0, section = libretto.sections[0], barInSec = 0;
  for (const s of libretto.sections) {
    if (bar < acc + s.bars) { section = s; barInSec = bar - acc; break; }
    acc += s.bars;
  }
  const peakIdx = (targets ?? libretto.tension_targets).indexOf(Math.max(...(targets ?? libretto.tension_targets)));
  const arc: OutlineForBar['arc'] = bar < peakIdx - 1 ? 'rising' : Math.abs(bar - peakIdx) <= 1 ? 'peaking' : bar < total - 2 ? 'easing' : 'settling';
  return {
    form: libretto.form,
    section: section.name,
    section_role: section.role,
    bar_in_section: barInSec + 1,
    bars_in_section: section.bars,
    bar_in_piece: bar + 1,
    bars_total: total,
    tension_target: tgt,
    arc,
    narrative: libretto.narrative,
  };
}

// ── the evolving half: the controller ───────────────────────────────────────

/** Drift tolerance: below this the arc stands as planned. */
export const ARC_DRIFT_TOL = 0.1;
/** A nudge never moves a future target more than this. */
export const ARC_NUDGE_MAX = 0.08;

/**
 * The outline evolves: compare realized harmonic_tension against the
 * targets so far; if the piece drifted off the arc, nudge the REMAINING
 * targets half the drift back toward the music (clamped ±ARC_NUDGE_MAX,
 * targets kept inside 0.15–0.75). Form is fate; the arc breathes.
 */
export function nudgeTargets(
  targets: number[], realized: number[],
): { targets: number[]; drift: number; nudge: number } {
  const n = Math.min(realized.length, targets.length);
  if (n === 0) return { targets, drift: 0, nudge: 0 };
  const drift = realized.slice(0, n).reduce((a, v, i) => a + (v - targets[i]), 0) / n;
  if (Math.abs(drift) <= ARC_DRIFT_TOL) return { targets, drift: Math.round(drift * 1000) / 1000, nudge: 0 };
  const nudge = Math.round(clamp(-drift / 2, -ARC_NUDGE_MAX, ARC_NUDGE_MAX) * 1000) / 1000;
  const next = targets.map((t, i) =>
    i < n ? t : Math.round(clamp(t + nudge, 0.15, 0.75) * 1000) / 1000);
  return { targets: next, drift: Math.round(drift * 1000) / 1000, nudge };
}

// ── the cell ────────────────────────────────────────────────────────────────

/** The LIBRETTIST sheet — sclerotic tissue: the plan IS the rule table.
 *  `kind:'outline'` serves the whole plan at cost 0; the driver merges the
 *  cursor (bar position, nudged targets) into the compose payload. */
export function librettistSheet(libretto: Libretto): Record<string, unknown> {
  return {
    organ: 'the librettist — holds the piece-level plan: form, arc, narrative',
    form: libretto.form,
    bars: libretto.tension_targets.length,
    rules: [
      {
        when: { kind: 'outline' },
        respond: {
          action: 'outline', cost: 0,
          form: libretto.form,
          sections: libretto.sections,
          tension_targets: libretto.tension_targets,
          narrative: libretto.narrative,
          hint: 'the plan serves whole — the driver tracks the cursor and the arc evolves',
        },
      },
    ],
  };
}

// ── the critic's first consumer: the arc check ──────────────────────────────

/** How far off the arc a bar may sit before the critic speaks (the arc is
 *  a target, not a cage — tension is coarse over 8 slots). */
export const TENSION_TARGET_TOL = 0.12;

/**
 * Judge each bar's harmonic_tension against the outline's target for that
 * bar (targets[i] aligns with trace[i]). Returns observations to APPEND to
 * a critique — the flat-curve stdev check stays as-is in cheapCritique;
 * this is the arc the librettist planned, consumed by the ear.
 */
export function arcObservations(
  trace: TraceBar[], targets: number[],
): CritiqueObservation[] {
  const out: CritiqueObservation[] = [];
  for (let i = 0; i < trace.length && i < targets.length; i++) {
    const t = trace[i].features['harmonic_tension'];
    const target = targets[i];
    if (t === undefined || !Number.isFinite(target)) continue;
    const diff = t - target;
    if (Math.abs(diff) <= TENSION_TARGET_TOL) continue;
    const severity: Severity = Math.abs(diff) > TENSION_TARGET_TOL * 2 ? 'bad' : 'warn';
    out.push({
      kind: 'tension-curve', channel: 'harmonic_tension', bar: trace[i].bar,
      value: Math.round(t * 1000) / 1000, target_lo: Math.round((target - TENSION_TARGET_TOL) * 1000) / 1000,
      target_hi: Math.round((target + TENSION_TARGET_TOL) * 1000) / 1000,
      delta: Math.round(diff * 1000) / 1000,
      severity,
      directive: diff > 0
        ? `the arc wants harmonic_tension ≈ ${target.toFixed(2)} here but the bar reads ${t.toFixed(2)} — back off the color tones, plain shells this bar`
        : `the arc wants harmonic_tension ≈ ${target.toFixed(2)} here but the bar reads ${t.toFixed(2)} — lean into the change's color, the piece is building`,
      note: `outline arc: bar ${trace[i].bar} reads ${t.toFixed(3)} vs target ${target.toFixed(3)} (tol ±${TENSION_TARGET_TOL})`,
    });
  }
  return out;
}
