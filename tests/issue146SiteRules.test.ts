/**
 * @file tests/issue146SiteRules.test.ts
 * 文件职责：验证 issue #146 涉及的新闻网站正文与导航边界。
 * 主要内容：以当前公开页面的最小 DOM 结构检查 Linuxiac 标题、导语和 Phoronix 换行正文。
 * 模块边界：只测试候选发现，不调用远端翻译服务或操作真实站点。
 */
import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it} from 'vitest';

import {extractTranslationTextFromNodes} from '@/src/core/translation/public';
import {createTranslationCore} from './helpers/translationCore';
import {beginTranslation, markTranslationComplete, restoreAllTranslations,
    setBilingualContent, tryRepairBilingualTranslationArtifact} from
    '@/src/features/full-page-translation/content/state';
import {isTranslationArtifactCurrent} from
    '@/src/features/full-page-translation/content/translationStability';

function documentFor(html: string): Document {
    return parseHTML(`<html><body>${html}</body></html>`).document as unknown as Document;
}

afterEach(() => restoreAllTranslations());

describe('issue #146 新闻站点翻译边界', () => {
    it('Linuxiac 文章标题与导语各自成为候选，导航和元数据保持原文', () => {
        const document = documentFor(`
            <header id="header"><a id="site-nav" href="/news">News Archive</a></header>
            <main id="main"><article class="post">
                <header class="entry-header">
                    <nav class="ct-breadcrumbs" id="breadcrumb">Home and News</nav>
                    <h1 class="page-title" id="title">A new system reporting feature for Linux users</h1>
                    <div class="page-description"><p id="lead">The new tool collects system facts and runtime metrics for fleet management.</p></div>
                    <div class="entry-meta" id="metadata">By the author on September 25</div>
                </header>
                <div class="entry-content"><p id="body">This article explains how the reporting tool works in practice.</p></div>
            </article></main>
        `);
        const core = createTranslationCore({url: new URL('https://linuxiac.com/example-report/')});
        const candidates = core.discover(document);
        for (const id of ['title', 'lead', 'body']) {
            const element = document.getElementById(id)!;
            expect(candidates.some(candidate => candidate.element === element && candidate.adapterId === 'linuxiac'), id).toBe(true);
            expect(core.resolve(element.firstChild)?.element, id).toBe(element);
        }
        for (const id of ['site-nav', 'breadcrumb', 'metadata']) {
            const element = document.getElementById(id)!;
            expect(candidates.some(candidate => candidate.element === element), id).toBe(false);
            expect(core.resolve(element.firstChild), id).toBeNull();
        }
    });

    it('Linuxiac 首页卡片标题和简介分别翻译，卡片链接保持可用', () => {
        const document = documentFor(`
            <main id="main"><article class="post">
                <h2 class="ultp-block-title" id="card-title"><a href="/example-report/">A new report helps Linux administrators</a></h2>
                <span class="ultp-block-date ultp-block-meta-element" id="card-date">September 27, 2026</span>
                <div class="ultp-block-excerpt" id="card-lead">The report provides a readable summary of system facts and metrics.</div>
            </article></main>
        `);
        const core = createTranslationCore({url: new URL('https://linuxiac.com/')});
        const candidates = core.discover(document);
        for (const id of ['card-title', 'card-lead']) {
            expect(candidates.some(candidate => candidate.element.id === id && candidate.adapterId === 'linuxiac'), id).toBe(true);
        }
        expect(document.querySelector<HTMLAnchorElement>('#card-title a')?.getAttribute('href')).toBe('/example-report/');
        expect(candidates.some(candidate => candidate.element.id === 'card-date')).toBe(false);
    });

    it('Phoronix 保留菜单高度边界，并按直接 br 分割文章正文', () => {
        const document = documentFor(`
            <div class="wcontainer"><ul id="linklist"><li class="menulink"><a id="menu" class="linknode" href="/reviews">Articles & Reviews</a></li></ul></div>
            <div id="main"><article class="full">
                <h1 id="title">A new Linux desktop tool brings useful features</h1>
                <div class="content" id="body">
                    <div><img alt="Illustration" src="/image.webp"></div>
                    The first paragraph explains the new Linux desktop tool.
                    <br><br>The second paragraph describes how to install it safely.
                    <br><p align="center"><img alt="Screenshot" src="/screenshot.webp"></p>
                    <br>The final paragraph links to <a href="/more">further details</a>.
                </div>
            </article></div>
        `);
        const core = createTranslationCore({url: new URL('https://www.phoronix.com/news/example')});
        const candidates = core.discover(document);
        expect(core.resolve(document.getElementById('menu')!.firstChild)).toBeNull();
        expect(candidates.some(candidate => candidate.element.id === 'menu')).toBe(false);
        const runs = candidates.filter(candidate => candidate.element.id === 'body');
        expect(runs).toHaveLength(3);
        expect(runs.every(candidate => candidate.adapterId === 'phoronix' && candidate.sourceLine)).toBe(true);
        expect(runs.map(candidate => extractTranslationTextFromNodes(candidate.nodes!))).toEqual([
            'The first paragraph explains the new Linux desktop tool.',
            'The second paragraph describes how to install it safely.',
            'The final paragraph links to further details .',
        ]);
        expect(core.resolve(document.querySelector('#body a')!.firstChild)?.nodes).toEqual(runs[2]?.nodes);
    });

    it('Linuxiac 的 ShortPixel 惰性标记不耗尽译文自修复预算，语义篡改仍被修复', () => {
        const document = documentFor('<main><p id="owner">An article about Linux reporting.</p></main>');
        const owner = document.getElementById('owner')!;
        const source = owner.firstChild as Text;
        const attempt = beginTranslation(owner, 'bilingual', 'content', false, source.data, [source])!;
        expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
        const wrapper = document.createElement('span');
        wrapper.className = 'fluent-read-bilingual-content';
        wrapper.setAttribute('data-fr-translation-owned', 'true');
        wrapper.setAttribute('translate', 'no');
        wrapper.innerHTML = '一篇关于 Linux 报告的文章，<a href="/report">阅读详情</a>。';
        owner.append(wrapper);
        setBilingualContent(owner, wrapper);

        wrapper.setAttribute('data-spai-bg-prepared', '1');
        wrapper.querySelector('a')!.setAttribute('data-spai-bg-prepared', '1');
        for (let round = 0; round < 5; round += 1) {
            expect(tryRepairBilingualTranslationArtifact(owner, attempt.state)).toBe('repaired');
            expect(attempt.state.bilingualContent).toBe(wrapper);
            expect(isTranslationArtifactCurrent(owner, attempt.state)).toBe(true);
        }

        wrapper.querySelector('a')!.setAttribute('href', '/wrong');
        expect(tryRepairBilingualTranslationArtifact(owner, attempt.state)).toBe('repaired');
        expect(attempt.state.bilingualContent).not.toBe(wrapper);
        expect(attempt.state.bilingualContent?.querySelector('a')?.getAttribute('href')).toBe('/report');
    });

    it('OMG! Ubuntu 的 Disqus frame 只把真实评论当作正文', () => {
        const document = documentFor(`
            <div id="disqus_thread">
                <p id="policy">On-topic, civil comments welcome.</p>
                <li class="post"><div role="article" class="post-content">
                    <button id="reply">Reply</button>
                    <div class="post-message" data-role="message"><div>
                        <p id="comment">This calendar is a great alternative for GNOME users.</p>
                    </div></div>
                </div></li>
            </div>
        `);
        const core = createTranslationCore({url: new URL('https://disqus.com/embed/comments/?f=omgubuntu')});
        const candidates = core.discover(document);
        const comment = document.getElementById('comment')!;
        expect(candidates.some(candidate => candidate.element === comment &&
            candidate.adapterId === 'omgubuntu-disqus-comments')).toBe(true);
        expect(core.resolve(comment.firstChild)?.element).toBe(comment);
        for (const id of ['policy', 'reply']) {
            expect(candidates.some(candidate => candidate.element.id === id), id).toBe(false);
            expect(core.resolve(document.getElementById(id)!.firstChild), id).toBeNull();
        }
    });

    it('Kaggle notebook frame 翻译 Markdown 文本并保留代码与执行提示', () => {
        const document = documentFor(`
            <div class="text_cell_render border-box-sizing rendered_html">
                <h1 id="heading">Booleans</h1>
                <p id="notebook-text">Python uses <code id="inline-code">bool</code> values for branching logic.</p>
            </div>
            <div class="code_cell"><div class="prompt input_prompt" id="prompt">In [1]:</div>
                <pre id="code">x = True</pre></div>
        `);
        const core = createTranslationCore({url: new URL(
            'https://www.kaggleusercontent.com/kf/126670518/signed-token/__results__.html',
        )});
        const candidates = core.discover(document);
        for (const id of ['heading', 'notebook-text']) {
            const target = document.getElementById(id)!;
            expect(candidates.some(candidate => candidate.element === target &&
                candidate.adapterId === 'kaggle-notebook-markdown'), id).toBe(true);
            expect(core.resolve(target.firstChild)?.element, id).toBe(target);
        }
        for (const id of ['prompt', 'code']) {
            const target = document.getElementById(id)!;
            expect(candidates.some(candidate => candidate.element === target), id).toBe(false);
            expect(core.resolve(target.firstChild), id).toBeNull();
        }
        expect(core.shouldStayOriginal(document.getElementById('inline-code')!)).toBe(true);
    });
});
