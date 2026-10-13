#!/usr/bin/env node
'use strict';

/**
 * @file scripts/testing/run-pdf-export-benchmark-policy-test.cjs
 * 文件职责：离线证明大型 PDF mock 下限在浏览器、fixture 和原生监测启动前执行。
 * 主要内容：真实 92 页拒绝、合成 300 页接受、下限不可调低、提高下限会生效，以及普通执行路径也先拒绝。
 * 模块边界：只启动 Node 子进程读取公开 PDF 页数，不发网络请求、不创建浏览器实例。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

const arg = (name, fallback) => {const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1];};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const benchmark = path.join(__dirname, 'run-pdf-export-benchmark.cjs');
const ordinaryArgument = arg('ordinary-input'), stressArgument = arg('stress-input');
assert(ordinaryArgument && stressArgument, 'Required: --ordinary-input <92-page PDF> --stress-input <300-page PDF>');
const ordinary = path.resolve(ordinaryArgument), stress = path.resolve(stressArgument);
const reportPath = path.resolve(arg('report', path.join(os.tmpdir(), 'fluentread-pdf-mock-policy-regression.json')));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-pdf-policy-only-'));
const cases = [];
const run = (args) => {
  const result = spawnSync(process.execPath, [benchmark, ...args], {encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024});
  assert.ifError(result.error); assert.equal(result.signal, null);
  return result;
};
const decode = result => JSON.parse(result.stdout);
try {
  assert(fs.existsSync(ordinary) && fs.existsSync(stress), 'Both public ordinary and generated stress PDFs must exist');
  const small = run(['--preflight-only', '--inputs', ordinary]);
  assert.equal(small.status, 1);
  const smallReport = decode(small);
  assert.equal(smallReport.ok, false); assert.equal(smallReport.browserStarted, false);
  assert.equal(smallReport.mockPolicy.minimumPages, 300); assert.equal(smallReport.mockPolicy.inputs[0].pages, 92);
  assert.match(smallReport.mockPolicy.rejectedInputGuidance, /run-document-live-translation/u);
  cases.push('92-page actual document rejected before browser startup');

  const large = run(['--preflight-only', '--inputs', stress]);
  assert.equal(large.status, 0);
  const largeReport = decode(large);
  assert.equal(largeReport.ok, true); assert.equal(largeReport.browserStarted, false);
  assert.equal(largeReport.mockPolicy.inputs[0].pages, 300);
  cases.push('300-page synthetic input accepted without starting a browser');

  const lowered = run(['--preflight-only', '--inputs', stress, '--mock-min-pages', '299']);
  assert.equal(lowered.status, 1); assert.match(lowered.stderr, /integer >=300/u);
  cases.push('mock lower bound cannot be reduced below 300 pages');

  const raised = run(['--preflight-only', '--inputs', stress, '--mock-min-pages', '400']);
  assert.equal(raised.status, 1); assert.equal(decode(raised).mockPolicy.minimumPages, 400);
  assert.equal(decode(raised).browserStarted, false);
  cases.push('caller may raise the minimum to 400 pages');

  const rejectedDirectory = path.join(directory, 'rejected-normal-path');
  const normal = run(['--inputs', ordinary, '--artifacts-dir', rejectedDirectory]);
  assert.equal(normal.status, 1); assert.match(normal.stderr, /Mock is restricted/u);
  const rejectedReport = JSON.parse(fs.readFileSync(path.join(rejectedDirectory, 'report.json')));
  assert.equal(rejectedReport.browserStarted, false); assert.equal(rejectedReport.ok, false);
  assert.equal(rejectedReport.ownedBrowserPid, undefined); assert.equal(rejectedReport.focusObserver, undefined);
  cases.push('normal benchmark path rejects 92 pages before Playwright arguments or profile creation');

  const expectationRegression = run(['--self-test-expectations']);
  assert.equal(expectationRegression.status, 0); assert.equal(decode(expectationRegression).ok, true);
  cases.push('full-target, missing-note-marker, and synthetic page-order offline regressions pass');

  const report = {ok: true, scope: 'Offline public-PDF mock policy tests; no browser, fixture server, native helper, or network',
    benchmarkSha256: sha(fs.readFileSync(benchmark)), inputs: [{path: ordinary, sha256: sha(fs.readFileSync(ordinary)), pages: 92},
      {path: stress, sha256: sha(fs.readFileSync(stress)), pages: 300}], cases,
    smallPreflight: smallReport, largePreflight: largeReport, expectationCases: decode(expectationRegression).cases};
  fs.mkdirSync(path.dirname(reportPath), {recursive: true}); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ok: true, report: reportPath, cases: cases.length, expectationCases: report.expectationCases.length}));
} finally {
  fs.rmSync(directory, {recursive: true, force: true});
}
