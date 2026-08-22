import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyApiTrust,
  createApiTrustMiddleware,
  isLoopbackPeer,
  isTailnetPeer,
  normalizePeerAddress,
  parseTrustedAccessProxyPeers,
} from '../server/requestTrust.js';

test('normalizes IPv4-mapped and scoped peer addresses', () => {
  assert.equal(normalizePeerAddress('::ffff:100.64.0.74'), '100.64.0.74');
  assert.equal(normalizePeerAddress('FD7A:115C:A1E0::1%tailscale0'), 'fd7a:115c:a1e0::1');
});

test('accepts loopback peers used by local service checks', () => {
  assert.equal(isLoopbackPeer('127.0.0.1'), true);
  assert.equal(isLoopbackPeer('127.99.4.3'), true);
  assert.equal(isLoopbackPeer('::1'), true);
  assert.equal(isLoopbackPeer('192.168.1.75'), false);
});

test('accepts only the Tailscale IPv4 CGNAT block and Tailscale IPv6 ULA prefix', () => {
  assert.equal(isTailnetPeer('100.64.0.0'), true);
  assert.equal(isTailnetPeer('100.64.0.74'), true);
  assert.equal(isTailnetPeer('100.64.0.255'), true);
  assert.equal(isTailnetPeer('100.63.255.255'), false);
  assert.equal(isTailnetPeer('100.128.0.0'), false);
  assert.equal(isTailnetPeer('fd7a:115c:a1e0::bd37:9a1a'), true);
  assert.equal(isTailnetPeer('fd7a:115c:a1e1::1'), false);
});

test('classifies loopback and Tailnet direct requests as trusted', () => {
  assert.equal(classifyApiTrust({ remoteAddress: '::ffff:127.0.0.1' }).channel, 'loopback');
  assert.equal(classifyApiTrust({ remoteAddress: '100.64.0.42' }).channel, 'tailnet');
});

test('accepts a Cloudflare Access assertion only from an exact configured proxy peer', () => {
  const accessProxyPeers = parseTrustedAccessProxyPeers('100.64.0.36, 192.168.1.66');
  const headers = { 'cf-access-jwt-assertion': 'signed-assertion' };

  assert.deepEqual(
    classifyApiTrust({ remoteAddress: '192.168.1.66', headers, accessProxyPeers }),
    { trusted: true, channel: 'cloudflare-access', peer: '192.168.1.66' },
  );
  assert.deepEqual(
    classifyApiTrust({ remoteAddress: '192.168.1.200', headers, accessProxyPeers }),
    { trusted: false, channel: 'untrusted', peer: '192.168.1.200' },
  );
  assert.equal(
    classifyApiTrust({ remoteAddress: '192.168.1.66', headers: {}, accessProxyPeers }).trusted,
    false,
  );
});

test('middleware rejects an untrusted direct request without echoing its assertion', () => {
  const denied = [];
  const middleware = createApiTrustMiddleware({
    accessProxyPeers: parseTrustedAccessProxyPeers('192.168.1.66'),
    onDenied: (event) => denied.push(event),
  });
  const req = {
    headers: { 'cf-access-jwt-assertion': 'do-not-log-this' },
    method: 'GET',
    originalUrl: '/api/board',
    socket: { remoteAddress: '192.168.1.200' },
  };
  const response = {};
  const res = {
    status(code) {
      response.status = code;
      return this;
    },
    json(body) {
      response.body = body;
    },
  };
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: 'trusted network or Cloudflare Access required' });
  assert.deepEqual(denied, [{
    method: 'GET',
    originalUrl: '/api/board',
    peer: '192.168.1.200',
  }]);
});

test('middleware passes a Tailnet request to the API route', () => {
  const middleware = createApiTrustMiddleware();
  const req = {
    headers: {},
    method: 'POST',
    originalUrl: '/api/claims',
    socket: { remoteAddress: '::ffff:100.64.0.74' },
  };
  let nextCalled = false;

  middleware(req, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});
