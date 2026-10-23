'use strict';

// 只替换本次临时扩展 worker 的微软传输层；网页始终从真实站点加载。
// 用于稳定复现 DOM 生命周期，不提供供应商可用性、质量或时延证据。
// 此函数必须可独立序列化到 service worker；同一编解码器也供 Node 侧归属断言使用。
// UTF-8 每字节映射到 U+4E00…U+4EFF，输出逐字节绑定源文，而不是附加汉字掩盖原文回显。
// 这是测试占位文本，不是可读翻译；空白、行内槽、HTML 和实体保持传输协议原样。
function controlledProviderRuntime(installTransport = false) {
  const prefix = '测试译文：';
  const protocol = 'utf8-han-v1';
  const protectedToken = /__FRTERM_[a-z0-9_]+?__|___FLUENTREAD_(?:(?!___)[a-z0-9_-])+?_(?:0|[1-9]\d*)_(?:BEGIN|END)___|&lt;\/?[a-z][\s\S]*?&gt;|<\/?[a-z][^>]*>|&amp;(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);|&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);|\s+/giu;
  function encode(text) {
    if (typeof text !== 'string') throw new TypeError('Controlled translation requires a string');
    if (!text.trim()) return text;
    const encoder = new TextEncoder();
    const encodeText = value => Array.from(encoder.encode(value), byte => String.fromCharCode(0x4e00 + byte)).join('');
    let translated = '', cursor = 0;
    for (const match of text.matchAll(protectedToken)) {
      translated += encodeText(text.slice(cursor, match.index)) + match[0];
      cursor = match.index + match[0].length;
    }
    return prefix + translated + encodeText(text.slice(cursor));
  }
  function decodeText(text) {
    // 页面可合并多个逐槽响应，所有槽都必须被还原并参与完整原文比较。
    if (typeof text !== 'string' || !text.includes(prefix)) return null;
    const body = text.replaceAll(prefix, '');
    if (!/[\u4e00-\u4eff]/u.test(body)) return null;
    let decoded = '', cursor = 0;
    const decoder = new TextDecoder('utf-8', {fatal: true});
    for (const match of body.matchAll(/[\u4e00-\u4eff]+/gu)) {
      const literal = body.slice(cursor, match.index);
      // DOM 已解码的五种 HTML 字符可保留；普通字词不能冒充编码后的正文。
      if (/\p{L}/u.test(literal.replace(/&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/giu, ''))) return null;
      try {
        decoded += literal + decoder.decode(Uint8Array.from(match[0], char => char.charCodeAt(0) - 0x4e00));
      } catch {return null;}
      cursor = match.index + match[0].length;
    }
    const literal = body.slice(cursor);
    if (/\p{L}/u.test(literal.replace(/&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/giu, ''))) return null;
    return decoded + literal;
  }
  if (!installTransport) return {encode, decodeText};
  if (globalThis.__frCompatibilityTransport) {
    if (globalThis.__frCompatibilityTransport.protocol !== protocol) throw new Error('Controlled transport protocol changed in an existing worker');
    return;
  }
  const originalFetch = globalThis.fetch;
  const state = {protocol, requests: 0, texts: 0, active: 0};
  globalThis.__frCompatibilityTransport = state;
  globalThis.fetch = async (input, init) => {
    const address = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (address.hostname !== 'edge.microsoft.com' || address.pathname !== '/translate/translatetext') return originalFetch(input, init);
    state.requests += 1;
    state.active += 1;
    try {
      const texts = JSON.parse(init?.body ?? await input.text());
      if (!Array.isArray(texts) || texts.some(text => typeof text !== 'string')) throw new TypeError('Controlled translation requires a text array');
      const response = new Response(JSON.stringify(texts.map(text => ({translations: [{text: encode(text)}]}))),
        {status: 200, headers: {'content-type': 'application/json'}});
      state.texts += texts.length;
      return response;
    } finally {state.active -= 1;}
  };
}

const {encode: encodeControlledTranslation, decodeText: decodeControlledTranslationText} = controlledProviderRuntime();

function isControlledTranslationForSource(output, source, sourceParts = [source]) {
  const decoded = decodeControlledTranslationText(output);
  if (decoded === null) return false;
  const normalize = text => text.replace(/\s+/gu, ' ').trim();
  return [source, sourceParts.join(''), sourceParts.join(' ')].some(input => normalize(input) === normalize(decoded));
}

