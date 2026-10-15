/**
 * @file scripts/quality/report.mjs
 * 生成离线可审阅的翻译质量报告。此工具只展示评测证据和导出待审表，
 * 不执行翻译、不发起网络请求，也不把自动规则信号认定为人工质量结论。
 */
import {summarize} from './evaluate.mjs';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const jsonForScript = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
const readable = value => typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2);
const domainNames = {technical: '技术文档', news: '新闻', colloquial: '口语', academic: '论文', mixed: '混合语言', 'mixed-language': '混合语言'};
const categoryNames = {omission: '漏译', mistranslation: '错译', negation: '否定关系', numbers: '数字单位', units: '数字单位', 'numbers-units': '数字单位', reference: '指代', terminology: '术语一致性', format: '格式', completeness: '完整性'};
const statusNames = {flagged: '自动规则疑点', 'needs-human-review': '待人工核对', 'signal-clear': '规则未发现疑点'};

function runState(run) {
    if (run.status === 'failure') return 'failure';
    if (run.status === 'cancelled') return 'cancelled';
    if (run.checks?.some(check => check.status === 'flagged')) return 'flagged';
    if (run.review?.status !== 'reviewed' || run.checks?.some(check => check.status === 'needs-human-review')) return 'pending';
    return 'clear';
}

/** 导出空白的人工作业记录；保留原始证据，不预填人工判断。 */
export function createReviewTemplate(report, runIndexes = report.runs.map((_, index) => index)) {
    const samples = new Map(report.corpus.samples.map(sample => [sample.id, sample]));
    return {
        schemaVersion: 1,
        reportId: report.id,
        corpusId: report.corpus.id,
        corpusSha256: report.corpus.sha256,
        instructions: '此文件尚未人工核验。请逐项填写 verdict（pass/fail/uncertain/not-applicable）和证据，再署名并记录时间。自动规则信号不等于人工结论；请求失败不能判为翻译语义失败。',
        reviewer: null,
        reviewedAt: null,
        status: 'pending',
        entries: [...new Set(runIndexes)].filter(index => Number.isInteger(index) && index >= 0 && index < report.runs.length).map(index => {
            const run = report.runs[index];
            const sample = samples.get(run.sampleId);
            return {
                runIndex: index,
                sampleId: run.sampleId,
                providerId: run.providerId,
                configurationId: run.configurationId,
                repeat: run.repeat,
                source: sample?.source ?? null,
                sourceContext: sample?.sourceContext ?? null,
                sourceProvenance: sample?.provenance ?? null,
                sourceHumanReview: sample?.humanReview ?? null,
                translation: run.translation ?? null,
                executionStatus: run.status,
                failure: run.failure ?? null,
                automaticChecks: run.checks ?? [],
                review: {status: 'pending', notes: '', requirements: (sample?.requirements ?? []).map(requirement => ({
                    id: requirement.id, category: requirement.category, severity: requirement.severity,
                    description: requirement.description, verdict: null, evidence: '',
                }))},
            };
        }),
    };
}

