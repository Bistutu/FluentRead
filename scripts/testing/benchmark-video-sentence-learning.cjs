/**
 * @file scripts/testing/benchmark-video-sentence-learning.cjs
 * 文件职责：在当前工作树中对照指定不可变 Git 基线与完整句学习核心，输出可复跑的本地性能证据。
 * 主要内容：读取两份核心的基线与当前源码，记录 SHA-256，使用 Vite 已解析的 esbuild 临时编译；验证查询和聚合等价，再测量查句、构建与空闲播放事件。
 * 模块边界：不启动浏览器、播放视频或请求翻译服务，不改源码或构建产物；临时编译目录始终清理，需通过资源安全入口运行。
 */
'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const {createRequire} = require('node:module');
const os = require('node:os');
const path = require('node:path');
const {performance} = require('node:perf_hooks');

const SOURCE_FILES = {
  timeline: 'src/features/video-subtitle/content/sentenceTimeline.ts',
  playback: 'src/features/video-subtitle/content/sentencePlayback.ts',
};
const PARAMETERS = {
  sentenceCounts: [120, 2400, 12000],
  patterns: ['ordinary', 'overlap'],
  queryIterations: 10000,
  aggregationCueCount: 12000,
  idleEventsPerRound: 100000,
  warmupRounds: 3,
  measuredRounds: 7,
};

function readArgs() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') return null;
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!['--baseline', '--output'].includes(option) || !args[index + 1] || result[option]) {
      throw new Error('用法：--baseline <Git提交SHA> --output <JSON文件>');
    }
    result[option] = args[index + 1];
  }
  if (!/^[a-f\d]{7,40}$/iu.test(result['--baseline'] || '') || !result['--output']) {
    throw new Error('必须显式提供基线提交 SHA 与 JSON 输出路径。');
  }
  return {baseline: result['--baseline'], output: result['--output']};
}

const median = values => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
const summarize = (samplesMs, checksum) => ({medianMs: median(samplesMs), samplesMs, checksum});

function measure(operation) {
  for (let round = 0; round < PARAMETERS.warmupRounds; round += 1) operation();
  const samples = [];
  let checksum;
  for (let round = 0; round < PARAMETERS.measuredRounds; round += 1) {
    const start = performance.now();
    checksum = operation();
    samples.push(performance.now() - start);
  }
  return summarize(samples, checksum);
}

function compare(baseline, candidate) {
  const operations = [baseline, candidate];
  const samples = [[], []];
  const checksums = [];
  for (let round = 0; round < PARAMETERS.warmupRounds; round += 1) operations.forEach(operation => operation());
  for (let round = 0; round < PARAMETERS.measuredRounds; round += 1) {
    // 交替先后顺序，避免把单边 JIT 和升温顺序当成性能变化。
    for (const index of round % 2 ? [1, 0] : [0, 1]) {
      const start = performance.now();
      checksums[index] = operations[index]();
      samples[index].push(performance.now() - start);
    }
  }
  return {baseline: summarize(samples[0], checksums[0]), candidate: summarize(samples[1], checksums[1])};
}

function idleFixture(Playback, connected) {
  let connectedReads = 0;
  let stateChanges = 0;
  class Media extends EventTarget {
    currentTime = 0;
    paused = false;
    seeking = false;
    ended = false;
    get isConnected() { connectedReads += 1; return connected; }
    play() { return Promise.resolve(); }
    pause() {}
  }
  const media = new Media();
  const controller = new Playback.SentencePlaybackController(media, {
    request() { throw new Error('未选句时不应创建动画帧。'); }, cancel() {},
  }, () => { stateChanges += 1; });
  const event = new Event('timeupdate');
  return {
    dispatch() {
      for (let index = 0; index < PARAMETERS.idleEventsPerRound; index += 1) media.dispatchEvent(event);
      return connectedReads;
    },
    finish() {
      assert.deepEqual(controller.getState(), {mode: 'off', sentence: null, pausedAtEnd: false});
      controller.destroy();
      return {connectedReads, stateChangesIncludingDestroy: stateChanges};
    },
  };
}

