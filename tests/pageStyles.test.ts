import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TRANSLATION_APPEARANCE_STYLE_ID} from '@/src/app/content/translationAppearance';
import reencounterStyles from '@/src/ui/styles/vocabulary-reencounter.css?inline';
import translationDisplayStyles from '@/src/ui/styles/translation-display.css?inline';
import {prepareTranslationStyleRoot, subscribeTranslationStyleRoots} from '@/src/features/full-page-translation/content/styleRoots';

type AppearanceConfig = {translationAppearance: unknown};

const mocks = vi.hoisted(() => ({
    config: {translationAppearance: {} as unknown},
    listeners: new Set<(nextConfig: {translationAppearance: unknown}) => void>(),
}));

vi.mock('@/src/services/config/store', () => ({
    config: mocks.config,
    subscribeConfig: (listener: (nextConfig: AppearanceConfig) => void) => {
        mocks.listeners.add(listener);
        return () => mocks.listeners.delete(listener);
    },
}));

describe('页面公共样式与译文外观生命周期', () => {
    let invalidations: Array<() => void>;
    let invalidationListeners: Set<() => void>;
    const context = () => ({onInvalidated: (callback: () => void) => {
        invalidations.push(callback); invalidationListeners.add(callback);
        return () => invalidationListeners.delete(callback);
    }}) as never;
    const appearanceStyle = () => document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID);

    beforeEach(() => {
        vi.stubGlobal('document', parseHTML('<!doctype html><html><head></head><body><p>Source</p></body></html>').document);
        invalidations = [];
        invalidationListeners = new Set();
        mocks.listeners.clear();
        mocks.config.translationAppearance = {lineColor: '#ef4776'};
    });
    afterEach(() => {invalidations.forEach(invalidate => invalidate()); vi.unstubAllGlobals();});

    it('手动移除注销WXT失效订阅，旧清理句柄保留时也不影响新代安装', async () => {
        const {installPageStyles} = await import('@/src/app/content/pageStyles');
        const remove = installPageStyles(context());
        expect(invalidationListeners.size).toBe(1);
        const root = openRoot(); prepareTranslationStyleRoot(root);
        remove();
        expect(invalidationListeners.size).toBe(0);
        expect(root.querySelector('style[data-fr-translation-owned]')).toBeNull();
        const removeNext = installPageStyles(context());
        prepareTranslationStyleRoot(root);
        const nextStyle = root.querySelector('style[data-fr-translation-owned]');
        remove();
        expect(invalidationListeners.size).toBe(1);
        expect(root.querySelector('style[data-fr-translation-owned]')).toBe(nextStyle);
        removeNext();
        expect(invalidationListeners.size).toBe(0);
    });

    it('注册时同步失效仍撤销返回句柄，并兼容返回void的脚本端context', async () => {
        const {installPageStyles} = await import('@/src/app/content/pageStyles');
        const detach = vi.fn();
        const remove = installPageStyles({onInvalidated: (callback: () => void) => {callback(); return detach;}} as never);
        expect(detach).toHaveBeenCalledOnce();
        expect(document.getElementById('fluent-read-page-styles')).toBeNull();
        expect(mocks.listeners.size).toBe(0);
        remove(); expect(detach).toHaveBeenCalledOnce();
        const removeScript = installPageStyles({onInvalidated: () => undefined} as never);
        expect(document.getElementById('fluent-read-page-styles')).not.toBeNull();
        expect(() => removeScript()).not.toThrow();
        expect(mocks.listeners.size).toBe(0);
    });

    function openRoot(parent: Node = document.body) {
        const host = document.createElement('div');
        parent.appendChild(host);
        return host.attachShadow({mode: 'open'});
    }

    it('样式根端口仅通知开放根，覆盖嵌套边界且取消订阅后不保留回调', () => {
        const callback = vi.fn();
        const unsubscribe = subscribeTranslationStyleRoots(callback);
        const root = openRoot();
        const inner = openRoot(root);
        const content = document.createElement('p'); inner.appendChild(content);
        const closedHost = document.createElement('div'); document.body.appendChild(closedHost);
        const closed = closedHost.attachShadow({mode: 'closed'});
        prepareTranslationStyleRoot(document.body);
        prepareTranslationStyleRoot(document.createDocumentFragment());
        prepareTranslationStyleRoot(closed);
        expect(callback).not.toHaveBeenCalled();
        prepareTranslationStyleRoot(root);
        prepareTranslationStyleRoot(content);
        expect(callback.mock.calls.map(([target]) => target)).toEqual([root, inner]);
        unsubscribe(); prepareTranslationStyleRoot(root);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('按开放根复用公共CSS和外观，不覆盖同名宿主style，恢复后可原位重装', async () => {
        const {installPageStyles} = await import('@/src/app/content/pageStyles');
        installPageStyles(context());
        const root = openRoot();
        const external = document.createElement('style');
        external.id = 'fluent-read-shadow-translation-styles'; external.textContent = 'p {color: green}';
        root.appendChild(external);
        prepareTranslationStyleRoot(root); prepareTranslationStyleRoot(root);
        const own = root.querySelector<HTMLStyleElement>('style[data-fr-translation-owned="true"]')!;
        expect(own.textContent).toContain(translationDisplayStyles);
        expect(own.textContent).toContain('--fluent-read-translation-line: #ef4776 !important;');
        expect(root.querySelectorAll('style[data-fr-translation-owned="true"]')).toHaveLength(1);
        expect(external.textContent).toBe('p {color: green}');
        own.remove(); prepareTranslationStyleRoot(root);
        expect(root.querySelector('style[data-fr-translation-owned="true"]')).toBe(own);
        const [listener] = mocks.listeners;
        listener({translationAppearance: {textColor: '#1d4ed8'}});
        expect(own.textContent).toContain('color: #1d4ed8 !important;');
        expect(own.textContent).not.toContain('--fluent-read-translation-line: #ef4776');
        listener({translationAppearance: {textColor: '#1d4ed8'}});
        expect(root.querySelector('style[data-fr-translation-owned="true"]')).toBe(own);
        listener({translationAppearance: undefined});
        expect(own.textContent).toContain(translationDisplayStyles);
        expect(own.textContent).not.toContain('color: #1d4ed8 !important;');
        invalidations[0]!();
        expect(root.querySelectorAll('style')).toEqual([external]);
        expect(external.textContent).toBe('p {color: green}');
        prepareTranslationStyleRoot(root);
        expect(root.querySelectorAll('style')).toEqual([external]);
    });

    it('嵌套open各自注入，closed与其他文档不注入，停用重启没有重复或旧清理干扰', async () => {
        const {installPageStyles} = await import('@/src/app/content/pageStyles');
        const remove = installPageStyles(context());
        const outer = openRoot(), inner = openRoot(outer);
        const closedHost = document.createElement('div'); outer.appendChild(closedHost);
        const closed = closedHost.attachShadow({mode: 'closed'});
        const other = parseHTML('<html><body><div></div></body></html>').document.querySelector('div')!.attachShadow({mode:'open'});
        [outer, inner, closed, other].forEach(prepareTranslationStyleRoot);
        expect([outer, inner].map(root => root.querySelectorAll('style[data-fr-translation-owned]').length)).toEqual([1,1]);
        expect(closed.querySelector('style')).toBeNull();
        expect(other.querySelector('style')).toBeNull();
        remove();
        expect([outer,inner].map(root => root.querySelectorAll('style').length)).toEqual([0,0]);
        installPageStyles(context());
        [outer,inner].forEach(prepareTranslationStyleRoot);
        remove(); // 旧卸载句柄不应删除新代样式或外观。
        expect(appearanceStyle()).not.toBeNull();
        expect([outer,inner].map(root => root.querySelectorAll('style[data-fr-translation-owned]').length)).toEqual([1,1]);
    });

    it('直接渲染悬浮双语前也安装Shadow样式，不依赖全文会话创建观察根', async () => {
        const {installPageStyles} = await import('@/src/app/content/pageStyles');
        installPageStyles(context());
        vi.stubGlobal('Node', document.defaultView!.Node);
        const {appendBilingualTranslation} = await import('@/src/features/full-page-translation/content/renderer');
        const root = openRoot();
        const paragraph = document.createElement('p'); paragraph.textContent = 'Hover source.'; root.appendChild(paragraph);
        const skeleton = paragraph.cloneNode(false) as HTMLElement; skeleton.textContent = '悬浮译文';
        const rendered = appendBilingualTranslation(paragraph, '悬浮译文', {sourceSkeleton:skeleton,targetLanguage:'zh-Hans',style:1});
        expect(rendered.classList.contains('fluent-display-bold')).toBe(true);
        expect(root.querySelector('style[data-fr-translation-owned]')?.textContent).toContain('.fluent-display-bold');
        expect(paragraph.firstChild?.textContent).toBe('Hover source.');
        expect(rendered.parentNode).toBe(paragraph);
    });

    it('新根登记和配置更新都扫除死亡弱引用，外观不变的无限滚动也不累积登记对象', async () => {
        const refs: Array<{dead: boolean; reads: number; deref(): HTMLStyleElement | undefined}> = [];
        vi.stubGlobal('WeakRef', class {
            dead = false;
            reads = 0;
            constructor(private value: HTMLStyleElement) {refs.push(this);}
            deref() {this.reads++; return this.dead ? undefined : this.value;}
        });
        const {installPageStyles} = await import('@/src/app/content/pageStyles');
        const remove = installPageStyles(context());
        const root = openRoot(); prepareTranslationStyleRoot(root);
        refs[0]!.dead = true;
        prepareTranslationStyleRoot(openRoot());
        expect(refs[0]!.reads).toBe(1);
        prepareTranslationStyleRoot(openRoot());
        expect(refs[0]!.reads).toBe(1); // 已从登记集合移除，不会被下一次注册反复访问。
        expect(refs[1]!.reads).toBe(1);
        refs[1]!.dead = true;
        [...mocks.listeners][0]!({translationAppearance:{textColor:'#1d4ed8'}});
        expect(refs[0]!.reads).toBe(1);
        expect(refs[1]!.reads).toBe(2);
        remove();
        expect(refs[1]!.reads).toBe(2);
        expect(mocks.listeners.size).toBe(0);
        // 实际无强引用回收由 production 浏览器的 WeakRef + HeapProfiler 验证。
    });

    it('安装共享样式时同步当前外观，并随配置变化原位更新或移除外观节点', async () => {
        const {installPageStyles} = await import('@/src/app/content/pageStyles');
        installPageStyles(context());
        expect(document.querySelectorAll('#fluent-read-page-styles')).toHaveLength(1);
        expect(document.getElementById('fluent-read-page-styles')?.parentNode).toBe(document.head);
        expect(reencounterStyles).toContain('::highlight(fluentread-vocabulary-reencounter)');
        expect(document.getElementById('fluent-read-page-styles')?.textContent).toContain(reencounterStyles);
        expect(appearanceStyle()?.textContent).toContain('--fluent-read-translation-line: #ef4776 !important;');
        expect(mocks.listeners.size).toBe(1);

        const [listener] = mocks.listeners;
        listener({translationAppearance: {textColor: '#1d4ed8'}});
        expect(appearanceStyle()?.textContent).toContain('color: #1d4ed8 !important;');
        expect(appearanceStyle()?.textContent).not.toContain('--fluent-read-translation-line');
        listener({translationAppearance: undefined});
        expect(appearanceStyle()).toBeNull();
    });

    it('移除函数与 context 失效都会退订并清理两类样式，重复调用保持安全', async () => {
        const {installPageStyles} = await import('@/src/app/content/pageStyles');
        const remove = installPageStyles(context());
        remove();
        expect(document.getElementById('fluent-read-page-styles')).toBeNull();
        expect(appearanceStyle()).toBeNull();
        expect(mocks.listeners.size).toBe(0);
        expect(() => remove()).not.toThrow();

        installPageStyles(context());
        expect(appearanceStyle()).not.toBeNull();
        invalidations.at(-1)!();
        expect(document.getElementById('fluent-read-page-styles')).toBeNull();
        expect(appearanceStyle()).toBeNull();
        expect(mocks.listeners.size).toBe(0);
    });

    it('文档已有公共样式时不重复注入，也不另建外观订阅', async () => {
        const {installPageStyles} = await import('@/src/app/content/pageStyles');
        const removeFirst = installPageStyles(context());
        const removeSecond = installPageStyles(context());
        expect(document.querySelectorAll('#fluent-read-page-styles')).toHaveLength(1);
        expect(mocks.listeners.size).toBe(1);
        expect(invalidations).toHaveLength(1);
        removeSecond();
        expect(document.getElementById('fluent-read-page-styles')).not.toBeNull();
        removeFirst();
        expect(document.getElementById('fluent-read-page-styles')).toBeNull();
    });

    it('没有 head 时把公共样式挂到根元素', async () => {
        Object.defineProperty(document, 'head', {configurable: true, get: () => null});
        mocks.config.translationAppearance = undefined;
        const {installPageStyles} = await import('@/src/app/content/pageStyles');
        installPageStyles(context());
        expect(document.getElementById('fluent-read-page-styles')?.parentNode).toBe(document.documentElement);
        expect(appearanceStyle()).toBeNull();
    });
});