function renderRun(run, sample, index) {
    const state = runState(run);
    const labels = {flagged: '规则疑点 · 待核对', pending: '待人工核对', failure: '请求失败', cancelled: '已取消', clear: '规则未发现疑点'};
    const checks = run.checks ?? [];
    const issues = checks.filter(check => check.status === 'flagged');
    const deferred = run.failure?.category === 'deferred';
    const requirements = sample?.requirements ?? [];
    const requirementById = new Map(requirements.map(requirement => [requirement.id, requirement]));
    const checkList = issues.length ? `<ul class="signals">${issues.map(check => `<li><span class="badge ${check.status === 'flagged' ? 'warning' : 'muted'}">${escapeHtml(statusNames[check.status] ?? check.status)}</span><span><strong>${escapeHtml(categoryNames[check.category] ?? check.category)}</strong> ${escapeHtml(check.description || requirementById.get(check.requirementId)?.description)}<small>${escapeHtml(check.requirementId)}</small></span></li>`).join('')}</ul>` : run.status === 'success' ? '<p class="hint">自动规则未发现疑点，语义准确性仍需人工核对。</p>' : '';
    return `<article class="result" id="run-${index}" data-run-index="${index}" tabindex="-1" aria-labelledby="title-${index}">
        <header class="result-header"><div><p class="eyebrow">${escapeHtml(domainNames[sample?.domain] ?? sample?.domain ?? '缺少样本')} · ${escapeHtml(sample?.sourceLanguage)} → ${escapeHtml(sample?.targetLanguage)}</p><h3 id="title-${index}">${escapeHtml(run.sampleId)}</h3></div><span class="badge ${state === 'flagged' ? 'warning' : state === 'failure' && !deferred ? 'error' : 'muted'}">${deferred ? '已暂缓 · 未发送请求' : labels[state]}</span></header>
        <p class="run-meta"><strong>${escapeHtml(run.providerId)}</strong><span>${escapeHtml(run.configurationId)}</span><span>第 ${escapeHtml(run.repeat)} 次</span><span>${Number.isFinite(run.durationMs) ? `${(run.durationMs / 1000).toFixed(2)} 秒` : '耗时未知'}</span><span>${Number.isFinite(run.cost?.httpRequests) ? `${run.cost.httpRequests} 个请求` : '请求数未知'}</span></p>
        <div class="comparison-copy"><section class="source-block"><span class="label">原文</span><p class="source" lang="${escapeHtml(sample?.sourceLanguage)}">${escapeHtml(sample?.source ?? '报告中未找到对应语料。')}</p></section>
        ${run.status === 'success' ? `<div class="translation"><span class="label">译文</span><p lang="${escapeHtml(sample?.targetLanguage)}">${escapeHtml(run.translation || '（服务返回空译文）')}</p></div>` : `<div class="failure"><strong>${run.status === 'cancelled' ? '本次执行已取消' : deferred ? '等待服务恢复，尚未发送请求' : `请求未完成 · ${escapeHtml(run.failure?.category ?? 'unknown')}`}</strong><p>${escapeHtml(run.failure?.message ?? '没有可供质量判定的译文。')}</p><span class="hint">请先处理执行问题后重新运行；此记录不计为语义错误。</span></div>`}
        </div>
        ${checkList}
        <details class="source-details"><summary>来源与上下文</summary>${sample?.sourceContext ? `<pre class="context">${escapeHtml(readable(sample.sourceContext))}</pre>` : ''}<p class="hint">语料来源</p><pre class="context">${escapeHtml(readable(sample?.provenance ?? {status: '未记录来源'}))}</pre><p class="hint">语料人工核对记录</p><pre class="human-review">${escapeHtml(readable(sample?.humanReview ?? {status: 'unknown'}))}</pre></details>
        <details class="requirements-details"><summary>全部判定要求（${requirements.length}）</summary><ul class="requirements">${requirements.map(requirement => {
            const check = checks.find(item => item.requirementId === requirement.id);
            return `<li><strong>${escapeHtml(requirement.id)}</strong><span class="requirement-meta">${escapeHtml(categoryNames[requirement.category] ?? requirement.category)} · ${escapeHtml(requirement.severity)} · ${requirement.requiresHumanReview ? '需人工核对' : '自动规则可检查'}</span><p>${escapeHtml(requirement.description)}</p><span class="hint">${escapeHtml(statusNames[check?.status] ?? '本次无自动检查记录')}</span></li>`;
        }).join('')}</ul></details>
        <div class="result-actions"><button type="button" data-copy="${index}">复制样本 JSON</button><a href="#filters">返回筛选</a></div>
        <div class="copy-fallback" data-copy-fallback="${index}" hidden><label for="copy-${index}">剪贴板不可用，请复制下方内容</label><textarea id="copy-${index}" readonly rows="5"></textarea><button type="button" data-close-copy="${index}">收起复制内容</button></div>
    </article>`;
}

