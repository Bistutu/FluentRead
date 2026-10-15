/**
 * @file tests/materialSource.test.ts
 * 文件职责：验证材料继续阅读的来源、段落定位与页面生命周期。
 * 主要内容：覆盖 SPA 地址、个人原句不进入链接、文件指纹、重复段落、空白语境、动态恢复、界面语言提示、路由切换、隐私和卸载后的迟到响应。
 * 模块边界：使用隔离 DOM 与可控本地消息端口，不冒充真实站点、浏览器播放器或文档文件验收。
 */
import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {captureMaterialSelection, materialResumeLink} from '@/src/features/vocabulary/materialSource';
import {locateMaterialParagraph, mountMaterialContent} from '@/src/features/vocabulary/materialContent';
import {beginMaterialCapture, completeMaterialCapture} from '@/src/features/vocabulary/materialCapture';
import type {MaterialRecord} from '@/src/features/vocabulary/materialProtocol';
import {getVideoLearningSource} from '@/src/features/video-subtitle/content/public';
import {sanitizeVocabularyVideoUrl} from '@/src/features/vocabulary/source';
import {registerAllUiLanguageBundles} from '@/src/core/i18n/bundles';

const ports = vi.hoisted(() => ({resolve: vi.fn(), generation: vi.fn(), capture: vi.fn(), config: {uiLanguage: 'zh-CN' as 'zh-CN' | 'en-US'}}));
vi.mock('@/src/features/vocabulary/materialClient', () => ({materialResolve: ports.resolve, materialGeneration: ports.generation, materialCapture: ports.capture}));
vi.mock('@/src/services/config/store', () => ({config: ports.config}));
registerAllUiLanguageBundles();
const record = (overrides: Partial<MaterialRecord> = {}): MaterialRecord => ({id: 'material-1', identityKey: 'article:https://example.com/read?id=1#/chapter/2', kind: 'article', title: 'Reading', source: {kind: 'article', url: 'https://example.com/read?id=1#/chapter/2'}, locator: {kind: 'text', quote: 'unique original sentence'}, topics: [], references: [], createdAt: 1, updatedAt: 1, lastReadAt: 1, archivedAt: null, ...overrides});
const tick = async () => {await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();};
const dispose: Array<() => void> = [];
function dom(body: string, url = 'https://example.com/read?id=1&__fluentread_material=material-1#/chapter/2') {
    const {document, window} = parseHTML(`<html><head><title>Source title</title></head><body>${body}</body></html>`);
    const location = new URL(url);
    Object.defineProperty(window, 'location', {value: location, configurable: true});
    Object.defineProperty(document, 'location', {value: location, configurable: true});
    Object.defineProperty(window, 'history', {value: {state: {}, replaceState: vi.fn((_state, _title, href) => {location.href = href;})}, configurable: true});
    Object.defineProperty(window, 'requestAnimationFrame', {value: (callback: () => void) => {queueMicrotask(callback); return 1;}, configurable: true});
    Object.defineProperty(window, 'sessionStorage', {value: undefined, configurable: true});
    vi.stubGlobal('MutationObserver', window.MutationObserver);
    vi.stubGlobal('CustomEvent', window.CustomEvent);
    for (const node of document.querySelectorAll('p,video')) (node as unknown as HTMLElement).scrollIntoView = vi.fn();
    return {document: document as unknown as Document, window, location};
}
beforeEach(() => {vi.useFakeTimers(); ports.config.uiLanguage = 'zh-CN'; ports.resolve.mockReset(); ports.capture.mockReset(); ports.generation.mockReset().mockResolvedValue(3); ports.capture.mockResolvedValue(record());});
afterEach(() => {dispose.splice(0).forEach(stop => stop()); vi.useRealTimers(); vi.unstubAllGlobals();});

