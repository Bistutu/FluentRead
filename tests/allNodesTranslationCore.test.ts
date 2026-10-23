import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
    collectLiveTranslationTextSlots,
    createDeclarativeAdapter,
    extractTranslationText,
    extractTranslationTextFromNodes,
    getCurrentTranslationCore,
    setCurrentTranslationAdapters,
    resolveTranslationCandidateAtPoint,
    getTranslationCandidateKey,
} from '@/src/core/translation/public';
import {createTranslationCore} from './helpers/translationCore';
import {defaultTranslationAdapters} from '@/src/core/translation/registry';
import {isTranslationCandidateCurrent} from '@/src/features/full-page-translation/content/translationStability';
import type {TranslationCandidate, TranslationScope} from '@/src/core/translation/public';

function page(html: string, url = 'https://example.test/application') {
    const {document} = parseHTML(`<html><head></head><body>${html}</body></html>`);
    return {
        document,
        core: (scope: TranslationScope = 'all') => createTranslationCore({scope, url: new URL(url)}),
    };
}

function source(candidate: TranslationCandidate): string {
    return candidate.nodes
        ? extractTranslationTextFromNodes(candidate.nodes)
        : extractTranslationText(candidate.element);
}

afterEach(() => {
    setCurrentTranslationAdapters(defaultTranslationAdapters);
    vi.unstubAllGlobals();
});

