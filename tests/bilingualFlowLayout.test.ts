import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';
import translationStyles from '@/src/ui/styles/translation-display.css?inline';
import {prepareBilingualFlowLayout} from '@/src/features/full-page-translation/content/bilingualFlowLayout';

function fixture(html = '<p id="owner">Original source text.</p>') {
    const {document} = parseHTML(`<html><body>${html}</body></html>`);
    const node = document.querySelector<HTMLElement>('#owner')!;
    const content = document.createElement('span');
    content.className = 'fluent-read-bilingual-content';
    content.setAttribute('data-fr-translation-owned', 'true');
    content.textContent = '这是一段长译文，应该保持原文正文栏宽，并在视口变化时自然换行。'.repeat(10);
    const getComputedStyle = vi.fn((element: Element) => ({
        display: (element as HTMLElement).style.display || (/^(?:td|th)$/u.test(element.localName) ? 'table-cell' : 'block'),
        cssFloat: (element as HTMLElement).style.getPropertyValue('float') || 'none',
        tableLayout: (element as HTMLElement).style.getPropertyValue('table-layout') || 'auto',
    } as CSSStyleDeclaration));
    Object.defineProperty(document.defaultView!, 'getComputedStyle', {value: getComputedStyle, configurable: true});
    return {document, node, content, getComputedStyle};
}

function expectIntrinsicIsolation(content: HTMLElement) {
    expect(content.style.getPropertyValue('contain')).toBe('inline-size');
    expect(content.style.getPropertyValue('width')).toBeFalsy();
    expect(content.style.getPropertyValue('max-width')).toBeFalsy();
    expect(content.style.getPropertyValue('max-inline-size')).toBeFalsy();
}

