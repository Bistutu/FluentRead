/**
 * @file integrations/chatgpt-plan/oauth-runtime.mjs
 * 仅在本机执行 Sign in with ChatGPT：动态注册、PKCE、OpenID 签名校验、续期和撤销。
 * 运行时保存账号凭证与稳定 host ID；扩展只能读取安全状态，无法取得 OpenAI 令牌。
 */
import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify } from 'node:crypto';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const randomSecret = () => randomBytes(32).toString('base64url');
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export function equalSecret(a, b) {
  return typeof a === 'string' && typeof b === 'string' && timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
}
export class BridgeError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => new BridgeError(code, message, status);
const clean = (value, max = 200) => typeof value === 'string' ? value.slice(0, max) : undefined;
const KNOWN_UPSTREAM_CODES = new Set([
  'invalid_grant', 'invalid_token', 'invalid_client', 'invalid_refresh_token', 'token_expired',
  'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused', 'access_denied',
  'invalid_request', 'invalid_request_error', 'invalid_api_key', 'authentication_error', 'unauthorized',
  'permission_denied', 'model_not_found', 'unsupported_parameter', 'rate_limit_exceeded',
  'insufficient_quota', 'usage_limit', 'server_error', 'internal_server_error',
  'subscription_sharing_user_not_eligible', 'subscription_sharing_usage_limit_exceeded',
  'subscription_sharing_usage_unavailable', 'subscription_sharing_unsupported_capability',
  'subscription_sharing_route_not_supported', 'subscription_sharing_invalid_user',
  'subscription_sharing_user_unavailable', 'chatpass_v2_scope_not_authorized',
  'chatpass_v2_invalid_authorization_context', 'response_failed', 'response_incomplete',
]);
export const safeUpstreamCode = (value) => typeof value === 'string' && KNOWN_UPSTREAM_CODES.has(value) ? value : 'upstream_error';
/** 丢弃响应时立即发起取消；传输层的取消确认不能阻塞错误返回、续期或退出。 */
export function cancelStream(stream) {
  try { void stream?.cancel().catch(() => {}); } catch { /* 清理失败不覆盖已确定的请求结果。 */ }
}
function upstreamFailure(code, status) {
  const preservedStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
  const message = status === 429 ? 'ChatGPT 套餐额度或请求频率暂不可用，请管理用量。'
    : status === 401 ? 'ChatGPT 连接需要重新登录。'
    : status === 403 ? '当前 ChatGPT 账号、工作区或策略不允许此请求，请检查授权与资格。'
    : status === 400 ? 'ChatGPT 请求参数不受支持，请检查所选模型与请求内容。'
    : 'OpenAI 请求暂未完成，请稍后重试。';
  return fail(code, message, preservedStatus);
}

