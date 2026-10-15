import {describe, expect, it} from 'vitest';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {validateCorpus, evaluateTranslation, classifyFailure, providerDeferral, compareReports, summarize} from '../scripts/quality/evaluate.mjs';

const corpus = JSON.parse(readFileSync(new URL('./fixtures/translation-quality/corpus.json', import.meta.url), 'utf8'));
const sample = {id: 'audit', domain: 'technical', sourceLanguage: 'en', targetLanguage: 'zh-Hans', source: '12 ms and 12 ms',
    provenance: {kind: 'synthetic', author: 'Codex', createdAt: '2026-10-15'}, humanReview: {status: 'pending'},
    requirements: [
        {id: 'literal', category: 'numbers-units', description: 'Both literal values remain', requiresHumanReview: false, check: {type: 'exact-preservation', value: '12 ms'}},
        {id: 'meaning', category: 'negation', description: 'Human checks scope', requiresHumanReview: true},
    ]};
const fixture = () => ({schemaVersion: 1, samples: [structuredClone(sample)]});
const run = (translation: string) => ({sampleId: sample.id, providerId: 'fixture', configurationId: 'explicit', repeat: 1,
    status: 'success', translation, checks: evaluateTranslation(sample, translation), durationMs: 10, cost: {httpRequests: 1}});

