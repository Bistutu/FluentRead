import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {showSectionReminder} from '@/src/features/section-translation/content/reminder';

let document: Document;
let root: ShadowRoot;
let controller: AbortController;
let translate: ReturnType<typeof vi.fn>;
let dismiss: ReturnType<typeof vi.fn>;
beforeEach(() => {
    const dom = parseHTML('<html><body><p>Keep reading.</p></body></html>');
    document = dom.document as unknown as Document;
    vi.stubGlobal('document', document);
    const attach = dom.window.Element.prototype.attachShadow;
    vi.spyOn(dom.window.Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
        root = attach.call(this, init) as unknown as ShadowRoot;
        return root;
    });
    controller = new AbortController();
    translate = vi.fn(async () => {});
    dismiss = vi.fn();
});
afterEach(() => {controller.abort(); vi.restoreAllMocks(); vi.unstubAllGlobals();});
const render = (): void => showSectionReminder({count: 2, text: key => key, translate, dismiss, signal: controller.signal});
function click(selector: string, trusted = true): void {
    const event = new document.defaultView!.Event('click', {bubbles: true});
    Object.defineProperty(event, 'isTrusted', {value: trusted});
    root.querySelector(selector)!.dispatchEvent(event);
}
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('记忆区域提醒', () => {
    it('一行提供可访问操作，不抢焦点；忽略只关闭本提醒', () => {
        render();
        const host = document.querySelector('[data-fluent-read-ui="section-reminder"]')!;
        expect(host.getAttribute('translate')).toBe('no');
        expect(root.querySelector('[role="region"]')!.getAttribute('aria-label')).toBe('sectionTranslation.picker.title');
        expect(root.querySelector('[role="status"]')!.textContent).toBe('sectionTranslation.rules.available');
        click('.fr-section-reminder-close', false);
        expect(host.isConnected).toBe(true);
        click('.fr-section-reminder-close');
        expect(dismiss).toHaveBeenCalledOnce();
        expect(translate).not.toHaveBeenCalled();
        expect(host.isConnected).toBe(false);
    });

    it('重复点击只发起一次；成功后关闭', async () => {
        let done!: () => void;
        translate.mockImplementation(() => new Promise<void>(resolve => {done = resolve;}));
        render();
        click('.fr-section-reminder-action', false);
        expect(translate).not.toHaveBeenCalled();
        click('.fr-section-reminder-action');
        click('.fr-section-reminder-action');
        expect(translate).toHaveBeenCalledOnce();
        expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
        done(); await flush();
        expect(dismiss).toHaveBeenCalledOnce();
        expect(document.querySelector('[data-fluent-read-ui]')).toBeNull();
    });

    it('失败原地保留重试，规则失效后不展示迟到错误', async () => {
        translate.mockRejectedValueOnce(new Error('provider'));
        render();
        click('.fr-section-reminder-action'); await flush();
        expect(root.querySelector('[role="status"]')!.textContent).toBe('translationCenter.requestError');
        expect((root.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
        click('.fr-section-reminder-action'); await flush();
        expect(translate).toHaveBeenCalledTimes(2);
        expect(dismiss).toHaveBeenCalledOnce();

        let fail!: (reason: Error) => void;
        translate.mockImplementation(() => new Promise((_resolve, reject) => {fail = reject;}));
        controller = new AbortController();
        render(); click('.fr-section-reminder-action'); controller.abort();
        fail(new Error('late')); await flush();
        expect(document.querySelector('[data-fluent-read-ui]')).toBeNull();
    });

    it('取消与点击关闭期间的迟到成功不再调用忽略回调，初始失效不挂载', async () => {
        controller.abort(); render();
        expect(document.querySelector('[data-fluent-read-ui]')).toBeNull();
        controller = new AbortController();
        let done!: () => void;
        translate.mockImplementation(() => new Promise<void>(resolve => {done = resolve;}));
        render(); click('.fr-section-reminder-action'); controller.abort(); done(); await flush();
        expect(dismiss).not.toHaveBeenCalled();
        controller = new AbortController();
        render(); click('.fr-section-reminder-action'); click('.fr-section-reminder-close'); done(); await flush();
        expect(dismiss).toHaveBeenCalledOnce();
    });
});
