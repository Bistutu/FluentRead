/**
 * @file tests/chatgptPlanBridge.test.mjs
 * 独立 Node HTTP 集成测试：用离线 OpenAI 夹具与真实 RSA 签名验证本机助手边界。
 * 覆盖配对、Origin/Host、OAuth 校验、持久化、续期竞争、取消与 SSE 完成语义。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createChatGPTPlanBridge, validateResponseRequest, BRIDGE_PORT } from '../integrations/chatgpt-plan/bridge.mjs';

const ORIGIN = `chrome-extension://${'a'.repeat(32)}`;
const OTHER_ORIGIN = `chrome-extension://${'b'.repeat(32)}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'offline-test', alg: 'RS256', use: 'sig' };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function jwt(claims, badSignature = false) {
  const input = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode(claims)}`;
  return `${input}.${badSignature ? Buffer.alloc(256).toString('base64url') : sign('sha256', Buffer.from(input), privateKey).toString('base64url')}`;
}
function sendJson(response, data, status = 200) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); }
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'fluentread-chatgpt-plan-test-'));
  const state = { now: Date.now(), nonce: '', client: 'oaiapp_offline', refreshCount: 0, modelCount: 0, tokenCalls: [], apiCalls: [],
    badClaims: {}, badSignature: false, scopes: 'openid email offline_access resource.invoke chatgpt.tokens.use.direct', stream: 'good', holdRefresh: null, holdCode: null, ignoreTokenAbort: false };
  function tokens(refresh = false) {
    const identity = { iss: 'https://auth.openai.com', aud: state.client, sub: 'offline-user', exp: state.now / 1000 + 3600,
      iat: state.now / 1000, nonce: state.nonce, name: 'Test User', email: 'offline@example.test', ...state.badClaims };
    return { access_token: refresh ? `offline-access-refreshed-${state.refreshCount}` : state.initialAccessToken || 'offline-access-initial', refresh_token: refresh ? `offline-refresh-${state.refreshCount}` : state.initialRefreshToken || 'offline-refresh-initial',
      id_token: jwt(identity, state.badSignature), expires_in: 3600, token_type: 'Bearer', scope: state.scopes,
      ...(state.earliestRefreshAt !== undefined ? { earliest_refresh_at: state.earliestRefreshAt } : {}) };
  }
  const remote = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      if (path === '/.well-known/openid-configuration') {
        if (state.holdDiscovery) { state.holdDiscovery.entered.resolve(); await state.holdDiscovery.release.promise; }
        sendJson(response, { issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/jwks', revocation_endpoint: 'https://auth.openai.com/revoke' }); return;
      }
      if (path === '/jwks') { sendJson(response, { keys: [jwk] }); return; }
      if (path === '/api/accounts/oauth/token') {
        const body = new URLSearchParams(raw); state.tokenCalls.push(body);
        assert.equal(body.get('client_id'), state.client);
        assert.equal(body.get('resource'), 'https://api.openai.com/v1');
        if (body.get('grant_type') === 'refresh_token') {
          state.refreshCount++;
          if (state.holdRefresh) { state.holdRefresh.entered.resolve(); await state.holdRefresh.release.promise; }
          if (state.refreshFailure) { sendJson(response, { error: state.refreshFailure }, 400); return; }
          sendJson(response, tokens(true)); return;
        }
        if (state.holdCode) { state.holdCode.entered.resolve(); await state.holdCode.release.promise; }
        if (state.codeFailure) { sendJson(response, { error: state.codeFailure }, state.codeFailureStatus || 400); return; }
        assert.equal(body.get('grant_type'), 'authorization_code');
        assert.match(body.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:[0-9]+\/auth\/callback$/);
        assert.ok(body.get('code_verifier'));
        sendJson(response, tokens()); return;
      }
      if (path === '/revoke') {
        state.revoked = new URLSearchParams(raw);
        if (state.holdRevocation) { state.holdRevocation.entered.resolve(); await state.holdRevocation.release.promise; }
        response.writeHead(state.revokeFailure ? 503 : 200); response.end(); return;
      }
      state.apiCalls.push({ path, authorization: request.headers.authorization, body: raw && JSON.parse(raw) });
      if (state.apiFailure) { sendJson(response, { error: { code: state.apiFailure.code, message: 'unsafe raw provider message' } }, state.apiFailure.status); return; }
      if (state.unauthorizedOnce) { state.unauthorizedOnce = false; sendJson(response, { error: { code: 'invalid_token' } }, 401); return; }
      if (path === '/v1/models') { state.modelCount++; sendJson(response, { models: [{ slug: 'account-model', display_name: 'Account Model', visibility: 'list' }, { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hidden' }] }); return; }
      if (path === '/v1/responses') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"译文"}\r\n\r\n');
        if (state.stream === 'pending') { state.streamEntered.resolve(); response.on('close', () => state.streamClosed.resolve()); return; }
        if (state.stream === 'failed') response.write('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"unsafe raw error"}}}\n\n');
        else if (state.stream === 'badutf8') response.write(Buffer.from([0xc3, 0x28]));
        else if (state.stream === 'good') response.write('data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"译文"}]}]}}\n\n');
        else if (state.stream === 'incomplete') response.write('data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}\n\n');
        response.end(); return;
      }
      sendJson(response, { error: 'not_found' }, 404);
    } catch { if (!response.destroyed) sendJson(response, { error: 'fixture_failure' }, 500); }
  });
  await new Promise((resolve) => remote.listen(0, '127.0.0.1', resolve));
  const remoteUrl = `http://127.0.0.1:${remote.address().port}`;
  const fetchImpl = (url, init) => {
    const parsed = new URL(url);
    assert.ok(['auth.openai.com', 'api.openai.com'].includes(parsed.hostname));
    assert.equal(init.redirect, 'error');
    const injected = state.apiResponse?.(parsed.pathname);
    if (injected) return Promise.resolve(injected);
    const ignoreAbort = state.ignoreTokenAbort && parsed.pathname === '/api/accounts/oauth/token'
      || state.ignoreDiscoveryAbort && parsed.pathname === '/.well-known/openid-configuration';
    return fetch(`${remoteUrl}${parsed.pathname}${parsed.search}`, { ...init, ...(ignoreAbort ? { signal: undefined } : {}) });
  };
  const create = () => createChatGPTPlanBridge({ directory, port: 0, fetchImpl, now: () => state.now, ...options });
  let bridge = await create();
  t.after(async () => { state.holdCode?.release.resolve(); state.holdRefresh?.release.resolve(); state.holdDiscovery?.release.resolve(); state.holdRevocation?.release.resolve(); await bridge.close(); remote.closeAllConnections(); await new Promise((resolve) => remote.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  async function request(path, body = {}, token, origin = ORIGIN, extra = {}) {
    return fetch(`${bridge.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) });
  }
  async function pair(origin = ORIGIN) { const response = await request('/pair', { code: bridge.issuePairCode() }, undefined, origin); assert.equal(response.status, 200); return (await response.json()).bridgeToken; }
  async function start(token, newAccount = false) { const response = await request('/auth/start', { newAccount }, token); assert.equal(response.status, 200); const url = new URL((await response.json()).authorizationUrl); state.nonce = url.searchParams.get('nonce'); return url; }
  async function callback(url, extra = {}) {
    const params = new URLSearchParams({ state: url.searchParams.get('state'), code: 'offline-code', client_id: state.client, ...extra });
    return fetch(`${bridge.url}/auth/callback?${params}`);
  }
  async function signIn(token) { const url = await start(token); const response = await callback(url); assert.equal(response.status, 200, await response.text()); return url; }
  async function status(token) { const response = await request('/status', {}, token); assert.equal(response.status, 200); return response.json(); }
  return { directory, state, request, pair, start, callback, signIn, status, get bridge() { return bridge; }, async restart() { await bridge.close(); bridge = await create(); } };
}

test('pairing rejects web origins, missing Origin, forged Host, invalid/replayed/expired codes and binds origins', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/health', {}, undefined, 'https://evil.example')).status, 403);
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${f.bridge.url}/health`, { headers: { Host: 'evil.example', Origin: ORIGIN } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal((await f.request('/status', {}, undefined, null)).status, 403);
  const health = await fetch(`${f.bridge.url}/health`); assert.deepEqual(await health.json(), { name: 'fluentread-chatgpt-plan', version: 1 });
  assert.equal((await f.request('/pair', { code: 'bad' })).status, 403);
  const code = f.bridge.issuePairCode(); assert.equal(code.replaceAll('-', '').length, 48);
  const paired = await f.request('/pair', { code }); const token = (await paired.json()).bridgeToken;
  assert.equal((await f.request('/pair', { code })).status, 403);
  assert.equal((await f.request('/status', {}, token, OTHER_ORIGIN)).status, 401);
  assert.equal((await f.request('/status', {}, token)).status, 200);
  const code2 = f.bridge.issuePairCode(); f.state.now += 5 * 60_000;
  assert.equal((await f.request('/pair', { code: code2 })).status, 403);
  f.bridge.issuePairCode(); for (let index = 0; index < 10; index++) await f.request('/pair', { code: 'bad' });
  assert.equal((await f.request('/pair', { code: 'bad' })).status, 403);
  const other = await f.pair(OTHER_ORIGIN);
  assert.equal((await f.request('/status', {}, other, OTHER_ORIGIN)).status, 200);
  assert.equal((await f.request('/status', {}, token)).status, 200);
  await f.request('/unpair', {}, token);
  assert.equal((await f.request('/status', {}, token)).status, 401);
  assert.equal((await f.request('/status', {}, other, OTHER_ORIGIN)).status, 200);
});

test('preflight is exact and POST JSON required; health has no secrets', async (t) => {
  const f = await fixture(t);
  const preflight = await fetch(`${f.bridge.url}/status`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN); assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
  const wrong = await fetch(`${f.bridge.url}/status`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-arbitrary' } }); assert.equal(wrong.status, 403);
  const form = await fetch(`${f.bridge.url}/pair`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'code=bad' }); assert.equal(form.status, 415);
});

test('official dynamic OAuth parameters, signature validation, models, protected persistence and restart', async (t) => {
  const f = await fixture(t); const token = await f.pair(); const url = await f.start(token);
  assert.equal(url.origin, 'https://auth.openai.com'); assert.equal(url.pathname, '/api/accounts/authorize');
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client'); assert.equal(url.searchParams.get('agent_name_hint'), 'FluentRead');
  assert.equal(url.searchParams.get('resource'), 'https://api.openai.com/v1'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('ext_agent_host_id'), /^urn:uuid:/); assert.ok(url.searchParams.get('scope').includes('chatgpt.tokens.use.direct'));
  assert.equal((await f.callback(url, { state: 'wrong' })).status, 400); assert.equal((await f.status(token)).authPending, true);
  assert.equal((await f.callback(url)).status, 200); assert.equal((await f.callback(url)).status, 400);
  assert.deepEqual(await f.status(token), { connected: true, sharing: true, account: { name: 'Test User', email: 'offline@example.test' }, authPending: false });
  const models = await f.request('/models', {}, token); assert.deepEqual(await models.json(), { models: [{ slug: 'account-model', display_name: 'Account Model' }] });
  assert.equal(f.state.apiCalls[0].authorization, 'Bearer offline-access-initial');
  assert.equal((await stat(join(f.directory, 'credentials.json'))).mode & 0o777, 0o600);
  const saved = JSON.parse(await readFile(join(f.directory, 'credentials.json'), 'utf8')); assert.equal(saved.registration.clientId, f.state.client); assert.notEqual(saved.pairs[0].tokenHash, token);
  await f.restart(); assert.equal((await f.status(token)).connected, true);
  const returning = await f.start(token); assert.equal(returning.searchParams.get('client_id'), f.state.client); assert.equal(returning.searchParams.has('agent_name_hint'), false); assert.equal(returning.searchParams.has('id_token_hint'), false);
  assert.equal(returning.searchParams.get('ext_agent_host_id'), saved.hostId);
  const logout = await f.request('/logout', {}, token); assert.deepEqual(await logout.json(), { connected: false, revocationConfirmed: true });
  assert.equal(f.state.revoked.get('token'), 'offline-refresh-initial'); assert.equal((await f.status(token)).connected, false);
  const afterLogout = JSON.parse(await readFile(join(f.directory, 'credentials.json'), 'utf8')); assert.equal(afterLogout.credentials, null); assert.equal(afterLogout.registration.clientId, f.state.client);
});

test('ID tokens reject bad signature, issuer, audience, nonce, expiration and changed returning identity', async (t) => {
  const f = await fixture(t); const token = await f.pair();
  for (const badClaims of [{ iss: 'https://evil.example' }, { aud: 'wrong-client' }, { nonce: 'wrong' }, { exp: f.state.now / 1000 - 1 }, { nbf: f.state.now / 1000 + 1000 }]) {
    f.state.badClaims = badClaims; const url = await f.start(token); assert.equal((await f.callback(url)).status, 401); assert.equal((await f.status(token)).connected, false);
  }
  f.state.badClaims = {}; f.state.badSignature = true; const bad = await f.start(token); assert.equal((await f.callback(bad)).status, 401);
  f.state.badSignature = false; await f.signIn(token);
  f.state.badClaims = { sub: 'different-user' }; const changed = await f.start(token); assert.equal((await f.callback(changed)).status, 401); assert.equal((await f.status(token)).connected, true);
  const mismatch = await f.start(token); assert.equal((await f.callback(mismatch, { client_id: 'different-client' })).status, 400); assert.equal((await f.status(token)).connected, true);
});

test('missing plan grant stays connected but cannot infer; cancel and access denial preserve old account', async (t) => {
  const f = await fixture(t); const token = await f.pair(); f.state.scopes = 'openid email'; await f.signIn(token);
  assert.equal((await f.status(token)).sharing, false); assert.equal((await f.request('/models', {}, token)).status, 403); assert.equal(f.state.modelCount, 0);
  const url = await f.start(token); await f.request('/auth/cancel', {}, token); assert.equal((await f.callback(url)).status, 400); assert.equal((await f.status(token)).connected, true);
  const denied = await f.start(token); assert.equal((await f.callback(denied, { error: 'access_denied' })).status, 400); assert.equal((await f.status(token)).error, 'access_denied');
  const expired = await f.start(token); f.state.now += 10 * 60_000;
  assert.equal((await f.status(token)).authPending, false); assert.equal((await f.status(token)).error, 'auth_expired'); assert.equal((await f.callback(expired)).status, 400);
});

test('new account uses separate dynamic registration and discards old tokens only after validation', async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token);
  const oldClient = f.state.client; const url = await f.start(token, true);
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client'); assert.equal((await f.status(token)).connected, true);
  f.state.client = 'oaiapp_offline_second'; f.state.badClaims = { sub: 'second-user', email: 'second@example.test' };
  f.state.initialAccessToken = 'offline-second-access'; f.state.initialRefreshToken = 'offline-second-refresh';
  assert.equal((await f.callback(url)).status, 200); assert.equal((await f.status(token)).account.email, 'second@example.test');
  const saved = JSON.parse(await readFile(join(f.directory, 'credentials.json'), 'utf8'));
  assert.equal(saved.registration.clientId, f.state.client); assert.equal(saved.profiles[0].registration.clientId, oldClient);
  assert.equal(saved.profiles[0].registration.identity.subject, 'offline-user'); assert.equal(saved.profiles[0].credentials, undefined);
  assert.ok(!JSON.stringify(saved).includes('offline-access-initial')); assert.ok(!JSON.stringify(saved).includes('offline-refresh-initial'));
  const logout = await f.request('/logout', {}, token); assert.equal((await logout.json()).revocationConfirmed, true);
  const exited = JSON.parse(await readFile(join(f.directory, 'credentials.json'), 'utf8'));
  assert.equal(exited.credentials, null); assert.equal(exited.profiles[0].credentials, undefined); assert.equal(exited.profiles[0].registration.clientId, oldClient);
});

test('concurrent expiry refresh is singleflight and rotating token is persisted atomically', async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token); f.state.now += 3_590_000;
  f.state.holdRefresh = { entered: deferred(), release: deferred() };
  const first = f.request('/models', {}, token); await f.state.holdRefresh.entered.promise;
  const second = f.request('/models', {}, token); f.state.holdRefresh.release.resolve();
  assert.equal((await first).status, 200); assert.equal((await second).status, 200); assert.equal(f.state.refreshCount, 1);
  const saved = JSON.parse(await readFile(join(f.directory, 'credentials.json'), 'utf8')); assert.equal(saved.credentials.refreshToken, 'offline-refresh-1'); assert.equal(saved.credentials.accessToken, 'offline-access-refreshed-1');
  assert.equal(f.state.tokenCalls[1].get('scope'), null); assert.equal(f.state.tokenCalls[1].get('refresh_token'), 'offline-refresh-initial');
});

test('earliest refresh gate keeps valid near-expiry tokens usable and never sends expired tokens', async (t) => {
  const f = await fixture(t); const token = await f.pair(); f.state.earliestRefreshAt = f.state.now / 1000 + 3800; await f.signIn(token);
  f.state.now += 3_590_000;
  assert.equal((await f.request('/models', {}, token)).status, 200); assert.equal(f.state.refreshCount, 0);
  assert.equal(f.state.apiCalls.at(-1).authorization, 'Bearer offline-access-initial');
  f.state.now += 11_000;
  const expired = await f.request('/models', {}, token); assert.equal(expired.status, 503); assert.equal((await expired.json()).error.code, 'refresh_not_ready');
  assert.equal(f.state.modelCount, 1); assert.equal(f.state.refreshCount, 0);
  f.state.now += 200_000;
  assert.equal((await f.request('/models', {}, token)).status, 200); assert.equal(f.state.refreshCount, 1);
  assert.equal(f.state.apiCalls.at(-1).authorization, 'Bearer offline-access-refreshed-1');
});

test('logout during a late refresh prevents account resurrection and reports uncertain revocation', async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token); f.state.now += 3_590_000; f.state.ignoreTokenAbort = true;
  f.state.holdRefresh = { entered: deferred(), release: deferred() };
  const models = f.request('/models', {}, token); await f.state.holdRefresh.entered.promise;
  const logout = await f.request('/logout', {}, token); assert.deepEqual(await logout.json(), { connected: false, revocationConfirmed: false });
  f.state.holdRefresh.release.resolve(); assert.equal((await models).status, 409); assert.equal((await f.status(token)).connected, false);
  const saved = JSON.parse(await readFile(join(f.directory, 'credentials.json'), 'utf8')); assert.equal(saved.credentials, null); assert.equal(f.state.modelCount, 0);
});

test('cancel during late code exchange cannot replace a connected account', async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token); f.state.ignoreTokenAbort = true;
  const url = await f.start(token); f.state.holdCode = { entered: deferred(), release: deferred() };
  const callback = f.callback(url); await f.state.holdCode.entered.promise; assert.equal((await f.status(token)).authPending, true);
  await f.request('/auth/cancel', {}, token); f.state.holdCode.release.resolve(); assert.equal((await callback).status, 409); assert.equal((await f.status(token)).connected, true);
});

test('new authorization supersedes a pending exchange without changing active account until verified', async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token); f.state.ignoreTokenAbort = true;
  const oldUrl = await f.start(token); const hold = { entered: deferred(), release: deferred() }; f.state.holdCode = hold;
  const oldCallback = f.callback(oldUrl); await hold.entered.promise;
  f.state.holdCode = null; const currentUrl = await f.start(token);
  assert.equal((await f.status(token)).connected, true); assert.equal((await f.status(token)).authPending, true);
  assert.equal((await f.callback(currentUrl)).status, 200); hold.release.resolve();
  assert.equal((await oldCallback).status, 409); assert.equal((await f.status(token)).connected, true); assert.equal((await f.status(token)).error, undefined);
});

test('successful reauthorization cancels old inference streams; remote revocation failures remain explicit', async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token); f.state.stream = 'pending';
  f.state.streamEntered = deferred(); f.state.streamClosed = deferred();
  const streaming = await f.request('/responses', { model: 'account-model', input: [{ role: 'user', content: 'x' }] }, token);
  await f.state.streamEntered.promise; await f.signIn(token); await f.state.streamClosed.promise;
  assert.ok(!(await streaming.text()).includes('response.completed'));
  f.state.revokeFailure = true; const logout = await f.request('/logout', {}, token); assert.equal((await logout.json()).revocationConfirmed, false);
  assert.equal((await f.status(token)).connected, false);
});

test('logout overall remote budget includes slow discovery and returns local success even if transport ignores abort', async (t) => {
  const f = await fixture(t, { logoutBudgetMs: 50 }); const token = await f.pair(); await f.signIn(token); await f.restart();
  f.state.ignoreDiscoveryAbort = true; f.state.holdDiscovery = { entered: deferred(), release: deferred() };
  const began = performance.now(); const logout = f.request('/logout', {}, token); await f.state.holdDiscovery.entered.promise;
  const response = await logout; assert.equal(response.status, 200); assert.deepEqual(await response.json(), { connected: false, revocationConfirmed: false });
  assert.ok(performance.now() - began < 1500, 'short injectable remote budget must not wait for held discovery');
  assert.equal((await f.status(token)).connected, false);
  assert.equal(JSON.parse(await readFile(join(f.directory, 'credentials.json'), 'utf8')).credentials, null);
  assert.equal(f.state.revoked, undefined); f.state.holdDiscovery.release.resolve();
});

test('logout overall remote budget also stops a slow revocation after local token removal', async (t) => {
  const f = await fixture(t, { logoutBudgetMs: 50 }); const token = await f.pair(); await f.signIn(token);
  f.state.holdRevocation = { entered: deferred(), release: deferred() };
  const began = performance.now(); const logout = f.request('/logout', {}, token); await f.state.holdRevocation.entered.promise;
  const response = await logout; assert.equal(response.status, 200); assert.deepEqual(await response.json(), { connected: false, revocationConfirmed: false });
  assert.ok(performance.now() - began < 1500); assert.equal((await f.status(token)).connected, false); f.state.holdRevocation.release.resolve();
});

test('refresh invalid_grant removes local tokens, 401 retries only before inference begins', async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token); f.state.unauthorizedOnce = true;
  assert.equal((await f.request('/models', {}, token)).status, 200); assert.equal(f.state.refreshCount, 1);
  f.state.now += 3_590_000; f.state.refreshFailure = 'invalid_grant'; assert.equal((await f.request('/models', {}, token)).status, 400); assert.equal((await f.status(token)).connected, false);
});

test('upstream 403 remains a permission refusal and 503 remains temporary without erasing credentials', async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token);
  for (const failure of [
    { status: 400, code: 'subscription_sharing_unsupported_capability' },
    { status: 403, code: 'subscription_sharing_user_not_eligible' },
    { status: 429, code: 'subscription_sharing_usage_limit_exceeded' },
    { status: 500, code: 'server_error' },
    { status: 503, code: 'subscription_sharing_usage_unavailable' },
  ]) {
    f.state.apiFailure = failure;
    const response = await f.request('/models', {}, token); assert.equal(response.status, failure.status);
    const result = await response.json(); assert.equal(result.error.code, failure.code); assert.ok(!JSON.stringify(result).includes('unsafe raw provider message'));
    assert.equal((await f.status(token)).connected, true); assert.equal(f.state.refreshCount, 0);
  }
  f.state.apiFailure = { status: 403, code: 'unrecognized_upstream_code' };
  const unknown = await f.request('/models', {}, token); assert.equal(unknown.status, 403); assert.equal((await unknown.json()).error.code, 'upstream_error');
  f.state.apiFailure = null; f.state.codeFailure = 'subscription_sharing_user_not_eligible'; f.state.codeFailureStatus = 403;
  const url = await f.start(token); const callback = await f.callback(url); assert.equal(callback.status, 403);
  assert.equal((await callback.json()).error.code, 'subscription_sharing_user_not_eligible'); assert.equal((await f.status(token)).connected, true);
});

test('Responses is public API, only allowed fields, streamed completion/failure/incomplete/early EOF are distinct', async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token);
  const body = { model: 'account-model', input: [{ role: 'user', content: 'translate this' }], instructions: 'Translate.' };
  const good = await f.request('/responses', body, token); assert.equal(good.status, 200); const goodText = await good.text(); assert.ok(goodText.includes('response.completed')); assert.ok(goodText.includes('译文'));
  assert.deepEqual(f.state.apiCalls.at(-1).body, { ...body, stream: true, store: false });
  assert.equal((await f.request('/responses', { ...body, temperature: 0.1 }, token)).status, 400);
  assert.equal((await f.request('/responses', { ...body, input: [{ role: 'system', content: 'x' }] }, token)).status, 400);
  assert.equal((await f.request('/responses', { ...body, tools: [{ type: 'web_search' }] }, token)).status, 400);
  const toolRequest = { ...body, tools: [{ type: 'namespace', name: 'fluentread', tools: [{ type: 'function', name: 'get_word', parameters: { type: 'object' }, strict: false }] }] };
  assert.equal((await f.request('/responses', toolRequest, token)).status, 200);
  f.state.stream = 'failed'; const failed = await (await f.request('/responses', body, token)).text(); assert.ok(failed.includes('subscription_sharing_usage_limit_exceeded')); assert.ok(!failed.includes('unsafe raw error')); assert.ok(!failed.includes('response.completed'));
  f.state.stream = 'early'; const early = await (await f.request('/responses', body, token)).text(); assert.ok(early.includes('stream_incomplete')); assert.ok(!early.includes('response.completed'));
  f.state.stream = 'incomplete'; const incomplete = await (await f.request('/responses', body, token)).text(); assert.ok(incomplete.includes('response_incomplete')); assert.ok(!incomplete.includes('response.completed'));
  assert.ok(incomplete.includes('event: response.incomplete\ndata: {"type":"response.incomplete"'));
  f.state.stream = 'badutf8'; const malformed = await (await f.request('/responses', body, token)).text(); assert.ok(malformed.includes('event: error')); assert.ok(!malformed.includes('response.completed'));
});

test('client cancellation and logout terminate upstream inference streams', async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token); f.state.stream = 'pending';
  const body = { model: 'account-model', input: [{ role: 'user', content: 'x' }] };
  f.state.streamEntered = deferred(); f.state.streamClosed = deferred();
  const controller = new AbortController();
  const response = await fetch(`${f.bridge.url}/responses`, { method: 'POST', signal: controller.signal, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  await f.state.streamEntered.promise; const reader = response.body.getReader(); await reader.read(); controller.abort(); await f.state.streamClosed.promise;
  f.state.streamEntered = deferred(); f.state.streamClosed = deferred();
  const streaming = await f.request('/responses', body, token); await f.state.streamEntered.promise; await f.request('/logout', {}, token); await f.state.streamClosed.promise;
  const text = await streaming.text(); assert.ok(!text.includes('response.completed')); assert.equal((await f.status(token)).connected, false);
});

test('completed inference closes the HTTP response without waiting for upstream cancel acknowledgement', {timeout: 2000}, async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token);
  let cancelled = 0;
  f.state.apiResponse = path => path === '/v1/responses' ? new Response(new ReadableStream({
    start(controller) {controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"status":"completed"}}\n\n'));},
    cancel() {cancelled++;return new Promise(() => {});},
  }), {headers: {'Content-Type': 'text/event-stream'}}) : undefined;
  const response = await f.request('/responses', {model: 'account-model', input: [{role: 'user', content: 'x'}]}, token);
  assert.match(await response.text(), /response.completed/);
  assert.equal(cancelled, 1);
});

test('invalid inference content type cancels its unread response body before returning an error', {timeout: 2000}, async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token);
  let cancelled = 0;
  f.state.apiResponse = path => path === '/v1/responses' ? new Response(new ReadableStream({
    cancel() {cancelled++;return Promise.reject(new Error('cancel acknowledgement failed'));},
  }), {headers: {'Content-Type': 'text/html'}}) : undefined;
  const response = await f.request('/responses', {model: 'account-model', input: [{role: 'user', content: 'x'}]}, token);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'invalid_stream');
  assert.equal(cancelled, 1);
});

test('401 credential refresh proceeds while the discarded response cancel remains pending', {timeout: 2000}, async (t) => {
  const f = await fixture(t); const token = await f.pair(); await f.signIn(token);
  let cancelled = 0, attempts = 0;
  f.state.apiResponse = path => path === '/v1/models' && attempts++ === 0 ? new Response(new ReadableStream({
    cancel() {cancelled++;return new Promise(() => {});},
  }), {status: 401}) : undefined;
  const response = await f.request('/models', {}, token);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {models: [{slug: 'account-model', display_name: 'Account Model'}]});
  assert.equal(cancelled, 1);assert.equal(f.state.refreshCount, 1);
});

test('storage excludes duplicate processes, symlink credentials and unsafe existing permissions', async (t) => {
  const f = await fixture(t);
  await assert.rejects(createChatGPTPlanBridge({ directory: f.directory, port: 0 }), /BRIDGE_ALREADY_RUNNING/);
  const extra = await mkdtemp(join(tmpdir(), 'fluentread-chatgpt-plan-store-test-'));
  t.after(() => rm(extra, { recursive: true, force: true }));
  const target = join(extra, 'target.json'); await writeFile(target, '{}', { mode: 0o600 }); await symlink(target, join(extra, 'credentials.json'));
  await assert.rejects(createChatGPTPlanBridge({ directory: extra, port: 0 }));
  await rm(join(extra, 'credentials.json')); await writeFile(join(extra, 'credentials.json'), '{}', { mode: 0o644 });
  await assert.rejects(createChatGPTPlanBridge({ directory: extra, port: 0 }), /UNSAFE_CREDENTIAL_PERMISSIONS/);
});

test('concurrent recovery of a dead process lock admits only one bridge', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fluentread-chatgpt-plan-lock-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'bridge.lock'), '99999999', { mode: 0o600 });
  const results = await Promise.allSettled([createChatGPTPlanBridge({ directory, port: 0 }), createChatGPTPlanBridge({ directory, port: 0 })]);
  const winners = results.filter((result) => result.status === 'fulfilled');
  await Promise.all(winners.map((result) => result.value.close())); assert.equal(winners.length, 1);
});

test('input validation rejects hosted additional tools and malformed request fields', () => {
  assert.throws(() => validateResponseRequest({ model: 'x', input: [{ type: 'additional_tools', tools: [{ type: 'mcp' }] }] }), /namespace/);
  assert.throws(() => validateResponseRequest({ model: 'x', input: [{ role: 'user', content: 'x' }], parallel_tool_calls: 'yes' }));
  assert.equal(validateResponseRequest({ model: 'x', input: [{ role: 'user', content: 'x' }] }).store, false);
});

test('production CLI fixes the extension bridge port and rejects port overrides before accessing storage', () => {
  const cli = new URL('../integrations/chatgpt-plan/cli.mjs', import.meta.url);
  const help = spawnSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.ok(help.stdout.includes('127.0.0.1:18743')); assert.ok(!help.stdout.includes('--port'));
  const override = spawnSync(process.execPath, [cli.pathname, '--port', '19877'], { encoding: 'utf8' });
  assert.equal(override.status, 1); assert.ok(override.stderr.includes('参数无效'));
});

test('production CLI keeps directory and occupied-port startup failures actionable without exposing stored content', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fluentread-cli-failure-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const cli = new URL('../integrations/chatgpt-plan/cli.mjs', import.meta.url);
  const run = (path) => spawnSync(process.execPath, [cli.pathname, '--data-dir', path], {encoding: 'utf8', timeout: 5_000});
  await writeFile(join(directory, 'not-directory'), 'private fixture content');
  const invalid = run(join(directory, 'not-directory'));
  assert.equal(invalid.status, 1);assert.match(invalid.stderr, /检查目录权限/);assert.equal(invalid.stdout, '');
  const holder = await createChatGPTPlanBridge({directory: join(directory, 'locked'), port: 0});
  try {const locked = run(join(directory, 'locked'));assert.equal(locked.status, 1);assert.match(locked.stderr, /目录已有助手运行/);assert.equal(locked.stdout, '');}
  finally {await holder.close();}
  const blocker = createServer();
  try {await new Promise((resolve, reject) => {blocker.once('error', reject);blocker.listen(BRIDGE_PORT, '127.0.0.1', resolve);});}
  catch (failure) {if (failure.code !== 'EADDRINUSE') throw failure;}
  try {
    const occupied = run(join(directory, 'occupied'));
    assert.equal(occupied.status, 1);assert.match(occupied.stderr, /18743 已被占用/);assert.equal(occupied.stdout, '');
    await assert.rejects(stat(join(directory, 'occupied', 'bridge.lock')), {code: 'ENOENT'});
  } finally {if (blocker.listening) await new Promise(resolve => blocker.close(resolve));}
});

test('production CLI issues fresh local pair codes and both termination signals release its port and process lock', async (t) => {
  const probe = createServer();
  try {await new Promise((resolve, reject) => {probe.once('error', reject);probe.listen(BRIDGE_PORT, '127.0.0.1', resolve);});}
  catch (failure) {if (failure.code === 'EADDRINUSE') {t.skip('The fixed application port is already used; do not disturb another bridge.');return;}throw failure;}
  await new Promise(resolve => probe.close(resolve));
  const directory = await mkdtemp(join(tmpdir(), 'fluentread-cli-lifecycle-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const cli = new URL('../integrations/chatgpt-plan/cli.mjs', import.meta.url);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const child = spawn(process.execPath, [cli.pathname, '--data-dir', directory], {stdio: ['pipe', 'pipe', 'pipe']});
    const exited = once(child, 'exit', {signal: AbortSignal.timeout(5_000)});void exited.catch(() => {});let output = '', failureOutput = '';
    child.stdout.on('data', chunk => {output += chunk;});child.stderr.on('data', chunk => {failureOutput += chunk;});
    const waitForCodes = async count => {
      for (let attempt = 0; attempt < 500; attempt++) {
        if ((output.match(/一次性配对码（5 分钟内有效）：/gu) || []).length >= count) return;
        if (child.exitCode !== null) throw new Error('CLI exited before pairing readiness');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('CLI pairing readiness timed out');
    };
    try {
      await waitForCodes(1);
      child.stdin.write('ignored\n pair \n');await waitForCodes(2);
      const codes = [...output.matchAll(/一次性配对码（5 分钟内有效）：([^\n]+)/gu)].map(match => match[1]);
      assert.equal(new Set(codes).size, 2);assert.ok(output.includes(`127.0.0.1:${BRIDGE_PORT}`));
      child.kill(signal);assert.deepEqual(await exited, [0, null]);assert.equal(failureOutput, '');
      await assert.rejects(stat(join(directory, 'bridge.lock')), {code: 'ENOENT'});
    } finally {
      if (child.exitCode === null && child.signalCode === null) {child.kill('SIGKILL');await exited.catch(() => {});}
      // 配对码只供本例内比较，绝不写入测试证据或日志。
      output = '';
    }
  }
});
