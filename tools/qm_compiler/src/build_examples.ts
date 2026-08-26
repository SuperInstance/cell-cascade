// qm-compiler — src/build_examples.ts
// Compile the four seeded organisms (examples/seed.json) into .qm programs
// and per-example signal fixtures for the round-trip equivalence harness.
//
//   band-clock     rules compiled; bar-tick + commit fixtures (sclerotic)
//   cue-tokens     rules compiled; nod/grin/trade/again/cut/standby fixtures
//                 (incl. the payload_equals 'cut'+priority=break case)
//   unheard-duke   NO rules exist — deterministic 5 tendencies compile as
//                 BIND facts (the golden residue stays in the sheet); any
//                 signal is an honest table-miss in the bridge world
//   seamstress-eye gate math compiled as a sigma_distance EFFECT; canon
//                 centroid/sigma bound as things so the math is testable
//                 against any canon (fixtures: identical -> 0σ, +1σ on all
//                 six axes -> sqrt(6)σ)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { compileOrganism, compileGateMath, type QmProgram, type QmOp } from './compile';

interface SeedExample { id: string; seed: { organism: string; cells: any[]; myelin?: any[] } }

const seeds: SeedExample[] = JSON.parse(readFileSync('examples/seed.json', 'utf8'));
mkdirSync('tools/qm_compiler/examples', { recursive: true });
mkdirSync('tools/qm_compiler/test/fixtures', { recursive: true });

const sig = (from: string, to: string, kind: string, payload: Record<string, unknown> = {}) => ({ from, to, kind, payload });

const signals: Record<string, any[]> = {
  'band-clock': [
    sig('yard', 'do-alarm', 'bar-tick', { n: 42 }),
    sig('yard', 'do-alarm', 'commit', { bar: 41, blob: 'BAAQ' }),
    sig('yard', 'do-alarm', 'commit', { bar: 42, blob: 'BAAQ==' }),
    sig('yard', 'do-alarm', 'nonsense', { x: 1 }), // scar tissue: no rule
  ],
  'cue-tokens': [
    sig('ensign-zygote', 'cue-ack', 'nod'),
    sig('ensign-zygote', 'cue-ack', 'grin'),
    sig('ensign-zygote', 'cue-ack', 'trade', { sides: ['A', 'B'], span: '4' }),
    sig('ensign-zygote', 'cue-ack', 'again'),
    sig('ensign-zygote', 'cue-ack', 'cut', { priority: 'break' }),
    sig('ensign-zygote', 'cue-ack', 'cut', { priority: 'routine' }), // guard miss -> table-miss
    sig('ensign-zygote', 'cue-ack', 'standby'),
  ],
  'unheard-duke': [
    // no deterministic rules on the sheet: every signal is an honest miss
    sig('glm5.3', 'duke-pianist', 'tendency-query', { i: 0 }),
  ],
};

for (const ex of seeds) {
  const { program, errors } = compileOrganism(ex.seed);
  if (errors.length) { console.error(`${ex.id}: ${JSON.stringify(errors)}`); process.exit(1); }

  if (ex.id === 'seamstress-eye') {
    // Gate math: bind a canon reference (centroid/sigma as *bound things* so
    // the effect is pure), then the guarded sigma_distance effect. Fixture
    // sigma values are round numbers on the six gate1 axes; the round-trip
    // checks the MATH, not a particular canon.
    const six = [1, 1, 1, 1, 1, 1]; // unit sigma: distance = plain euclidean
    const centroid = [0.5, 0.4, 0.6, 0.3, 0.5, 0.45];
    (program as QmProgram).ops.push({ op: 'bind', target: 'eye:canon_centroid', value: centroid } as QmOp);
    (program as QmProgram).ops.push({ op: 'bind', target: 'eye:canon_sigma', value: six } as QmOp);
    (program as QmProgram).ops.push(compileGateMath('eye', { kind: 'gate-check' }));
    signals[ex.id] = [
      sig('seamstress', 'eye', 'gate-check', { features: centroid.slice() }),                                  // 0σ
      sig('seamstress', 'eye', 'gate-check', { features: centroid.map((c, i) => c + (i === 5 ? 6 : 0)) }),     // 6σ
      sig('seamstress', 'eye', 'gate-check', { features: centroid.map((c) => c + 1) }),                        // sqrt(6)σ
    ];
  }

  writeFileSync(`tools/qm_compiler/examples/${ex.id}.qm`, JSON.stringify(program, null, 2) + '\n');
  writeFileSync(
    `tools/qm_compiler/test/fixtures/${ex.id}.signals.json`,
    JSON.stringify(signals[ex.id] ?? [], null, 2) + '\n',
  );
  console.log(`${ex.id}: ${program.ops.length} ops, ${Object.keys(program.routes).length} routes, ${signals[ex.id]?.length ?? 0} signals`);
}
