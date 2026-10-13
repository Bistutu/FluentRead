#!/usr/bin/env node
// 网站规则专项：实际基线/候选模块、保留真实 tldts 的独立计数、无插桩同步计时。
// node scripts/testing/run-resource-safe.mjs --concurrency 1 -- node scripts/testing/benchmark-site-rules.mjs <baseline-ref> [report.json]
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {cpus, tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const file = 'src/core/site-rules/domain.ts';
const ref = process.argv[2];
if (!ref) throw new Error('Pass an explicit correct-behavior baseline Git ref');
const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const baselineRevision = git(['rev-parse', '--verify', `${ref}^{commit}`]);
const require = createRequire(import.meta.url);
const {build} = createRequire(require.resolve('vite'))('esbuild');
const tldtsEntry = require.resolve('tldts');
const tldtsVersion = require('tldts/package.json').version;
const hash = text => createHash('sha256').update(text).digest('hex');
const original = execFileSync('git', ['show', `${baselineRevision}:${file}`], {cwd: root, encoding: 'utf8'});
const current = await readFile(path.join(root, file), 'utf8');
const temporary = await mkdtemp(path.join(tmpdir(), 'fluentread-site-rules-benchmark-'));
const started = performance.now();
const MAX_RUN_MS = 55_000;
const checkBudget = () => assert.ok(performance.now() - started < MAX_RUN_MS, 'Site-rule benchmark exceeded its 55-second scope budget');
const report = {
    status: 'running', baselineRevision, candidateHead: git(['rev-parse', 'HEAD']),
    source: {file, baselineSha256: hash(original), candidateSha256: hash(current), candidateDiffersFromBaseline: original !== current,
        scriptSha256: hash(await readFile(fileURLToPath(import.meta.url)))},
    runtime: {node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
        logicalCpus: cpus().length, tldtsVersion, tldtsEntrySha256: hash(await readFile(tldtsEntry)),
        lockfileSha256: hash(await readFile(path.join(root, 'pnpm-lock.yaml'))),
        resourceConcurrency: process.env.FLUENTREAD_TEST_CONCURRENCY ?? null,
        resourceLockHeld: process.env.FLUENTREAD_RESOURCE_LOCK_HELD === '1',
        resourceLockSlot: process.env.FLUENTREAD_RESOURCE_LOCK_SLOT ?? null},
    scope: 'Local synthetic Node CPU workloads only; excludes browser DOM scanning, rendering, network, translation providers and end-to-end user latency.',
    methodology: {rounds: 7, order: 'baseline/current on even rounds; current/baseline on odd rounds', warmupOperations: 40,
        timing: 'Synchronous batches without tldts wrappers; matcher setup is outside warm-query/update batches and explicitly reported by separate setup/state-build cases.',
        workcount: 'Separate compiled modules wrap getDomain/parse and delegate to the same actual tldts package; no PSL semantics are mocked. Counts exclude final validation.',
        queries: 'Each decision evaluates extension-disabled and auto-translate predicates as a pair; this is a controlled predicate workload, not an exact browser-event trace.',
        limitation: 'Only domain module has a baseline snapshot; its sole runtime import tldts is identical for both. Same-value update still compares O(N) entries. Index rebuild counts and DOM scans are not inferred from parser counts.',
        timingFloorMs: 0.2, maximumRunMs: MAX_RUN_MS},
    buildSetup: [], semanticChecks: {comparisons: 0, mutations: 0}, cases: [],
};

async function compile(label, source, counted) {
    const key = `__fluentReadSiteRuleBenchmark_${label}`;
    if (counted) globalThis[key] = {getDomain: 0, parse: 0};
    const outfile = path.join(temporary, `${label}-${counted ? 'counted' : 'timed'}.mjs`);
    const start = performance.now();
    const result = await build({stdin: {contents: source, loader: 'ts', resolveDir: path.join(root, path.dirname(file))},
        bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent', metafile: true,
        plugins: counted ? [{name: 'count-actual-tldts', setup(builder) {
            builder.onResolve({filter: /^tldts$/}, () => ({path: 'tldts-counter', namespace: 'site-rule-counter'}));
            builder.onLoad({filter: /.*/, namespace: 'site-rule-counter'}, () => ({loader: 'js', resolveDir: root, contents:
                `import {getDomain as actualGetDomain, parse as actualParse} from ${JSON.stringify(tldtsEntry)};
                 export function getDomain(...args) {globalThis[${JSON.stringify(key)}].getDomain += 1; return actualGetDomain(...args);}
                 export function parse(...args) {globalThis[${JSON.stringify(key)}].parse += 1; return actualParse(...args);}`,
            }));
        }}] : []});
    const module = await import(pathToFileURL(outfile).href);
    report.buildSetup.push({label, counted, buildAndImportMs: performance.now() - start,
        bundleSha256: hash(await readFile(outfile)), dependencies: Object.keys(result.metafile.inputs).filter(input => input !== '<stdin>')});
    return {module, counts: () => ({...globalThis[key]}), reset: () => {globalThis[key] = {getDomain: 0, parse: 0};}};
}

function adapter(module, config, indexed) {
    if (indexed) return module.createSiteRuleMatcher(config);
    let latest = config;
    return {update: value => {latest = value;}, isExtensionDisabled: input => module.isExtensionDisabledOnSite(input, latest.disabledExtensionDomains),
        shouldAutoTranslate: input => module.shouldAutoTranslatePage(input, latest)};
}
function decision(api, input) { return Number(api.isExtensionDisabled(input)) + 2 * Number(api.shouldAutoTranslate(input)); }
function configFor(size) {
    return {on: true, autoTranslate: false,
        alwaysTranslateDomains: Array.from({length: size}, (_, index) => `always-${index}.com`),
        disabledExtensionDomains: Array.from({length: size}, (_, index) => `blocked-${index}.com`)};
}
function verifySemantics(modules) {
    const corpus = ['https://news.bbc.co.uk/world', 'WWW.Example.COM./article', 'https://docs.team.github.io/guide',
        'https://other.github.io/', 'https://www.例子.中国/', 'localhost:5173/path', 'http://printer/queue',
        'http://192.168.1.10:8080/', 'https://[::1]:8443/', 'https://notexample.com/', 'com', 'co.uk', 'github.io',
        '*.example.com', 'http://[::1', 'foo:123', `${'a'.repeat(64)}.example.com`, 'https://foo..com/',
        'file:///tmp/article.html', 'chrome://settings', 'mailto:user@example.com', '', new URL('https://docs.example.com/page')];
    const mixed = ['https://news.bbc.co.uk/world', 'BBC.CO.UK', 'https://docs.team.github.io/guide', 'blog.team.github.io',
        'EXAMPLE.COM.', 'https://www.例子.中国', 'localhost:3000', 'printer', '192.168.1.10', '[::1]', 'co.uk', '*.invalid.example', 42, ''];
    for (const input of corpus) {
        assert.equal(modules[1].getSiteBaseDomain(input), modules[0].getSiteBaseDomain(input));
        report.semanticChecks.comparisons += 1;
    }
    assert.deepEqual(modules[1].normalizeSiteDomains(mixed), modules[0].normalizeSiteDomains(mixed));
    report.semanticChecks.comparisons += 1;
    for (const on of [false, true]) for (const automatic of [false, true]) {
        for (const lists of [{alwaysTranslateDomains: [], disabledExtensionDomains: []},
            {alwaysTranslateDomains: mixed, disabledExtensionDomains: ['example.com', 'team.github.io']},
            {alwaysTranslateDomains: mixed}, {alwaysTranslateDomains: null, disabledExtensionDomains: 'example.com'}]) {
            const config = {on, autoTranslate: automatic, ...lists};
            const api = adapter(modules[1], config, true);
            for (const input of corpus) {
                const expected = decision(adapter(modules[0], config, false), input);
                assert.equal(decision(api, input), expected);
                assert.equal(decision(adapter(modules[1], config, false), input), expected);
                report.semanticChecks.comparisons += 2;
            }
        }
    }
    const config = {on: true, autoTranslate: false, alwaysTranslateDomains: ['example.com'], disabledExtensionDomains: []};
    const api = adapter(modules[1], config, true);
    const url = new URL('https://news.example.com/first');
    const mutations = [
        () => {},
        () => {config.alwaysTranslateDomains = [...config.alwaysTranslateDomains];},
        () => {config.alwaysTranslateDomains[0] = 'other.com';},
        () => {config.alwaysTranslateDomains.push('example.com');},
        () => {config.disabledExtensionDomains.push('example.com');},
        () => {config.disabledExtensionDomains.splice(0, 1);},
        () => {config.on = false;}, () => {config.on = true; config.autoTranslate = true;},
        () => {url.href = 'https://other.github.io/changed';},
        () => {config.autoTranslate = false; config.alwaysTranslateDomains = ['other.github.io'];},
        () => {config.alwaysTranslateDomains.length = 0;},
    ];
    for (const mutate of mutations) {
        mutate(); api.update(config);
        for (const input of [url, 'https://news.example.com/first', 'file:///tmp/article.html']) {
            assert.equal(decision(api, input), decision(adapter(modules[0], config, false), input));
            report.semanticChecks.comparisons += 1;
        }
        report.semanticChecks.mutations += 1;
    }
}

function routeFactory(size, kind, flags = {}) {
    return (module, indexed) => {
        const config = {...configFor(size), ...flags}, api = adapter(module, config, indexed);
        const host = kind === 'first' ? 'always-0.com' : kind === 'last' ? `always-${Math.max(0, size - 1)}.com`
            : kind === 'disabled' ? `blocked-${Math.max(0, size - 1)}.com` : 'missing.com';
        const fixed = `https://news.${host}/article`;
        let index = 0;
        // 严格暖态：包含最近域名缓存；新 path/hash 用不同输入避免误测固定地址缓存。
        decision(api, fixed);
        return {operation: () => decision(api, kind === 'repeat' ? fixed : kind === 'anchor' ? `${fixed}#section-${index++}` : `${fixed}/${index++}`),
            finish: () => decision(api, fixed)};
    };
}
function buildFactory(size) {
    return (module, indexed) => {
        const config = configFor(size); let latest;
        return {operation: () => {latest = adapter(module, config, indexed); return Number(typeof latest.shouldAutoTranslate === 'function');},
            finish: () => decision(latest, size ? `https://always-${size - 1}.com/` : 'https://missing.com/')};
    };
}
function updateFactory(size, kind) {
    return (module, indexed) => {
        const config = configFor(size), api = adapter(module, config, indexed); let turn = 0;
        const fixed = kind === 'in-place-edit' ? 'https://edited.com/' : kind === 'flags-only' ? 'https://missing.com/' : 'https://always-0.com/';
        decision(api, fixed);
        return {operation: () => {
            turn += 1;
            if (kind === 'same-values-new-array') {
                config.alwaysTranslateDomains = [...config.alwaysTranslateDomains];
                config.disabledExtensionDomains = [...config.disabledExtensionDomains];
            } else if (kind === 'in-place-edit' && size) {
                config.alwaysTranslateDomains[size - 1] = turn % 2 ? 'edited.com' : `always-${size - 1}.com`;
            } else if (kind === 'add-remove') {
                if (turn % 2) config.alwaysTranslateDomains.push('extra.com'); else config.alwaysTranslateDomains.pop();
            } else if (kind === 'flags-only') config.autoTranslate = Boolean(turn % 2);
            api.update(config);
            return turn % 2;
        }, finish: () => decision(api, fixed)};
    };
}
function mixedFactory(size) {
    return (module, indexed) => {
        const config = configFor(size), api = adapter(module, config, indexed); let cycle = 0;
        return {operation: () => {
            cycle += 1;
            config.alwaysTranslateDomains = [...config.alwaysTranslateDomains]; api.update(config);
            let result = 0;
            for (let route = 0; route < 5; route += 1) result += decision(api, `https://missing.com/article/${cycle}/${route}`);
            config.alwaysTranslateDomains[size - 1] = cycle % 2 ? 'mixed.com' : `always-${size - 1}.com`; api.update(config);
            result += decision(api, `https://mixed.com/article/${cycle}`);
            return result;
        }, finish: () => decision(api, 'https://mixed.com/final')};
    };
}

function getWorkcount(pair, factory, operations) {
    return pair.map((entry, index) => {
        entry.reset(); const workload = factory(entry.module, index === 1); const setup = entry.counts();
        entry.reset(); let checksum = 0;
        for (let operation = 0; operation < operations; operation += 1) checksum += workload.operation();
        const counts = entry.counts(); entry.reset(); const finalDecision = workload.finish();
        return {setup, operations, counts, checksum, finalDecision, validationCounts: entry.counts()};
    });
}
function measure(pair, factory, iterations) {
    const samples = [[], []], checksums = [[], []];
    for (let side = 0; side < 2; side += 1) {
        const warm = factory(pair[side].module, side === 1);
        for (let operation = 0; operation < 40; operation += 1) warm.operation();
        warm.finish();
    }
    for (let round = 0; round < 7; round += 1) {
        checkBudget();
        const endings = [];
        for (const side of round % 2 ? [1, 0] : [0, 1]) {
            const workload = factory(pair[side].module, side === 1); let checksum = 0;
            const start = performance.now();
            for (let operation = 0; operation < iterations; operation += 1) checksum += workload.operation();
            samples[side].push(performance.now() - start); checksums[side].push(checksum); endings[side] = workload.finish();
        }
        assert.equal(checksums[0][round], checksums[1][round]); assert.equal(endings[0], endings[1]);
    }
    const median = values => [...values].sort((a, b) => a - b)[3];
    const before = median(samples[0]), after = median(samples[1]);
    return {iterations, baselineMedianMs: before, candidateMedianMs: after, baselineSamplesMs: samples[0], candidateSamplesMs: samples[1],
        checksums, bothAboveTimingFloor: Math.min(before, after) >= 0.2,
        reductionPercent: Math.min(before, after) >= 0.2 ? (before - after) / before * 100 : null};
}

try {
    const timed = [await compile('baseline', original, false), await compile('candidate', current, false)];
    const counted = [await compile('baseline', original, true), await compile('candidate', current, true)];
    assert.equal(typeof timed[1].module.createSiteRuleMatcher, 'function');
    verifySemantics(timed.map(entry => entry.module)); verifySemantics(counted.map(entry => entry.module));
    const cases = [];
    for (const size of [0, 10, 100, 1000]) {
        cases.push({name: `Build initial rule state (${size} entries per list)`, category: 'cold-state-build', size,
            iterations: Math.max(20, Math.floor(1000 / (size + 1))), countOperations: 1, factory: buildFactory(size)});
        for (const kind of ['first', 'last', 'miss', 'repeat', 'anchor']) cases.push({name: `Warm predicate pair: ${kind} (${size} entries per list)`,
            category: 'warm-query', size, iterations: size === 0 ? 2500 : size === 10 ? 1000 : size === 100 ? 200 : 50,
            countOperations: 10, factory: routeFactory(size, kind)});
        for (const kind of ['same-array', 'same-values-new-array', 'in-place-edit', 'add-remove', 'flags-only']) {
            if (!size && kind === 'in-place-edit') continue;
            cases.push({name: `Update rule state: ${kind} (${size} entries per list)`, category: 'config-update', size,
                iterations: kind === 'in-place-edit' || kind === 'add-remove' ? Math.max(20, Math.floor(1000 / (size + 1))) : 500,
                countOperations: 10, factory: updateFactory(size, kind)});
        }
    }
    for (const [name, kind, flags] of [['paused', 'miss', {on: false}], ['global', 'miss', {autoTranslate: true}],
        ['disabled overrides global', 'disabled', {autoTranslate: true}]]) cases.push({name: `Flag branch: ${name} (1000 entries per list)`,
        category: 'flags', size: 1000, iterations: 50, countOperations: 10, factory: routeFactory(1000, kind, flags)});
    for (const size of [10, 1000]) cases.push({name: `Mixed same-value update, five routes and real edit (${size} entries per list)`,
        category: 'mixed', size, iterations: 10, countOperations: 2, factory: mixedFactory(size)});
    for (const entry of cases) {
        checkBudget();
        const counts = getWorkcount(counted, entry.factory, entry.countOperations);
        assert.equal(counts[0].checksum, counts[1].checksum); assert.equal(counts[0].finalDecision, counts[1].finalDecision);
        const timing = measure(timed, entry.factory, entry.iterations);
        report.cases.push({name: entry.name, category: entry.category, entriesPerList: entry.size,
            workcount: {baseline: counts[0], candidate: counts[1]}, timing});
        console.log(`${entry.name}: getDomain ${counts[0].counts.getDomain} -> ${counts[1].counts.getDomain}; median ${timing.baselineMedianMs.toFixed(3)} -> ${timing.candidateMedianMs.toFixed(3)} ms`);
    }
    // 明确验证主要工作量承诺；真实修改允许重建，未变名单不得重新解析。
    const find = (category, size, text) => report.cases.find(entry => entry.category === category && entry.entriesPerList === size && entry.name.includes(text));
    for (const size of [10, 100, 1000]) {
        assert.equal(find('warm-query', size, ': miss').workcount.candidate.counts.getDomain, 10);
        assert.equal(find('warm-query', size, ': repeat').workcount.candidate.counts.getDomain, 0);
        assert.equal(find('config-update', size, 'same-array').workcount.candidate.counts.getDomain, 0);
        assert.equal(find('config-update', size, 'same-values-new-array').workcount.candidate.counts.getDomain, 0);
        assert.equal(find('config-update', size, 'flags-only').workcount.candidate.counts.getDomain, 0);
        assert.equal(find('config-update', size, 'in-place-edit').workcount.candidate.counts.getDomain, 10 * size);
    }
    assert.equal(hash(await readFile(path.join(root, file))), report.source.candidateSha256, 'Candidate source changed while benchmarking');
    report.status = 'passed';
} catch (error) {
    report.status = 'failed'; report.error = String(error?.stack ?? error); throw error;
} finally {
    report.totalRunMs = performance.now() - started;
    const output = path.resolve(process.argv[3] ?? path.join(root, 'artifacts/site-rules-navigation-20261011/performance/site-rules.json'));
    await mkdir(path.dirname(output), {recursive: true}); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Site-rule benchmark ${report.status}: ${report.cases.length} cases, ${report.semanticChecks.comparisons} semantic comparisons, ${report.totalRunMs.toFixed(0)} ms; ${output}`);
    await rm(temporary, {recursive: true, force: true});
    delete globalThis.__fluentReadSiteRuleBenchmark_baseline; delete globalThis.__fluentReadSiteRuleBenchmark_candidate;
}
