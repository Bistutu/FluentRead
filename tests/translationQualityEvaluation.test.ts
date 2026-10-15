import {describe, expect, it} from 'vitest';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {validateCorpus, evaluateTranslation, classifyFailure, compareReports, summarize} from '../scripts/quality/evaluate.mjs';

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
        expect(new Set(corpus.samples.map((item: any) => item.domain)).size).toBe(5);
        expect(new Set(corpus.samples.flatMap((item: any) => item.requirements.map((requirement: any) => requirement.category))).size).toBe(7);
        expect(corpus.samples.every((item: any) => item.humanReview.status === 'pending')).toBe(true);
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
    it('reports failed requests separately from flags and successful-return latency', () => {
        const summary = summarize([run('12 ms'), {...run(''), status: 'failure', durationMs: 5000, failure: {category: 'network'}}])[0];
        expect(summary).toMatchObject({attempted: 2, returned: 1, flagged: 1, failures: {network: 1}, medianLatencyMs: 10});
        expect(summarize([run('12 ms'), {...run('12 ms'), durationMs: 100}])[0].medianLatencyMs).toBe(55);
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
