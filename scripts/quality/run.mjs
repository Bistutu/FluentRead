#!/usr/bin/env node
// Explicit opt-in online evaluation of repository-owned synthetic text. No browser/user data is read.
import {readFile, writeFile, rename, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {validateCorpus, evaluateTranslation, classifyFailure, providerDeferral, summarize, sha256, compareReports} from './evaluate.mjs';
import {renderQualityReport} from './report.mjs';
import {createMeasuredFetch} from './transport.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const allowed = new Set(['corpus', 'out', 'providers', 'samples', 'configuration', 'repeat', 'source-root', 'baseline', 'timeout-ms', 'resume', 'live', 'help']);
const args = {};
for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i].replace(/^--/u, '');
    if (!allowed.has(key)) throw new Error(`Unknown option: ${key}`);
    args[key] = ['live', 'resume', 'help'].includes(key) ? true : process.argv[++i];
    if (args[key] === undefined) throw new Error(`Missing --${key}`);
}
if (args.help) {
    console.log('node scripts/quality/run.mjs --live --providers microsoft,google,transmart --out <directory> [--samples id,id] [--configuration explicit|auto] [--repeat 1..3] [--source-root <checkout>] [--baseline report.json] [--resume]');
    process.exit(0);
}
if (!args.live || !args.providers || !args.out) throw new Error('Online evaluation requires --live, explicit --providers and --out');
const configuration = args.configuration ?? 'explicit';
if (!['explicit', 'auto'].includes(configuration)) throw new Error('Unknown configuration');
const repeats = Number(args.repeat ?? 1), timeoutMs = Number(args['timeout-ms'] ?? 15000);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3 || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error('Invalid bounded repeat/timeout');
const corpusText = await readFile(path.resolve(args.corpus ?? path.join(root, 'tests/fixtures/translation-quality/corpus.json')), 'utf8');
const corpus = validateCorpus(JSON.parse(corpusText));
const sampleIds = args.samples?.split(',');
if (sampleIds?.some(id => !corpus.samples.some(sample => sample.id === id))) throw new Error('Unknown sample ID');
const samples = corpus.samples.filter(sample => !sampleIds || sampleIds.includes(sample.id));
const sourceRoot = path.resolve(args['source-root'] ?? root);
const providers = [...new Set(args.providers.split(','))];
const output = path.resolve(args.out);
await mkdir(output, {recursive: true});
const reportPath = path.join(output, 'report.json');
const baselineText = args.baseline ? await readFile(path.resolve(args.baseline), 'utf8') : undefined;
const baseline = baselineText ? JSON.parse(baselineText) : undefined;
const temporary = await mkdtemp(path.join(os.tmpdir(), 'fluentread-quality-'));
let interrupted = false;
let activeController;
const interrupt = () => {interrupted = true; activeController?.abort(new DOMException('Evaluation cancelled', 'AbortError'));};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
let report;
try {
    const {build} = createRequire(require.resolve('vite'))('esbuild');
    const bundle = path.join(temporary, 'providers.cjs');
    const built = await build({entryPoints: [path.join(root, 'scripts/quality/provider-entry.ts')], bundle: true,
        platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent', metafile: true,
        alias: {'@': sourceRoot}, define: {'import.meta.env.BROWSER': '"chrome"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true'}});
    const adapter = require(bundle);
    if (providers.some(id => id === 'myMemory' || !adapter.FREE_TRANSLATION_PROVIDERS.some(provider => provider.id === id))) throw new Error('Unsupported provider; MyMemory is excluded to preserve its small anonymous quota');
    const sources = {};
    for (const file of Object.keys(built.metafile.inputs).filter(file => !file.includes('node_modules'))) {
        const absolute = path.resolve(file);
        const label = absolute.startsWith(sourceRoot + path.sep) ? path.relative(sourceRoot, absolute) : path.relative(root, absolute);
        sources[label] = sha256(await readFile(absolute));
    }
    const toolHashes = {};
    for (const file of ['run.mjs', 'evaluate.mjs', 'report.mjs', 'transport.mjs', 'provider-entry.ts']) toolHashes[file] = sha256(await readFile(path.join(root, 'scripts/quality', file)));
    const bundleSha256 = sha256(await readFile(bundle));
    const lockfileSha256 = sha256(await readFile(path.join(sourceRoot, 'pnpm-lock.yaml')));
    const identity = {bundleSha256, lockfileSha256, corpusSha256: sha256(corpusText), sources, toolHashes, baselineSha256: baselineText ? sha256(baselineText) : null, providers, sampleIds: samples.map(sample => sample.id), configuration, repeats, timeoutMs};
    const fingerprint = sha256(JSON.stringify(identity));
    if (args.resume) {
        report = JSON.parse(await readFile(reportPath, 'utf8'));
        if (report.fingerprint !== fingerprint) throw new Error('Resume rejected: corpus, source, selection or settings changed');
    } else {
        // Never silently overwrite an earlier baseline.
        try {await readFile(reportPath); throw new Error('Output exists; use --resume or a new --out');}
        catch (error) {if (error.code !== 'ENOENT') throw error;}
        await mkdir(path.join(output, 'tools'), {recursive: true});
        for (const file of Object.keys(toolHashes)) await writeFile(path.join(output, 'tools', file), await readFile(path.join(root, 'scripts/quality', file)));
        report = {schemaVersion: 1, id: `quality-${Date.now()}`, createdAt: new Date().toISOString(), fingerprint,
            plan: {sampleIds: samples.map(sample => sample.id), providerIds: providers, configurationId: configuration, repeats},
            corpus: {...corpus, sha256: identity.corpusSha256},
            environment: {node: process.version, platform: process.platform, sourceRoot,
                revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: sourceRoot, encoding: 'utf8'}).trim(),
                sourceGitDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: sourceRoot, encoding: 'utf8'}).trim()),
                sourceHashes: sources, toolHashes, bundleSha256, lockfileSha256, mode: 'live-node-production-adapters', configuration, timeoutMs,
                privacy: 'Only synthetic corpus text; no user profile, cookies, credentials, or private webpages.',
                scope: 'Production provider source bundled for Node. Browser transport, broker, fallback, cache, and UI are separate acceptance checks. Context is the complete source segment; these anonymous adapters do not consume discourse context.',
                limitations: ['No human gold translations or human semantic verdicts.', 'Single-network observations are not a global provider ranking.', 'Input characters count the evaluation source associated with HTTP attempts, not wire text or billed tokens. Authentication and chunk retries may differ. Monetary cost is unknown; no paid credentials used.', 'Request/response byte counts omit headers and TLS; multipart body bytes may be unavailable.']},
            baseline: baseline ? {id: baseline.id, sha256: identity.baselineSha256, createdAt: baseline.createdAt,
                revision: baseline.environment.revision, sourceHashes: baseline.environment.sourceHashes,
                comparableSettings: baseline.environment.configuration === configuration && baseline.environment.timeoutMs === timeoutMs
                    && baseline.environment.mode === 'live-node-production-adapters'} : null,
            runs: [], providerDeferrals: {}};
    }
    const save = async () => {
        report.updatedAt = new Date().toISOString();
        report.summary = summarize(report.runs, report.plan);
        if (baseline) report.comparison = compareReports(baseline, report);
        await writeFile(`${reportPath}.tmp`, JSON.stringify(report, null, 2) + '\n');
        await rename(`${reportPath}.tmp`, reportPath);
        await writeFile(path.join(output, 'report.html'), renderQualityReport(report));
    };
    await save();
    // Interleave services for each sample; rotate the first provider to reduce fixed-order drift.
    for (let repeat = 1; repeat <= repeats; repeat++) for (let index = 0; index < samples.length; index++) {
        const sample = samples[index];
        const order = providers.slice(index % providers.length).concat(providers.slice(0, index % providers.length));
        for (const providerId of order) {
            if (interrupted) break;
            const prior = report.runs.filter(run => run.sampleId === sample.id && run.providerId === providerId && run.configurationId === configuration && run.repeat === repeat);
            const latest = prior.at(-1);
            if (latest && latest.status !== 'cancelled' && (latest.failure?.category !== 'deferred'
                || report.providerDeferrals[providerId]?.retryAt > Date.now())) continue;
            const events = [];
            const controller = new AbortController();
            activeController = controller;
            let timedOut = false;
            const timer = setTimeout(() => {timedOut = true; controller.abort(new DOMException('Evaluation deadline', 'TimeoutError'));}, timeoutMs);
            adapter.setRuntimeFetch(createMeasuredFetch((input, init) => fetch(input, {...init, credentials: 'omit'}), events, controller.signal));
            const started = performance.now();
            const run = {sampleId: sample.id, providerId, configurationId: configuration, repeat, attempt: prior.length + 1, startedAt: new Date().toISOString(),
                status: 'success', durationMs: 0, checks: [], review: {status: 'pending'},
                cost: {httpRequests: 0, inputCharacters: Array.from(sample.source).length, requestBytes: 0, responseBytes: 0, monetaryCost: null, unit: 'USD', note: 'Anonymous service; no billed token information. Bytes exclude headers/TLS.'}};
            try {
                const deferred = report.providerDeferrals[providerId];
                if (deferred && deferred.retryAt > Date.now()) {
                    run.status = 'failure';
                    run.cost.inputCharacters = 0;
                    run.failure = {category: 'deferred', message: `Skipped until ${new Date(deferred.retryAt).toISOString()} after ${deferred.category}`};
                } else {
                    run.translation = await adapter.translate(providerId, sample.source, configuration === 'auto' ? 'auto' : sample.sourceLanguage, sample.targetLanguage, controller.signal);
                    if (controller.signal.aborted) throw controller.signal.reason;
                    if (typeof run.translation !== 'string' || !run.translation.trim()) throw new Error('Invalid translation');
                    run.checks = evaluateTranslation(sample, run.translation);
                    run.productionValidation = {
                        untranslated: adapter.isLikelyUntranslatedResponse(sample.source, run.translation, sample.targetLanguage),
                        wrongLanguage: adapter.isClearlyWrongLanguageResponse(sample.source, run.translation, sample.targetLanguage)};
                    if (run.productionValidation.untranslated) run.checks.push({requirementId: 'runtime-untranslated', category: 'omission', status: 'flagged', description: '现有生产校验检测到原文回显；免费池会尝试另一服务。'});
                    if (run.productionValidation.wrongLanguage) run.checks.push({requirementId: 'runtime-wrong-language', category: 'mistranslation', status: 'flagged', description: '现有生产校验检测到明显错语种；免费池会尝试另一服务。'});
                }
            } catch (error) {
                run.status = interrupted ? 'cancelled' : 'failure';
                run.failure = classifyFailure(error, events, timedOut, interrupted);
                const deferral = providerDeferral(error, events);
                if (deferral) report.providerDeferrals[providerId] = deferral;
            } finally {
                if (timedOut || interrupted) controller.abort();
                clearTimeout(timer);
                adapter.setRuntimeFetch();
                activeController = undefined;
                run.durationMs = Math.round(performance.now() - started);
                run.cost.httpRequests = events.length;
                if (!events.length) run.cost.inputCharacters = 0;
                run.cost.requestBytes = events.some(event => event.requestBytes === null) ? null : events.reduce((sum, event) => sum + event.requestBytes, 0);
                run.cost.responseBytes = events.reduce((sum, event) => sum + event.responseBytes, 0);
                run.transport = events;
                report.runs.push(run);
                await save();
            }
            console.log(`${run.sampleId} ${providerId} ${run.status}${run.failure ? `/${run.failure.category}` : ` signals:${run.checks.filter(check => check.status === 'flagged').length}`} ${run.durationMs}ms`);
            if (!interrupted) await new Promise(resolve => setTimeout(resolve, 300));
        }
        if (interrupted) break;
    }
    report.interrupted = interrupted;
    report.complete = !interrupted && new Set(report.runs.filter(run => run.status !== 'cancelled')
        .map(run => [run.sampleId, run.providerId, run.configurationId, run.repeat].join('/'))).size === samples.length * providers.length * repeats;
    await save();
    if (interrupted) process.exitCode = 130;
} finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await rm(temporary, {recursive: true, force: true});
}
