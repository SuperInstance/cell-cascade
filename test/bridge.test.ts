// cell-cascade — tests: THE MODEL SEAM (v0.2)
// The bridge is tested against a MOCKED openai-compatible endpoint — no live
// key in tests, ever. What's pinned: request shape, response parse, cost
// estimate, the hard timeout, and the honest env-missing boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSheetModel, callModel, buildRequestBody, parseChatCompletion, estimateCost,
  composeEscalationSystem, chatUrl, DEFAULT_TIMEOUT_MS,
} from '../src/bridge';

const ENV = { MODEL_BASE_URL: 'https://mock.model/v1', MODEL_KEY: 'test-key' };

function mockFetch(captured: { url?: string; init?: RequestInit } = {}, respond: () => Response = () => Response.json(
  { choices: [{ message: { role: 'assistant', content: 'TENDON OK' } }], usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 } },
)): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.url = String(url);
    captured.init = init;
    return respond();
  }) as typeof fetch;
}

test('bridge: env missing -> honest model-call-required, NOTHING fetched', async () => {
  let fetched = false;
  const fetchFn = (async () => { fetched = true; return new Response(); }) as typeof fetch;
  const r = await callModel({}, { provider: 'openai-compatible', model: 'x', system_prompt: '' }, { system: 's', user: 'u' }, { fetchFn });
  assert.equal(fetched, false, 'no network when the seam is unconfigured');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.kind, 'env-missing');
    assert.match(r.error, /model-call-required/);
    assert.match(r.error, /MODEL_BASE_URL/);
  }
});

test('bridge: request shape — openai-compatible chat completions with the sheet voice', async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  const r = await callModel(ENV,
    { provider: 'openai-compatible', model: 'deepseek-chat', system_prompt: 'You are the germ line.', max_tokens: 64, temperature: 0.2 },
    { system: 'You are the germ line.', user: 'think' },
    { fetchFn: mockFetch(cap) });
  assert.equal(r.ok, true);
  assert.equal(cap.url, 'https://mock.model/v1/chat/completions');
  const init = cap.init!;
  assert.equal(init.method, 'POST');
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-key');
  const body = JSON.parse(init.body as string);
  assert.equal(body.model, 'deepseek-chat');
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'You are the germ line.' },
    { role: 'user', content: 'think' },
  ]);
  assert.equal(body.max_tokens, 64);
  assert.equal(body.temperature, 0.2);
});

test('bridge: parses content + usage, logs latency, cost null without prices', async () => {
  const r = await callModel(ENV, { provider: 'openai-compatible', model: 'm', system_prompt: 's' },
    { system: 's', user: 'u' }, { fetchFn: mockFetch() });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.content, 'TENDON OK');
    assert.deepEqual(r.usage, { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 });
    assert.equal(r.cost_estimate_usd, null, 'no prices configured -> null, not a guess');
    assert.equal(r.log.model, 'm');
    assert.equal(r.log.prompt_tokens, 120);
    assert.ok(r.log.latency_ms >= 0);
    assert.equal(r.log.base_url, 'https://mock.model/v1/chat/completions');
  }
});

test('bridge: cost estimate math from per-1M-token prices', async () => {
  const r = await callModel(
    { ...ENV, MODEL_PRICE_IN_PER_MTOK: '0.5', MODEL_PRICE_OUT_PER_MTOK: '2.0' },
    { provider: 'openai-compatible', model: 'm', system_prompt: 's' },
    { system: 's', user: 'u' }, { fetchFn: mockFetch() });
  assert.equal(r.ok, true);
  if (r.ok) {
    // 120 * 0.5/1M + 8 * 2.0/1M = 0.00006 + 0.000016 = 0.000076
    assert.equal(r.cost_estimate_usd, 0.000076);
  }
});

test('bridge: hard timeout aborts a hanging endpoint', async () => {
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }) as typeof fetch;
  const r = await callModel(ENV, { provider: 'openai-compatible', model: 'm', system_prompt: 's' },
    { system: 's', user: 'u' }, { fetchFn, timeoutMs: 25 });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.kind, 'timeout');
    assert.match(r.error, /25ms/);
  }
});

test('bridge: HTTP errors surface honestly (kind http)', async () => {
  const fetchFn = mockFetch({}, () => new Response('boom', { status: 503 }));
  const r = await callModel(ENV, { provider: 'openai-compatible', model: 'm', system_prompt: 's' },
    { system: 's', user: 'u' }, { fetchFn });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, 'http');
});

test('bridge: malformed body is bad-body, never a guess', async () => {
  const fetchFn = mockFetch({}, () => Response.json({ nope: true }));
  const r = await callModel(ENV, { provider: 'openai-compatible', model: 'm', system_prompt: 's' },
    { system: 's', user: 'u' }, { fetchFn });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, 'bad-body');
});

test('bridge: default timeout is the hard 20s contract', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 20000);
});

test('bridge: parseChatCompletion tolerates missing usage', () => {
  const p = parseChatCompletion({ choices: [{ message: { content: 'hi' } }] });
  assert.deepEqual(p, { content: 'hi', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
  assert.equal(parseChatCompletion({ choices: [] }), null);
});

test('bridge: estimateCost returns null unless BOTH prices are known', () => {
  const u = { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 };
  assert.equal(estimateCost(u, undefined, 2), null);
  assert.equal(estimateCost(u, 1, undefined), null);
  assert.equal(estimateCost(u, 1, 2), 0.003);
});

test('bridge: parseSheetModel — the sheet carries the voice', () => {
  const cfg = parseSheetModel({ model: { provider: 'openai-compatible', model: 'glm-5.3', system_prompt: 'germ line' } });
  assert.deepEqual(cfg, { provider: 'openai-compatible', model: 'glm-5.3', system_prompt: 'germ line', max_tokens: undefined, temperature: undefined });
  assert.equal(parseSheetModel({}), null, 'no model config');
  assert.equal(parseSheetModel({ model: { system_prompt: 'x' } }), null, 'config without a model name is not config');
  assert.equal(parseSheetModel(null), null);
});

test('bridge: chatUrl joins without double slashes', () => {
  assert.equal(chatUrl('https://api.x.com/v1/'), 'https://api.x.com/v1/chat/completions');
});

test('bridge: escalation composes the ANCESTOR voice with the CHILD context', () => {
  const sys = composeEscalationSystem(
    'You are Duke Ellington germ line.',
    { name: 'duke-pianist', role: 'left-hand stride piano', tier: 'differentiated' },
    'harmony-question',
  );
  assert.match(sys, /^You are Duke Ellington germ line\./, 'ancestor system prompt comes first');
  assert.match(sys, /ESCALATION/);
  assert.match(sys, /duke-pianist/);
  assert.match(sys, /left-hand stride piano/);
  assert.match(sys, /harmony-question/);
  assert.match(sys, /deterministic rule/, 'answers are shaped to become rules');
});
