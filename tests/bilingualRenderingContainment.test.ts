import {describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {
    disableBilingualRenderingContainment,
    enableBilingualRenderingContainment,
} from '@/src/features/full-page-translation/content/renderingContainment';

function fixture() {
    const {document} = parseHTML('<html><body><p style="color: red">Original <code>source_code()</code><span class="fluent-read-bilingual-content" data-fr-translation-owned="true" translate="no">译文 <a href="/read">链接</a><code>source_code()</code></span></p></body></html>');
    const owner = document.querySelector<HTMLElement>('p')!;
    const content = owner.querySelector<HTMLElement>('.fluent-read-bilingual-content')!;
    const values: Record<string, string> = {
        'content-visibility': 'visible', contain: 'none',
        filter: 'none', 'backdrop-filter': '', transform: 'none', perspective: 'none',
        'text-shadow': 'none', 'box-shadow': 'none',
    };
    const style = {
        display: 'block', writingMode: 'horizontal-tb', position: 'static', boxSizing: 'content-box',
        blockSize: '120.5px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
        getPropertyValue: (property: string) => values[property],
    };
    const supports = vi.fn(() => true);
    const getComputedStyle = vi.fn(() => style);
    const view = {CSS: {supports}, innerHeight: 600, getComputedStyle};
    Object.defineProperty(document, 'defaultView', {configurable: true, value: view});
    Object.defineProperty(document.documentElement, 'scrollHeight', {configurable: true, value: 3000});
    Object.defineProperties(content, {
        clientWidth: {configurable: true, value: 640}, clientHeight: {configurable: true, value: 121},
        scrollWidth: {configurable: true, value: 640}, scrollHeight: {configurable: true, value: 121},
    });
    const rect = vi.fn(() => ({x: 0, y: 8000, width: 640, height: 121}));
    Object.defineProperty(content, 'getBoundingClientRect', {configurable: true, value: rect});
    return {document, owner, content, values, style, view, supports, getComputedStyle, rect};
}

describe('长页双语译文屏外渲染', () => {
    it('保留精确内容高度，只同步修改译文工件的展示属性', () => {
        const {owner, content, supports} = fixture();
        const originalText = owner.firstChild;
        const originalCode = owner.querySelector('code');
        const sourceStyle = owner.getAttribute('style');
        const translationNodes = Array.from(content.childNodes);
        content.style.fontFamily = 'serif';

        expect(enableBilingualRenderingContainment(content)).toBe(true);
        expect(content.style.getPropertyValue('contain-intrinsic-block-size')).toBe('auto 120.5px');
        expect(content.style.getPropertyValue('content-visibility')).toBe('auto');
        expect(content.getAttribute('data-fr-rendering-contained')).toBe('true');
        expect(content.style.fontFamily).toBe('serif');
        expect(owner.firstChild).toBe(originalText);
        expect(owner.querySelector('code')).toBe(originalCode);
        expect(owner.getAttribute('style')).toBe(sourceStyle);
        expect(Array.from(content.childNodes)).toEqual(translationNodes);
        expect(supports.mock.calls).toEqual([
            ['content-visibility', 'auto'], ['contain-intrinsic-block-size', 'auto 1px'],
        ]);
    });

    it('border-box 扣除内边距与边框，缩放不参与高度计算', () => {
        const {content, style, rect} = fixture();
        Object.assign(style, {boxSizing: 'border-box', blockSize: '140.75px', paddingTop: '8px', paddingBottom: '9.5px', borderTopWidth: '1px', borderBottomWidth: '.25px'});
        rect.mockReturnValue({x: 0, y: 8000, width: 1280, height: 281.5});
        expect(enableBilingualRenderingContainment(content)).toBe(true);
        expect(content.style.getPropertyValue('contain-intrinsic-block-size')).toBe('auto 122px');
        expect(rect).toHaveBeenCalledTimes(2);
    });

    it('重复启用不再读取占位尺寸，撤销后可重新测量真实内容', () => {
        const {content, style, getComputedStyle} = fixture();
        expect(enableBilingualRenderingContainment(content)).toBe(true);
        style.blockSize = '220px';
        expect(enableBilingualRenderingContainment(content)).toBe(false);
        expect(getComputedStyle).toHaveBeenCalledOnce();
        expect(disableBilingualRenderingContainment(content)).toBe(true);
        expect(enableBilingualRenderingContainment(content)).toBe(true);
        expect(content.style.getPropertyValue('contain-intrinsic-block-size')).toBe('auto 220px');
    });

    it.each(['no-class', 'not-owned', 'disconnected'])('拒绝不属于当前自有双语工件的 %s', (kind) => {
        const {content, getComputedStyle, supports} = fixture();
        if (kind === 'no-class') content.classList.remove('fluent-read-bilingual-content');
        if (kind === 'not-owned') content.removeAttribute('data-fr-translation-owned');
        if (kind === 'disconnected') content.remove();
        expect(enableBilingualRenderingContainment(content)).toBe(false);
        expect(supports).not.toHaveBeenCalled();
        expect(getComputedStyle).not.toHaveBeenCalled();
        expect(content.hasAttribute('data-fr-rendering-contained')).toBe(false);
    });

    it.each(['no-view', 'no-css', 'unsupported-visibility', 'unsupported-size', 'throwing-supports'])('浏览器能力 %s 不可用时保留原渲染', (kind) => {
        const {document, content, view, supports, getComputedStyle} = fixture();
        if (kind === 'no-view') Object.defineProperty(document, 'defaultView', {value: null});
        if (kind === 'no-css') Object.defineProperty(view, 'CSS', {value: undefined});
        if (kind === 'unsupported-visibility') supports.mockReturnValue(false);
        if (kind === 'unsupported-size') supports.mockImplementation(() => supports.mock.calls.length === 1);
        if (kind === 'throwing-supports') supports.mockImplementation(() => { throw new Error('restricted view'); });
        expect(enableBilingualRenderingContainment(content)).toBe(false);
        expect(getComputedStyle).not.toHaveBeenCalled();
        expect(content.hasAttribute('style')).toBe(false);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('拒绝无效窗口高度 %s', (height) => {
        const {content, view, getComputedStyle} = fixture();
        view.innerHeight = height;
        expect(enableBilingualRenderingContainment(content)).toBe(false);
        expect(getComputedStyle).not.toHaveBeenCalled();
    });

    it.each([0, 2399, Number.NaN, Number.POSITIVE_INFINITY])('页面高度 %s 未达到四倍视口或不可读时不测量译文', (height) => {
        const {document, content, getComputedStyle} = fixture();
        Object.defineProperty(document.documentElement, 'scrollHeight', {value: height});
        expect(enableBilingualRenderingContainment(content)).toBe(false);
        expect(getComputedStyle).not.toHaveBeenCalled();
    });

    it('阈值包含四倍视口，优先采用文档真实 scrollingElement', () => {
        const {document, content} = fixture();
        Object.defineProperty(document, 'scrollingElement', {value: {scrollHeight: 2400}});
        Object.defineProperty(document.documentElement, 'scrollHeight', {value: 0});
        expect(enableBilingualRenderingContainment(content)).toBe(true);
    });

    it('文档没有滚动根时保守回退', () => {
        const {document, content} = fixture();
        Object.defineProperty(document, 'documentElement', {value: null});
        expect(enableBilingualRenderingContainment(content)).toBe(false);
    });

    it.each(['math', 'mjx-container', 'img', 'svg', 'ruby', 'sub', 'sup', 'div', 'table', 'iframe', 'canvas', 'video', 'span.MathJax', 'span.katex', 'span.mwe-math-element', 'span.ltx_Math'])('复杂排版 %s 保留原渲染', (selector) => {
        const {document, content, getComputedStyle} = fixture();
        const [tag, className] = selector.split('.');
        const rich = document.createElement(tag!);
        if (className) rich.className = className;
        content.appendChild(rich);
        expect(enableBilingualRenderingContainment(content)).toBe(false);
        expect(getComputedStyle).not.toHaveBeenCalled();
    });

    it.each([
        {display: 'inline'}, {display: 'inline-block'}, {display: 'table'}, {display: 'flex'}, {display: 'grid'},
        {writingMode: 'vertical-rl'}, {position: 'absolute'}, {position: 'relative'},
    ])('不改变特殊布局 %j 的格式化上下文', (change) => {
        const {content, style} = fixture();
        Object.assign(style, change);
        expect(enableBilingualRenderingContainment(content)).toBe(false);
        expect(content.hasAttribute('style')).toBe(false);
    });

    it.each(['filter', 'backdrop-filter', 'transform', 'perspective', 'text-shadow', 'box-shadow'])('越界装饰 %s 不进入 paint containment', (property) => {
        const {content, values} = fixture();
        values[property] = 'active-decoration';
        expect(enableBilingualRenderingContainment(content)).toBe(false);
    });

    it.each(['content-visibility', 'contain'])('不覆盖已有 %s 渲染语义', (property) => {
        const {content, values} = fixture();
        values[property] = 'hidden';
        expect(enableBilingualRenderingContainment(content)).toBe(false);
    });

    it('没有自带 containment 的浏览器计算样式可以启用', () => {
        const {content, values} = fixture();
        values['content-visibility'] = '';
        values.contain = '';
        expect(enableBilingualRenderingContainment(content)).toBe(true);
    });

    it.each([
        ['clientWidth', 0], ['clientHeight', 0], ['scrollWidth', 641], ['scrollHeight', 122],
        ['scrollWidth', Number.NaN], ['clientHeight', Number.POSITIVE_INFINITY],
    ])('拒绝无尺寸、不可读或溢出 %s=%s', (property, value) => {
        const {content} = fixture();
        Object.defineProperty(content, property, {value});
        expect(enableBilingualRenderingContainment(content)).toBe(false);
    });

    it.each(['auto', '100%', '-1px', '0px', 'Infinitypx', '1e999px'])('不以无效 block-size %s 估算高度', (blockSize) => {
        const {content, style} = fixture();
        style.blockSize = blockSize;
        expect(enableBilingualRenderingContainment(content)).toBe(false);
    });

    it.each([{boxSizing: 'unknown'}, {boxSizing: 'border-box', paddingTop: 'auto'}, {boxSizing: 'border-box', paddingTop: '200px'}])('边框盒无法得到正内容高度 %j 时保留原渲染', (change) => {
        const {content, style} = fixture();
        Object.assign(style, change);
        expect(enableBilingualRenderingContainment(content)).toBe(false);
    });

    it.each(['computed-style', 'layout-getter'])('读取 %s 抛错不会阻断译文提交', (kind) => {
        const {content, getComputedStyle} = fixture();
        if (kind === 'computed-style') getComputedStyle.mockImplementation(() => { throw new Error('unreadable styles'); });
        else Object.defineProperty(content, 'clientWidth', {get: () => { throw new Error('rebuilding layout'); }});
        expect(enableBilingualRenderingContainment(content)).toBe(false);
        expect(content.hasAttribute('data-fr-rendering-contained')).toBe(false);
    });

    it.each(['x', 'y', 'width', 'height'])('格式化上下文改变 %s 时撤销 containment，保留已有字体样式', (property) => {
        const {content, rect} = fixture();
        content.style.fontFamily = 'serif';
        const before = {x: 0, y: 8000, width: 640, height: 121};
        rect.mockReturnValueOnce(before).mockReturnValueOnce({...before, [property]: before[property as keyof typeof before] + 1});
        expect(enableBilingualRenderingContainment(content)).toBe(false);
        expect(content.style.fontFamily).toBe('serif');
        expect(content.style.getPropertyValue('content-visibility')).toBeFalsy();
        expect(content.style.getPropertyValue('contain-intrinsic-block-size')).toBeFalsy();
        expect(content.hasAttribute('data-fr-rendering-contained')).toBe(false);
    });

    it('容忍半像素取整差，不把变换后的几何单位作为内容高度', () => {
        const {content, rect} = fixture();
        rect.mockReturnValueOnce({x: 0, y: 8000, width: 640, height: 121})
            .mockReturnValueOnce({x: 0.5, y: 8000.5, width: 640.5, height: 121.5});
        expect(enableBilingualRenderingContainment(content)).toBe(true);
        expect(content.style.getPropertyValue('contain-intrinsic-block-size')).toBe('auto 120.5px');
    });

    it.each(['before-invalid', 'after-invalid', 'before-throws', 'after-throws'])('几何测量 %s 保守回退且不残留标记或空样式', (kind) => {
        const {content, rect} = fixture();
        if (kind === 'before-invalid') rect.mockReturnValueOnce({x: Number.NaN, y: 8000, width: 640, height: 121});
        if (kind === 'after-invalid') rect.mockReturnValueOnce({x: 0, y: 8000, width: 640, height: 121})
            .mockReturnValueOnce({x: 0, y: 8000, width: Number.POSITIVE_INFINITY, height: 121});
        if (kind === 'before-throws') rect.mockImplementationOnce(() => { throw new Error('detached geometry'); });
        if (kind === 'after-throws') rect.mockImplementationOnce(() => ({x: 0, y: 8000, width: 640, height: 121}))
            .mockImplementationOnce(() => { throw new Error('new formatting context failed'); });
        expect(enableBilingualRenderingContainment(content)).toBe(false);
        expect(content.hasAttribute('data-fr-rendering-contained')).toBe(false);
        expect(content.hasAttribute('style')).toBe(false);
    });

    it('撤销仅移除两个自有属性与标记，保留译文、链接、字体和其它内联属性', () => {
        const {content} = fixture();
        content.style.fontFamily = 'serif';
        content.style.color = 'blue';
        const html = content.innerHTML;
        const link = content.querySelector('a');
        expect(enableBilingualRenderingContainment(content)).toBe(true);
        expect(disableBilingualRenderingContainment(content)).toBe(true);
        expect(content.style.fontFamily).toBe('serif');
        expect(content.style.color).toBe('blue');
        expect(content.style.getPropertyValue('content-visibility')).toBeFalsy();
        expect(content.style.getPropertyValue('contain-intrinsic-block-size')).toBeFalsy();
        expect(content.hasAttribute('data-fr-rendering-contained')).toBe(false);
        expect(content.innerHTML).toBe(html);
        expect(content.querySelector('a')).toBe(link);
        expect(disableBilingualRenderingContainment(content)).toBe(false);
    });

    it('撤销清理空 style，未标记或伪造工件保留其样式', () => {
        const {content} = fixture();
        expect(enableBilingualRenderingContainment(content)).toBe(true);
        expect(disableBilingualRenderingContainment(content)).toBe(true);
        expect(content.hasAttribute('style')).toBe(false);
        content.setAttribute('style', 'content-visibility: auto');
        expect(disableBilingualRenderingContainment(content)).toBe(false);
        expect(content.getAttribute('style')).toBe('content-visibility: auto');
        content.setAttribute('data-fr-rendering-contained', 'true');
        content.removeAttribute('data-fr-translation-owned');
        expect(disableBilingualRenderingContainment(content)).toBe(false);
        expect(content.getAttribute('style')).toBe('content-visibility: auto');
    });

    it('标记仍在但 style 已被宿主移除时仍能清理自有标记', () => {
        const {content} = fixture();
        content.setAttribute('data-fr-rendering-contained', 'true');
        expect(disableBilingualRenderingContainment(content)).toBe(true);
        expect(content.hasAttribute('data-fr-rendering-contained')).toBe(false);
    });
});
