// cell-cascade — src/bridge.ts
// THE MODEL SEAM (v0.2). In v0.1, signals to non-sclerotic cells returned
// "model-call-required" — totipotent tissue could not actually think. The
// seam: cell sheets carry optional model config
//   { model: { provider, model, system_prompt, max_tokens?, temperature? } }
// and the worker carries MODEL_BASE_URL + MODEL_KEY (secrets, the fleet
// pattern: any openai-compatible chat-completions endpoint — zai,
// deepseek, ...). If either side is missing, the boundary stays HONEST:
// still the clear model-call-required error. No silent guessing, ever.
//
// Pure shaping lives here so tests can pin it without any network: request
// build, response parse, cost estimate, escalation-prompt composition.

export interface SheetModel {
  provider: string;        // informational: 'openai-compatible' is the v0.2 contract
  model: string;           // e.g. 'deepseek-chat', 'glm-5.3'
  system_prompt: string;   // the cell's voice — the sheet travels with the prompt
  max_tokens?: number;
  temperature?: number;
}

export interface BridgeEnv {
  MODEL_BASE_URL?: string;
  MODEL_KEY?: string;
  MODEL_TIMEOUT_MS?: string;
  MODEL_PRICE_IN_PER_MTOK?: string;
  MODEL_PRICE_OUT_PER_MTOK?: string;
}

export const DEFAULT_TIMEOUT_MS = 20_000;   // hard timeout: the tissue must answer or fail honestly
export const DEFAULT_MAX_TOKENS = 1024;
export const DEFAULT_TEMPERATURE = 0.4;

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Everything we log per exchange — the observability contract of the seam. */
export interface ModelExchange {
  provider: string;
  model: string;
  system_prompt: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  cost_estimate_usd: number | null;   // null = prices not configured; tokens still logged
  base_url: string;                   // which endpoint answered (never the key)
  // provenance when this exchange was an ESCALATION (germ line answering for a child):
  escalated_from?: string;            // the differentiated cell that missed its table
  answered_by?: string;               // the totipotent ancestor that thought
}

export type ModelCall =
  | { ok: true; content: string; usage: Usage; latency_ms: number; cost_estimate_usd: number | null; log: ModelExchange }
  | { ok: false; kind: 'env-missing' | 'timeout' | 'http' | 'bad-body' | 'no-config'; error: string; latency_ms: number };

/** Read sheet.model → SheetModel. Anything malformed = no model config. */
export function parseSheetModel(sheet: Record<string, unknown> | null | undefined): SheetModel | null {
  const m = (sheet as Record<string, unknown> | undefined)?.model;
  if (!m || typeof m !== 'object' || m === null) return null;
  const mm = m as Record<string, unknown>;
  if (typeof mm.model !== 'string' || !mm.model.trim()) return null;
  return {
    provider: typeof mm.provider === 'string' && mm.provider ? mm.provider : 'openai-compatible',
    model: mm.model.trim(),
    system_prompt: typeof mm.system_prompt === 'string' ? mm.system_prompt : '',
    max_tokens: typeof mm.max_tokens === 'number' && mm.max_tokens > 0 ? Math.floor(mm.max_tokens) : undefined,
    temperature: typeof mm.temperature === 'number' ? mm.temperature : undefined,
  };
}

export function bridgeReady(env: BridgeEnv): boolean {
  return Boolean(env.MODEL_BASE_URL && env.MODEL_KEY);
}

export function chatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

/** The openai-compatible chat-completions request body. */
export function buildRequestBody(cfg: SheetModel, system: string, user: string): Record<string, unknown> {
  return {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: cfg.max_tokens ?? DEFAULT_MAX_TOKENS,
    temperature: cfg.temperature ?? DEFAULT_TEMPERATURE,
  };
}

/** Pull content + usage out of a chat-completions response. Tolerant of
 *  providers that omit usage: tokens default to 0 (logged as such). */
export function parseChatCompletion(data: unknown): { content: string; usage: Usage } | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const choices = d.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const msg = (choices[0] as Record<string, unknown>)?.message;
  const content = msg && typeof (msg as Record<string, unknown>).content === 'string'
    ? (msg as Record<string, unknown>).content as string
    : null;
  if (content === null) return null;
  const u = (typeof d.usage === 'object' && d.usage !== null ? d.usage : {}) as Record<string, unknown>;
  return {
    content,
    usage: {
      prompt_tokens: Number(u.prompt_tokens ?? 0) || 0,
      completion_tokens: Number(u.completion_tokens ?? 0) || 0,
      total_tokens: Number(u.total_tokens ?? 0) || 0,
    },
  };
}

