/**
 * @file tests/documentHtmlInline.test.ts
 * 文件职责：验证 HTML 与 ePub 章节里带链接、强调等行内标签的句子作为一个片段整体翻译，并在导出与预览时把行内标签还原到译文里。
 * 主要内容：行内标签换成编号占位符、嵌套标签按开闭配对编号；包在整段文字外面的标签、无法配对的标签、换行与自闭合标签不合并；句中的行内代码整个保留在句子里且不翻译；译文里的占位符按编号还原（容忍多余空格），丢失、重复、错位或多余的占位符一律退回不带行内标签的整句译文且文字不丢；实体在送翻时解码、在输出时转义；与原文相同的译文保留原文。
 * 模块边界：只测试纯解析与渲染，不发起翻译；预览外壳与页面交互由各自的测试覆盖。
 */
import {describe, expect, it} from 'vitest';
import {parseDocument, renderDocument} from '@/src/features/document-translation/core/document';

const sources = (html: string) => parseDocument('page.html', html).segments.map(segment => segment.source);
const translated = (html: string, translations: string[], mode: 'translated' | 'bilingual' = 'translated') => renderDocument(parseDocument('page.html', html), translations, mode);

describe('HTML sentences with inline markup', () => {
    const linked = '<p>Hello from a local <a href="https://example.com/?a=1&amp;b=2">example document</a>.</p>';

    it('sends the whole sentence as one segment with numbered placeholders', () => {
        expect(sources(linked)).toEqual(['Hello from a local <g1>example document</g1>.']);
        expect(sources('<p>See <a href="#x"><em>this</em> page</a> &amp; <b>that</b> now</p>')).toEqual(['See <g1><g2>this</g2> page</g1> & <g3>that</g3> now']);
        // 没有闭合标签的文档末尾同样成句。
        expect(sources('tail <b>bold</b> end')).toEqual(['tail <g1>bold</g1> end']);
        expect(renderDocument(parseDocument('page.html', linked), [], 'translated')).toBe(linked);
    });

    it('restores the inline tags inside the translation, in translated and bilingual output', () => {
        const zh = '来自本地<g1>示例 & 文档</g1>的问候。';
        expect(translated(linked, [zh])).toBe('<p>来自本地<a href="https://example.com/?a=1&amp;b=2">示例 &amp; 文档</a>的问候。</p>');
        expect(translated(linked, [zh], 'bilingual')).toBe(`<p>Hello from a local <a href="https://example.com/?a=1&amp;b=2">example document</a>.<br><span data-fluent-read-document-translation="true">来自本地<a href="https://example.com/?a=1&amp;b=2">示例 &amp; 文档</a>的问候。</span></p>`);
        // 翻译服务在占位符里加了空格或改了大小写，仍能还原。
        expect(translated(linked, ['来自本地< G1 >示例文档</ g 1 >的问候。'])).toBe('<p>来自本地<a href="https://example.com/?a=1&amp;b=2">示例文档</a>的问候。</p>');
        // 翻译服务把占位符的尖括号转成了实体，同样还原。
        expect(translated(linked, ['来自本地 &lt;g1&gt; 示例文档 &lt;/g1&gt; 的问候。'])).toBe('<p>来自本地 <a href="https://example.com/?a=1&amp;b=2"> 示例文档 </a> 的问候。</p>');
        // 占位符被换成全角括号、全角尖括号或半角括号，同样还原。
        for (const variant of ['来自本地（g1）示例文档（/g1）的问候。', '来自本地＜g1＞示例文档＜／g1＞的问候。', '来自本地(g1)示例文档(/g1)的问候。']) expect(translated(linked, [variant]), variant).toBe('<p>来自本地<a href="https://example.com/?a=1&amp;b=2">示例文档</a>的问候。</p>');
        // 嵌套与并列的标签按编号各自还原，顺序可以随译文语序变化。
        const nested = '<p>See <a href="#x"><em>this</em> page</a> and <b>that</b> now</p>';
        expect(translated(nested, ['现在看<g3>那个</g3>和<g1><g2>这个</g2>页面</g1>'])).toBe('<p>现在看<b>那个</b>和<a href="#x"><em>这个</em>页面</a></p>');
        // 句子前后的空白与空的行内标签原样保留在句子之外。
        const padded = '<p> <i></i>A <b>x</b> y<u></u> </p>';
        expect(sources(padded)).toEqual(['A <g1>x</g1> y']);
        expect(translated(padded, ['甲<g1>乙</g1>丙'])).toBe('<p> <i></i>甲<b>乙</b>丙<u></u> </p>');
        // 首尾的空白留在原处。
        expect(translated('<p>  Lead <i>word</i> tail \n</p>', ['开头<g1>词</g1>结尾'])).toBe('<p>  开头<i>词</i>结尾 \n</p>');
    });

    it('falls back to the plain sentence when placeholders are lost, repeated, misplaced or unknown', () => {
        const two = '<p>One <b>bold</b> and <i>italic</i> end</p>';
        for (const broken of ['一个粗体和斜体结尾', '一个<g1>粗体</g1>和斜体结尾', '一个<g1>粗体和<g2>斜体</g1>结尾</g2>', '一个</g1>粗体<g1>和<g2>斜体</g2>结尾', '一个<g1>粗<g1>体</g1></g1>和<g2>斜体</g2>结尾', '一个<g1>粗体</g1>和<g2>斜体</g2><g9>结尾</g9>', '一个<g1>粗体</g1>和<g2>斜体结尾']) {
            const output = translated(two, [broken]);
            expect(output, broken).not.toMatch(/<\/?g\s*\d/iu);
            expect(output, broken).not.toMatch(/<b>|<i>/u);
            expect(output.replace(/<\/?p>/gu, ''), broken).toBe(broken.replace(/<\/?g\d+>/gu, ''));
        }
        // 译文里出现的尖括号文字照常转义，不会变成标签。
        expect(translated(two, ['一个 <script> 粗体斜体'])).toBe('<p>一个 &lt;script&gt; 粗体斜体</p>');
    });

    it('does not merge wrapping, unpaired or sentence-breaking tags', () => {
        // 包在整段文字外面的标签不属于句子内部。
        expect(sources('<p><strong>Note</strong></p>')).toEqual(['Note']);
        expect(translated('<p><strong>Note</strong></p>', ['注意'])).toBe('<p><strong>注意</strong></p>');
        expect(sources('<p><b>Bold lead</b> then <i>italic</i> tail</p>')).toEqual(['Bold lead', 'then', 'italic', 'tail']);
        // 无法配对或名称不匹配的行内标签。
        expect(sources('<p>open <b>never closed</p>')).toEqual(['open', 'never closed']);
        expect(sources('<p>mixed <b>names</i> here</p>')).toEqual(['mixed', 'names', 'here']);
        // 换行、图片与自闭合写法结束一句话；纯空白的行内片段不产生片段。
        expect(sources('<p>first line<br>second <span/>line <img src="a.png"> after</p>')).toEqual(['first line', 'second', 'line', 'after']);
        expect(sources('<p> <span> </span> </p>')).toEqual([]);
        // 文字本身含有占位符写法时不合并，避免与真实占位符混淆。
        expect(sources('<p>literal &lt;g1&gt; and <b>bold</b> text</p>')).toEqual(['literal <g1> and', 'bold', 'text']);
        // pre 里的内容与行内标签都原样保留；只有代码、没有别的文字的句子不产生片段。
        expect(sources('<pre>keep <b>this</b> as is</pre><p><code>x</code></p><td> <code>a &lt; b</code> </td>')).toEqual([]);
        // 没有闭合的 code 仍按受保护内容处理，后面的文字不翻译。
        expect(sources('<p>before <code>never closed</p><p>still code</p>')).toEqual(['before']);
    });

    it('keeps inline code inside its sentence, untranslated, wherever the service puts it', () => {
        const html = '<p>Run <code class="sh">app --migrate &amp;&amp; <b>exit</b></code> once after <em>upgrading</em>.</p>';
        // 代码的文字写在占位符之间给翻译服务当上下文；自闭合写法的 code 不算代码元素。
        expect(sources(html)).toEqual(['Run <g1>app --migrate && exit</g1> once after <g2>upgrading</g2>.']);
        expect(renderDocument(parseDocument('page.html', html), [], 'translated')).toBe(html);
        const code = '<code class="sh">app --migrate &amp;&amp; <b>exit</b></code>';
        // 占位符之间被服务翻译或清空，都换回原来的代码元素；语序可以变化。
        expect(translated(html, ['<g2>升级</g2>后运行一次<g1>应用 --迁移</g1>。'])).toBe(`<p><em>升级</em>后运行一次${code}。</p>`);
        expect(translated(html, ['<g2>升级</g2>后运行一次<g1></g1>。'])).toBe(`<p><em>升级</em>后运行一次${code}。</p>`);
        expect(translated(html, ['升级后运行一次。'], 'bilingual')).toContain(`<span data-fluent-read-document-translation="true">升级后运行一次。 ${code}</span>`);
        // 占位符丢失、或被塞进代码占位符里面时退回纯文字，代码以原样补在句末。
        expect(translated(html, ['<g1>应用<g2>升级</g2></g1>后运行一次。'])).toBe(`<p>应用升级后运行一次。 ${code}</p>`);
        // 句首、句末是代码时同样成句，两端的空白留在句子外面。
        expect(sources('<li> <code>npm test</code> runs the suite </li><li>Then call <code>done()</code></li>')).toEqual(['<g1>npm test</g1> runs the suite', 'Then call <g1>done()</g1>']);
        expect(translated('<li> <code>npm test</code> runs the suite </li>', ['<g1>npm test</g1>运行测试'])).toBe('<li> <code>npm test</code>运行测试 </li>');
        expect(translated('<li>Then call <code>done()</code></li>', ['然后调用<g1>done()</g1>'])).toBe('<li>Then call <code>done()</code></li>'.replace('Then call ', '然后调用'));
    });
});
