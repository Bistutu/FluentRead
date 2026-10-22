import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';
import {createSectionLocator, resolveSectionLocators} from '@/src/features/section-translation/locator';

function page(body: string) {
    const {document} = parseHTML(`<html><head></head><body>${body}</body></html>`);
    return document;
}

describe('局部区域的保守重定位', () => {
    it('稳定语义锚点经重新加载、同级新增与文字变化仍指向同一块区域', () => {
        const before = page('<main><section id="comments"><p>Old comments</p></section></main>');
        const locator = createSectionLocator(before.querySelector('#comments')!);
        expect(locator).toEqual(['[id="comments"]']);
        const after = page('<main><section id="related"><p>New box</p></section><section id="comments"><p>New comments</p></section></main>');
        expect(resolveSectionLocators([locator!], after)).toEqual([after.querySelector('#comments')]);
        expect(resolveSectionLocators([locator!, locator!], after)).toHaveLength(1);
    });

    it('按测试属性、角色、语义类或明确父容器生成路径，避免使用每页变化的编号', () => {
        for (const [html, selector, expected] of [
            ['<div data-testid="comments">text</div>', 'div', 'data-testid'],
            ['<div data-test="comments">text</div>', 'div', 'data-test'],
            ['<div data-qa="comments">text</div>', 'div', 'data-qa'],
            ['<div data-role="comments">text</div>', 'div', 'data-role'],
            ['<div role="main">text</div>', 'div', 'role'],
            ['<div class="comment-area panel">text</div>', 'div', 'class'],
            ['<article>text</article>', 'article', 'article'],
            ['<main id="content"><div><p>text</p><p>chosen</p></div></main>', 'p:last-child', 'nth-of-type(2)'],
            ['<main><section id="post-123456"><p>text</p></section></main>', 'section', 'section'],
        ]) {
            const document = page(html);
            const target = document.querySelector(selector)!;
            const locator = createSectionLocator(target);
            expect(locator?.join(' '), html).toContain(expected);
            expect(resolveSectionLocators([locator!], document)).toEqual([target]);
        }
    });

    it('缺失或重名定位不会选择第一个相似区域，损坏 CSS 被安全忽略', () => {
        const document = page('<main><section id="same">First</section><section id="same">Second</section></main>');
        expect(resolveSectionLocators([['#same']], document)).toEqual([]);
        expect(resolveSectionLocators([['#missing'], ['[broken'], ['#'], ['body'], []], document)).toEqual([]);
        // 生成时的重名节点也必须退回明确父级和序号，而非保存含歧义的 ID。
        const target = document.querySelectorAll('#same')[1];
        const locator = createSectionLocator(target);
        expect(locator).toEqual(['main > section:nth-of-type(2)']);
        expect(resolveSectionLocators([locator!], document)).toEqual([target]);
    });

    it('穿过开放 Shadow DOM 定位，每层唯一性和可访问性都必须成立', () => {
        const document = page('<main><div id="host"></div><div id="closed"></div></main>');
        const host = document.querySelector('#host')!;
        const shadow = host.attachShadow({mode: 'open'});
        shadow.innerHTML = '<section id="comments"><p>inside</p></section>';
        const target = shadow.querySelector('#comments')!;
        expect(createSectionLocator(target)).toEqual(['[id="host"]', '[id="comments"]']);
        expect(resolveSectionLocators([['#host', '#comments']], document)).toEqual([target]);
        expect(resolveSectionLocators([['#host', '#absent'], ['#closed', '#comments']], document)).toEqual([]);
        shadow.innerHTML += '<section id="comments">ambiguous</section>';
        expect(resolveSectionLocators([['#host', '#comments']], document)).toEqual([]);
        const closed = document.querySelector('#closed')!.attachShadow({mode: 'closed'});
        closed.innerHTML = '<section id="inside">hidden</section>';
        expect(createSectionLocator(closed.querySelector('#inside')!)).toBeNull();
        shadow.innerHTML = '<div>Plain shadow content</div>';
        expect(createSectionLocator(shadow.querySelector('div')!)).toEqual(['[id="host"]', 'div:nth-of-type(1)']);
    });

    it('拒绝翻译工件、页面根、保护区域、FR 界面与断开的节点，不把纯位置猜测扩大到整页', () => {
        const document = page(`<main>
          <div id="safe"><p>Text</p></div>
          <div translate="no"><section id="protected">secret</section></div>
          <section id="edit" contenteditable="true">edit</section>
          <div class="notranslate"><section id="skip">skip</section></div>
          <div class="fluent-read-bilingual-content"><p id="translation">translated</p></div>
          <fluent-ui data-fluent-read-ui="picker"><section id="picker">UI</section></fluent-ui>
          <div id="fluent-read-floating-ball-container"><p id="ball">UI</p></div>
        </main>`);
        for (const selector of ['html', 'body', 'head', '#protected', '#edit', '#skip', '#translation', '#picker', '#ball']) {
            expect(createSectionLocator(document.querySelector(selector)!), selector).toBeNull();
            expect(resolveSectionLocators([[selector]], document), selector).toEqual([]);
        }
        const safe = document.querySelector('#safe')!;
        safe.remove();
        expect(createSectionLocator(safe)).toBeNull();
        const bare = page('<div>one</div><div>two</div>');
        expect(createSectionLocator(bare.querySelector('div')!)).toBeNull();
        for (const attr of ['translate="no"', 'hidden', 'aria-hidden="true"', 'contenteditable="true"']) {
            const protectedDocument = parseHTML(`<html><body ${attr}><main id="content">Hidden content</main></body></html>`).document;
            expect(createSectionLocator(protectedDocument.querySelector('#content')!), attr).toBeNull();
            expect(resolveSectionLocators([['#content']], protectedDocument), attr).toEqual([]);
        }
    });

    it('限制祖先和 Shadow 深度，超长动态标识不能变成长选择器', () => {
        const document = page('<div id="root"></div>');
        let parent = document.querySelector('#root')!;
        for (let index = 0; index < 9; index += 1) {
            const shadow = parent.attachShadow({mode: 'open'});
            shadow.innerHTML = `<section id="level-${index}">shadow</section>`;
            parent = shadow.querySelector('section')!;
        }
        expect(createSectionLocator(parent)).toBeNull();
        const deep = page('<main></main>');
        parent = deep.querySelector('main')!;
        for (let index = 0; index < 15; index += 1) {
            const next = deep.createElement('div');
            parent.append(next); parent = next;
        }
        expect(createSectionLocator(parent)).toBeNull();
        const long = page(`<div id="${'a'.repeat(200)}">long</div>`);
        expect(createSectionLocator(long.querySelector('div')!)).toBeNull();
        const crowded = page(`<main>${'<span></span>'.repeat(10001)}<div>End</div></main>`);
        expect(createSectionLocator(crowded.querySelector('div')!)).toBeNull();
        const longTag = `section-${'long'.repeat(70)}`;
        const overlong = page(`<main><${longTag}><${longTag}><${longTag}>End</${longTag}></${longTag}></${longTag}></main>`);
        expect(createSectionLocator(overlong.querySelectorAll(longTag)[2])).toBeNull();
        const classes = ['q'.repeat(100), 'w'.repeat(100), 'z'.repeat(100)].join(' ');
        const anchored = page(`<main><div class="${classes}"><${longTag}>Text</${longTag}></div></main>`);
        const target = anchored.querySelector(longTag)!;
        expect(createSectionLocator(target)).not.toBeNull();
        const altered = page('<main id="content">Text</main>');
        const rootTarget = altered.querySelector('main')!;
        Object.defineProperty(rootTarget, 'getRootNode', {value: () => altered.createElement('div')});
        expect(createSectionLocator(rootTarget)).toBeNull();
    });
});