describe('translation quality evidence boundaries', () => {
    it('validates the real corpus with all domains and requirement categories, no invented human gold', () => {
        expect(validateCorpus(corpus)).toBe(corpus);
        expect(corpus).toMatchObject({schemaVersion: 1, id: 'fluentread-translation-quality-v2'});
        expect(new Set(corpus.samples.map((item: any) => item.domain)).size).toBe(5);
        expect(new Set(corpus.samples.flatMap((item: any) => item.requirements.map((requirement: any) => requirement.category))).size).toBe(7);
        expect(corpus.samples.every((item: any) => item.humanReview.status === 'pending')).toBe(true);
        const requirements = corpus.samples.flatMap((item: any) => item.requirements);
        expect(requirements).toHaveLength(139);
        expect(requirements.filter((item: any) => item.requiresHumanReview)).toHaveLength(98);
    });
    it.each(['getUserID', '保持getUserID不变', "'getUserID'", '“getUserID”', '&#39;getUserID&#39;'])(
        'distinguishes intact API spelling from missing code formatting in %s', translation => {
            const mixed = corpus.samples.find((item: any) => item.id === 'mixed-001');
            expect(evaluateTranslation(mixed, translation)).toMatchObject([
                {requirementId: 'mixed-001-r1', category: 'terminology', status: 'signal-clear'},
                {requirementId: 'mixed-001-r2', status: 'needs-human-review'},
                {requirementId: 'mixed-001-r3', status: 'needs-human-review'},
                {requirementId: 'mixed-001-r4', status: 'needs-human-review'},
                {requirementId: 'mixed-001-r5', category: 'format', status: 'flagged'},
            ]);
        },
    );
    it.each(['getUserid', 'getUserId', 'GetUserID', 'getuserid', 'GETUSERID', 'getUser',
        'xgetUserID', '1getUserID', '_getUserID', '$getUserID',
        'getUserIDx', 'getUserID1', 'getUserID_', 'getUserID$'])(
        'flags wrong case, missing names and ASCII identifier affixes in %s', translation => {
            const mixed = corpus.samples.find((item: any) => item.id === 'mixed-001');
            expect(evaluateTranslation(mixed, translation)[0]).toMatchObject({category: 'terminology', status: 'flagged'});
        },
    );
    it('retains literal backtick loss and duplication signals independently of API spelling', () => {
        const mixed = corpus.samples.find((item: any) => item.id === 'mixed-001');
        expect(evaluateTranslation(mixed, '保持`getUserID`不变')[4].status).toBe('signal-clear');
        expect(evaluateTranslation(mixed, '`getUserID` 与 `getUserID`')[4].status).toBe('flagged');
    });
    it('keeps the five historical warnings as format risks without rewriting v1 or claiming paired improvement', () => {
        const reportPath = new URL('../docs/reports/translation-quality-20261015/live-baseline-smoke/report.json', import.meta.url);
        const raw = readFileSync(reportPath, 'utf8');
        const historical = JSON.parse(raw);
        const oldSample = historical.corpus.samples.find((item: any) => item.id === 'mixed-001');
        const mixed = corpus.samples.find((item: any) => item.id === 'mixed-001');
        expect(historical.corpus.id).toBe('fluentread-translation-quality-v1');
        expect(oldSample.requirements).toHaveLength(4);
        expect(mixed.source).toBe(oldSample.source);
        expect(mixed.requirements.slice(1, 4)).toEqual(oldSample.requirements.slice(1));
        expect(mixed.requirements[4]).toMatchObject({category: 'format', severity: oldSample.requirements[0].severity,
            check: oldSample.requirements[0].check});
        expect(corpus.samples.filter((item: any) => item.id !== mixed.id))
            .toEqual(historical.corpus.samples.filter((item: any) => item.id !== mixed.id));
        const flagged = historical.runs.filter((item: any) => item.sampleId === mixed.id
            && item.status === 'success' && item.checks.some((check: any) => check.requirementId === 'mixed-001-r1' && check.status === 'flagged'));
        expect(flagged).toHaveLength(5);
        const revised = flagged.map((item: any) => ({...item, checks: evaluateTranslation(mixed, item.translation)}));
        for (const item of revised) {
            expect(item.checks.filter((check: any) => check.status === 'flagged'))
                .toMatchObject([{requirementId: 'mixed-001-r5', category: 'format'}]);
            expect(item.checks.filter((check: any) => check.status === 'needs-human-review')).toHaveLength(3);
        }
        expect(compareReports(historical, {...historical, corpus, runs: revised})).toEqual([]);
        expect(JSON.stringify(historical)).toBe(JSON.stringify(JSON.parse(raw)));
        expect(readFileSync(reportPath, 'utf8')).toBe(raw);
    });
    it('requires auditable provenance, unique IDs and explicit review evidence', () => {
        const duplicate = fixture(); duplicate.samples.push(duplicate.samples[0]);
        expect(() => validateCorpus(duplicate)).toThrow('duplicate');
        const untrusted = fixture(); untrusted.samples[0].provenance.kind = 'private';
        expect(() => validateCorpus(untrusted)).toThrow('provenance');
        const unreviewed = fixture(); unreviewed.samples[0].humanReview.status = 'approved';
        expect(() => validateCorpus(unreviewed)).toThrow('Human review');
    });
    it('keeps semantics pending even when every surface signal is clear', () => {
        expect(evaluateTranslation(sample, '12 ms 和 12 ms').map((item: any) => item.status)).toEqual(['signal-clear', 'needs-human-review']);
        expect(evaluateTranslation(sample, '12 ms').map((item: any) => item.status)).toEqual(['flagged', 'needs-human-review']);
        expect(evaluateTranslation(sample, '12 ms 12 ms 12 ms')[0].status).toBe('flagged');
    });
    it('separates transport failures and never persists arbitrary provider diagnostics', () => {
        const sensitive = {message: 'https://example.invalid/?token=secret', statusCode: 429};
        expect(classifyFailure(sensitive)).toEqual({category: 'rate-limit', message: 'rate-limit', providerStatus: 429});
        expect(classifyFailure({statusCode: 502}, [{status: 200}])).toMatchObject({providerStatus: 502, observedHttpStatus: 200});
        expect(classifyFailure({freeFailure: 'request'}, [{status: 200}])).toMatchObject({category: 'request', observedHttpStatus: 200});
        expect(classifyFailure({freeFailure: 'unavailable'}, [{status: 200, networkError: true}]).category).toBe('network');
        expect(classifyFailure({}, [{status: null, aborted: true}]).category).toBe('timeout');
        expect(classifyFailure({}, [{status: null}]).category).toBe('unavailable');
        expect(classifyFailure({}, []).category).toBe('unavailable');
        expect(classifyFailure({}, [{networkError: true}]).category).toBe('network');
        expect(classifyFailure({}, [], true).category).toBe('timeout');
        expect(classifyFailure({}, [], true, true).category).toBe('cancelled');
    });
    it('pairs only identical samples and treats availability changes as noncomparable', () => {
        const before = {corpus: fixture(), runs: [run('12 ms')]};
        const after = {corpus: fixture(), runs: [run('12 ms 和 12 ms')]};
        expect(compareReports(before, after)[0]).toMatchObject({comparable: true, resolvedSignals: ['literal'], semanticReview: 'pending'});
        after.corpus.samples[0].source = 'different';
        expect(compareReports(before, after)).toEqual([]);
        after.corpus = fixture();
        after.runs[0] = {...run(''), status: 'failure'};
        expect(compareReports(before, after)[0]).toMatchObject({comparable: false, resolvedSignals: [], outputChanged: null});
    });
    it('keeps server refusal backoff when a rate-limited body times out or the caller cancels', () => {
        const events = [{status: 429, aborted: true, retryAt: 900_000}];
        expect(classifyFailure({}, events, true).category).toBe('timeout');
        expect(providerDeferral({}, events, 1000)).toEqual({category: 'rate-limit', retryAt: 900_000});
        expect(classifyFailure({}, events, false, true).category).toBe('cancelled');
        expect(providerDeferral({freeFailure: 'quota'}, [], 1000)).toEqual({category: 'quota', retryAt: 86_401_000});
        expect(providerDeferral({}, [{status: 403}, {status: null, aborted: true, retryAt: Infinity}], 1000)).toEqual({category: 'blocked', retryAt: 86_401_000});
        expect(providerDeferral({statusCode: 429}, [], 1000)).toEqual({category: 'rate-limit', retryAt: 301_000});
        expect(providerDeferral({freeFailure: 'request'}, [{status: 400}], 1000)).toBeUndefined();
        expect(providerDeferral({}, [{status: null, aborted: true}], 1000)).toBeUndefined();
    });
    it('reports failed requests separately from flags and successful-return latency', () => {
        const summary = summarize([run('12 ms'), {...run(''), status: 'failure', durationMs: 5000, failure: {category: 'network'}}])[0];
        expect(summary).toMatchObject({attempted: 2, returned: 1, flagged: 1, failures: {network: 1}, medianLatencyMs: 10});
        expect(summarize([run('12 ms'), {...run('12 ms'), durationMs: 100}])[0].medianLatencyMs).toBe(55);
    });
    it('separates HTTP retries, deferred work, local failures and cancellation without inventing a success rate', () => {
        const runs = [
            {...run('12 ms 和 12 ms'), cost: {httpRequests: 3}},
            {...run(''), status: 'failure', failure: {category: 'deferred'}, cost: {httpRequests: 0}},
            {...run(''), status: 'failure', failure: {category: 'unavailable'}, cost: {httpRequests: 0}},
            {...run(''), status: 'cancelled', failure: {category: 'cancelled'}, cost: {httpRequests: 2}},
            {...run(''), status: 'cancelled', failure: {category: 'cancelled'}, cost: {httpRequests: 0}},
        ];
        const summary = summarize(runs)[0];
        expect(summary).toMatchObject({countingVersion: 2, planned: null, recordedRuns: 5,
            attempted: 4, requested: 2, returned: 1, deferred: 1, cancelled: 2, failed: 1,
            httpRequests: 5, failures: {deferred: 1, unavailable: 1, cancelled: 2}, medianLatencyMs: 10});
        expect(summary.returned + summary.deferred + summary.cancelled + summary.failed).toBe(summary.recordedRuns);
        expect(summary).not.toHaveProperty('successRate');
        expect(runs[1]).toMatchObject({failure: {category: 'deferred'}});
    });
    it('keeps the exact plan when cancelled before a provider starts and never infers plans from historical rows', () => {
        const plan = {sampleIds: [sample.id, 'second'], providerIds: ['fixture', 'not-started'], configurationId: 'explicit', repeats: 2};
        const cancelled = {...run(''), status: 'cancelled', failure: {category: 'cancelled'}, cost: {httpRequests: 1}};
        const summary = summarize([cancelled], plan);
        expect(summary).toHaveLength(2);
        expect(summary[0]).toMatchObject({planned: 4, recordedRuns: 1, attempted: 1, requested: 1, cancelled: 1, returned: 0});
        expect(summary[1]).toMatchObject({providerId: 'not-started', planned: 4, recordedRuns: 0,
            attempted: 0, requested: 0, returned: 0, failed: 0, cancelled: 0, deferred: 0, httpRequests: 0, medianLatencyMs: null});
        expect(summarize([], plan).every(group => group.planned === 4 && group.recordedRuns === 0)).toBe(true);
        expect(summarize([cancelled])[0].planned).toBeNull();
        expect(summarize([cancelled], null)[0].planned).toBeNull();
        expect(summarize([])).toEqual([]);
    });
    it('preserves all resume costs while counting the plan once per logical unit', () => {
        const plan = {sampleIds: [sample.id], providerIds: ['fixture'], configurationId: 'explicit', repeats: 1};
        const summary = summarize([
            {...run(''), attempt: 1, status: 'failure', failure: {category: 'deferred'}, cost: {httpRequests: 0}},
            {...run(''), attempt: 2, status: 'cancelled', failure: {category: 'cancelled'}, cost: {httpRequests: 2}},
            {...run('12 ms 和 12 ms'), attempt: 3, cost: {httpRequests: 3}},
        ], plan)[0];
        expect(summary).toMatchObject({planned: 1, recordedRuns: 3, attempted: 2, requested: 2,
            deferred: 1, cancelled: 1, returned: 1, failed: 0, httpRequests: 5});
    });
    it('uses the arithmetic median of successful returns only and does not mutate evidence', () => {
        const runs = [230, 179, 216, 181].map(durationMs => ({...run('12 ms 和 12 ms'), durationMs}));
        runs.push({...run(''), status: 'failure', durationMs: 0, failure: {category: 'timeout'}} as any);
        const raw = JSON.stringify(runs);
        expect(summarize(runs)[0].medianLatencyMs).toBe(198.5);
        expect(JSON.stringify(runs)).toBe(raw);
        expect(summarize(runs.slice(0, 3))[0].medianLatencyMs).toBe(216);
        expect(summarize([runs[4]])[0].medianLatencyMs).toBeNull();
    });
    it('rejects ambiguous plans and leaves unrelated historical groups unplanned', () => {
        const plan = {sampleIds: [sample.id], providerIds: ['fixture'], configurationId: 'explicit', repeats: 1};
        for (const invalid of [{...plan, sampleIds: []}, {...plan, sampleIds: [sample.id, sample.id]},
            {...plan, providerIds: ['fixture', 'fixture']}, {...plan, providerIds: [null]}, {...plan, configurationId: ''}, {...plan, repeats: 0}]) {
            expect(() => summarize([], invalid as any)).toThrow('Invalid evaluation plan');
        }
        const summary = summarize([{...run('12 ms'), configurationId: 'auto'}], plan);
        expect(summary[0]).toMatchObject({configurationId: 'explicit', planned: 1, recordedRuns: 0});
        expect(summary[1]).toMatchObject({configurationId: 'auto', planned: null, recordedRuns: 1});
    });
    it('renders missing or malformed historical diagnostics as unknown without losing cancellation', () => {
        const runs = [
            {...run(''), status: 'cancelled'},
            {...run(''), status: 'failure'},
            {...run(''), status: 'failure', failure: {message: 'A historical diagnostic has no category'}},
            {...run(''), status: 'failure', failure: {category: ''}},
            {...run(''), status: 'failure', failure: {category: null}},
            {...run(''), status: 'failure', failure: {category: {untrusted: true}}},
            {...run(''), status: 'failure', failure: {category: '__proto__'}},
            {...run(''), status: 'failure', failure: {category: 'constructor'}},
        ];
        const raw = JSON.stringify(runs);
        const summary = summarize(runs)[0];
        expect(summary).toMatchObject({recordedRuns: 8, attempted: 8, requested: 8,
            returned: 0, cancelled: 1, failed: 7, deferred: 0});
        expect(JSON.parse(JSON.stringify(summary.failures))).toEqual(JSON.parse('{"cancelled":1,"unknown":5,"__proto__":1,"constructor":1}'));
        expect(JSON.stringify(runs)).toBe(raw);
    });
    it('keeps slash-containing provider/configuration tuples distinct in summaries and paired comparisons', () => {
        const first = {...run('12 ms'), providerId: 'a/b', configurationId: 'c'};
        const second = {...run('12 ms 和 12 ms'), providerId: 'a', configurationId: 'b/c'};
        const summaries = summarize([first, second]);
        expect(summaries).toHaveLength(2);
        expect(summaries[0]).toMatchObject({providerId: 'a/b', configurationId: 'c', recordedRuns: 1, flagged: 1});
        expect(summaries[1]).toMatchObject({providerId: 'a', configurationId: 'b/c', recordedRuns: 1, flagged: 0});
        const before = {corpus: fixture(), runs: [first, second]};
        const after = {corpus: fixture(), runs: [{...first, ...run('12 ms 和 12 ms'), providerId: first.providerId, configurationId: first.configurationId}, second]};
        expect(compareReports(before, after)).toMatchObject([
            {providerId: 'a/b', configurationId: 'c', resolvedSignals: ['literal'], outputChanged: true},
            {providerId: 'a', configurationId: 'b/c', resolvedSignals: [], outputChanged: false},
        ]);
    });
    it('writes auditable classification amendments without replacing raw evidence or inferring an unobserved timeout', () => {
        const directory = mkdtempSync(path.join(os.tmpdir(), 'quality-audit-'));
        try {
            const input = path.join(directory, 'raw.json'), output = path.join(directory, 'audited.json');
            const raw = JSON.stringify({schemaVersion: 1, id: 'raw', corpus: {...fixture(), id: 'fixture', sha256: 'fixture'},
                environment: {}, runs: [{...run(''), status: 'failure', failure: {category: 'response', message: 'response'}, transport: []}]});
            writeFileSync(input, raw);
            execFileSync(process.execPath, ['scripts/quality/audit.mjs', input, output]);
            expect(readFileSync(input, 'utf8')).toBe(raw);
            const audited = JSON.parse(readFileSync(output, 'utf8'));
            expect(audited.runs[0].failure.category).toBe('unavailable');
            expect(audited.audit.corrections).toHaveLength(1);
            expect(audited.audit.corrections[0].previous.category).toBe('response');
            expect(audited.audit.rawReportSha256).toMatch(/^[a-f0-9]{64}$/u);
            expect(() => execFileSync(process.execPath, ['scripts/quality/audit.mjs', input, path.join(directory, '.', 'raw.json')], {stdio: 'pipe'})).toThrow();
        } finally {rmSync(directory, {recursive: true, force: true});}
    });
});
