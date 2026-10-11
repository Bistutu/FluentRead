/** Evidence-only two-build diagnostic. Root runs serially under resource60/1/1.
 * Reproduces the frozen original configuration in a separate output directory,
 * then removes only three exact generic-library external/global entries in RAM.
 * This does not run or replace the release wrapper or any immutable guard.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const evidence = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidence, '../FluentRead-pr906-main-merge-20261010');
const commit = '1a39eb1b1fb0c65766b61c7c0b66a0dfc2dfb0fa';
const tree = '05c5e75b7fdc115d0fea6202d771d5cf50588193';
const expectedNormalSha = 'b47c0cb5457ca920e35c695a77a671f5fbdeb26bceb328abc6fd36d6c8c75d19';
const expectedNormalBytes = 2316434;
const selected = ['zod', '@ai-sdk/anthropic', '@ai-sdk/google'];
const selectedGlobals = {
    zod: 'FluentReadUserscriptVendor.zod',
    '@ai-sdk/anthropic': 'FluentReadUserscriptVendor.anthropic',
    '@ai-sdk/google': 'FluentReadUserscriptVendor.google',
};
const expectedFiles = {
    'userscript/vite.config.ts': '4534abd8f64d768cf73e2e8d0276e86287b136c765e5b061173f3dfdfa2421c3',
    'userscript/vendorEntry.ts': '5a606971b8ec527ed7afc68808f7f80857766cdfe2a24d51b84c41e546bd8398',
    'userscript/vendor.vite.config.ts': 'd8c8f930a0dfa33dc06fd0fc4f5a147c9ad8bce3165f7856803e24974a570e1c',
    'pnpm-lock.yaml': 'dca737aeb9c264e2c3078588ff01c85dd52d48636f7fa24b2451f9444a8ccc3a',
    'userscript/resources/fluentread-vendor.v1.js': '97043572b031723354cc35521f81e8a0da890c41f1b0fecf430a72fa6df00a39',
    'userscript/resources/fluentread-data.v1.js': '4f49c29957c9caf94674a52a698312a17ac36608524127919fe524617b935ddf',
    'scripts/build-userscript-greasyfork.mjs': 'c2e441c5749d48e317b90e0052c275e58b3f14cd9f55df9ae10ade78c96792c8',
    'scripts/verify-userscript-greasyfork-build.mjs': 'f732027c097fd87b87e57c24d29bd84740d66057f037ba1f722ac9e4970e0d83',
};
const normalPath = path.join(repo, '.output/userscript-greasyfork/fluent-read.user.js');
const reportPath = path.join(evidence, 'GF-READING-GENERIC-ROOTS-DIAGNOSTIC.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, {cwd: repo, encoding: 'utf8'}).trim();
const sourcePaths = ['src', 'userscript', 'public', 'entrypoints', 'scripts', 'package.json', 'pnpm-lock.yaml'];

function assertSource() {
    assert.equal(git(['rev-parse', 'HEAD']), commit, 'Source HEAD changed');
    assert.equal(git(['rev-parse', 'HEAD^{tree}']), tree, 'Source tree changed');
    execFileSync('git', ['diff', '--exit-code', commit, '--', ...sourcePaths], {cwd: repo, stdio: 'pipe'});
    assert.equal(git(['log', '-1', '--format=%H', '--',
        'userscript/resources/fluentread-vendor.v1.js', 'userscript/resources/fluentread-data.v1.js']),
    commit, 'Resource commit differs');
    const files = {};
    for (const [name, expected] of Object.entries(expectedFiles)) {
        const bytes = fs.readFileSync(path.join(repo, name));
        assert.equal(hash(bytes), expected, `Frozen source/resource changed: ${name}`);
        files[name] = {bytes: bytes.length, sha256: hash(bytes)};
    }
    const normal = fs.readFileSync(normalPath);
    assert.equal(normal.length, expectedNormalBytes, 'Saved normal wrapper length differs');
    assert.equal(hash(normal), expectedNormalSha, 'Saved normal wrapper SHA differs');
    return {files, normal};
}

function publicId(id) {
    const normalized = id.replaceAll('\\', '/');
    const repoPrefix = repo.replaceAll('\\', '/') + '/';
    if (normalized.startsWith(repoPrefix)) return normalized.slice(repoPrefix.length);
    const modulesAt = normalized.indexOf('/node_modules/');
    if (modulesAt >= 0) return normalized.slice(modulesAt + 1);
    if (path.isAbsolute(id)) return `outside-source:${path.basename(id)}`;
    return normalized;
}

assert.ok(!fs.existsSync(reportPath), 'Preserve prior diagnostic receipt; do not overwrite it');
const before = assertSource();
fs.writeFileSync(path.join(evidence, 'GF-READING-GENERIC-ROOTS.normal-wrapper.user.js'), before.normal);
process.chdir(repo);
// Match the actual production Vite CLI before loading Vue/build plugins.
process.env.NODE_ENV = 'production';
process.env.FLUENTREAD_USERSCRIPT_STANDALONE = '0';
process.env.FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE = '1';
process.env.FLUENTREAD_USERSCRIPT_VENDOR_URL = `https://cdn.jsdelivr.net/gh/FluentRead/FluentRead@${commit}/userscript/resources/fluentread-vendor.v1.js`;
process.env.FLUENTREAD_USERSCRIPT_DATA_URL = `https://cdn.jsdelivr.net/gh/FluentRead/FluentRead@${commit}/userscript/resources/fluentread-data.v1.js`;
const {loadConfigFromFile, build} = await import(path.join(repo, 'node_modules/vite/dist/node/index.js'));

async function runStage(stage, removeGenericRoots) {
    assertSource();
    const loaded = await loadConfigFromFile({command: 'build', mode: 'production'}, path.join(repo, 'userscript/vite.config.ts'));
    assert.ok(loaded, 'Original config is absent');
    const original = loaded.config;
    const external = original.build.rollupOptions.external;
    const output = original.build.rollupOptions.output;
    assert.ok(Array.isArray(external) && external.every(id => typeof id === 'string'), 'Expected the original exact-specifier external array');
    assert.ok(output && !Array.isArray(output), 'Expected the original single IIFE output config');
    for (const name of selected) {
        assert.equal(external.filter(id => id === name).length, 1, `Expected one external root: ${name}`);
        assert.equal(output.globals[name], selectedGlobals[name], `Expected exact vendor global: ${name}`);
    }
    assert.ok(external.includes('ai'), 'Keep the corrected AI external');
    assert.equal(output.globals.ai, 'FluentReadUserscriptVendor.ai');
    const diagnosticExternal = removeGenericRoots ? external.filter(id => !selected.includes(id)) : [...external];
    const diagnosticGlobals = {...output.globals};
    if (removeGenericRoots) for (const name of selected) delete diagnosticGlobals[name];
    assert.deepEqual(external.filter(id => !diagnosticExternal.includes(id)), removeGenericRoots ? selected : []);
    assert.deepEqual(Object.keys(output.globals).filter(id => !(id in diagnosticGlobals)), removeGenericRoots ? selected : []);
    assert.equal(diagnosticGlobals.ai, output.globals.ai);
    let modules = [];
    const graphProbe = {name: `evidence-only-${stage}-graph`, generateBundle: {order: 'pre', handler(_options, bundle) {
        const entries = Object.values(bundle).filter(chunk => chunk.type === 'chunk' && chunk.isEntry);
        assert.equal(entries.length, 1, 'Expected one original entry');
        modules = Object.entries(entries[0].modules).map(([id, item]) => ({
            id: publicId(id), originalLength: item.originalLength, renderedLength: item.renderedLength,
            removedExports: item.removedExports, renderedExports: item.renderedExports,
        })).sort((a, b) => b.renderedLength - a.renderedLength);
    }}};
    const outDir = path.join(evidence, `.gf-reading-${stage}`);
    await build({...original, configFile: false, plugins: [...original.plugins, graphProbe], build: {
        ...original.build, outDir, emptyOutDir: true, rollupOptions: {...original.build.rollupOptions,
            external: diagnosticExternal, output: {...output, globals: diagnosticGlobals}},
    }});
    const artifact = fs.readFileSync(path.join(outDir, 'fluent-read.user.js'));
    const data = fs.readFileSync(path.join(outDir, 'fluentread-data.v1.js'));
    assert.equal(hash(data), expectedFiles['userscript/resources/fluentread-data.v1.js'], 'Emitted data differs from the fixed resource');
    assertSource();
    fs.writeFileSync(path.join(evidence, `GF-READING-GENERIC-ROOTS.${stage}.user.js`), artifact);
    const stageReceipt = {stage, scope: 'In-memory original-config diagnostic, not a release guard/verifier run',
        sourceCommit: commit, sourceTree: tree, resourceCommit: commit, artifactBytes: artifact.length,
        artifactSha256: hash(artifact), removedExactExternalRoots: removeGenericRoots ? selected : [],
        removedExactGlobalKeys: removeGenericRoots ? selected : [], correctedAiExternalPreserved: true,
        emittedDataSha256: hash(data), moduleCount: modules.length,
        renderedTotalJsCharacters: modules.reduce((sum, row) => sum + row.renderedLength, 0), modules,
    };
    fs.writeFileSync(path.join(evidence, `GF-READING-GENERIC-ROOTS.${stage}.graph.json`), JSON.stringify(stageReceipt, null, 2) + '\n');
    return stageReceipt;
}

let control, counterfactual;
try {
    control = await runStage('control', false);
    assert.equal(control.artifactBytes, expectedNormalBytes, 'Diagnostic control size does not reproduce original normal CLI');
    assert.equal(control.artifactSha256, expectedNormalSha, 'Diagnostic control bytes do not reproduce original normal CLI');
    counterfactual = await runStage('three-roots-inlined', true);
    const after = assertSource();
    const receipt = {
        scope: 'Finite genuine build diagnostic. Control reproduces the saved original-wrapper bytes; counterfactual only inlines three exact generic roots in RAM. No release guard pass or new size optimization claimed.',
        sourceCommit: commit, sourceTree: tree, resourceCommit: commit, sourceFileHashes: before.files,
        originalNormalBytes: expectedNormalBytes, originalNormalSha256: expectedNormalSha,
        originalNormalUnchanged: after.normal.equals(before.normal), node: process.version,
        control: {artifactBytes: control.artifactBytes, artifactSha256: control.artifactSha256, moduleCount: control.moduleCount},
        counterfactual: {artifactBytes: counterfactual.artifactBytes, artifactSha256: counterfactual.artifactSha256, moduleCount: counterfactual.moduleCount},
        measuredMainBytesSavedByExactThreeVendorRoots: counterfactual.artifactBytes - control.artifactBytes,
        currentOriginalBudgetBytes: 2000000, currentControlExcessBytes: control.artifactBytes - 2000000,
        keptFixedAiStreamTextToolVendor: true,
        limits: ['Net retained-main bytes only; not installed source spans or graph rendered characters.',
            'Vendor/data bytes are held fixed; this diagnostic does not attribute a new vendor-resource size delta or a global all-assets optimization.',
            'Three-root difference is a finite combined library boundary, not independent attribution to each package.',
            'No browser/runtime performance, network/provider service, license-release or global-minimum/SOTA/Pareto proof.',
            'The real original wrapper already failed size; this separate diagnostic does not relax the budget or replace its three fixed-resource guards.'],
    };
    fs.writeFileSync(reportPath, JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({controlBytes: control.artifactBytes, counterfactualBytes: counterfactual.artifactBytes,
        measuredMainBytesSavedByExactThreeVendorRoots: receipt.measuredMainBytesSavedByExactThreeVendorRoots,
        receipt: path.basename(reportPath), normalArtifactUnchanged: true}));
} catch (error) {
    fs.writeFileSync(path.join(evidence, 'GF-READING-GENERIC-ROOTS-DIAGNOSTIC.failure.json'), JSON.stringify({
        scope: 'Diagnostic failure; no release or size claim', sourceCommit: commit,
        control: control && {artifactBytes: control.artifactBytes, artifactSha256: control.artifactSha256},
        counterfactual: counterfactual && {artifactBytes: counterfactual.artifactBytes, artifactSha256: counterfactual.artifactSha256},
        error: String(error.message).replaceAll(repo, '<repo>').replaceAll(evidence, '<evidence>'),
    }, null, 2) + '\n');
    throw error;
}
