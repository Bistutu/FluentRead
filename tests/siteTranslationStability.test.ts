import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const require = createRequire(import.meta.url);
const {installStabilityProbeInPage, assertStableSnapshot, runStabilityProbes, runNativeCommentToggle} = require('../scripts/site-translation/stability-probes.cjs');
const {MarionetteClient, parseArgs: parseFirefoxArgs, assertPageSnapshot} = require('../scripts/testing/run-web-stability-firefox-test.cjs');
const {parseArgs: parseNativeFeedArgs, installNativeFeedTracker, assertNativeSnapshot} = require('../scripts/testing/run-web-native-feed-test.cjs');
const key = '__testStabilityProbe';
const wrapper = '.fluent-read-bilingual-content';
const source = 'This paragraph is a complete source passage with a protected ';

describe('live page controlled stability probe evidence', () => {
  let document: Document;
  let window: Window & Record<string, any>;
  let output: string;
  const translate = (node: Element) => {
    const translation = document.createElement('span');
    translation.className = 'fluent-read-bilingual-content';
    translation.setAttribute('data-fr-translation-owned', 'true');
    translation.textContent = '完整测试译文';
    node.append(translation);
    return translation;
  };
  const flush = async () => {await Promise.resolve(); await Promise.resolve();};
  const install = () => installStabilityProbeInPage({key, selector: '#source'});
  const probe = () => window[key];

  beforeEach(() => {
    ({document, window} = parseHTML(`<html><body><article><p id="source">${source}<code>API</code> and <a href="/reference">reference link</a>.</p></article></body></html>`) as unknown as {document: Document; window: Window & Record<string, any>});
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', window);
    vi.stubGlobal('MutationObserver', window.MutationObserver);
    translate(document.querySelector('#source')!);
    output = mkdtempSync(join(tmpdir(), 'fluentread-stability-test-'));
  });
  afterEach(() => {
    for (const name of Object.keys(window)) if (name.startsWith('__fluentReadStability_') || name === key) window[name]?.dispose?.();
    vi.unstubAllGlobals();
    rmSync(output, {recursive: true, force: true});
  });

  it('records source HTML without owned markup and rejects missing translated owners', () => {
    const installed = install();
    expect(installed.sourceText).toBe(`${source}API and reference link.`);
    expect(installed.baselineHtml).not.toContain('fluent-read');
    expect(assertStableSnapshot(probe().snapshot(), {phase: 'initial'}).owner.wrappers).toHaveLength(1);
    probe().dispose();
    document.querySelector(wrapper)!.remove();
    expect(install).toThrow('No translated source owner');
  });

  it('prefers a paragraph and does not choose nested translation or protected code as the source', () => {
    const title = document.createElement('h1'); title.id = 'title'; title.textContent = 'A translated title';
    document.body.prepend(title); translate(title);
    const code = document.createElement('code'); code.textContent = 'protected English text';
    document.body.append(code); translate(code);
    installStabilityProbeInPage({key, selector: '#title,code'});
    expect(probe().owner.id).toBe('source');
    expect(probe().owner.localName).toBe('p');
  });

  it('changes only one source Text identity and keeps protected elements intact', async () => {
    install(); const owner = probe().owner;
    const oldText = owner.firstChild, oldCode = owner.querySelector('code'), oldLink = owner.querySelector('a');
    const before = probe().snapshot(); probe().reset();
    expect(probe().replaceSourceText()).toEqual({text: source, equivalent: true});
    await flush();
    expect(owner.firstChild).not.toBe(oldText);
    expect(owner.querySelector('code')).toBe(oldCode);
    expect(owner.querySelector('a')).toBe(oldLink);
    assertStableSnapshot(probe().snapshot(), {phase: 'same-text', previousWrapperIds: before.owner.wrappers.map((item: any) => item.id)});
  });

  it('does not accept a removal without an actual repaired wrapper, duplicate wrappers or nesting', async () => {
    install(); probe().removeTranslation(); await flush();
    expect(() => assertStableSnapshot(probe().snapshot(), {phase: 'repair'})).toThrow('unexpected translation count');
    translate(probe().owner); await flush();
    assertStableSnapshot(probe().snapshot(), {phase: 'repair'});
    translate(probe().owner);
    expect(() => assertStableSnapshot(probe().snapshot(), {phase: 'duplicate'})).toThrow('unexpected translation count');
    const current = probe().owner.querySelector(wrapper); translate(current);
    expect(() => assertStableSnapshot(probe().snapshot(), {phase: 'nested'})).toThrow('nested translation wrappers');
  });

  it('tracks added source independently, requires translation and deletes only test additions at cleanup', () => {
    install(); const original = probe().owner;
    probe().append('dynamic');
    const sibling = original.nextElementSibling;
    expect(sibling.id).toBe('');
    expect(sibling.querySelector(wrapper)).toBeNull();
    expect(() => assertStableSnapshot(probe().snapshot(), {phase: 'dynamic'})).toThrow('unexpected translation count');
    translate(sibling);
    assertStableSnapshot(probe().snapshot(), {phase: 'dynamic'});
    probe().dispose();
    expect(window[key]).toBeUndefined();
    expect(original.isConnected).toBe(true);
    expect(sibling.isConnected).toBe(false);
  });

  it('rejects translation inserted inside an added paragraph protected subtree even when clean source HTML matches', () => {
    install(); probe().append('dynamic');
    const addition = probe().owner.nextElementSibling;
    translate(addition);
    translate(addition.querySelector('code')!);
    const snapshot = probe().snapshot();
    expect(snapshot.protectedIntact).toBe(true);
    expect(snapshot.additions[0].sourceHtml).toBe(snapshot.additions[0].originalHtml);
    expect(snapshot.additions[0].wrappers).toHaveLength(1);
    expect(snapshot.additions[0].allWrappers).toBe(2);
    expect(() => assertStableSnapshot(snapshot, {phase: 'dynamic-protected'})).toThrow('dynamic: protected source subtree changed');
  });

  it('rejects equivalent replacement of added protected links and additional descendant translation owners', () => {
    install(); probe().append('dynamic');
    const addition = probe().owner.nextElementSibling;
    translate(addition);
    const originalLink = addition.querySelector('a')!;
    const replacementLink = originalLink.cloneNode(true) as Element;
    originalLink.replaceWith(replacementLink);
    let snapshot = probe().snapshot();
    expect(snapshot.additions[0].sourceHtml).toBe(snapshot.additions[0].originalHtml);
    expect(() => assertStableSnapshot(snapshot, {phase: 'dynamic-identity'})).toThrow('dynamic: protected source subtree changed');
    replacementLink.replaceWith(originalLink);
    // The source snapshot strips owned artifacts; count every descendant so that stripping cannot certify an extra owner.
    const extraOwner = document.createElement('span');
    extraOwner.setAttribute('data-fr-translation-owned', 'true');
    addition.append(extraOwner); translate(extraOwner);
    snapshot = probe().snapshot();
    expect(snapshot.additions[0].protectedIntact).toBe(true);
    expect(snapshot.additions[0].sourceHtml).toBe(snapshot.additions[0].originalHtml);
    expect(snapshot.additions[0].wrappers).toHaveLength(1);
    expect(() => assertStableSnapshot(snapshot, {phase: 'dynamic-duplicate'})).toThrow('unexpected descendant translation count');
  });

  it('rejects source corruption, protected link changes and incomplete restoration anywhere on the page', () => {
    install(); const originalText = probe().owner.firstChild;
    originalText.data += ' changed';
    expect(() => assertStableSnapshot(probe().snapshot(), {phase: 'corrupt'})).toThrow('source HTML changed');
    originalText.data = source;
    probe().owner.querySelector('a').setAttribute('href', '/changed');
    expect(probe().snapshot().protectedIntact).toBe(false);
    probe().owner.querySelector('a').setAttribute('href', '/reference');
    probe().owner.querySelector(wrapper).remove();
    const unrelated = document.createElement('p'); unrelated.textContent = 'An unrelated source paragraph';
    document.body.append(unrelated); translate(unrelated);
    expect(() => assertStableSnapshot(probe().snapshot(), {phase: 'restore', translated: false})).toThrow('page translation remains');
  });

  it('records translation writes during quiet periods rather than passing a final-state-only sample', async () => {
    // Linkedom reports the observed root as childList.target for descendants;
    // supply the browser's actual target shape to validate this observer contract.
    let deliver: (records: unknown[]) => void = () => undefined;
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: (records: unknown[]) => void) {deliver = callback;}
      observe() {}
      disconnect() {}
      takeRecords() {return [];}
    });
    install(); probe().reset();
    const translation = probe().owner.querySelector(wrapper);
    translation.textContent = '被重写的测试译文';
    deliver([{type: 'childList', target: translation, addedNodes: [...translation.childNodes], removedNodes: []}]);
    expect(() => assertStableSnapshot(probe().snapshot(), {phase: 'quiet', quiet: true})).toThrow('translation changed during a quiet observation');
    probe().reset(); await flush();
    assertStableSnapshot(probe().snapshot(), {phase: 'settled', quiet: true});
    deliver([{type: 'childList', target: probe().owner.parentElement, addedNodes: [probe().owner], removedNodes: [probe().owner]}]);
    expect(() => assertStableSnapshot(probe().snapshot(), {phase: 'remounted', quiet: true})).toThrow('translation changed during a quiet observation');
  });

  it.each(['class', 'style', 'hidden'])('rejects transient %s changes on translation artifacts during a quiet period', attributeName => {
    let deliver: (records: unknown[]) => void = () => undefined;
    const observe = vi.fn();
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: (records: unknown[]) => void) {deliver = callback;}
      observe = observe;
      disconnect() {}
      takeRecords() {return [];}
    });
    install(); probe().reset();
    expect(observe).toHaveBeenCalledWith(probe().owner.parentElement, expect.objectContaining({attributes: true}));
    const translation = probe().owner.querySelector(wrapper);
    const before = translation.getAttribute(attributeName);
    translation.setAttribute(attributeName, attributeName === 'class' ? 'fluent-read-bilingual-content temporary-class' : 'temporary');
    if (before === null) translation.removeAttribute(attributeName); else translation.setAttribute(attributeName, before);
    deliver([{type: 'attributes', target: translation, attributeName}]);
    expect(() => assertStableSnapshot(probe().snapshot(), {phase: 'attribute-flicker', quiet: true})).toThrow('translation changed during a quiet observation');
  });

  it('ignores unrelated host attributes but rejects attributes on an owned non-wrapper artifact', () => {
    let deliver: (records: unknown[]) => void = () => undefined;
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: (records: unknown[]) => void) {deliver = callback;}
      observe() {}
      disconnect() {}
      takeRecords() {return [];}
    });
    install(); probe().reset();
    const owner = probe().owner;
    owner.setAttribute('title', 'Host metadata');
    deliver([{type: 'attributes', target: owner, attributeName: 'title'}]);
    assertStableSnapshot(probe().snapshot(), {phase: 'host-metadata', quiet: true});
    const artifact = document.createElement('span');
    artifact.setAttribute('data-fr-translation-owned', 'true');
    owner.appendChild(artifact);
    probe().reset();
    artifact.style.opacity = '0';
    deliver([{type: 'attributes', target: artifact, attributeName: 'style'}]);
    expect(() => assertStableSnapshot(probe().snapshot(), {phase: 'owned-attribute', quiet: true})).toThrow('translation changed during a quiet observation');
  });

  const pageDouble = (repair = true) => {
    let active = true;
    const advance = async () => {
      // 这里只模拟待测驱动器的外部页面合同，绝不作为扩展产品行为证据。
      if (active && repair) for (const node of document.querySelectorAll('article > p')) if (!node.querySelector(wrapper)) translate(node);
      await flush();
    };
    return {
      page: {
        evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
        waitForTimeout: advance,
        waitForFunction: async (fn: (arg: any) => any, arg: any) => {
          await advance();
          if (!fn(arg)) throw new Error('Test page wait failed');
        },
        screenshot: vi.fn(async () => undefined),
      },
      toggleFull: async () => {active = !active; if (!active) document.querySelectorAll(wrapper).forEach(node => node.remove()); await advance();},
    };
  };

  it('runs every required probe and writes truthful boundaries and cleanup in its persisted report', async () => {
    const {page, toggleFull} = pageDouble();
    const report = await runStabilityProbes({page, toggleFull, selector: '#source', artifactsDir: output, observeMs: 500});
    expect(report.ok).toBe(true);
    expect(report.probeResourcesReleased).toBe(true);
    expect(report.scope).toBe('controlled-host-mutations-on-live-page');
    expect(report.contractVersion).toBe(2);
    expect(report.steps.map((step: any) => step.name)).toEqual(['quiet', 'same-text-replacement', 'removed-wrapper-repaired',
      'repair-settled', 'dynamic-append', 'restore', 'retranslate', 'stopped-session']);
    expect(report.steps.every((step: any) => step.ok)).toBe(true);
    expect(document.querySelectorAll('article > p')).toHaveLength(1);
    expect(document.querySelector(wrapper)).toBeNull();
    expect(JSON.parse(readFileSync(join(output, 'stability-probes.json'), 'utf8'))).toEqual(report);
  });

  it('persists failed evidence and releases probe resources even when the page never repairs', async () => {
    const {page, toggleFull} = pageDouble(false);
    await expect(runStabilityProbes({page, toggleFull, selector: '#source', artifactsDir: output, observeMs: 500})).rejects.toThrow('Test page wait failed');
    const report = JSON.parse(readFileSync(join(output, 'stability-probes.json'), 'utf8'));
    expect(report.ok).toBe(false);
    expect(report.error).toContain('Test page wait failed');
    expect(report.failureSnapshot.owner.wrappers).toHaveLength(0);
    expect(report.probeResourcesReleased).toBe(true);
    expect(Object.keys(window).filter(name => name.startsWith('__fluentReadStability_'))).toEqual([]);
  });

  const nativeCommentPage = (trusted = true) => {
    document.body.innerHTML = '<table><tbody><tr class="comtr" id="9224"><td><a class="togg clicky" id="9224" n="3">[–]</a><div class="comment"><div class="commtext c00"><p>A complete native discussion paragraph.</p></div></div></td></tr></tbody></table>';
    translate(document.querySelector('.commtext p')!);
    vi.stubGlobal('location', {hostname: 'news.ycombinator.com'});
    vi.stubGlobal('CSS', {escape: (value: string) => value});
    vi.stubGlobal('getComputedStyle', (node: Element) => ({display: node.classList.contains('noshow') ? 'none' : 'block'}));
    return {
      evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
      waitForTimeout: async () => undefined,
      waitForFunction: async (fn: (arg: any) => any, arg: any) => {if (!fn(arg)) throw new Error('Native wait failed');},
      locator: (selector: string) => ({
        scrollIntoViewIfNeeded: async () => undefined,
        click: async () => {
          const control = document.querySelector(selector)!;
          const event = new window.Event('click', {bubbles: true});
          Object.defineProperty(event, 'isTrusted', {value: trusted});
          control.dispatchEvent(event);
          const row = control.closest('tr')!;
          row.classList.toggle('coll');
          row.querySelector('.comment')!.classList.toggle('noshow');
          control.textContent = row.classList.contains('coll') ? '[3 more]' : '[–]';
        },
      }),
      screenshot: vi.fn(async () => undefined),
    };
  };

  it('checks the observed native HN collapse classes, trusted input, expansion and cleanup', async () => {
    const report = await runNativeCommentToggle({page: nativeCommentPage(), artifactsDir: output});
    expect(report.ok).toBe(true);
    expect(report.steps.map((step: any) => step.name)).toEqual(['collapsed', 'expanded']);
    expect(report.steps[0].snapshot.display).toBe('none');
    expect(report.steps[1].snapshot.wrapperCount).toBe(1);
    expect(report.probeResourcesReleased).toBe(true);
    expect(document.querySelector('.comtr')!.classList.contains('coll')).toBe(false);
    expect(Object.keys(window).filter(name => name.startsWith('__fluentReadNativeComment_'))).toEqual([]);
  });

  it('rejects synthetic comment clicks and restores the native expansion before releasing its listener', async () => {
    await expect(runNativeCommentToggle({page: nativeCommentPage(false), artifactsDir: output})).rejects.toThrow('not a trusted click');
    const report = JSON.parse(readFileSync(join(output, 'native-comment-toggle.json'), 'utf8'));
    expect(report.ok).toBe(false);
    expect(report.probeResourcesReleased).toBe(true);
    expect(document.querySelector('.comtr')!.classList.contains('coll')).toBe(false);
  });
});

