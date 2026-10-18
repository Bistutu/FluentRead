import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/src/services/config/store', () => ({
    config: {style: 1, to: 'zh-Hans'},
}));
vi.mock('@/src/core/config/catalog', () => ({
    options: {styles: []},
}));

import {
    applyTranslationsToSnapshot,
    collectLiveTranslationTextSlots,
    createTranslationSourceSnapshot,
    getCurrentTranslationCore,
} from '@/src/core/translation/public';
import {config as liveConfig} from '@/src/services/config/store';
import {refreshBilingualTranslationSkeleton} from
    '@/src/features/full-page-translation/content/bilingualReplay';
import {stabilizeBilingualArtifact, createBilingualRemountCapitulationRegistry} from
    '@/src/features/full-page-translation/content/bilingualRemount';
import {appendBilingualTranslation} from
    '@/src/features/full-page-translation/content/renderer';
import {
    beginBilingualArtifactHostWriteGesture,
    beginTranslation,
    ensureTranslationTruncationLayout,
    hasBilingualArtifactHostWriteBudget,
    getTranslationState,
    isBilingualArtifactDriftOnly,
    isBilingualArtifactHostWriteBudgetCapitulated,
    markTranslationComplete,
    restoreAllTranslations,
    setBilingualContent,
    setBilingualSkeletonRefreshHandler,
    setRenderedStyleAttribute,
    tryRepairBilingualTranslationArtifact,
    type TranslationState,
} from '@/src/features/full-page-translation/content/state';
import {isTranslationArtifactCurrent} from
    '@/src/features/full-page-translation/content/translationStability';

async function withDocumentRealm<T>(
    document: Document,
    callback: () => T | Promise<T>,
    readInlineStyles = false,
    computedColor?: (element: HTMLElement) => string,
): Promise<T> {
    const realm = document.defaultView as unknown as Record<string, unknown>;
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const realmBindings: Record<string, unknown> = {
        document,
        window: document.defaultView,
        DOMParser: class FixtureDOMParser {
            parseFromString(source: string): Document {
                return parseHTML(`<html><head></head><body>${source}</body></html>`).document;
            }
        },
        Element: realm.Element,
        HTMLElement: realm.HTMLElement,
        MutationObserver: realm.MutationObserver,
        Node: realm.Node,
        ShadowRoot: realm.ShadowRoot,
        // linkedom 不计算 CSS；新保护用例依据真实 inline style 提供所需读数。
        ...(readInlineStyles ? {getComputedStyle: (element: HTMLElement) => ({
            display: element.style.display || 'block', visibility: element.style.visibility || 'visible',
            color: computedColor?.(element) ?? element.style.color ?? '',
            position: 'static', overflow: 'visible', overflowY: 'visible', height: 'auto',
            maxHeight: 'none', webkitLineClamp: 'none',
            getPropertyValue: (name: string) => element.style.getPropertyValue(name) || '',
        })} : {}),
    };
    const previousDescriptors = new Map<string, PropertyDescriptor | undefined>();

    Object.entries(realmBindings).forEach(([name, value]) => {
        previousDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        if (value !== undefined) {
            Object.defineProperty(globalRecord, name, {
                configurable: true,
                writable: true,
                value,
            });
        }
    });

    try {
        return await callback();
    } finally {
        restoreAllTranslations();
        Object.keys(realmBindings).forEach((name) => {
            const descriptor = previousDescriptors.get(name);
            if (descriptor) Object.defineProperty(globalRecord, name, descriptor);
            else delete globalRecord[name];
        });
    }
}

interface CommittedReplayFixture {
    owner: HTMLElement;
    state: TranslationState;
    wrapper: HTMLElement;
    sources: readonly string[];
    translations: readonly string[];
}

function createCommittedReplayFixture(
    document: Document,
    includeReplay = true,
    allowTopLevelApplicationShell = false,
): CommittedReplayFixture {
    const base = document.createElement('base');
    base.setAttribute('href', 'https://example.com/');
    document.head.appendChild(base);
    document.body.innerHTML = `
        <p id="owner">
            <span id="plain-source">Translate this sentence.</span>
            <a id="source-link" href="https://example.com/before" title="Before">Read the details.</a>
            <code id="source-code">const version = 'before';</code>
            <mark id="source-no-translate" translate="no">Protected copy before.</mark>
            <ruby id="source-math" class="MathJax"><strong>formula before</strong></ruby>
        </p>
    `;
    const owner = document.querySelector<HTMLElement>('#owner')!;
    const core = getCurrentTranslationCore();
    const options = allowTopLevelApplicationShell
        ? {allowTopLevelApplicationShell: true, protectedElement: owner}
        : {protectedElement: owner};
    const snapshot = createTranslationSourceSnapshot(
        owner,
        core.shouldStayOriginal,
        undefined,
        options,
    );
    const liveSlots = collectLiveTranslationTextSlots(
        owner,
        core.shouldStayOriginal,
        undefined,
        options,
    );
    const sources = snapshot.slots.map((slot) => slot.source);
    const translations = Object.freeze(['这句话已翻译。', '阅读最新详情。']);
    expect(sources).toEqual(['Translate this sentence.', 'Read the details.']);

    const attempt = beginTranslation(
        owner,
        'bilingual',
        'content',
        false,
        sources.join(' '),
        liveSlots.map((slot) => slot.node),
        allowTopLevelApplicationShell,
    )!;
    expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
    const translatedHTML = applyTranslationsToSnapshot(snapshot, translations);
    const wrapper = appendBilingualTranslation(owner, translatedHTML, {
        targetLanguage: 'zh-Hans',
        style: 1,
    });
    setBilingualContent(owner, wrapper, includeReplay ? {
        sources,
        translations,
        targetLanguage: 'zh-Hans',
        style: 1,
    } : undefined);
    setRenderedStyleAttribute(owner);

    return {owner, state: attempt.state, wrapper, sources, translations};
}