export function createOAuthRuntime({ store, initial, fetchImpl = fetch, now = Date.now, logoutBudgetMs = 8_000 }) {
  let record = initial || { version: 1, hostId: `urn:uuid:${randomUUID()}`, pairs: [], profiles: [], registration: null, credentials: null };
  if (record.version !== 1 || !/^urn:uuid:[a-f0-9-]{36}$/.test(record.hostId) || !Array.isArray(record.pairs)) throw new Error('INVALID_CREDENTIAL_RECORD');
  record = { ...record, profiles: record.profiles || [] };
  if (!Array.isArray(record.profiles)) throw new Error('INVALID_CREDENTIAL_RECORD');
  record.profiles = record.profiles.map(({ registration }) => ({ registration }));
  let generation = 0;
  let pending = null;
  let verifying = null;
  let refreshPromise = null;
  let discoveryPromise = null;
  let jwksPromise = null;
  let lastError;
  const requests = new Set();
  const commit = async () => store.write(record);
  const guard = (expected) => { if (generation !== expected) throw fail('session_changed', 'ChatGPT 连接已变更，请重新发起请求。', 409); };
  async function upstream(url, init = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['auth.openai.com', 'api.openai.com'].includes(parsed.hostname) || parsed.port || parsed.username || parsed.password) throw fail('untrusted_endpoint', '拒绝非官方 OpenAI 地址。', 502);
    return fetchImpl(url, { signal: AbortSignal.timeout(20_000), ...init, redirect: 'error' });
  }
  async function requestJson(url, init = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    init.signal?.addEventListener('abort', abort, { once: true });
    if (init.signal?.aborted) abort();
    const timeout = setTimeout(abort, 20_000); timeout.unref();
    try {
      const response = await upstream(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        let data; try { data = await response.json(); } catch { /* 不透传上游正文。 */ }
        throw upstreamFailure(safeUpstreamCode(data?.error?.code || data?.error), response.status);
      }
      return await response.json();
    } finally { clearTimeout(timeout); init.signal?.removeEventListener('abort', abort); }
  }
  function discovery(signal) {
    if (!discoveryPromise) discoveryPromise = requestJson(`${ISSUER}/.well-known/openid-configuration`, { signal }).then((data) => {
      if (data.issuer !== ISSUER) throw fail('invalid_issuer', 'OpenAI 身份服务验证失败。', 502);
      for (const key of ['jwks_uri', 'revocation_endpoint']) {
        const url = new URL(data[key]);
        if (url.origin !== ISSUER || url.username || url.password || url.hash) throw fail('untrusted_endpoint', 'OpenAI 身份服务地址验证失败。', 502);
      }
      return data;
    }).catch((error) => { discoveryPromise = null; throw error; });
    return discoveryPromise;
  }
  async function validateIdToken(raw, clientId, nonce, subject, signal) {
    if (typeof raw !== 'string' || raw.length > 32_000) throw fail('invalid_id_token', 'OpenAI 身份令牌无效。', 401);
    const segments = raw.split('.');
    if (segments.length !== 3 || segments.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw fail('invalid_id_token', 'OpenAI 身份令牌无效。', 401);
    let header, claims;
    try { header = JSON.parse(Buffer.from(segments[0], 'base64url')); claims = JSON.parse(Buffer.from(segments[1], 'base64url')); }
    catch { throw fail('invalid_id_token', 'OpenAI 身份令牌无效。', 401); }
    if (!['RS256', 'ES256'].includes(header.alg) || typeof header.kid !== 'string' || header.crit) throw fail('invalid_id_token', 'OpenAI 身份令牌签名无效。', 401);
    const metadata = await discovery();
    async function getKeys(reload = false) {
      if (reload || !jwksPromise) jwksPromise = requestJson(metadata.jwks_uri, { signal }).catch((error) => { jwksPromise = null; throw error; });
      return jwksPromise;
    }
    let keys = await getKeys();
    let key = keys.keys?.find((entry) => entry.kid === header.kid && (!entry.alg || entry.alg === header.alg) && (!entry.use || entry.use === 'sig'));
    if (!key) { keys = await getKeys(true); key = keys.keys?.find((entry) => entry.kid === header.kid && (!entry.alg || entry.alg === header.alg) && (!entry.use || entry.use === 'sig')); }
    if (!key || (header.alg === 'RS256' && key.kty !== 'RSA') || (header.alg === 'ES256' && (key.kty !== 'EC' || key.crv !== 'P-256'))) throw fail('invalid_id_token', 'OpenAI 身份令牌签名无效。', 401);
    let valid = false;
    try {
      const publicKey = createPublicKey({ key, format: 'jwk' });
      valid = verify('sha256', Buffer.from(`${segments[0]}.${segments[1]}`), header.alg === 'ES256' ? { key: publicKey, dsaEncoding: 'ieee-p1363' } : publicKey, Buffer.from(segments[2], 'base64url'));
    } catch { /* 对畸形公钥或签名统一失败。 */ }
    const seconds = now() / 1000;
    const audiences = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
    if (!valid || claims.iss !== ISSUER || !Array.isArray(audiences) || !audiences.includes(clientId)
      || (audiences.length > 1 && claims.azp !== clientId) || !Number.isFinite(claims.exp) || claims.exp <= seconds
      || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > seconds + 30))
      || (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat > seconds + 30))
      || typeof claims.sub !== 'string' || !claims.sub || (nonce !== undefined && !equalSecret(claims.nonce, nonce))
      || (subject && claims.sub !== subject)) throw fail('invalid_id_token', 'OpenAI 身份令牌验证失败。', 401);
    return { issuer: ISSUER, subject: claims.sub, name: clean(claims.name), email: clean(claims.email, 320) };
  }
  function tokenRecord(data, previous) {
    if (typeof data.access_token !== 'string' || !data.access_token || data.token_type?.toLowerCase() !== 'bearer'
      || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 86_400
      || (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || !data.refresh_token))) throw fail('invalid_token_response', 'OpenAI 返回的凭证无效。', 502);
    const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : previous?.scopes || [];
    return { accessToken: data.access_token, refreshToken: data.refresh_token || previous?.refreshToken,
      idToken: data.id_token || previous?.idToken, scopes, expiresAt: now() + data.expires_in * 1000,
      earliestRefreshAt: Number.isFinite(data.earliest_refresh_at) ? data.earliest_refresh_at * 1000 : 0 };
  }
  function cancelRequests() { for (const controller of requests) controller.abort(); requests.clear(); }
  function cancelAuth() { pending?.controller.abort(); verifying?.controller.abort(); pending = null; verifying = null; }
  async function startAuth(redirectUri, newAccount = false) {
    cancelAuth(); lastError = undefined;
    const attempt = { state: randomSecret(), nonce: randomSecret(), verifier: randomSecret(), redirectUri,
      expiresAt: now() + 10 * 60_000, clientId: newAccount ? undefined : record.registration?.clientId,
      identity: newAccount ? undefined : record.registration?.identity, controller: new AbortController() };
    pending = attempt;
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({ client_id: attempt.clientId || 'dynamic_agent_client',
      ext_agent_host_id: record.hostId, response_type: 'code', redirect_uri: redirectUri,
      scope: SCOPES, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url') }).toString();
    if (!attempt.clientId) url.searchParams.set('agent_name_hint', 'FluentRead');
    // 凭证不能进入扩展的 authorizationUrl；不发送 id_token_hint。
    return url.toString();
  }
  async function callback(parameters) {
    const attempt = pending;
    if (!attempt || now() >= attempt.expiresAt || !equalSecret(parameters.get('state'), attempt.state)) throw fail('invalid_state', '登录请求已失效，请在扩展中重新登录。', 400);
    pending = null; // 首个有效回调立即消费 state，重复回调不能再次交换 code。
    verifying = attempt;
    const expected = generation;
    requests.add(attempt.controller);
    try {
      if (parameters.has('error')) throw fail('access_denied', '已取消 ChatGPT 授权。', 400);
      const issued = parameters.get('client_id');
      const clientId = attempt.clientId || issued;
      if (!clientId || clientId === 'dynamic_agent_client' || clientId.length > 300 || !/^[A-Za-z0-9_.:-]+$/.test(clientId)
        || (attempt.clientId && issued && issued !== attempt.clientId)) throw fail('invalid_client', 'ChatGPT 客户端注册无效，请重新登录。', 400);
      const code = parameters.get('code');
      if (!code || code.length > 4000) throw fail('invalid_callback', 'ChatGPT 登录回调缺少授权码。', 400);
      const data = await requestJson(TOKEN, { method: 'POST', signal: attempt.controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId,
          code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE }) });
      guard(expected);
      if (attempt.controller.signal.aborted) throw fail('session_changed', '登录请求已取消。', 409);
      const identity = await validateIdToken(data.id_token, clientId, attempt.nonce, attempt.identity?.subject, attempt.controller.signal);
      const credentials = tokenRecord(data);
      guard(expected);
      if (attempt.controller.signal.aborted) throw fail('session_changed', '登录请求已取消。', 409);
      generation++; cancelRequests(); refreshPromise = null;
      const profiles = record.profiles.filter((profile) => profile.registration.clientId !== clientId);
      if (record.registration && record.registration.clientId !== clientId) {
        // UI 只有一个当前账号；历史仅留注册元数据，不积存无法选择的旧令牌。
        const previous = { registration: record.registration };
        const index = profiles.findIndex((profile) => profile.registration.clientId === previous.registration.clientId);
        if (index === -1) profiles.push(previous); else profiles[index] = previous;
      }
      record = { ...record, profiles, registration: { clientId, identity }, credentials };
      await commit(); lastError = undefined;
    } catch (error) { if (verifying === attempt) lastError = error instanceof BridgeError ? error.code : 'auth_failed'; throw error; }
    finally { requests.delete(attempt.controller); if (verifying === attempt) verifying = null; }
  }
  async function refresh(expected) {
    const previous = record.credentials;
    const registration = record.registration;
    if (!previous?.refreshToken || !registration) throw fail('sign_in_required', '请先登录 ChatGPT。', 401);
    if (previous.earliestRefreshAt > now()) throw fail('refresh_not_ready', 'ChatGPT 连接暂不可续期，请稍后重试。', 503);
    const controller = new AbortController(); requests.add(controller);
    try {
      const data = await requestJson(TOKEN, { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: registration.clientId,
          refresh_token: previous.refreshToken, resource: RESOURCE }) });
      if (data.id_token) await validateIdToken(data.id_token, registration.clientId, undefined, registration.identity.subject, controller.signal);
      const credentials = tokenRecord(data, previous);
      guard(expected);
      if (controller.signal.aborted) throw fail('session_changed', 'ChatGPT 连接已变更。', 409);
      record = { ...record, credentials }; await commit();
      return credentials;
    } catch (error) {
      if (error instanceof BridgeError && ['invalid_grant', 'invalid_token'].includes(error.code) && generation === expected) {
        record = { ...record, credentials: null }; await commit();
      }
      throw error;
    } finally { requests.delete(controller); }
  }
  async function access(expected, force = false) {
    guard(expected);
    if (!record.credentials) throw fail('sign_in_required', '请先登录 ChatGPT。', 401);
    if (!record.credentials.scopes.includes('chatgpt.tokens.use.direct')) throw fail('plan_permission_required', '请允许 FluentRead 使用 ChatGPT 套餐。', 403);
    const refreshDue = force || record.credentials.expiresAt <= now() + 30_000;
    const refreshAllowed = record.credentials.earliestRefreshAt <= now();
    if (refreshDue && !refreshAllowed && (force || record.credentials.expiresAt <= now())) throw fail('refresh_not_ready', 'ChatGPT 连接暂不可续期，请稍后重试。', 503);
    if (refreshDue && refreshAllowed) {
      if (!refreshPromise) {
        const refreshing = refresh(expected).finally(() => { if (refreshPromise === refreshing) refreshPromise = null; });
        refreshPromise = refreshing;
      }
      await refreshPromise; guard(expected);
    }
    if (!record.credentials?.scopes.includes('chatgpt.tokens.use.direct')) throw fail('plan_permission_required', 'ChatGPT 套餐授权已取消，请重新授权。', 403);
    if (record.credentials.expiresAt <= now()) throw fail('token_expired', 'ChatGPT 连接已到期，请重新登录。', 401);
    return record.credentials.accessToken;
  }
  async function api(path, init = {}) {
    const expected = generation;
    const controller = new AbortController(); requests.add(controller);
    const abort = () => controller.abort();
    init.signal?.addEventListener('abort', abort, { once: true });
    if (init.signal?.aborted) abort();
    try {
      let token = await access(expected);
      guard(expected);
      let response = await upstream(`${RESOURCE}/${path}`, { ...init, signal: controller.signal, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
      if (response.status === 401) {
        cancelStream(response.body); token = await access(expected, true);
        response = await upstream(`${RESOURCE}/${path}`, { ...init, signal: controller.signal, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
      }
      guard(expected);
      if (!response.ok) {
        let data; try { data = await response.json(); } catch { /* 错误正文不对外公开。 */ }
        throw upstreamFailure(safeUpstreamCode(data?.error?.code || data?.error), response.status);
      }
      return { response, release: () => { requests.delete(controller); init.signal?.removeEventListener('abort', abort); }, signal: controller.signal };
    } catch (error) { requests.delete(controller); init.signal?.removeEventListener('abort', abort); throw error; }
  }
  async function logout() {
    const old = record;
    const refreshWasPending = !!refreshPromise;
    generation++; cancelAuth(); cancelRequests(); refreshPromise = null;
    record = { ...record, credentials: null };
    await commit(); lastError = undefined;
    if (!old.credentials) return { connected: false, revocationConfirmed: !refreshWasPending };
    if (!old.credentials.refreshToken || !old.registration) return { connected: false, revocationConfirmed: false };
    const controller = new AbortController();
    let timeout;
    const budget = new Promise((resolve) => {
      timeout = setTimeout(() => { controller.abort(); resolve(false); }, logoutBudgetMs);
      timeout.unref();
    });
    const remote = (async () => {
      try {
        const metadata = await discovery(controller.signal);
        if (controller.signal.aborted) return false;
        const response = await upstream(metadata.revocation_endpoint, { method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: old.credentials.refreshToken,
            token_type_hint: 'refresh_token', client_id: old.registration.clientId }) });
        const confirmed = response.status === 200;
        await response.body?.cancel(); return confirmed;
      } catch { return false; /* 本地退出已生效；UI 应说明远端撤销尚未确认。 */ }
    })();
    let revocationConfirmed;
    try { revocationConfirmed = await Promise.race([remote, budget]) && !refreshWasPending; }
    finally { clearTimeout(timeout); controller.abort(); }
    return { connected: false, revocationConfirmed };
  }
  function status() {
    if (pending && now() >= pending.expiresAt) { cancelAuth(); lastError = 'auth_expired'; }
    return { connected: !!record.credentials, sharing: !!record.credentials?.scopes.includes('chatgpt.tokens.use.direct'),
      ...(record.credentials ? { account: { name: record.registration.identity.name, email: record.registration.identity.email } } : {}),
      authPending: !!pending || !!verifying, ...(lastError ? { error: lastError } : {}) };
  }
  return { initialize: commit, startAuth, callback, cancelAuth, status, logout, api, getRecord: () => record,
    savePairs: async (pairs) => { record = { ...record, pairs }; await commit(); },
    close: () => { generation++; cancelAuth(); cancelRequests(); } };
}