describe('Firefox stability transport and acceptance contracts', () => {
  const socketDouble = () => {
    const socket = new EventEmitter() as EventEmitter & {write: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>};
    socket.write = vi.fn((_value: string, callback: (error?: Error) => void) => callback());
    socket.destroy = vi.fn(() => socket.emit('close'));
    return socket;
  };
  const packet = (value: unknown) => {
    const json = JSON.stringify(value);
    return Buffer.from(`${Buffer.byteLength(json)}:${json}`);
  };

  it('pairs out-of-order Unicode responses and supports split and coalesced protocol frames', async () => {
    const socket = socketDouble(), client = new MarionetteClient(socket, 1000);
    const first = client.send('First'), second = client.send('Second');
    const response = Buffer.concat([packet({applicationType: 'gecko', marionetteProtocol: 3}), packet([1, 2, null, {value: '译文'}]), packet([1, 1, null, {value: 'first'}])]);
    socket.emit('data', response.subarray(0, 7)); socket.emit('data', response.subarray(7, response.length - 2));
    socket.emit('data', response.subarray(response.length - 2));
    await expect(first).resolves.toEqual({value: 'first'});
    await expect(second).resolves.toEqual({value: '译文'});
    expect(client.greeting.marionetteProtocol).toBe(3);
    expect(client.pending.size).toBe(0); client.close();
  });

  it('bounds unresponsive commands and clears all pending operations when the transport closes', async () => {
    const socket = socketDouble(), client = new MarionetteClient(socket, 10);
    await expect(client.send('NeverReplies')).rejects.toThrow('timed out: NeverReplies');
    expect(client.pending.size).toBe(0);
    const pending = client.send('InFlight');
    socket.emit('close');
    await expect(pending).rejects.toThrow('transport closed');
    expect(client.pending.size).toBe(0);
    await expect(client.send('AfterClose')).rejects.toThrow('transport is closed');
  });

  it('rejects malformed framing and retains the actual Firefox command error', async () => {
    const socket = socketDouble(), client = new MarionetteClient(socket, 1000);
    const failed = client.send('BadCommand');
    socket.emit('data', packet([1, 1, {error: 'invalid argument', message: 'wrong window'}, null]));
    await expect(failed).rejects.toThrow('BadCommand');
    const malformed = client.send('BadFrame'); socket.emit('data', Buffer.from('abc:invalid'));
    await expect(malformed).rejects.toThrow('Malformed Marionette frame');
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('refuses foreground/headless fallback and unbounded deadlines', () => {
    expect(() => parseFirefoxArgs(['--headed'])).toThrow('Only visible background');
    expect(() => parseFirefoxArgs(['--headless'])).toThrow('Only visible background');
    expect(() => parseFirefoxArgs(['--timeout', '0'])).toThrow('timeout must');
    expect(parseFirefoxArgs(['--extension-dir', '/tmp/build', '--artifacts-dir', '/tmp/evidence', '--live']).live).toBe(true);
  });

  it('requires per-source completion, exact restoration, protected content and trusted shortcuts', () => {
    const state = {blocks: Array.from({length: 3}, () => ({connected: true, original: 'source', current: 'source', translations: ['译文'], pending: 0})),
      protectedIntact: true, protectedCount: 1, nested: 0, duplicateParents: 0, pending: 0, wrappers: 3, keys: [{trusted: true}]};
    expect(() => assertPageSnapshot(state, true, 'translated')).not.toThrow();
    const missing = structuredClone(state); missing.blocks[1].translations = [];
    expect(() => assertPageSnapshot(missing, true, 'missing')).toThrow('exactly one translation');
    const untrusted = structuredClone(state); untrusted.keys[0].trusted = false;
    expect(() => assertPageSnapshot(untrusted, true, 'untrusted')).toThrow('trusted full-page shortcut');
    const restored = structuredClone(state); restored.blocks.forEach(block => {block.translations = [];}); restored.wrappers = 1;
    expect(() => assertPageSnapshot(restored, false, 'restore')).toThrow('page wrappers remain');
  });
});

describe('controlled provider attribution', () => {
  const {installControlledProvider} = require('../scripts/site-translation/controlled-provider.cjs');
  const transportGlobal = globalThis as typeof globalThis & {__frCompatibilityTransport?: {requests: number; texts: number; active: number}};
  const originalFetch = globalThis.fetch;
  afterEach(() => {globalThis.fetch = originalFetch; delete transportGlobal.__frCompatibilityTransport;});
  async function setup() {
    const worker = {url: () => 'chrome-extension://isolated/background.js', evaluate: async (fn: () => unknown) => fn()};
    let workers = [worker];
    const context = Object.assign(new EventEmitter(), {serviceWorkers: () => workers});
    const popup = {goto: vi.fn(), evaluate: vi.fn().mockResolvedValue({success: true}), close: vi.fn()};
    const api = await installControlledProvider(context, async () => popup, 1000);
    return {api, context, worker, setWorkers: (next: typeof workers) => {workers = next;}};
  }
  it('requires actual completed controlled response evidence, leaving unrelated network reads alone', async () => {
    const fetchOther = vi.fn().mockResolvedValue(new Response('public page'));
    globalThis.fetch = fetchOther;
    const {api, context} = await setup();
    await expect(api.snapshot()).rejects.toThrow('no completed request evidence');
    const result = await fetch('https://edge.microsoft.com/translate/translatetext', {method: 'POST', body: JSON.stringify(['Reading source'])});
    expect(await result.json()).toEqual([{translations: [{text: '测试译文：Reading source'}]}]);
    await expect(api.snapshot()).resolves.toMatchObject({mode: 'controlled-microsoft-response', workerCount: 1, requests: 1, texts: 1, active: 0});
    expect(await (await fetch('https://example.test/public')).text()).toBe('public page');
    expect(fetchOther).toHaveBeenCalledOnce();
    api.dispose(); expect(context.listenerCount('serviceworker')).toBe(0);
  });
  it('fails closed if the instrumented worker is missing, its state is absent, or the worker restarts', async () => {
    const {api, context, worker, setWorkers} = await setup();
    setWorkers([]); await expect(api.snapshot()).rejects.toThrow('changed or disappeared');
    setWorkers([worker]); delete transportGlobal.__frCompatibilityTransport;
    await expect(api.snapshot()).rejects.toThrow('no completed request evidence');
    context.emit('serviceworker', {...worker}); await Promise.resolve();
    await expect(api.snapshot()).rejects.toThrow('changed or disappeared');
    api.dispose();
  });
});

describe('native public feed evidence negative controls', () => {
  const validState = () => ({sources: [{id: 1, visible: true, eligible: true, sourceText: 'Public source paragraph',
    firstObservedWrappers: 0, sourceIntact: true, protectedIntact: true, protectedCount: 1,
    translations: ['测试译文：Public source paragraph'], pending: 0}], nested: 0, duplicateParents: 0, wrappers: 1, pending: 0});
  it('requires explicit network authorization and refuses foreground modes and unbounded scroll loops', () => {
    expect(() => parseNativeFeedArgs([])).toThrow('allow-network');
    expect(() => parseNativeFeedArgs(['--headed'])).toThrow('Unsupported argument');
    const required = ['--allow-network', '--extension-dir', '/tmp/extension', '--playwright-root', '/tmp/modules', '--artifacts-dir', '/tmp/evidence'];
    expect(() => parseNativeFeedArgs([...required, '--max-scrolls', '31'])).toThrow('max-scrolls');
    expect(parseNativeFeedArgs(required)).toMatchObject({allowNetwork: true, maxScrolls: 20});
  });
  it('accepts only the current per-source evidence and requires full-page restoration', () => {
    const state = validState();
    expect(assertNativeSnapshot(state, {translated: true, ids: [1], phase: 'valid'})).toBe(1);
    state.sources[0].translations = [];
    expect(() => assertNativeSnapshot(state, {translated: false, ids: [1], phase: 'restore'})).toThrow('page wrappers remain');
    state.wrappers = 0;
    expect(assertNativeSnapshot(state, {translated: false, ids: [1], phase: 'restored'})).toBe(1);
  });
  it('reads Mastodon explicit prose through its observed top-level shell while preserving local protected text', () => {
    const {document, window} = parseHTML('<html><body><div id="mastodon" class="notranslate app-holder"><article data-id="post-1"><div class="status__content__text"><p>Hello public prose with <a class="mention" href="/@sample">测试译文：@sample</a> and <span class="notranslate">private local text</span>.</p></div></article></div></body></html>');
    for (const element of document.querySelectorAll('*')) Object.defineProperty(element, 'getBoundingClientRect', {
      value: () => ({left: 10, top: 20, right: 700, bottom: 300, width: 690, height: 280}), configurable: true,
    });
    Object.defineProperty(document, 'scrollingElement', {value: document.documentElement, configurable: true});
    vi.stubGlobal('document', document); vi.stubGlobal('window', window);
    vi.stubGlobal('MutationObserver', window.MutationObserver);
    vi.stubGlobal('getComputedStyle', () => ({display: 'block', visibility: 'visible', overflowX: 'visible', overflowY: 'visible'}));
    vi.stubGlobal('innerWidth', 1280); vi.stubGlobal('innerHeight', 816); vi.stubGlobal('scrollY', 0);
    vi.stubGlobal('location', {href: 'https://mastodon.social/@Mastodon'});
    const trackerKey = '__nativeFeedSourceTest';
    try {
      let state = installNativeFeedTracker(trackerKey);
      expect(state.sources).toHaveLength(1);
      expect(state.sources[0]).toMatchObject({eligible: true, sourceText: 'Hello public prose with and .', firstObservedWrappers: 0, protectedIntact: true});
      const wrapper = document.createElement('span'); wrapper.className = 'fluent-read-bilingual-content';
      wrapper.innerHTML = '<a href="/@sample">测试译文：@sample</a> 测试译文：Hello public prose with and .';
      document.querySelector('p')!.append(wrapper);
      state = (window as any)[trackerKey].snapshot();
      expect(state.sources[0].renderedTranslations[0]).toMatch(/^测试译文：@sample/);
      expect(assertNativeSnapshot(state, {translated: true, ids: [1], phase: 'protected-prefix'})).toBe(1);
      wrapper.innerHTML = '<a href="/@sample">测试译文：@sample</a> Unproven body response';
      state = (window as any)[trackerKey].snapshot();
      expect(() => assertNativeSnapshot(state, {translated: true, ids: [1], phase: 'prefix-only-in-protected-text'})).toThrow('controlled response not proven');
      wrapper.remove();
      (window as any)[trackerKey].dispose();
      document.querySelector('#mastodon')!.id = 'ordinary-protected-container';
      state = installNativeFeedTracker(trackerKey);
      expect(state.sources[0]).toMatchObject({eligible: false, sourceText: ''});
    } finally {
      (window as any)[trackerKey]?.dispose(); vi.unstubAllGlobals();
    }
  });
  it.each<[string, (state: ReturnType<typeof validState>) => void, RegExp]>([
    ['missing source', state => {state.sources = [];}, /no visible source/],
    ['late baseline', state => {state.sources[0].firstObservedWrappers = 1;}, /baseline was captured/],
    ['changed HTML', state => {state.sources[0].sourceIntact = false;}, /original HTML changed/],
    ['changed protected subtree', state => {state.sources[0].protectedIntact = false;}, /protected link\/code changed/],
    ['missing translation', state => {state.sources[0].translations = [];}, /wrong translation count/],
    ['pending translation', state => {state.sources[0].pending = 1;}, /pending or retry/],
    ['unproven response', state => {state.sources[0].translations = ['Unknown provider response'];}, /controlled response not proven/],
    ['prefix without matching source', state => {state.sources[0].translations = ['测试译文：An unrelated sentence'];}, /controlled response not proven/],
    ['nested wrapper', state => {state.nested = 1;}, /nested wrappers/],
    ['duplicate parent', state => {state.duplicateParents = 1;}, /duplicate wrappers/],
    ['protected-only source translated', state => {state.sources.push({...state.sources[0], id: 2, eligible: false, sourceText: ''});}, /protected-only source received/],
  ])('rejects %s', (_label, change, reason) => {
    const state = validState(); change(state);
    expect(() => assertNativeSnapshot(state, {translated: true, ids: [1], phase: 'negative'})).toThrow(reason);
  });
});
