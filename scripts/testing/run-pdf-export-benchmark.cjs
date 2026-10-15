#!/usr/bin/env node
'use strict';

/**
 * @file scripts/testing/run-pdf-export-benchmark.cjs
 * 文件职责：用生产扩展和严格焦点守卫验证大 PDF 的本机 fixture 导出压力、取消和页序。
 * 主要内容：mock 输入在任何浏览器/服务器启动前必须至少 300 页，--mock-min-pages 只能提高此下限；
 * 记录实际导出点击到下载事件的耗时，导出前冻结产品持久化的最终译文及源/译快照 SHA；
 * 未保护响应逐字保持，保护响应必须完整恢复原字面值，PDF 全文批注再逐字等于最终译文。
 * 导出前/取消后/完成后三阶段记录 DOM 画布及可用的 JS 堆快照，不代表 OS RAM 或峰值。
 * 模块边界：仅大文档压力允许 mock，不证明在线翻译质量；原生激活事件永久失败并只关闭所属浏览器，
 * 不恢复或改变用户焦点。--preflight-only / --self-test-expectations 仅执行离线预检/回归。
 */
const assert = require('node:assert/strict');
const {mapPdfLayoutPages} = require('./pdf-output-pages.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground, queryMacFrontmostApplication, startFocusEventMonitor} = require('./focus-safe-browser.cjs');
const {getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const arg = (name, fallback) => {const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1];};
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const tight = value => value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
const FIXTURE_MARKER = /^BENCH_[a-f0-9]{12}/u;
const PROTECTED_TOKEN = /__FRTERM_[a-f0-9]{12}_\d+__/gu;
const MINIMUM_MOCK_PAGES = 300;

function mockPolicy(pageCounts, minimumPages) {
  assert(Number.isInteger(minimumPages) && minimumPages >= MINIMUM_MOCK_PAGES,
    '--mock-min-pages must be an integer >=300; ordinary documents require run-document-live-translation.cjs');
  const inputs = pageCounts.map(input => ({...input, approved: input.pages >= minimumPages}));
  return {purpose: 'Extreme-load PDF export, cancellation and page-integrity testing only; ordinary documents must use actual free-provider translation',
    minimumPages, hardMinimumPages: MINIMUM_MOCK_PAGES, approved: inputs.every(input => input.approved), inputs,
    rejectedInputGuidance: 'Mock is restricted to PDFs with at least 300 pages. Use scripts/testing/run-document-live-translation.cjs for ordinary documents.'};
}

async function preflightMockInputs(inputs, requireRepo, minimumPages) {
  mockPolicy([], minimumPages);
  const {getDocument} = await import(requireRepo.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  const facts = [];
  for (const input of inputs) {
    const bytes = fs.readFileSync(input);
    const task = getDocument({data: new Uint8Array(bytes), disableFontFace: true, isEvalSupported: false, useWorkerFetch: false, verbosity: 0});
    try {facts.push({input, sha256: sha(bytes), bytes: bytes.length, pages: (await task.promise).numPages});}
    finally {await task.destroy();}
  }
  return mockPolicy(facts, minimumPages);
}

async function historySnapshot(page, name) {
  return page.evaluate(async name => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('FluentReadDocumentHistory', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const records = await new Promise((resolve, reject) => {
        const request = database.transaction('documents', 'readonly').objectStore('documents').getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const record = records.filter(value => value.name === name).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (!record?.parsed?.segments) return null;
      return {name: record.name, parsedVersion: record.parsedVersion, updatedAt: record.updatedAt,
        segments: record.parsed.segments.map((segment, index) => ({id: segment.id ?? index, source: segment.source,
          translation: record.translations[segment.id ?? index] ?? ''}))};
    } finally {database.close();}
  }, name);
}

/** Three lightweight snapshots only: DOM-resident canvases and browser JS heap, never OS RAM or a peak profile. */
async function resourceSnapshot(page, phase) {
  return page.evaluate(phase => {
    const root = document.querySelector('.pdf-layout-viewer');
    const canvases = [...document.querySelectorAll('canvas')], pdfCanvases = root ? [...root.querySelectorAll('canvas')] : [];
    const pixels = values => values.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0);
    const memory = performance.memory;
    return {phase, time: Date.now(), pdfReaderPresent: Boolean(root), pdfPresentation: root?.dataset.pdfPresentation ?? null,
      pdfRowsInDom: root?.querySelectorAll('.pdf-page-row').length ?? 0,
      renderedPdfRowsInDom: root?.querySelectorAll('.pdf-page-row[data-render-state="ready"]').length ?? 0,
      pdfCanvasesInDom: pdfCanvases.length, allCanvasesInDom: canvases.length, pdfCanvasPixels: pixels(pdfCanvases),
      allCanvasPixels: pixels(canvases), domCanvasRgbaByteEstimate: pixels(canvases) * 4,
      jsHeap: memory ? {usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit} : null};
  }, phase);
}

/** Align transport placeholders with the complete original source, retaining all surrounding bytes. */
function literalRestorations(protectedSource, originalSource) {
  const tokens = [...protectedSource.matchAll(PROTECTED_TOKEN)];
  assert(tokens.length && new Set(tokens.map(([token]) => token)).size === tokens.length, 'Expected distinct protected tokens');
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  let expression = '^', cursor = 0;
  for (const token of tokens) {
    expression += escape(protectedSource.slice(cursor, token.index)) + '([\\s\\S]+?)'; cursor = token.index + token[0].length;
  }
  const matched = new RegExp(expression + escape(protectedSource.slice(cursor)) + '$', 'u').exec(originalSource);
  assert(matched, 'Protected fixture source must retain every surrounding original character');
  return tokens.map(([token], index) => Object.freeze({token, originalLiteral: matched[index + 1]}));
}

/** Validate the fixture-to-product boundary before trusting final targets as export expectations. */
function freezeFinalExpectations(snapshot, fixture) {
  assert(snapshot?.segments?.length, 'Completed document must have saved segments');
  const byMarker = Object.create(null), records = [];
  for (const segment of snapshot.segments) {
    assert.equal(typeof segment.source, 'string'); assert.equal(typeof segment.translation, 'string');
    const marker = FIXTURE_MARKER.exec(segment.translation)?.[0];
    assert(marker, `Segment ${segment.id} has no fixture marker`);
    const raw = fixture.responseInputs.get(marker), response = fixture.responses.get(marker);
    assert(raw && typeof response === 'string', `No transport fixture response for ${marker}`);
    assert(Number.isInteger(raw.repeats) && raw.repeats >= 1);
    assert.equal(marker, `BENCH_${sha(raw.source).slice(0, 12)}`, 'Fixture marker must identify its transport input');
    const rawExpected = `${marker} 测试译文：${Array(raw.repeats).fill(raw.source).join('\n')}`;
    assert.equal(response, rawExpected, `Raw fixture response changed for ${marker}`);
    const protectedTokens = [...raw.source.matchAll(PROTECTED_TOKEN)];
    const restorations = protectedTokens.length ? literalRestorations(raw.source, segment.source) : [];
    if (!protectedTokens.length) assert.equal(raw.source, segment.source, `Unprotected fixture input changed for ${marker}`);
    assert(!/__FRTERM_/u.test(segment.translation), `Unrestored literal token in final target ${marker}`);
    const restoredExpected = `${marker} 测试译文：${Array(raw.repeats).fill(segment.source).join('\n')}`;
    assert.equal(segment.translation, protectedTokens.length ? restoredExpected : response,
      `Final target lost or changed fixture source/literals for ${marker}`);
    if (byMarker[marker]) {
      assert.equal(byMarker[marker], segment.translation, `One marker maps to different final targets: ${marker}`);
    } else byMarker[marker] = segment.translation;
    records.push(Object.freeze({segmentId: segment.id, marker, source: segment.source, rawFixtureSource: raw.source,
      rawFixtureResponse: response, restoredExpected: segment.translation, restorations: Object.freeze(restorations),
      differenceType: protectedTokens.length ? 'protected-literal-restoration' : 'unchanged-raw-response',
      rawFixtureSha256: sha(response), restoredExpectedSha256: sha(segment.translation)}));
  }
  return Object.freeze({byMarker: Object.freeze(byMarker), records: Object.freeze(records),
    sourceSnapshotSha256: sha(JSON.stringify(snapshot.segments.map(({id, source}) => ({id, source})))),
    targetSnapshotSha256: sha(JSON.stringify(snapshot.segments.map(({id, translation}) => ({id, translation}))))});
}

function buildFingerprint(directory) {
  const files = [];
  const walk = (root, relative = '') => {
    for (const entry of fs.readdirSync(root, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name), absolute = path.join(root, entry.name);
      if (entry.isDirectory()) walk(absolute, name);
      else if (entry.isFile()) files.push({name, bytes: fs.statSync(absolute).size, sha256: sha(fs.readFileSync(absolute))});
    }
  };
  walk(directory);
  return {sha256: sha(JSON.stringify(files)), files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), manifestSha256: sha(fs.readFileSync(path.join(directory, 'manifest.json')))};
}

async function fixtureServer(overflowRepeat) {
  const responses = new Map(), responseInputs = new Map(), requests = [];
  let expandedMarker;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {res.writeHead(204); res.end(); return;}
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const prompt = body.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
      const source = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1];
      assert.equal(typeof source, 'string');
      const slots = [];
      const translate = text => {
        const marker = `BENCH_${sha(text).slice(0, 12)}`;
        if (!expandedMarker) expandedMarker = marker;
        const repeats = marker === expandedMarker ? overflowRepeat : 1;
        const translation = `${marker} 测试译文：${Array(repeats).fill(text).join('\n')}`;
        responseInputs.set(marker, Object.freeze({source: text, repeats}));
        slots.push({marker, sourceChars: text.length, translationChars: translation.length}); responses.set(marker, translation); return translation;
      };
      const protocol = /(___FLUENTREAD_([a-z0-9_-]+)_(\d+)_BEGIN___)([\s\S]*?)(___FLUENTREAD_\2_\3_END___)/giu;
      const translation = protocol.test(source) ? source.replace(protocol, (_match, begin, _nonce, _index, text, end) => `${begin}${translate(text)}${end}`) : translate(source);
      requests.push({slots});
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({id: 'pdf-export-fixture', object: 'chat.completion', created: 1, model: 'pdf-export-fixture',
        choices: [{index: 0, message: {role: 'assistant', content: translation}, finish_reason: 'stop'}], usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}}));
    } catch (error) {res.writeHead(400); res.end(JSON.stringify({error: {message: error.message}}));}
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return {responses, responseInputs, requests, resetDocument: () => {expandedMarker = undefined;}, get expandedMarker() {return expandedMarker;}, url: `http://127.0.0.1:${server.address().port}/v1/chat/completions`,
    close: () => {server.closeAllConnections(); return new Promise(resolve => server.close(resolve));}};
}

