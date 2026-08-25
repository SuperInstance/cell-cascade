// cell-cascade — src/index.ts
// THE DIFFERENTIATION CASCADE as running infrastructure.
//
// A model is a stem cell. Differentiation = pruning potential into scope.
// Tissue scleroses when a signal path myelinates (fires often, fails never):
// tendency -> rule table, model call -> 0ms lookup. The quilt is the neural
// inter-connector — this worker is its axon ledger.
//
// See README.md for the full endpoint contract and the tier ladder.

import { TIERS, TIER_PROFILE, isTier, canDistill, tierIndex, type Tier } from './tiers';
import {
  matchRule, shouldMyelinate, healPlan, healthSnapshot, lineageOf, parseSheet,
  MYELIN_THRESHOLD_DEFAULT, type Rule, type CellRow,
} from './cascade';
import { validateExample, type Example, type ExampleSeed, type SeedCell } from './example';

export interface Env {
  DB: D1Database;
  MYELIN_THRESHOLD?: string; // optional override, e.g. for demos
}

const SYSTEM_SENDERS = new Set(['wound', 'clock', 'environment', 'seed']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function newCellId(): string {
  return `c_${crypto.randomUUID().slice(0, 8)}`;
}

function threshold(env: Env): number {
  const n = Number(env.MYELIN_THRESHOLD);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : MYELIN_THRESHOLD_DEFAULT;
}

function cellFrom(row: Record<string, unknown>): CellRow {
  return {
    id: row.id as string,
    organism: row.organism as string,
    name: row.name as string,
    tier: row.tier as Tier,
    role: row.role as string,
    sheet_json: row.sheet_json as string,
    cost_per_call: Number(row.cost_per_call),
    latency_ms: Number(row.latency_ms),
    plasticity: Number(row.plasticity),
    status: row.status as 'active' | 'retired',
    created_from: (row.created_from as string | null) ?? null,
    versions: Number(row.versions),
    created_at: Number(row.created_at),
  };
}

async function getCell(db: D1Database, id: string): Promise<CellRow | null> {
  const row = await db.prepare('SELECT * FROM cells WHERE id = ?').bind(id).first();
  return row ? cellFrom(row) : null;
}

async function insertDistillation(
  db: D1Database, cellId: string, fromTier: string, toTier: string,
  evidenceRef: string | null | undefined, verdict: string, at: number,
): Promise<void> {
  await db.prepare(
    'INSERT INTO distillations (cell_id, from_tier, to_tier, evidence_ref, gardener_verdict, at) VALUES (?,?,?,?,?,?)',
  ).bind(cellId, fromTier, toTier, evidenceRef, verdict, at).run();
}

async function updateCellTier(db: D1Database, cell: CellRow, toTier: Tier, at: number): Promise<void> {
  const prof = TIER_PROFILE[toTier];
  await db.prepare(
    'UPDATE cells SET tier = ?, plasticity = ?, cost_per_call = ?, latency_ms = ?, versions = versions + 1 WHERE id = ?',
  ).bind(toTier, prof.plasticity, prof.cost_per_call, prof.latency_ms, cell.id).run();
  void at;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = url.pathname;
    const now = Date.now();

    const body = async <T extends Record<string, unknown>>(): Promise<T | null> => {
      try { return await request.json() as T; } catch { return null; }
    };

    try {
      // ── landing & liveness ────────────────────────────────────────────
      if (path === '/' && request.method === 'GET') {
        return json({
          name: 'cell-cascade',
          doctrine: 'a model is a stem cell; differentiation = pruning potential into scope',
          ladder: TIERS,
          endpoints: [
            'POST /organism {name}',
            'GET /organisms',
            'POST /cell {organism, name, from_cell, role, tier?}',
            'GET /cells?organism=',
            'GET /cells/{id}',
            'POST /signal {from, to, kind, payload}',
            'POST /cells/{id}/distill {to_tier, evidence_ref, gardener_verdict}',
            'GET /organism/{name}/health',
            'POST /wound {cell_id}',
            'GET /examples', 'POST /examples', 'POST /examples/{id}/instantiate {organism?}',
            'GET /health',
          ],
        });
      }
      if (path === '/health' && request.method === 'GET') {
        const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM cells').first<{ n: number }>();
        return json({ ok: true, cells: n?.n ?? 0, myelin_threshold: threshold(env), at: now });
      }

      // ── POST /organism — create organism + zygote ─────────────────────
      if (path === '/organism' && request.method === 'POST') {
        const b = await body<{ name?: string }>();
        const name = String(b?.name ?? '').trim();
        if (!name) return err('name is required');
        const existing = await env.DB.prepare(
          "SELECT zygote_id FROM organisms WHERE name = ?",
        ).bind(name).first();
        if (existing) return err(`organism "${name}" already exists (zygote ${existing.zygote_id})`, 409);

        const id = newCellId();
        const prof = TIER_PROFILE.totipotent;
        await env.DB.batch([
          env.DB.prepare(
            'INSERT INTO organisms (name, zygote_id, created_at) VALUES (?,?,?)',
          ).bind(name, id, now),
          env.DB.prepare(
            'INSERT INTO cells (id, organism, name, tier, role, sheet_json, cost_per_call, latency_ms, plasticity, status, created_from, versions, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ).bind(id, name, `${name}-zygote`, 'totipotent', 'zygote — full model + seed, unexpressed potential',
            JSON.stringify({ dna: `${name} germ line — every cell inherits this sheet`, model: 'GLM-5.3' }),
            prof.cost_per_call, prof.latency_ms, prof.plasticity, 'active', null, 1, now),
        ]);
        const cell = await getCell(env.DB, id);
        return json({ organism: name, zygote: cell }, 201);
      }

      if (path === '/organisms' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT o.name, o.zygote_id, o.created_at,
                  (SELECT COUNT(*) FROM cells c WHERE c.organism = o.name AND c.status = 'active') AS active_cells
           FROM organisms o ORDER BY o.created_at`,
        ).all();
        return json({ organisms: results });
      }

      // ── POST /cell — mitosis ──────────────────────────────────────────
      if (path === '/cell' && request.method === 'POST') {
        const b = await body<{ organism?: string; name?: string; from_cell?: string; role?: string; tier?: string; sheet_patch?: Record<string, unknown> }>();
        const organism = String(b?.organism ?? '').trim();
        const name = String(b?.name ?? '').trim();
        const fromCell = String(b?.from_cell ?? '').trim();
        const role = String(b?.role ?? '').trim();
        if (!organism || !name || !fromCell) return err('organism, name, from_cell are required');

        const parent = await getCell(env.DB, fromCell);
        if (!parent) return err(`from_cell "${fromCell}" not found`, 404);
        if (parent.status !== 'active') return err(`parent ${parent.id} is ${parent.status} — wound-heal first`);
        if (parent.organism !== organism) return err(`parent belongs to organism "${parent.organism}"`);

        let tier: Tier = parent.tier; // plain mitosis: child inherits the parent's tier
        if (b?.tier !== undefined) {
          if (!isTier(b.tier)) return err(`tier must be one of ${TIERS.join('|')}`);
          tier = b.tier;
          if (tier !== parent.tier && !canDistill(parent.tier, tier)) {
            return err(`mitosis cannot move ${parent.tier} -> ${tier}: fate flows DOWN the ladder (upward is wound healing's job)`);
          }
        }

        const id = newCellId();
        const prof = TIER_PROFILE[tier];
        // child inherits the sheet (the DNA), the role is the new fate slot
        const sheet = parseSheet(parent);
        if (b?.sheet_patch && typeof b.sheet_patch === 'object') Object.assign(sheet, b.sheet_patch);
        await env.DB.batch([
          env.DB.prepare(
            'INSERT INTO cells (id, organism, name, tier, role, sheet_json, cost_per_call, latency_ms, plasticity, status, created_from, versions, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ).bind(id, organism, name, tier, role || parent.role, JSON.stringify(sheet),
            prof.cost_per_call, prof.latency_ms, prof.plasticity, 'active', parent.id, parent.versions + 1, now),
          env.DB.prepare('UPDATE cells SET versions = versions + 1 WHERE id = ?').bind(parent.id),
        ]);
        const cell = await getCell(env.DB, id);
        return json({ mitosis: { parent: parent.id, parent_versions: parent.versions + 1 }, child: cell }, 201);
      }

      // ── GET /cells ────────────────────────────────────────────────────
      if (path === '/cells' && request.method === 'GET') {
        const organism = url.searchParams.get('organism');
        const { results } = organism
          ? await env.DB.prepare('SELECT * FROM cells WHERE organism = ? ORDER BY created_at').bind(organism).all()
          : await env.DB.prepare('SELECT * FROM cells ORDER BY created_at LIMIT 500').all();
        return json({ cells: results });
      }

      // ── /cells/{id} and /cells/{id}/distill ───────────────────────────
      const cellMatch = path.match(/^\/cells\/([^/]+)$/);
      const distillMatch = path.match(/^\/cells\/([^/]+)\/distill$/);
      if (distillMatch && request.method === 'POST') {
        const cell = await getCell(env.DB, decodeURIComponent(distillMatch[1]));
        if (!cell) return err('cell not found', 404);
        const b = await body<{ to_tier?: string; evidence_ref?: string; gardener_verdict?: string }>();
        if (!isTier(b?.to_tier)) return err(`to_tier must be one of ${TIERS.join('|')}`);
        const toTier = b!.to_tier as Tier;
        if (!canDistill(cell.tier, toTier)) {
          return err(`cannot distill ${cell.tier} -> ${toTier}: fate flows DOWN the ladder (${TIERS.join(' > ')})`);
        }
        if (!String(b?.evidence_ref ?? '').trim()) {
          return err('evidence_ref is required — no fate decision without provenance');
        }
        const verdict = String(b?.gardener_verdict ?? '').trim() || `gardener distillation ${cell.tier} -> ${toTier}`;
        await updateCellTier(env.DB, cell, toTier, now);
        await insertDistillation(env.DB, cell.id, cell.tier, toTier, b!.evidence_ref, verdict, now);
        const updated = await getCell(env.DB, cell.id);
        return json({ distilled: updated, evidence_ref: b!.evidence_ref, gardener_verdict: verdict });
      }
      if (cellMatch && request.method === 'GET') {
        const cell = await getCell(env.DB, decodeURIComponent(cellMatch[1]));
        if (!cell) return err('cell not found', 404);
        const [signals, myelin, distillations, children] = await Promise.all([
          env.DB.prepare('SELECT * FROM signals WHERE to_cell = ? OR from_cell = ? ORDER BY at DESC LIMIT 25').bind(cell.id, cell.id).all(),
          env.DB.prepare('SELECT * FROM myelin WHERE to_cell = ? OR from_cell = ? ORDER BY fire_count DESC').bind(cell.id, cell.id).all(),
          env.DB.prepare('SELECT * FROM distillations WHERE cell_id = ? ORDER BY at').bind(cell.id).all(),
          env.DB.prepare("SELECT id, name, tier, role, status FROM cells WHERE created_from = ?").bind(cell.id).all(),
        ]);
        return json({ cell, signals: signals.results, myelin: myelin.results, distillations: distillations.results, children: children.results });
      }

      // ── POST /signal — log + fire ─────────────────────────────────────
      if (path === '/signal' && request.method === 'POST') {
        const b = await body<{ from?: string; to?: string; kind?: string; payload?: Record<string, unknown> }>();
        const from = String(b?.from ?? '').trim();
        const to = String(b?.to ?? '').trim();
        const kind = String(b?.kind ?? '').trim();
        const payload = b?.payload ?? {};
        if (!from || !to || !kind) return err('from, to, kind are required');
        if (!SYSTEM_SENDERS.has(from)) {
          const sender = await getCell(env.DB, from);
          if (!sender) return err(`from cell "${from}" not found (system senders: ${[...SYSTEM_SENDERS].join(', ')})`, 404);
          if (sender.status !== 'active') return err(`from cell ${from} is ${sender.status}`);
        }
        const target = await getCell(env.DB, to);
        if (!target) return err(`to cell "${to}" not found`, 404);
        if (target.status !== 'active') return err(`target cell ${to} is ${target.status} — wound-heal the lineage`, 409);

        const pathId = `${from}->${to}::${kind}`;
        // fire: sclerotic = deterministic table; anything lower on cost still needs its model
        let ok = 1;
        let mode: string;
        let response: Record<string, unknown>;
        if (!TIER_PROFILE[target.tier].model_call) {
          const rules = (parseSheet(target).rules ?? []) as Rule[];
          const m = matchRule(rules, kind, payload);
          if (m.hit) {
            mode = 'table'; response = m.response!;
          } else {
            mode = 'table-miss'; ok = 0;
            response = { miss: true, hint: 'sclerotic tissue with no rule for this signal — wound-heal or extend the table' };
          }
        } else {
          mode = 'model-call-required';
          response = {
            deferred: true,
            cost_per_call: target.cost_per_call,
            latency_ms: target.latency_ms,
            hint: `${target.tier} tissue consults the model — the sheet travels with the prompt`,
          };
        }

        const myelinBefore = await env.DB.prepare('SELECT * FROM myelin WHERE path_id = ?').bind(pathId).first<{ fire_count: number; error_count: number }>();
        const fireCount = (myelinBefore?.fire_count ?? 0) + 1;
        const errorCount = (myelinBefore?.error_count ?? 0) + (ok ? 0 : 1);
        await env.DB.prepare(
          `INSERT INTO myelin (path_id, from_cell, to_cell, kind, fire_count, error_count, last_fired)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(path_id) DO UPDATE SET fire_count = excluded.fire_count, error_count = excluded.error_count, last_fired = excluded.last_fired`,
        ).bind(pathId, from, to, kind, fireCount, errorCount, now).run();

        // AUTO-PROMOTION: differentiated tissue whose path myelinated scleroses.
        let promotion: Record<string, unknown> | null = null;
        const th = threshold(env);
        const verdict = shouldMyelinate(fireCount, errorCount, th);
        if (ok && target.tier === 'differentiated' && verdict.promote) {
          await updateCellTier(env.DB, target, 'sclerotic', now);
          await env.DB.prepare('UPDATE myelin SET tier_promoted_to = ? WHERE path_id = ?').bind('sclerotic', pathId).run();
          await insertDistillation(env.DB, target.id, 'differentiated', 'sclerotic',
            `myelin:${pathId} fires=${fireCount} errors=${errorCount}`,
            `auto: ${verdict.reason}`, now);
          promotion = { cell: target.id, from: 'differentiated', to: 'sclerotic', reason: verdict.reason, cost_now: 0, latency_now_ms: 1 };
        }

        const sig = await env.DB.prepare(
          'INSERT INTO signals (from_cell, to_cell, kind, payload, ok, at) VALUES (?,?,?,?,?,?) RETURNING id',
        ).bind(from, to, kind, JSON.stringify(payload), ok, now).first<{ id: number }>();

        return json({
          signal_id: sig?.id ?? null,
          fired: { mode, response, cost_per_call: mode === 'table' ? 0 : target.cost_per_call, latency_ms: mode === 'table' ? 1 : target.latency_ms },
          target_tier_before: target.tier,
          myelin: { path_id: pathId, fire_count: fireCount, error_count: errorCount, threshold: th },
          promotion,
        });
      }

      // ── GET /organism/{name}/health ───────────────────────────────────
      const healthMatch = path.match(/^\/organism\/([^/]+)\/health$/);
      if (healthMatch && request.method === 'GET') {
        const name = decodeURIComponent(healthMatch[1]);
        const org = await env.DB.prepare('SELECT zygote_id FROM organisms WHERE name = ?').bind(name).first();
        if (!org) return err(`organism "${name}" not found`, 404);
        const [cellsRes, myelinRes, signalsRes] = await Promise.all([
          env.DB.prepare('SELECT * FROM cells WHERE organism = ?').bind(name).all(),
          env.DB.prepare(
            `SELECT m.* FROM myelin m JOIN cells c ON c.id = m.to_cell WHERE c.organism = ?`,
          ).bind(name).all(),
          env.DB.prepare(
            `SELECT s.* FROM signals s JOIN cells c ON c.id = s.to_cell WHERE c.organism = ? ORDER BY s.at DESC LIMIT 500`,
          ).bind(name).all(),
        ]);
        const cells = (cellsRes.results as Record<string, unknown>[]).map(cellFrom);
        const myelin = myelinRes.results as unknown[];
        const signals = signalsRes.results as unknown[];
        const snap = healthSnapshot(name, cells, myelin as never, signals as never, threshold(env));
        return json(snap);
      }

      // ── POST /wound — wound healing ───────────────────────────────────
      if (path === '/wound' && request.method === 'POST') {
        const b = await body<{ cell_id?: string; note?: string }>();
        const cellId = String(b?.cell_id ?? '').trim();
        if (!cellId) return err('cell_id is required');
        const wounded = await getCell(env.DB, cellId);
        if (!wounded) return err('cell not found', 404);

        const { results } = await env.DB.prepare('SELECT * FROM cells WHERE organism = ?').bind(wounded.organism).all();
        const cells = new Map((results as Record<string, unknown>[]).map(r => {
          const c = cellFrom(r);
          return [c.id, c] as const;
        }));
        const plan = healPlan(wounded, cells);
        if (plan.kind === 'hopeless') return err(plan.reason, 409);

        if (plan.kind === 'self-heal') {
          await env.DB.prepare('UPDATE cells SET plasticity = 1.0, versions = versions + 1 WHERE id = ?').bind(wounded.id).run();
          await insertDistillation(env.DB, wounded.id, 'totipotent', 'totipotent', b?.note ?? 'wound', `wound: totipotent tissue self-heals — plasticity restored (${b?.note ?? 'no note'})`, now);
          await env.DB.prepare("INSERT INTO signals (from_cell, to_cell, kind, payload, ok, at) VALUES (?,?,?,?,1,?)")
            .bind('wound', wounded.id, 'wound-heal', JSON.stringify({ cell: wounded.id, mode: 'self-heal' }), now).run();
          return json({ mode: 'self-heal', cell: await getCell(env.DB, wounded.id) });
        }

        // recall — nearest totipotent ancestor (possibly dedifferentiated from the root)
        const { ancestor, dedifferentiated } = plan;
        if (dedifferentiated) {
          await updateCellTier(env.DB, ancestor, 'totipotent', now);
          await insertDistillation(env.DB, ancestor.id, ancestor.tier, 'totipotent', b?.note ?? 'wound',
            `wound: no totipotent remained — lineage root recalled to stemness (dedifferentiation)`, now);
        }
        // retire the wounded tissue
        await env.DB.prepare("UPDATE cells SET status = 'retired' WHERE id = ?").bind(wounded.id).run();
        // regrowth: blastema from the ancestor, WITH the ancestor's sheet, carrying the wounded fate
        const regrownId = newCellId();
        const prof = TIER_PROFILE.multipotent;
        const sheet = parseSheet(await getCell(env.DB, ancestor.id) ?? ancestor);
        sheet.regrown_from = { cell: wounded.id, name: wounded.name, tier_at_wound: wounded.tier, note: b?.note ?? '' };
        await env.DB.prepare(
          'INSERT INTO cells (id, organism, name, tier, role, sheet_json, cost_per_call, latency_ms, plasticity, status, created_from, versions, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(regrownId, wounded.organism, `${wounded.name}-regrown`, 'multipotent', wounded.role,
          JSON.stringify(sheet), prof.cost_per_call, prof.latency_ms, prof.plasticity, 'active', ancestor.id, 1, now).run();
        await insertDistillation(env.DB, regrownId, wounded.tier, 'multipotent', b?.note ?? 'wound',
          `wound healing: ${wounded.name} (${wounded.tier}) failed — lineage reactivated to totipotent ancestor ${ancestor.name}; fate re-grown as multipotent blastema`, now);
        await env.DB.prepare("INSERT INTO signals (from_cell, to_cell, kind, payload, ok, at) VALUES (?,?,?,?,1,?)")
          .bind('wound', ancestor.id, 'wound-heal', JSON.stringify({ cell: wounded.id, mode: 'recall', dedifferentiated }), now).run();

        return json({
          mode: 'recall',
          retired: wounded.id,
          recalled_ancestor: dedifferentiated ? { id: ancestor.id, dedifferentiated_from: ancestor.tier } : { id: ancestor.id },
          regrown: await getCell(env.DB, regrownId),
        }, 201);
      }

      // ── examples: the saved decompositions ────────────────────────────
      if (path === '/examples' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, name, kind, description, evidence_ref, seed_json FROM examples ORDER BY id',
        ).all();
        return json({
          examples: (results as Record<string, unknown>[]).map(r => ({
            id: r.id, name: r.name, kind: r.kind, description: r.description, evidence_ref: r.evidence_ref,
            seed: JSON.parse(r.seed_json as string),
          })),
        });
      }
      if (path === '/examples' && request.method === 'POST') {
        const b = await body<Record<string, unknown>>();
        const v = validateExample(b);
        if (!v.ok) return err(`invalid example: ${v.errors.join('; ')}`, 422);
        const ex = b as unknown as Example;
        await env.DB.prepare(
          `INSERT INTO examples (id, name, kind, description, seed_json, evidence_ref) VALUES (?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, description=excluded.description, seed_json=excluded.seed_json, evidence_ref=excluded.evidence_ref`,
        ).bind(ex.id, ex.name, ex.kind, ex.description, JSON.stringify(ex.seed), ex.evidence_ref).run();
        return json({ saved: ex.id }, 201);
      }
      const instMatch = path.match(/^\/examples\/([^/]+)\/instantiate$/);
      if (instMatch && request.method === 'POST') {
        const exId = decodeURIComponent(instMatch[1]);
        const row = await env.DB.prepare('SELECT * FROM examples WHERE id = ?').bind(exId).first<{ seed_json: string }>();
        if (!row) return err(`example "${exId}" not found — POST it to /examples first`, 404);
        const b = await body<{ organism?: string }>();
        const seed = JSON.parse(row.seed_json) as ExampleSeed;
        const organism = String(b?.organism ?? seed.organism).trim();
        const existing = await env.DB.prepare('SELECT zygote_id FROM organisms WHERE name = ?').bind(organism).first();
        if (existing) return err(`organism "${organism}" already exists`, 409);

        const local = new Map<string, string>(); // local id -> real id
        const stmts: D1PreparedStatement[] = [];
        let zygoteRealId = '';
        for (const c of seed.cells) {
          const real = `${organism}:${c.id}`;
          local.set(c.id, real);
          if (!c.from) zygoteRealId = real;
          const prof = TIER_PROFILE[c.tier];
          const cost = c.cost_per_call ?? prof.cost_per_call;
          const lat = c.latency_ms ?? prof.latency_ms;
          const plas = c.plasticity ?? prof.plasticity;
          stmts.push(env.DB.prepare(
            'INSERT INTO cells (id, organism, name, tier, role, sheet_json, cost_per_call, latency_ms, plasticity, status, created_from, versions, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ).bind(real, organism, c.name, c.tier, c.role, JSON.stringify(c.sheet), cost, lat, plas, 'active', c.from ? `${organism}:${c.from}` : null, 1, now));
        }
        if (!zygoteRealId) return err('seed has no zygote (cell without "from")', 422);
        stmts.push(env.DB.prepare('INSERT INTO organisms (name, zygote_id, created_at) VALUES (?,?,?)').bind(organism, zygoteRealId, now));
        for (const m of seed.myelin ?? []) {
          const pathId = `${local.get(m.from)}->${local.get(m.to)}::${m.kind}`;
          stmts.push(env.DB.prepare(
            'INSERT INTO myelin (path_id, from_cell, to_cell, kind, fire_count, error_count, tier_promoted_to, last_fired) VALUES (?,?,?,?,?,?,?,?)',
          ).bind(pathId, local.get(m.from), local.get(m.to), m.kind, m.fire_count, m.error_count ?? 0, m.tier_promoted_to ?? null, now));
        }
        for (const d of seed.distillations ?? []) {
          stmts.push(env.DB.prepare(
            'INSERT INTO distillations (cell_id, from_tier, to_tier, evidence_ref, gardener_verdict, at) VALUES (?,?,?,?,?,?)',
          ).bind(local.get(d.cell), d.from_tier, d.to_tier, d.evidence_ref, d.gardener_verdict, now));
        }
        await env.DB.batch(stmts);
        const { results } = await env.DB.prepare('SELECT id, name, tier, role FROM cells WHERE organism = ?').bind(organism).all();
        return json({ instantiated: { example: exId, organism, cells: results } }, 201);
      }

      return err(`no route: ${request.method} ${path}`, 404);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isDup = msg.includes('UNIQUE') || msg.includes('already exists');
      return json({ error: msg }, isDup ? 409 : 500);
    }
  },
};

// keep tierIndex/lineageOf referenced for future endpoints (no tree-shaking surprises)
void tierIndex; void lineageOf;