describe('材料来源与继续阅读', () => {
    it('空来源、文件页与缺少公共文档地址均提供恢复操作', () => {
        expect(materialResumeLink(record({source: {kind: 'article'}})).href).toBeUndefined();
        expect(materialResumeLink(record({source: {kind: 'article', url: 'file:///private/a.txt'}})).recovery).toContain('来源地址');
        expect(materialResumeLink(record({kind: 'document', source: {kind: 'document', fingerprint: 'hash'}})).href).toBeUndefined();
        expect(materialResumeLink(record({kind: 'document', source: {kind: 'document', fingerprint: 'hash'}, locator: undefined}), 'chrome-extension://id/document.html').label).toBe('继续阅读');
    });
    it('保留 SPA 路由与语义查询，个人原句不出现在继续链接', () => {
        const value = materialResumeLink(record()); const url = new URL(value.href!);
        expect(url.hash).toBe('#/chapter/2'); expect(url.searchParams.get('id')).toBe('1'); expect(url.searchParams.get('__fluentread_material')).toBe('material-1');
        expect(value.href).not.toContain('unique');
    });
    it('文档链接只包含本地标识，缺少文件指纹要求重新选择', () => {
        const doc = record({kind: 'document', source: {kind: 'document', fingerprint: 'a'.repeat(32)}, locator: {kind: 'document', page: 7}});
        expect(materialResumeLink(doc, 'chrome-extension://id/document.html')).toMatchObject({label: '继续第 7 页', href: 'chrome-extension://id/document.html?__fluentread_material=material-1'});
        expect(materialResumeLink({...doc, source: {kind: 'document'}}, 'chrome-extension://id/document.html').recovery).toContain('原文件');
    });
    it('视频时间来自原时间轴，失效或危险链接不能打开', () => {
        const video = record({kind: 'video', source: {kind: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}, locator: {kind: 'video', startMs: 12345}});
        expect(new URL(materialResumeLink(video).href!).searchParams.get('t')).toBe('12.345s');
        expect(materialResumeLink({...video, source: {kind: 'video', url: 'javascript:alert(1)'}})).toMatchObject({label: '找回来源'});
    });
    it('按语境消歧单词，支持跨行内节点的原句与两侧空白', () => {
        const {document} = dom('<p>A <strong>word</strong> followed.</p><p>Another word exists.</p>');
        expect(locateMaterialParagraph(document, {kind: 'text', quote: 'word', prefix: 'A ', suffix: ' followed.'})?.textContent).toBe('A word followed.');
    });
    it('重复原句没有上下文时不猜测；段落 ID 优先但仍核对原句', () => {
        const {document} = dom('<p id="first">same sentence</p><p id="second">same sentence</p>');
        expect(locateMaterialParagraph(document, {kind: 'text', quote: 'same sentence'})).toBeUndefined();
        expect(locateMaterialParagraph(document, {kind: 'text', quote: 'same sentence', paragraphId: 'second'})?.id).toBe('second');
        expect(locateMaterialParagraph(document, {kind: 'text', quote: 'changed', paragraphId: 'second'})).toBeUndefined();
    });
    it('相同段落重复单词可使用第二次出现的上下文，不把导航当正文', () => {
        const {document} = dom('<nav><p>word</p></nav><p>first word and second word done</p>');
        expect(locateMaterialParagraph(document, {kind: 'text', quote: 'word', prefix: 'second ', suffix: ' done'})?.textContent).toContain('second word');
    });
    it('选择快照保留语义来源和用户当前段落，不保存扩展内部页地址', () => {
        const {document} = dom('<p id="source">A word followed.</p>'); const text = document.querySelector('p')!.firstChild!;
        const range = {startContainer: text, endContainer: text, cloneRange: () => {throw new Error('stub');}} as unknown as Range;
        expect(captureMaterialSelection(range, 'word')).toMatchObject({source: {kind: 'article', url: 'https://example.com/read?id=1#/chapter/2'}, locator: {paragraphId: 'source', prefix: 'A ', suffix: ' followed.'}});
    });
    it('文档选择使用内容指纹和页号，不使用随机渲染身份', () => {
        const {document} = dom('<div data-fluentread-material-fingerprint="hash-content" data-fluentread-material-title="Paper"><article data-page-number="4"><p>original text</p></article></div>', 'chrome-extension://id/document.html');
        const text = document.querySelector('p')!.firstChild!;
        expect(captureMaterialSelection({startContainer: text, endContainer: text} as unknown as Range, 'original')).toMatchObject({source: {kind: 'document', fingerprint: 'hash-content'}, locator: {page: 4}});
    });
    it.each(['data-pdf-page-number', 'data-pdf-reading-page'])('真实 PDF 文字层的 %s 页号与重排文字共用位置合同', attribute => {
        const {document} = dom(`<div data-fluentread-material-fingerprint="hash"><div ${attribute}="3"><p>third page</p></div></div>`, 'chrome-extension://id/document.html'); const node = document.querySelector('p')!;
        expect(captureMaterialSelection({startContainer: node, endContainer: node} as unknown as Range, 'third page')?.locator?.page).toBe(3);
    });
    it('来源文字层没有页号时使用组合根当前页和带格式的章节', () => {
        const {document} = dom('<div data-fluentread-material-fingerprint="hash" data-fluentread-material-page="2" data-fluentread-material-section="docx:1"><p>selected text</p></div>', 'chrome-extension://id/document.html'); const node = document.querySelector('p')!;
        expect(captureMaterialSelection({startContainer: node, endContainer: node} as unknown as Range, 'selected text')?.locator).toMatchObject({page: 2, section: 'docx:1'});
    });
    it('丢失选区、无Document、不可恢复的内部页面及无原句定位均安全降级', () => {
        expect(captureMaterialSelection({startContainer: {isConnected: false}, endContainer: {isConnected: true}} as unknown as Range, 'a')).toBeUndefined();
        expect(captureMaterialSelection({startContainer: {isConnected: true, nodeType: 1}, endContainer: {isConnected: true}} as unknown as Range, 'a')).toBeUndefined();
        const {document} = dom('<span id="inside">some <b>word</b></span>', 'chrome-extension://id/document.html'); const node = document.querySelector('b')!;
        expect(captureMaterialSelection({startContainer: node, endContainer: node} as unknown as Range, 'word')).toBeUndefined();
        expect(locateMaterialParagraph(document, {kind: 'text'})).toBeUndefined();
        expect(mountMaterialContent({defaultView: null} as Document, new AbortController().signal, () => true)()).toBeUndefined();
    });
    it('完整选区偏移和缺少上下文的选区均不猜测正文，文档无页号与可选来源仍保留指纹', () => {
        const {document} = dom('<p>word first; word second</p>'); const node = document.querySelector('p')!;
        const cloned = {selectNodeContents() {}, setEnd() {}, toString: () => 'word first; '};
        expect(captureMaterialSelection({startContainer: node, endContainer: node, startOffset: 12, cloneRange: () => cloned} as unknown as Range, 'word')?.locator?.prefix).toBe('word first; ');
        expect(captureMaterialSelection({startContainer: node, endContainer: node} as unknown as Range, 'absent')?.locator?.prefix).toBeUndefined();
        node.setAttribute('data-fluentread-material-fingerprint', 'hash'); node.setAttribute('data-fluentread-material-source', 'https://example.com/p.pdf'); node.setAttribute('data-fluentread-material-section', 'epub:2');
        expect(captureMaterialSelection({startContainer: node, endContainer: node} as unknown as Range, 'word')).toMatchObject({source: {url: 'https://example.com/p.pdf'}, locator: {section: 'epub:2'}});
    });
    it('恢复时移除内部参数，滚动到核对的原文', async () => {
        const {document, location} = dom('<p>unique original sentence</p>'); ports.resolve.mockResolvedValue(record());
        dispose.push(mountMaterialContent(document, new AbortController().signal, () => true)); await tick();
        expect(location.search).toBe('?id=1'); expect(document.querySelector('p')!.scrollIntoView).toHaveBeenCalledOnce();
    });
    it('位置无法匹配有明确恢复说明；不存在的材料立即提示', async () => {
        const {document, location, window} = dom('<p>new content</p>'); ports.resolve.mockResolvedValue(record());
        dispose.push(mountMaterialContent(document, new AbortController().signal, () => true)); await tick(); await vi.advanceTimersByTimeAsync(8000);
        expect(document.querySelector('[role="status"]')?.textContent).toContain('原段落已变化');
        location.pathname = '/changed'; window.dispatchEvent(new window.Event('popstate')); expect(document.querySelector('[role="status"]')).toBeNull();
        ports.resolve.mockResolvedValue(null); const other = dom(''); dispose.push(mountMaterialContent(other.document, new AbortController().signal, () => true)); await tick();
        expect(other.document.querySelector('[role="status"]')?.textContent).toContain('材料已移除');
    });
    it.each([
        ['article', 'The paragraph changed or cannot be uniquely located. The material and quote are kept. Search the page for the quote or update the source in your learning materials.'],
        ['video', 'Could not restore the video position. Check that the original video still plays, then reopen it from your learning materials.'],
        ['missing', 'The material was removed, the source does not match, or privacy settings block access. Check the source in the learning workspace and reopen it.'],
    ] as const)('%s 原生恢复提示及关闭按钮使用实际 en-US 资源', async (kind, message) => {
        const {document} = dom(kind === 'video' ? '<video></video>' : '<p>Changed content</p>');
        const value = kind === 'video' ? record({kind: 'video', identityKey: 'video:https://example.com/read?id=1#/chapter/2',
            source: {kind: 'video', url: 'https://example.com/read?id=1#/chapter/2'}, locator: {kind: 'video', startMs: 5000}}) : record();
        ports.resolve.mockResolvedValue(kind === 'missing' ? null : value);
        dispose.push(mountMaterialContent(document, new AbortController().signal, () => true));
        // 提示在异步读取或等待结束时读取当前语言，不冻结挂载时的中文配置。
        ports.config.uiLanguage = 'en-US'; await tick(); await vi.advanceTimersByTimeAsync(8000);
        const notice = document.querySelector('[role="status"]')!;
        expect(notice.querySelector('span')?.textContent).toBe(message);
        expect(notice.querySelector('button')?.textContent).toBe('Close');
        notice.querySelector('button')!.click(); expect(document.querySelector('[role="status"]')).toBeNull();
    });
    it('取消挂载后忽略迟到读取与错误，不插入恢复提示', async () => {
        const {document} = dom(''); let resolve!: (value: MaterialRecord) => void; ports.resolve.mockReturnValue(new Promise(done => {resolve = done;}));
        const controller = new AbortController(); mountMaterialContent(document, controller.signal, () => true); controller.abort(); resolve(record()); await tick(); await vi.advanceTimersByTimeAsync(9000);
        expect(document.querySelector('[role="status"]')).toBeNull();
    });
    it('禁用页面、启动前已取消以及读取错误不会留下监听提示，错误提示可关闭', async () => {
        const one = dom(''); ports.resolve.mockRejectedValue(new Error('storage'));
        dispose.push(mountMaterialContent(one.document, new AbortController().signal, () => false)); await tick();
        expect(one.document.querySelector('[role="status"]')).toBeNull();
        const controller = new AbortController(); controller.abort(); const two = dom(''); mountMaterialContent(two.document, controller.signal, () => true); await tick();
        expect(two.document.querySelector('[role="status"]')).toBeNull();
        const three = dom(''); dispose.push(mountMaterialContent(three.document, new AbortController().signal, () => true)); await tick();
        three.document.querySelector('button')!.click(); expect(three.document.querySelector('[role="status"]')).toBeNull();
    });
    it('动态原文出现时恢复，普通锚点保留归属，SPA 路由变化撤销等待', async () => {
        const {document, location, window} = dom('<div></div>'); ports.resolve.mockResolvedValue(record());
        dispose.push(mountMaterialContent(document, new AbortController().signal, () => true)); await tick();
        const paragraph = document.createElement('p'); paragraph.textContent = 'unique original sentence'; paragraph.scrollIntoView = vi.fn(); paragraph.animate = vi.fn(); document.body.append(paragraph); await tick();
        expect(paragraph.scrollIntoView).toHaveBeenCalledOnce(); expect(paragraph.animate).toHaveBeenCalledOnce();
        location.hash = '#/other'; window.dispatchEvent(new window.Event('hashchange')); document.dispatchEvent(new window.Event('scroll')); await vi.advanceTimersByTimeAsync(9000);
        expect(document.querySelector('[role="status"]')).toBeNull(); expect(ports.capture).not.toHaveBeenCalled();
    });
    it('等待恢复期间切换SPA页面，动态更新和错误不会再滚动或弹提示', async () => {
        const {document, location} = dom('<div></div>'); ports.resolve.mockResolvedValue(record());
        dispose.push(mountMaterialContent(document, new AbortController().signal, () => true)); await tick(); location.pathname = '/new';
        document.body.append(document.createElement('p')); await tick(); await vi.advanceTimersByTimeAsync(9000);
        expect(document.querySelector('[role="status"]')).toBeNull();
    });
    it('恢复已存文章后滚动更新有界可见段落，无内容不写；清理后不监听', async () => {
        const {document, window} = dom('<p id="first">A sufficiently long original paragraph.</p><p id="next">A second sufficiently long paragraph.</p>');
        ports.resolve.mockResolvedValue(record({locator: undefined}));
        for (const node of document.querySelectorAll('p')) node.getBoundingClientRect = () => ({top: 20, bottom: 80}) as DOMRect;
        Object.defineProperty(window, 'innerHeight', {value: 600, configurable: true});
        const stop = mountMaterialContent(document, new AbortController().signal, () => true); dispose.push(stop); await tick();
        document.dispatchEvent(new window.Event('scroll')); await vi.advanceTimersByTimeAsync(1200);
        expect(ports.capture).toHaveBeenCalledWith(expect.objectContaining({positionOnly: true, locator: {kind: 'text', quote: 'A sufficiently long original paragraph.', paragraphId: 'first'}}));
        ports.capture.mockClear(); document.dispatchEvent(new window.Event('scroll')); await vi.advanceTimersByTimeAsync(1200); expect(ports.capture).not.toHaveBeenCalled();
        stop(); document.dispatchEvent(new window.Event('scroll')); await vi.advanceTimersByTimeAsync(1200); expect(ports.capture).not.toHaveBeenCalled();
    });
    it('捕获事件仅解析本地标识，空位置与文档来源不自动新增，空页面不写', async () => {
        const {document, window} = dom('', 'https://example.com/read?id=1#/chapter/2');
        ports.resolve.mockResolvedValue(record({kind: 'document', locator: undefined})); dispose.push(mountMaterialContent(document, new AbortController().signal, () => true));
        document.dispatchEvent(new window.CustomEvent('fluentread-material-captured', {detail: {id: 'forged'}})); expect(ports.resolve).not.toHaveBeenCalled();
        document.dispatchEvent(new window.CustomEvent('fluentread-material-captured', {detail: 'material-1'})); await tick(); window.dispatchEvent(new window.Event('pagehide')); await tick(); expect(ports.capture).not.toHaveBeenCalled();
        ports.resolve.mockResolvedValue(record({locator: undefined})); document.dispatchEvent(new window.CustomEvent('fluentread-material-captured', {detail: 'material-1'})); await tick();
        window.dispatchEvent(new window.Event('pagehide')); await tick(); expect(ports.capture).not.toHaveBeenCalled();
    });
    it('SPA 切换后媒体就绪不 seek 新视频，卸载后不再处理进度', async () => {
        const {document, location, window} = dom('<video></video>', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&__fluentread_material=material-1'); const video = document.querySelector('video')!;
        Object.defineProperties(video, {readyState: {value: 0, configurable: true}, duration: {value: 100, configurable: true}, currentTime: {value: 0, writable: true}}); video.pause = vi.fn();
        ports.resolve.mockResolvedValue(record({kind: 'video', identityKey: 'video:youtube:dQw4w9WgXcQ', source: {kind: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}, locator: {kind: 'video', startMs: 12000}}));
        const controller = new AbortController(); mountMaterialContent(document, controller.signal, () => true); await tick();
        location.pathname = '/other'; Object.defineProperty(video, 'readyState', {value: 1}); video.dispatchEvent(new window.Event('loadedmetadata', {bubbles: true}));
        expect(video.currentTime).toBe(0); controller.abort(); video.dispatchEvent(new window.Event('timeupdate', {bubbles: true})); await tick(); expect(ports.capture).not.toHaveBeenCalled();
    });
    it('视频 timeupdate 节流保存，换路由停止写入', async () => {
        const {document, location, window} = dom('<video></video>', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&__fluentread_material=material-1'); const video = document.querySelector('video')!;
        Object.defineProperties(video, {readyState: {value: 1}, duration: {value: 100}, currentTime: {value: 20, writable: true}}); video.pause = vi.fn();
        ports.resolve.mockResolvedValue(record({kind: 'video', identityKey: 'video:youtube:dQw4w9WgXcQ', source: {kind: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}, locator: {kind: 'video', startMs: 12000}}));
        dispose.push(mountMaterialContent(document, new AbortController().signal, () => true)); await tick(); video.currentTime = 30;
        expect(location.hostname).toBe('www.youtube.com');
        expect(location.href).toContain('v=dQw4w9WgXcQ');
        expect(location.pathname).toBe('/watch');
        expect(sanitizeVocabularyVideoUrl(location.href, 'youtube')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        expect(getVideoLearningSource(video, location as unknown as Location, document).sourceUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        video.dispatchEvent(new window.Event('timeupdate', {bubbles: true})); await tick();
        expect(ports.capture).toHaveBeenCalledWith(expect.objectContaining({positionOnly: true, locator: {kind: 'video', startMs: 30000}}));
        ports.capture.mockClear(); location.pathname = '/another'; await vi.advanceTimersByTimeAsync(6000); video.dispatchEvent(new window.Event('timeupdate', {bubbles: true})); await tick(); expect(ports.capture).not.toHaveBeenCalled();
    });
    it('视频元数据迟到仅恢复一次，同来源双媒体不猜测并提供恢复说明', async () => {
        const {document, window} = dom('<video></video>', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&__fluentread_material=material-1'); const video = document.querySelector('video')!;
        const value = record({kind: 'video', identityKey: 'video:youtube:dQw4w9WgXcQ', source: {kind: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}, locator: {kind: 'video', startMs: 12000}});
        Object.defineProperties(video, {readyState: {value: 0, writable: true}, duration: {value: 100, writable: true}, currentTime: {value: 0, writable: true}}); video.pause = vi.fn();
        ports.resolve.mockResolvedValue(value); dispose.push(mountMaterialContent(document, new AbortController().signal, () => true)); await tick();
        Object.defineProperty(video, 'readyState', {value: 1}); video.dispatchEvent(new window.Event('loadedmetadata', {bubbles: true})); expect(video.currentTime).toBe(12);
        video.currentTime = 20; video.dispatchEvent(new window.Event('loadedmetadata', {bubbles: true})); expect(video.currentTime).toBe(20);
        video.dispatchEvent(new window.Event('timeupdate', {bubbles: true})); await tick(); ports.capture.mockClear(); video.dispatchEvent(new window.Event('timeupdate', {bubbles: true})); await tick(); expect(ports.capture).not.toHaveBeenCalled();
        const other = dom('<video></video><video></video>', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&__fluentread_material=material-1');
        for (const media of other.document.querySelectorAll('video')) Object.defineProperty(media, 'readyState', {value: 1});
        dispose.push(mountMaterialContent(other.document, new AbortController().signal, () => true)); await tick(); await vi.advanceTimersByTimeAsync(8000);
        expect(other.document.querySelector('[role="status"]')?.textContent).toContain('未能恢复视频时间');
    });
    it('存储失败与清空拒绝可恢复，禁用后的进度不写入材料', async () => {
        const {document, window} = dom('<p></p><p>This is a long enough source paragraph.</p>'); const paragraph = document.querySelectorAll('p')[1]!;
        document.querySelector('p')!.getBoundingClientRect = () => ({top: 1, bottom: 2}) as DOMRect;
        paragraph.getBoundingClientRect = () => ({top: 1, bottom: 30}) as DOMRect; Object.defineProperty(window, 'innerHeight', {value: 600, configurable: true});
        let enabled = true; ports.resolve.mockResolvedValue(record({locator: undefined})); dispose.push(mountMaterialContent(document, new AbortController().signal, () => enabled)); await tick();
        ports.capture.mockRejectedValueOnce(new Error('cleared')); window.dispatchEvent(new window.Event('pagehide')); await tick(); expect(ports.capture).toHaveBeenCalledOnce();
        ports.capture.mockClear(); enabled = false; window.dispatchEvent(new window.Event('pagehide')); await tick(); expect(ports.capture).not.toHaveBeenCalled();
    });
    it('隐私、已取消及代次失败不关联；引用只保存定位信息', async () => {
        expect(await beginMaterialCapture(record(), true)).toBeUndefined(); expect(ports.generation).not.toHaveBeenCalled();
        const operation = await beginMaterialCapture({source: record().source, locator: record().locator}, false);
        expect(await completeMaterialCapture(operation, {kind: 'session', id: 'session-1', excerpt: 'word'}, () => false)).toBe(false);
        expect(ports.capture).not.toHaveBeenCalled();
        expect(await completeMaterialCapture(operation, {kind: 'session', id: 'session-1', excerpt: 'word'})).toBe(true);
        expect(ports.capture.mock.calls[0][0].reference).toEqual({kind: 'session', id: 'session-1', excerpt: 'word'});
    });
    it('采集启动时间在generation前冻结，旧A迟到完成不会冒充B的新位置', async () => {
        let release!: (value: number) => void;
        ports.generation.mockReturnValueOnce(new Promise(done => {release = done;})); vi.setSystemTime(10000);
        const a = beginMaterialCapture({source: record().source, locator: {kind: 'text', quote: 'A'}}, false);
        vi.setSystemTime(20000); const b = await beginMaterialCapture({source: record().source, locator: {kind: 'text', quote: 'B'}}, false);
        await completeMaterialCapture(b, {kind: 'session', id: 'B'}); release(3); await completeMaterialCapture(await a, {kind: 'session', id: 'A'});
        expect(ports.capture.mock.calls.map(call => call[0].capturedAt)).toEqual([20000, 10000]);
    });
    it('采集失败与已经失效的完成不广播，成功只广播本地标识', async () => {
        const {document} = dom(''); vi.stubGlobal('document', document); const listener = vi.fn(); document.addEventListener('fluentread-material-captured', listener);
        const operation = await beginMaterialCapture({source: record().source}, false);
        await completeMaterialCapture(operation, {kind: 'vocabulary', id: 'word-1'}); expect(listener).toHaveBeenCalledOnce();
        ports.capture.mockRejectedValueOnce(new Error('stale')); expect(await completeMaterialCapture(operation, {kind: 'session', id: 'old'})).toBe(false);
        expect(await completeMaterialCapture(undefined, {kind: 'session', id: 'none'})).toBe(false);
        ports.generation.mockRejectedValueOnce(new Error('private')); expect(await beginMaterialCapture({source: record().source}, false)).toBeUndefined();
        expect(await beginMaterialCapture(undefined, false)).toBeUndefined();
    });
    it('原句采集接受元素边界并处理空段落、断开的结束点与无父节点文本', () => {
        const {document} = dom('<div><span></span></div><p></p><ul><li>nested <p>matching quote</p></li></ul>'); const span = document.querySelector('span')!;
        expect(captureMaterialSelection({startContainer: span, endContainer: span} as unknown as Range, 'unknown')).toMatchObject({locator: {kind: 'text', quote: 'unknown'}});
        expect(locateMaterialParagraph(document, {kind: 'text', quote: 'matching quote'})?.tagName).toBe('LI');
        expect(captureMaterialSelection({startContainer: span, endContainer: {isConnected: false}} as unknown as Range, 'a')).toBeUndefined();
        expect(captureMaterialSelection({startContainer: {isConnected: true, nodeType: 3, ownerDocument: document, parentElement: null}, endContainer: span} as unknown as Range, 'a')).toBeUndefined();
    });
    it('同页面通用视频可恢复，未知时长、无法seek与无来源媒体保留恢复提示', async () => {
        const {document, window} = dom('<video></video>', 'https://example.com/video?__fluentread_material=material-1'); const video = document.querySelector('video')!;
        const value = record({kind: 'video', identityKey: 'video:https://example.com/video', source: {kind: 'video', url: 'https://example.com/video'}, locator: {kind: 'video'}});
        Object.defineProperties(video, {readyState: {value: 1}, duration: {value: 100, writable: true}, currentTime: {value: 30, writable: true}}); video.pause = vi.fn();
        ports.resolve.mockResolvedValue(value); dispose.push(mountMaterialContent(document, new AbortController().signal, () => true)); await tick(); expect(video.currentTime).toBe(0);
        video.currentTime = 5; window.dispatchEvent(new window.Event('pagehide')); await tick(); expect(ports.capture).toHaveBeenCalledWith(expect.objectContaining({locator: {kind: 'video', startMs: 5000}}));
        const fail = dom('<video></video>', 'https://example.com/video?__fluentread_material=material-1'); const media = fail.document.querySelector('video')!;
        Object.defineProperties(media, {readyState: {value: 1}, duration: {value: Number.NaN, writable: true}, currentTime: {value: 0, writable: true}}); media.pause = vi.fn(() => {throw new Error('seek blocked');});
        dispose.push(mountMaterialContent(fail.document, new AbortController().signal, () => true)); await tick(); Object.defineProperty(media, 'duration', {value: 100}); media.dispatchEvent(new fail.window.Event('loadedmetadata', {bubbles: true}));
        await vi.advanceTimersByTimeAsync(8000); expect(fail.document.querySelector('[role="status"]')?.textContent).toContain('未能恢复视频时间');
    });
    it('X feed保存采用实际媒体status来源，pushState换页后不写入旧材料', async () => {
        const {document, window, location} = dom('<article><a href="/user/status/123">date</a><video></video></article>', 'https://x.com/home?__fluentread_material=material-1'); const video = document.querySelector('video')!;
        Object.defineProperties(video, {readyState: {value: 1}, duration: {value: 100}, currentTime: {value: 20, writable: true}}); video.pause = vi.fn();
        ports.resolve.mockResolvedValue(record({kind: 'video', identityKey: 'video:x:123', source: {kind: 'video', url: 'https://x.com/user/status/123'}, locator: {kind: 'video', startMs: 5000}}));
        dispose.push(mountMaterialContent(document, new AbortController().signal, () => true)); await tick(); video.currentTime = 25;
        window.dispatchEvent(new window.Event('pagehide')); await tick();
        expect(ports.capture).toHaveBeenCalledWith(expect.objectContaining({source: {kind: 'video', url: 'https://x.com/user/status/123'}, locator: {kind: 'video', startMs: 25000}}));
        ports.capture.mockClear(); location.pathname = '/user/status/456'; video.currentTime = 30; window.dispatchEvent(new window.Event('pagehide')); await tick(); expect(ports.capture).not.toHaveBeenCalled();
    });
    it('动态页面多次突变按一帧恢复，过期frame不产生滚动', async () => {
        const {document, window} = dom('<div></div>'); const frames: Array<() => void> = [];
        Object.defineProperty(window, 'requestAnimationFrame', {value: (callback: () => void) => {frames.push(callback); return 1;}, configurable: true});
        ports.resolve.mockResolvedValue(record()); const controller = new AbortController(); mountMaterialContent(document, controller.signal, () => true); await tick();
        document.body.append(document.createElement('p')); await tick(); document.body.append(document.createElement('p')); await tick();
        expect(frames).toHaveLength(1); controller.abort(); frames[0]();
        expect(document.querySelector('[role="status"]')).toBeNull();
    });
    it('通用播放器坏来源或已改成专用平台时拒绝复用，空媒体页不猜测', async () => {
        for (const source of [{kind: 'video' as const}, {kind: 'video' as const, url: 'bad url'}, {kind: 'video' as const, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}]) {
            const {document} = dom('<video></video>', 'https://example.com/video?__fluentread_material=material-1'); const video = document.querySelector('video')!;
            Object.defineProperties(video, {readyState: {value: 1}, duration: {value: 100}, currentTime: {value: 0, writable: true}}); video.pause = vi.fn();
            ports.resolve.mockResolvedValue(record({kind: 'video', identityKey: 'video:https://example.com/video', source, locator: {kind: 'video'}}));
            dispose.push(mountMaterialContent(document, new AbortController().signal, () => true)); await tick();
            if (source.url) expect(video.pause).not.toHaveBeenCalled();
        }
    });
    it('刷新仅用当前标签页的材料标识重新核对来源，归档或清空后删除标识', async () => {
        const {document, window} = dom('<p>unique original sentence</p>'); const values = new Map<string, string>();
        const storage = {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key)};
        Object.defineProperty(window, 'sessionStorage', {value: storage, configurable: true}); ports.resolve.mockResolvedValue(record());
        const first = mountMaterialContent(document, new AbortController().signal, () => true); await tick(); first();
        const marker = JSON.parse(values.get('fluentread.material.resume')!); expect(Object.keys(marker).sort()).toEqual(['id', 'url']); expect(marker.id).toBe('material-1');
        ports.resolve.mockClear(); const refresh = mountMaterialContent(document, new AbortController().signal, () => true); await tick();
        expect(ports.resolve).toHaveBeenCalledWith('material-1'); expect(document.querySelector('p')!.scrollIntoView).toHaveBeenCalledTimes(2); refresh();
        ports.resolve.mockResolvedValue(null); dispose.push(mountMaterialContent(document, new AbortController().signal, () => true)); await tick(); expect(values.size).toBe(0);
    });
    it.each(['{"id":"material-1","url":"https://other.example/"}', '{bad', 'null', '{"id":"","url":"https://example.com/read?id=1#/chapter/2"}'])('损坏或跨来源会话标识安全清理：%s', marker => {
        const {document, window} = dom('', 'https://example.com/read?id=1#/chapter/2'); const removeItem = vi.fn();
        Object.defineProperty(window, 'sessionStorage', {value: {getItem: () => marker, removeItem}, configurable: true});
        dispose.push(mountMaterialContent(document, new AbortController().signal, () => true)); expect(removeItem).toHaveBeenCalledOnce(); expect(ports.resolve).not.toHaveBeenCalled();
    });
    it('会话存储禁用不阻断参数恢复或错误提示，换来源时删除会话标识', async () => {
        const {document, window, location} = dom('<p>unique original sentence</p>');
        const blocked = {getItem() {throw new Error('blocked');}, setItem() {throw new Error('blocked');}, removeItem() {throw new Error('blocked');}};
        Object.defineProperty(window, 'sessionStorage', {value: blocked, configurable: true}); ports.resolve.mockResolvedValue(record());
        const stop = mountMaterialContent(document, new AbortController().signal, () => true); await tick(); expect(document.querySelector('p')!.scrollIntoView).toHaveBeenCalledOnce();
        location.pathname = '/elsewhere'; window.dispatchEvent(new window.Event('popstate')); stop();
        dispose.push(mountMaterialContent(document, new AbortController().signal, () => true)); expect(ports.resolve).toHaveBeenCalledOnce();
    });
});