// 页面证据只投影实际 DOM。保护子树通过原标签/文本/href 与译文骨架配对，
// 不能把未编码的普通正文当作成功；任何漏槽、换源或额外正文都会使完整比较失败。
function readControlledPageEvidenceInPage() {
  const artifact = '.fluent-read-bilingual-content,.fluent-read-loading,.fluent-read-retry-wrapper,[data-fr-translation-owned="true"]';
  const formulaSelector = 'math,mjx-container,.MathJax,.MathJax_Display,.MathJax_SVG,.MathJax_CHTML,.katex,.mwe-math-element,.ltx_Math';
  const protectedSelector = `code,pre,kbd,samp,var,time,[role="timer"],${formulaSelector},svg,[translate="no"],.notranslate,[data-notranslate="true"],sup.reference`;
  const omitted = 'script,style,noscript,template,[hidden],[inert],[aria-hidden="true"],.sr-only,.visually-hidden,[role="tooltip"],[contenteditable]:not([contenteditable="false"])';
  const formulaAuxiliary = '.MJX_Assistive_MathML,mjx-assistive-mml,.katex-mathml,annotation,annotation-xml';
  // A URL/domain alone in a real link is an identifier skeleton; arbitrary anchor prose is not.
  const linkIdentifier = /^(?:https?:\/\/\S+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[:/?#]\S*)?|\S+@\S+\.\S+|@[\p{L}\p{N}_-]+|u\/[\p{L}\p{N}_-]+|#[0-9]+)$/iu;
  // The production GitHub adapter explicitly protects these custom time elements without role=timer.
  const siteProtected = globalThis.location?.hostname === 'github.com' ? 'relative-time,time-ago,local-time' : '';
  const ubuntuManpage = globalThis.location?.hostname === 'manpages.ubuntu.com' && /^\/manpages\/[^/]+\/man[0-9][^/]*\/[^/]+\.html$/u.test(globalThis.location?.pathname || '');
  // Match the SQLite documentation profile exactly; ordinary page buttons are not protected prose.
  const sqliteDocument = ['sqlite.org', 'www.sqlite.org'].includes(globalThis.location?.hostname) &&
    /^(?:\/lang.*|\/syntax\/.*|\/c3ref\/.*|\/docs\.html)$/u.test(globalThis.location?.pathname || '');
  const literalToken = /^[\w.+/-]+(?:(?:\s*,\s*[\w.+/-]+)+|(?:\s+--?\w[\w-]*)+)?$/u;
  const isProtected = (node, live) => node.matches(protectedSelector) || siteProtected && node.matches(siteProtected) ||
    sqliteDocument && node.matches('button') ||
    ubuntuManpage && live?.matches('#manpage-content section.Sh b,#manpage-content section.Sh i') && literalToken.test(node.textContent.trim()) ||
    node.matches('a[href]') && linkIdentifier.test(node.textContent.trim());
  const visibleFormulaText = node => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll(formulaAuxiliary).forEach(child => child.remove());
    return copy.textContent;
  };
  const textNodes = (root, inheritedLink) => {
    const parts = [], walk = document.createTreeWalker(root, 1 | 4);
    while (walk.nextNode()) {
      const node = walk.currentNode;
      if (node.nodeType === 3) parts.push({text: node.nodeValue || '', linkHref: node.parentElement?.closest('a[href]')?.getAttribute('href') ?? inheritedLink});
      else if (node.localName === 'br') parts.push({text: '\n', linkHref: null});
    }
    return parts;
  };
  return [...document.querySelectorAll('.fluent-read-bilingual-content')].map((wrapper, index) => {
    const owner = wrapper.parentElement;
    const source = owner.cloneNode(true), translated = wrapper.cloneNode(true);
    // Visibility must come from connected source elements: cloning loses class-dependent CSS.
    // Formula descendants are special: aria-hidden often marks the visible layout copy.
    const liveElements = [...owner.querySelectorAll('*')], clonedElements = [...source.querySelectorAll('*')];
    const sourceContexts = new WeakMap(clonedElements.map((node, index) => [node, liveElements[index]]));
    const omittedParts = [];
    liveElements.forEach((node, position) => {
      if (node.closest(artifact) || node.parentElement?.closest(formulaSelector)) return;
      let reason = node.matches(omitted) ? 'explicit-hidden-or-nonprose' : '';
      try {
        const style = node.ownerDocument.defaultView?.getComputedStyle?.(node);
        if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') reason = 'computed-hidden';
        // Match the production snapshot's narrow accessibility-box contract. Neither
        // a familiar class, clipping alone, nor overflow on an ordinary prose box exempts text.
        if (style && (style.position === 'absolute' || style.position === 'fixed') &&
            (style.overflow === 'hidden' || style.overflow === 'clip' || (style.overflowX === 'hidden' && style.overflowY === 'hidden'))) {
          const clip = style.clip?.replace(/[\s,]+/gu, ' ').trim();
          if ((/^rect\((0(?:px)?|1px) \1 \1 \1\)$/u.test(clip ?? '') || style.clipPath?.replace(/\s+/gu, '') === 'inset(50%)') &&
              /^(?:0(?:\.\d+)?|1(?:\.0+)?)px$/u.test(style.width) && /^(?:0(?:\.\d+)?|1(?:\.0+)?)px$/u.test(style.height)) reason = 'computed-clipped-accessibility';
        }
      } catch { /* Unavailable styles cannot exempt visible source text. */ }
      if (reason) {omittedParts.push({tag: node.localName, text: node.textContent, reason}); clonedElements[position].remove();}
    });
    source.querySelectorAll(artifact).forEach(node => node.remove());
    translated.querySelectorAll(artifact).forEach(node => node.remove());
    const protections = [];
    for (const node of source.querySelectorAll('*')) {
      if (!source.contains(node) || !isProtected(node, sourceContexts.get(node))) continue;
      // Only the outer protected subtree participates: nested MathML/KaTeX is one skeleton.
      protections.push({tag: node.localName, text: node.matches(formulaSelector) ? visibleFormulaText(node) : node.textContent, href: node.getAttribute('href'), linkHref: sourceContexts.get(node)?.closest('a[href]')?.getAttribute('href') ?? null, formula: node.matches(formulaSelector)});
      node.remove();
    }
    const protectedMatches = [];
    const outputLink = node => node.closest('a[href]')?.getAttribute('href') ?? owner.closest('a[href]')?.getAttribute('href') ?? null;
    for (const part of protections) {
      let matched = !part.text.trim();
      for (const node of translated.querySelectorAll(part.tag)) {
        if ((part.formula ? visibleFormulaText(node) : node.textContent) === part.text && node.getAttribute('href') === part.href && outputLink(node) === part.linkHref) {node.remove(); matched = true; break;}
      }
      // Sanitization unwraps custom elements such as <relative-time role=timer>.
      // Only an entire unchanged Text node may match the observed protected subtree;
      // never remove an arbitrary substring or exempt an unmarked prose/date node.
      if (!matched && part.href === null && !part.formula) {
        const walk = document.createTreeWalker(translated, 4);
        while (walk.nextNode()) {
          if (walk.currentNode.nodeValue === part.text && outputLink(walk.currentNode.parentElement) === part.linkHref) {walk.currentNode.remove(); matched = true; break;}
        }
      }
      protectedMatches.push({...part, matched});
    }
    const inheritedLink = owner.closest('a[href]')?.getAttribute('href') ?? null;
    const sourceTextNodes = textNodes(source, inheritedLink), outputTextNodes = textNodes(translated, inheritedLink);
    const sourceParts = sourceTextNodes.map(node => node.text);
    return {index, owner: owner.localName, source: sourceParts.join(''), sourceParts, output: outputTextNodes.map(node => node.text).join(''), sourceTextNodes, outputTextNodes, protectedMatches, omittedParts, sourceHtml: source.outerHTML.slice(0, 4000)};
  });
}

let originalSlotPolicies;
function loadOriginalSlotPolicies() {
  if (originalSlotPolicies) return originalSlotPolicies;
  // Use the tested snapshot's actual pure eligibility rules; a second handwritten language
  // heuristic would either miss legitimate skipped slots or silently exempt foreign prose.
  const path = require('node:path'), {createRequire} = require('node:module');
  const root = path.resolve(__dirname, '../..');
  const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild');
  const built = esbuild.buildSync({stdin: {contents: `export {shouldSkipTranslationForTarget} from './src/core/language/detect'; export {isNonTranslatableLiveData} from './src/core/translation/liveData'; export {isIdentifierLikeText} from './src/core/translation/text';`, resolveDir: root}, alias: {'@': root}, bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent'});
  const policyModule = {exports: {}};
  require('node:vm').runInThisContext(`(function(require,module,exports){${built.outputFiles[0].text}\n})`, {filename: 'controlled-source-slot-policy.cjs'})(require, policyModule, policyModule.exports);
  originalSlotPolicies = policyModule.exports;
  return originalSlotPolicies;
}

function hasControlledTextNodeAttribution(row) {
  if (!Array.isArray(row.sourceTextNodes) || !Array.isArray(row.outputTextNodes)) return false;
  const policies = loadOriginalSlotPolicies(), sources = row.sourceTextNodes.map(node => node.text), outputs = row.outputTextNodes.map(node => node.text);
  // Evidence must describe precisely the same projected DOM text checked by the caller.
  if (sources.join('') !== row.source || outputs.join('') !== row.output || /[\uFFF0\uFFF1]/u.test(row.source + row.output)) return false;
  const matchedOutputs = new Set();
  row.sourceTextNodes.forEach((node, index) => {
    const text = node.text.trim();
    if (!text || text.includes('测试译文：')) return;
    const identifier = node.linkHref !== null && policies.isIdentifierLikeText(text);
    if (!identifier && !policies.isNonTranslatableLiveData(text) && !policies.shouldSkipTranslationForTarget(text, 'zh-Hans', [])) return;
    const target = row.outputTextNodes.findIndex((output, outputIndex) => !matchedOutputs.has(outputIndex) && output.text === node.text && (!identifier || output.linkHref === node.linkHref));
    if (target < 0) return;
    // An ordered, unique sentinel preserves adjacency and ordering in the final full-source
    // comparison. Only an entire exact DOM Text node can be paired, never a substring.
    const marker = `\uFFF0${index}\uFFF1`;
    sources[index] = marker;outputs[target] = marker;matchedOutputs.add(target);
  });
  return isControlledTranslationForSource(outputs.join(''), sources.join(''), sources);
}

function assertControlledPageEvidence(evidence, phase) {
  if (!Array.isArray(evidence) || !evidence.length) throw new Error(`${phase}: controlled response owners missing`);
  for (const row of evidence) {
    if (row.protectedMatches?.some(part => !part.matched) || (!isControlledTranslationForSource(row.output, row.source, row.sourceParts) && !hasControlledTextNodeAttribution(row))) {
      throw new Error(`${phase}/${row.index}: controlled response not proven for complete source ${JSON.stringify(row)}`);
    }
  }
  return {protocol: 'utf8-han-v1', owners: evidence.length, completeSourceMatched: true};
}

async function installControlledProvider(context, createPage, timeout) {
  const install = worker => worker.evaluate(controlledProviderRuntime, true);
  const errors = [];
  const workers = new Set();
  const onWorker = worker => {workers.add(worker); void install(worker).catch(error => errors.push(error.message));};
  context.on('serviceworker', onWorker);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout});
  workers.add(worker);
  await install(worker);
  const popup = await createPage(context, timeout);
  try {
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`, {waitUntil: 'domcontentloaded', timeout});
    const response = await popup.evaluate(async () => {
      const stored = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!stored.success) throw new Error(stored.error);
      const config = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
      const updates = {service: 'microsoft', from: 'en', to: 'zh-Hans', display: 1, autoTranslate: false,
        hotkey: 'Control', floatingBallHotkey: 'Alt+T', fullPageTranslationMode: 'viewport',
        useCache: false, enableAIContext: false, enableAIMultiSegment: false,
        uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true};
      return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: updates,
        expected: Object.fromEntries(Object.keys(updates).map(key => [key, config[key]])),
        clientId: 'web-compatibility-suite', sequence: 1, baseRevision: config.__fluentConfigRevision});
    });
    if (!response?.success) throw new Error(`Controlled-provider configuration failed: ${JSON.stringify(response)}`);
  } finally {await popup.close();}
  return {
    async assertPage(page, phase) {
      return assertControlledPageEvidence(await page.evaluate(readControlledPageEvidenceInPage), phase);
    },
    async snapshot() {
      if (errors.length) throw new Error(`Controlled transport worker failed: ${errors.join('; ')}`);
      const current = context.serviceWorkers()[0];
      if (!current || workers.size !== 1) throw new Error('Controlled transport worker changed or disappeared; response attribution is not proven');
      const state = await current.evaluate(() => globalThis.__frCompatibilityTransport);
      if (!state || state.protocol !== 'utf8-han-v1' || !Number.isSafeInteger(state.requests) || state.requests < 1 || !Number.isSafeInteger(state.texts) || state.texts < 1 || state.active !== 0) {
        throw new Error('Controlled transport has no completed request evidence or remains active');
      }
      return {mode: 'controlled-microsoft-response', scope: 'real-site DOM compatibility only',
        workerCount: workers.size, ...state, errors};
    },
    dispose() {context.off('serviceworker', onWorker);},
  };
}

module.exports = {installControlledProvider, encodeControlledTranslation, decodeControlledTranslationText, isControlledTranslationForSource, readControlledPageEvidenceInPage, assertControlledPageEvidence};
