/**
 * @file tests/targetLanguageReadingHoldout.test.ts
 * 第一份冻结阅读样本的开发后验收及第二份独立盲测：调用生产识别函数，检查所有目录目标零错误跳过、排除语言等价与分组召回。
 * baseline 为 main b4a90dd4 对同一冻结语料的首次测量；不要求逐条识别，保留混合、共享汉字和其他不确定内容。
 * 首份失败家族促成通用语法改进，因此首份报告为开发后测量，八对增益门槛不变；第二份在不读改动和分支结果时独立冻结，只做最终测量。
 * 第一份整体至少多跳过八个正确目标对（十个百分点），同时不能降低既有分组跳过数；不复制生产算法或使用网络服务。
 */
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import corpus from './fixtures/target-language-reading-holdout.json';
import blindCorpus from './fixtures/target-language-reading-blind-holdout.json';
import {translationLanguageOptions} from '@/src/core/language/catalog';
import {shouldSkipTranslationForTarget} from '@/src/core/language/detect';

const fixturePath = fileURLToPath(new URL('./fixtures/target-language-reading-holdout.json', import.meta.url));
const frozenSha256 = 'd084afe4b54fc08e8bc63308edcd4e4b2d23df8b6884405d0732c95e6e446d50';
const targets = translationLanguageOptions.map(option => option.value);
const cases = corpus.cases;
const baseline = {
    expected: 80,
    skipped: 51,
    byGroup: {'short-hans': 15, 'short-hant': 9, 'han-context': 6, 'japanese-boundary': 8, 'technical-reading': 13, 'mixed-reading': 0},
};
const normalize = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

function measure(items: typeof cases) {
    let expected = 0;
    let skipped = 0;
    const wrong: string[] = [];
    for (const item of items) {
        for (const target of targets) {
            const decision = shouldSkipTranslationForTarget(item.text, target);
            if (item.languages.includes(target)) {
                expected += 1;
                if (decision) skipped += 1;
            } else if (decision) wrong.push(`${item.id}→${target}`);
        }
    }
    return {expected, skipped, wrong, recall: expected ? skipped / expected : null};
}

describe('第一份冻结阅读样本的开发后测量', () => {
    it('原文、标注与组别冻结，每组十六条且与既有所有 JSON 夹具无相同文本', () => {
        expect(createHash('sha256').update(readFileSync(fixturePath)).digest('hex')).toBe(frozenSha256);
        expect(cases).toHaveLength(96);
        expect(new Set(cases.map(item => item.id)).size).toBe(96);
        expect(new Set(cases.map(item => normalize(item.text))).size).toBe(96);
        for (const group of corpus.groups) {
            expect(group.cases).toBe(16);
            expect(cases.filter(item => item.tags.includes(group.id))).toHaveLength(16);
        }
        const existing = new Set<string>();
        const readStrings = (value: unknown): void => {
            if (typeof value === 'string') existing.add(normalize(value));
            else if (Array.isArray(value)) value.forEach(readStrings);
            else if (value && typeof value === 'object') Object.values(value).forEach(readStrings);
        };
        const walk = (directory: string): void => {
            for (const file of readdirSync(directory)) {
                const path = join(directory, file);
                if (statSync(path).isDirectory()) walk(path);
                else if (path !== fixturePath && path.endsWith('.json')) readStrings(JSON.parse(readFileSync(path, 'utf8')));
            }
        };
        walk(dirname(fixturePath));
        expect(cases.filter(item => existing.has(normalize(item.text))).map(item => item.id)).toEqual([]);
    });

    it.each(cases.map(item => [item.id, item] as const))('%s：只允许正确目标跳过，未知和混合内容保留请求', (_id, item) => {
        for (const language of item.languages) expect(targets).toContain(language);
        for (const target of targets) {
            const skipped = shouldSkipTranslationForTarget(item.text, target);
            if (!item.languages.includes(target)) expect(skipped, `${item.id}→${target}`).toBe(false);
            expect(shouldSkipTranslationForTarget(item.text, 'und', [target]), `${item.id} excluded ${target}`).toBe(skipped);
        }
    });

    it('零错误跳过且整体正确跳过数比独立 baseline 至少增加八对', () => {
        const result = measure(cases);
        expect(result.wrong).toEqual([]);
        expect(result.expected).toBe(baseline.expected);
        expect(result.skipped, JSON.stringify({baseline, result})).toBeGreaterThanOrEqual(baseline.skipped + 8);
    });

    it.each(corpus.groups.map(group => [group.id] as const))('%s 的召回不能低于 baseline', group => {
        const result = measure(cases.filter(item => item.tags.includes(group)));
        expect(result.wrong).toEqual([]);
        expect(result.skipped, JSON.stringify(result)).toBeGreaterThanOrEqual(baseline.byGroup[group as keyof typeof baseline.byGroup]);
    });
});
const blindCases = blindCorpus.cases;
const blindFixturePath = fileURLToPath(new URL('./fixtures/target-language-reading-blind-holdout.json', import.meta.url));
const blindFrozenSha256 = 'b8cec1433872e21064021f10d29c2f80e45b5944a5f1dbd08c7a70b190678362';
const blindBaseline = {
    expected: 55, skipped: 29,
    byGroup: {'natural-hant': 6, 'shared-chinese': 0, 'technical-reading': 10, 'mixed-reading': 0, 'japanese-boundary': 5, 'non-cjk': 8},
};

