'use strict';

/**
 * @file scripts/testing/document-live-http-evidence.cjs
 * 文件职责：只按实际供应商 HTTP 格式提取真实文档验收的有序槽位证据，区分原生多槽、单文本、序列化单文本和未知请求。
 * 主要内容：核对 Microsoft string[]、Google translateHtml/repeated-q/RPC 三入口及固定单文本端点；RPC 剥离 XSSI 帧并按请求编号还原，拒绝缺失、重复或格式不全的结果。重复文字仍保留独立槽，不把背景消息数组或同域成功响应称为 HTTP 合批。
 * 模块边界：纯解析，不访问网络、浏览器、配置或凭据。供应商结构依据本仓库 microsoftTransport.ts、google.ts 与免费 provider 的 owning parser；不做 Unicode 归一、译意评分或请求重试。调用者只持久化 hash、长度与有限尾部。
 */
const RPC = 'MkEWBc';
const CLASSES = ['nativeMultiSlot', 'scalar', 'serializedSingle', 'unknown'];
const scalarEndpoints = new Map([
  ['transmart.qq.com/api/imt', 'transmart'],
  ['translate.yandex.net/api/v1/tr.json/translate', 'yandex'],
  ['translate.volcengine.com/crx/translate/v1/', 'volcengine'],
  ['dict.youdao.com/jsonapi_s', 'youdao'],
  ['ifanyi.iciba.com/index.php', 'iciba'],
  ['api.mymemory.translated.net/get', 'mymemory'],
  ['api.reverso.net/translate/v1/translation', 'reverso'],
  ['apertium.org/apy/translate', 'apertium'],
  ['translate.alibaba.com/api/translate/text', 'alibaba'],
  ['webapi.modernmt.com/translate', 'modernmt'],
  ['webapi.laratranslate.com/translate/segmented', 'lara'],
  ['api-b2b.backenster.com/b1/api/v3/translate', 'lingvanex'],
]);
const strings = value => Array.isArray(value) && value.length > 0 && value.every(text => typeof text === 'string');
const unknown = (endpoint = null, reason = 'unrecognized-endpoint') => ({endpoint, classification: 'unknown', slots: [], reason});
const parseJson = value => {try {return JSON.parse(value);} catch {return null;}};

function serialized(text) {
  const nonce = /^___FLUENTREAD_([a-z0-9_-]+?)_0_BEGIN___/iu.exec(text)?.[1];
  if (!nonce) return false;
  const markers = [...text.matchAll(new RegExp(`___FLUENTREAD_${nonce}_(0|[1-9]\\d*)_(BEGIN|END)___`, 'gu'))];
  return markers.length >= 2 && markers.length % 2 === 0
    && markers.every((match, index) => Number(match[1]) === Math.floor(index / 2) && match[2] === (index % 2 ? 'END' : 'BEGIN'))
    && text.endsWith(markers.at(-1)[0]);
}
function decodedRequest(endpoint, texts, ids = texts.map((_, index) => String(index))) {
  const framedSingle = endpoint === 'google-html' && texts.length === 1 ? texts[0].slice('<pre>'.length, -'</pre>'.length) : texts[0];
  return {endpoint, classification: texts.length > 1 ? 'nativeMultiSlot' : serialized(framedSingle) ? 'serializedSingle' : 'scalar',
    slots: texts.map((text, index) => ({id: ids[index], text}))};
}

