import {describe, expect, it} from 'vitest';
import {buildReadingEvidence, EVIDENCE_INSTRUCTION, formatReadingEvidence, parseReadingEvidence, readingEvidenceText, validateReadingEvidence} from '@/src/core/harness/evidence';

describe('reading evidence source protocol', () => {
    it('builds stable sources only from supplied text and distinguishes repeated sentences', () => {
        const sources = buildReadingEvidence('  It   works. It works.\n条件成立。下一句！', ' Before it works. ');
        expect(sources.map(({text, start, kind}) => ({text, start, kind}))).toEqual([
            {text: 'It works.', start: 0, kind: 'selection'},
            {text: 'It works.', start: 10, kind: 'selection'},
            {text: '条件成立。', start: 20, kind: 'selection'},
            {text: '下一句！', start: 25, kind: 'selection'},
            {text: 'Before it works.', start: 0, kind: 'context'},
        ]);
        expect(new Set(sources.map(source => source.id)).size).toBe(sources.length);
        expect(buildReadingEvidence('It works. It works. 条件成立。下一句！', 'Before it works.')).toEqual(sources);
        expect(buildReadingEvidence('It works. It works. 条件成立。下一句！', 'Changed context.')[0].id).not.toBe(sources[0].id);
        expect(formatReadingEvidence(sources)).toContain(JSON.stringify(sources));
    });

    it('bounds both kinds and preserves continuous tail text without inventing spaces', () => {
        const selected = Array.from({length: 40}, (_, index) => `句${index}。`).join('');
        const context = 'long '.repeat(1000);
        const sources = buildReadingEvidence(selected, context);
        expect(sources.filter(source => source.kind === 'selection')).toHaveLength(16);
        expect(sources).toHaveLength(17);
        for (const source of sources) {
            const original = source.kind === 'selection' ? selected : context.trim().slice(0, 4096).replace(/\s+/gu, ' ').trim();
            expect(source.text.length).toBeLessThanOrEqual(4096);
            expect(original.slice(source.start, source.start + source.text.length)).toBe(source.text);
        }
        expect(sources[15].text).toBe(selected.slice(sources[15].start));
        expect(buildReadingEvidence(selected, selected)).toHaveLength(32);
        expect(buildReadingEvidence('   ', '')).toEqual([]);
        expect(buildReadingEvidence('...', '"quoted." Last fragment').map(source => source.text)).toEqual(['...', '"quoted."', 'Last fragment']);
        expect(buildReadingEvidence('Use v1.2 at example.com. It works!', '').map(source => source.text)).toEqual(['Use v1.2 at example.com.', 'It works!']);
        expect(buildReadingEvidence('…', '…Around it. Next…').map(({text, kind, start}) => ({text, kind, start}))).toEqual([
            {text: '…', kind: 'selection', start: 0}, {text: 'Around it.', kind: 'context', start: 1}, {text: 'Next', kind: 'context', start: 12},
        ]);
    });

    it('accepts nearby multi-sentence support with exact identities and normalized whitespace', () => {
        const sources = buildReadingEvidence('The reactor stops if it overheats. It resumes after cooling.', 'The temperature must be below 40 degrees.');
        const answer = `条件是过热。[[cite:${sources[0].id}|if  it overheats.]]冷却后才恢复。[[cite:${sources[1].id}|It resumes after cooling.]]阈值也要满足。[[cite:${sources[2].id}|below 40 degrees]]`;
        const blocks = parseReadingEvidence(answer, sources);
        expect(blocks).toEqual([
            {kind: 'text', text: '条件是过热。'},
            {kind: 'citation', id: sources[0].id, quote: 'if it overheats.', sourceText: sources[0].text, sourceKind: 'selection', sourceStart: 0},
            {kind: 'text', text: '冷却后才恢复。'},
            {kind: 'citation', id: sources[1].id, quote: sources[1].text, sourceText: sources[1].text, sourceKind: 'selection', sourceStart: 35},
            {kind: 'text', text: '阈值也要满足。'},
            {kind: 'citation', id: sources[2].id, quote: 'below 40 degrees', sourceText: sources[2].text, sourceKind: 'context', sourceStart: 0},
        ]);
        expect(parseReadingEvidence(validateReadingEvidence(answer, sources), sources)).toEqual(blocks);
    });

    it('rejects forged identities, altered quotes, non-contiguous text, empty and malformed markers', () => {
        const sources = buildReadingEvidence('The reactor stops if it overheats.', '');
        const cases = [
            '[[cite:https://evil.example|The reactor stops]]',
            `[[cite:${sources[0].id}|The reactor continues]]`,
            `[[cite:${sources[0].id}|The reactor overheats]]`,
            `[[cite:${sources[0].id}|   ]]`,
            `[[cite:${sources[0].id}]]`,
            `[[cite:${sources[0].id}|The reactor stops`,
            '[[cite:',
            `[[cite:${sources[0].id}|${' '.repeat(4097)}The reactor]]`,
        ];
        for (const answer of cases) {
            expect(parseReadingEvidence(answer, sources)).toEqual([{kind: 'unavailable', text: expect.any(String)}]);
            const validated = validateReadingEvidence(answer, sources);
            expect(validated).toContain('[[cite:unavailable|');
            expect(parseReadingEvidence(validated, sources)[0].kind).toBe('unavailable');
            expect(validateReadingEvidence(validated, sources)).toBe(validated);
        }
        expect(parseReadingEvidence('prefix [[cite:unknown|invented]] suffix', sources)).toEqual([
            {kind: 'text', text: 'prefix '}, {kind: 'unavailable', text: 'invented'}, {kind: 'text', text: ' suffix'},
        ]);
        expect(parseReadingEvidence(`[[cite:${sources[0].id}|The reactor]]`, buildReadingEvidence('Other source.', ''))[0].kind).toBe('unavailable');
    });

    it('keeps unsupported and external knowledge text distinct from actionable page references', () => {
        const sources = buildReadingEvidence('It failed.', '');
        const text = '原文没有指出 it 的对象，无法确定指代。\n[[external]] it 通常回指前文提到的事物。';
        expect(parseReadingEvidence(text, sources)).toEqual([{kind: 'text', text}]);
        expect(validateReadingEvidence(text, sources)).toBe(text);
        expect(parseReadingEvidence('', sources)).toEqual([]);
        expect(EVIDENCE_INSTRUCTION).toContain('[[external]]');
        expect(EVIDENCE_INSTRUCTION).toContain('历史问答不是本轮页面原文');
        expect(EVIDENCE_INSTRUCTION).toContain('每项');
        expect(EVIDENCE_INSTRUCTION).toContain('引用只证明对应');
    });

    it('never grants a stored unavailable identity even when a caller supplies a matching source', () => {
        expect(parseReadingEvidence('[[cite:unavailable|saved original]]', [{id: 'unavailable', text: 'saved original', kind: 'selection', start: 0}])).toEqual([{kind: 'unavailable', text: 'saved original'}]);
    });

    it('exports actual quotes and localized status without leaking model citation identities', () => {
        const sources = buildReadingEvidence('The reactor stops if it overheats.', 'It resumes after cooling.');
        const answer = `It stops when hot. [[cite:${sources[0].id}|if  it overheats.]]\nIt resumes later. [[cite:${sources[1].id}|It resumes after cooling.]]\nA forged quote: [[cite:unknown-id|if it overheats.]]\n[[external]] General background.\n[[external]] Another example.`;
        const exported = readingEvidenceText(answer, sources, {evidence: 'Source', unverified: 'Unverified', external: 'Background'});
        expect(exported).toBe('It stops when hot. 【Source】 if it overheats.\nIt resumes later. 【Source】 It resumes after cooling.\nA forged quote: 【Unverified】 if it overheats.\n【Background】 General background.\n【Background】 Another example.');
        expect(exported).not.toContain('[[cite:');
        expect(exported).not.toContain('[[external]]');
        expect(exported).not.toContain(sources[0].id);
        expect(exported).not.toContain('unknown-id');
        expect(readingEvidenceText(answer, [], {evidence: '依据', unverified: '未核对', external: '外部背景'})).toContain('【未核对】 if it overheats.');
    });

    it('keeps rejected and incomplete quotes unverified when exporting saved or streaming answers', () => {
        const sources = buildReadingEvidence('Original fact.', '');
        const labels = {evidence: '依据', unverified: '未核对', external: '外部背景'};
        expect(readingEvidenceText(`Saved [[cite:unavailable|Unsupported fact.]] and [[cite:${sources[0].id}|Altered fact.]]`, sources, labels)).toBe('Saved 【未核对】 Unsupported fact. and 【未核对】 Altered fact.');
        expect(readingEvidenceText(`Partial [[cite:${sources[0].id}|Original fact.`, sources, labels)).toBe('Partial 【未核对】 Original fact.');
        expect(readingEvidenceText('No source was provided. [[external]] An example.', [], labels)).toBe('No source was provided. 【外部背景】 An example.');
        expect(readingEvidenceText('', sources, labels)).toBe('');
    });
});