describe('第二份独立盲测阅读留出语料', () => {
    it('先冻结再测量，每组十条且与第一份及其他 JSON 夹具无重复', () => {
        expect(createHash('sha256').update(readFileSync(blindFixturePath)).digest('hex')).toBe(blindFrozenSha256);
        expect(blindCases).toHaveLength(60);
        expect(new Set(blindCases.map(item => item.id)).size).toBe(60);
        expect(new Set(blindCases.map(item => normalize(item.text))).size).toBe(60);
        for (const group of blindCorpus.groups) {
            expect(group.cases).toBe(10);
            expect(blindCases.filter(item => item.tags.includes(group.id))).toHaveLength(10);
        }
        const existing = new Set<string>();
        const readStrings = (value: unknown): void => {
            if (typeof value === 'string') existing.add(normalize(value));
            else if (Array.isArray(value)) value.forEach(readStrings);
            else if (value && typeof value === 'object') Object.values(value).forEach(readStrings);
        };
        const walk = (directory: string): void => {
            for (const file of readdirSync(directory)) {
                const path = join(directory, file);
                if (statSync(path).isDirectory()) walk(path);
                else if (path !== blindFixturePath && path.endsWith('.json')) readStrings(JSON.parse(readFileSync(path, 'utf8')));
            }
        };
        walk(dirname(blindFixturePath));
        expect(blindCases.filter(item => existing.has(normalize(item.text))).map(item => item.id)).toEqual([]);
    });

    it.each(blindCases.map(item => [item.id, item] as const))('%s：所有目录目标零错误跳过，目标与排除语言等价', (_id, item) => {
        for (const language of item.languages) expect(targets).toContain(language);
        for (const target of targets) {
            const skipped = shouldSkipTranslationForTarget(item.text, target);
            if (!item.languages.includes(target)) expect(skipped, `${item.id}→${target}`).toBe(false);
            expect(shouldSkipTranslationForTarget(item.text, 'und', [target]), `${item.id} excluded ${target}`).toBe(skipped);
        }
    });

    it('整体不低于首次 main baseline，不用盲测逐条逼出确定归属', () => {
        const result = measure(blindCases);
        expect(result.wrong).toEqual([]);
        expect(result.expected).toBe(blindBaseline.expected);
        expect(result.skipped, JSON.stringify(result)).toBeGreaterThanOrEqual(blindBaseline.skipped);
    });

    it.each(blindCorpus.groups.map(group => [group.id] as const))('%s 的盲测召回不低于 main baseline', group => {
        const result = measure(blindCases.filter(item => item.tags.includes(group)));
        expect(result.wrong).toEqual([]);
        expect(result.skipped, JSON.stringify(result)).toBeGreaterThanOrEqual(blindBaseline.byGroup[group as keyof typeof blindBaseline.byGroup]);
    });
});
