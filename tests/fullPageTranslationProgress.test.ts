import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {compileScript, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import {compileVueInlineFixture} from './helpers/compiledVueFixture';
import * as vue from 'vue';
import * as progressApi from '@/src/features/full-page-translation/progress';
import * as siteDomainApi from '@/src/core/site-rules/domain';
import {createProgressPanelVisibility} from '@/src/features/full-page-translation/ui/progressPanelVisibility';

import {
  finishFullPageTranslationProgress,
  getFullPageTranslationProgress,
  hasActiveFullPageTranslationWork,
  shouldShowCompactFullPageTranslationStatus,
  startFullPageTranslationProgress,
  subscribeFullPageTranslationProgress,
  updateFullPageTranslationProgress,
} from '@/src/features/full-page-translation/progress';

afterEach(() => {
  const current = getFullPageTranslationProgress();
  if (current.active) finishFullPageTranslationProgress(current.sessionId);
  vi.useRealTimers();
});

describe('全文翻译进度面板显隐稳定性', () => {
  function setup(floatingBallEnabled = true) {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const visibility = createProgressPanelVisibility(onChange);
    const progress = {
      sessionId: 1, active: true, modalPhase: 'none' as 'none' | 'translating' | 'waiting',
      deferred: 0, running: 1, remaining: 13, queued: 1, offscreen: 12,
    };
    const update = (patch: Partial<typeof progress> = {}, dismissed = false) => {
      Object.assign(progress, patch);
      visibility.update({...progress}, floatingBallEnabled, dismissed);
    };
    update();
    return {onChange, visibility, update};
  }

  it('缓存等短任务结束后不会迟到弹出面板', () => {
    const {onChange, visibility, update} = setup();
    vi.advanceTimersByTime(100);
    update({running: 0, queued: 0});
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    visibility.dispose();
  });

  it('计数持续变化也能按时显示，队列间隙不会导致反复显隐', () => {
    const {onChange, visibility, update} = setup();
    vi.advanceTimersByTime(100);
    update({running: 2, queued: 0});
    vi.advanceTimersByTime(80);
    expect(onChange.mock.calls).toEqual([['expanded']]);
    for (let index = 0; index < 10; index += 1) {
      update({running: 0, queued: 0});
      vi.advanceTimersByTime(100);
      update({running: 1});
      vi.advanceTimersByTime(100);
    }
    expect(onChange.mock.calls).toEqual([['expanded']]);
    update({running: 0});
    vi.advanceTimersByTime(300);
    update({offscreen: 11, remaining: 11});
    vi.advanceTimersByTime(299);
    expect(onChange.mock.calls).toEqual([['expanded']]);
    vi.advanceTimersByTime(1);
    expect(onChange.mock.calls).toEqual([['expanded'], ['hidden']]);
    visibility.dispose();
  });

  it('关闭悬浮球时只在连续空闲后退化为紧凑勾选，再次工作也不抖动', () => {
    const {onChange, visibility, update} = setup(false);
    vi.advanceTimersByTime(180);
    update({running: 0, queued: 0});
    vi.advanceTimersByTime(600);
    expect(onChange.mock.calls).toEqual([['expanded'], ['compact']]);
    update({running: 1});
    vi.advanceTimersByTime(100);
    update({running: 0});
    vi.advanceTimersByTime(1000);
    expect(onChange.mock.calls).toEqual([['expanded'], ['compact']]);
    update({running: 1});
    vi.advanceTimersByTime(180);
    expect(onChange).toHaveBeenLastCalledWith('expanded');
    visibility.dispose();
  });

  it.each([100, 200])('手动关闭在 %sms 时取消等待或立即隐藏，并保持本会话关闭', elapsed => {
    const {onChange, visibility, update} = setup();
    vi.advanceTimersByTime(elapsed);
    update({}, true);
    vi.advanceTimersByTime(1000);
    update({running: 3}, true);
    expect(onChange.mock.calls).toEqual(elapsed < 180 ? [] : [['expanded'], ['hidden']]);
    expect(vi.getTimerCount()).toBe(0);
    update({sessionId: 2}, false);
    vi.advanceTimersByTime(180);
    expect(onChange).toHaveBeenLastCalledWith('expanded');
    visibility.dispose();
  });

  it('恢复原文立即隐藏，不等待空闲计时器', () => {
    const {onChange, visibility, update} = setup();
    vi.advanceTimersByTime(180);
    update({running: 0, queued: 0});
    vi.advanceTimersByTime(100);
    update({active: false});
    expect(onChange.mock.calls).toEqual([['expanded'], ['hidden']]);
    expect(vi.getTimerCount()).toBe(0);
    visibility.dispose();
  });

  it('新会话不会继承旧会话的展开计时器', () => {
    const {onChange, visibility, update} = setup();
    vi.advanceTimersByTime(100);
    update({sessionId: 2});
    vi.advanceTimersByTime(80);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenLastCalledWith('expanded');
    update({sessionId: 3, running: 0, queued: 0});
    expect(onChange).toHaveBeenLastCalledWith('hidden');
    visibility.dispose();
  });

  it('原生弹窗等待提示立即出现，不被短任务过滤', () => {
    const {onChange, visibility, update} = setup();
    update({modalPhase: 'waiting', running: 0, queued: 0});
    expect(onChange.mock.calls).toEqual([['expanded']]);
    expect(vi.getTimerCount()).toBe(0);
    update({modalPhase: 'translating', running: 1});
    update({modalPhase: 'waiting', running: 0});
    expect(onChange.mock.calls).toEqual([['expanded']]);
    visibility.dispose();
  });

  it('设置变化取消或替换收起目标，卸载后不再发布', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const visibility = createProgressPanelVisibility(onChange);
    const progress = {sessionId: 1, active: true, modalPhase: 'none' as const,
      deferred: 0, running: 0, queued: 0, offscreen: 12, remaining: 12};
    visibility.update(progress, false, false);
    visibility.update(progress, true, false);
    visibility.update({...progress, running: 1}, true, false);
    vi.advanceTimersByTime(180);
    visibility.update(progress, true, false);
    vi.advanceTimersByTime(100);
    visibility.update(progress, false, false);
    vi.advanceTimersByTime(600);
    expect(onChange.mock.calls).toEqual([['compact'], ['hidden'], ['expanded'], ['compact']]);
    visibility.update({...progress, running: 1}, false, false);
    visibility.dispose();
    visibility.dispose();
    visibility.update({...progress, sessionId: 2}, false, false);
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('已排入事件队列的过期回调不能在关闭或卸载后重新显示', () => {
    const {onChange, visibility, update} = setup();
    const clearTimeout = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {});
    update({}, true);
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    update({sessionId: 2}, false);
    visibility.dispose();
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    clearTimeout.mockRestore();
  });
});

describe('全文翻译进度', () => {
  it('仅把请求中或已排队任务视为需要展开面板的活动工作', () => {
    const offscreenOnly = {
      sessionId: 1,
      active: true,
      running: 0,
      remaining: 6,
      queued: 0,
      offscreen: 6,
    };
    expect(hasActiveFullPageTranslationWork(offscreenOnly)).toBe(false);
    expect(hasActiveFullPageTranslationWork({active: true, running: 1, queued: 0})).toBe(true);
    expect(hasActiveFullPageTranslationWork({active: true, running: 0, queued: 2})).toBe(true);
    expect(hasActiveFullPageTranslationWork({active: true, running: 0, queued: 0, modalPhase: 'waiting', deferred: 3})).toBe(true);
    expect(hasActiveFullPageTranslationWork({active: false, running: 3, queued: 4})).toBe(false);
    expect(hasActiveFullPageTranslationWork({active: true, running: Number.NaN, queued: -1})).toBe(false);

    expect(shouldShowCompactFullPageTranslationStatus(offscreenOnly, false)).toBe(true);
    expect(shouldShowCompactFullPageTranslationStatus(offscreenOnly, true)).toBe(false);
    expect(shouldShowCompactFullPageTranslationStatus({active: true, running: 1, queued: 0}, false)).toBe(false);
    expect(shouldShowCompactFullPageTranslationStatus({active: false, running: 0, queued: 0}, false)).toBe(false);
  });

  it('立即提供快照，并发布进行中、队列与离屏任务数量', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFullPageTranslationProgress(listener);
    const sessionId = startFullPageTranslationProgress();

    updateFullPageTranslationProgress(sessionId, {
      running: 3,
      queued: 4,
      offscreen: 7,
    });

    expect(listener).toHaveBeenLastCalledWith({
      sessionId,
      active: true,
      modalPhase: 'none',
      deferred: 0,
      running: 3,
      remaining: 11,
      queued: 4,
      offscreen: 7,
      completed: 0,
      failed: 0,
      retryable: 0,
    });
    expect(getFullPageTranslationProgress()).toEqual(listener.mock.lastCall?.[0]);
    unsubscribe();
  });

  it('忽略旧会话的迟到更新和结束通知', () => {
    const staleSessionId = startFullPageTranslationProgress();
    const currentSessionId = startFullPageTranslationProgress();

    updateFullPageTranslationProgress(staleSessionId, {running: 99, queued: 99, offscreen: 99});
    finishFullPageTranslationProgress(staleSessionId);

    expect(getFullPageTranslationProgress()).toEqual({
      sessionId: currentSessionId,
      active: true,
      modalPhase: 'none',
      deferred: 0,
      running: 0,
      remaining: 0,
      queued: 0,
      offscreen: 0,
      completed: 0,
      failed: 0,
      retryable: 0,
    });
  });

  it('结束当前会话时清零计数并通知订阅者', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFullPageTranslationProgress(listener);
    const sessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(sessionId, {running: 2, queued: 1, offscreen: 5});

    finishFullPageTranslationProgress(sessionId);

    expect(listener).toHaveBeenLastCalledWith({
      sessionId,
      active: false,
      modalPhase: 'none',
      deferred: 0,
      running: 0,
      remaining: 0,
      queued: 0,
      offscreen: 0,
      completed: 0,
      failed: 0,
      retryable: 0,
    });
    unsubscribe();
  });

  it('规范化异常计数，并对相同快照去重', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFullPageTranslationProgress(listener);
    const sessionId = startFullPageTranslationProgress();
    listener.mockClear();

    updateFullPageTranslationProgress(sessionId, {running: 2.9, queued: -1, offscreen: Number.NaN});
    updateFullPageTranslationProgress(sessionId, {running: 2, queued: 0, offscreen: 0});

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      running: 2,
      remaining: 0,
      queued: 0,
      offscreen: 0,
    }));
    unsubscribe();
  });

  it('把弹窗阶段和被阻塞候选纳入剩余数量，并允许阶段切换', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFullPageTranslationProgress(listener);
    const sessionId = startFullPageTranslationProgress();
    listener.mockClear();

    updateFullPageTranslationProgress(sessionId, {
      modalPhase: 'translating',
      deferred: 4,
      running: 1,
      queued: 2,
      offscreen: 3,
    });
    expect(getFullPageTranslationProgress()).toMatchObject({
      modalPhase: 'translating',
      deferred: 4,
      running: 1,
      queued: 2,
      offscreen: 3,
      remaining: 9,
    });
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({modalPhase: 'translating', deferred: 4, remaining: 9}));

    updateFullPageTranslationProgress(sessionId, {
      modalPhase: 'waiting',
      deferred: 5,
      running: 0,
      queued: 0,
      offscreen: 3,
    });
    expect(getFullPageTranslationProgress()).toMatchObject({modalPhase: 'waiting', deferred: 5, remaining: 8});
    expect(hasActiveFullPageTranslationWork(getFullPageTranslationProgress())).toBe(true);
    unsubscribe();
  });

  it('新会话重置弹窗阶段与 deferred 状态，并拒绝旧会话字段', () => {
    const oldSessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(oldSessionId, {
      modalPhase: 'waiting', deferred: 7, running: 0, queued: 0, offscreen: 1,
    });
    const newSessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(oldSessionId, {
      modalPhase: 'translating', deferred: 99, running: 9, queued: 9, offscreen: 9,
    });
    expect(getFullPageTranslationProgress()).toEqual({
      sessionId: newSessionId,
      active: true,
      modalPhase: 'none',
      deferred: 0,
      running: 0,
      remaining: 0,
      queued: 0,
      offscreen: 0,
      completed: 0,
      failed: 0,
      retryable: 0,
    });
  });

  it('隔离订阅者快照与异常，取消订阅后不再通知', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = vi.fn((snapshot: ReturnType<typeof getFullPageTranslationProgress>) => {
      snapshot.running = 999;
      throw new Error('listener failed');
    });
    const healthy = vi.fn();
    const unsubscribeBroken = subscribeFullPageTranslationProgress(broken);
    const unsubscribeHealthy = subscribeFullPageTranslationProgress(healthy);
    healthy.mockClear();

    const sessionId = startFullPageTranslationProgress();

    expect(healthy).toHaveBeenLastCalledWith(expect.objectContaining({sessionId, running: 0}));
    expect(consoleError).toHaveBeenCalledWith(
      '[FluentRead] 全文翻译进度订阅者执行失败',
      expect.any(Error),
    );

    unsubscribeBroken();
    unsubscribeHealthy();
    broken.mockClear();
    healthy.mockClear();
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 0});
    expect(broken).not.toHaveBeenCalled();
    expect(healthy).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('在未激活时忽略更新和结束', () => {
    const current = getFullPageTranslationProgress();
    if (current.active) finishFullPageTranslationProgress(current.sessionId);
    const before = getFullPageTranslationProgress();

    updateFullPageTranslationProgress(before.sessionId, {running: 1, queued: 2, offscreen: 3});
    finishFullPageTranslationProgress(before.sessionId);

    expect(getFullPageTranslationProgress()).toEqual(before);
  });
});

