/**
 * @file integrations/chatgpt-plan/bridge.mjs
 * 绑定 127.0.0.1 的本机 HTTP 助手，承接扩展配对、OAuth 回调和 Responses SSE。
 * Host、Origin、一次性高熵配对码及 Origin 绑定的 Bearer 凭证共同限制网页跨源访问。
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { openCredentialStore } from './credential-store.mjs';
import { BridgeError, cancelStream, createOAuthRuntime, digest, equalSecret, safeUpstreamCode } from './oauth-runtime.mjs';

export const BRIDGE_PORT = 18743;
const MAX_BODY = 2_000_000;
const EXTENSION_ORIGIN = /^(?:chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
const error = (code, message, status = 400) => new BridgeError(code, message, status);
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}
async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw error('invalid_content_type', '本机请求必须使用 JSON。', 415);
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw error('request_too_large', '请求内容过大。', 413);
    chunks.push(chunk);
  }
  let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw error('invalid_json', '请求 JSON 无效。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('invalid_json', '请求体必须是 JSON 对象。');
  return value;
}
function validateTools(tools) {
  if (!Array.isArray(tools) || tools.length > 100) throw error('invalid_tools', '只支持本地 function/custom 工具。');
  for (const group of tools) {
    if (!group || group.type !== 'namespace' || typeof group.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(group.name)
      || !Array.isArray(group.tools) || group.tools.length > 100 || Object.keys(group).some((key) => !['type', 'name', 'description', 'tools'].includes(key))) throw error('invalid_tools', '本地工具必须放入 namespace。');
    for (const tool of group.tools) {
      const allowed = tool?.type === 'function' ? ['type', 'name', 'description', 'parameters', 'strict'] : tool?.type === 'custom' ? ['type', 'name', 'description', 'format'] : [];
      if (!allowed.length || typeof tool.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(tool.name)
        || Object.keys(tool).some((key) => !allowed.includes(key))) throw error('invalid_tools', '拒绝托管工具或未知工具字段。');
    }
  }
}
export function validateResponseRequest(body) {
  if (Object.keys(body).some((key) => !['model', 'input', 'instructions', 'tools', 'parallel_tool_calls'].includes(key))) throw error('unsupported_parameter', 'ChatGPT 套餐请求包含不支持的参数。');
  if (typeof body.model !== 'string' || !body.model || body.model.length > 200 || !Array.isArray(body.input) || !body.input.length
    || body.input.length > 1000 || (body.instructions !== undefined && typeof body.instructions !== 'string')
    || (body.parallel_tool_calls !== undefined && typeof body.parallel_tool_calls !== 'boolean')) throw error('invalid_request', '模型或输入格式无效。');
  if (body.tools !== undefined) validateTools(body.tools);
  for (const item of body.input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw error('invalid_input', '输入项无效。');
    if (item.type === 'additional_tools') { validateTools(item.tools); continue; }
    if (['function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output', 'reasoning', 'item_reference'].includes(item.type)) continue;
    if (item.type !== undefined && item.type !== 'message') throw error('invalid_input', '输入项类型不支持。');
    if (!['user', 'assistant', 'developer'].includes(item.role) || !(typeof item.content === 'string' || Array.isArray(item.content))) throw error('invalid_input', '只接受用户、开发者或助手消息。');
  }
  return { ...body, stream: true, store: false };
}

async function streamResponse(upstream, response, signal) {
  if (!upstream.body || !upstream.headers.get('content-type')?.includes('text/event-stream')) {
    cancelStream(upstream.body);
    throw error('invalid_stream', 'OpenAI 未返回事件流。', 502);
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' });
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = ''; let terminal = false;
  async function forward(frame) {
    const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let value; try { value = JSON.parse(data); } catch { throw error('invalid_stream', 'OpenAI 事件流格式无效。', 502); }
    const type = value.type;
    if (['response.failed', 'response.incomplete', 'error'].includes(type)) {
      terminal = true;
      const code = safeUpstreamCode(value.response?.error?.code || value.code || value.error?.code || (type === 'response.incomplete' ? 'response_incomplete' : 'response_failed'));
      value = type === 'response.failed' ? { type, response: { status: 'failed', error: { code, message: 'ChatGPT 请求未完成，请管理套餐用量或重试。' } } }
        : type === 'response.incomplete' ? { type, code, response: { status: 'incomplete' } }
        : { type: 'error', code, message: 'ChatGPT 请求未完成，请管理套餐用量或重试。' };
    } else if (type === 'response.completed') terminal = true;
    if (!response.write(`event: ${typeof type === 'string' && /^[a-zA-Z0-9_.-]+$/.test(type) ? type : 'message'}\ndata: ${JSON.stringify(value)}\n\n`)) await once(response, 'drain', { signal });
  }
  try {
    while (!terminal) {
      if (signal.aborted) throw signal.reason;
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end;
      while (!terminal && (end = buffer.indexOf('\n\n')) !== -1) { const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2); await forward(frame); }
      if (buffer.length > MAX_BODY) throw error('invalid_stream', 'OpenAI 事件过大。', 502);
      if (done) break;
    }
    if (!terminal) throw error('stream_incomplete', 'ChatGPT 事件流提前结束，请重试。', 502);
  } finally { cancelStream(reader); reader.releaseLock(); }
  response.end();
}

/** fetchImpl、now 和 testOrigins 只供离线测试注入；CLI 不暴露 OpenAI 端点配置。 */
export async function createChatGPTPlanBridge({ directory, port = BRIDGE_PORT, fetchImpl, now = Date.now, testOrigins = [], logoutBudgetMs = 8_000 }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('INVALID_PORT');
  if (testOrigins.some((origin) => !/^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]+$/.test(origin))) throw new Error('INVALID_TEST_ORIGIN');
  if (!Number.isInteger(logoutBudgetMs) || logoutBudgetMs < 1 || logoutBudgetMs > 8_000) throw new Error('INVALID_LOGOUT_BUDGET');
  const store = await openCredentialStore(directory);
  let runtime;
  try { runtime = createOAuthRuntime({ store, initial: await store.read(), fetchImpl, now, logoutBudgetMs }); await runtime.initialize(); }
  catch (failure) { await store.close(); throw failure; }
  let pairing = null;
  let closing = false;
  let boundPort;
  const originAllowed = (origin) => typeof origin === 'string' && (EXTENSION_ORIGIN.test(origin) || testOrigins.includes(origin));
  function issuePairCode() {
    const code = randomBytes(24).toString('hex').match(/.{8}/g).join('-');
    pairing = { hash: digest(code), expiresAt: now() + 5 * 60_000, attempts: 0 };
    return code;
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (closing || request.socket.remoteAddress !== '127.0.0.1' || request.headers.host !== `127.0.0.1:${boundPort}`
        || request.headers['forwarded'] || request.headers['x-forwarded-host']) throw error('invalid_host', '拒绝非本机请求。', 403);
      const url = new URL(request.url, `http://127.0.0.1:${boundPort}`);
      if (url.origin !== `http://127.0.0.1:${boundPort}`) throw error('invalid_host', '请求地址无效。', 403);
      if (url.pathname === '/auth/callback' && request.method === 'GET') {
        if (request.headers.origin && request.headers.origin !== 'https://auth.openai.com') throw error('invalid_origin', '回调来源无效。', 403);
        // 回调参数绝不回显，页面没有脚本，也不向外部网站继续跳转。
        await runtime.callback(url.searchParams);
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('ChatGPT 已连接。请返回 FluentRead 设置页面。'); return;
      }
      const origin = request.headers.origin;
      if (!originAllowed(origin)) {
        if (url.pathname === '/health' && request.method === 'GET' && origin === undefined) { json(response, 200, { name: 'fluentread-chatgpt-plan', version: 1 }); return; }
        throw error('invalid_origin', '仅允许扩展访问本机助手。', 403);
      }
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      if (request.method === 'OPTIONS') {
        const method = request.headers['access-control-request-method'];
        const headers = (request.headers['access-control-request-headers'] || '').toLowerCase().split(',').map((item) => item.trim()).filter(Boolean);
        if (!['GET', 'POST'].includes(method) || headers.some((item) => !['authorization', 'content-type'].includes(item))) throw error('invalid_preflight', '预检请求无效。', 403);
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        response.setHeader('Access-Control-Allow-Private-Network', 'true');
        response.writeHead(204); response.end(); return;
      }
      if (!['GET', 'POST'].includes(request.method)) throw error('invalid_method', '请求方法不支持。', 405);
      const body = request.method === 'POST' ? await readJson(request) : {};
      if (url.pathname === '/health') { json(response, 200, { name: 'fluentread-chatgpt-plan', version: 1 }); return; }
      if (url.pathname === '/pair' && request.method === 'POST') {
        if (!pairing || now() >= pairing.expiresAt || pairing.attempts >= 10) throw error('pairing_expired', '配对码已失效，请在本机助手终端生成新码。', 403);
        pairing.attempts++;
        if (Object.keys(body).some((key) => key !== 'code') || typeof body.code !== 'string' || !equalSecret(digest(body.code), pairing.hash)) throw error('invalid_pairing_code', '配对码无效。', 403);
        pairing = null; // 在异步保存前消费，防止并发重放。
        const bridgeToken = randomBytes(32).toString('base64url');
        const existing = runtime.getRecord().pairs.filter((entry) => entry.origin !== origin);
        await runtime.savePairs([...existing.slice(-7), { origin, tokenHash: digest(bridgeToken), createdAt: now() }]);
        json(response, 200, { bridgeToken }); return;
      }
      const bearer = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(request.headers.authorization || '')?.[1];
      const pair = bearer && runtime.getRecord().pairs.find((entry) => entry.origin === origin && equalSecret(digest(bearer), entry.tokenHash));
      if (!pair) throw error('pairing_required', '请先配对 FluentRead 与本机助手。', 401);
      if (url.pathname === '/status') { json(response, 200, runtime.status()); return; }
      if (url.pathname === '/auth/start' && request.method === 'POST') {
        if (Object.keys(body).some((key) => key !== 'newAccount') || (body.newAccount !== undefined && typeof body.newAccount !== 'boolean')) throw error('invalid_request', '登录参数无效。');
        json(response, 200, { authorizationUrl: await runtime.startAuth(`http://127.0.0.1:${boundPort}/auth/callback`, body.newAccount) }); return;
      }
      if (url.pathname === '/auth/cancel' && request.method === 'POST') { runtime.cancelAuth(); json(response, 200, runtime.status()); return; }
      if (url.pathname === '/logout' && request.method === 'POST') { json(response, 200, await runtime.logout()); return; }
      if (url.pathname === '/unpair' && request.method === 'POST') { await runtime.savePairs(runtime.getRecord().pairs.filter((entry) => entry !== pair)); json(response, 200, { paired: false }); return; }
      if (url.pathname === '/models') {
        const controller = new AbortController(); const abort = () => { if (!response.writableEnded) controller.abort(); }; response.on('close', abort);
        const operation = await runtime.api('models', { signal: controller.signal });
        try {
          const data = await operation.response.json();
          if (!Array.isArray(data.models)) throw error('invalid_models', 'OpenAI 模型目录无效。', 502);
          const models = data.models.filter((model) => model.visibility === 'list' && typeof model.slug === 'string' && typeof model.display_name === 'string')
            .map(({ slug, display_name }) => ({ slug, display_name }));
          json(response, 200, { models });
        } finally { operation.release(); response.removeListener('close', abort); }
        return;
      }
      if (url.pathname === '/responses' && request.method === 'POST') {
        const payload = validateResponseRequest(body);
        const controller = new AbortController(); const abort = () => { if (!response.writableEnded) controller.abort(); }; response.on('close', abort);
        const operation = await runtime.api('responses', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        try { await streamResponse(operation.response, response, operation.signal); }
        finally { operation.release(); response.removeListener('close', abort); }
        return;
      }
      throw error('not_found', '本机端点不存在。', 404);
    } catch (failure) {
      if (response.destroyed || response.writableEnded) return;
      const safe = failure instanceof BridgeError ? failure : error('request_failed', '本机请求未完成，请重试。', 502);
      if (response.headersSent) { response.end(`event: error\ndata: ${JSON.stringify({ type: 'error', code: safe.code, message: safe.message })}\n\n`); }
      else json(response, safe.status, { error: { code: safe.code, message: safe.message } });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }).catch(async (failure) => { await store.close(); throw failure; });
  boundPort = server.address().port;
  return { port: boundPort, url: `http://127.0.0.1:${boundPort}`, issuePairCode,
    async close() { closing = true; runtime.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await store.close(); } };
}
