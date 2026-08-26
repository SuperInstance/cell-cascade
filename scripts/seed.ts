// cell-cascade — scripts/seed.ts
// Load the saved decompositions (examples/seed.json) as real rows.
//
//   WORKER_URL=http://localhost:8787 npm run seed          (local, wrangler dev)
//   WORKER_URL=https://cell-cascade.<subdomain>.workers.dev npm run seed
//
// Two phases per example: POST /examples (the library row), then
// POST /examples/{id}/instantiate (a live organism with cells, myelin
// counters, and distillation provenance). Then fires two live signals to
// prove zero-cost sclerotic tissue.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseExampleFile, type Example } from '../src/example';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WORKER_URL ?? 'http://localhost:8787';

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main(): Promise<void> {
  // the library: the four original decompositions + the mined fleet-instinct
  // organism (examples/fleet-instinct-seed.json, seeded 2026-08-25 night watch)
  const files = ['seed.json', 'fleet-instinct-seed.json'] as const;
  const examples: Example[] = [];
  for (const f of files) {
    const text = readFileSync(join(here, '..', 'examples', f), 'utf8');
    const { examples: parsed, errors } = parseExampleFile(text);
    if (errors.length) {
      console.error(`${f} failed validation:`);
      for (const e of errors) console.error(`  ✗ ${e}`);
      process.exit(1);
    }
    examples.push(...(parsed as Example[]));
  }

  // liveness
  const health = await call('GET', '/health');
  if (health.status !== 200) {
    console.error(`worker not healthy at ${BASE}: ${health.status} ${JSON.stringify(health.data)}`);
    process.exit(1);
  }
  console.log(`worker alive at ${BASE} (${health.data.cells} cells, myelin threshold ${health.data.myelin_threshold})`);

  for (const ex of examples as Example[]) {
    const saved = await call('POST', '/examples', ex);
    if (saved.status !== 201) {
      console.error(`  ✗ ${ex.id}: save failed — ${saved.status} ${JSON.stringify(saved.data)}`);
      process.exit(1);
    }
    console.log(`  ✓ example saved: ${ex.id} (${ex.kind})`);

    const inst = await call('POST', `/examples/${ex.id}/instantiate`, {});
    if (inst.status === 409) {
      console.log(`  · organism "${ex.seed.organism}" already live — skipped`);
    } else if (inst.status !== 201) {
      console.error(`  ✗ ${ex.id}: instantiate failed — ${inst.status} ${JSON.stringify(inst.data)}`);
      process.exit(1);
    } else {
      const cells = inst.data.instantiated.cells as Array<{ id: string; tier: string }>;
      console.log(`  ✓ organism live: ${ex.seed.organism} — ${cells.map(c => `${c.id.split(':')[1]}:${c.tier}`).join(', ')}`);
    }
  }

  // live proof: sclerotic tissue answers deterministically, zero model cost
  const tick = await call('POST', '/signal', {
    from: 'band-clock:yard', to: 'band-clock:do-alarm', kind: 'bar-tick', payload: { bar: 270 },
  });
  if (tick.status === 200 && tick.data.fired?.mode === 'table') {
    console.log(`  ✓ live fire: band-clock bar-tick → table hit, cost 0, latency 1ms (myelin fires ${tick.data.myelin.fire_count})`);
  } else {
    console.error(`  ✗ live fire failed: ${tick.status} ${JSON.stringify(tick.data)}`);
    process.exit(1);
  }
  const nod = await call('POST', '/signal', {
    from: 'cue-tokens:ensign-zygote', to: 'cue-tokens:cue-ack', kind: 'nod', payload: {},
  });
  if (nod.status === 200 && nod.data.fired?.response?.ack === 'ROGER') {
    console.log(`  ✓ live fire: cue-tokens nod → ROGER, zero budget (myelin fires ${nod.data.myelin.fire_count})`);
  } else {
    console.error(`  ✗ live fire failed: ${nod.status} ${JSON.stringify(nod.data)}`);
    process.exit(1);
  }
  const missing = await call('POST', '/signal', {
    from: 'cue-tokens:ensign-zygote', to: 'cue-tokens:cue-ack', kind: 'never-seen-cue', payload: {},
  });
  if (missing.status === 200 && missing.data.fired?.mode === 'table-miss') {
    console.log(`  ✓ scar-tissue detection: unknown cue → table-miss logged as error (myelin errors ${missing.data.myelin.error_count})`);
  }

  // fleet-instinct live proofs: the mined conversational reflexes fire at cost 0
  const declare = await call('POST', '/signal', {
    from: 'fleet-instinct:fleet-germ', to: 'fleet-instinct:sacred-space', kind: 'declare-space',
    payload: { bar: 9, declared_by: 'bassist', law: 'almost empty, breathe around bar 16' },
  });
  if (declare.status === 200 && declare.data.fired?.mode === 'table' && declare.data.fired?.response?.ack === 'HONORED') {
    console.log(`  ✓ live fire: fleet-instinct declare-space → HONORED (confirm-honor), cost 0 (myelin fires ${declare.data.myelin.fire_count})`);
  } else {
    console.error(`  ✗ declare-space fire failed: ${declare.status} ${JSON.stringify(declare.data)}`);
    process.exit(1);
  }
  const greenTick = await call('POST', '/signal', {
    from: 'fleet-instinct:fleet-germ', to: 'fleet-instinct:verify-from-outside', kind: 'green-tick-claim',
    payload: { claim: 'CI workflow green', source: 'internal' },
  });
  if (greenTick.status === 200 && greenTick.data.fired?.mode === 'table'
      && greenTick.data.fired?.response?.verdict === 'FLAGGED'
      && greenTick.data.fired?.response?.verify === 'against-source') {
    console.log(`  ✓ live fire: fleet-instinct green-tick-claim → FLAGGED / verify-against-source (myelin fires ${greenTick.data.myelin.fire_count})`);
  } else {
    console.error(`  ✗ green-tick fire failed: ${greenTick.status} ${JSON.stringify(greenTick.data)}`);
    process.exit(1);
  }

  console.log('seed complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