function decodeHttpTranslationRequest({url: rawUrl, method = 'GET', postData = null}) {
  let url; try {url = new URL(rawUrl);} catch {return unknown(null, 'invalid-url');}
  if (url.protocol !== 'https:') return unknown(null, 'not-upstream-https');
  const key = url.hostname + url.pathname, body = parseJson(postData), form = new URLSearchParams(postData || '');
  if (key === 'edge.microsoft.com/translate/translatetext') {
    return method === 'POST' && strings(body) ? decodedRequest('microsoft', body) : unknown('microsoft', 'invalid-string-array');
  }
  if (key === 'translate-pa.googleapis.com/v1/translateHtml') {
    const texts = body?.[0]?.[0];
    return method === 'POST' && Array.isArray(body) && body.length === 2 && body[1] === 'wt_lib'
      && Array.isArray(body[0]) && body[0].length === 3 && typeof body[0][1] === 'string' && typeof body[0][2] === 'string'
      && strings(texts) && texts.every(text => /^<pre>[\s\S]*<\/pre>$/u.test(text))
      ? decodedRequest('google-html', texts) : unknown('google-html', 'invalid-html-array');
  }
  if (key === 'translate.googleapis.com/translate_a/t') {
    const texts = form.getAll('q');
    return method === 'POST' && strings(texts) ? decodedRequest('google-list', texts) : unknown('google-list', 'invalid-repeated-q');
  }
  if (['translate.google.com', 'translate.google.co.uk'].includes(url.hostname) && url.pathname === '/_/TranslateWebserverUi/data/batchexecute') {
    const envelope = parseJson(form.get('f.req')), rows = envelope?.[0];
    if (method !== 'POST' || url.searchParams.get('rpcids') !== RPC || !Array.isArray(envelope) || envelope.length !== 1 || !Array.isArray(rows) || !rows.length) return unknown('google-rpc', 'invalid-rpc-envelope');
    const texts = [], ids = [];
    for (const [index, row] of rows.entries()) {
      const payload = Array.isArray(row) ? parseJson(row[1]) : null, source = payload?.[0];
      if (!Array.isArray(row) || row.length !== 4 || row[0] !== RPC || row[2] !== null || row[3] !== String(index)
        || !Array.isArray(payload) || payload.length !== 2 || !Array.isArray(source) || source.length !== 4
        || typeof source[0] !== 'string' || typeof source[1] !== 'string' || typeof source[2] !== 'string' || source[3] !== true
        || !Array.isArray(payload[1]) || payload[1].length !== 1 || payload[1][0] !== null) return unknown('google-rpc', 'invalid-rpc-slot');
      texts.push(source[0]); ids.push(row[3]);
    }
    return decodedRequest('google-rpc', texts, ids);
  }
  const endpoint = scalarEndpoints.get(key)
    || (url.hostname === 'index-translate.bilibili.com' && url.pathname === '/v1/chat/completions' ? 'bilibili' : null);
  if (!endpoint) return unknown();
  if (method !== (['yandex', 'mymemory', 'apertium'].includes(endpoint) ? endpoint === 'yandex' ? 'POST' : 'GET' : 'POST')) return unknown(endpoint, 'invalid-method');
  let text;
  if (endpoint === 'transmart') text = strings(body?.source?.text_list) && body.source.text_list.length === 1 ? body.source.text_list[0] : undefined;
  else if (endpoint === 'reverso') text = body?.input;
  else if (['volcengine', 'lingvanex'].includes(endpoint)) text = body?.text;
  else if (['modernmt', 'lara'].includes(endpoint)) text = body?.q;
  else if (['mymemory', 'apertium'].includes(endpoint)) {const values = url.searchParams.getAll('q'); if (values.length === 1) text = values[0];}
  else if (endpoint === 'yandex') {const values = url.searchParams.getAll('text'); if (values.length === 1) text = values[0];}
  else if (['youdao', 'iciba'].includes(endpoint)) {const values = form.getAll('q'); if (values.length === 1) text = values[0];}
  else if (endpoint === 'alibaba') text = /name="query"\r\n\r\n([\s\S]*?)\r\n--/u.exec(postData || '')?.[1];
  else if (endpoint === 'bilibili' && Array.isArray(body?.messages) && body.messages.length === 1 && body.messages[0]?.role === 'user') text = body.messages[0].content;
  return typeof text === 'string' ? decodedRequest(endpoint, [text]) : unknown(endpoint, 'invalid-scalar-source');
}