async function inspectPdf(bytes, requireRepo) {
  const {getDocument} = await import(requireRepo.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  const task = getDocument({data: new Uint8Array(bytes), disableFontFace: true, isEvalSupported: false, useWorkerFetch: false, verbosity: 0,
    standardFontDataUrl: path.join(path.dirname(requireRepo.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep});
  try {
    const pdf = await task.promise, pages = [], labels = await pdf.getPageLabels();
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      try {
        const viewport = page.getViewport({scale: 1});
        const items = (await page.getTextContent()).items.filter(item => 'str' in item);
        const annotations = (await page.getAnnotations()).filter(annotation => annotation.subtype === 'Text').map(annotation => ({contents: annotation.contentsObj?.str ?? annotation.contents ?? '', rect: annotation.rect, flags: annotation.annotationFlags}));
        pages.push({number, label: labels?.[number - 1], width: viewport.width, height: viewport.height, text: items.map(item => item.str).join('\n'), annotations});
      } finally {page.cleanup();}
    }
    return pages;
  } finally {await task.destroy();}
}

async function renderPdfSamples(file, count, artifactsDir, prefix, executable) {
  const pages = [...new Set([1, Math.ceil(count / 2), count])], output = [];
  for (const number of pages) {
    const target = path.join(artifactsDir, `${prefix}-page-${number}`);
    await promisify(execFile)(executable, ['-f', String(number), '-l', String(number), '-singlefile', '-scale-to', '2000', '-png', file, target], {timeout: 60000, maxBuffer: 1024 * 1024});
    output.push({page: number, path: `${target}.png`});
  }
  return output;
}

function validateOutput(sourcePages, outputPages, fixture, mode, layout, finalExpectations) {
  const sourceTexts = sourcePages.map(page => tight(page.text)), outputTexts = outputPages.map(page => tight(page.text));
  const fingerprints = sourceTexts.map((text, index) => {
    const candidates = [];
    // Include the final text: repeated synthetic pages carry unique bottom-margin page tags.
    for (const fraction of [0, .15, .33, .5, .7, .9, 1]) {
      const start = Math.max(0, Math.min(Math.floor(text.length * fraction), text.length - 70));
      const snippet = text.slice(start, start + 70);
      if (snippet.length >= 24 && !sourceTexts.some((other, otherIndex) => otherIndex !== index && other.includes(snippet)) && !candidates.includes(snippet)) candidates.push(snippet);
    }
    return candidates;
  });
  const sourceOrder = fingerprints.map((anchors, index) => ({sourcePage: index + 1, anchors: anchors.length,
    outputPages: outputTexts.map((text, outputIndex) => ({page: outputIndex + 1, hits: anchors.filter(anchor => text.includes(anchor)).length})).filter(entry => entry.hits > 0)}));
  const dimensionFailures = [], missingOriginalPages = [], incorrectPageOrder = [];
  const sideBySide = mode === 'bilingual';
  const mapped = mapPdfLayoutPages(sourcePages.length, outputPages);
  sourcePages.forEach((source, index) => {
    const output = mapped.pages[index], expectedWidth = sideBySide ? source.width * 2 + Math.max(8, Math.min(24, source.width * .025)) : source.width;
    if (!output || Math.abs(output.width - expectedWidth) > .02 || Math.abs(output.height - source.height) > .02) dimensionFailures.push({page: index + 1, expected: {width: expectedWidth, height: source.height}, actual: output && {width: output.width, height: output.height}});
    if (sideBySide && fingerprints[index].length && !sourceOrder[index].outputPages.length) missingOriginalPages.push(index + 1);
    if (sideBySide && fingerprints[index].length && !sourceOrder[index].outputPages.some(entry => entry.page === mapped.indices[index] + 1 && entry.hits === fingerprints[index].length)) incorrectPageOrder.push(index + 1);
  });
  const annotations = outputPages.flatMap(page => page.annotations.map(annotation => ({page: page.number, pageWidth: page.width, pageHeight: page.height, ...annotation})));
  // Every Text annotation in this controlled export is a generated overflow note.
  // A missing marker must fail rather than disappear from the validation set.
  const fixtureAnnotations = annotations;
  const incompleteAnnotations = fixtureAnnotations.filter(annotation => {
    const marker = FIXTURE_MARKER.exec(annotation.contents)?.[0]; return !marker || finalExpectations.byMarker[marker] !== annotation.contents;
  }).map(annotation => ({page: annotation.page, marker: FIXTURE_MARKER.exec(annotation.contents)?.[0], chars: annotation.contents.length,
    expected: finalExpectations.byMarker[FIXTURE_MARKER.exec(annotation.contents)?.[0]], actual: annotation.contents}));
  const expandedAnnotation = fixtureAnnotations.find(annotation => annotation.contents === finalExpectations.byMarker[fixture.expandedMarker]);
  const outsideAnnotations = fixtureAnnotations.filter(annotation => annotation.rect[0] < 0 || annotation.rect[1] < 0 || annotation.rect[2] > annotation.pageWidth + .01 || annotation.rect[3] > annotation.pageHeight + .01).map(annotation => ({page: annotation.page, rect: annotation.rect}));
  const continuationText = sourcePages.map((_source, index) => tight(mapped.continuations.filter(item => item.sourcePage === index + 1)
    .map(item => outputPages[item.index]?.text || '').join('')).replace(/原文第\d+页·译文续页\d+\/\d+/gu, ''));
  const incompleteContinuations = mapped.labelled ? fixtureAnnotations.filter(annotation => {
    const sourceIndex = mapped.indices.indexOf(annotation.page - 1);
    return sourceIndex < 0 || !continuationText[sourceIndex].includes(tight(annotation.contents));
  }).map(annotation => ({page: annotation.page, chars: annotation.contents.length})) : [];
  const checks = {layoutPagesMapped: mapped.ok, visibleContinuationFullText: incompleteContinuations.length === 0, originalPagesComplete: missingOriginalPages.length === 0,
    originalPageOrder: incorrectPageOrder.length === 0, exactPageDimensions: dimensionFailures.length === 0, annotationFullText: incompleteAnnotations.length === 0,
    overflowAnnotationsPresent: fixtureAnnotations.length > 0, annotationNoPrint: fixtureAnnotations.every(annotation => !(annotation.flags & 4)), annotationInsidePage: outsideAnnotations.length === 0};
  return {layout, pageMapping: {ok: mapped.ok, labelled: mapped.labelled, indices: mapped.indices, continuations: mapped.continuations}, checks, semanticOk: Object.values(checks).every(Boolean), sourceOrder, dimensionFailures, missingOriginalPages, incorrectPageOrder, incompleteContinuations,
    sourcePagesWithoutUniqueFingerprint: fingerprints.map((anchors, index) => !anchors.length ? index + 1 : null).filter(Boolean),
    annotations: {total: annotations.length, fixture: fixtureAnnotations.length, incomplete: incompleteAnnotations, outside: outsideAnnotations, expandedMarker: fixture.expandedMarker, expandedPage: expandedAnnotation?.page, expandedChars: expandedAnnotation?.contents.length,
      expandedAnnotationPresent: Boolean(expandedAnnotation), expandedNote: 'The first sixfold translation may fit at >=6pt; a note is required only when the bounded raster fitting cannot display all text.'}};
}

function selfTestExpectations() {
  const cases = [];
  const run = (name, check) => {check(); cases.push(name);};
  const sample = (source, protectedSource = source, repeats = 1) => {
    const marker = `BENCH_${sha(protectedSource).slice(0, 12)}`;
    const raw = `${marker} 测试译文：${Array(repeats).fill(protectedSource).join('\n')}`;
    const target = `${marker} 测试译文：${Array(repeats).fill(source).join('\n')}`;
    return {marker, raw, target, snapshot: {segments: [{id: 0, source, translation: target}]},
      fixture: {responses: new Map([[marker, raw]]), responseInputs: new Map([[marker, {source: protectedSource, repeats}]]), expandedMarker: marker}};
  };
  const protectedSample = () => sample('→ Σinter ⇀', '→ __FRTERM_e019a94b39c2_3__ ⇀');
  run('unprotected raw response remains exact', () => {
    const value = sample('Complete original source');
    assert.equal(freezeFinalExpectations(value.snapshot, value.fixture).byMarker[value.marker], value.raw);
  });
  run('raw protected response differs but complete restored Greek target passes', () => {
    const value = protectedSample(), expected = freezeFinalExpectations(value.snapshot, value.fixture);
    assert.notEqual(value.raw, value.target); assert.equal(expected.byMarker[value.marker], value.target);
    assert.deepEqual(expected.records[0].restorations, [{token: '__FRTERM_e019a94b39c2_3__', originalLiteral: 'Σinter'}]);
  });
  run('multiple literals retain metacharacters and all surrounding bytes', () => {
    const value = sample('(Σiso) + [Σinter].', '(__FRTERM_e019a94b39c2_3__) + [__FRTERM_e019a94b39c2_4__].');
    const expected = freezeFinalExpectations(value.snapshot, value.fixture);
    assert.deepEqual(expected.records[0].restorations.map(entry => entry.originalLiteral), ['Σiso', 'Σinter']);
  });
  run('sixfold overflow target retains every complete repetition', () => {
    const value = sample('Σiso', '__FRTERM_e019a94b39c2_3__', 6);
    assert.equal(freezeFinalExpectations(value.snapshot, value.fixture).byMarker[value.marker], value.target);
  });
  run('truncated final saved target fails before export', () => {
    const value = protectedSample(); value.snapshot.segments[0].translation = value.target.slice(0, -1);
    assert.throws(() => freezeFinalExpectations(value.snapshot, value.fixture), /lost or changed/u);
  });
  run('missing original Greek literal character fails before export', () => {
    const value = protectedSample(); value.snapshot.segments[0].translation = value.target.replace('Σinter', 'Σinte');
    assert.throws(() => freezeFinalExpectations(value.snapshot, value.fixture), /lost or changed/u);
  });
  run('unrestored transport token fails before export', () => {
    const value = protectedSample(); value.snapshot.segments[0].translation = value.raw;
    assert.throws(() => freezeFinalExpectations(value.snapshot, value.fixture), /Unrestored/u);
  });
  run('unprotected final target cannot silently change raw response', () => {
    const value = sample('Complete original source'); value.snapshot.segments[0].translation += ' extra';
    assert.throws(() => freezeFinalExpectations(value.snapshot, value.fixture), /lost or changed/u);
  });
  run('a protected transport cannot change text outside its token', () => {
    const value = sample('wrong Σinter ⇀', '→ __FRTERM_e019a94b39c2_3__ ⇀');
    assert.throws(() => freezeFinalExpectations(value.snapshot, value.fixture), /surrounding original character/u);
  });
  run('PDF annotation must equal the complete frozen target, not its marker prefix', () => {
    const value = protectedSample(), expected = freezeFinalExpectations(value.snapshot, value.fixture);
    const sourcePages = [{number: 1, width: 100, height: 200, text: 'A complete and unique original page fingerprint longer than seventy characters'}];
    const output = contents => [{number: 1, width: 208, height: 200, text: sourcePages[0].text,
      annotations: [{contents, rect: [105, 5, 119, 19], flags: 0}]}];
    assert(validateOutput(sourcePages, output(value.target), value.fixture, 'bilingual', 'side-by-side', expected).semanticOk);
    for (const corrupted of [value.target.slice(0, -1), value.target.replace('Σinter', 'Σinte'), value.raw]) {
      const result = validateOutput(sourcePages, output(corrupted), value.fixture, 'bilingual', 'side-by-side', expected);
      assert.equal(result.checks.annotationFullText, false); assert.equal(result.semanticOk, false);
    }
    assert.throws(() => {expected.byMarker[value.marker] = value.raw;}, TypeError);
  });
  run('one correct note cannot hide another note with no marker or empty contents', () => {
    const value = protectedSample(), expected = freezeFinalExpectations(value.snapshot, value.fixture);
    const sourcePages = [{number: 1, width: 100, height: 200, text: 'A complete and unique original page fingerprint longer than seventy characters'}];
    for (const corrupted of ['测试译文：→ Σinter ⇀', '']) {
      const output = [{number: 1, width: 208, height: 200, text: sourcePages[0].text,
        annotations: [value.target, corrupted].map(contents => ({contents, rect: [105, 5, 119, 19], flags: 0}))}];
      const result = validateOutput(sourcePages, output, value.fixture, 'bilingual', 'side-by-side', expected);
      assert.equal(result.annotations.total, 2); assert.equal(result.annotations.incomplete.length, 1);
      assert.equal(result.checks.annotationFullText, false); assert.equal(result.semanticOk, false);
    }
  });
  run('unique trailing page tags detect reordered repeated synthetic source pages', () => {
    const value = protectedSample(), expected = freezeFinalExpectations(value.snapshot, value.fixture);
    const repeated = 'Repeated public source text and mathematics. '.repeat(30);
    const sourcePages = [1, 2].map(number => ({number, width: 100, height: 200, text: `${repeated}STRESS PAGE 00${number} / SOURCE 01`}));
    const output = sourcePages.map(page => ({...page, width: 208, annotations: [{contents: value.target, rect: [105, 5, 119, 19], flags: 0}]}));
    const ordered = validateOutput(sourcePages, output, value.fixture, 'bilingual', 'side-by-side', expected);
    assert(ordered.semanticOk); assert.equal(ordered.sourcePagesWithoutUniqueFingerprint.length, 0);
    const swapped = output.map((page, index) => ({...page, text: output[1 - index].text}));
    assert.equal(validateOutput(sourcePages, swapped, value.fixture, 'bilingual', 'side-by-side', expected).checks.originalPageOrder, false);
  });
  return {ok: true, scope: 'Offline fixture/final-target/PDF-annotation expectation regression; no browser or HTTP server', cases};
}

async function main() {
  if (process.argv.includes('--self-test-expectations')) {console.log(JSON.stringify(selfTestExpectations(), null, 2)); return;}
  const repository = path.resolve(__dirname, '../..'), requireRepo = createRequire(path.join(repository, 'package.json'));
  const inputs = arg('inputs', '').split(',').filter(Boolean).map(file => path.resolve(file));
  assert(inputs.length && inputs.every(file => fs.existsSync(file)), '--inputs requires comma-separated existing real PDF files');
  const label = arg('label', 'fixed'), layout = arg('layout', 'side-by-side');
  const minimumMockPages = Number(arg('mock-min-pages', MINIMUM_MOCK_PAGES));
  // Reject ordinary documents before creating any profile, native focus observer, server or browser.
  const policy = await preflightMockInputs(inputs, requireRepo, minimumMockPages);
  if (process.argv.includes('--preflight-only')) {
    console.log(JSON.stringify({ok: policy.approved, scope: 'Offline mock-page-count policy preflight only', browserStarted: false, mockPolicy: policy}, null, 2));
    if (!policy.approved) process.exitCode = 1;
    return;
  }
  if (!policy.approved) {
    const artifactsDir = path.resolve(arg('artifacts-dir', `/private/tmp/fluentread-pdf-export-${label}`)); fs.mkdirSync(artifactsDir, {recursive: true});
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify({ok: false, label, declaredBuildCommit: arg('build-commit', null),
      browserStarted: false, mockPolicy: policy, failure: policy.rejectedInputGuidance}, null, 2));
    throw new Error(policy.rejectedInputGuidance);
  }
  const extensionDir = path.resolve(arg('extension-dir', path.join(repository, '.output/chrome-mv3')));
  assert(fs.existsSync(path.join(extensionDir, 'manifest.json')) && !/-dev$/u.test(extensionDir), 'Use a built production extension');
  assert(['observe', 'side-by-side'].includes(layout));
  const modes = arg('modes', 'bilingual').split(','); assert(modes.length && modes.every(mode => ['bilingual', 'translated'].includes(mode)));
  const packages = arg('playwright-root'); assert(packages, '--playwright-root required');
  const {chromium} = createRequire(path.join(packages, 'pdf-export-runner.cjs'))('playwright');
  const artifactsDir = path.resolve(arg('artifacts-dir', `/private/tmp/fluentread-pdf-export-${label}`)); fs.mkdirSync(artifactsDir, {recursive: true});
  const pdftoppm = arg('pdftoppm');
  assert(pdftoppm && fs.existsSync(pdftoppm), '--pdftoppm must point to Poppler for export preview evidence');
  const overflowRepeat = Number(arg('overflow-repeat', 6)), cancelAfterPages = Number(arg('cancel-after-pages', 2));
  const exportTimeout = Number(arg('export-timeout-ms', 180000)), translationTimeout = Number(arg('translation-timeout-ms', 600000)), cancelTimeout = Number(arg('cancel-timeout-ms', 5000));
  assert(Number.isInteger(overflowRepeat) && overflowRepeat >= 1 && Number.isInteger(cancelAfterPages) && cancelAfterPages >= 1);
  const report = {ok: false, label, declaredBuildCommit: arg('build-commit', null), extensionDir, build: buildFingerprint(extensionDir), artifactsDir,
    mockPolicy: policy,
    resourceMeasurementContract: 'Three phase snapshots of DOM-resident canvases/pixels and Chromium performance.memory (JS heap only, nullable). DOM excludes detached export canvases; RGBA byte count is an estimate, not OS RAM or peak memory. No forced GC or heap profiling.',
    parameters: {modes, layout, overflowRepeat, cancelAfterPages, exportTimeout, translationTimeout, cancelTimeout, fixtureDelayMs: 0, documentBatchTranslation: 'default true when available', viewport: {width: 1440, height: 960}},
    timingContract: 'exportMs: actual export UI click to Playwright download event; excludes import, translation, saveAs, reopening and screenshots',
    limitations: ['Deterministic loopback translation, not an online provider.', 'Cancellation invokes the visible UI button from a progress observer; heartbeat measures main-thread responsiveness.', 'Source text fingerprints validate order/completeness; rendering requires visual inspection.'],
    inputs: [], screenshots: [], consoleErrors: [], cleanupErrors: [], focusEvents: [], focusChecks: []};
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-pdf-export-'));
  let fixture, launched, page, launchAttempted = false, focusMonitor, ownedPid, focusFailure;
  const persist = () => fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
  const stopForFocus = error => {
    focusFailure ||= error; report.focusFailure ||= error.message; report.ok = false; persist();
    // Permanently fail and close only this guarded instance; never activate another app or restore foreground focus.
    if (launched) void launched.close().catch(error => {report.cleanupErrors.push(`focus close: ${error.stack || error}`); persist();});
  };
  const checkFocus = async phase => {
    report.currentPhase = phase;
    if (focusFailure) throw focusFailure;
    const application = await queryMacFrontmostApplication();
    report.focusChecks.push({phase, document: report.currentDocument ?? null, mode: report.currentMode ?? null, time: Date.now(), application});
    if (!application || application.pid === ownedPid) {
      const error = new Error(!application ? `Cannot confirm foreground application during ${phase}` : `Owned Edge ${ownedPid} became foreground during ${phase}`);
      stopForFocus(error); throw error;
    }
    if (focusFailure) throw focusFailure;
  };
  try {
    report.currentPhase = 'launch';
    focusMonitor = startFocusEventMonitor({
      onEvent: event => {
        report.focusEvents.push({...event, phase: report.currentPhase, document: report.currentDocument ?? null, mode: report.currentMode ?? null});
        if (ownedPid && event.pid === ownedPid) stopForFocus(new Error(`Owned Edge ${ownedPid} activation during ${report.currentPhase}`));
      },
      onError: error => stopForFocus(error),
    });
    report.focusObserver = await focusMonitor.ready;
    fixture = await fixtureServer(overflowRepeat);
    if (focusFailure) throw focusFailure;
    launchAttempted = true;
    launched = await launchFocusSafePersistentContext({chromium, profileDir, browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      background: true, headless: false, displayTarget: arg('display', 'secondary'), viewport: {width: 1440, height: 960}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    ownedPid = await getGuardedBrowserPid(launched); report.ownedBrowserPid = ownedPid;
    if (report.focusEvents.some(event => event.pid === ownedPid)) stopForFocus(new Error(`Owned Edge ${ownedPid} activation during launch`));
    assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.focusPolicy, 'launchservices-no-foreground'); assert.equal(report.windowPlacement.browserFrontmost, false);
    await checkFocus('initialization');
    const context = launched.context, worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    const origin = /^chrome-extension:\/\/[^/]+/u.exec(worker.url())[0];
    page = await newPageWithoutForeground(context, 30000); page.setDefaultTimeout(30000);
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(message.text());});
    await page.goto(`${origin}/document.html`, {waitUntil: 'domcontentloaded'}); await activateExtensionTabWithoutForeground(context, page);
    await page.locator('.file-drop-zone').waitFor();
    const service = 'custom:pdf-export-fixture';
    const seeded = await page.evaluate(async ({service, endpoint}) => {
      const stored = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}); if (!stored.success) throw new Error(stored.error);
      const current = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
      return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'replace', baseRevision: current.__fluentConfigRevision, clientId: `pdf-export-fixture-${crypto.randomUUID()}`, sequence: 1,
        config: {...current, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, from: 'en', to: 'zh-Hans', documentService: service,
          documentModel: {...current.documentModel, [service]: 'pdf-export-fixture'}, customOpenAIProviders: [{id: service, name: '本机 PDF 导出基准', endpoint, models: ['pdf-export-fixture']}],
          requireApiKey: {[`v2:${JSON.stringify([service, 'pdf-export-fixture'])}`]: false}, user_role: {...current.user_role, [service]: 'SOURCE_BEGIN{{origin}}SOURCE_END'}, enableAIContext: false, enableAIMultiSegment: false}});
    }, {service, endpoint: fixture.url}); assert.equal(seeded.success, true, seeded.error);
    const shot = async name => {const file = path.join(artifactsDir, `${name}.png`); await page.screenshot({path: file, animations: 'disabled'}); report.screenshots.push(file);};
    const openDialog = async mode => {
      const existing = page.locator('.download-dialog[open]');
      if (!await existing.count()) await page.locator('.download-button').click();
      const dialog = page.locator('.download-dialog[open]'); await dialog.waitFor();
      await dialog.locator('.export-options button').nth(mode === 'bilingual' ? 0 : 1).click(); return dialog;
    };
    const startMonitor = async cancel => page.evaluate(({cancel, cancelAfterPages}) => {
      const dialog = document.querySelector('.download-dialog[open]');
      const state = window.__pdfExportBenchmark = {startedAt: null, startedPerf: null, maxHeartbeatGapMs: 0, heartbeats: 0, progress: [], cancelRequestedAt: null, canceledAt: null};
      let lastTick = performance.now(), lastText = '';
      const capture = () => {
        const text = dialog.querySelector('.export-progress')?.textContent.trim() || '';
        if (text && text !== lastText) {lastText = text; const match = /(\d+)\s*\/\s*(\d+)/u.exec(text); state.progress.push({text, elapsedMs: performance.now() - state.startedPerf, completed: match ? Number(match[1]) : null, total: match ? Number(match[2]) : null});}
        if (text.includes('已取消生成')) state.canceledAt ??= performance.now();
        if (cancel && state.cancelRequestedAt === null && state.progress.some(entry => entry.completed >= cancelAfterPages)) {
          const button = [...dialog.querySelectorAll('button')].find(button => button.textContent.trim() === '取消生成');
          if (button && !button.disabled) {state.cancelRequestedAt = performance.now(); button.click();}
        }
      };
      window.__pdfExportTimer = setInterval(() => {const now = performance.now(); if (state.startedAt !== null) {state.maxHeartbeatGapMs = Math.max(state.maxHeartbeatGapMs, now - lastTick); state.heartbeats++;} lastTick = now; capture();}, 25);
      window.__pdfExportObserver = new MutationObserver(capture); window.__pdfExportObserver.observe(dialog, {subtree: true, childList: true, characterData: true, attributes: true});
      const button = dialog.querySelector('.translate-document-button');
      button.addEventListener('click', () => {state.startedAt = Date.now(); state.startedPerf = performance.now(); lastTick = performance.now();}, {once: true});
    }, {cancel, cancelAfterPages});
    const stopMonitor = () => page.evaluate(() => {clearInterval(window.__pdfExportTimer); window.__pdfExportObserver?.disconnect(); const state = window.__pdfExportBenchmark; return {...state, cancelLatencyMs: state.canceledAt !== null && state.cancelRequestedAt !== null ? state.canceledAt - state.cancelRequestedAt : null};});
    const translated = [];
    for (const input of inputs) {
      report.currentDocument = path.basename(input);
      await checkFocus('inspect-source');
      const bytes = fs.readFileSync(input), inspectStart = Date.now(), sourcePages = await inspectPdf(bytes, requireRepo);
      const evidence = {input, sha256: sha(bytes), inputBytes: bytes.length, sourcePages: sourcePages.length, sourceInspectMs: Date.now() - inspectStart, exports: []}; report.inputs.push(evidence);
      fixture.resetDocument();
      const name = path.basename(input), requestStart = fixture.requests.length;
      await checkFocus('import');
      const importStart = Date.now();
      await page.locator('input[type=file]').setInputFiles({name, mimeType: 'application/pdf', buffer: bytes});
      await page.locator('.workspace-heading h1').filter({hasText: name}).waitFor({timeout: translationTimeout});
      await page.locator('.pdf-page-row[data-render-state="ready"] canvas').first().waitFor({timeout: translationTimeout}); evidence.importMs = Date.now() - importStart;
      console.log(JSON.stringify({stage: 'imported', label, name, pages: sourcePages.length, importMs: evidence.importMs}));
      evidence.batchTranslation = await page.locator('.document-batch-translation input').count() ? await page.locator('.document-batch-translation input').isChecked() : null;
      await checkFocus('translation');
      const translationStart = Date.now(); await page.locator('.taskbar-actions .translate-document-button').filter({hasText: '开始翻译'}).click();
      await page.locator('.document-status').filter({hasText: '翻译完成'}).waitFor({state: 'attached', timeout: translationTimeout});
      evidence.translationMs = Date.now() - translationStart; evidence.translationRequests = fixture.requests.length - requestStart;
      evidence.fixtureProtocol = {batchRequests: fixture.requests.slice(requestStart).filter(request => request.slots.length > 1).length, singleRequests: fixture.requests.slice(requestStart).filter(request => request.slots.length === 1).length};
      evidence.fixture = {expandedMarker: fixture.expandedMarker, expandedChars: fixture.responses.get(fixture.expandedMarker)?.length}; translated.push(name);
      console.log(JSON.stringify({stage: 'translated', label, name, translationMs: evidence.translationMs, requests: evidence.translationRequests, protocol: evidence.fixtureProtocol}));
      await checkFocus('translation-expectations');
      let snapshot;
      for (let attempt = 0; attempt < 40; attempt++) {
        snapshot = await historySnapshot(page, name);
        if (snapshot?.segments.length && snapshot.segments.every(segment => segment.translation.trim())) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      const finalExpectations = freezeFinalExpectations(snapshot, fixture);
      const snapshotText = JSON.stringify(snapshot, null, 2), expectationsText = JSON.stringify(finalExpectations, null, 2);
      const snapshotPath = path.join(artifactsDir, `${label}-${name}-segments.json`), expectationsPath = path.join(artifactsDir, `${label}-${name}-expected-targets.json`);
      fs.writeFileSync(snapshotPath, snapshotText); fs.writeFileSync(expectationsPath, expectationsText);
      evidence.segmentSnapshot = {path: snapshotPath, sha256: sha(snapshotText), sourceSnapshotSha256: finalExpectations.sourceSnapshotSha256,
        targetSnapshotSha256: finalExpectations.targetSnapshotSha256, segments: snapshot.segments.length,
        expectationsPath, expectationsSha256: sha(expectationsText), differences: {
          unchangedRawResponse: finalExpectations.records.filter(record => record.differenceType === 'unchanged-raw-response').length,
          protectedLiteralRestoration: finalExpectations.records.filter(record => record.differenceType === 'protected-literal-restoration').length,
        }};
      await checkFocus('translation-evidence');
      await shot(`${label}-${name}-translated`);
      evidence.resourceSnapshots = [await resourceSnapshot(page, 'before-cancel-export')];
      await checkFocus('cancel-export');
      const cancelDialog = await openDialog(modes[0]); await startMonitor(true);
      const cancellationDownloads = []; const onCanceledDownload = download => cancellationDownloads.push(download.suggestedFilename()); page.on('download', onCanceledDownload);
      await cancelDialog.locator('.translate-document-button').click();
      let cancelError;
      try {await page.waitForFunction(() => window.__pdfExportBenchmark?.canceledAt !== null, null, {timeout: exportTimeout});} catch (error) {cancelError = error.message;}
      const cancellation = await stopMonitor(); page.off('download', onCanceledDownload);
      Object.assign(cancellation, {error: cancelError, downloads: cancellationDownloads, responsive: cancellation.cancelLatencyMs !== null && cancellation.cancelLatencyMs <= cancelTimeout, retryEnabled: await page.locator('.download-dialog[open] .translate-document-button').isEnabled().catch(() => false)});
      evidence.cancellation = cancellation; await shot(`${label}-${name}-canceled`);
      evidence.resourceSnapshots.push(await resourceSnapshot(page, 'after-canceled-export'));
      console.log(JSON.stringify({stage: 'canceled', label, name, cancelLatencyMs: cancellation.cancelLatencyMs, heartbeatGapMs: cancellation.maxHeartbeatGapMs, responsive: cancellation.responsive}));
      if (layout === 'side-by-side') {assert(cancellation.responsive, `Cancellation did not complete within ${cancelTimeout}ms: ${JSON.stringify(cancellation)}`); assert.equal(cancellationDownloads.length, 0); assert(cancellation.retryEnabled);}
      if (cancelError) throw new Error(`Cancellation attempt did not settle: ${cancelError}`);
      for (const mode of modes) {
        report.currentMode = mode;
        await checkFocus('export');
        const dialog = await openDialog(mode); await startMonitor(false);
        const result = {mode}; evidence.exports.push(result);
        const downloadPromise = page.waitForEvent('download', {timeout: exportTimeout}).then(download => ({download, at: Date.now()}));
        void downloadPromise.catch(() => {}); // Guarded focus closure may reject the click before this promise is awaited.
        await dialog.locator('.translate-document-button').click();
        let downloaded;
        try {downloaded = await downloadPromise;} catch (error) {result.error = error.message; result.monitor = await stopMonitor(); await shot(`${label}-${name}-${mode}-timeout`); throw error;}
        result.monitor = await stopMonitor(); result.exportMs = downloaded.at - result.monitor.startedAt;
        result.resourceSnapshot = await resourceSnapshot(page, 'after-complete-export');
        console.log(JSON.stringify({stage: 'exported', label, name, mode, exportMs: result.exportMs, heartbeatGapMs: result.monitor.maxHeartbeatGapMs}));
        await checkFocus('save-download');
        const saveStart = Date.now(), output = path.join(artifactsDir, `${label}-${name.replace(/\.pdf$/iu, '')}-${mode}.pdf`);
        await downloaded.download.saveAs(output); result.saveMs = Date.now() - saveStart; result.output = output;
        const outputBytes = fs.readFileSync(output); result.bytes = outputBytes.length; result.sha256 = sha(outputBytes);
        await checkFocus('reopen-validate');
        const reopenStart = Date.now(), outputPages = await inspectPdf(outputBytes, requireRepo); result.reopenMs = Date.now() - reopenStart; result.pages = outputPages.length;
        result.validation = validateOutput(sourcePages, outputPages, fixture, mode, layout, finalExpectations);
        await checkFocus('render-previews');
        const renderStart = Date.now(); result.previews = await renderPdfSamples(output, outputPages.length, artifactsDir, `${label}-${name.replace(/\.pdf$/iu, '')}-${mode}`, pdftoppm); result.renderMs = Date.now() - renderStart;
        fs.writeFileSync(path.join(artifactsDir, `${label}-${name}-${mode}-page-validation.json`), JSON.stringify(result.validation, null, 2));
        // Evidence is emitted before an assertion so baseline/fixed failures
        // retain the output PDF and timing for independent investigation.
        await checkFocus('validate-output'); persist();
        if (layout === 'side-by-side') assert(result.validation.semanticOk, `Export page/content validation failed for ${name}/${mode}: ${JSON.stringify(result.validation.checks)}`);
      }
      delete report.currentMode;
      if (input !== inputs.at(-1)) {
        await checkFocus('change-document');
        const settings = page.locator('aside.document-sidebar').getByRole('button', {name: '调整文档翻译设置', exact: true});
        if (!await settings.isVisible()) await page.locator('.sidebar-toggle').click(); await settings.click();
        await page.locator('.document-settings-dialog[open] .sidebar-change-file').click();
        const confirm = page.locator('dialog[open]').filter({has: page.locator('#confirm-document-heading')});
        if (await confirm.count()) await confirm.locator('.translate-document-button').click(); await page.locator('.file-drop-zone').waitFor();
      }
    }
    delete report.currentDocument;
    report.fixtureRequests = fixture.requests.length;
    await checkFocus('completed'); report.finalFrontmostApplication = report.focusChecks.at(-1).application;
    assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors)); report.ok = true;
  } catch (error) {
    report.failure = (focusFailure || error).stack || String(focusFailure || error); if (page && !focusFailure) await page.screenshot({path: path.join(artifactsDir, 'failure.png')}).catch(() => {}); throw focusFailure || error;
  } finally {
    report.currentPhase = 'cleanup';
    let closed = false;
    if (launched) {try {await launched.close(); closed = true;} catch (error) {report.cleanupErrors.push(`browser close: ${error.stack || error}`);}}
    try {await fixture?.close();} catch (error) {report.cleanupErrors.push(`fixture close: ${error.message}`);}
    if (closed) {try {fs.rmSync(profileDir, {recursive: true, force: true});} catch (error) {report.cleanupErrors.push(`profile removal: ${error.message}`); report.retainedProfile = profileDir;}}
    else if (!launchAttempted) fs.rmdirSync(profileDir); else report.retainedProfile = profileDir;
    if (focusMonitor) {try {await focusMonitor.stop();} catch (error) {report.cleanupErrors.push(`focus observer close: ${error.stack || error}`);}}
    if (focusFailure) {report.ok = false; process.exitCode = 1;}
    if (report.cleanupErrors.length) {report.ok = false; process.exitCode = 1;}
    persist();
    console.log(JSON.stringify({ok: report.ok, label, report: path.join(artifactsDir, 'report.json'), inputs: report.inputs.map(input => ({input: input.input, pages: input.sourcePages, cancellationMs: input.cancellation?.cancelLatencyMs, exports: input.exports.map(result => ({mode: result.mode, exportMs: result.exportMs, pages: result.pages, bytes: result.bytes, semanticOk: result.validation?.semanticOk}))})), failure: report.failure, cleanupErrors: report.cleanupErrors}));
  }
}

main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