it('个人来源标记随扩展骨架重放保留，油猴重放与直接渲染都不携带扩展校订标记', async () => {
    const {document} = parseHTML('<html><head></head><body></body></html>');
    try {
        await withDocumentRealm(document, () => {
            const fixture = createCommittedReplayFixture(document);
            fixture.state.bilingualReplay!.personalCorrectionId = 'confirmed-record';
            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(true);
            expect(fixture.state.bilingualContent!.getAttribute('data-fr-personal-correction')).toBe('true');
            vi.stubEnv('BROWSER', 'userscript');
            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(true);
            expect(fixture.state.bilingualContent!.hasAttribute('data-fr-personal-correction')).toBe(false);
            const direct = document.createElement('p'); direct.textContent = 'Source';
            expect(appendBilingualTranslation(direct, '译文', {personalCorrectionId: 'confirmed-record'}).hasAttribute('data-fr-personal-correction')).toBe(false);
        });
    } finally {vi.unstubAllEnvs();}
});

/**
 * 单槽候选：整段可见文本就是一个链接。多槽候选会把整段译文降级成纯文本，
 * 这里的骨架仍然携带复制来的内联节点，用于验证宿主改写这些节点属性时的行为。
 */
function createCommittedSingleSlotFixture(
    document: Document, translation = '阅读最新详情。', longParagraphLineBreak = false,
): CommittedReplayFixture {
    const base = document.createElement('base');
    base.setAttribute('href', 'https://example.com/');
    document.head.appendChild(base);
    document.body.innerHTML =
        '<p id="owner"><a id="source-link" href="https://example.com/before" ' +
        'title="Before">Read the details.</a></p>';
    const owner = document.querySelector<HTMLElement>('#owner')!;
    const core = getCurrentTranslationCore();
    const options = {protectedElement: owner};
    const snapshot = createTranslationSourceSnapshot(
        owner, core.shouldStayOriginal, undefined, options);
    const liveSlots = collectLiveTranslationTextSlots(owner, core.shouldStayOriginal, undefined, options);
    const sources = snapshot.slots.map((slot) => slot.source);
    const translations = Object.freeze([translation]);
    expect(sources).toEqual(['Read the details.']);
    const attempt = beginTranslation(
        owner, 'bilingual', 'content', false, sources.join(' '),
        liveSlots.map((slot) => slot.node), false,
    )!;
    expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
    const wrapper = appendBilingualTranslation(
        owner, applyTranslationsToSnapshot(snapshot, translations), {targetLanguage: 'zh-Hans', style: 1, longParagraphLineBreak});
    setBilingualContent(owner, wrapper, {sources, translations, targetLanguage: 'zh-Hans', style: 1, longParagraphLineBreak});
    setRenderedStyleAttribute(owner);

    return {owner, state: attempt.state, wrapper, sources, translations};
}

function createCommittedMixedSourceFixture(
    document: Document, markup: string, tag: 'h3' | 'p' = 'h3',
): CommittedReplayFixture {
    document.body.innerHTML = `<section class="markdown-body"><${tag} id="owner">${markup}</${tag}></section>`;
    const owner = document.querySelector<HTMLElement>('#owner')!;
    const core = getCurrentTranslationCore();
    const options = {protectedElement: owner};
    const snapshot = createTranslationSourceSnapshot(owner, core.shouldStayOriginal, undefined, options);
    const liveSlots = collectLiveTranslationTextSlots(owner, core.shouldStayOriginal, undefined, options);
    const sources = snapshot.slots.map(slot => slot.source);
    const translations = sources.map((_, index) => `译文${index + 1}`);
    const attempt = beginTranslation(owner, 'bilingual', 'content', false, sources.join(' '),
        liveSlots.map(slot => slot.node))!;
    expect(markTranslationComplete(owner, attempt.state, attempt.generation, false)).toBe(true);
    const html = applyTranslationsToSnapshot(snapshot, translations);
    const wrapper = appendBilingualTranslation(owner, html, {
        sourceSkeleton: snapshot.clone, targetLanguage: 'zh-Hans', style: 1, longParagraphLineBreak: false,
    });
    setBilingualContent(owner, wrapper, {sources, translations, targetLanguage: 'zh-Hans', style: 1, longParagraphLineBreak: false});
    setRenderedStyleAttribute(owner);
    return {owner, state: attempt.state, wrapper, sources, translations};
}