function decodeGoogleEntities(text) {
  const entities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0'};
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
    if (!code.startsWith('#')) return entities[code.toLowerCase()];
    const value = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : entity;
  });
}
const decodeMicrosoftEntities = text => text.replace(/&#(?:0*39);|&#x0*27;/gi, "'").replace(/&quot;/gi, '"').replace(/&gt;/gi, '>').replace(/&lt;/gi, '<').replace(/&amp;/gi, '&');

function decodeHttpTranslationResponse(request, value) {
  const fail = reason => ({complete: false, classification: 'unknown', slots: [], reason});
  if (!request?.endpoint || request.classification === 'unknown' || !request.slots?.length) return fail('unrecognized-request');
  let texts;
  if (request.endpoint === 'microsoft') {
    if (!Array.isArray(value) || value.some(item => !Array.isArray(item?.translations) || item.translations.length !== 1 || typeof item.translations[0]?.text !== 'string')) return fail('invalid-microsoft-response');
    texts = value.map(item => decodeMicrosoftEntities(item.translations[0].text));
  } else if (request.endpoint === 'google-html') {
    const values = value?.[0];
    if (!Array.isArray(value) || !strings(values)) return fail('invalid-google-html-response');
    texts = values.map(text => decodeGoogleEntities(text.replace(/^<pre(?:\s[^>]*)?>([\s\S]*)<\/pre>$/i, '$1')));
  } else if (request.endpoint === 'google-list') {
    if (!Array.isArray(value)) return fail('invalid-google-list-response');
    texts = value.map(item => Array.isArray(item) ? item[0] : item);
  } else if (request.endpoint === 'google-rpc') {
    if (typeof value !== 'string') return fail('invalid-rpc-body');
    const byId = new Map(), expected = new Set(request.slots.map(slot => slot.id));
    for (const line of value.replace(/^\)\]\}'(?:\r?\n)?/, '').split(/\r?\n/)) {
      if (!line.trim().startsWith('[')) continue;
      const rows = parseJson(line); if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!Array.isArray(row) || row[0] !== 'wrb.fr' || row[1] !== RPC) continue;
        const id = row[6], payload = typeof row[2] === 'string' ? parseJson(row[2]) : null;
        const segments = payload?.[1]?.[0]?.[0]?.[5];
        if (typeof id !== 'string' || !/^(0|[1-9]\d*)$/u.test(id) || !expected.has(id) || byId.has(id)
          || !Array.isArray(segments) || !segments.length || segments.some(segment => !Array.isArray(segment) || typeof segment[0] !== 'string')) return fail('invalid-rpc-slot');
        byId.set(id, segments.map(segment => segment[0]).join(''));
      }
    }
    if (byId.size !== expected.size) return fail('incomplete-rpc-slots');
    texts = request.slots.map(slot => byId.get(slot.id));
  } else {
    let text;
    if (request.endpoint === 'transmart') text = strings(value?.auto_translation) ? value.auto_translation.join('') : undefined;
    else if (request.endpoint === 'yandex') text = strings(value?.text) ? value.text.join('') : undefined;
    else if (request.endpoint === 'volcengine') text = value?.translation;
    else if (request.endpoint === 'youdao') text = value?.fanyi?.tran;
    else if (request.endpoint === 'mymemory' || request.endpoint === 'apertium') text = value?.responseData?.translatedText;
    else if (request.endpoint === 'reverso') text = strings(value?.translation) ? value.translation.join('') : undefined;
    else if (request.endpoint === 'alibaba') text = value?.data?.translateText;
    else if (request.endpoint === 'modernmt') text = value?.data?.translation;
    else if (request.endpoint === 'lara') text = Array.isArray(value?.content?.translations) && value.content.translations.every(item => typeof item?.translation === 'string') ? value.content.translations.map(item => item.translation).join('') : undefined;
    else if (request.endpoint === 'lingvanex') text = value?.result;
    else if (request.endpoint === 'bilibili') text = value?.choices?.[0]?.finish_reason !== 'length' ? value?.choices?.[0]?.message?.content : undefined;
    // 金山词霸加密正文未由本工具解密，保持 unknown，不猜测完整译文或称其截断。
    else if (request.endpoint === 'iciba') return fail('response-format-not-decoded');
    texts = [text];
  }
  if (!strings(texts) || texts.length !== request.slots.length || texts.some(text => !text.trim())) return fail('incomplete-response-slots');
  return {complete: true, classification: request.classification, slots: texts.map((text, index) => ({id: request.slots[index].id, text}))};
}

function summarizeHttpEvidence(records) {
  const observed = Object.fromEntries(CLASSES.map(key => [key, 0])), responseClassified = {...observed}, complete2xx = {...observed};
  let completeNativeMultiSlotSources = 0, incompleteResponses = 0, nonTranslation2xx = 0;
  for (const record of records) {
    const evidence = record.httpEvidence, kind = evidence?.classification || 'unknown';
    observed[kind]++;
    responseClassified[evidence?.response?.classification || 'unknown']++;
    if (!evidence?.endpoint && record.status >= 200 && record.status < 300) nonTranslation2xx++;
    if (evidence?.response?.complete && record.status >= 200 && record.status < 300) {
      complete2xx[evidence.response.classification]++;
      if (kind === 'nativeMultiSlot') completeNativeMultiSlotSources += evidence.slots.length;
    } else if (evidence?.response && !evidence.response.complete) incompleteResponses++;
  }
  return {observed, responseClassified, complete2xx, completeNativeMultiSlotSources, incompleteResponses, nonTranslation2xx,
    boundary: 'Classified HTTP wire slots only; completion is structural, not a winning-provider, ownership or translation-quality claim.'};
}

module.exports = {decodeHttpTranslationRequest, decodeHttpTranslationResponse, summarizeHttpEvidence};
