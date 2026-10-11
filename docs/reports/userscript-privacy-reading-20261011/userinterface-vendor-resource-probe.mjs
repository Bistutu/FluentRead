import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const base = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(base, '../FluentRead-pr906-main-merge-20261010');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const input = fs.readFileSync(path.join(repo, 'userscript/resources/fluentread-vendor.v1.js'));
let networkCalls = 0, databaseCalls = 0;
const context = vm.createContext({TextEncoder, TextDecoder, URL, URLSearchParams, AbortController, AbortSignal,
  ReadableStream, WritableStream, TransformStream, Headers, Request, Response, Uint8Array, ArrayBuffer,
  atob, btoa, setTimeout, clearTimeout, queueMicrotask, structuredClone, crypto: crypto.webcrypto,
  fetch: () => {networkCalls++; throw new Error('Synthetic probe forbids network');},
  indexedDB: {open() {databaseCalls++; throw new Error('Synthetic probe forbids database');}},
  console: {warn() {}, error() {}, log() {}}});
vm.runInContext(input.toString(), context);
const vendor = context.FluentReadUserscriptVendor;
for (const [owner, symbol] of [['ai','streamText'], ['ai','tool'], ['ai','generateText'],
  ['anthropic','createAnthropic'], ['google','createGoogleGenerativeAI'], ['openAICompatible','createOpenAICompatible']]) {
  assert.equal(typeof vendor[owner][symbol], 'function', `${owner}.${symbol}`);
}
const schema = vendor.zod.z.object({reason: vendor.zod.z.string().max(200).optional()}).strict();
assert.equal(schema.safeParse({reason: 'synthetic'}).success, true);
assert.equal(schema.safeParse({extra: 'forbidden'}).success, false);
assert.equal(vendor.ai.tool({description: 'synthetic', inputSchema: schema}).inputSchema, schema);
assert.equal(vendor.anthropic.createAnthropic({apiKey: 'synthetic-only'})('fixture').modelId, 'fixture');
assert.equal(vendor.google.createGoogleGenerativeAI({apiKey: 'synthetic-only'})('fixture').modelId, 'fixture');
const model = {specificationVersion: 'v3', provider: 'synthetic', modelId: 'fixture', supportedUrls: {},
  doStream: async () => ({stream: new ReadableStream({start(controller) {
    for (const part of [{type: 'stream-start', warnings: []}, {type: 'text-start', id: 'text'},
      {type: 'text-delta', id: 'text', delta: 'synthetic answer'}, {type: 'text-end', id: 'text'},
      {type: 'finish', finishReason: {unified: 'stop', raw: 'stop'}, usage: {
        inputTokens: {total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0},
        outputTokens: {total: 1, text: 1, reasoning: 0}}}]) controller.enqueue(part);
    controller.close();
  }}), request: {}, response: {}})};
const result = vendor.ai.streamText({model, prompt: 'synthetic fixture', maxRetries: 0});
let answer = '';
for await (const part of result.fullStream) {
  if (part.type === 'text-delta') answer += part.text;
  if (part.type === 'error') throw part.error;
}
assert.equal(answer, 'synthetic answer');
assert.equal(networkCalls, 0); assert.equal(databaseCalls, 0);
const beforeContext = vm.createContext({}), afterContext = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(base, 'userinterface-before-data.js'), 'utf8'), beforeContext);
const dataBytes = fs.readFileSync(path.join(repo, 'userscript/resources/fluentread-data.v1.js'));
vm.runInContext(dataBytes.toString(), afterContext);
const before = beforeContext.__FLUENTREAD_USERSCRIPT_DATA__, after = afterContext.__FLUENTREAD_USERSCRIPT_DATA__;
const changed = [];
function compare(a, b, name) {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[key], b[key], `${name}.${key}`);
  } else if (a !== b) changed.push({path: name, beforeType: typeof a, afterType: typeof b,
    beforeBytes: typeof a === 'string' ? Buffer.byteLength(a) : null,
    afterBytes: typeof b === 'string' ? Buffer.byteLength(b) : null,
    beforeSha256: sha(JSON.stringify(a) ?? 'undefined'), afterSha256: sha(JSON.stringify(b) ?? 'undefined')});
}
compare(before, after, 'data');
const receipt = {scope: 'Actual fixed vendor VM synthetic SDK/model probe; no manager/browser/provider I/O proof',
  UTC: new Date().toISOString(), vendor: {bytes: input.length, sha256: sha(input)},
  data: {bytes: dataBytes.length, sha256: sha(dataBytes)},
  functionsAndSchemaPassed: true, actualSdkSyntheticStreamPassed: true, networkCalls, databaseCalls,
  dataChangedLeaves: changed, helperSha256: sha(fs.readFileSync(new URL(import.meta.url)))};
fs.writeFileSync(path.join(base, 'USERINTERFACE-FIXED-RESOURCE-PROBE.json'), JSON.stringify(receipt, null, 2)+'\n');
console.log(JSON.stringify(receipt));