/** 回归失败时最多重放四次，然后沿生产恢复路径退出；真实 MO 不会拖死测试进程。 */
function boundedReplayHook() {
    let calls = 0;
    const hook = vi.fn((owner: HTMLElement, state: TranslationState) =>
        ++calls <= 4 && refreshBilingualTranslationSkeleton(owner, state));
    setBilingualSkeletonRefreshHandler(hook);
    return hook;
}

/**
 * 布局观察器使用 realm 自身的 MutationObserver，linkedom 会异步投递记录，
 * 因此宿主 mutation 之后需要让出几个宏任务，等观察器与状态机的微任务都执行完。
 */
async function flushLayoutRefresh(): Promise<void> {
    for (let turn = 0; turn < 4; turn += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

/**
 * Issue #969 screenshot paragraph, from
 * https://github.com/nicobailon/pi-subagents/blob/main/docs/models.md
 * License: https://github.com/nicobailon/pi-subagents/blob/main/LICENSE
 *
 * MIT License
 * Copyright (c) 2026 Nico Bailon
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const githubModelsParagraph =
    '<code>subagents.defaultModel</code> and <code>subagents.defaultProvider</code> apply to builtin, package, user, project, and runtime-registered agents. ' +
    '<code>defaultModel</code> fills only agents that do not set <code>model</code> in frontmatter or in their runtime definition. ' +
    '<code>defaultProvider</code> is also applied to frontmatter and override models so bare ids resolve against the intended provider. ' +
    'Per-run model overrides and <code>agentOverrides.&lt;name&gt;.model</code> win over frontmatter and the global default. ' +
    'The same <code>agentOverrides</code> block can change <code>tools</code>, <code>skills</code>, inherited context, prompt text, or disable an agent ' +
    '(see <a href="https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md">agents.md</a>); matching custom-agent frontmatter is replaced for any field set by the override. ' +
    'Runtime-registered agents take only <code>model</code>, <code>defaultProvider</code>, <code>fast</code>, and <code>thinking</code> ' +
    'from <code>agentOverrides.&lt;name&gt;</code>; their other definition fields stay owned by the registering extension.';

describe('双语译文骨架重放', () => {
    it('首次翻译与骨架重放均读取当前链接颜色，保留译文及宿主链接节点', async () => {
        const {document} = parseHTML('<html><head></head><body></body></html>');
        let color = 'rgb(220, 38, 38)';
        await withDocumentRealm(document, () => {
            const fixture = createCommittedMixedSourceFixture(document,
                'Read <a id="source-link" href="https://example.com/guide" class="host-accent"><span>@steipete</span></a> <code>npm install</code>', 'p');
            const link = fixture.owner.querySelector<HTMLAnchorElement>('#source-link')!;
            const sourceText = link.firstChild;
            const translations = [...fixture.state.bilingualReplay!.translations];
            const translatedText = fixture.wrapper.textContent;
            expect(fixture.wrapper.querySelector<HTMLAnchorElement>('a')?.style.color).toBe('rgb(220, 38, 38)');

            link.className = 'host-accent-updated';
            color = 'rgb(31, 111, 235)';
            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(true);
            expect(fixture.state.bilingualContent).toBe(fixture.wrapper);
            expect(fixture.wrapper.querySelector<HTMLAnchorElement>('a')?.style.color).toBe('rgb(31, 111, 235)');
            expect(fixture.wrapper.textContent).toBe(translatedText);
            expect(fixture.state.bilingualReplay!.translations).toEqual(translations);
            expect(fixture.owner.querySelector('#source-link')).toBe(link);
            expect(link.firstChild).toBe(sourceText);
            expect(link.className).toBe('host-accent-updated');
            expect(link.hasAttribute('style')).toBe(false);
            expect(fixture.wrapper.querySelector('a')?.hasAttribute('class')).toBe(false);
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
        }, true, element => element.localName === 'a' ? color : '');
    });

    it('issue #969 的 GitHub 混合行内代码段落在真实 MO 中保留译文并有界复验', async () => {
        const {document} = parseHTML('<html><head></head><body></body></html>');
        await withDocumentRealm(document, async () => {
            vi.stubGlobal('location', {href: 'https://github.com/nicobailon/pi-subagents/blob/main/docs/models.md'});
            const hook = boundedReplayHook();
            const mutations: MutationRecord[] = [];
            const artifactObserver = new MutationObserver(records => mutations.push(...records));
            artifactObserver.observe(document.body, {childList: true, subtree: true});
            try {
                const fixture = createCommittedMixedSourceFixture(document, githubModelsParagraph, 'p');
                const {owner, state, wrapper} = fixture;
                const generation = state.generation;
                const sourceNodes = [...state.sourceTextNodes!];
                const codes = Array.from(owner.children).filter(child => child.localName === 'code');
                const codeHTML = codes.map(code => code.outerHTML);
                const sourceLink = Array.from(owner.children).find(child => child.localName === 'a')!;
                const sourceLinkHref = sourceLink.getAttribute('href');
                expect(codes).toHaveLength(14);
                expect(fixture.sources).not.toContain('agents.md');
                expect(sourceNodes.every(node => node.parentElement?.localName !== 'code')).toBe(true);
                expect(getCurrentTranslationCore().inspect(owner).candidate?.element).toBe(owner);

                const expectCurrent = () => {
                    expect(getTranslationState(owner)).toBe(state);
                    expect(state.generation).toBe(generation);
                    expect(state.controller.signal.aborted).toBe(false);
                    expect(state.bilingualContent).toBe(wrapper);
                    expect(wrapper.parentNode).toBe(owner);
                    expect(owner.querySelectorAll(':scope > .fluent-read-bilingual-content')).toHaveLength(1);
                    expect(state.bilingualReplay?.sources).toEqual(fixture.sources);
                    expect(state.bilingualReplay?.translations).toEqual(fixture.translations);
                    expect(codes.map(code => code.outerHTML)).toEqual(codeHTML);
                    expect(codes.every(code => code.parentNode === owner)).toBe(true);
                    expect(sourceLink.parentNode).toBe(owner);
                    expect(sourceLink.getAttribute('href')).toBe(sourceLinkHref);
                    expect(isTranslationArtifactCurrent(owner, state) ||
                        isBilingualArtifactDriftOnly(owner, state)).toBe(true);
                };

                await flushLayoutRefresh();
                expect(hook).not.toHaveBeenCalled();
                expect(state.sourceTextNodes).toEqual(sourceNodes);
                expectCurrent();

                // 旧版在 resize 后用另一套 Text 保护规则复验，静置正常也会进入自重放循环。
                const RealmEvent = (document.defaultView as unknown as {Event: typeof Event}).Event;
                for (let round = 0; round < 3; round += 1) {
                    document.defaultView!.dispatchEvent(new RealmEvent('resize'));
                    await flushLayoutRefresh();
                    expect(hook).not.toHaveBeenCalled();
                    expect(state.sourceTextNodes).toEqual(sourceNodes);
                    expectCurrent();
                }

                // 原文链接提示只刷新安全骨架一次；译文副本的装饰不重写、不耗尽修复预算。
                sourceLink.setAttribute('title', 'Agent definitions');
                await flushLayoutRefresh();
                expect(hook).toHaveBeenCalledTimes(1);
                for (let round = 0; round < 3; round += 1) {
                    const copiedLink = wrapper.querySelector('a')!;
                    copiedLink.setAttribute('title', `Preview ${round}`);
                    copiedLink.setAttribute('tabindex', round % 2 ? '-1' : '0');
                    await flushLayoutRefresh();
                    expect(hook).toHaveBeenCalledTimes(1);
                    expect(state.sourceTextNodes).toEqual(sourceNodes);
                    expectCurrent();
                }
                expect(hasBilingualArtifactHostWriteBudget(owner)).toBe(false);

                // 等价 Text 重绘与宿主提示同时提交，重绑实时来源而不替换译文或原文 code/link。
                const previous = sourceNodes[0]!;
                const replacement = document.createTextNode(previous.data);
                previous.parentNode!.replaceChild(replacement, previous);
                owner.setAttribute('title', 'Equivalent host repaint');
                await flushLayoutRefresh();
                expect(hook).toHaveBeenCalledTimes(2);
                expect(state.sourceTextNodes).toEqual([replacement, ...sourceNodes.slice(1)]);
                expectCurrent();
                await flushLayoutRefresh();
                expect(hook).toHaveBeenCalledTimes(2);
                expect(mutations.flatMap(record => Array.from(record.addedNodes))
                    .filter(node => node === wrapper)).toHaveLength(1);
                expect(mutations.flatMap(record => Array.from(record.removedNodes))
                    .filter(node => node === wrapper)).toHaveLength(0);

                const currentSource = owner.cloneNode(true) as HTMLElement;
                currentSource.querySelector('.fluent-read-bilingual-content')!.remove();
                restoreAllTranslations();
                expect(getTranslationState(owner)).toBeUndefined();
                expect(wrapper.parentNode).toBeNull();
                expect(replacement.parentNode).toBe(owner);
                expect(previous.parentNode).toBeNull();
                expect(owner.innerHTML).toBe(currentSource.innerHTML);
            } finally {
                artifactObserver.disconnect();
                setBilingualSkeletonRefreshHandler(undefined);
                vi.unstubAllGlobals();
            }
        });
    });

    it.each([
        ['Brown 数字 H3', '1<tt>&nbsp;</tt><a id="source-meta" name="(part._.Introduction)"></a>Introduction'],
        ['数字 badge', '<span id="source-meta">23</span>Introduction'],
        ['域名链接', 'Read <a id="source-meta" href="https://thenewstack.io/">TheNewStack.io</a>'],
        ['Python 数字脚注', 'Read text<a id="source-meta" href="#note">[<span>2</span>]</a>'],
    ])('%s 在真实 MO 中提交与宿主属性重放均有界收敛', async (_name, markup) => {
        const {document} = parseHTML('<html><head></head><body></body></html>');
        await withDocumentRealm(document, async () => {
            const observe = vi.spyOn(document.defaultView!.MutationObserver.prototype, 'observe');
            const hook = boundedReplayHook();
            try {
                const fixture = createCommittedMixedSourceFixture(document, markup);
                const sourceNodes = [...fixture.state.sourceTextNodes!];
                const sourceClone = fixture.owner.cloneNode(true) as HTMLElement;
                sourceClone.querySelector('[data-fr-translation-owned="true"]')!.remove();
                const sourceHTML = sourceClone.innerHTML;
                await flushLayoutRefresh();
                expect(observe).toHaveBeenCalled();
                expect(hook).not.toHaveBeenCalled();
                expect(getTranslationState(fixture.owner)).toBe(fixture.state);
                expect(tryRepairBilingualTranslationArtifact(fixture.owner, fixture.state)).toBe('repaired');

                fixture.owner.querySelector('#source-meta')!.setAttribute('title', 'Host tooltip');
                await flushLayoutRefresh();
                expect(hook).toHaveBeenCalledTimes(1);
                await flushLayoutRefresh();
                expect(hook).toHaveBeenCalledTimes(1);
                expect(getTranslationState(fixture.owner)).toBe(fixture.state);
                expect(fixture.state.controller.signal.aborted).toBe(false);
                expect(fixture.state.sourceTextNodes).toEqual(sourceNodes);
                expect(fixture.state.bilingualContent).toBe(fixture.wrapper);
                expect(fixture.wrapper.parentNode).toBe(fixture.owner);
                expect(fixture.state.bilingualReplay?.sources).toEqual(fixture.sources);
                expect(fixture.state.bilingualReplay?.translations).toEqual(fixture.translations);
                const meta = fixture.owner.querySelector('#source-meta')!;
                expect(meta.getAttribute('title')).toBe('Host tooltip');
                if (meta.localName === 'a') {
                    expect(fixture.wrapper.querySelector('[title="Host tooltip"]')).not.toBeNull();
                }
                expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);

                restoreAllTranslations();
                expect(getTranslationState(fixture.owner)).toBeUndefined();
                expect(fixture.wrapper.parentNode).toBeNull();
                fixture.owner.querySelector('#source-meta')!.removeAttribute('title');
                expect(fixture.owner.innerHTML).toBe(sourceHTML);
            } finally {setBilingualSkeletonRefreshHandler(undefined); observe.mockRestore();}
        });
    });

    it('受保护数字 badge 更新重放骨架并保留原文，再次观察不重复重放', async () => {
        const {document} = parseHTML('<html><head></head><body></body></html>');
        await withDocumentRealm(document, async () => {
            const hook = boundedReplayHook();
            try {
                const fixture = createCommittedMixedSourceFixture(document, '<span id="badge">23</span>Introduction');
                await flushLayoutRefresh();
                expect(hook).not.toHaveBeenCalled();
                fixture.owner.querySelector('#badge')!.textContent = '24';
                // linkedom 的 childList.target 是观察根且不投递 characterData；
                // 宿主同步的 title 写入通过真实 MO 唤醒同一来源检查。
                fixture.owner.querySelector('#badge')!.setAttribute('title', '24');
                const hostSource = fixture.owner.cloneNode(true) as HTMLElement;
                hostSource.querySelector('[data-fr-translation-owned="true"]')!.remove();
                await flushLayoutRefresh();
                expect(hook).toHaveBeenCalledTimes(1);
                await flushLayoutRefresh();
                expect(hook).toHaveBeenCalledTimes(1);
                expect(getTranslationState(fixture.owner)).toBe(fixture.state);
                expect(fixture.wrapper.textContent).toContain('24');
                expect(fixture.wrapper.textContent).toContain('译文1');
                restoreAllTranslations();
                expect(fixture.owner.innerHTML).toBe(hostSource.innerHTML);
            } finally {setBilingualSkeletonRefreshHandler(undefined);}
        });
    });

    it('同原文 Text 重绘只重绑定一次，新正文变更仍撤下旧译文', async () => {
        const {document} = parseHTML('<html><head></head><body></body></html>');
        await withDocumentRealm(document, async () => {
            const hook = boundedReplayHook();
            try {
                const fixture = createCommittedMixedSourceFixture(document, '<span>23</span>Introduction');
                await flushLayoutRefresh();
                const oldSource = fixture.state.sourceTextNodes![0]!;
                const replacement = document.createTextNode('Introduction');
                oldSource.parentNode!.replaceChild(replacement, oldSource);
                fixture.owner.setAttribute('title', 'Host repaint');
                await flushLayoutRefresh();
                expect(getTranslationState(fixture.owner)).toBe(fixture.state);
                expect(fixture.wrapper.parentNode).toBe(fixture.owner);
                // 真实属性 record 唤醒，等价 Text 重绘仍复用译文并重绑槽身份。
                expect(hook).toHaveBeenCalledTimes(1);
                expect(fixture.state.sourceTextNodes).toEqual([replacement]);
                replacement.data = 'Changed source';
                fixture.owner.setAttribute('title', 'Changed source');
                await flushLayoutRefresh();
                expect(getTranslationState(fixture.owner)).toBeUndefined();
                expect(fixture.state.controller.signal.aborted).toBe(true);
                expect(fixture.wrapper.parentNode).toBeNull();
                expect(fixture.owner.textContent).toBe('23Changed source');
            } finally {setBilingualSkeletonRefreshHandler(undefined);}
        });
    });

    it.each([
        ['translate', (node: HTMLElement) => node.setAttribute('translate', 'no')],
        ['hidden', (node: HTMLElement) => node.setAttribute('hidden', '')],
        ['display', (node: HTMLElement) => {node.style.display = 'none';}],
        ['visibility', (node: HTMLElement) => {node.style.visibility = 'hidden';}],
    ] as const)('%s 来源保护变化仍恢复，保留宿主保护写入', async (_name, protect) => {
        const {document} = parseHTML('<html><head></head><body></body></html>');
        await withDocumentRealm(document, async () => {
            const hook = boundedReplayHook();
            try {
                const fixture = createCommittedMixedSourceFixture(document, '<span id="source">Introduction</span>');
                await flushLayoutRefresh();
                protect(fixture.owner.querySelector<HTMLElement>('#source')!);
                const hostHTML = fixture.owner.cloneNode(true) as HTMLElement;
                hostHTML.querySelector('[data-fr-translation-owned="true"]')!.remove();
                await flushLayoutRefresh();
                expect(getTranslationState(fixture.owner)).toBeUndefined();
                expect(fixture.state.controller.signal.aborted).toBe(true);
                expect(fixture.wrapper.parentNode).toBeNull();
                expect(fixture.owner.innerHTML).toBe(hostHTML.innerHTML);
                expect(hook.mock.calls.length).toBeLessThanOrEqual(1);
            } finally {setBilingualSkeletonRefreshHandler(undefined);}
        }, true);
    });

    it.each([true, false])('宿主刷新骨架时保持已提交的长段落换行 %s', async (frozen) => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const previous = liveConfig.longParagraphLineBreakEnabled;
            try {
                const translation = '这是第一句需要保留的较长译文内容。这是第二句需要保留的较长译文内容。'.repeat(5);
                const fixture = createCommittedSingleSlotFixture(document, translation, frozen);
                const originalBreaks = fixture.wrapper.querySelectorAll('br').length;
                expect(originalBreaks > 0).toBe(frozen);
                liveConfig.longParagraphLineBreakEnabled = !frozen;
                fixture.owner.querySelector('#source-link')!.setAttribute('href', 'https://example.com/new');
                expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(true);
                expect(fixture.owner.lastChild).toBe(fixture.wrapper);
                expect(fixture.wrapper.querySelectorAll('br')).toHaveLength(originalBreaks);
                expect(fixture.wrapper.textContent).toBe(translation);
                expect(fixture.wrapper.querySelector('a')?.getAttribute('href')).toBe('https://example.com/new');
            } finally {
                liveConfig.longParagraphLineBreakEnabled = previous;
            }
        });
    });

    it('保持同一 wrapper 并用最新安全骨架就地重放原 provider 译文', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedReplayFixture(document);
            const replayTranslations = [...fixture.state.bilingualReplay!.translations];
            const providerTranslations = [...fixture.translations];
            const previousSourceNodes = [...(fixture.state.sourceTextNodes ?? [])];

            const plain = fixture.owner.querySelector<HTMLElement>('#plain-source')!;
            const replacementPlainText = document.createTextNode('Translate this sentence.');
            plain.replaceChildren(replacementPlainText);
            const link = fixture.owner.querySelector<HTMLAnchorElement>('#source-link')!;
            link.setAttribute('href', 'https://example.com/after');
            link.setAttribute('title', 'After');
            fixture.owner.querySelector<HTMLElement>('#source-code')!.textContent =
                "const version = 'after';";
            fixture.owner.querySelector<HTMLElement>('#source-no-translate')!.textContent =
                'Protected copy after.';
            fixture.owner.querySelector<HTMLElement>('#source-math')!.innerHTML =
                '<strong>formula after</strong>';

            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(true);
            expect(fixture.owner.querySelector(
                ':scope > .fluent-read-bilingual-content[data-fr-translation-owned="true"]',
            )).toBe(fixture.wrapper);
            expect(fixture.wrapper.getAttribute('translate')).toBe('no');
            expect(fixture.wrapper.querySelector('code')?.textContent).toBe("const version = 'after';");
            expect(fixture.wrapper.querySelector('mark')?.textContent).toBe('Protected copy after.');
            expect(fixture.wrapper.querySelector('ruby strong')?.textContent).toBe('formula after');
            expect(fixture.wrapper.querySelector('a')?.getAttribute('href'))
                .toBe('https://example.com/after');
            expect(fixture.wrapper.querySelector('a')?.getAttribute('title')).toBe('After');
            fixture.translations.forEach((translation) => {
                expect(fixture.wrapper.textContent).toContain(translation);
            });
            expect(fixture.translations).toEqual(providerTranslations);
            expect(fixture.state.bilingualReplay?.sources).toEqual(fixture.sources);
            expect(fixture.state.bilingualReplay?.translations).toEqual(replayTranslations);
            expect(fixture.state.sourceTextNodes).toContain(replacementPlainText);
            expect(fixture.state.sourceTextNodes?.[0]).toBe(replacementPlainText);
            expect(fixture.state.sourceTextNodes?.[0]).not.toBe(previousSourceNodes[0]);
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
        });
    });

    it('没有 replay 快照时拒绝刷新', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedReplayFixture(document, false);
            const previousOuterHTML = fixture.wrapper.outerHTML;

            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(false);
            expect(fixture.wrapper.outerHTML).toBe(previousOuterHTML);
            expect(fixture.state.bilingualReplay).toBeUndefined();
        });
    });

    it('允许顶层应用壳时沿用相同保护边界重放', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedReplayFixture(document, true, true);

            expect(fixture.state.allowTopLevelApplicationShell).toBe(true);
            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(true);
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
        });
    });

    it('当前 wrapper 工件不完整时拒绝重放', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedReplayFixture(document);
            fixture.wrapper.remove();

            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(false);
            expect(fixture.wrapper.parentNode).toBeNull();
            expect(fixture.state.bilingualReplay?.translations).toEqual(fixture.translations);
        });
    });

    it('provider source slots 发生变化时拒绝复用旧译文', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedReplayFixture(document);
            const previousOuterHTML = fixture.wrapper.outerHTML;
            const previousSourceNodes = fixture.state.sourceTextNodes;
            fixture.owner.querySelector<HTMLElement>('#plain-source')!.textContent =
                'This is a different provider source.';

            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(false);
            expect(fixture.wrapper.outerHTML).toBe(previousOuterHTML);
            expect(fixture.state.sourceTextNodes).toBe(previousSourceNodes);
            expect(fixture.state.bilingualReplay?.translations).toEqual(fixture.translations);
        });
    });

    it('链接提示可与焦点和字体标记共同漂移：不重写、不计预算、不撤下译文', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedSingleSlotFixture(document);
            const link = fixture.owner.querySelector(
                ':scope > .fluent-read-bilingual-content a')!;

            for (let round = 0; round < 6; round += 1) {
                // 悬停预览会在指针进入/离开时反复改写我们复制进骨架的链接属性。
                if (round % 3 === 0) link.setAttribute('title', `host-tooltip-${round}`);
                else if (round % 3 === 1) link.setAttribute('title', '');
                else link.removeAttribute('title');
                link.setAttribute('tabindex', round % 2 ? '-1' : '0');
                link.setAttribute('ultimate-bold-correct', '');
                link.classList.add('ultimate-bold-correct');
                beginBilingualArtifactHostWriteGesture();
                expect(isBilingualArtifactDriftOnly(fixture.owner, fixture.state)).toBe(true);
                expect(tryRepairBilingualTranslationArtifact(fixture.owner, fixture.state)).toBe('tolerated');
            }

            expect(link.isConnected).toBe(true);
            expect(fixture.owner.querySelector(
                ':scope > .fluent-read-bilingual-content[data-fr-translation-owned="true"]',
            )).toBe(fixture.wrapper);
            expect(fixture.wrapper.textContent).toContain('阅读最新详情。');
            expect(hasBilingualArtifactHostWriteBudget(fixture.owner)).toBe(false);
            expect(isBilingualArtifactHostWriteBudgetCapitulated(fixture.owner, fixture.state.sourceText,
                fixture.state.sourceStructureSignature ?? '',
                fixture.state.translationInvocationIdentity, fixture.state.scope)).toBe(false);
            // 严格信任仍把它看作被改写的工件，显示与安全边界没有放松。
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(false);
            expect(stabilizeBilingualArtifact(fixture.owner, fixture.state,
                createBilingualRemountCapitulationRegistry())).toBe('current');
        });
    });

    it.each([
        ['href', 'https://example.com/unrelated'],
        ['onclick', 'window.__unexpectedClick = true'],
        ['style', 'display:none'],
        ['aria-hidden', 'true'],
        ['class', 'hidden'],
        ['tabindex', '2'],
    ])('译文链接单独改变 %s 时恢复可信属性，保留原文链接', async (attribute, value) => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedSingleSlotFixture(document);
            const original = fixture.owner.querySelector('#source-link')!;
            const originalHTML = original.outerHTML;
            fixture.wrapper.querySelector('a')!.setAttribute(attribute, value);

            expect(isBilingualArtifactDriftOnly(fixture.owner, fixture.state)).toBe(false);
            expect(tryRepairBilingualTranslationArtifact(fixture.owner, fixture.state)).toBe('repaired');
            const repairedLink = fixture.state.bilingualContent!.querySelector('a')!;
            expect(repairedLink.getAttribute(attribute)).toBe(
                fixture.state.bilingualContentTemplate!.querySelector('a')!.getAttribute(attribute));
            expect(repairedLink.textContent).toBe('阅读最新详情。');
            expect(original.outerHTML).toBe(originalHTML);
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
        });
    });

    it('wrapper 外层属性被改写时仍按篡改重建，而不是保留注入属性', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedSingleSlotFixture(document);
            fixture.wrapper.setAttribute('style', 'display:none');

            expect(isBilingualArtifactDriftOnly(fixture.owner, fixture.state)).toBe(false);
            expect(tryRepairBilingualTranslationArtifact(fixture.owner, fixture.state)).toBe('repaired');

            const rebuilt = fixture.owner.querySelector<HTMLElement>(
                ':scope > .fluent-read-bilingual-content[data-fr-translation-owned="true"]')!;
            expect(rebuilt).not.toBe(fixture.wrapper);
            expect(rebuilt.hasAttribute('style')).toBe(false);
            expect(rebuilt.textContent).toContain('阅读最新详情。');
            expect(stabilizeBilingualArtifact(fixture.owner, fixture.state,
                createBilingualRemountCapitulationRegistry())).toBe('current');
        });
    });

    it('工件译文内容被改写时本地重建并清掉注入属性', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedSingleSlotFixture(document);
            const link = fixture.wrapper.querySelector('a')!;
            link.setAttribute('onclick', 'window.__pwned = true');
            link.textContent = 'HOST INJECTED';
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(false);

            expect(tryRepairBilingualTranslationArtifact(fixture.owner, fixture.state)).toBe('repaired');

            const rebuilt = fixture.owner.querySelector<HTMLElement>(
                ':scope > .fluent-read-bilingual-content[data-fr-translation-owned="true"]')!;
            expect(rebuilt.querySelector('a')?.getAttribute('onclick')).toBeNull();
            expect(rebuilt.querySelector('a')?.textContent).toBe('阅读最新详情。');
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
        });
    });

    it('工件内部属性漂移时可用已提交译文重建骨架', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedSingleSlotFixture(document);
            fixture.owner.querySelector(':scope > .fluent-read-bilingual-content a')!
                .setAttribute('title', 'host-tooltip');
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(false);

            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(true);

            // 骨架与当前 DOM 同步（清掉宿主注入的属性），并复用同一份已提交译文。
            expect(fixture.owner.querySelector(
                ':scope > .fluent-read-bilingual-content[data-fr-translation-owned="true"]',
            )).toBe(fixture.wrapper);
            expect(fixture.wrapper.querySelector('a')?.getAttribute('title')).toBe('Before');
            expect(fixture.wrapper.textContent).toContain('阅读最新详情。');
            expect(fixture.state.bilingualReplay?.translations).toEqual(fixture.translations);
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
        });
    });

    it('宿主只改写骨架属性时重建骨架而不是撤下译文', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, async () => {
            // 与 content 组合根一致：state 只暴露钩子，实现留在 bilingualReplay。
            setBilingualSkeletonRefreshHandler((owner, state) => refreshBilingualTranslationSkeleton(owner, state));
            try {
                const fixture = createCommittedSingleSlotFixture(document);
                const previousSources = [...(fixture.state.bilingualReplay?.sources ?? [])];
                expect(ensureTranslationTruncationLayout(fixture.owner)).toBe(true);

                // 悬停预览会改写源链接的 title：结构签名漂移，但可译文本没变，
                // 因此只能刷新骨架复用已提交译文。
                fixture.owner.querySelector<HTMLAnchorElement>('#source-link')!
                    .setAttribute('title', 'Host tooltip');
                await flushLayoutRefresh();

                expect(fixture.owner.querySelector(
                    ':scope > .fluent-read-bilingual-content[data-fr-translation-owned="true"]',
                )).toBe(fixture.wrapper);
                expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
                expect(fixture.state.bilingualReplay?.sources).toEqual(previousSources);
                expect(fixture.state.bilingualReplay?.translations).toEqual(fixture.translations);
                // 骨架跟着最新 DOM 更新，不再保留旧 title。
                expect(fixture.wrapper.querySelector('a')?.getAttribute('title')).toBe('Host tooltip');
            } finally {
                setBilingualSkeletonRefreshHandler(undefined);
            }
        });
    });
});