function renderComparison(runs, plan) {
    const groups = new Map();
    const summaries = summarize(runs, plan);
    for (const summary of summaries) groups.set(JSON.stringify([summary.providerId, summary.configurationId]), {
        provider: summary.providerId, configuration: summary.configurationId, summary, runs: [],
    });
    for (const run of runs) {
        const key = JSON.stringify([run.providerId, run.configurationId]);
        groups.get(key).runs.push(run);
    }
    return [...groups.values()].map(group => {
        const success = group.runs.filter(run => run.status === 'success');
        const counts = group.summary;
        const durations = success.map(run => run.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
        const median = durations.length ? (durations[Math.floor((durations.length - 1) / 2)] + durations[Math.ceil((durations.length - 1) / 2)]) / 2 : null;
        // 旧版 runner 在暂缓记录上留下原文长度；展示按明确的零 HTTP 证据订正，原始 JSON 保持不变。
        const measured = (run, property) => property === 'inputCharacters' && run.cost?.httpRequests === 0 ? 0 : run.cost?.[property];
        const sum = property => group.runs.some(run => !Number.isFinite(measured(run, property))) ? '未知'
            : group.runs.reduce((total, run) => total + measured(run, property), 0).toLocaleString('en-US');
        return `<tr><th scope="row">${escapeHtml(group.provider)}<small>${escapeHtml(group.configuration)}</small></th><td>${counts.planned ?? '未知'} / ${counts.recordedRuns}</td><td>${counts.attempted} / ${counts.requested}</td><td>${counts.returned}</td><td>${counts.flagged}</td><td>${counts.failed} / ${counts.deferred} / ${counts.cancelled}</td><td>${median === null ? '—' : `${(median / 1000).toFixed(2)} 秒`}</td><td>${sum('httpRequests')}</td><td>${sum('inputCharacters').toLocaleString('en-US')}</td><td>${sum('requestBytes').toLocaleString('en-US')} / ${sum('responseBytes').toLocaleString('en-US')}</td></tr>`;
    }).join('');
}

// 此函数作为独立脚本写入产物；只依赖 DOM 和内嵌报告，不依赖 Node 或远程资源。
function installReportInteractions() {
    const report = JSON.parse(document.getElementById('report-data').textContent);
    const reviewTemplate = JSON.parse(document.getElementById('review-template').textContent);
    const filters = document.getElementById('filters');
    const filterDisclosure = document.getElementById('filter-disclosure');
    const openFilters = () => filterDisclosure.setAttribute('open', '');
    const controls = ['provider', 'configuration', 'domain', 'status', 'search'].map(name => document.getElementById(name));
    const cards = [...document.querySelectorAll('[data-run-index]')];
    const samples = new Map(report.corpus.samples.map(sample => [sample.id, sample]));
    const messages = document.getElementById('action-status');
    const downloadButton = document.getElementById('download-review');
    const storageKey = 'fluentread-quality-filters:' + report.id + ':' + report.corpus.sha256;
    let visibleIndexes = [];
    const announce = message => { messages.textContent = message; };
    function state(run) {
        if (run.status === 'failure' || run.status === 'cancelled') return run.status;
        if (run.checks.some(check => check.status === 'flagged')) return 'flagged';
        if (run.review?.status !== 'reviewed' || run.checks.some(check => check.status === 'needs-human-review')) return 'pending';
        return 'clear';
    }
    function applyFilters() {
        const [provider, configuration, domain, status, search] = controls.map(control => control.value);
        const term = search.trim().toLocaleLowerCase();
        visibleIndexes = [];
        for (const card of cards) {
            const index = Number(card.dataset.runIndex);
            const run = report.runs[index];
            const sample = samples.get(run.sampleId);
            const currentState = state(run);
            const text = [run.sampleId, run.providerId, run.configurationId, sample?.source, sample?.sourceContext && JSON.stringify(sample.sourceContext), run.translation, run.failure?.message, ...(run.checks ?? []).map(check => check.description), ...(sample?.requirements ?? []).map(requirement => requirement.description)].join(' ').toLocaleLowerCase();
            const matches = (!provider || run.providerId === provider) && (!configuration || run.configurationId === configuration) && (!domain || sample?.domain === domain) && (status === 'all' || (status === 'attention' ? ['flagged', 'pending'].includes(currentState) : status === 'pending' ? run.status === 'success' && (run.review?.status !== 'reviewed' || run.checks.some(check => check.status === 'needs-human-review')) : currentState === status)) && (!term || text.includes(term));
            card.hidden = !matches;
            if (matches) visibleIndexes.push(index);
        }
        document.getElementById('result-count').textContent = `${visibleIndexes.length} / ${report.runs.length} 条结果`;
        document.getElementById('empty-state').hidden = visibleIndexes.length > 0;
        downloadButton.disabled = visibleIndexes.length === 0;
        downloadButton.textContent = `下载审阅表（${visibleIndexes.length}）`;
        try { localStorage.setItem(storageKey, JSON.stringify(controls.map(control => control.value))); } catch { /* 本地文件或禁用存储时筛选仍可使用。 */ }
    }
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey));
        if (Array.isArray(saved)) controls.forEach((control, index) => {
            if (typeof saved[index] !== 'string') return;
            if (control.tagName === 'SELECT' && ![...control.options].some(option => option.value === saved[index])) return;
            control.value = saved[index];
        });
    } catch { /* 缺失或损坏的持久化数据回退为初始筛选。 */ }
    filters.addEventListener('input', applyFilters);
    filters.addEventListener('change', applyFilters);
    filters.addEventListener('submit', event => event.preventDefault());
    function resetFilters() {
        controls.forEach(control => { control.value = control.id === 'status' ? 'all' : ''; });
        applyFilters();
        openFilters();
        controls[4].focus();
    }
    document.querySelectorAll('[data-reset]').forEach(button => button.addEventListener('click', resetFilters));
    document.querySelectorAll('a[href="#filters"]').forEach(link => link.addEventListener('click', openFilters));
    document.addEventListener('keydown', event => {
        if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) {
            event.preventDefault(); openFilters(); controls[4].focus();
        }
        if (event.key === 'Escape' && document.activeElement === controls[4]) {
            controls[4].value = ''; applyFilters();
        }
    });
    document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
        const index = Number(button.dataset.copy);
        const run = report.runs[index];
        const text = JSON.stringify({reportId: report.id, corpusId: report.corpus.id, corpusSha256: report.corpus.sha256, runIndex: index, sample: samples.get(run.sampleId), run}, null, 2);
        try {
            await navigator.clipboard.writeText(text);
            announce(`已复制 ${run.sampleId} 的样本与执行结果。`);
        } catch {
            const fallback = document.querySelector(`[data-copy-fallback="${index}"]`);
            const textarea = fallback.querySelector('textarea');
            fallback.hidden = false; textarea.value = text; textarea.focus(); textarea.select();
            announce('剪贴板不可用，已展开可手动复制的内容。');
        }
    }));
    document.querySelectorAll('[data-close-copy]').forEach(button => button.addEventListener('click', () => {
        const index = button.dataset.closeCopy;
        document.querySelector(`[data-copy-fallback="${index}"]`).hidden = true;
        document.querySelector(`[data-copy="${index}"]`).focus();
    }));
    downloadButton.addEventListener('click', () => {
        const included = new Set(visibleIndexes);
        const template = {...reviewTemplate, entries: reviewTemplate.entries.filter(entry => included.has(entry.runIndex))};
        const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], {type: 'application/json'}));
        const link = document.createElement('a');
        link.href = url; link.download = 'quality-review-' + String(report.id).replace(/[^a-zA-Z0-9_.-]/g, '_') + '.json';
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        announce(`已下载 ${visibleIndexes.length} 条待审记录；人工结论尚未填写。`);
    });
    applyFilters();
}