/** Cost estimate in USD from per-1M-token prices. No prices → null (honest
 *  about what we know; tokens are always logged). */
export function estimateCost(usage: Usage, priceIn: number | undefined, priceOut: number | undefined): number | null {
  if (priceIn === undefined || priceOut === undefined) return null;
  const usd = (usage.prompt_tokens * priceIn + usage.completion_tokens * priceOut) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Call the model. ONE exchange: system prompt (the sheet's voice) + user
 * payload. Hard timeout (default 20s) — tissue answers or the organism logs
 * an honest failure. If env is missing, NOTHING is fetched.
 */
export async function callModel(
  env: BridgeEnv,
  cfg: SheetModel,
  req: { system: string; user: string },
  opts: { fetchFn?: typeof fetch; timeoutMs?: number; now?: () => number } = {},
): Promise<ModelCall> {
  const t0 = (opts.now ?? Date.now)();
  if (!env.MODEL_BASE_URL || !env.MODEL_KEY) {
    return {
      ok: false, kind: 'env-missing', latency_ms: 0,
      error: 'model-call-required: MODEL_BASE_URL / MODEL_KEY not configured on the worker — the boundary stays honest',
    };
  }
  const baseUrl = env.MODEL_BASE_URL;
  const timeoutMs = opts.timeoutMs ?? num(env.MODEL_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
  const url = chatUrl(baseUrl);
  const fetchFn = opts.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MODEL_KEY}`,
      },
      body: JSON.stringify(buildRequestBody(cfg, req.system, req.user)),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false, kind: 'http', latency_ms: Date.now() - t0,
        error: `model endpoint ${res.status}: ${body.slice(0, 300)}`,
      };
    }
    const data: unknown = await res.json();
    const parsed = parseChatCompletion(data);
    if (!parsed) {
      return {
        ok: false, kind: 'bad-body', latency_ms: Date.now() - t0,
        error: 'model endpoint returned no choices[0].message.content',
      };
    }
    const priceIn = num(env.MODEL_PRICE_IN_PER_MTOK);
    const priceOut = num(env.MODEL_PRICE_OUT_PER_MTOK);
    const cost_estimate_usd = estimateCost(parsed.usage, priceIn, priceOut);
    const latency_ms = Date.now() - t0;
    return {
      ok: true, content: parsed.content, usage: parsed.usage,
      latency_ms, cost_estimate_usd,
      log: {
        provider: cfg.provider,
        model: cfg.model,
        system_prompt: req.system,
        ...parsed.usage,
        latency_ms,
        cost_estimate_usd,
        base_url: url,
      },
    };
  } catch (e) {
    if (controller.signal.aborted) {
      return {
        ok: false, kind: 'timeout', latency_ms: Date.now() - t0,
        error: `model call exceeded ${timeoutMs}ms — aborted (tissue must answer quickly or not at all)`,
      };
    }
    return {
      ok: false, kind: 'http', latency_ms: Date.now() - t0,
      error: `model call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ESCALATION composition: a differentiated cell missed its rule table; the
 * signal routes UP to the lineage's nearest totipotent ancestor, which
 * answers wearing ITS OWN system prompt — composed with the failed child's
 * role context, so the germ line answers *in the child's scope of fate*,
 * not as a generic oracle.
 */
export function composeEscalationSystem(
  ancestorSystemPrompt: string,
  child: { name: string; role: string; tier: string },
  kind: string,
): string {
  const base = ancestorSystemPrompt.trim() || 'You are the germ line of an organism of cells.';
  return [
    base,
    '',
    '[ESCALATION] A differentiated child cell could not answer from its committed rule table.',
    `Child cell: "${child.name}" (tier: ${child.tier}, role: ${child.role})`,
    `Incoming signal kind: "${kind}"`,
    'Answer on the child\'s behalf, within the child\'s scope of fate — concise, operational,',
    'shaped so the answer could later become a deterministic rule in the child\'s table.',
  ].join('\n');
}