describe('explicit all-nodes translation scope', () => {
    it('Epoch 导航与页脚链接进入全部节点范围，并保持整段正文及内联链接为一个候选', () => {
        const {document, core} = page(`
            <header><nav><a id="research" href="/research"><span>Research</span></a><a id="data" href="/data">Data</a></nav></header>
            <main><article><h1 id="title">AI <em>data centers</em></h1>
                <p id="prose">Explore <a id="inline-link" href="/reports">our reports</a> and <strong>read the methodology</strong>.</p>
            </article></main>
            <footer><a id="about" href="/about">About us</a><a id="contact" href="/contact">Contact</a></footer>
        `, 'https://epoch.ai/data/ai-data-centers');
        const content = core('content').discover(document);
        const all = core().discover(document);

        expect(content.map((candidate) => candidate.element.id)).toEqual(['title', 'prose']);
        expect(content.every((candidate) => candidate.scope === undefined)).toBe(true);
        expect(all.map((candidate) => [candidate.element.id, candidate.kind])).toEqual([
            ['research', 'control'], ['data', 'control'], ['title', 'content'],
            ['prose', 'content'], ['about', 'control'], ['contact', 'control'],
        ]);
        expect(all.every((candidate) => candidate.scope === 'all')).toBe(true);
        expect(core().resolve(document.querySelector('#inline-link'))?.element.id).toBe('prose');
        expect(core().resolve(document.querySelector('#research span'))?.element.id).toBe('research');
    });

    it('n8n 类节点编辑器覆盖独立标签、节点按钮和菜单，保留宿主与 Text 对象身份', () => {
        const {document, core} = page(`
            <div role="application"><div class="vue-flow__node"><span id="trigger">When chat message received</span>
                <span id="model">OpenAI Chat Model</span><button id="execute"><span>Execute workflow</span></button>
            </div></div>
            <div role="menu"><div role="menuitem" id="rename"><span>Rename</span></div>
                <div role="menuitemcheckbox" id="pin">Pin node</div><div role="menuitemradio" id="mode">Run once</div></div>
        `);
        const trigger = document.querySelector('#trigger') as HTMLElement;
        const text = trigger.firstChild as Text;
        const click = vi.fn();
        trigger.addEventListener('click', click);
        const candidates = core().discover(document);

        expect(candidates.map((candidate) => [candidate.element.id, candidate.kind])).toEqual([
            ['trigger', 'control'], ['model', 'control'], ['execute', 'control'],
            ['rename', 'control'], ['pin', 'control'], ['mode', 'control'],
        ]);
        const slots = collectLiveTranslationTextSlots(trigger);
        expect(slots.map((slot) => slot.node)).toEqual([text]);
        slots[0]!.node.nodeValue = '收到聊天消息时';
        expect(document.querySelector('#trigger')).toBe(trigger);
        expect(trigger.firstChild).toBe(text);
        trigger.dispatchEvent(new document.defaultView!.Event('click'));
        expect(click).toHaveBeenCalledOnce();
        slots[0]!.node.nodeValue = slots[0]!.source;
        expect(trigger.textContent).toBe('When chat message received');
    });

    it('树形与标签页保留控件边界，并在动态 portal 增删后重新发现可见文字', () => {
        const {document, core} = page(`
            <aside><div role="tree"><div role="treeitem" id="folder">Project files</div></div></aside>
            <div role="tablist"><div role="tab" id="overview"><span>Overview</span></div><a role="tab" id="settings">Settings</a></div>
            <div role="tabpanel"><p id="description">Select a file to inspect its contents.</p></div>
        `);
        const all = core();
        expect(all.discover(document).map((candidate) => candidate.element.id)).toEqual([
            'folder', 'overview', 'settings', 'description',
        ]);
        const portal = document.createElement('div');
        portal.setAttribute('role', 'menu');
        portal.innerHTML = '<button id="duplicate">Duplicate node</button><div role="menuitem" id="delete">Delete node</div>';
        document.body.append(portal);
        expect(all.discover(portal).map(source)).toEqual(['Duplicate node', 'Delete node']);
        portal.querySelector('#duplicate')!.textContent = 'Duplicate workflow';
        expect(all.discover(portal).map(source)).toEqual(['Duplicate workflow', 'Delete node']);
        portal.setAttribute('hidden', '');
        expect(all.discover(portal)).toEqual([]);
        portal.removeAttribute('hidden');
        expect(all.discover(portal)).toHaveLength(2);
    });

    it('显式 article 中的 div 正文保留整段粒度，同时独立翻译内部工具栏', () => {
        const {document, core} = page(`
            <article><div id="paragraph">Read <a href="/guide">the guide</a> with <em>care</em>.</div>
                <nav><a id="article-tool">Download report</a></nav></article>
            <section role="article"><div id="aria-paragraph"><span>A semantic article remains readable content.</span></div></section>
        `);
        expect(core().discover(document).map((candidate) => [candidate.element.id, candidate.kind])).toEqual([
            ['paragraph', 'content'], ['article-tool', 'control'], ['aria-paragraph', 'content'],
        ]);
        expect(core().resolve(document.querySelector('#paragraph a'))?.element.id).toBe('paragraph');
    });

    it('导航列表与站点页脚文字可翻译，而正文列表保留双语内容粒度', () => {
        const {document, core} = page(`
            <nav><ul><li id="nav-item">Research tools</li></ul></nav>
            <div role="menu"><ul><li id="menu-item">Import workflow</li></ul></div>
            <main><ul><li id="content-item">A complete explanation with <em>useful emphasis</em>.</li></ul></main>
            <footer id="footer">All rights reserved.</footer>
        `);
        expect(core().discover(document).map((candidate) => [candidate.element.id, candidate.kind])).toEqual([
            ['nav-item', 'control'], ['menu-item', 'control'], ['content-item', 'content'], ['footer', 'control'],
        ]);
    });

    it('绕过阅读白名单、控件剪枝和动态 UI 排除，但硬保护仍先于适配器', () => {
        const {document} = page(`
            <nav><button id="tool">Search projects</button></nav>
            <p id="prose">Readable project description.</p>
            <div class="metadata" id="status">Queued for processing</div>
            <div translate="no"><button id="protected">Never translate this</button></div>
        `);
        const adapter = createDeclarativeAdapter({
            id: 'content-only-fixture', hosts: ['example.test'], genericCandidatePolicy: 'targets-only',
            targets: [{selector: '#prose', reason: 'prose'}],
            prune: [{selector: 'nav', reason: 'navigation'}],
            keepOriginal: [{selector: '.metadata', reason: 'controlled-metadata'}],
            mutationExclude: [{selector: 'nav, .metadata', reason: 'controlled-ui'}],
        });
        const content = createTranslationCore({url: new URL('https://example.test/'), adapters: [adapter]});
        const all = createTranslationCore({url: new URL('https://example.test/'), adapters: [adapter], scope: 'all'});

        expect(content.discover(document).map((candidate) => candidate.element.id)).toEqual(['prose']);
        expect(all.discover(document).map((candidate) => candidate.element.id)).toEqual(['tool', 'prose', 'status']);
        expect(content.shouldStayOriginal(document.querySelector('#status')!)).toBe(true);
        expect(all.shouldStayOriginal(document.querySelector('#status')!)).toBe(false);
        expect(content.shouldIgnoreMutation(document.querySelector('#tool')!)).toBe(true);
        expect(all.shouldIgnoreMutation(document.querySelector('#tool')!)).toBe(false);
        expect(all.inspect(document.querySelector('#protected')!).candidate).toBeNull();
        expect(all.resolve(document.querySelector('#protected'))).toBeNull();
    });

    it('GitHub 与 Reddit 默认策略保持不变，全部节点显式加入搜索和操作文字', () => {
        for (const url of ['https://github.com/org/repo', 'https://www.reddit.com/r/example/comments/example']) {
            const {document, core} = page(`
                <nav><a id="home">Home</a><button id="search">Search</button></nav>
                <main><button id="reply">Reply</button><div role="menuitem" id="share">Share</div></main>
            `, url);
            expect(core('content').discover(document).map((candidate) => candidate.element.id))
                .toEqual(url.includes('reddit.com') ? [] : ['reply', 'share']);
            expect(core().discover(document).map((candidate) => candidate.element.id)).toEqual(['home', 'search', 'reply', 'share']);
        }
    });

    it('代码、输入框、编辑区、隐藏文字、公式、显式不翻译和扩展 UI 都不进入请求', () => {
        const {document, core} = page(`
            <p id="prose">Read the guide <code>doNotTranslate()</code> <kbd>Control</kbd>
                <span translate="no">Protected brand</span><span aria-hidden="true">Hidden copy</span>.</p>
            <pre><span>source code block</span></pre><input value="Private entry"><textarea>Secret message</textarea>
            <select><option>Choose private item</option></select><div contenteditable="true">Draft message</div>
            <div hidden>Hidden panel</div><div inert>Inactive menu</div><div class="sr-only">Screen reader label</div>
            <div class="notranslate"><p>No translation requested</p></div><div data-notranslate="true">Keep this original</div>
            <script>executePrivateCode()</script><style>privateStyleRule</style><svg><text>Vector title</text></svg>
            <div class="katex"><span>Mathematical formula</span></div>
            <div data-fluent-read-ui><button>Extension settings</button></div>
        `);
        const candidates = core().discover(document);
        expect(candidates.map((candidate) => candidate.element.id)).toEqual(['prose']);
        expect(candidates.map(source)).toEqual(['Read the guide .']);
        expect(collectLiveTranslationTextSlots(document.querySelector('#prose') as HTMLElement).map((slot) => slot.source))
            .toEqual(['Read the guide', '.']);
    });

    it('CSS 隐藏父级和 Shadow DOM 外层保护继续约束全部节点发现', () => {
        const {document, core} = page(`
            <div class="closed"><button>Hidden dialog action</button></div>
            <div class="invisible"><span>Hidden app label</span></div>
            <custom-editor translate="no" id="protected-host"></custom-editor>
            <button id="disabled" disabled>Disabled action label</button>
        `);
        Object.defineProperty(document.defaultView, 'getComputedStyle', {
            configurable: true,
            value: (element: Element) => ({
                display: element.classList.contains('closed') ? 'none' : '',
                visibility: element.classList.contains('invisible') ? 'hidden' : 'visible',
            }),
        });
        const shadow = document.querySelector('#protected-host')!.attachShadow({mode: 'open'});
        shadow.innerHTML = '<button id="shadow-button">Protected editor action</button>';
        const all = core();
        expect(all.discover(document).map((candidate) => candidate.element.id)).toEqual(['disabled']);
        expect(all.discover(shadow)).toEqual([]);
        expect(all.resolve(shadow.querySelector('#shadow-button'))).toBeNull();
    });

    it('直接正文、内联混合标签和开放 Shadow DOM 可发现，保护节点不被并入合成 run', () => {
        const {document, core} = page(`Loose readable text
            <span id="mixed">Before label <strong id="inner">Inner label</strong> after label <code id="code">doNotMove()</code></span>
            <custom-panel id="host"></custom-panel>
        `);
        const host = document.querySelector('#host')!;
        const shadow = host.attachShadow({mode: 'open'});
        shadow.innerHTML = '<span id="shadow-label">Shadow settings</span><button id="shadow-action">Save changes</button>';
        const all = core();
        const candidates = all.discover(document);
        const sources = candidates.map(source);
        expect(sources).toEqual(expect.arrayContaining([
            'Loose readable text', 'Before label', 'Inner label', 'after label', 'Shadow settings', 'Save changes',
        ]));
        expect(sources).toHaveLength(6);
        expect(candidates.flatMap((candidate) => candidate.nodes ?? [])).not.toContain(document.querySelector('#code'));
        for (const candidate of candidates) {
            const resolved = all.resolve(getTranslationCandidateKey(candidate));
            expect(resolved?.element).toBe(candidate.element);
            expect(resolved?.kind).toBe(candidate.kind);
            expect(resolved?.scope).toBe('all');
            expect(getTranslationCandidateKey(resolved!)).toBe(getTranslationCandidateKey(candidate));
        }
    });

    it('嵌套导航中的标题仍是正文，新增范围只补充其旁边的菜单文字', () => {
        const {document, core} = page(`
            <header><nav><h2 id="heading">Research collections</h2><a id="browse">Browse all</a></nav></header>
        `);
        expect(core('content').discover(document).map((candidate) => candidate.element.id)).toEqual(['heading']);
        expect(core().discover(document).map((candidate) => [candidate.element.id, candidate.kind])).toEqual([
            ['heading', 'content'], ['browse', 'control'],
        ]);
    });

    it('已物化的全部节点 run 重试保留范围和正文或控件类型', () => {
        const {document, core} = page(`
            <div><span id="control" data-fr-translation-segment="true">Menu label</span></div>
            <p><span id="content" data-fr-translation-segment="true">Paragraph fragment</span></p>
        `);
        const all = core();
        expect(all.resolve(document.querySelector('#control'))).toMatchObject({
            kind: 'control', scope: 'all', reason: 'owned-inline-run',
        });
        expect(all.resolve(document.querySelector('#content'))).toMatchObject({
            kind: 'content', scope: 'all', reason: 'owned-inline-run',
        });
        const detached = document.createElement('span');
        detached.setAttribute('data-fr-translation-segment', 'true');
        expect(all.resolve(detached)).toMatchObject({kind: 'control', scope: 'all'});
    });

    it('真实复合树节点标签和关联输入框的 label 都拥有可重校验候选', () => {
        const {document} = parseHTML(readFileSync(new URL('./fixtures/all-nodes-translation-fixture.html', import.meta.url), 'utf8'));
        const all = createTranslationCore({scope: 'all', url: new URL('https://example.test/application')});
        const candidates = all.discover(document);
        for (const id of ['tree-label', 'input-label']) {
            const element = document.querySelector(`#${id}`)!;
            const candidate = candidates.find((item) => item.element === element || item.nodes?.includes(element));
            expect(candidate, id).toBeDefined();
            const resolved = all.resolve(getTranslationCandidateKey(candidate!));
            expect(resolved?.element, `${id} owner`).toBe(candidate!.element);
            expect(resolved?.kind, `${id} kind`).toBe(candidate!.kind);
            expect(getTranslationCandidateKey(resolved!), `${id} key`).toBe(getTranslationCandidateKey(candidate!));
        }
    });

    it('按坐标悬浮入口只在显式全部节点范围识别菜单，并继续保护输入内容', () => {
        const {document} = page('<nav><button id="menu">Execute workflow</button></nav><textarea>Private draft</textarea>');
        vi.stubGlobal('document', document);
        vi.stubGlobal('location', {href: 'https://example.test/application'});
        const button = document.querySelector<HTMLElement>('button')!;
        const textarea = document.querySelector('textarea')!;
        Object.defineProperty(document, 'elementsFromPoint', {configurable: true, value: () => [button]});
        expect(resolveTranslationCandidateAtPoint(20, 20)).toBeNull();
        expect(resolveTranslationCandidateAtPoint(20, 20, 'all')).toMatchObject({element: button, kind: 'control', scope: 'all'});
        Object.defineProperty(document, 'elementsFromPoint', {configurable: true, value: () => [textarea]});
        expect(resolveTranslationCandidateAtPoint(20, 20, 'all')).toBeNull();
    });

    it('站点适配器更新同时清空两个范围，已有全部节点候选按自身范围复验', () => {
        const {document} = page('<nav><a id="menu" href="/projects">Project navigation</a></nav>');
        vi.stubGlobal('location', {href: 'https://example.test/application'});
        const content = getCurrentTranslationCore();
        const all = getCurrentTranslationCore('all');
        const link = document.querySelector<HTMLElement>('a')!;
        const candidate = all.resolve(link)!;
        expect(isTranslationCandidateCurrent(candidate)).toBe(true);
        expect(isTranslationCandidateCurrent({...candidate, scope: 'content'})).toBe(false);
        const adapters = [...defaultTranslationAdapters];
        setCurrentTranslationAdapters(adapters);
        expect(getCurrentTranslationCore()).not.toBe(content);
        expect(getCurrentTranslationCore('all')).not.toBe(all);
        expect(isTranslationCandidateCurrent(candidate)).toBe(true);
        const rebuilt = getCurrentTranslationCore('all');
        setCurrentTranslationAdapters(adapters);
        expect(getCurrentTranslationCore('all')).toBe(rebuilt);
    });

    it('URL 与范围分别隔离共享核心，并在导航后同时重新创建', () => {
        vi.stubGlobal('location', {href: 'https://example.test/first'});
        const content = getCurrentTranslationCore();
        const all = getCurrentTranslationCore('all');
        expect(getCurrentTranslationCore('content')).toBe(content);
        expect(getCurrentTranslationCore('all')).toBe(all);
        expect(content).not.toBe(all);
        expect(content.scope).toBe('content');
        expect(all.scope).toBe('all');
        vi.stubGlobal('location', {href: 'https://example.test/second'});
        expect(getCurrentTranslationCore()).not.toBe(content);
        expect(getCurrentTranslationCore('all')).not.toBe(all);
        expect(getCurrentTranslationCore('all').url.pathname).toBe('/second');
    });
});
