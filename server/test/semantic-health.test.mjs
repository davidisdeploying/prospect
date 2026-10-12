import test from 'node:test';
import assert from 'node:assert/strict';

import { OLLAMA_URL } from '../ollamaConfig.js';
import { embedQuery, getEmbeddingHealth } from '../embed.js';


test('semantic provider uses the current Tensor host', () => {
  assert.equal(OLLAMA_URL, 'http://tensor:11434');
  assert.equal(OLLAMA_URL.includes('charlie'), false);
});


test('embedding health records a successful provider call', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ embeddings: [Array(768).fill(0.01)] }),
  });
  const result = await embedQuery('health canary');
  assert.equal(result.byteLength, 768 * 4);
  const health = getEmbeddingHealth();
  assert.equal(health.status, 'ok');
  assert.ok(health.lastSuccessAt);
  assert.equal(health.lastError, null);
});


test('embedding health records a provider failure without exposing payloads', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw new TypeError('sensitive detail'); };
  await assert.rejects(embedQuery('failure canary'));
  const health = getEmbeddingHealth();
  assert.equal(health.status, 'error');
  assert.equal(health.lastError, 'TypeError');
  assert.ok(health.lastFailureAt);
});