function main() {
  const args = readArgs();
  if (!args) {
    console.log('在工作树根目录运行：node scripts/testing/run-resource-safe.mjs -- node scripts/testing/benchmark-video-sentence-learning.cjs --baseline <SHA> --output <report.json>');
    return;
  }
  const root = fs.realpathSync(process.cwd());
  const git = argv => execFileSync('git', argv, {cwd: root, encoding: 'utf8'}).trimEnd();
  assert.equal(fs.realpathSync(git(['rev-parse', '--show-toplevel'])), root, '请从工作树根目录运行。');
  const baselineCommit = git(['rev-parse', '--verify', `${args.baseline}^{commit}`]);
  const esbuild = createRequire(require.resolve('vite'))('esbuild');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-video-learning-core-'));
  const report = {
    schemaVersion: 1,
    scope: 'Node 本地纯核心处理；不代表视频、浏览器渲染、翻译服务或端到端操作延迟。',
    generatedAt: new Date().toISOString(),
    environment: {node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model},
    compilation: {tool: 'esbuild', version: esbuild.version, target: 'node20', minify: false},
    parameters: PARAMETERS,
    sources: {baseline: {commit: baselineCommit, files: {}}, candidate: {headCommit: git(['rev-parse', 'HEAD']), files: {}}},
    equivalence: {lookupQueriesChecked: 0, aggregation: false, idleFinalState: false},
    lookup: [],
  };
  const modules = {baseline: {}, candidate: {}};
  try {
    for (const [name, file] of Object.entries(SOURCE_FILES)) {
      // git show 保留原始换行；哈希基于编译前的实际 UTF-8 源码。
      const original = execFileSync('git', ['show', `${baselineCommit}:${file}`], {cwd: root, encoding: 'utf8'});
      const current = fs.readFileSync(path.join(root, file), 'utf8');
      for (const [label, source] of [['baseline', original], ['candidate', current]]) {
        report.sources[label].files[file] = {sourceHash: createHash('sha256').update(source).digest('hex'), bytes: Buffer.byteLength(source)};
        const output = path.join(temporary, `${name}-${label}.cjs`);
        fs.writeFileSync(output, esbuild.transformSync(source, {
          loader: 'ts', format: 'cjs', platform: 'node', target: 'node20', sourcefile: file, minify: false,
        }).code);
        modules[label][name] = require(output);
      }
    }
    const baseline = modules.baseline.timeline;
    const candidate = modules.candidate.timeline;
    assert.equal(typeof candidate.createVideoSentenceTimeIndex, 'function', '当前版本必须提供显式查句快照。');
    for (const count of PARAMETERS.sentenceCounts) {
      for (const pattern of PARAMETERS.patterns) {
        const cues = Array.from({length: count}, (_, index) => ({text: `Sentence ${index}.`, startMs: index * 1000,
          durationMs: pattern === 'overlap' && index % 29 === 0 ? count * 1000 : 800}));
        const sentences = baseline.buildVideoSentenceTimeline(cues);
        assert.deepEqual(candidate.buildVideoSentenceTimeline(cues), sentences);
        const queries = Array.from({length: PARAMETERS.queryIterations}, (_, index) =>
          ((index * 7919) % (count * 1000 + 1000)) + (index % 3 ? 250 : 850));
        const oldFind = milliseconds => {
          const sentence = baseline.findVideoSentenceAtTime(sentences, milliseconds);
          return sentence ? sentences.indexOf(sentence) : -1;
        };
        const start = performance.now();
        const index = candidate.createVideoSentenceTimeIndex(sentences);
        const firstBuildMs = performance.now() - start;
        const newFind = milliseconds => index.findIndexAtTime(milliseconds);
        assert.deepEqual(queries.map(newFind), queries.map(oldFind), `查句不等价：${count}/${pattern}`);
        report.equivalence.lookupQueriesChecked += queries.length;
        const construction = measure(() => candidate.createVideoSentenceTimeIndex(sentences).findIndexAtTime(queries[0]));
        const timings = compare(() => queries.reduce((sum, time) => sum + oldFind(time), 0),
          () => queries.reduce((sum, time) => sum + newFind(time), 0));
        assert.equal(timings.baseline.checksum, timings.candidate.checksum);
        report.lookup.push({count, pattern, queryIterations: queries.length, firstBuildMs, construction, ...timings});
      }
    }
    const aggregationCues = Array.from({length: PARAMETERS.aggregationCueCount}, (_, index) => ({
      text: index % 4 === 0 ? '这是原始字幕没有标点' : `unpunctuated subtitle fragment ${index}`,
      startMs: index * 800, durationMs: 900,
    }));
    assert.deepEqual(candidate.buildVideoSentenceTimeline(aggregationCues), baseline.buildVideoSentenceTimeline(aggregationCues));
    report.equivalence.aggregation = true;
    report.aggregation = {cueIterations: aggregationCues.length, ...compare(
      () => baseline.buildVideoSentenceTimeline(aggregationCues).length,
      () => candidate.buildVideoSentenceTimeline(aggregationCues).length)};
    report.idle = [];
    for (const connected of [false, true]) {
      const before = idleFixture(modules.baseline.playback, connected);
      const after = idleFixture(modules.candidate.playback, connected);
      const timings = compare(() => before.dispatch(), () => after.dispatch());
      report.idle.push({connected, eventsPerRound: PARAMETERS.idleEventsPerRound,
        baseline: {...timings.baseline, ...before.finish()}, candidate: {...timings.candidate, ...after.finish()}});
    }
    report.equivalence.idleFinalState = true;
    report.status = 'passed';
    const output = path.resolve(root, args.output);
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({status: report.status, baselineCommit, output: path.relative(root, output),
      equivalence: report.equivalence, lookup: report.lookup.map(item => ({count: item.count, pattern: item.pattern,
        baselineMs: item.baseline.medianMs, candidateMs: item.candidate.medianMs, buildMedianMs: item.construction.medianMs}))}, null, 2));
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}

try { main(); } catch (error) { console.error(error.stack || String(error)); process.exitCode = 1; }
