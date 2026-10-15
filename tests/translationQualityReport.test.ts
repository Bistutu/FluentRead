import {describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {Script} from 'node:vm';
import {createReviewTemplate, renderQualityReport} from '../scripts/quality/report.mjs';
import type {QualityReport} from '../scripts/quality/report.mjs';

function fixture(): QualityReport {
    const samples = [
        {id: 'technical-negation', domain: 'technical', sourceLanguage: 'en', targetLanguage: 'zh-CN', source: 'Do not exceed 25 ms.', sourceContext: 'Timing constraint', humanReview: {status: 'not-reviewed'}, requirements: [{id: 'negation-1', category: 'negation', severity: 'critical', description: '保留不得超过的否定关系', requiresHumanReview: true}]},
        {id: 'news-budget', domain: 'news', sourceLanguage: 'en', targetLanguage: 'zh-CN', source: 'The budget is $20.', humanReview: {status: 'not-reviewed'}, requirements: [{id: 'number-1', category: 'numbers', severity: 'major', description: '保留金额 20 和币种', requiresHumanReview: false}]},
    ];
    const cost = {httpRequests: 1, inputCharacters: 20, requestBytes: 40, responseBytes: 80, monetaryCost: null, unit: 'USD', note: 'Unverified billing'};
    return {schemaVersion: 1, id: 'baseline-1', createdAt: '2026-10-15T00:00:00Z', corpus: {id: 'public-synthetic', sha256: 'abc123', samples}, environment: {mode: 'fixture'}, runs: [
        {sampleId: samples[0].id, providerId: 'alpha', configurationId: 'default', repeat: 1, status: 'success', translation: '必须超过 25 毫秒。', durationMs: 1000, cost, checks: [{requirementId: 'negation-1', category: 'negation', status: 'flagged', description: '否定线索缺失，须核对'}], review: {status: 'pending'}},
        {sampleId: samples[1].id, providerId: 'beta', configurationId: 'context', repeat: 1, status: 'success', translation: '预算为 20 美元。', durationMs: 2000, cost, checks: [{requirementId: 'number-1', category: 'numbers', status: 'signal-clear', description: '数字规则未发现疑点'}], review: {status: 'pending'}},
        {sampleId: samples[0].id, providerId: 'beta', configurationId: 'default', repeat: 2, status: 'failure', durationMs: 3000, cost, failure: {category: 'network', message: 'Connection timed out'}, checks: [], review: {status: 'pending'}},
        {sampleId: samples[1].id, providerId: 'alpha', configurationId: 'context', repeat: 2, status: 'cancelled', durationMs: 500, cost: {...cost, httpRequests: 0}, checks: [], review: {status: 'pending'}},
    ]};
}

function openReport(report = fixture(), options: {saved?: string; deniedClipboard?: boolean; deniedStorage?: boolean} = {}) {
    const html = renderQualityReport(report);
    const {document, window} = parseHTML(html);
    let focused: Element | null = null;
    Object.defineProperty(document, 'activeElement', {get: () => focused});
    for (const element of document.querySelectorAll('input, select, textarea, button')) {
        (element as HTMLElement).focus = () => { focused = element; };
        if (element.tagName === 'TEXTAREA') (element as HTMLTextAreaElement).select = vi.fn();
    }
    // linkedom 没有原生 select.value setter；保持浏览器同样的控件初始值与可写行为。
    for (const select of document.querySelectorAll('select')) {
        Object.defineProperty(select, 'value', {writable: true, value: select.querySelector('option')!.getAttribute('value')});
        Object.defineProperty(select, 'options', {value: select.querySelectorAll('option')});
    }
    const storage = new Map(options.saved ? [['fluentread-quality-filters:baseline-1:abc123', options.saved]] : []);
    const writeText = options.deniedClipboard ? vi.fn().mockRejectedValue(new Error('Denied')) : vi.fn().mockResolvedValue(undefined);
    const createObjectURL = vi.fn().mockReturnValue('blob:quality-review');
    const revokeObjectURL = vi.fn();
    const timers: Array<() => void> = [];
    const downloads: Array<{href: string; download: string}> = [];
    const createElement = document.createElement.bind(document);
    document.createElement = ((name: string) => {
        const node = createElement(name);
        if (name === 'a') node.click = () => downloads.push({href: node.getAttribute('href')!, download: node.getAttribute('download')!});
        return node;
    }) as typeof document.createElement;
    const script = document.querySelector('script:not([type])')!.textContent!;
    new Script(script).runInNewContext({document, navigator: {clipboard: {writeText}}, localStorage: {
        getItem: (key: string) => { if (options.deniedStorage) throw new Error('Denied'); return storage.get(key) ?? null; },
        setItem: (key: string, value: string) => { if (options.deniedStorage) throw new Error('Denied'); storage.set(key, value); },
    }, Blob, URL: {createObjectURL, revokeObjectURL}, setTimeout: (callback: () => void) => timers.push(callback)});
    const setFilter = (id: string, value: string) => {
        const control = document.getElementById(id) as HTMLInputElement;
        control.value = value;
        control.dispatchEvent(new window.Event('input', {bubbles: true}));
    };
    const visible = () => [...document.querySelectorAll('[data-run-index]')].filter(element => !(element as HTMLElement).hidden).map(element => Number(element.getAttribute('data-run-index')));
    const click = (selector: string) => document.querySelector(selector)!.dispatchEvent(new window.Event('click', {bubbles: true}));
    return {html, document, window, visible, setFilter, click, writeText, createObjectURL, revokeObjectURL, timers, downloads, storage, focused: () => focused};
}

describe('translation quality report', () => {
    it('默认突出规则疑点和待审结果，将请求失败与取消分开并提供完整原文要求', () => {
        const page = openReport();
        expect(page.document.querySelector('.filters-disclosure')!.hasAttribute('open')).toBe(false);
        expect(page.document.querySelector('.filters-disclosure > summary')!.textContent).toBe('筛选结果 · 服务、领域、关键词');
        expect(page.visible()).toEqual([0, 1]);
        expect(page.document.getElementById('result-count')!.textContent).toBe('2 / 4 条结果');
        expect(page.document.querySelector('#run-0 .source')!.textContent).toBe('Do not exceed 25 ms.');
        expect(page.document.querySelector('#run-0 .source')!.closest('details')).toBe(null);
        expect(page.document.querySelector('#run-0 .requirements')!.textContent).toContain('保留不得超过的否定关系');
        expect(page.document.querySelector('#run-2 .failure')!.textContent).toContain('不计为语义错误');
        expect(page.document.body.textContent).toContain('金额成本：未知');
        expect(page.document.querySelectorAll('script[src],link[href]')).toHaveLength(0);
    });

    it('组合服务、配置、领域和文本筛选并恢复空筛选与全部记录', () => {
        const page = openReport();
        page.setFilter('provider', 'beta');
        page.setFilter('configuration', 'context');
        page.setFilter('domain', 'news');
        page.setFilter('search', '20 美元');
        expect(page.visible()).toEqual([1]);
        page.setFilter('search', '不存在的词');
        expect(page.visible()).toEqual([]);
        expect((page.document.getElementById('empty-state') as HTMLElement).hidden).toBe(false);
        expect((page.document.getElementById('download-review') as HTMLButtonElement).disabled).toBe(true);
        page.click('#empty-state button');
        expect(page.visible()).toEqual([0, 1, 2, 3]);
        expect(page.focused()?.id).toBe('search');
        page.setFilter('status', 'failure');
        expect(page.visible()).toEqual([2]);
        page.setFilter('status', 'cancelled');
        expect(page.visible()).toEqual([3]);
        page.setFilter('status', 'pending');
        expect(page.visible()).toEqual([0, 1]);
    });

    it('刷新恢复筛选，拒绝损坏选项，并在本地存储受限时仍能操作', () => {
        const restored = openReport(fixture(), {saved: JSON.stringify(['beta', '', '', 'failure', ''])});
        expect(restored.visible()).toEqual([2]);
        expect(JSON.parse(restored.storage.values().next().value!)[3]).toBe('failure');
        expect(openReport(fixture(), {saved: JSON.stringify(['not-a-provider', '', '', 'not-a-status', ''])}).visible()).toEqual([0, 1]);
        expect(openReport(fixture(), {saved: 'broken-json'}).visible()).toEqual([0, 1]);
        const denied = openReport(fixture(), {deniedStorage: true});
        denied.setFilter('status', 'all');
        expect(denied.visible()).toHaveLength(4);
    });

    it('复制精确样本与执行证据，剪贴板拒绝时提供可手动复制的文本', async () => {
        const page = openReport();
        page.click('[data-copy="0"]');
        await new Promise(resolve => setImmediate(resolve));
        const copied = JSON.parse(page.writeText.mock.calls[0][0]);
        expect(copied).toMatchObject({corpusSha256: 'abc123', runIndex: 0, sample: {source: 'Do not exceed 25 ms.'}, run: {providerId: 'alpha'}});
        expect(page.document.getElementById('action-status')!.textContent).toContain('已复制');
        const fallback = openReport(fixture(), {deniedClipboard: true});
        fallback.click('[data-copy="1"]');
        await new Promise(resolve => setImmediate(resolve));
        expect((fallback.document.querySelector('[data-copy-fallback="1"]') as HTMLElement).hidden).toBe(false);
        expect(fallback.focused()?.id).toBe('copy-1');
        expect(JSON.parse((fallback.document.getElementById('copy-1') as HTMLTextAreaElement).value).run.sampleId).toBe('news-budget');
        fallback.click('[data-close-copy="1"]');
        expect((fallback.document.querySelector('[data-copy-fallback="1"]') as HTMLElement).hidden).toBe(true);
        expect(fallback.focused()?.getAttribute('data-copy')).toBe('1');
    });

    it('只下载当前筛选的待审记录，保留语料哈希且绝不预填人工 verdict', async () => {
        const report = fixture();
        const direct = createReviewTemplate(report, [1, 1, -1, 9]);
        expect(direct.entries).toHaveLength(1);
        expect(direct).toMatchObject({reviewer: null, reviewedAt: null, status: 'pending', corpusSha256: 'abc123'});
        expect(direct.entries[0].review.requirements[0]).toMatchObject({verdict: null, evidence: ''});
        const page = openReport(report);
        page.setFilter('status', 'failure');
        page.click('#download-review');
        const blob = page.createObjectURL.mock.calls[0][0] as Blob;
        const downloaded = JSON.parse(await blob.text());
        expect(downloaded.entries.map((entry: {runIndex: number}) => entry.runIndex)).toEqual([2]);
        expect(downloaded.entries[0]).toMatchObject({executionStatus: 'failure', failure: {category: 'network'}, review: {status: 'pending'}});
        expect(page.downloads).toEqual([{href: 'blob:quality-review', download: 'quality-review-baseline-1.json'}]);
        expect(page.document.querySelector('a[href^="blob:"]')).toBe(null);
        page.timers.forEach(callback => callback());
        expect(page.revokeObjectURL).toHaveBeenCalledWith('blob:quality-review');
    });

    it('键盘快捷键不抢占编辑，Escape 清除搜索，原生按钮与详情保持可达', () => {
        const page = openReport();
        const keyboard = (key: string) => {
            const event = new page.window.Event('keydown', {cancelable: true});
            Object.assign(event, {key});
            page.document.dispatchEvent(event);
            return event;
        };
        expect(keyboard('/').defaultPrevented).toBe(true);
        expect(page.document.querySelector('.filters-disclosure')!.hasAttribute('open')).toBe(true);
        expect(page.focused()?.id).toBe('search');
        expect(keyboard('/').defaultPrevented).toBe(false);
        page.setFilter('search', 'missing');
        expect(page.visible()).toHaveLength(0);
        keyboard('Escape');
        expect(page.visible()).toEqual([0, 1]);
        page.document.querySelector('.filters-disclosure')!.removeAttribute('open');
        page.click('#run-0 a[href="#filters"]');
        expect(page.document.querySelector('.filters-disclosure')!.hasAttribute('open')).toBe(true);
        expect(page.document.querySelectorAll('summary')).toHaveLength(11);
        expect(page.html).toContain(':focus-visible');
    });

    it('转义恶意语料、译文和元数据，内嵌 JSON 保留原始内容而不能闭合脚本', () => {
        const report = fixture();
        const payload = '</script><img src=x onerror="globalThis.compromised=true"><script>bad()</script>&\u2028';
        report.id = payload;
        report.corpus.samples[0].source = payload;
        report.corpus.samples[0].requirements[0].description = payload;
        report.runs[0].providerId = payload;
        report.runs[0].translation = payload;
        const page = openReport(report);
        expect(page.document.querySelectorAll('script')).toHaveLength(3);
        expect(page.document.querySelectorAll('img,[onerror]')).toHaveLength(0);
        expect(page.document.querySelector('#run-0 .translation p')!.textContent).toBe(payload);
        expect(JSON.parse(page.document.getElementById('report-data')!.textContent!).corpus.samples[0].source).toBe(payload);
        expect(page.html).toContain('default-src \'none\'');
        expect(page.html).toContain('@media(prefers-color-scheme:dark)');
        expect(page.html).toContain('@media(max-width:680px)');
    });

    it('零执行和缺失样本保持可审阅空态，不捏造语义判断', () => {
        const report = fixture();
        const empty = openReport({...report, runs: []});
        expect(empty.visible()).toEqual([]);
        expect(empty.document.getElementById('result-count')!.textContent).toBe('0 / 0 条结果');
        expect((empty.document.getElementById('download-review') as HTMLButtonElement).disabled).toBe(true);
        report.runs[0].sampleId = 'missing-sample';
        const missing = openReport(report);
        expect(missing.document.querySelector('#run-0 .source')!.textContent).toContain('未找到对应语料');
        expect(createReviewTemplate(report, [0]).entries[0].source).toBe(null);
    });

    it('中断报告显式标明范围不完整并保留服务暂缓与语料来源记录', () => {
        const report = {...fixture(), complete: false, interrupted: true, providerDeferrals: {beta: {category: 'blocked'}}};
        report.corpus.samples[0].provenance = {kind: 'synthetic', author: 'Codex'};
        report.corpus.samples[0].domain = 'mixed-language';
        report.corpus.samples[0].requirements[0].category = 'numbers-units';
        const page = openReport(report);
        expect(page.document.body.textContent).toContain('评测已中断');
        expect(page.document.body.textContent).toContain('服务暂缓记录');
        expect(page.document.querySelector('#run-0 .eyebrow')!.textContent).toContain('混合语言');
        expect(page.document.querySelector('#run-0 .requirements')!.textContent).toContain('数字单位');
        expect(page.document.querySelector('#run-0 .source-details')!.textContent).toContain('synthetic');
        expect(createReviewTemplate(report, [0]).entries[0].sourceProvenance).toEqual({kind: 'synthetic', author: 'Codex'});
    });

    it('同组任一请求字节未知时展示未知，不把部分已知用量当作完整成本', () => {
        const report = fixture();
        report.runs[0].cost = {...report.runs[0].cost, requestBytes: null};
        report.runs.push({...report.runs[0], repeat: 3, cost: {...report.runs[0].cost, requestBytes: 50}});
        const page = openReport(report);
        const firstRow = page.document.querySelector('tbody tr')!;
        expect(firstRow.querySelector('td:last-child')!.textContent).toBe('未知 / 160');
        report.runs[0].cost.responseBytes = null;
        expect(openReport(report).document.querySelector('tbody tr td:last-child')!.textContent).toBe('未知 / 未知');
    });

    it('只把本轮出现的唯一语料计入样本数，并将暂缓与实际请求失败区分', () => {
        const report = fixture();
        report.runs = [report.runs[0], {...report.runs[2],
            failure: {category: 'deferred', message: 'Waiting for provider recovery'},
            cost: {...report.runs[2].cost, httpRequests: 0, inputCharacters: 0},
        }];
        const page = openReport(report);
        expect(page.document.querySelector('.stats')!.textContent).toContain('1个本轮样本 / 语料共 2 个');
        expect(page.document.querySelector('#run-1 .badge')!.textContent).toBe('已暂缓 · 未发送请求');
        expect(page.document.querySelector('#run-1 .failure')!.textContent).toContain('尚未发送请求');
        expect(openReport({...report, runs: []}).document.querySelector('.stats')!.textContent).toContain('0个本轮样本 / 语料共 2 个');
    });

    it('对照表保留计划、恢复记录与真实发出请求的不同分母，并列出尚未执行的服务', () => {
        const report = fixture();
        const success = report.runs[0];
        const noRequest = {...success.cost, httpRequests: 0, inputCharacters: 999, requestBytes: 0, responseBytes: 0};
        report.plan = {sampleIds: ['technical-negation', 'news-budget'], providerIds: ['alpha', 'not-started'], configurationId: 'default', repeats: 2};
        report.runs = [success,
            {...success, status: 'failure', failure: {category: 'deferred', message: 'Cooldown'}, cost: noRequest},
            {...success, status: 'cancelled', cost: noRequest},
        ];
        const page = openReport(report);
        const rows = [...page.document.querySelectorAll('tbody tr')];
        expect([...rows[0].querySelectorAll('td')].slice(0, 5).map(cell => cell.textContent)).toEqual(['4 / 3', '2 / 1', '1', '1', '0 / 1 / 1']);
        expect(rows[1].querySelector('th')!.textContent).toContain('not-started');
        expect([...rows[1].querySelectorAll('td')].slice(0, 5).map(cell => cell.textContent)).toEqual(['4 / 0', '0 / 0', '0', '0', '0 / 0 / 0']);
        expect(rows[0].querySelector('td:nth-of-type(8)')!.textContent).toBe('20');
        expect(page.document.body.textContent).toContain('零 HTTP');
        expect(report.runs[1].cost.inputCharacters).toBe(999);
        expect(openReport({...report, runs: []}).document.querySelector('.comparison > summary')!.textContent).toContain('2 组');
    });
});
