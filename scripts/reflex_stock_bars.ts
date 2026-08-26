// cell-cascade — scripts/reflex_stock_bars.ts
// REFLEX-ARC stock-bar harvester. The ensemble arranger serves stock bars
// from its voicing table (cost 0); those bars went through the SAME
// critique gate but their full notation never reaches the tick-log (the
// arrange line logs only the core voicing). This script reconstructs them
// through the REAL stockBarFor() with the arranger file that was standing
// at run time + the outline's tension target for the tick — so the corpus
// builder can measure the exact bars the gate judged.
//
//   npx tsx scripts/reflex_stock_bars.ts --runs runs --out /path/stock-bars.json
//
// Honesty guards: a stock is only reconstructed when the core logged at
// serve time matches the standing file's core for that chord (rhythm is
// otherwise untrustworthy); any mismatch is reported, never papered over.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  stockBarFor, loadArrangerVoicings,
  type StockVoicing,
} from '../src/ensemble';

interface ArrangeLine { tick: number; arrange: number; chord: string; mode: string; voicing?: string[] }
interface OutlineLine { tick: number; outline: number; tension_target?: number }

const args = process.argv.slice(2);
const runsDir = args.includes('--runs') ? args[args.indexOf('--runs') + 1] : 'runs';
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'stock-bars.json';
const arrPath = args.includes('--arranger') ? args[args.indexOf('--arranger') + 1] : 'gate/arranger-voicings.json';

const arrangerFile = loadArrangerVoicings(arrPath);
if (!arrangerFile) { console.error(`arranger file not loadable: ${arrPath}`); process.exit(1); }
const arranger = arrangerFile as { voicings: Record<string, StockVoicing> };

const bars: Array<{ run: string; tick: number; chord: string; bar: string; tension_target: number }> = [];
const skipped: Array<{ run: string; tick: number; chord: string; why: string }> = [];

for (const run of readdirSync(runsDir).filter(d => d.startsWith('cortex-plug-')).sort()) {
  const log = join(runsDir, run, 'tick-log.jsonl');
  if (!existsSync(log)) continue;
  const arrange: ArrangeLine[] = [];
  const targets = new Map<number, number>();   // tick → tension target (last outline before serve)
  for (const line of readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean)) {
    let d: Record<string, unknown>;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.outline !== undefined && typeof d.tick === 'number' && typeof d.tension_target === 'number') {
      targets.set(d.tick, d.tension_target as number);
    }
    if (d.arrange !== undefined && typeof d.chord === 'string' && d.mode === 'table') {
      arrange.push({ tick: d.tick as number, arrange: d.arrange as number, chord: d.chord, mode: 'table', voicing: d.voicing as string[] | undefined });
    }
  }
  for (const a of arrange) {
    const stock: StockVoicing | undefined = arranger.voicings[a.chord];
    if (!stock) { skipped.push({ run, tick: a.tick, chord: a.chord, why: 'no standing stock for chord' }); continue; }
    if (a.voicing && JSON.stringify(a.voicing) !== JSON.stringify(stock.core)) {
      skipped.push({ run, tick: a.tick, chord: a.chord, why: `core drift: logged [${a.voicing}] vs standing [${stock.core}]` }); continue;
    }
    const target = targets.get(a.tick) ?? 0.5;
    bars.push({ run, tick: a.tick, chord: a.chord, bar: stockBarFor(stock, target), tension_target: target });
  }
}

writeFileSync(outPath, JSON.stringify({ source: arrPath, bars, skipped }, null, 1) + '\n', 'utf8');
console.log(`stock bars: ${bars.length} reconstructed, ${skipped.length} skipped (drift/missing) → ${outPath}`);
for (const s of skipped) console.log(`  skipped ${s.run} tick ${s.tick} ${s.chord}: ${s.why}`);
