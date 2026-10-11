/**
 * @file gzip-pareto-measure.mjs
 * 只读最终 userscript 的实际 gzip literal；比较五种静态数据候选，不执行 IIFE 或改写产物。
 * 运行前必须取得共享 resource-safe 60/1/1 槽位。输出只含公共源码路径、哈希、参数与计数。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {gzipSync, gunzipSync, constants as zlibConstants} from 'node:zlib';

const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  assert.ok(key?.startsWith('--') && process.argv[index + 1], 'Expected named key/value arguments');
  options[key.slice(2)] = process.argv[index + 1];
}
for (const required of ['repo', 'artifact', 'expected-sha', 'tree', 'mode', 'output']) {
  assert.ok(options[required], 'Missing argument: ' + required);
}
assert.equal(process.env.FLUENTREAD_RESOURCE_LOCK_HELD, '1', 'Use the shared resource-safe guard');
assert.equal(process.env.FLUENTREAD_TEST_CPU_TARGET, '60');
assert.equal(process.env.FLUENTREAD_TEST_MAX_WORKERS, '1');
assert.equal(process.env.FLUENTREAD_TEST_CONCURRENCY, '1');
assert.match(options.tree, /^[a-f0-9]{40}$/u);
assert.match(options['expected-sha'], /^[a-f0-9]{64}$/u);
assert.ok(['standard', 'standalone'].includes(options.mode));
const repo = path.resolve(options.repo);
assert.ok(!path.isAbsolute(options.artifact) && !options.artifact.split('/').includes('..'), 'Artifact must be a repository-relative path');
const artifactPath = path.resolve(repo, options.artifact);
const outputPath = path.resolve(options.output);
assert.ok(!fs.existsSync(outputPath), 'Do not overwrite an existing measurement');
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const pako = require('pako');
const hash = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, {cwd: repo, encoding: 'utf8'}).trim();
assert.equal(git(['cat-file', '-t', options.tree]), 'tree');
const sourceScope = ['src', 'userscript', 'scripts', 'package.json', 'pnpm-lock.yaml'];
const changedSource = git(['diff', '--name-only', options.tree, '--', ...sourceScope]);
assert.equal(changedSource, '', 'The source tree has changed; obtain a new binding before measuring');
const originalBytes = fs.readFileSync(artifactPath);
assert.equal(hash(originalBytes), options['expected-sha'], 'Artifact SHA does not match the original build receipt');
const originalText = originalBytes.toString('utf8');
assert.deepEqual(Buffer.from(originalText, 'utf8'), originalBytes, 'Artifact is not lossless UTF-8');
const ast = ts.createSourceFile('fluent-read.user.js', originalText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(ast.parseDiagnostics.length, 0, 'Final artifact contains a syntax diagnostic');

const sourceInputByDigest = new Map();
for (const name of ['established', 'websites', 'profiles']) {
  const relativePath = `src/core/site-adaptation/catalog/${name}.json`;
  const input = Buffer.from(JSON.stringify(JSON.parse(fs.readFileSync(path.join(repo, relativePath), 'utf8'))));
  sourceInputByDigest.set(hash(input), {name: `catalog:${name}`, kind: 'catalog', controlled: true, sourcePath: relativePath});
}
for (const [relativePath, mode] of [
  ['src/core/language/chineseVariants.ts', 'delta'],
  ['src/core/language/functionWordData.ts', 'strings'],
]) {
  const code = fs.readFileSync(path.join(repo, relativePath), 'utf8');
  const source = ts.createSourceFile(relativePath, code, ts.ScriptTarget.Latest, true);
  const tables = [];
  for (const statement of source.statements) {
    assert.ok(ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
    assert.ok(statement.declarationList.flags & ts.NodeFlags.Const);
    for (const declaration of statement.declarationList.declarations) {
      assert.ok(ts.isIdentifier(declaration.name) && declaration.initializer);
      assert.ok(ts.isStringLiteral(declaration.initializer) || ts.isNoSubstitutionTemplateLiteral(declaration.initializer));
      if (mode === 'strings') tables.push(declaration.initializer.text);
      else {
        let previous = 0;
        tables.push(Array.from(declaration.initializer.text, character => {
          const point = character.codePointAt(0);
          const delta = point - previous;
          previous = point;
          return delta;
        }));
      }
    }
  }
  const input = Buffer.from(JSON.stringify(tables));
  sourceInputByDigest.set(hash(input), {name: `language:${mode}`, kind: 'character-data', controlled: false, sourcePath: relativePath});
}

const assets = [];
function visit(node) {
  if (ts.isStringLiteral(node) && node.text.startsWith('H4sI') && /^[A-Za-z0-9+/]+={0,2}$/u.test(node.text)) {
    const gzip = Buffer.from(node.text, 'base64');
    if (gzip.length >= 18 && gzip[0] === 0x1f && gzip[1] === 0x8b && gzip.toString('base64') === node.text) {
      const decoded = gunzipSync(gzip);
      const digest = hash(decoded);
      let label = sourceInputByDigest.get(digest);
      if (!label && ts.isBinaryExpression(node.parent) && node.parent.right === node
          && node.parent.left.getText(ast) === 'globalThis.__fluentReadUserscriptCssCompressed') {
        label = {name: 'css:final-bundle', kind: 'css', controlled: true, sourcePath: 'userscript/vite.config.ts'};
      }
      if (!label) {
        let json;
        try {json = JSON.parse(decoded.toString('utf8'));} catch {}
        if (json?.messages && json?.legacyText && json?.legacyPatterns) {
          label = {name: 'ui:en-US', kind: 'ui', controlled: true, sourcePath: 'userscript/vite.config.ts'};
        } else if (json && !Array.isArray(json) && Object.values(json).every(value => typeof value === 'string')
            && Object.keys(json).some(key => key.startsWith('contextMenu.'))) {
          label = {name: 'ui:zh-CN-projection', kind: 'ui', controlled: true, sourcePath: 'userscript/vite.config.ts'};
        }
      }
      assert.ok(label, 'Unclassified actual gzip asset with decoded SHA: ' + digest);
      const start = node.getStart(ast);
      const end = node.end;
      const literal = originalText.slice(start, end);
      const quote = literal[0];
      assert.ok((quote === '"' || quote === "'") && literal.at(-1) === quote && literal.slice(1, -1) === node.text,
        'Expected a plain canonical base64 literal');
      assert.deepEqual(Buffer.from(pako.ungzip(gzip)), decoded, 'Current static gzip must decode with the installed pako');
      assets.push({...label, start, end, quote, gzip, decoded, decodedSha256: digest, base64: node.text});
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assets.sort((left, right) => left.start - right.start);
assert.equal(new Set(assets.map(asset => asset.name)).size, 8, 'Expected the eight known unique final gzip assets');
assert.equal(assets.filter(asset => asset.controlled).length, 6, 'Expected six #906-controlled gzip assets');
assert.equal(assets.length, 8, 'Unexpected repeated or missing gzip literals; revise the accounting instead of guessing');

const encoders = {
  pako9: {backend: 'pako', options: {level: 9}, cost: 'One existing encoder and one uniform parameter set.'},
  'pako9-mem9': {backend: 'pako', options: {level: 9, memLevel: 9}, cost: 'One explicit non-default memory parameter; encoder memory/time not measured.'},
  'pako9-filtered': {backend: 'pako', options: {level: 9, strategy: zlibConstants.Z_FILTERED}, cost: 'One explicit strategy parameter; gzip stays compatible, compression/decode performance unknown.'},
  zlib9: {backend: 'zlib', options: {level: 9}, cost: 'Original zlib path for catalogs/CSS; keeps two build encoders.'},
  'zlib9-window13': {backend: 'zlib', options: {level: 9, windowBits: 13}, cost: 'Changes the static-data encoder and its history window; runtime/memory tradeoff not measured.'},
};
function encode(asset, key) {
  const encoder = encoders[key];
  const bytes = encoder.backend === 'pako' ? Buffer.from(pako.gzip(asset.decoded, encoder.options))
    : gzipSync(asset.decoded, encoder.options);
  assert.deepEqual(gunzipSync(bytes), asset.decoded, 'Candidate zlib decoded bytes changed');
  assert.deepEqual(Buffer.from(pako.ungzip(bytes)), asset.decoded, 'Candidate pako decoded bytes changed');
  return {bytes, base64: bytes.toString('base64'), encoder: key};
}
const encoded = new Map();
for (const asset of assets.filter(item => item.controlled)) {
  const variants = Object.fromEntries(Object.keys(encoders).map(key => [key, encode(asset, key)]));
  assert.deepEqual(variants.pako9.bytes, asset.gzip, 'pako9 baseline must reproduce the actual final artifact');
  encoded.set(asset.name, variants);
}
const baselineSelection = new Map(assets.filter(asset => asset.controlled).map(asset => [asset.name, encoded.get(asset.name).pako9]));
const originalPathSelection = new Map(assets.filter(asset => asset.controlled).map(asset => [asset.name,
  encoded.get(asset.name)[asset.kind === 'ui' ? 'pako9' : 'zlib9']]));
const rounds = [
  {id: 'R1', name: 'original-zlib9-path', hypothesis: 'Restoring only the original catalog/CSS zlib9 path changes final bytes versus pako9.', selection: originalPathSelection},
  {id: 'R2', name: 'pako9-mem9', hypothesis: 'Increasing pako memory changes compressed size for the six controlled assets.', encoder: 'pako9-mem9'},
  {id: 'R3', name: 'pako9-filtered', hypothesis: 'The FILTERED strategy improves data compression without changing decoded bytes.', encoder: 'pako9-filtered'},
  {id: 'R4', name: 'zlib9-window13', hypothesis: 'A smaller zlib history window can trade compression size for a different parameter set.', encoder: 'zlib9-window13'},
  {id: 'R5', name: 'per-asset-minimum-mixture', hypothesis: 'A per-asset combination refutes a claim that uniform pako9 is individually size-optimal.', mixed: true},
];
for (const round of rounds) {
  if (round.encoder) round.selection = new Map(assets.filter(asset => asset.controlled)
    .map(asset => [asset.name, encoded.get(asset.name)[round.encoder]]));
  if (round.mixed) {
    round.selection = new Map(assets.filter(asset => asset.controlled).map(asset => {
      const variants = encoded.get(asset.name);
      const candidates = [variants.pako9, originalPathSelection.get(asset.name), variants['pako9-mem9'], variants['pako9-filtered'], variants['zlib9-window13']];
      // Baseline is first and wins a tie; fewer gzip bytes do not necessarily reduce padded base64 bytes.
      const best = candidates.reduce((current, candidate) => candidate.base64.length < current.base64.length ? candidate : current);
      return [asset.name, best];
    }));
  }
}
function outputStats(selection) {
  let counterfactual = originalText;
  for (const asset of [...assets].reverse()) {
    if (!asset.controlled) continue;
    const chosen = selection.get(asset.name);
    counterfactual = counterfactual.slice(0, asset.start) + asset.quote + chosen.base64 + asset.quote + counterfactual.slice(asset.end);
  }
  const bytes = Buffer.from(counterfactual, 'utf8');
  const perAsset = assets.map(asset => {
    const chosen = asset.controlled ? selection.get(asset.name) : {bytes: asset.gzip, base64: asset.base64, encoder: 'unchanged-character-plugin-zlib9'};
    return {name: asset.name, controlled: asset.controlled, sourcePath: asset.sourcePath,
      decodedBytes: asset.decoded.length, decodedSha256: asset.decodedSha256,
      encoder: chosen.encoder, gzipBytes: chosen.bytes.length, gzipSha256: hash(chosen.bytes),
      base64Bytes: Buffer.byteLength(chosen.base64), gzipDeltaBytes: chosen.bytes.length - asset.gzip.length,
      base64DeltaBytes: Buffer.byteLength(chosen.base64) - Buffer.byteLength(asset.base64)};
  });
  const base64Delta = perAsset.reduce((sum, asset) => sum + asset.base64DeltaBytes, 0);
  assert.equal(bytes.length - originalBytes.length, base64Delta, 'Full output delta must equal actual literal byte deltas');
  return {fullOutputBytes: bytes.length, fullOutputDeltaBytes: bytes.length - originalBytes.length,
    fullOutputSha256: hash(bytes), perAsset};
}
const baseline = outputStats(baselineSelection);
assert.equal(baseline.fullOutputSha256, options['expected-sha']);
const results = rounds.map(round => {
  const stats = outputStats(round.selection);
  const used = [...new Set([...round.selection.values()].map(item => item.encoder))];
  return {id: round.id, name: round.name, hypothesis: round.hypothesis, ...stats,
    encoderKindsUsed: used,
    maintenance: round.mixed ? 'Per-asset routing/manifest and maintenance of chosen parameters; dispatch-code bytes are not included in this literal-only counterfactual.'
      : round.name === 'original-zlib9-path' ? encoders.zlib9.cost : encoders[round.encoder].cost};
});
assert.equal(hash(fs.readFileSync(artifactPath)), options['expected-sha'], 'The original artifact changed during measurement');
assert.equal(git(['diff', '--name-only', options.tree, '--', ...sourceScope]), '', 'The source changed during measurement');
const result = {
  schemaVersion: 1, generatedAtUTC: new Date().toISOString(), sourceTree: options.tree,
  artifact: {mode: options.mode, relativePath: options.artifact, bytes: originalBytes.length, sha256: options['expected-sha'], unchanged: true},
  sourceMatchesTreeBeforeAndAfter: true,
  sourceBinding: 'The supplied SHA is checked against the original artifact; its original build receipt provides build-to-tree provenance.',
  toolchain: {node: process.version, zlib: process.versions.zlib, pako: require('pako/package.json').version, typescript: require('typescript/package.json').version},
  resourceGuard: {cpuTargetPercent: 60, workers: 1, concurrency: 1, sharedLockRequired: true},
  encoders, baseline: {...baseline, countedAsCandidateRound: false}, rounds: results,
  scope: {distinctCandidateRounds: 5, actualGzipAssets: assets.length, controlledAssets: 6,
    gzipBytesAndBase64BytesMeasured: true, decodedShaMatchesForEveryCandidate: true,
    completeOutputBytes: 'Exact literal-replacement counterfactual on the same final artifact; no rebuild or artifact write.',
    mixedDispatchCodeBytesIncluded: false, originalArtifactExecuted: false,
    encodingTime: 'unknown', encodingRSS: 'unknown', browserDecodePerformance: 'unknown', runtimePerformance: 'unknown',
    sotaClaim: false, optimalityClaim: false, noProductionFilesChanged: true, noBrowserLaunched: true, noNetworkCalls: true},
};
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
process.stdout.write(JSON.stringify({passed: true, mode: options.mode, actualGzipAssets: assets.length,
  artifactSha256: options['expected-sha'], baselineBytes: originalBytes.length,
  rounds: results.map(round => ({id: round.id, deltaBytes: round.fullOutputDeltaBytes, bytes: round.fullOutputBytes})),
  evidenceSha256: hash(fs.readFileSync(outputPath))}) + '\n');
