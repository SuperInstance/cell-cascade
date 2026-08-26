// cell-cascade — scripts/reflex_reference.ts
// REFLEX-ARC DESKTOP REFERENCE. The metal gate must judge identically to
// the desktop gate; this script produces the desktop half of that proof.
// It replays the REAL critique vectors (bars the organism actually wrote,
// re-measured by the same deterministic ear — see quilt-esp32
// tools/reflex/build_corpus.py for provenance) through the REAL
// cheapCritique() from src/critic.ts and emits one reference line per
// vector: per-channel severity, gray flags, penalty (µ) and the verdict.
//
//   npx tsx scripts/reflex_reference.ts --corpus <vectors.jsonl> --out <ref.jsonl>
//
// The trace is a single bar, so the cross-bar tissue (voice-leading,
// tension-curve, librettist arc) cannot fire — this is exactly the
// 6-channel band gate the reflex-arc export carries, judged by the same
// code the organism ran. Feature floats are recovered from µ integers as
// µ/1e6; for 6-decimal values that division is correctly rounded to the
// same double JSON parsing would produce, so the desktop judges the same
// numbers the board received (noted in the reflex-arc doc, verified by
// the replay agreement).
//
// Output line shape (JSONL):
//   {"id":..,"sev":{"note_density":"ok|warn|bad",...},"gray":{...bool},
//    "pen_u":<int>,"verdict":"accept|revise","summary":"..."}

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CRITIC_FEATURES, AMBIGUITY_BAND, cheapCritique, criticIntent,
  type CriticChannel, type CriticIntent, type TraceBar,
} from '../src/critic';
import { loadGateBands } from '../src/mint';

export interface CorpusVector {
  id: number;
  bar: string;
  runs?: string[];
  sources?: string[];
  features: Record<string, number>;   // µ integers (1e-6 grid)
}

export function referenceIntent(gatePath = 'gate/gate-bands.json'): CriticIntent {
  const gateFile = loadGateBands(gatePath);
  // exactly what the driver does: standing minted bands, calibrated defaults
  // underneath for any channel the mint has not touched
  return criticIntent(gateFile ? { ...gateFile.bands } : {});
}

/** Judge one corpus vector with the real desktop gate. */
export function referenceLine(v: CorpusVector, intent: CriticIntent): Record<string, unknown> {
  const features: Record<string, number> = {};
  for (const ch of CRITIC_FEATURES) {
    const u = v.features[ch];
    if (typeof u !== 'number' || !Number.isFinite(u)) throw new Error(`vector ${v.id}: missing µ value for ${ch}`);
    features[ch] = u / 1e6;      // exact: both are correctly-rounded doubles of the same 6dp decimal
  }
  const trace: TraceBar[] = [{ bar: 1, features }];
  const critique = cheapCritique(trace, intent);

  const sev: Record<string, string> = {};
  const gray: Record<string, boolean> = {};
  for (const ch of CRITIC_FEATURES) { sev[ch] = 'ok'; gray[ch] = false; }
  for (const o of critique.observations) {
    if (o.kind !== 'band') continue;            // single bar: only band observations can exist
    sev[o.channel] = o.severity;
    gray[o.channel] = o.note.includes('gray zone');
  }
  return {
    id: v.id,
    sev, gray,
    pen_u: Math.round(critique.penalties.total * 1e6),
    verdict: critique.verdict,
    summary: critique.summary,
  };
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const corpusPath = args.includes('--corpus') ? args[args.indexOf('--corpus') + 1] : 'vectors.jsonl';
  const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'ref.jsonl';
  const gatePath = args.includes('--gate') ? args[args.indexOf('--gate') + 1] : 'gate/gate-bands.json';

  const intent = referenceIntent(gatePath);
  const lines = readFileSync(corpusPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const out: string[] = [`# desktop reference — cheapCritique single-bar band gate · gate ${gatePath} · ambiguity ${AMBIGUITY_BAND}`];
  const txt: string[] = [];   // plain feed: id sev×6 gray×6 pen verdict (host harness)
  let n = 0, revise = 0;
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const v = JSON.parse(line) as CorpusVector;
    const r = referenceLine(v, intent);
    out.push(JSON.stringify(r));
    const sev = r.sev as Record<string, string>;
    const gray = r.gray as Record<string, boolean>;
    txt.push([
      r.id,
      ...CRITIC_FEATURES.map(ch => sev[ch] === 'bad' ? 2 : sev[ch] === 'warn' ? 1 : 0),
      ...CRITIC_FEATURES.map(ch => gray[ch] ? 1 : 0),
      r.pen_u, r.verdict === 'revise' ? 1 : 0,
    ].join(' '));
    n++;
    if (r.verdict === 'revise') revise++;
  }
  writeFileSync(outPath, out.join('\n') + '\n', 'utf8');
  const txtPath = outPath.replace(/\.jsonl$/, '.txt');
  writeFileSync(/\.jsonl$/.test(outPath) ? txtPath : outPath + '.txt', txt.join('\n') + '\n', 'utf8');
  console.log(`reference: ${n} vectors judged (${revise} revise, ${n - revise} accept) → ${outPath} + ${txtPath}`);
}