describe('进度通知重入与订阅所有权', () => {
  const subscriptions: (() => void)[] = [];
  const subscribe = (listener: Parameters<typeof subscribeFullPageTranslationProgress>[0]) => {
    const unsubscribe = subscribeFullPageTranslationProgress(listener);
    subscriptions.push(unsubscribe);
    return unsubscribe;
  };
  afterEach(() => subscriptions.splice(0).forEach(unsubscribe => unsubscribe()));

  it('订阅者重启会话不会递归回调自己，其他观察者取得最新会话', () => {
    let starts = 0, depth = 0, maximumDepth = 0;
    subscribe(snapshot => {
      if (!snapshot.active) return;
      depth += 1;
      maximumDepth = Math.max(maximumDepth, depth);
      if (starts++ < 25) startFullPageTranslationProgress();
      depth -= 1;
    });
    const observer = vi.fn();
    subscribe(observer);
    const first = startFullPageTranslationProgress();
    expect(starts).toBe(1);
    expect(maximumDepth).toBe(1);
    expect(getFullPageTranslationProgress().sessionId).toBe(first + 1);
    expect(observer).toHaveBeenLastCalledWith(getFullPageTranslationProgress());
    startFullPageTranslationProgress();
    expect(starts).toBe(2);
    expect(observer).toHaveBeenLastCalledWith(getFullPageTranslationProgress());
  });

  it('两个订阅者互相发布时迭代交付一次写入，并让只读观察者追上最终状态', () => {
    const observer = vi.fn();
    subscribe(observer);
    let writes = 0, depth = 0, maximumDepth = 0;
    const writer = () => (snapshot: ReturnType<typeof getFullPageTranslationProgress>) => {
      if (!snapshot.active || writes >= 20) return;
      depth += 1;
      maximumDepth = Math.max(maximumDepth, depth);
      writes += 1;
      updateFullPageTranslationProgress(snapshot.sessionId, {running: writes, queued: 0, offscreen: 0});
      depth -= 1;
    };
    subscribe(writer());
    subscribe(writer());
    startFullPageTranslationProgress();
    expect(writes).toBe(2);
    expect(maximumDepth).toBe(1);
    expect(observer).toHaveBeenLastCalledWith(getFullPageTranslationProgress());
    expect(getFullPageTranslationProgress().running).toBe(2);
  });

  it('通知中新增订阅只初始化一次，不重复投递同一快照', () => {
    const added = vi.fn();
    subscribe(snapshot => {if (snapshot.active) subscribe(added);});
    startFullPageTranslationProgress();
    expect(added).toHaveBeenCalledTimes(1);
    expect(added).toHaveBeenLastCalledWith(getFullPageTranslationProgress());
  });

  it('通知中取消尚未交付的订阅，不会调用已卸载的 UI', () => {
    let remove = () => {};
    subscribe(snapshot => {if (snapshot.active) remove();});
    const removed = vi.fn();
    remove = subscribe(removed);
    removed.mockClear();
    startFullPageTranslationProgress();
    expect(removed).not.toHaveBeenCalled();
  });

  it('只读订阅者在回调内重新订阅自己也不会重复初始化', () => {
    let calls = 0;
    const reader = () => {if (++calls < 20) subscribe(reader);};
    subscribe(reader);
    expect(calls).toBe(1);
    startFullPageTranslationProgress();
    expect(calls).toBe(2);
  });

  it('相互重新订阅的观察者不会循环，已写入者也不会因重新订阅收到回声', () => {
    let calls = 0;
    const first = (snapshot: ReturnType<typeof getFullPageTranslationProgress>) => {
      if (!snapshot.active || ++calls > 20) return;
      subscribe(second);
      updateFullPageTranslationProgress(snapshot.sessionId, {running: calls, queued: 0, offscreen: 0});
    };
    const second = (snapshot: ReturnType<typeof getFullPageTranslationProgress>) => {
      if (!snapshot.active) return;
      subscribe(first);
      subscribe(second);
    };
    subscribe(first);
    subscribe(second);
    startFullPageTranslationProgress();
    expect(calls).toBe(1);
    expect(getFullPageTranslationProgress().running).toBe(1);
  });

  it('首次订阅中的更新也按队列交付，批量写入只读观察者只收到最后值', () => {
    const sessionId = startFullPageTranslationProgress();
    const observer = vi.fn();
    subscribe(observer);
    observer.mockClear();
    let calls = 0;
    subscribe(snapshot => {
      if (++calls > 20) return;
      updateFullPageTranslationProgress(snapshot.sessionId, {running: 1, queued: 2, offscreen: 3});
      updateFullPageTranslationProgress(snapshot.sessionId, {running: 4, queued: 5, offscreen: 6});
    });
    expect(calls).toBe(1);
    expect(observer.mock.calls).toEqual([[{sessionId, active: true, modalPhase: 'none', deferred: 0, running: 4, queued: 5, offscreen: 6, remaining: 11, completed: 0, failed: 0, retryable: 0}]]);
  });

  it('写入后重新订阅自己和抛出异常不会反馈循环，后续外部发布仍可使用', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    const writer = (snapshot: ReturnType<typeof getFullPageTranslationProgress>) => {
      if (!snapshot.active || ++calls > 20) return;
      finishFullPageTranslationProgress(snapshot.sessionId);
      subscribe(writer);
      throw new Error('failed after finish');
    };
    try {
      subscribe(writer);
      const observer = vi.fn();
      subscribe(observer);
      startFullPageTranslationProgress();
      expect(calls).toBe(1);
      expect(observer).toHaveBeenLastCalledWith(getFullPageTranslationProgress());
      expect(getFullPageTranslationProgress().active).toBe(false);
      startFullPageTranslationProgress();
      expect(calls).toBe(2);
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {consoleError.mockRestore();}
  });
});