describe('bilingual intrinsic flow layout', () => {
    it.each(['inline-block', 'inline-flex', 'inline-grid', 'inline-table'])('keeps translation intrinsic width out of a %s owner', display => {
        const {node, content} = fixture(`<p id="owner" style="display:${display}">Original source text.</p>`);
        prepareBilingualFlowLayout(node, content);
        expectIntrinsicIsolation(content);
    });

    it.each(['left', 'right', 'inline-start', 'inline-end'])('keeps translation intrinsic width out of a %s float', cssFloat => {
        const {node, content} = fixture(`<blockquote id="owner" style="float:${cssFloat}">Original quote.</blockquote>`);
        prepareBilingualFlowLayout(node, content);
        expectIntrinsicIsolation(content);
    });

    it.each(['td', 'th'])('preserves an auto table %s column without assigning a stale pixel width', tag => {
        const {node, content} = fixture(`<table><tr><${tag} id="owner">Original source.</${tag}><td>Other column.</td></tr></table>`);
        prepareBilingualFlowLayout(node, content);
        expectIntrinsicIsolation(content);
    });

    it('also protects normal paragraphs nested in intrinsic-width ancestors', () => {
        for (const html of [
            '<div style="display:inline-block"><section><p id="owner">Original source.</p></section></div>',
            '<blockquote style="float:right"><section><p id="owner">Original source.</p></section></blockquote>',
            '<table><tr><td><section><p id="owner">Original source.</p></section></td></tr></table>',
        ]) {
            const {node, content} = fixture(html);
            prepareBilingualFlowLayout(node, content);
            expectIntrinsicIsolation(content);
        }
    });

    it('detects an inline-block host across an open ShadowRoot', () => {
        const {node, content, document} = fixture();
        const host = document.createElement('div');
        host.style.display = 'inline-block';
        document.body.appendChild(host);
        const shadow = host.attachShadow({mode: 'open'});
        shadow.appendChild(node);
        expect(node.parentElement).toBeNull();
        prepareBilingualFlowLayout(node, content);
        expectIntrinsicIsolation(content);
        expect(node.getRootNode()).toBe(shadow);
        expect(shadow.host).toBe(host);
    });

    it('does not revisit a cyclic composed-parent result from a damaged host API', () => {
        const {node, content, getComputedStyle} = fixture();
        node.remove();
        Object.defineProperty(node, 'getRootNode', {value: () => ({host: node}), configurable: true});
        prepareBilingualFlowLayout(node, content);
        expect(getComputedStyle).toHaveBeenCalledTimes(1);
        expect(content.getAttribute('style')).toBeNull();
    });

    it('supports CSS-generated table cells without requiring semantic table markup', () => {
        const {node, content} = fixture('<div style="display:table"><div id="owner" style="display:table-cell">Original source.</div></div>');
        prepareBilingualFlowLayout(node, content);
        expectIntrinsicIsolation(content);
    });

    it('keeps a fit-content chat bubble at available inline size instead of collapsing it to its decoration', () => {
        const {node, content} = fixture('<p id="owner" style="display:inline-block">Original source.</p>');
        content.classList.add('fluent-display-chat-bubble');
        prepareBilingualFlowLayout(node, content);
        expectIntrinsicIsolation(content);
        expect(content.style.getPropertyValue('inline-size')).toBe('auto');
    });

    it.each([
        '<p id="owner" style="width:320px">Original source.</p>',
        '<blockquote style="width:320px"><p id="owner">Original quote.</p></blockquote>',
        '<table style="table-layout:fixed;width:440px"><tr><td id="owner">Original source.</td></tr></table>',
        '<article style="column-count:2;width:440px"><p id="owner">Original source.</p></article>',
    ])('leaves ordinary fixed-width and fixed-layout table flows unchanged: %j', html => {
        const {node, content} = fixture(html);
        prepareBilingualFlowLayout(node, content);
        expect(content.getAttribute('style')).toBeNull();
    });

    it.each([false, true])('supports translation before/after original and refresh without changing source DOM or retaining pixel dimensions: %j', before => {
        const {node, content, document} = fixture('<p id="owner" style="display:inline-block">Original <b>source</b> text.</p>');
        const html = node.innerHTML, children = [...node.childNodes];
        prepareBilingualFlowLayout(node, content);
        if (before) node.insertBefore(content, node.firstChild); else node.appendChild(content);
        expectIntrinsicIsolation(content);
        content.removeAttribute('style'); // 模拟 renderer refresh 用新工厂属性替换旧工件属性。
        content.replaceChildren(document.createTextNode('刷新后仍在原文栏宽内换行。'.repeat(20)));
        prepareBilingualFlowLayout(node, content);
        expectIntrinsicIsolation(content);
        expect(node.childNodes[before ? 0 : node.childNodes.length - 1]).toBe(content);
        content.remove();
        expect(node.innerHTML).toBe(html);
        expect([...node.childNodes]).toEqual(children);
    });

    it('does not isolate a fit-content bubble in an ordinary fixed-width block', () => {
        const {node, content} = fixture();
        content.classList.add('fluent-display-chat-bubble');
        prepareBilingualFlowLayout(node, content);
        expect(content.getAttribute('style')).toBeNull();
    });

    it('requires an owned translation wrapper and an observable document view', () => {
        const forged = fixture('<p id="owner" style="display:inline-block">Original source.</p>');
        forged.content.removeAttribute('data-fr-translation-owned');
        prepareBilingualFlowLayout(forged.node, forged.content);
        expect(forged.content.getAttribute('style')).toBeNull();
        expect(forged.getComputedStyle).not.toHaveBeenCalled();
        const noView = fixture('<p id="owner" style="display:inline-block">Original source.</p>');
        Object.defineProperty(noView.document, 'defaultView', {value: null, configurable: true});
        prepareBilingualFlowLayout(noView.node, noView.content);
        expect(noView.content.getAttribute('style')).toBeNull();
    });

    it('keeps an unavailable layout as a no-op instead of guessing a pixel width', () => {
        const {node, content, getComputedStyle} = fixture();
        getComputedStyle.mockImplementation(() => {throw new Error('Unavailable layout');});
        prepareBilingualFlowLayout(node, content);
        expect(content.getAttribute('style')).toBeNull();
    });

    it('bounds ancestor inspection on unusually deep host DOM', () => {
        const {node, content, getComputedStyle} = fixture('<div style="display:inline-block">' + '<div>'.repeat(40) + '<p id="owner">Original source.</p>' + '</div>'.repeat(40) + '</div>');
        prepareBilingualFlowLayout(node, content);
        expect(getComputedStyle).toHaveBeenCalledTimes(32);
        expect(content.getAttribute('style')).toBeNull();
    });

    it('allows wrapping without flattening meaningful pre-line or pre-wrap source whitespace', () => {
        const base = translationStyles.match(/\.fluent-read-bilingual-content\s*\{([^}]+)\}/u)![1]!;
        expect(base).toMatch(/text-wrap:\s*wrap\s*;/u);
        expect(base).not.toMatch(/white-space\s*:/u);
    });
});
