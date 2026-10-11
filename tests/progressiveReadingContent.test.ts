import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
const mocks = vi.hoisted(() => ({create: vi.fn(), capture: vi.fn(), send: vi.fn(), translate: vi.fn(), add: vi.fn(), remove: vi.fn(), extension: {inIncognitoContext: false}, observer: vi.fn(), disconnect: vi.fn(), observe: vi.fn()}));
vi.mock('webextension-polyfill', () => ({default: {extension: mocks.extension, runtime: {sendMessage: mocks.send, onMessage: {addListener: mocks.add, removeListener: mocks.remove}}}}));
vi.mock('@/src/platform/shadow-ui', () => ({createVueShadowUi: mocks.create}));
vi.mock('@/src/features/progressive-reading/source', () => ({captureProgressiveSource: mocks.capture}));
vi.mock('@/src/app/translation/client', () => ({translateText: mocks.translate}));
vi.mock('@/src/services/config/store', () => ({config: {to: 'zh'}}));
vi.mock('@/src/features/progressive-reading/ui/ProgressiveReading.vue', () => ({default: {name: 'Panel'}}));
import {mountProgressiveReading, openProgressiveReading, unmountProgressiveReading} from '@/src/features/progressive-reading/content';
const flush = async () => {for (let i = 0; i < 10; i++) await Promise.resolve();};
const deferred = <T>() => {let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {resolve, reject, promise};};
let document: Document;
let root: Element;
let valid: boolean;
let ui: {remove: ReturnType<typeof vi.fn>; shadowHost: HTMLElement};
const props = () => mocks.create.mock.calls.at(-1)![1].props;
function mount() {const controller = new AbortController(); const ctx = {isInvalid: false}; const events = vi.spyOn(controller.signal, 'addEventListener'); mountProgressiveReading(ctx as ContentScriptContext, controller.signal); return {controller, ctx, dispose: () => {const callback = events.mock.calls.find(call => call[0] === 'abort')?.[1]; if (typeof callback === 'function') callback(new Event('abort'));}};}
beforeEach(() => {
  vi.clearAllMocks(); valid = true; mocks.extension.inIncognitoContext = false;
  document = parseHTML('<html><body><p>Some source may not apply.</p></body></html>').document as unknown as Document;
  Object.defineProperty(document, 'location', {value: {href: 'https://example.test/article'}, configurable: true});
  root = document.querySelector('p')!; vi.stubGlobal('document', document);
  vi.stubGlobal('MutationObserver', class {constructor(callback: unknown) {mocks.observer(callback);} observe = mocks.observe; disconnect = mocks.disconnect;});
  ui = {remove: vi.fn(), shadowHost: document.createElement('div')}; document.body.append(ui.shadowHost);
  mocks.create.mockResolvedValue(ui);
  mocks.capture.mockReturnValue({root, text: 'Some source may not apply.', selected: 'source', translation: '', valid: () => valid});
  mocks.send.mockResolvedValue({success: true, data: []}); mocks.translate.mockResolvedValue('完整译文');
});
afterEach(() => {unmountProgressiveReading(); vi.unstubAllGlobals();});
describe('progressive reading content lifecycle', () => {
  it('mounts only for a current activation and removes one owner on abort', async () => {
    expect(await openProgressiveReading()).toBe(false);
    const aborted = new AbortController(); aborted.abort(); mountProgressiveReading({isInvalid: false} as ContentScriptContext, aborted.signal);
    mountProgressiveReading({isInvalid: true} as ContentScriptContext, new AbortController().signal); expect(mocks.add).not.toHaveBeenCalled();
    const task = mount(); mount(); expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(await openProgressiveReading()).toBe(true); await flush(); expect(mocks.create.mock.calls[0][1].mode).toBe('closed');
    expect(props().state.source).toBe('Some source may not apply.'); expect(await openProgressiveReading()).toBe(true); expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({input: {text: 'Some source may not apply.', targetLanguage: 'zh'}}));
    await props().assistance('bilingual'); expect(mocks.translate).toHaveBeenCalledWith('Some source may not apply.', document.title, expect.objectContaining({pageContext: 'Some source may not apply.', useCache: true}));
    task.controller.abort(); task.dispose(); expect(ui.remove).toHaveBeenCalledTimes(1); expect(mocks.remove).toHaveBeenCalledTimes(1); expect(mocks.disconnect).toHaveBeenCalled();
    expect(await openProgressiveReading()).toBe(false); unmountProgressiveReading();
  });
  it('owns pending UI requests and removes late mounts after abort or close', async () => {
    const waiting = deferred<typeof ui>(); mocks.create.mockReturnValue(waiting.promise); const task = mount();
    const first = openProgressiveReading(), second = openProgressiveReading(); expect(mocks.create).toHaveBeenCalledTimes(1);
    task.controller.abort(); waiting.resolve(ui); expect(await first).toBe(false); expect(await second).toBe(false); expect(ui.remove).toHaveBeenCalledTimes(1);
    mount(); mocks.create.mockResolvedValue(ui); await openProgressiveReading(); props().close(); expect(props().state.open).toBe(false);
    await openProgressiveReading(); expect(props().state.mode).toBe('original');
  });
  it('permits original reading without selection or vocabulary, then uses an explicitly selected source', async () => {
    mocks.capture.mockReturnValue(null); const task = mount(); await openProgressiveReading(); expect(props().state.source).toBe(''); expect(mocks.send).not.toHaveBeenCalled();
    mocks.capture.mockReturnValue({root, text: 'Some source may not apply.', selected: 'source', translation: '', valid: () => valid});
    document.dispatchEvent(new document.defaultView!.Event('selectionchange')); mocks.capture.mockReturnValue(null);
    props().useSelection(); await flush(); expect(props().state.source).toBe('Some source may not apply.');
    mocks.send.mockResolvedValue({success: false}); await props().assistance('phrases'); mocks.add.mock.calls[0][0]({type: 'fluentReadVocabularyBookChanged'}); await flush(); expect(props().state.hintError).toContain('无法读取');
    const calls = mocks.send.mock.calls.length; mocks.extension.inIncognitoContext = true; mocks.add.mock.calls[0][0]({type: 'fluentReadVocabularyBookChanged'}); await flush(); expect(mocks.send).toHaveBeenCalledTimes(calls);
    task.ctx.isInvalid = true; props().useSelection(); expect(await openProgressiveReading()).toBe(false);
  });
  it('ignores unrelated mutations and changes, invalidates owner changes, and supports fresh selection', async () => {
    const task = mount(); await openProgressiveReading(); const callback = mocks.observer.mock.calls.at(-1)![0];
    mocks.add.mock.calls[0][0](null); mocks.add.mock.calls[0][0]({type: 'other'}); expect(mocks.send).toHaveBeenCalledTimes(1);
    valid = false; callback([{target: document.createElement('aside')}]); expect(props().state.source).not.toBe('');
    callback([{target: root}]); expect(props().state.source).toBe(''); expect(props().state.error).toContain('原文已变化');
    callback([{target: root}]);
    props().useSelection(); expect(props().state.source).toBe(''); valid = true; props().useSelection(); expect(props().state.source).not.toBe('');
    root.remove(); callback([{target: document.body}]); expect(props().state.source).not.toBe('');
    ui.shadowHost.remove(); callback([{target: root}]); expect(props().state.open).toBe(false);
    task.ctx.isInvalid = true; callback([{target: root}]); document.dispatchEvent(new document.defaultView!.Event('selectionchange'));
  });
  it('recovers UI creation failures and cleans up even after message ports are revoked', async () => {
    mount(); mocks.create.mockRejectedValueOnce(new Error('mount failed')); expect(await openProgressiveReading()).toBe(false);
    expect(await openProgressiveReading()).toBe(true); mocks.remove.mockImplementation(() => {throw new Error('revoked');}); unmountProgressiveReading(); expect(ui.remove).toHaveBeenCalled();
  });
  it('closes an old selected paragraph on route changes and removes the route listener on disposal', async () => {
    const task = mount(); const route = () => document.dispatchEvent(new document.defaultView!.Event('fluentread-route-change'));
    route(); await openProgressiveReading(); route(); expect(props().state.open).toBe(true);
    document.location.href += '#next'; route(); expect(props().state.open).toBe(false); expect(props().state.source).toBe('');
    await openProgressiveReading(); task.ctx.isInvalid = true; document.location.href += '-again'; route(); expect(props().state.open).toBe(true);
    unmountProgressiveReading(); const calls = ui.remove.mock.calls.length; route(); expect(ui.remove).toHaveBeenCalledTimes(calls);
    mount(); mocks.capture.mockReturnValue(null); const waiting = deferred<typeof ui>(); mocks.create.mockReturnValue(waiting.promise);
    const pending = openProgressiveReading(); document.location.href += '-pending'; route(); waiting.resolve(ui); expect(await pending).toBe(false);
  });
  it('restores prior focus and releases a disconnected UI before reopening, without letting a closed pending UI return', async () => {
    const focused = document.createElement('button'); focused.focus = vi.fn(); document.body.append(focused);
    Object.defineProperty(document, 'activeElement', {value: focused, configurable: true});
    mount(); await openProgressiveReading(); ui.shadowHost.remove(); await openProgressiveReading(); expect(focused.focus).toHaveBeenCalledWith({preventScroll: true});
    props().close(); document.dispatchEvent(new document.defaultView!.Event('selectionchange')); mocks.add.mock.calls[0][0]({type: 'fluentReadVocabularyBookChanged'});
    const waiting = deferred<typeof ui>(); mocks.create.mockReturnValue(waiting.promise); const opening = openProgressiveReading(); props().close(); waiting.resolve(ui); expect(await opening).toBe(false);
    const failing = deferred<typeof ui>(); mocks.create.mockReturnValue(failing.promise); const failed = openProgressiveReading(); props().close(); failing.reject(new Error('late failure')); expect(await failed).toBe(false);
    mocks.create.mockResolvedValue(ui); document.body.append(ui.shadowHost); await openProgressiveReading();
    ui.shadowHost.remove(); mocks.observer.mock.calls.at(-1)![0]([{target: document.body}]); expect(props().state.open).toBe(false);
  });
});