describe('进度面板组件实时订阅与显隐', () => {
  const filename = 'src/features/full-page-translation/ui/TranslationProgressPanel.vue';
  const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
  const compiled = ts.transpileModule(compileScript(descriptor, {id: 'progress-panel-test'}).content, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  let scope: vue.EffectScope;
  let state: Record<string, any>;
  let unmount: (() => void)[];
  let publishConfig: (value: typeof config) => void;
  let config: {animations: boolean; theme: string; disableFloatingBall: boolean; floatingBallDisabledDomains: string[]};

  beforeEach(() => {
    vi.useFakeTimers();
    config = {animations: true, theme: 'auto', disableFloatingBall: false, floatingBallDisabledDomains: []};
    const mounted: (() => void)[] = [];
    unmount = [];
    vi.stubGlobal('window', {location: {href: 'https://news.example.com/article'}, matchMedia: () => ({matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()})});
    const exports: Record<string, any> = {};
    new Function('require', 'exports', compiled)((id: string) => {
      if (id === 'vue') return {...vue, onMounted: (fn: () => void) => mounted.push(fn), onBeforeUnmount: (fn: () => void) => unmount.push(fn)};
      if (id.endsWith('/progress')) return progressApi;
      if (id === './progressPanelVisibility') return {createProgressPanelVisibility};
      if (id === '@/src/platform/dom/visualViewport') return {getSafeVisualViewportRect: () => ({left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800}), observeVisualViewport: () => () => {}};
      if (id.endsWith('/site-rules/domain')) return siteDomainApi;
      if (id.endsWith('/store')) return {config, subscribeConfig: (fn: typeof publishConfig) => {publishConfig = fn; return vi.fn();}};
      if (id.endsWith('/i18n')) return {useUiI18n: () => ({t: (key: string) => key})};
      throw new Error(`Unexpected import: ${id}`);
    }, exports);
    scope = vue.effectScope();
    state = scope.run(() => vue.proxyRefs(exports.default.setup({}, {expose: () => {}})))!;
    mounted.forEach(fn => fn());
  });

  afterEach(() => {
    unmount.forEach(fn => fn());
    scope.stop();
    vi.unstubAllGlobals();
  });

  it('组件不展示不足 180ms 的短任务', () => {
    const sessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(100);
    expect(state.isVisible).toBe(false);
    updateFullPageTranslationProgress(sessionId, {running: 0, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(1000);
    expect(state.isVisible).toBe(false);
  });

  it('快速工作与离屏等待交替时保持展开，计数仍实时刷新', () => {
    const sessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(180);
    expect(state.isVisible).toBe(true);
    for (let index = 0; index < 10; index += 1) {
      updateFullPageTranslationProgress(sessionId, {running: 0, queued: 0, offscreen: 12 - index});
      expect(state.progress.running).toBe(0);
      expect(state.progress.remaining).toBe(12 - index);
      expect(state.isVisible).toBe(true);
      vi.advanceTimersByTime(100);
      updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12 - index});
      expect(state.progress.running).toBe(1);
      expect(state.isVisible).toBe(true);
      vi.advanceTimersByTime(100);
    }
    updateFullPageTranslationProgress(sessionId, {running: 0, queued: 0, offscreen: 2});
    vi.advanceTimersByTime(600);
    expect(state.isVisible).toBe(false);
  });

  it('收起、恢复原文和再次翻译立即更新展示所有权', () => {
    const sessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(180);
    state.dismiss();
    expect(state.isVisible).toBe(false);
    updateFullPageTranslationProgress(sessionId, {running: 2, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(1000);
    expect(state.isVisible).toBe(false);
    const nextSessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(nextSessionId, {running: 1, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(180);
    expect(state.isVisible).toBe(true);
    finishFullPageTranslationProgress(nextSessionId);
    expect(state.isVisible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('配置订阅保持紧凑状态契约，卸载取消显隐计时器', () => {
    const sessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(180);
    publishConfig({...config, disableFloatingBall: true});
    updateFullPageTranslationProgress(sessionId, {running: 0, queued: 0, offscreen: 12});
    expect(state.isCompact).toBe(false);
    vi.advanceTimersByTime(600);
    expect(state.isCompact).toBe(true);
    expect(state.isVisible).toBe(true);
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12});
    unmount.forEach(fn => fn());
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(state.isCompact).toBe(true);
  });

  it('浮球被站点规则隐藏时仍保留紧凑状态，移除规则后重新交给浮球反馈', () => {
    const sessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(180);
    publishConfig({...config, floatingBallDisabledDomains: ['example.com']});
    updateFullPageTranslationProgress(sessionId, {running: 0, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(600);
    expect(state.isVisible).toBe(true);
    expect(state.isCompact).toBe(true);
    publishConfig({...config, floatingBallDisabledDomains: ['another.test']});
    expect(state.isVisible).toBe(false);
    finishFullPageTranslationProgress(sessionId);
    expect(state.isVisible).toBe(false);
  });

  it('其他订阅者在发布中结束任务时取消旧面板计时器，新会话仍可展开', () => {
    let shouldFinish = true;
    const unsubscribe = subscribeFullPageTranslationProgress(snapshot => {
      if (shouldFinish && snapshot.running > 0) finishFullPageTranslationProgress(snapshot.sessionId);
    });
    try {
      const sessionId = startFullPageTranslationProgress();
      updateFullPageTranslationProgress(sessionId, {running: 1, queued: 1, offscreen: 0});
      expect(state.progress.active).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(1000);
      expect(state.isVisible).toBe(false);
      shouldFinish = false;
      const next = startFullPageTranslationProgress();
      updateFullPageTranslationProgress(next, {running: 1, queued: 0, offscreen: 0});
      vi.advanceTimersByTime(180);
      expect(state.progress.sessionId).toBe(next);
      expect(state.isVisible).toBe(true);
    } finally {unsubscribe();}
  });
  it('失败摘要在空队列中保留，恢复动作按当前会话交付，弹窗等待时不发出动作', () => {
    const sessionId = startFullPageTranslationProgress();
    const action = vi.fn(() => 1);
    progressApi.setFullPageFailureActions(sessionId, action);
    updateFullPageTranslationProgress(sessionId, {running: 0, queued: 0, offscreen: 0, completed: 12, failed: 2});
    vi.advanceTimersByTime(180);
    expect(state.isVisible).toBe(true);
    expect(state.hasFailures).toBe(true);
    expect(state.panelTitle).toBe('fullPage.progress.failuresTitle');
    vi.advanceTimersByTime(2000);
    expect(state.isVisible).toBe(true);
    state.runFailureAction('retry'); state.runFailureAction('locate');
    expect(action.mock.calls).toEqual([['retry'], ['locate']]);
    updateFullPageTranslationProgress(sessionId, {running: 0, queued: 0, offscreen: 0, modalPhase: 'waiting', retryable: 0});
    state.runFailureAction('retry');
    expect(action).toHaveBeenCalledTimes(2);
    finishFullPageTranslationProgress(sessionId);
    state.runFailureAction('retry');
    expect(action).toHaveBeenCalledTimes(2);
    expect(state.isVisible).toBe(false);
  });

});

// 以下只追加真实 key 化面板的完整渲染 owner，保留上方原进度、重入及 setup 用例。
describe('进度面板稳定 key 的完整 DOM 与真实 i18n 生命周期', () => {
  type Language = import('@/src/core/i18n').UiLanguage;
  type RegisteredLanguage = import('@/src/core/i18n').RegisteredUiLanguage;
  const languages: readonly Language[] = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'];
  const panelFile = 'src/features/full-page-translation/ui/TranslationProgressPanel.vue';
  function pendingValue<T>() {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
  }

  async function fullRender(language: Language = 'zh-CN', preload = true, outerRoot = false) {
    vi.resetModules(); vi.useFakeTimers();
    const {parseHTML} = await import('linkedom');
    const dom = parseHTML('<html lang="fixture-host-language"><head><title>Synthetic host title</title></head><body><aside id="outside"><p title="设置" aria-label="设置">设置</p></aside><div id="owner"></div></body></html>');
    const document = dom.document as unknown as Document;
    const root = document.querySelector('#owner') as HTMLElement;
    const outside = document.querySelector('#outside')!;
    const hostBefore = {outside: outside.outerHTML, title: document.title, lang: document.documentElement.getAttribute('lang')};
    const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();
    const media = {matches: false, addEventListener: (_name: string, fn: (event: MediaQueryListEvent) => void) => mediaListeners.add(fn),
      removeEventListener: (_name: string, fn: (event: MediaQueryListEvent) => void) => mediaListeners.delete(fn)};
    const observers: Array<{root?: Node; active: boolean; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>}> = [];
    const NativeObserver = dom.window.MutationObserver;
    class ObservedMutation {
      root?: Node; active = false;
      native: MutationObserver;
      observe = vi.fn((node: Node, options: MutationObserverInit) => {this.root = node; this.active = true; this.native.observe(node, options);});
      disconnect = vi.fn(() => {this.active = false; this.native.disconnect();});
      constructor(callback: MutationCallback) {
        this.native = new NativeObserver((records: MutationRecord[]) => callback(records, this as unknown as MutationObserver)) as unknown as MutationObserver;
        observers.push(this);
      }
      takeRecords() {return this.native.takeRecords();}
    }
    for (const [name, value] of Object.entries({document, window: {location: {href: 'https://news.example.com/article'}, matchMedia: () => media}, Node: dom.window.Node,
      Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event,
      MutationObserver: ObservedMutation, NodeFilter: {SHOW_TEXT: 4}})) vi.stubGlobal(name, value);
    const walkers = vi.spyOn(document, 'createTreeWalker');
    const elementQueries = vi.spyOn(dom.window.Element.prototype, 'querySelectorAll');
    const config = {uiLanguage: language, uiLanguageSetupCompleted: true, animations: true, theme: 'auto', disableFloatingBall: false, floatingBallDisabledDomains: [] as string[]};
    let revision = 0;
    const listeners = new Set<(value: typeof config) => void>();
    const callbacks: Array<(value: typeof config) => void> = [];
    const patches: Array<Record<string, unknown>> = [];
    const emit = (patch: Partial<typeof config>) => {
      Object.assign(config, patch); revision += 1;
      for (const listener of listeners) listener({...config});
    };
    const store = {config, configReady: Promise.resolve(), getConfigRevision: () => revision,
      subscribeConfig: (listener: (value: typeof config) => void) => {
        listeners.add(listener); callbacks.push(listener); listener({...config});
        return () => {listeners.delete(listener);};
      }, requestConfigPatch: async (patch: Partial<typeof config>) => {patches.push({...patch}); emit(patch);}};
    const core = await import('@/src/core/i18n');
    const {UI_LANGUAGE_BUNDLES} = await import('@/src/core/i18n/bundles');
    if (preload) for (const value of languages) if (value !== 'zh-CN') core.registerUiLanguageBundle(value, UI_LANGUAGE_BUNDLES[value]);
    // 使用真实 loader 的 pending/验证/注册逻辑，只在 fetch 外部端口暂缓响应。
    const platform = await vi.importActual<typeof import('@/src/platform/i18n/uiLanguageBundles')>('@/src/platform/i18n/uiLanguageBundles');
    type Response = {ok: boolean; status: number; json: () => Promise<unknown>};
    const fetches: Array<{language: RegisteredLanguage; gate: ReturnType<typeof pendingValue<Response>>}> = [];
    const warns: unknown[][] = [];
    const ensure = vi.fn(platform.createUiLanguageBundleLoader({resolveUrl: path => path, fetch: async path => {
      const value = path.slice('i18n/'.length, -'.json'.length) as RegisteredLanguage;
      if (!Object.hasOwn(UI_LANGUAGE_BUNDLES, value)) throw new Error('Unexpected owned language bundle path');
      const gate = pendingValue<Response>(); fetches.push({language: value, gate}); return gate.promise;
    }, warn: (...values) => warns.push(values)}));
    vi.doMock('@/src/services/config/store', () => store);
    vi.doMock('@/src/platform/i18n/uiLanguageBundles', () => ({ensureUiLanguageBundle: ensure}));
    vi.doMock('webextension-polyfill', () => ({default: {runtime: {sendMessage: vi.fn(async () => ({success: true}))}}}));
    let app: vue.App | undefined, context!: import('@/src/ui/i18n').UiI18nContext;
    let closed = false;
    const flush = async () => {
      for (let index = 0; index < 4; index += 1) {
        await vue.nextTick(); for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
      }
      await vue.nextTick();
    };
    const advance = async (ms: number) => {await vi.advanceTimersByTimeAsync(ms); await flush();};
    try {
      const i18n = await import('@/src/ui/i18n');
      const compiled = compileVueInlineFixture(panelFile, {id: 'progress-panel-full-render-owner'});
      expect(compiled.parseErrors).toEqual([]);
      // 仅以同步 slot 端口代替 CSS 过渡；完整业务模板、Vue响应式、DOM事件均实际运行。
      const TransitionPort = vue.defineComponent({inheritAttrs: false, props: {name: String}, setup: (_props, {slots}) => () => slots.default?.()});
      const module = {exports: {} as {default: vue.Component}};
      new Function('require', 'exports', 'module', compiled.code)((id: string) => {
        if (id === 'vue') return {...vue, Transition: TransitionPort};
        if (id === '@/src/features/full-page-translation/progress') return progressApi;
        if (id === './progressPanelVisibility') return {createProgressPanelVisibility};
        if (id === '@/src/platform/dom/visualViewport') return {getSafeVisualViewportRect: () => ({left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800}), observeVisualViewport: () => () => {}};
        if (id === '@/src/services/config/store') return store;
        if (id === '@/src/core/site-rules/domain') return siteDomainApi;
        if (id === '@/src/ui/i18n') return i18n;
        throw new Error(`Unexpected full progress template dependency ${id}`);
      }, module.exports, module);
      const eventHandlers = new WeakMap<Element, Map<string, EventListener>>();
      // 仓库既有真实 Vue createRenderer/Linkedom 模式；只实现外部 DOM 端口，不复制业务。
      const renderer = vue.createRenderer<Node, Element>({patchProp(element, name, _before, next) {
        if (/^on[A-Z]/u.test(name)) {
          const event = name.slice(2).toLowerCase(); let handlers = eventHandlers.get(element);
          if (!handlers) {handlers = new Map(); eventHandlers.set(element, handlers);}
          const previous = handlers.get(event); if (previous) element.removeEventListener(event, previous);
          handlers.delete(event);
          if (typeof next === 'function') {element.addEventListener(event, next as EventListener); handlers.set(event, next as EventListener);}
          return;
        }
        if (name === 'class') {element.setAttribute('class', String(next ?? '')); return;}
        if (name === 'style') {
          if (typeof next === 'string') element.setAttribute('style', next);
          else if (next && typeof next === 'object') Object.assign((element as HTMLElement).style, next);
          else element.removeAttribute('style'); return;
        }
        if (next === null || next === undefined || (next === false && !/^(?:aria-|data-)/u.test(name))) element.removeAttribute(name);
        else element.setAttribute(name, next === true && !/^(?:aria-|data-)/u.test(name) ? '' : String(next));
      }, insert: (node, parent, anchor) => parent.insertBefore(node, anchor ?? null), remove: node => node.parentNode?.removeChild(node),
        createElement: (tag, namespace) => namespace === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag),
        createText: value => document.createTextNode(value), createComment: value => document.createComment(value),
        setText: (node, value) => {node.nodeValue = value;}, setElementText: (element, value) => {element.textContent = value;},
        parentNode: node => node.parentNode as Element | null, nextSibling: node => node.nextSibling,
        querySelector: selector => document.querySelector(selector), setScopeId: (element, id) => element.setAttribute(id, ''),
        cloneNode: node => node.cloneNode(true), insertStaticContent(html, parent, anchor) {
          const template = document.createElement('template'); template.innerHTML = html;
          const first = template.content.firstChild!, last = template.content.lastChild!;
          parent.insertBefore(template.content, anchor ?? null); return [first, last];
        }});
      const mount = async () => {
        if (app) throw new Error('Full progress fixture app already mounted');
        app = renderer.createApp({setup() {
          context = i18n.useUiI18n();
          return () => vue.h(vue.Fragment, null, [vue.h(module.exports.default), ...(outerRoot ? [vue.h('button', {
            'data-owned-legacy': 'true', title: '设置', 'aria-label': '设置'}, '设置')] : [])]);
        }});
        app.use(i18n.createUiI18nPlugin(outerRoot ? {documentRoot: null, uiRoot: root} : {}));
        app.mount(root); await flush();
      };
      const unmount = async () => {app?.unmount(); app = undefined; await flush();};
      await mount();
      return {core, root, outside, config, patches, fetches, warns, ensure, listeners, callbacks, mediaListeners, observers,
        context: () => context, flush, advance, mount, unmount,
        panel: () => root.querySelector<HTMLElement>('.fr-translation-progress'),
        language: async (value: Language) => {const result = await context.setLanguage(value); await flush(); return result;},
        emit: async (patch: Partial<typeof config>) => {emit(patch); await flush();},
        release: async (value: RegisteredLanguage, error?: Error) => {
          await flush(); const request = [...fetches].reverse().find(entry => entry.language === value);
          if (!request) throw new Error(`No actual pending language fetch: ${value}`);
          if (error) request.gate.reject(error);
          else request.gate.resolve({ok: true, status: 200, json: async () => UI_LANGUAGE_BUNDLES[value]});
          await flush();
        },
        metrics: () => ({treeWalkers: walkers.mock.calls.filter(([node]) => (node as Element).classList?.contains('fr-translation-progress')).length,
          wildcardQueries: elementQueries.mock.calls.filter(([selector], index) => selector === '*' &&
            (elementQueries.mock.contexts[index] as Element).classList?.contains('fr-translation-progress')).length,
          observers: observers.filter(entry => (entry.root as Element | undefined)?.classList?.contains('fr-translation-progress')).length}),
        assertHost: () => expect({outside: outside.outerHTML, title: document.title, lang: document.documentElement.getAttribute('lang')}).toEqual(hostBefore),
        close: async () => {
          if (closed) return; closed = true;
          try {await unmount(); const snapshot = getFullPageTranslationProgress(); if (snapshot.active) finishFullPageTranslationProgress(snapshot.sessionId);
            for (const request of fetches) request.gate.resolve({ok: false, status: 410, json: async () => null}); await flush();
            expect(listeners.size).toBe(0); expect(mediaListeners.size).toBe(0); expect(observers.every(entry => !entry.active)).toBe(true);
          } finally {walkers.mockRestore(); elementQueries.mockRestore(); vi.doUnmock('@/src/services/config/store');
            vi.doUnmock('@/src/platform/i18n/uiLanguageBundles'); vi.doUnmock('webextension-polyfill'); vi.unstubAllGlobals(); vi.resetModules();}
        }};
    } catch (error) {
      app?.unmount(); for (const request of fetches) request.gate.resolve({ok: false, status: 410, json: async () => null});
      walkers.mockRestore(); elementQueries.mockRestore(); vi.doUnmock('@/src/services/config/store');
      vi.doUnmock('@/src/platform/i18n/uiLanguageBundles'); vi.doUnmock('webextension-polyfill'); vi.unstubAllGlobals(); vi.resetModules(); throw error;
    }
  }
  type Fixture = Awaited<ReturnType<typeof fullRender>>;
  async function publish(h: Fixture, sessionId: number, value: Parameters<typeof updateFullPageTranslationProgress>[1]) {
    updateFullPageTranslationProgress(sessionId, value); await h.flush();
  }
  function expanded(h: Fixture, language: Language) {
    const panel = h.panel()!, value = getFullPageTranslationProgress(), t = (key: string, params?: Record<string, number>) => h.core.translate(key, language, params);
    expect(panel).not.toBeNull(); expect(panel.classList.contains('fr-compact')).toBe(false);
    expect(panel.querySelector('strong')!.textContent).toBe(t(value.failed && value.running === 0 && value.queued === 0
      ? 'fullPage.progress.failuresTitle' : value.modalPhase === 'translating' ? 'fullPage.progress.modalTranslating' : 'fullPage.progress.title'));
    const counts = panel.querySelectorAll('.fr-progress-counts');
    expect(counts[0].querySelectorAll('b')[0].textContent).toBe(String(value.running));
    expect(counts[0].querySelectorAll('b')[1].textContent).toBe(String(value.remaining));
    expect(counts[0].textContent).toContain(t('fullPage.progress.running')); expect(counts[0].textContent).toContain(t('fullPage.progress.remaining'));
    if ((value.completed ?? 0) > 0 || (value.failed ?? 0) > 0) {
      expect(counts[1].textContent).toContain(t('fullPage.progress.completed')); expect(counts[1].textContent).toContain(t('fullPage.progress.failed'));
      expect([...counts[1].querySelectorAll('b')].map(node => node.textContent)).toEqual([String(value.completed ?? 0), String(value.failed ?? 0)]);
    }
    expect(panel.querySelector('.fr-progress-copy')!.getAttribute('aria-label')).toBe(t('fullPage.progress.aria', {
      running: value.running, remaining: value.remaining, offscreen: value.offscreen}) + (value.failed ? ` · ${t('fullPage.progress.summaryAria', {completed: value.completed ?? 0, failed: value.failed})}` : ''));
    const dismiss = panel.querySelector('.fr-progress-dismiss')!;
    expect(dismiss.getAttribute('title')).toBe(t('fullPage.progress.hideTitle')); expect(dismiss.getAttribute('aria-label')).toBe(t('fullPage.progress.hide'));
    const hint = panel.querySelector('small');
    expect(hint?.textContent?.trim() ?? null).toBe(value.modalPhase === 'waiting' ? t('fullPage.progress.modalWaiting')
      : value.offscreen > 0 ? t('fullPage.progress.offscreenHint', {count: value.offscreen}) : null);
    const actions = panel.querySelectorAll<HTMLButtonElement>('.fr-progress-action');
    expect([...actions].map(button => button.textContent)).toEqual(value.failed ? [t('fullPage.progress.retryFailed'), t('fullPage.progress.locateFailed')] : []);
    for (const button of actions) expect(button.hasAttribute('disabled')).toBe((value.retryable ?? value.failed ?? 0) === 0);
    h.assertHost();
  }

  it.each(languages)('%s 的真实模板保留计数、失败动作、模态、紧凑与重新显示的 key 文案', async language => {
    const h = await fullRender(language); const actions: Array<{sessionId: number; action: string}> = [];
    try {
      const sessionId = startFullPageTranslationProgress();
      progressApi.setFullPageFailureActions(sessionId, action => {actions.push({sessionId, action}); return 1;});
      await publish(h, sessionId, {running: 1, queued: 2, offscreen: 9, completed: 3}); await h.advance(180); expanded(h, language);
      await publish(h, sessionId, {running: 0, queued: 0, offscreen: 9, completed: 3, failed: 2, retryable: 2}); expanded(h, language);
      for (const button of h.panel()!.querySelectorAll<HTMLButtonElement>('.fr-progress-action')) button.click(); await h.flush();
      expect(actions).toEqual([{sessionId, action: 'retry'}, {sessionId, action: 'locate'}]);
      await publish(h, sessionId, {running: 0, queued: 0, offscreen: 9, completed: 3, failed: 2, retryable: 0}); expanded(h, language);
      await publish(h, sessionId, {running: 0, queued: 0, offscreen: 9, modalPhase: 'waiting', deferred: 3, failed: 0}); expanded(h, language);
      await publish(h, sessionId, {running: 1, queued: 0, offscreen: 9, modalPhase: 'translating'}); expanded(h, language);
      await h.emit({disableFloatingBall: true, theme: 'dark', animations: false});
      await publish(h, sessionId, {running: 0, queued: 0, offscreen: 9}); await h.advance(599);
      expect(h.panel()!.classList.contains('fr-compact')).toBe(false); await h.advance(1);
      expect(h.panel()!.classList.contains('fr-compact')).toBe(true);
      expect(h.panel()!.querySelector('[role="status"]')!.getAttribute('aria-label')).toBe(h.core.translate('fullPage.progress.compactOffscreen', language, {count: 9}));
      expect(h.panel()!.classList.contains('fr-dark')).toBe(true); expect(h.panel()!.classList.contains('fr-static')).toBe(true);
      await publish(h, sessionId, {running: 0, queued: 0, offscreen: 0});
      expect(h.panel()!.querySelector('[role="status"]')!.getAttribute('aria-label')).toBe(h.core.translate('fullPage.progress.compactActive', language));
      await publish(h, sessionId, {running: 1, queued: 0, offscreen: 0}); await h.advance(180); expanded(h, language);
      h.panel()!.querySelector<HTMLButtonElement>('.fr-progress-dismiss')!.click(); await h.flush(); expect(h.panel()).toBeNull();
      await publish(h, sessionId, {running: 2, queued: 0, offscreen: 0}); await h.advance(1000); expect(h.panel()).toBeNull();
      finishFullPageTranslationProgress(sessionId); expect(progressApi.runFullPageFailureAction(sessionId, 'retry')).toBe(0);
      const next = startFullPageTranslationProgress(); await publish(h, next, {running: 1, queued: 0, offscreen: 0});
      await h.advance(180); expanded(h, language); finishFullPageTranslationProgress(next); await h.flush(); expect(h.panel()).toBeNull();
      expect(h.patches).toEqual([]);
    } finally {await h.close();}
  });

  it.each(['zh-CN', 'en-US'] as const)('%s 动态 key 面板的公开进度更新不建立自己的旧文案扫描器', async language => {
    const h = await fullRender(language);
    try {
      const sessionId = startFullPageTranslationProgress(); await publish(h, sessionId, {running: 1, queued: 201, offscreen: 7}); await h.advance(180);
      for (let index = 0; index < 100; index += 1) {await publish(h, sessionId, {running: 1, queued: 200 - index, offscreen: 7, completed: index}); expanded(h, language);}
      expect(h.metrics()).toEqual({treeWalkers: 0, wildcardQueries: 0, observers: 0});
    } finally {await h.close();}
  });

  it('当前语言真实资源到达后完整模板自动重绘，中文往返保留回退和 key 文案', async () => {
    const h = await fullRender('fr-FR', false);
    try {
      const sessionId = startFullPageTranslationProgress(); await publish(h, sessionId, {running: 0, queued: 0, offscreen: 4, modalPhase: 'waiting'});
      expanded(h, 'zh-CN'); expect(h.core.hasUiLanguageBundle('fr-FR')).toBe(false);
      await h.release('fr-FR'); expanded(h, 'fr-FR'); expect(h.context().bundleRevision.value).toBeGreaterThan(0);
      expect(await h.language('zh-CN')).toBe(true); expanded(h, 'zh-CN'); expect(await h.language('fr-FR')).toBe(true); expanded(h, 'fr-FR');
      expect(h.metrics().treeWalkers).toBe(0);
    } finally {await h.close();}
  });

  it('取消的旧语言加载不能覆盖后选语言的真实完整 DOM', async () => {
    const h = await fullRender('zh-CN', false);
    try {
      const sessionId = startFullPageTranslationProgress(); await publish(h, sessionId, {running: 0, queued: 0, offscreen: 2, modalPhase: 'waiting'});
      const old = h.context().setLanguage('en-US'); await h.flush(); const current = h.context().setLanguage('ja-JP'); await h.flush();
      await h.release('ja-JP'); expect(await current).toBe(true); await h.flush(); expanded(h, 'ja-JP');
      const settled = h.panel()!.outerHTML; await h.release('en-US'); expect(await old).toBe(false); await h.flush();
      expect(h.panel()!.outerHTML).toBe(settled); expect(h.context().language.value).toBe('ja-JP');
      expect(h.patches).toEqual([{uiLanguage: 'ja-JP', uiLanguageSetupCompleted: true}]);
    } finally {await h.close();}
  });

  it('卸载后的迟到真实资源不写旧 DOM，重新挂载使用新 context 与当前资源', async () => {
    const h = await fullRender('fr-FR', false);
    try {
      const sessionId = startFullPageTranslationProgress(); await publish(h, sessionId, {running: 0, queued: 0, offscreen: 2, modalPhase: 'waiting'});
      const oldPanel = h.panel()!, oldContext = h.context(); await h.unmount(); const oldDom = oldPanel.outerHTML;
      expect(h.listeners.size).toBe(0); expect(h.mediaListeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
      await h.release('fr-FR'); for (const callback of h.callbacks) callback({...h.config, uiLanguage: 'en-US'}); await h.flush();
      expect(oldPanel.outerHTML).toBe(oldDom); expect(oldContext.language.value).toBe('fr-FR'); expect(oldContext.bundleRevision.value).toBe(0);
      expect(h.root.innerHTML).toBe(''); await h.mount(); expect(h.context()).not.toBe(oldContext); expanded(h, 'fr-FR');
      finishFullPageTranslationProgress(sessionId); await h.flush(); expect(h.panel()).toBeNull();
      const next = startFullPageTranslationProgress(); await publish(h, next, {running: 1, queued: 0, offscreen: 0}); await h.advance(180); expanded(h, 'fr-FR');
    } finally {await h.close();}
  });

  it('真实 loader 失败保持中文 key 回退，并允许另一个语言成功刷新', async () => {
    const h = await fullRender('fr-FR', false);
    try {
      const sessionId = startFullPageTranslationProgress(); await publish(h, sessionId, {running: 0, queued: 0, offscreen: 2, modalPhase: 'waiting'});
      await h.release('fr-FR', new Error('controlled language fetch failure')); expanded(h, 'zh-CN'); expect(h.warns).toHaveLength(1);
      const next = h.context().setLanguage('en-US'); await h.flush(); await h.release('en-US'); expect(await next).toBe(true); await h.flush(); expanded(h, 'en-US');
    } finally {await h.close();}
  });

  it('外层 owned scanner 仍迁移旧 sibling，七语切换保留面板、宿主与非拥有正文', async () => {
    const h = await fullRender('en-US', true, true);
    try {
      const sessionId = startFullPageTranslationProgress(); await publish(h, sessionId, {running: 0, queued: 0, offscreen: 4, modalPhase: 'waiting'});
      for (const language of languages) {
        expect(await h.language(language)).toBe(true); expanded(h, language);
        const sibling = h.root.querySelector('[data-owned-legacy]')!, text = h.core.translateLegacyText('设置', language);
        expect(sibling.textContent).toBe(text); expect(sibling.getAttribute('title')).toBe(text); expect(sibling.getAttribute('aria-label')).toBe(text);
        h.assertHost();
      }
      expect(h.observers.some(entry => entry.root === h.root && entry.active)).toBe(true);
    } finally {await h.close();}
  });
});
