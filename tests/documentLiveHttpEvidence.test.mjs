/**
 * @file tests/documentLiveHttpEvidence.test.mjs
 * 文件职责：离线验证真实文档验收的 HTTP 端点解码证据，防止背景数组、重复槽去重或不完整供应商响应被称为完成合批。
 * 主要内容：使用 owning Microsoft/Google 测试同形协议夹具覆盖三种 Google 入口、RPC 乱序编号/XSSI、重复与缺槽、Unicode 原样、单文本和序列化单文本，以及 driver 的五秒正文观察接口。
 * 模块边界：node:test 纯端口解析单位证据，不创建浏览器、原生观察器或网络，不证明普通文档翻译或语义质量。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {decodeHttpTranslationRequest: decodeRequest, decodeHttpTranslationResponse: decodeResponse, summarizeHttpEvidence} = require('../scripts/testing/document-live-http-evidence.cjs');
const {createResponseBodyObserver, shouldObserveResponseBody} = require('../scripts/testing/run-document-live-translation.cjs');
const MS = 'https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans';
const HTML = 'https://translate-pa.googleapis.com/v1/translateHtml';
const LIST = 'https://translate.googleapis.com/translate_a/t?client=gtx&sl=en&tl=zh-CN&dt=t';
const RPC = 'https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?rpcids=MkEWBc';
const request = (url, postData, method = 'POST') => decodeRequest({url, method, postData});
const rpcRequest = texts => request(RPC, new URLSearchParams({'f.req': JSON.stringify([texts.map((text, index) => ['MkEWBc', JSON.stringify([[text, 'en', 'zh-CN', true], [null]]), null, String(index)])])}).toString());
// 与 tests/google.test.ts rpcResponse 的真实 owning parser 形状一致，不是另造供应商响应协议。
const rpcRow = (id, pieces) => ['wrb.fr', 'MkEWBc', JSON.stringify([null, [[[null, null, null, null, null, pieces.map(text => [text])]]]]), null, null, null, id];
const rpcBody = rows => `)]}'\n\n120\n${JSON.stringify(rows)}`;
const packet = '___FLUENTREAD_abcd_0_BEGIN___First___FLUENTREAD_abcd_0_END___\n___FLUENTREAD_abcd_1_BEGIN___Second___FLUENTREAD_abcd_1_END___';

test('Microsoft 实际 string[] 保留重复与顺序，不接受其他数组样式', () => {
  const decoded = request(MS, JSON.stringify(['Repeated', 'Repeated', 'e\u0301𝒱\ufe00']));
  assert.equal(decoded.classification, 'nativeMultiSlot');
  assert.deepEqual(decoded.slots, [{id: '0', text: 'Repeated'}, {id: '1', text: 'Repeated'}, {id: '2', text: 'e\u0301𝒱\ufe00'}]);
  for (const value of [[], [{Text: 'not this endpoint contract'}], ['First', 42], {texts: ['First', 'Second']}]) assert.equal(request(MS, JSON.stringify(value)).classification, 'unknown');
  assert.equal(request(MS, '[]', 'GET').classification, 'unknown');
});

test('Microsoft 完整重复译槽独立保留，缺槽或一槽多个 translations 不算完成', () => {
  const req = request(MS, '["First","Second"]');
  const decoded = decodeResponse(req, [{translations: [{text: '&lt;b&gt;译文&lt;/b&gt; &amp;lt;'}]}, {translations: [{text: '重复'}]}]);
  assert.equal(decoded.complete, true); assert.deepEqual(decoded.slots.map(slot => slot.text), ['<b>译文</b> &lt;', '重复']);
  const repeated = decodeResponse(req, [{translations: [{text: '重复'}]}, {translations: [{text: '重复'}]}]);
  assert.equal(repeated.slots.length, 2); assert.deepEqual(repeated.slots.map(slot => slot.id), ['0', '1']);
  for (const response of [[{translations: [{text: '少槽'}]}], [{translations: [{text: '一'}, {text: '二'}]}, {translations: [{text: '三'}]}], [{translations: [{text: ''}]}, {translations: [{text: '二'}]}]]) {
    assert.deepEqual(decodeResponse(req, response).slots, []); assert.equal(decodeResponse(req, response).classification, 'unknown');
  }
});

test('Google translateHtml 按已知嵌套 wire 数组，不把 wt_lib 记为原文', () => {
  const req = request(HTML, JSON.stringify([[['<pre>First &amp; &lt;b&gt;</pre>', '<pre>First &amp; &lt;b&gt;</pre>'], 'en', 'zh-CN'], 'wt_lib']));
  assert.equal(req.classification, 'nativeMultiSlot'); assert.equal(req.slots.length, 2);
  assert.equal(req.slots[0].text, '<pre>First &amp; &lt;b&gt;</pre>');
  assert.equal(req.slots.some(slot => slot.text === 'wt_lib'), false);
  const decoded = decodeResponse(req, [['<pre>译文 &amp;lt; &#x1F642;</pre>', '<pre>e\u0301\n译文</pre>']]);
  assert.deepEqual(decoded.slots.map(slot => slot.text), ['译文 &lt; 🙂', 'e\u0301\n译文']);
  assert.equal(decodeResponse(req, [['仅一槽']]).complete, false);
  assert.equal(request(HTML, JSON.stringify([['First', 'Second'], 'wt_lib'])).classification, 'unknown');
});

test('Google repeated-q 保留每次出现，包括重复文本和空格/非 NFC 字符', () => {
  const body = new URLSearchParams(); for (const text of ['same', 'same', ' e\u0301\t𝒱\ufe00 ']) body.append('q', text);
  const req = request(LIST, body.toString());
  assert.equal(req.slots.length, 3); assert.deepEqual(req.slots.map(slot => slot.text), ['same', 'same', ' e\u0301\t𝒱\ufe00 ']);
  assert.deepEqual(decodeResponse(req, [['重复', 'en'], ['重复', 'en'], [' 译文 ', 'en']]).slots.map(slot => slot.text), ['重复', '重复', ' 译文 ']);
  assert.equal(decodeResponse(req, ['重复', '重复']).complete, false);
  assert.equal(request(LIST, 'notq=value').classification, 'unknown');
});

test('Google RPC f.req 按实际参数解码、按响应 id 还原乱序，不插入空格', () => {
  const req = rpcRequest(['First', 'First', '𝒱\ufe00 e\u0301']);
  assert.equal(req.classification, 'nativeMultiSlot'); assert.deepEqual(req.slots.map(slot => slot.id), ['0', '1', '2']);
  const body = rpcBody([rpcRow('2', ['𝒱\ufe00', 'e\u0301']), rpcRow('0', ['第一', '句']), rpcRow('1', ['第二句'])]);
  const decoded = decodeResponse(req, body);
  assert.equal(decoded.complete, true); assert.deepEqual(decoded.slots, [{id: '0', text: '第一句'}, {id: '1', text: '第二句'}, {id: '2', text: '𝒱\ufe00e\u0301'}]);
  assert.equal(rpcRequest(['scalar']).classification, 'scalar');
  assert.equal(request(RPC.replace('translate.google.com', 'translate.google.co.uk'), new URLSearchParams({'f.req': JSON.stringify([[['MkEWBc', JSON.stringify([['First', 'en', 'zh-CN', true], [null]]), null, '0']]])}).toString()).classification, 'scalar');
});

test('RPC 已知行缺失、重复、非数字、越界、损坏 payload 或非文本片段均拒绝完整合批', () => {
  const req = rpcRequest(['First', 'Second']);
  const brokenPayload = rpcRow('0', ['x']); brokenPayload[2] = '{broken';
  const nonText = rpcRow('0', ['x']); nonText[2] = JSON.stringify([null, [[[null, null, null, null, null, [[42]]]]]]);
  const values = [[], [rpcRow('0', ['一'])], [rpcRow('0', ['一']), rpcRow('0', ['二'])], [rpcRow('unexpected', ['一']), rpcRow('1', ['二'])], [rpcRow('2', ['一']), rpcRow('1', ['二'])], [brokenPayload, rpcRow('1', ['二'])], [nonText, rpcRow('1', ['二'])]];
  for (const rows of values) {const decoded = decodeResponse(req, rpcBody(rows)); assert.equal(decoded.complete, false); assert.equal(decoded.classification, 'unknown'); assert.deepEqual(decoded.slots, []);}
  assert.equal(decodeResponse(req, [rpcRow('0', ['一']), rpcRow('1', ['二'])]).complete, false);
});

test('RPC 忽略 XSSI 长度行与无关记录，但不能据无关行补足结果', () => {
  const req = rpcRequest(['First']);
  const decoded = decodeResponse(req, `)]}'\n\n100\nnot json\n[broken\n${JSON.stringify([['other'], ['wrb.fr', 'Other', '{}'], rpcRow('0', ['一', '二'])])}`);
  assert.equal(decoded.complete, true); assert.equal(decoded.slots[0].text, '一二');
  assert.equal(decodeResponse(req, rpcBody([['wrb.fr', 'Other', '{}']])).complete, false);
  const badRequest = new URLSearchParams({'f.req': JSON.stringify([[['MkEWBc', JSON.stringify([['First', 'en', 'zh-CN', true], [null]]), null, '2']]])}).toString();
  assert.equal(request(RPC, badRequest).classification, 'unknown');
  assert.equal(request(RPC.replace('rpcids=MkEWBc', 'rpcids=Other'), badRequest).classification, 'unknown');
});

test('序列化多段放在一个 HTTP 文本槽时只标 serializedSingle，不称原生多槽', () => {
  const req = request(MS, JSON.stringify([packet]));
  assert.equal(req.classification, 'serializedSingle'); assert.equal(req.slots.length, 1);
  assert.equal(decodeResponse(req, [{translations: [{text: '已返回单个序列化文本'}]}]).classification, 'serializedSingle');
  const html = request(HTML, JSON.stringify([[[`<pre>${packet}</pre>`], 'en', 'zh-CN'], 'wt_lib']));
  assert.equal(html.classification, 'serializedSingle'); assert.equal(html.slots[0].text, `<pre>${packet}</pre>`);
  assert.equal(request(MS, JSON.stringify(['literal ___FLUENTREAD_abcd_0_BEGIN___ fragment'])).classification, 'scalar');
});

test('非原生 scalar 中的片段数组不变成多槽 HTTP，未解码加密结果明确 unknown', () => {
  const req = request('https://transmart.qq.com/api/imt', JSON.stringify({source: {text_list: ['Only one']}}));
  assert.equal(req.classification, 'scalar'); assert.equal(req.slots.length, 1);
  assert.deepEqual(decodeResponse(req, {auto_translation: ['第一句', '第二句']}).slots, [{id: '0', text: '第一句第二句'}]);
  assert.equal(request('https://transmart.qq.com/api/imt', JSON.stringify({source: {text_list: ['First', 'Second']}})).classification, 'unknown');
  const encrypted = request('https://ifanyi.iciba.com/index.php?c=trans&m=fyV2', 'q=Only+one');
  assert.equal(encrypted.classification, 'scalar'); assert.equal(decodeResponse(encrypted, {content: 'ciphertext'}).complete, false);
  const volc = request('https://translate.volcengine.com/crx/translate/v1/', JSON.stringify({text: 'Only one'}));
  assert.deepEqual(decodeResponse(volc, {translation: '真实单槽'}).slots, [{id: '0', text: '真实单槽'}]);
});

test('背景数组、同域首页/认证 2xx、仿冒路径和非 HTTPS 都不能成为翻译端点合批', () => {
  for (const url of ['chrome-extension://owned/background', 'https://edge.microsoft.com/', 'https://translate.google.com/token', 'https://edge.microsoft.com/translate/translatetext-extra', 'https://edge.microsoft.com.attacker.example/translate/translatetext', 'http://edge.microsoft.com/translate/translatetext']) {
    const decoded = request(url, '["First","Second"]'); assert.equal(decoded.classification, 'unknown'); assert.equal(decoded.slots.length, 0);
  }
});

test('统计区分已观察的请求与完整 2xx 合批，保留 unknown 和不完整响应，不以同域2xx推断减少', () => {
  const multi = request(MS, '["First","Second"]'), scalar = request(MS, '["Only one"]'), serialized = request(MS, JSON.stringify([packet]));
  const good = decodeResponse(multi, [{translations: [{text: '重复'}]}, {translations: [{text: '重复'}]}]);
  const bad = decodeResponse(multi, [{translations: [{text: '少槽'}]}]);
  const records = [{status: 200, httpEvidence: {...multi, response: good}}, {status: 200, httpEvidence: {...multi, response: bad}},
    {status: 503, httpEvidence: {...multi, response: good}}, {status: 200, httpEvidence: {...scalar, response: decodeResponse(scalar, [{translations: [{text: '单槽'}]}])}},
    {status: 200, httpEvidence: {...serialized, response: decodeResponse(serialized, [{translations: [{text: '单个包'}]}])}}, {status: 200, httpEvidence: request('https://edge.microsoft.com/', '[]')}, {status: 200}];
  const summary = summarizeHttpEvidence(records);
  assert.deepEqual(summary.observed, {nativeMultiSlot: 3, scalar: 1, serializedSingle: 1, unknown: 2});
  assert.deepEqual(summary.complete2xx, {nativeMultiSlot: 1, scalar: 1, serializedSingle: 1, unknown: 0});
  assert.deepEqual(summary.responseClassified, {nativeMultiSlot: 2, scalar: 1, serializedSingle: 1, unknown: 3});
  assert.equal(summary.completeNativeMultiSlotSources, 2); assert.equal(summary.incompleteResponses, 1);
  assert.equal(summary.nonTranslation2xx, 2);
});

test('driver 观察器使用 RPC text 有界端口，不尝试 JSON 或保留帧标签；MS 重复译槽仍保留', async () => {
  const observer = createResponseBodyObserver({timeoutMs: 100}), req = rpcRequest(['First', 'Second']);
  const record = {httpEvidence: req}; let textReads = 0;
  await observer.observe({text: async () => {textReads++; return rpcBody([rpcRow('1', ['第二']), rpcRow('0', ['第一'])]);}, json: async () => {throw Error('RPC must use text');}}, record);
  assert.equal(textReads, 1); assert.equal(record.httpEvidence.response.complete, true);
  assert.deepEqual(record.translations.map(item => [item.slot, item.tail]), [['0', '第一'], ['1', '第二']]);
  const repeated = {httpEvidence: request(MS, '["A","A"]')};
  await observer.observe({json: async () => [{translations: [{text: '重复'}]}, {translations: [{text: '重复'}]}]}, repeated);
  assert.equal(repeated.translations.length, 2); assert.equal(repeated.translations[0].sha256, repeated.translations[1].sha256);
  assert.equal(shouldObserveResponseBody({providerCandidate: true, httpEvidence: req}, {url: () => RPC, headers: () => ({'content-type': 'text/plain'})}), true);
  assert.equal(shouldObserveResponseBody({providerCandidate: true}, {url: () => 'https://edge.microsoft.com/token', headers: () => ({'content-type': 'application/json'})}), false);
  await observer.drain(); assert.equal(observer.stats.active, 0);
});

test('新 RPC text 端口挂起也受同一正文截止约束，不会伪造完整响应', async () => {
  const observer = createResponseBodyObserver({timeoutMs: 5}), record = {httpEvidence: rpcRequest(['First', 'Second'])};
  await observer.observe({text: () => new Promise(() => {}), json: async () => {throw Error('not used');}}, record);
  await observer.drain();
  assert.equal(record.bodyObservation.state, 'timedOut'); assert.equal(record.bodyObservation.reason, 'body-deadline');
  assert.equal(record.translations, undefined); assert.equal(record.httpEvidence.response, undefined);
  assert.equal(summarizeHttpEvidence([{...record, status: 200}]).complete2xx.nativeMultiSlot, 0);
  assert.equal(observer.stats.active, 0);
});
