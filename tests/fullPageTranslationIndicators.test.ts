import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import type {CompositeTranslationProvider} from '@/src/core/config/compositeTranslation';

const mocks = vi.hoisted(() => ({
  config: {animations: true, translationLoadingStyle: 'minimal', service: 'deepseek', customOpenAIProviders: [] as Array<{
    id: string;
    name: string;
    endpoint: string;
    models: string[];
  }>, compositeTranslationProviders: [] as CompositeTranslationProvider[]},
  showPageNotice: vi.fn(),
}));

vi.mock('@/src/services/config/store', () => ({config: mocks.config}));
vi.mock('@/src/core/config/catalog', () => ({
  options: {services: [{value: 'deepseek', label: 'DeepSeek'}]},
}));
vi.mock('@/src/features/page-notice/public', () => ({showPageNotice: mocks.showPageNotice}));

import {
  insertFailedTip,
  insertLoadingSpinner,
} from '@/src/features/full-page-translation/ui/translationIndicators';
import {scheduleTranslationLoadingIndicator} from '@/src/features/full-page-translation/content/loadingIndicator';
import {beginTranslation, getTranslationState, restoreTranslation, markTranslationComplete} from '@/src/features/full-page-translation/content/state';

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

describe('延迟全文 loading', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  const start = () => {
    const node = document.querySelector<HTMLElement>('#target')!;
    return {node, ...beginTranslation(node, 'bilingual')!};
  };

  it('快请求取消展示不写宿主 DOM；慢请求只显示一次并能正常恢复', () => {
    const {node, state} = start();
    const cancel = scheduleTranslationLoadingIndicator(node, state, true);
    vi.advanceTimersByTime(179);
    expect(node.querySelector('.fluent-read-loading')).toBeNull();
    cancel(); cancel();
    vi.advanceTimersByTime(500);
    expect(node.innerHTML).toBe('Source');
    const cleanup = scheduleTranslationLoadingIndicator(node, state, true);
    vi.advanceTimersByTime(180);
    expect(state.spinner?.isConnected).toBe(true);
    cleanup();
    vi.advanceTimersByTime(500);
    expect(node.querySelectorAll('.fluent-read-loading')).toHaveLength(1);
    restoreTranslation(node);
    expect(node.innerHTML).toBe('Source');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('悬浮即时显示，已经取消的请求没有计时器或 DOM 写入', () => {
    const {node, state} = start();
    scheduleTranslationLoadingIndicator(node, state, false)();
    expect(state.spinner?.isConnected).toBe(true);
    restoreTranslation(node);
    scheduleTranslationLoadingIndicator(node, state, true)();
    expect(node.innerHTML).toBe('Source');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['abort', 'detached', 'replaced', 'settled'] as const)('迟到回调不影响 %s 的 generation', reason => {
    const {node, state, generation} = start();
    scheduleTranslationLoadingIndicator(node, state, true);
    if (reason === 'abort') {
      // 已排入任务队列的回调可能赶上取消；即使 clearTimeout 无效也必须二次核对。
      vi.spyOn(window, 'clearTimeout').mockImplementation(() => {});
      state.controller.abort();
    } else if (reason === 'detached') node.remove();
    else if (reason === 'replaced') restoreTranslation(node);
    else markTranslationComplete(node, state, generation);
    vi.advanceTimersByTime(180);
    expect(node.querySelector('.fluent-read-loading')).toBeNull();
    if (getTranslationState(node)) restoreTranslation(node);
  });
});

function dispatchCancelableClick(target: Element): Event {
  const EventConstructor = (window as unknown as {Event: typeof Event}).Event;
  const event = new EventConstructor('click', {bubbles: true, cancelable: true});
  target.dispatchEvent(event);
  return event;
}

function dispatchActionKey(target: Element, key: 'Enter' | ' '): Event {
  const EventConstructor = (window as unknown as {Event: typeof Event}).Event;
  const event = new EventConstructor('keydown', {bubbles: true, cancelable: true});
  Object.defineProperty(event, 'key', {value: key});
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  const {document, window} = parseHTML('<html><body><p id="target">Source</p></body></html>');
  Object.defineProperty(globalThis, 'document', {value: document, configurable: true});
  Object.defineProperty(globalThis, 'window', {value: window, configurable: true});
  mocks.config.animations = true;
  mocks.config.translationLoadingStyle = 'minimal';
  mocks.config.service = 'deepseek';
  mocks.config.customOpenAIProviders = [];
  mocks.config.compositeTranslationProviders = [];
  mocks.showPageNotice.mockReset();
});

afterEach(() => {
  Object.defineProperty(globalThis, 'document', {value: originalDocument, configurable: true});
  Object.defineProperty(globalThis, 'window', {value: originalWindow, configurable: true});
});

describe('全文翻译节点状态指示', () => {
  it.each([true, false])('受控重试返回 %s 时保留反馈，交由 runtime 排队与清理', accepted => {
    const target = document.getElementById('target')!;
    const retry = vi.fn(() => accepted);
    const wrapper = insertFailedTip(target, 'provider unavailable', retry);
    wrapper.querySelector<HTMLElement>('.fluent-read-retry')!.click();
    expect(retry).toHaveBeenCalledOnce();
    expect(wrapper.isConnected).toBe(true);
    expect(target.getAttribute('data-fr-translation-failed')).toBe('true');
  });
  it('失败节点可查看经过归类的原因，并安全重试', () => {
    const target = document.getElementById('target')!;
    const retry = vi.fn();

    const wrapper = insertFailedTip(target, 'quota exceeded', retry);

    expect(target.getAttribute('data-fr-translation-failed')).toBe('true');
    expect(target.hasAttribute('class')).toBe(false);
    expect(wrapper.getAttribute('data-fr-translation-owned')).toBe('true');
    expect(wrapper.querySelectorAll('svg')).toHaveLength(2);
    wrapper.querySelector<HTMLElement>('.fluent-read-reason')!.click();
    expect(mocks.showPageNotice).toHaveBeenCalledWith(
      '你的请求频率过高，被【DeepSeek】拒绝了，请稍后再试吧~',
      'error',
    );

    wrapper.querySelector<HTMLElement>('.fluent-read-retry')!.click();
    expect(retry).toHaveBeenCalledOnce();
    expect(wrapper.isConnected).toBe(false);
    expect(target.hasAttribute('data-fr-translation-failed')).toBe(false);
    expect(target.hasAttribute('class')).toBe(false);
  });

  it('链接翻译失败时，错误图标和控件空白处只显示提示而不触发原链接', () => {
    document.body.innerHTML = '<a id="target" href="https://example.com/destination">Source</a>';
    const target = document.getElementById('target')!;
    const hostLinkClick = vi.fn();
    target.addEventListener('click', hostLinkClick);

    const wrapper = insertFailedTip(target, 'quota exceeded', vi.fn());
    const reason = wrapper.querySelector<HTMLElement>('.fluent-read-reason')!;
    const reasonIcon = reason.querySelector('svg')!;

    const iconClick = dispatchCancelableClick(reasonIcon);
    const wrapperClick = dispatchCancelableClick(wrapper);

    expect(reason.getAttribute('role')).toBeNull();
    expect(reason.getAttribute('tabindex')).toBeNull();
    expect(iconClick.defaultPrevented).toBe(true);
    expect(wrapperClick.defaultPrevented).toBe(true);
    expect(hostLinkClick).not.toHaveBeenCalled();
    expect(mocks.showPageNotice).toHaveBeenCalledOnce();
  });

  it('链接翻译失败时，点击重试图标不会触发原链接', () => {
    document.body.innerHTML = '<a id="target" href="https://example.com/destination">Source</a>';
    const target = document.getElementById('target')!;
    const hostLinkClick = vi.fn();
    const retry = vi.fn();
    target.addEventListener('click', hostLinkClick);

    const wrapper = insertFailedTip(target, 'provider unavailable', retry);
    const retryAction = wrapper.querySelector<HTMLElement>('.fluent-read-retry')!;
    const retryIcon = retryAction.querySelector('svg')!;
    const iconClick = dispatchCancelableClick(retryIcon);

    expect(retryAction.getAttribute('role')).toBeNull();
    expect(retryAction.getAttribute('tabindex')).toBeNull();
    expect(iconClick.defaultPrevented).toBe(true);
    expect(hostLinkClick).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
    expect(wrapper.isConnected).toBe(false);
  });

  it('交互宿主内不创建嵌套的可聚焦按钮语义', () => {
    document.body.innerHTML = '<button id="target" type="button">Source</button>';
    const target = document.getElementById('target')!;
    const hostButtonClick = vi.fn();
    target.addEventListener('click', hostButtonClick);

    const wrapper = insertFailedTip(target, 'provider unavailable', vi.fn());
    const reason = wrapper.querySelector<HTMLElement>('.fluent-read-reason')!;
    const click = dispatchCancelableClick(reason);

    expect(reason.getAttribute('role')).toBeNull();
    expect(reason.getAttribute('tabindex')).toBeNull();
    expect(click.defaultPrevented).toBe(true);
    expect(hostButtonClick).not.toHaveBeenCalled();
    expect(mocks.showPageNotice).toHaveBeenCalledOnce();
  });

  it('失败操作支持键盘，并让扩展上下文失效的重试保留刷新提示', () => {
    const target = document.getElementById('target')!;
    const retry = vi.fn();
    const wrapper = insertFailedTip(target, 'Extension context invalidated.', retry);
    const retryAction = wrapper.querySelector<HTMLElement>('.fluent-read-retry')!;
    const reasonAction = wrapper.querySelector<HTMLElement>('.fluent-read-reason')!;

    expect(retryAction.getAttribute('role')).toBe('button');
    expect(retryAction.getAttribute('tabindex')).toBe('0');
    expect(reasonAction.getAttribute('role')).toBe('button');
    expect(reasonAction.getAttribute('tabindex')).toBe('0');

    const retryKey = dispatchActionKey(retryAction, 'Enter');
    const reasonKey = dispatchActionKey(reasonAction, ' ');

    expect(retryKey.defaultPrevented).toBe(true);
    expect(reasonKey.defaultPrevented).toBe(true);
    expect(retry).not.toHaveBeenCalled();
    expect(wrapper.isConnected).toBe(true);
    expect(mocks.showPageNotice).toHaveBeenCalledTimes(2);
    expect(mocks.showPageNotice).toHaveBeenLastCalledWith(
      '扩展已更新或重新加载，请刷新当前页面后再试。',
      'error',
    );
  });

  it('错误原因使用动态自定义服务的保存名称', () => {
    mocks.config.service = 'custom:team';
    mocks.config.customOpenAIProviders = [{
      id: 'custom:team',
      name: '团队模型网关',
      endpoint: 'https://gateway.example/v1',
      models: ['team-model'],
    }];
    const target = document.getElementById('target')!;
    insertFailedTip(target, 'quota exceeded', vi.fn())
      .querySelector<HTMLElement>('.fluent-read-reason')!
      .click();

    expect(mocks.showPageNotice).toHaveBeenCalledWith(
      '你的请求频率过高，被【团队模型网关】拒绝了，请稍后再试吧~',
      'error',
    );
  });

  it('组合错误反馈显示用户保存的名称', () => {
    mocks.config.service = 'composite:team';
    mocks.config.compositeTranslationProviders = [{id: mocks.config.service, name: '团队翻译组合', strategy: 'smart', services: ['google', 'openai'], timeoutMs: 12_000}];
    insertFailedTip(document.getElementById('target')!, 'quota exceeded', vi.fn()).querySelector<HTMLElement>('.fluent-read-reason')!.click();
    expect(mocks.showPageNotice).toHaveBeenCalledWith('你的请求频率过高，被【团队翻译组合】拒绝了，请稍后再试吧~', 'error');
  });

  it('加载指示在 Shadow Root 内渲染所选样式，并区分缓存命中', () => {
    const target = document.getElementById('target')!;
    const cached = insertLoadingSpinner(target, true);

    expect(cached.getAttribute('data-fr-translation-owned')).toBe('true');
    expect(cached.getAttribute('data-fr-loading-style')).toBe('minimal');
    expect(cached.getAttribute('data-fr-cache')).toBe('true');
    expect(cached.getAttribute('data-fr-motion')).toBe('animated');
    expect(cached.classList.contains('static')).toBe(false);
    expect(cached.shadowRoot).toBeNull();
  });

  it('总动画开关关闭时保留静态状态，并继续使用所选样式', () => {
    const target = document.getElementById('target')!;

    mocks.config.animations = false;
    mocks.config.translationLoadingStyle = 'sparkle';
    const staticSpinner = insertLoadingSpinner(target);
    expect(staticSpinner.getAttribute('data-fr-loading-style')).toBe('sparkle');
    expect(staticSpinner.getAttribute('data-fr-motion')).toBe('static');
    expect(staticSpinner.classList.contains('static')).toBe(false);
  });
});