/** 接收 runner 的 schemaVersion:1 报告，返回可通过 file 或 HTTP 打开的独立 HTML。 */
export function renderQualityReport(report) {
    const samples = new Map(report.corpus.samples.map(sample => [sample.id, sample]));
    const runs = report.runs.map(run => ({...run, checks: run.checks ?? []}));
    const normalized = {...report, runs};
    const flagged = runs.filter(run => run.status === 'success' && run.checks.some(check => check.status === 'flagged')).length;
    const successful = runs.filter(run => run.status === 'success').length;
    const failures = runs.filter(run => run.status === 'failure').length;
    const cancelled = runs.filter(run => run.status === 'cancelled').length;
    const options = (values, labels = {}) => [...new Set(values.filter(value => value != null))].sort().map(value => `<option value="${escapeHtml(value)}">${escapeHtml(labels[value] ?? value)}</option>`).join('');
    const sorted = runs.map((run, index) => ({run, index})).sort((a, b) => ({flagged: 0, pending: 1, failure: 2, cancelled: 3, clear: 4}[runState(a.run)] - {flagged: 0, pending: 1, failure: 2, cancelled: 3, clear: 4}[runState(b.run)]));
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>翻译质量审阅 · ${escapeHtml(report.id)}</title><style>
:root{color-scheme:light dark;--bg:#f5f6f8;--surface:#fff;--text:#17212e;--secondary:#566476;--border:#d9e0e7;--accent:#215bb8;--muted:#edf2f7;--warning-bg:#fff3d9;--warning:#835100;--error-bg:#fff0ed;--error:#a13324;--focus:#2a69cc;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}main{max-width:1120px;margin:auto;padding:30px 24px 60px}button,input,select,textarea{font:inherit;color:inherit}button,select,input{min-height:40px;border:1px solid var(--border);border-radius:7px;background:var(--surface);padding:7px 11px}button{cursor:pointer;font-weight:600}button:hover,a:hover{color:var(--accent)}button:disabled{opacity:.55;cursor:default}a{color:var(--accent);text-underline-offset:3px}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,textarea:focus-visible{outline:3px solid var(--focus);outline-offset:3px}h1,h2,h3,p{margin:0}h1{font-size:28px;line-height:1.3;letter-spacing:-.04em}h2{font-size:19px}h3{font-size:17px;overflow-wrap:anywhere}.header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.eyebrow,.label{color:var(--secondary);font-size:12px;letter-spacing:.03em}.eyebrow{margin-bottom:4px}.intro{color:var(--secondary);max-width:760px;margin-top:7px}.primary{background:var(--accent);border-color:var(--accent);color:white;white-space:nowrap}.primary:hover{color:white;filter:brightness(1.08)}.stats{display:flex;flex-wrap:wrap;gap:8px 24px;padding:18px 0 16px;border-bottom:1px solid var(--border)}.stats div{display:flex;gap:7px;align-items:baseline}.stats strong{font-size:22px;font-variant-numeric:tabular-nums}.stats span,.hint{color:var(--secondary);font-size:13px}.caution{margin:12px 0 18px;font-size:13px;color:var(--secondary)}.filters-disclosure{border:1px solid var(--border);border-radius:8px;background:var(--surface)}.filters-disclosure>summary{padding:10px 12px;cursor:pointer;font-size:13px;font-weight:600}.filters-disclosure .filter-grid{padding:12px;border-top:1px solid var(--border)}.filter-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.filter-grid label{display:flex;flex-direction:column;font-size:12px;gap:4px;color:var(--secondary)}.filter-grid select,.filter-grid input{width:100%;color:var(--text);min-width:0}.search{grid-column:1/4}.reset-wrap{display:flex;align-items:flex-end}.reset-wrap button{width:100%}.results-heading{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:24px 0 10px}.result{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:19px 22px;margin-bottom:12px;overflow-wrap:anywhere;scroll-margin:18px}.result-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.badge{display:inline-block;font-size:12px;line-height:1.5;padding:3px 8px;border-radius:5px;white-space:nowrap;font-weight:600}.warning{background:var(--warning-bg);color:var(--warning)}.error{background:var(--error-bg);color:var(--error)}.muted{background:var(--muted);color:var(--secondary)}.run-meta{display:flex;flex-wrap:wrap;gap:3px 14px;font-size:12px;color:var(--secondary);margin:8px 0 14px}.run-meta strong{color:var(--text)}.translation{border-left:3px solid var(--border);padding-left:14px;margin-bottom:14px}.translation p,.source{white-space:pre-wrap;overflow-wrap:anywhere}.translation p{margin-top:3px;line-height:1.8;font-size:16px}.failure{padding:12px 14px;background:var(--muted);border-radius:7px;margin-bottom:12px}.failure p{margin:5px 0}.signals,.requirements{list-style:none;padding:0;margin:8px 0 14px}.signals li{display:flex;gap:10px;align-items:baseline;padding:5px 0;font-size:14px}.signals strong{font-weight:600}.signals small{display:block;color:var(--secondary);font-size:11px}.result details{border-top:1px solid var(--border);padding:9px 0}.result summary{cursor:pointer;font-size:13px;font-weight:600;width:fit-content}.source{padding:10px 0 6px}.context,.human-review{font:12px/1.7 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--muted);border-radius:6px;padding:10px}.requirements{margin-bottom:0}.requirements li{padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}.requirements li:last-child{border-bottom:0}.requirement-meta{margin-left:10px;color:var(--secondary);font-size:12px}.requirements p{margin:3px 0}.result-actions{display:flex;justify-content:space-between;align-items:center;gap:10px;padding-top:10px}.result-actions a{font-size:12px}.result-actions button{font-size:12px;min-height:34px;padding:5px 10px}.empty{padding:32px 20px;text-align:center;border:1px dashed var(--border);border-radius:10px}.empty p{color:var(--secondary);margin:6px 0 14px}.copy-fallback{padding-top:12px}.copy-fallback label{font-size:13px}.copy-fallback textarea{display:block;width:100%;margin:6px 0;background:var(--bg);border:1px solid var(--border);border-radius:6px;resize:vertical;font:12px/1.5 ui-monospace,monospace}.comparison{margin-top:25px;border-top:1px solid var(--border);padding-top:18px}.comparison summary{cursor:pointer;font-size:15px;font-weight:600}.table-wrap{overflow:auto;margin-top:12px;border:1px solid var(--border);border-radius:8px}table{border-collapse:collapse;width:100%;font-size:12px;background:var(--surface)}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);white-space:nowrap}thead{background:var(--muted)}th small{display:block;font-weight:400;color:var(--secondary)}tr:last-child td,tr:last-child th{border-bottom:0}.provenance{margin-top:18px;font-size:12px;color:var(--secondary);overflow-wrap:anywhere}.provenance summary{cursor:pointer}.provenance pre{white-space:pre-wrap;overflow-wrap:anywhere}.status-message{font-size:13px;min-height:0;margin-top:8px;color:var(--accent)}.status-message:empty{margin:0}.skip-link{position:absolute;top:-100px;left:12px;background:var(--surface);padding:8px;z-index:2}.skip-link:focus{top:10px}[hidden]{display:none!important}
@media(prefers-color-scheme:dark){:root{--bg:#121821;--surface:#1b2430;--text:#e8eef5;--secondary:#a9b7c8;--border:#354354;--accent:#85b6ff;--muted:#263343;--warning-bg:#483820;--warning:#ffd083;--error-bg:#4c2a29;--error:#ffaea2;--focus:#8dbbff}.primary{background:#386dc0;color:#fff;border-color:#497ecf}}
@media(max-width:680px){main{padding:20px 14px 40px}.header{flex-direction:column;gap:10px}h1{font-size:24px}.header .primary{width:100%}.filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.search{grid-column:1/3}.reset-wrap{grid-column:1/3}.reset-wrap button{width:auto}.stats{gap:4px 16px;padding:10px 0}.stats div{gap:5px}.stats strong{font-size:18px}.stats span{font-size:12px}.caution{margin:8px 0 10px;font-size:12px;line-height:1.5}.result{padding:15px 14px}.result-header{flex-direction:column;gap:5px}.signals li{display:block}.signals li>.badge{margin:2px 0 4px}.signals li>span:last-child{display:block}.translation p{font-size:15px}.requirement-meta{display:block;margin-left:0}.results-heading{align-items:flex-start;margin-top:14px}.result-actions{flex-wrap:wrap}}
@media print{body{background:white;color:black}main{max-width:none;padding:0}.skip-link,.filters-disclosure,.header button,.result-actions,.copy-fallback,.status-message{display:none!important}.result{break-inside:avoid}details{display:block}.table-wrap{overflow:visible}th,td{white-space:normal}}
.comparison-copy{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;margin-bottom:14px}.comparison-copy .translation{border:0;padding:0;margin:0}.comparison-copy .source{padding:3px 0 0;font-size:16px;line-height:1.8}.source-block{min-width:0}
@media(max-width:680px){.comparison-copy{grid-template-columns:minmax(0,1fr);gap:12px}.comparison-copy .source{font-size:15px}.result-header{flex-direction:row;align-items:center;gap:8px}.result-header .badge{white-space:normal}}
</style></head><body><a class="skip-link" href="#results">跳至样本结果</a><main>
<header class="header"><div><p class="eyebrow">FluentRead · 质量基线</p><h1>翻译质量审阅</h1><p class="intro">核对问题样本，比较服务与配置。</p></div><button class="primary" id="download-review" type="button">下载审阅表</button></header>
${report.interrupted || report.complete === false ? `<p class="caution" role="status"><strong>${report.interrupted ? '评测已中断' : '评测未完成'}。</strong>当前展示已保存的执行记录；请使用同一语料与配置恢复评测，再进行完整对照。</p>` : ''}
<div class="stats" aria-label="执行摘要"><div><strong>${new Set(runs.map(run => run.sampleId)).size}</strong><span>个本轮样本 / 语料共 ${report.corpus.samples.length} 个</span></div><div><strong>${successful}</strong><span>条已返回译文</span></div><div><strong>${flagged}</strong><span>条规则疑点</span></div><div><strong>${failures}</strong><span>条未返回译文</span></div>${cancelled ? `<div><strong>${cancelled}</strong><span>条已取消</span></div>` : ''}</div>
<p class="caution">自动规则只提供核对线索；未触发规则不代表语义正确。请求失败与取消单独记录。金额成本未核实，不以零成本表示。</p>
<details class="filters-disclosure" id="filter-disclosure"><summary>筛选结果 · 服务、领域、关键词</summary><form id="filters" class="filter-grid" aria-label="筛选评测结果" tabindex="-1"><label for="provider">服务<select id="provider"><option value="">全部服务</option>${options(runs.map(run => run.providerId))}</select></label><label for="configuration">配置<select id="configuration"><option value="">全部配置</option>${options(runs.map(run => run.configurationId))}</select></label><label for="domain">领域<select id="domain"><option value="">全部领域</option>${options(report.corpus.samples.map(sample => sample.domain), domainNames)}</select></label><label for="status">结果状态<select id="status"><option value="attention">疑点与待审</option><option value="all">全部结果</option><option value="flagged">自动规则疑点</option><option value="pending">待人工核对</option><option value="failure">未返回译文</option><option value="cancelled">已取消</option><option value="clear">已审阅且无规则疑点</option></select></label><label class="search" for="search">搜索样本、原文或译文（/ 聚焦）<input id="search" type="search" placeholder="例如：否定、25 ms、样本编号" autocomplete="off"></label><div class="reset-wrap"><button type="button" data-reset>清除筛选，显示全部</button></div></form></details>
<p class="status-message" id="action-status" role="status" aria-live="polite"></p>
<section id="results" aria-labelledby="results-title"><div class="results-heading"><h2 id="results-title">样本与核对线索</h2><span class="hint" id="result-count" role="status" aria-live="polite">${runs.length} 条结果</span></div><div id="empty-state" class="empty" hidden><strong>没有匹配的结果</strong><p>可调整服务、领域或关键词，也可查看全部执行记录。</p><button type="button" data-reset>显示全部结果</button></div>${sorted.map(({run, index}) => renderRun(run, samples.get(run.sampleId), index)).join('')}</section>
<details class="comparison"><summary>服务与配置对照 · ${summarize(runs, report.plan).length} 组</summary><p class="hint">疑点与中位耗时只统计返回译文的记录，未进行语义排名。计划表示样本×重复次数；已记录包含恢复后的多次尝试。已执行不含冷却暂缓，已发请求按含 HTTP 的逻辑尝试计数，HTTP 重试另计。旧报告没有计划时显示未知，不用这些计数推算语义准确率。</p><div class="table-wrap" role="region" aria-label="服务与配置对照表，可横向滚动" tabindex="0"><table><thead><tr><th scope="col">服务 / 配置</th><th scope="col">计划 / 已记录</th><th scope="col">已执行 / 已发请求</th><th scope="col">返回译文</th><th scope="col">规则疑点</th><th scope="col">失败 / 暂缓 / 取消</th><th scope="col">中位耗时</th><th scope="col">HTTP 请求</th><th scope="col">输入字符</th><th scope="col">请求 / 响应字节</th></tr></thead><tbody>${renderComparison(runs, report.plan)}</tbody></table></div><p class="hint">金额成本：未知（未核实 USD 计费）；请求数与输入字符是可审计的用量记录。</p>${runs.some(run => run.cost?.httpRequests === 0 && run.cost?.inputCharacters > 0) ? '<p class="hint">历史记录中零 HTTP 尝试的输入字符在此按 0 展示；原始记录与导出 JSON 保留旧数值。</p>' : ''}</details>
<details class="provenance"><summary>复现信息与语料来源</summary><p>报告 ${escapeHtml(report.id)} · ${escapeHtml(report.createdAt)}</p><p>语料 ${escapeHtml(report.corpus.id)} · SHA-256 ${escapeHtml(report.corpus.sha256)}</p><pre>${escapeHtml(readable(report.environment))}</pre>${report.audit ? `<p>审计订正：原始记录已保留，以下仅订正与传输证据矛盾的失败分类。</p><pre>${escapeHtml(readable(report.audit))}</pre>` : ''}${report.providerDeferrals && Object.keys(report.providerDeferrals).length ? `<p>服务暂缓记录（请求未执行，不能作为质量结论）</p><pre>${escapeHtml(readable(report.providerDeferrals))}</pre>` : ''}${report.comparison ? `<pre>${escapeHtml(readable(report.comparison))}</pre>` : ''}</details>
<noscript><p>脚本未启用，已展示全部结果。筛选、复制和下载审阅表需要启用 JavaScript。</p></noscript>
</main><script id="report-data" type="application/json">${jsonForScript(normalized)}</script><script id="review-template" type="application/json">${jsonForScript(createReviewTemplate(normalized))}</script><script>(${installReportInteractions.toString()})();</script></body></html>`;
}
