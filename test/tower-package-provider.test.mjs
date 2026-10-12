import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TowerMcpClient, TowerPackageProvider } from '../server/towerPackageProvider.js';

test('Tower MCP client initializes Streamable HTTP and calls tools without external network', async () => {
  const calls = [];
  const fakeFetch = async (_url, options) => {
    const body = JSON.parse(options.body); calls.push({ body, headers: options.headers });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202, headers: { 'mcp-session-id': 'fixture-session' } });
    const result = body.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } }
      : { content: [{ type: 'text', text: JSON.stringify({ status: 'complete', response_token_match: true }) }] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' } });
  };
  const client = new TowerMcpClient({ url: 'http://127.0.0.1.invalid/mcp', fetchImpl: fakeFetch });
  await client.initialize();
  const result = await client.callTool('status', { token: 'fixture-token' });
  assert.equal(result.response_token_match, true);
  assert.deepEqual(calls.map((call) => call.body.method), ['initialize', 'notifications/initialized', 'tools/call']);
  assert.equal(calls[2].body.params.name, 'status');
  assert.equal(calls[2].headers['mcp-session-id'], 'fixture-session');
});

test('Tower package provider accepts done only with exit zero and exact response token proof', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-tower-provider-'));
  const stagingPath = path.join(dir, 'draft.json');
  const calls = [];
  const client = {
    async initialize() {},
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === 'dispatch') {
        fs.writeFileSync(stagingPath, JSON.stringify({ fixture: true }));
        return { ok: true };
      }
      return { status: 'done', exit_code: 0, response_token_match: true, provider: 'codex', model: 'gpt-5.6-sol' };
    },
  };
  assert.equal(new TowerPackageProvider({ client }).targetHost, 'charlie');
  const provider = new TowerPackageProvider({
    client, pollMs: 0, maxPolls: 1, targetHost: 'charlie',
  });
  const result = await provider.draft({ job: { id: 7 }, packageRow: { id: 4, brief_markdown: 'fixture' }, stagingPath });
  assert.equal(result.responseTokenMatch, true);
  assert.equal(result.draft.fixture, true);
  assert.equal(calls.find((call) => call.name === 'dispatch').args.max_runtime_seconds, 1800);
  assert.equal(calls.find((call) => call.name === 'dispatch').args.target_host, 'charlie');
  assert.equal(calls.find((call) => call.name === 'dispatch').args.target_scope, `path:${dir}`);
  assert.match(calls.find((call) => call.name === 'dispatch').args.content, /empty evidence_claim_ids array is invalid/);

  fs.writeFileSync(stagingPath, '{invalid json');
  const failed = new TowerPackageProvider({
    client: { callTool: async () => ({ status: 'done', exit_code: 9, response_token_match: true }) },
    pollMs: 0, maxPolls: 1,
  });
  await assert.rejects(failed.waitForCompletion('fixture-failed', stagingPath), /did not exit successfully: 9/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Tower package provider fails fast for rejected dispatches and missing runs', async () => {
  const dispatchCalls = [];
  const rejected = new TowerPackageProvider({
    client: {
      async initialize() {},
      async callTool(name) {
        dispatchCalls.push(name);
        return { ok: false, error: 'no eligible cloud provider' };
      },
    },
    pollMs: 0,
    maxPolls: 100,
  });
  await assert.rejects(
    rejected.draft({ job: { id: 8 }, packageRow: { id: 5, brief_markdown: 'fixture' }, stagingPath: '/tmp/unused-prospect-draft.json' }),
    (error) => error.retryWithFreshToken === true
      && error.providerPhase === 'dispatch'
      && /no eligible cloud provider/.test(error.message),
  );
  assert.deepEqual(dispatchCalls, ['dispatch'], 'a rejected dispatch is never polled');

  let statusCalls = 0;
  const missing = new TowerPackageProvider({
    client: {
      async callTool() {
        statusCalls += 1;
        return { ok: false, status: 'missing' };
      },
    },
    pollMs: 0,
    maxPolls: 100,
  });
  await assert.rejects(
    missing.waitForCompletion('FLEET-BUILD-20260901-missing-fixture', '/tmp/unused-prospect-draft.json'),
    (error) => error.retryWithFreshToken === true
      && error.providerPhase === 'status'
      && /run is missing/.test(error.message),
  );
  assert.equal(statusCalls, 1, 'a missing run is terminal instead of consuming the poll window');
});
