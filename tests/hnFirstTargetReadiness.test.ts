import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';
import {createTranslationSourceSnapshot} from '@/src/core/translation/public';
import {createTranslationCore} from './helpers/translationCore';

const require = createRequire(import.meta.url);
const harness = require('../scripts/run-site-translation-test.cjs');
const {CASES, normalizeCaseConfig} = require('../scripts/site-translation/case-config.cjs');
const selector = '.titleline > a';
type Query = {selector: string; index: number; source: string; sessionId: number};
type Receipt = Record<string, unknown>;
type FixtureOptions = {
  identicalOwners?: number[];
  missingOwners?: number[];
  sameFirstTwoTitles?: boolean;
  transformReceipt?: (receipt: Receipt, query: Query) => Receipt;
};

// 执行真实 case runner/tracker/owned-worker reader，只有浏览器输入和消息端口是离线夹具。
// 不启动浏览器，不请求线上服务；虚拟时间严格保留 30 秒首目标门槛。
async function withHnFixture(run: (fixture: ReturnType<typeof createFixture>) => Promise<void>, options: FixtureOptions = {}) {
  vi.useFakeTimers({toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance']});
  const fixture = createFixture(options);
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(fixture.globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
  }
  try {
    await harness.installCoverageTracker(fixture.page, fixture.rules);
    fixture.readCompletion = await harness.createUnchangedCompletionReader(fixture.context, fixture.page, 2000);
    await run(fixture);
  } finally {
    fixture.tracker()?.stop();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    vi.useRealTimers();
  }
}

function createFixture(options: FixtureOptions) {
  const titles = Array.from({length: 30}, (_, index) => index === 0 || (index === 1 && options.sameFirstTwoTitles)
    ? 'Claude Haiku 5.5' : `Story ${index + 1} explains browser translation testing`);
  const {document, window} = parseHTML(`<html><body><table>${titles.map((title, index) =>
    `<tr class="athing"><td class="votelinks">▲</td><td class="title"><span class="titleline"><a href="https://example.test/story-${index}">${title}</a><span class="sitebit comhead">(<a href="?from=example.test"><span class="sitestr">example.test</span></a>)</span></span></td></tr>`).join('')}</table><a class="morelink" href="?p=2">More</a></body></html>`);
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {configurable: true,
    value: () => ({width: 400, height: 30, top: 100, left: 0, right: 400, bottom: 130})});
  Object.defineProperty(document.body, 'scrollHeight', {value: 1600});
  Object.defineProperty(document.documentElement, 'scrollHeight', {value: 1600});
  Object.defineProperty(document, 'readyState', {value: 'complete'});
  Object.assign(window, {innerHeight: 900, scrollY: 0, scrollTo: (value: number | {top: number}) => {
    window.scrollY = typeof value === 'number' ? value : value.top;
  }});
  let deliver: (records: unknown[]) => void = () => {};
  class Observer {
    constructor(callback: typeof deliver) { deliver = callback; }
    observe() {}
    disconnect() {}
  }
  const url = 'https://news.ycombinator.com/';
  let active = false;
  let sessionId = 0;
  let toggleCount = 0;
  const identical = new Set(options.identicalOwners || [0]);
  const missing = new Set(options.missingOwners || []);
  const owner = (index = 0) => document.querySelectorAll(selector)[index]!;
  const artifactMutation = (target: Element, addedNodes: unknown[], removedNodes: unknown[]) =>
    deliver([{type: 'childList', target, addedNodes, removedNodes}]);
  const start = () => {
    active = true;
    sessionId += 1;
    titles.forEach((_, index) => {
      if (identical.has(index) || missing.has(index)) return;
      const wrapper = document.createElement('span');
      wrapper.className = 'fluent-read-bilingual-content';
      wrapper.setAttribute('data-fr-translation-owned', 'true');
      wrapper.textContent = `标题 ${index + 1} 的中文译文`;
      owner(index).append(wrapper);
      artifactMutation(owner(index), [wrapper], []);
    });
  };
  const restore = () => {
    active = false;
    document.querySelectorAll('[data-fr-translation-owned="true"]').forEach(wrapper => {
      const target = wrapper.parentElement!;
      wrapper.remove();
      artifactMutation(target, [], [wrapper]);
    });
  };
  const receipt = (query: Query): Receipt => {
    if (!active || query.sessionId !== sessionId || !identical.has(query.index) || missing.has(query.index)) {
      return {status: 'unavailable', reason: 'no-current-accepted-completion'};
    }
    const proof = {status: 'available', reason: 'accepted-result-identical', sessionId,
      source: query.source, sources: [query.source], outputs: [query.source], sourceCurrent: true,
      generation: 1, renderCommitGeneration: 1, configuredService: 'freeTranslation', targetLanguage: 'zh-CN',
      completedAtUnixMs: Date.now(), requestBoundary: 'accepted-same-session-result-reuse', upstreamDispatchAndRoute: 'unavailable'};
    return options.transformReceipt?.(proof, query) || proof;
  };
  const sendMessage = vi.fn((_id: number, message: {unchangedQueries: Query[]}, _options: unknown, reply: (value: unknown) => void) =>
    reply({status: 'success', sessionId: active ? sessionId : null, outcomes: message.unchangedQueries.map(receipt)}));
  const chrome = {runtime: {lastError: null}, tabs: {
    query: async () => [{id: 7, url}],
    get: (id: number, reply: (tab: unknown) => void) => reply({id, url}), sendMessage,
  }};
  const page = {
    url: () => url,
    evaluate: async (fn: (argument: any) => any, argument: unknown) => fn(argument),
    waitForTimeout: async (ms: number) => vi.advanceTimersByTimeAsync(ms),
    waitForFunction: async (fn: (argument: any) => any, argument: unknown, opts: {timeout: number; polling?: number}) => {
      const deadline = Date.now() + opts.timeout;
      while (Date.now() < deadline) {
        if (fn(argument)) return;
        await vi.advanceTimersByTimeAsync(Math.min(opts.polling || 100, deadline - Date.now()));
      }
      throw new Error(`page.waitForFunction: Timeout ${opts.timeout}ms exceeded.`);
    },
    keyboard: {down: async () => {}, up: async () => {}, press: async (key: string) => {
      expect(key).toBe('t');
      toggleCount += 1;
      if (active) restore(); else start();
    }},
    locator: () => ({first: () => ({scrollIntoViewIfNeeded: async () => { window.scrollY = 0; }})}),
  };
  const worker = {url: () => 'chrome-extension://owned/background.js',
    evaluate: async (fn: (argument: any) => any, argument: unknown) => fn(argument)};
  const config = normalizeCaseConfig('hacker-news-home', CASES['hacker-news-home']);
  return {document: document as unknown as Document, window, owner: owner as (index?: number) => HTMLElement,
    page, context: {serviceWorkers: () => [worker]}, rules: config.coverageRules, config, start, restore,
    readCompletion: undefined as any, sendMessage, sessionId: () => sessionId, toggleCount: () => toggleCount,
    tracker: () => (window as any)[harness.COVERAGE_TRACKER_KEY],
    hostMutation: (target: Node) => deliver([{type: 'characterData', target, addedNodes: [], removedNodes: []}]),
    globals: {window, document, Node: window.Node, HTMLElement: window.HTMLElement,
      HTMLAnchorElement: window.HTMLAnchorElement, MutationObserver: Observer, chrome,
      location: {href: url}, getComputedStyle: () => ({display: 'block', visibility: 'visible'})},
  };
}

async function begin(fixture: ReturnType<typeof createFixture>) {
  fixture.start();
  const identity = await harness.beginCoverageCompletionPass(fixture.page, fixture.readCompletion);
  return {identity, verify: (remaining = 2000) =>
    harness.verifyCoverageUnchanged(fixture.page, fixture.readCompletion, identity, remaining)};
}

describe('HN first target exact owner readiness', () => {
  it('resolves the real HN candidate to the title anchor and preserves its one exact source slot', async () => {
    await withHnFixture(async fixture => {
      const core = createTranslationCore({url: new URL(fixture.page.url()), scope: 'content'});
      const candidate = core.resolve(fixture.owner().firstChild);
      expect(candidate?.element).toBe(fixture.owner());
      expect(candidate?.nodes).toBeUndefined();
      const snapshot = createTranslationSourceSnapshot(fixture.owner(), core.shouldStayOriginal);
      expect(snapshot.slots).toHaveLength(1);
      expect(snapshot.slots[0].source).toBe('Claude Haiku 5.5');
    });
  });

  it('proves the wrapper-only gate false while the exact first owner is legitimately complete', async () => {
    await withHnFixture(async fixture => {
      const {verify} = await begin(fixture);
      await verify();
      expect(fixture.owner().querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(0);
      const report = await harness.readCoverageReport(fixture.page);
      expect(report[0]).toMatchObject({seenCount: 30, translatedCount: 29, verifiedUnchangedCount: 1, completedCount: 30});
      expect(() => harness.assertCoverageReport(fixture.rules, report, 'HN 30/30')).not.toThrow();
      const ready = await harness.waitForFullTargetReadiness(fixture.page, selector, 30000, verify);
      expect(ready).toMatchObject({ready: true, completion: 'verified-unchanged', target: {bilingualCount: 0}});
    });
  });

  it('runs real full case translate/restore/retranslate at 30/30 with a new session for unchanged first title', async () => {
    await withHnFixture(async fixture => {
      const contract = await harness.capturePageContract(fixture.page, [selector], ['.votelinks'], [selector, '.morelink'], [], []);
      const result = await harness.runFullCase(fixture.page, selector, [selector], fixture.rules, [], contract, [],
        '', '', false, 30000, undefined, fixture.readCompletion);
      expect(fixture.toggleCount()).toBe(3);
      expect(result.firstTargetReadiness.completion).toBe('verified-unchanged');
      expect(result.secondTargetReadiness.completion).toBe('verified-unchanged');
      expect(result.coverage[0]).toMatchObject({seenCount: 30, translatedCount: 29, verifiedUnchangedCount: 1, completedCount: 30});
      expect(result.retranslatedCoverage[0]).toMatchObject({seenCount: 30, translatedCount: 29, verifiedUnchangedCount: 1, completedCount: 30});
      expect(result.restoredCoverage.every((state: any) => state.ownedCount === 0 && state.changedCount === 0 && state.missingStaticCount === 0)).toBe(true);
      expect(result.secondCompletionIdentity.sessionId).not.toBe(result.firstCompletionIdentity.sessionId);
      expect(result.translatedPage).toMatchObject({totalBilingual: 29, uniqueWrapperParents: 29});
    });
  });

  it('retains the ordinary Chinese wrapper path without unchanged credit', async () => {
    await withHnFixture(async fixture => {
      const {verify} = await begin(fixture);
      const ready = await harness.waitForFullTargetReadiness(fixture.page, selector, 30000, verify);
      expect(ready).toMatchObject({ready: true, completion: 'translated', target: {bilingualCount: 1}});
      expect(fixture.sendMessage).toHaveBeenCalledTimes(1); // session lookup; no owner-proof query is needed
    }, {identicalOwners: []});
  });

  it('keeps all 30 exact unchanged owners in the full restore/retranslate contract even with zero wrappers', async () => {
    await withHnFixture(async fixture => {
      const contract = await harness.capturePageContract(fixture.page, [selector], [], [], [], []);
      const result = await harness.runFullCase(fixture.page, selector, [selector], fixture.rules, [], contract, [],
        '', '', false, 30000, undefined, fixture.readCompletion);
      expect(result.coverage[0]).toMatchObject({seenCount: 30, translatedCount: 0, verifiedUnchangedCount: 30, completedCount: 30});
      expect(result.retranslatedCoverage[0]).toMatchObject({seenCount: 30, translatedCount: 0, verifiedUnchangedCount: 30, completedCount: 30});
      expect(fixture.toggleCount()).toBe(3);
    }, {identicalOwners: Array.from({length: 30}, (_, index) => index)});
  });

  it('does not borrow a same-text neighbour receipt and fails within the original 30 seconds', async () => {
    await withHnFixture(async fixture => {
      const {verify} = await begin(fixture);
      const startedAt = Date.now();
      const error = await harness.waitForFullTargetReadiness(fixture.page, selector, 30000, verify).catch((value: Error) => value);
      expect(error.message).toContain('Timeout 30000ms');
      expect(Date.now() - startedAt).toBe(30000);
      expect(error.readinessDiagnostic.lastObservation).toMatchObject({completion: 'unresolved', target: {text: 'Claude Haiku 5.5'}});
      expect(error.readinessDiagnostic.lastVerification.queriedOwners).toEqual(expect.arrayContaining([
        expect.objectContaining({index: 0, source: 'Claude Haiku 5.5', status: 'unavailable',
          reason: 'no-current-accepted-completion', exactOwnerAccepted: false}),
      ]));
      expect(fixture.toggleCount()).toBe(0); // polling never triggers a shortcut or provider retry
    }, {sameFirstTwoTitles: true, identicalOwners: [1], missingOwners: [0]});
  });

  it('does not accept a replayed sibling status even when its text and session match', async () => {
    await withHnFixture(async fixture => {
      const {verify} = await begin(fixture);
      await verify();
      const tracker = fixture.tracker();
      const siblingStatuses = tracker.targetStatuses(selector, 1);
      expect(siblingStatuses[0].verifiedUnchanged).toBe(true);
      tracker.targetStatuses = () => siblingStatuses;
      expect(await harness.readFullTargetReadiness(fixture.page, selector)).toMatchObject({ready: false});
    }, {sameFirstTwoTitles: true, identicalOwners: [1], missingOwners: [0]});
  });

  it('can rebind a temporarily unavailable session by read-only polling within the same first-target deadline', async () => {
    await withHnFixture(async fixture => {
      fixture.sendMessage.mockImplementationOnce((_id, _message, _options, reply) =>
        reply({status: 'success', sessionId: null, outcomes: []}));
      const contract = await harness.capturePageContract(fixture.page, [selector], [], [], [], []);
      const result = await harness.runFullCase(fixture.page, selector, [selector], fixture.rules, [], contract, [],
        '', '', false, 30000, undefined, fixture.readCompletion);
      expect(result.firstTargetReadiness.completion).toBe('verified-unchanged');
      expect(result.coverage[0]).toMatchObject({seenCount: 30, completedCount: 30});
      expect(fixture.toggleCount()).toBe(3);
    });
  });

  it.each(['empty', 'stale-session', 'wrong-source', 'not-accepted'] as const)('rejects %s proof at the first target', async kind => {
    await withHnFixture(async fixture => {
      const {verify} = await begin(fixture);
      await verify();
      expect(await harness.readFullTargetReadiness(fixture.page, selector)).toMatchObject({ready: false, completion: 'unresolved'});
    }, {transformReceipt: (receipt, query) => kind === 'empty' ? {...receipt, outputs: ['   ']}
      : kind === 'stale-session' ? {...receipt, sessionId: query.sessionId + 1}
      : kind === 'wrong-source' ? {...receipt, source: 'A different title'}
      : {...receipt, reason: 'preflight-skip'}});
  });

  it('rejects same-text Text replacement, restoration and an old session in the next pass', async () => {
    await withHnFixture(async fixture => {
      const {identity, verify} = await begin(fixture);
      await verify();
      const owner = fixture.owner();
      owner.replaceChild(fixture.document.createTextNode('Claude Haiku 5.5'), owner.firstChild!);
      expect(await harness.readFullTargetReadiness(fixture.page, selector)).toMatchObject({ready: false});
      fixture.restore();
      expect(await harness.readFullTargetReadiness(fixture.page, selector)).toMatchObject({ready: false});
      fixture.start();
      const next = await harness.beginCoverageCompletionPass(fixture.page, fixture.readCompletion, identity.sessionId);
      await harness.verifyCoverageUnchanged(fixture.page, fixture.readCompletion, identity, 2000);
      expect(await harness.readFullTargetReadiness(fixture.page, selector)).toMatchObject({ready: false});
      expect(next.sessionId).not.toBe(identity.sessionId);
    });
  });

  it.each(['fluent-read-loading', 'fluent-read-retry-wrapper'])('does not certify an owner with %s', async className => {
    await withHnFixture(async fixture => {
      const {verify} = await begin(fixture);
      const artifact = fixture.document.createElement('span');
      artifact.className = className;
      artifact.setAttribute('data-fr-translation-owned', 'true');
      fixture.owner().append(artifact);
      await verify();
      expect(await harness.readFullTargetReadiness(fixture.page, selector)).toMatchObject({ready: false});
    });
  });

  it('does not let a completed first target excuse the 30th owner', async () => {
    await withHnFixture(async fixture => {
      const {verify} = await begin(fixture);
      await verify();
      expect(await harness.readFullTargetReadiness(fixture.page, selector)).toMatchObject({ready: true});
      const report = await harness.readCoverageReport(fixture.page);
      expect(report[0]).toMatchObject({seenCount: 30, completedCount: 29});
      expect(() => harness.assertCoverageReport(fixture.rules, report, 'HN 29/30')).toThrow('29/30');
    }, {missingOwners: [29]});
  });

  it('propagates the same deadline when the renderer stops answering', async () => {
    await withHnFixture(async fixture => {
      fixture.page.evaluate = async () => new Promise(() => {});
      const startedAt = Date.now();
      const waiting = harness.waitForFullTargetReadiness(fixture.page, selector, 30000).catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(30000);
      const error = await waiting;
      expect(error.message).toContain('Timeout 30000ms');
      expect(error.readinessDiagnostic).toMatchObject({observationStatus: 'unavailable'});
      expect(Date.now() - startedAt).toBe(30000);
    });
  });
});
