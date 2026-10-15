/**
 * @file tests/videoPlayerBinding.test.ts
 * 文件职责：验证播放器入口绑定在原生控制栏、信息流 fallback、禁用和视频切换时的节点所有权。
 * 主要内容：覆盖进度徽标、悬浮/聚焦可见性、原生控件重挂载和清理行为；实际观察器回调识别所持控制栏中的本实例按钮副本，保留其他实例和 tooltip 噪声边界。
 * 模块边界：使用注入的定位器与按钮工厂，不启动 content runtime 或字幕识别。
 */

import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';

vi.mock('@wxt-dev/storage', () => ({storage: {getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), watch: vi.fn(() => () => undefined)}}));
vi.mock('@/src/platform/storage/configStorageRuntime', () => ({configStorage: {getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), watch: vi.fn(() => () => undefined)}}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: vi.fn(), getURL: vi.fn(() => 'icon.png')}}}));

import {createVideoPlayerBinding} from '@/src/features/video-subtitle/content/videoPlayerBinding';
import type {VideoPlayerLocator, VideoPlayerTarget} from '@/src/features/video-subtitle/content/videoPlayerLocator';

function createFixture(markup = '<div class="player"><video></video><div class="ytp-right-controls"><button>settings</button><button>other</button></div></div>') {
  const parsed = parseHTML(`<!doctype html><body>${markup}</body>`);
  const view = parsed.window;
  vi.stubGlobal('window', view);
  vi.stubGlobal('document', parsed.document);
  vi.stubGlobal('Element', view.Element);
  vi.stubGlobal('Node', view.Node);
  vi.stubGlobal('HTMLButtonElement', view.HTMLButtonElement);
  vi.stubGlobal('MutationObserver', class {
    observe() {}
    disconnect() {}
  });
  const player = parsed.document.querySelector<HTMLElement>('.player')!;
  const video = player.querySelector<HTMLVideoElement>('video')!;
  Object.defineProperty(video, 'getBoundingClientRect', {value: () => ({width: 640, height: 360, top: 0, left: 0, right: 640, bottom: 360})});
  Object.defineProperty(video, 'offsetWidth', {value: 640});
  Object.defineProperty(video, 'offsetHeight', {value: 360});
  const target: VideoPlayerTarget = {video, player, key: 'video:one', fullscreen: false, interacting: false};
  let current: VideoPlayerTarget | null = target;
  let listener: ((value: VideoPlayerTarget | null) => void) | undefined;
  const locator: VideoPlayerLocator = {
    getTarget: () => current,
    sync: () => current,
    subscribe: (next) => { listener = next; return () => undefined; },
    destroy: vi.fn(),
  };
  return {
    document: parsed.document,
    window: view,
    player,
    video,
    target,
    locator,
    setTarget: (next: VideoPlayerTarget | null) => {current = next; listener?.(next);},
    emit: (next: VideoPlayerTarget | null) => listener?.(next),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('native picture-in-picture and fullscreen anchors', () => {
  it.each(['before-live', 'after-live'] as const)('observer removes a same-host copied entry %s without a manual sync', placement => {
    const fixture = createFixture('<div class="player"><video></video><div class="ytp-right-controls"><button>settings</button><button class="ytp-fullscreen-button">full</button></div></div>');
    let notify!: MutationCallback;
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: MutationCallback) {notify = callback;}
      observe() {}
      disconnect() {}
    });
    const click = vi.fn();
    const createButton = vi.fn(() => {
      const button = fixture.document.createElement('button');
      button.id = 'fluent-read-video-subtitle-button';button.addEventListener('click', click);return button;
    });
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
      getState: () => ({enabled: true}), createButton});
    const live = createButton.mock.results[0].value, host = live.parentElement!;
    const clone = live.cloneNode(true) as HTMLButtonElement;
    clone.dispatchEvent(new fixture.window.Event('click', {bubbles: true}));
    expect(click).not.toHaveBeenCalled();
    // 追加在 fullscreen 之后同样不改变 live 的 nextElementSibling，两个分支都须由副本身份触发。
    if (placement === 'before-live') host.insertBefore(clone, live); else host.appendChild(clone);
    const scans = vi.spyOn(fixture.locator, 'sync');
    notify([{type: 'childList', target: host, addedNodes: [clone], removedNodes: []}] as unknown as MutationRecord[], {} as MutationObserver);
    expect(scans).toHaveBeenCalledOnce();expect(createButton).toHaveBeenCalledOnce();
    expect(host.querySelectorAll('#fluent-read-video-subtitle-button')).toHaveLength(1);
    expect(clone.isConnected).toBe(false);expect(live.parentElement).toBe(host);
    live.dispatchEvent(new fixture.window.Event('click', {bubbles: true}));expect(click).toHaveBeenCalledOnce();
    binding.destroy();scans.mockRestore();
  });

  it('observer repairs an entire copied control host with the live listener intact', () => {
    const fixture = createFixture();
    let notify!: MutationCallback;
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: MutationCallback) {notify = callback;}
      observe() {}
      disconnect() {}
    });
    const click = vi.fn(), live = fixture.document.createElement('button');
    live.id = 'fluent-read-video-subtitle-button';live.addEventListener('click', click);
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
      getState: () => ({enabled: true}), createButton: () => live});
    const previous = live.parentElement!, replacement = previous.cloneNode(true) as HTMLElement;
    previous.replaceWith(replacement);
    notify([{type: 'childList', target: fixture.player, addedNodes: [replacement], removedNodes: [previous]}] as unknown as MutationRecord[], {} as MutationObserver);
    expect(replacement.querySelectorAll('#fluent-read-video-subtitle-button')).toHaveLength(1);
    expect(live.parentElement).toBe(replacement);live.dispatchEvent(new fixture.window.Event('click', {bubbles: true}));
    expect(click).toHaveBeenCalledOnce();binding.destroy();
  });

  it('observer ignores other-owner and tooltip updates, and is inert after destroy', () => {
    const fixture = createFixture('<div class="player"><video></video><div class="ytp-right-controls"><button>settings</button><button class="ytp-fullscreen-button">full</button></div></div>');
    let notify!: MutationCallback;
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: MutationCallback) {notify = callback;}
      observe() {}
      disconnect() {}
    });
    const live = fixture.document.createElement('button');live.id = 'fluent-read-video-subtitle-button';
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
      getState: () => ({enabled: true}), createButton: () => live});
    const host = live.parentElement!, foreign = live.cloneNode(true) as HTMLButtonElement;
    foreign.setAttribute('data-fluent-read-video-binding-owner', 'another-binding');host.insertBefore(foreign, live);
    const tooltip = fixture.document.createElement('span');live.appendChild(tooltip);
    const scans = vi.spyOn(fixture.locator, 'sync');
    notify([
      {type: 'childList', target: host, addedNodes: [foreign], removedNodes: []},
      {type: 'childList', target: live, addedNodes: [tooltip], removedNodes: []},
    ] as unknown as MutationRecord[], {} as MutationObserver);
    expect(scans).not.toHaveBeenCalled();expect(foreign.isConnected).toBe(true);
    const lateCopy = live.cloneNode(true) as HTMLButtonElement;
    binding.destroy();host.appendChild(lateCopy);
    notify([{type: 'childList', target: host, addedNodes: [lateCopy], removedNodes: []}] as unknown as MutationRecord[], {} as MutationObserver);
    expect(scans).not.toHaveBeenCalled();expect(lateCopy.isConnected).toBe(true);expect(foreign.isConnected).toBe(true);
    scans.mockRestore();
  });

  it.each([false, true])('keeps only the live button after a controls deep clone (new media: %s)', newMedia => {
    const fixture = createFixture();
    const click = vi.fn();
    const created: HTMLButtonElement[] = [];
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
      getState: () => ({enabled: true}), createButton: () => {
        const button = fixture.document.createElement('button');
        button.id = 'fluent-read-video-subtitle-button';
        button.dataset.fluentReadClickBound = 'true';
        button.addEventListener('click', click);
        created.push(button);
        return button;
      }});
    const original = created[0];
    const controls = original.parentElement!;
    const replacement = controls.cloneNode(true) as HTMLElement;
    const copiedButton = replacement.querySelector<HTMLButtonElement>('#fluent-read-video-subtitle-button')!;
    expect(copiedButton.dataset.fluentReadClickBound).toBe('true');
    copiedButton.dispatchEvent(new fixture.window.Event('click', {bubbles: true}));
    expect(click).not.toHaveBeenCalled();
    controls.replaceWith(replacement);
    if (newMedia) fixture.setTarget({...fixture.target, key: 'video:ad'});
    else binding.sync();
    expect(replacement.querySelectorAll('#fluent-read-video-subtitle-button')).toHaveLength(1);
    const live = created[created.length - 1];
    expect(live.parentElement).toBe(replacement);
    expect(copiedButton.isConnected).toBe(false);
    live.dispatchEvent(new fixture.window.Event('click', {bubbles: true}));
    expect(click).toHaveBeenCalledOnce();
    expect(created).toHaveLength(newMedia ? 2 : 1);
    if (newMedia) expect(live).not.toBe(original);
    binding.destroy();
    expect(replacement.querySelectorAll('#fluent-read-video-subtitle-button')).toHaveLength(0);
  });

  it.each(['move', 'empty-replacement'] as const)('retains the same live button for a controls %s', change => {
    const fixture = createFixture();
    const click = vi.fn();
    const createButton = vi.fn(() => {
      const button = fixture.document.createElement('button');
      button.id = 'fluent-read-video-subtitle-button';
      button.addEventListener('click', click);
      return button;
    });
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
      getState: () => ({enabled: true}), createButton});
    const button = createButton.mock.results[0].value;
    const previous = button.parentElement!;
    let host = previous;
    if (change === 'move') {
      const wrapper = fixture.document.createElement('div');
      fixture.player.appendChild(wrapper); wrapper.appendChild(previous);
    } else {
      host = fixture.document.createElement('div'); host.className = 'ytp-right-controls';
      previous.replaceWith(host);
    }
    binding.sync();
    expect(host.querySelectorAll('#fluent-read-video-subtitle-button')).toHaveLength(1);
    expect(button.parentElement).toBe(host);
    expect(createButton).toHaveBeenCalledOnce();
    button.dispatchEvent(new fixture.window.Event('click', {bubbles: true}));
    expect(click).toHaveBeenCalledOnce();
    binding.destroy();
    expect(host.querySelectorAll('#fluent-read-video-subtitle-button')).toHaveLength(0);
  });

  it('cleans its held host on destroy without deleting another binding or same-id page nodes', () => {
    const fixture = createFixture();
    const createButton = () => {
      const button = fixture.document.createElement('button');
      button.id = 'fluent-read-video-subtitle-button';
      return button;
    };
    const first = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
      getState: () => ({enabled: true}), createButton});
    const second = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
      getState: () => ({enabled: true}), createButton});
    const host = fixture.player.querySelector<HTMLElement>('.ytp-right-controls')!;
    const [firstButton, secondButton] = Array.from(host.querySelectorAll<HTMLButtonElement>('#fluent-read-video-subtitle-button'));
    const clone = firstButton.cloneNode(true) as HTMLButtonElement;
    host.appendChild(clone);
    const pageButton = createButton(); host.appendChild(pageButton);
    const outside = firstButton.cloneNode(true) as HTMLButtonElement;
    fixture.document.body.appendChild(outside);
    first.destroy();
    expect(firstButton.isConnected).toBe(false);
    expect(clone.isConnected).toBe(false);
    expect(secondButton.isConnected).toBe(true);
    expect(pageButton.isConnected).toBe(true);
    expect(outside.isConnected).toBe(true);
    second.destroy();
    expect(secondButton.isConnected).toBe(false);
  });

  it('cleans copies left in the previous held host while moving to new native controls', () => {
    const fixture = createFixture('<div class="player"><video></video></div>');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
      getState: () => ({enabled: true}), createButton: () => {
        const button = fixture.document.createElement('button');
        button.id = 'fluent-read-video-subtitle-button'; return button;
      }});
    fixture.video.dispatchEvent(new fixture.window.Event('pointerover', {bubbles: true}));
    const previous = fixture.player.querySelector<HTMLElement>('.fluent-read-video-controls')!;
    const button = previous.querySelector<HTMLButtonElement>('button')!;
    const clone = button.cloneNode(true) as HTMLButtonElement; previous.appendChild(clone);
    const controls = fixture.document.createElement('div'); controls.className = 'ytp-right-controls';
    fixture.player.appendChild(controls);
    binding.sync();
    expect(clone.isConnected).toBe(false);
    expect(button.parentElement).toBe(controls);
    expect(previous.querySelectorAll('button')).toHaveLength(0);
    binding.destroy();
  });

  it('ignores caption element and icon churn while rebinding native button and host structure', () => {
    const fixture = createFixture('<div class="player"><video></video><div class="captions"></div><div class="ytp-right-controls"><button aria-label="Settings"><span>icon</span></button><button aria-label="Full screen">full</button></div></div>');
    let notify!: MutationCallback;
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: MutationCallback) { notify = callback; }
      observe() {}
      disconnect() {}
    });
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
      getState: () => ({enabled: true}), createButton: () => button});
    const scans = vi.spyOn(fixture.locator, 'sync'); scans.mockClear();
    const caption = fixture.player.querySelector('.captions')!;
    const native = fixture.player.querySelector('[aria-label="Settings"]')!;
    for (let index = 0; index < 180; index += 1) {
      notify([
        {type: 'childList', target: caption, addedNodes: [fixture.document.createElement('span')], removedNodes: []},
        {type: 'childList', target: native, addedNodes: [fixture.document.createElement('svg')], removedNodes: []},
        {type: 'attributes', target: caption, attributeName: 'title', addedNodes: [], removedNodes: []},
      ] as unknown as MutationRecord[], {} as MutationObserver);
    }
    expect(scans).not.toHaveBeenCalled();
    const host = button.parentElement!;
    const control = fixture.document.createElement('button'); control.setAttribute('aria-label', 'Picture in picture');
    host.insertBefore(control, button);
    notify([{type: 'childList', target: host, addedNodes: [control], removedNodes: []}] as unknown as MutationRecord[], {} as MutationObserver);
    expect(scans).toHaveBeenCalledOnce(); scans.mockClear();
    const nestedButton = fixture.document.createElement('div'); nestedButton.appendChild(fixture.document.createElement('button'));
    host.insertBefore(nestedButton, button);
    notify([{type: 'childList', target: host, addedNodes: [nestedButton], removedNodes: []}] as unknown as MutationRecord[], {} as MutationObserver);
    expect(scans).toHaveBeenCalledOnce(); scans.mockClear();
    const unlabeled = fixture.document.createElement('button');
    host.insertBefore(unlabeled, button);
    notify([{type: 'childList', target: host, addedNodes: [unlabeled], removedNodes: []}] as unknown as MutationRecord[], {} as MutationObserver);
    expect(scans).toHaveBeenCalledOnce(); scans.mockClear();
    const wrapper = fixture.document.createElement('div'); fixture.player.appendChild(wrapper); wrapper.appendChild(host);
    notify([{type: 'childList', target: fixture.player, addedNodes: [wrapper], removedNodes: []}] as unknown as MutationRecord[], {} as MutationObserver);
    expect(scans).toHaveBeenCalledOnce(); scans.mockClear();
    notify([{type: 'attributes', target: native, attributeName: 'aria-label', addedNodes: [], removedNodes: []}] as unknown as MutationRecord[], {} as MutationObserver);
    expect(scans).toHaveBeenCalledOnce(); scans.mockClear();
    button.remove();
    notify([{type: 'childList', target: host, addedNodes: [], removedNodes: [button]}] as unknown as MutationRecord[], {} as MutationObserver);
    expect(scans).toHaveBeenCalledOnce();
    expect(button.parentElement).toBe(host);
    binding.destroy(); scans.mockRestore();
  });

  it.each([false, true])('restores a static containing block across the optional CSS priority boundary (%s)', withPriority => {
    const fixture = createFixture();
    Object.defineProperty(fixture.document, 'defaultView', {configurable: true,
      value: {...fixture.window, getComputedStyle: () => ({position: 'static'})}});
    let priority = '';
    const style = {position: '', setProperty(_name: string, value: string, nextPriority: string) {this.position = value; priority = nextPriority;}};
    if (withPriority) Object.assign(style, {getPropertyPriority: () => priority});
    Object.defineProperty(fixture.player, 'style', {configurable: true, value: style});
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
      getState: () => ({enabled: true}), createButton: () => fixture.document.createElement('button')});
    expect(style.position).toBe('relative');
    binding.destroy();
    expect(style.position).toBe('');
  });

  it('keeps player interaction stable when pointer and focus cross sibling controls', () => {
    const fixture = createFixture();
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
      getState: () => ({enabled: true}), createButton: () => fixture.document.createElement('button')});
    const controls = fixture.player.querySelectorAll('button');
    controls[0].dispatchEvent(new fixture.window.Event('pointerover', {bubbles: true}));
    const scans = vi.spyOn(fixture.locator, 'sync'); scans.mockClear();
    for (const type of ['pointerout', 'focusout']) {
      const event = new fixture.window.Event(type, {bubbles: true});
      Object.defineProperty(event, 'relatedTarget', {value: controls[1]});
      controls[0].dispatchEvent(event);
    }
    controls[1].dispatchEvent(new fixture.window.Event('pointerover', {bubbles: true}));
    controls[1].dispatchEvent(new fixture.window.Event('focusin', {bubbles: true}));
    expect(scans).not.toHaveBeenCalled();
    expect(fixture.player.getAttribute('data-fluent-read-video-active')).toBe('true');
    binding.destroy(); scans.mockRestore();
  });

  it.each([
    ['aria-label="Full screen"', 'aria-label="Picture in picture"'],
    ['aria-label="Exit fullscreen"', 'aria-label="Picture-in-picture"'],
    ['aria-label="退出全屏"', 'aria-label="画中画"'],
    ['title="全螢幕"', 'aria-label="子母畫面"'],
    ['data-testid="videoFullscreenButton"', 'data-testid="videoPictureInPictureButton"'],
  ])('keeps the icon between wrapped controls using %s', (fullscreen, pip) => {
    const fixture = createFixture(`<div class="player" data-testid="videoPlayer"><video></video>
      <div class="bar"><button aria-label="Settings"></button><div class="actions">
        <div id="pip"><button ${pip}></button></div><div id="fullscreen"><button ${fullscreen}></button></div>
      </div></div></div>`);
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    expect(button.parentElement?.className).toBe('actions');
    expect(button.previousElementSibling?.id).toBe('pip');
    expect(button.nextElementSibling?.id).toBe('fullscreen');
    const insert = vi.spyOn(button.parentElement!, 'insertBefore');
    binding.sync();
    fixture.setTarget({...fixture.target, fullscreen: true});
    fixture.setTarget({...fixture.target, fullscreen: false});
    expect(insert).not.toHaveBeenCalled();
    binding.destroy();
    expect(fixture.player.querySelector('.actions')?.children).toHaveLength(2);
  });

  it('anchors YouTube before its fullscreen button', () => {
    const fixture = createFixture('<div class="player"><video></video><div class="ytp-right-controls"><button class="ytp-size-button"></button><button class="ytp-fullscreen-button"></button></div></div>');
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    expect(button.nextElementSibling?.className).toBe('ytp-fullscreen-button');
    binding.destroy();
  });

  it.each([false, true])('stays after picture-in-picture while fullscreen is absent (trailing control: %s)', trailing => {
    const fixture = createFixture(`<div class="player"><video></video><div class="bar"><button aria-label="Settings"></button><button id="pip" aria-label="画中画"></button>${trailing ? '<button id="other"></button>' : ''}</div></div>`);
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    binding.sync();
    expect(button.previousElementSibling?.id).toBe('pip');
    expect(button.nextElementSibling?.id || null).toBe(trailing ? 'other' : null);
    binding.destroy();
  });

  it('never treats buttons inside the FluentRead menu as the X control bar', () => {
    const fixture = createFixture('<div class="player" data-testid="videoPlayer"><video></video></div>');
    const button = fixture.document.createElement('button');
    const menu = fixture.document.createElement('div');
    menu.className = 'fluent-read-video-ui';
    menu.innerHTML = '<div class="title"><button aria-label="打开视频翻译设置"></button></div><button></button><button aria-label="Settings"></button>';
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button, createMenu: () => menu});
    fixture.player.insertAdjacentHTML('beforeend', '<div class="bar"><button aria-label="Settings"></button><button id="pip" aria-label="Picture in picture"></button><button id="fullscreen" aria-label="Full screen"></button></div>');
    binding.sync();
    expect(menu.parentElement).toBe(fixture.player);
    expect(button.parentElement).toBe(fixture.player.querySelector('.bar'));
    fixture.player.querySelector('.bar')!.remove();
    menu.hidden = false;
    binding.sync();
    expect(button.isConnected).toBe(false);
    expect(menu.contains(button)).toBe(false);
    binding.destroy();
  });

  it('repairs host moves, late labels, and replacement controls through the observer without looping', () => {
    const fixture = createFixture('<div class="player" data-testid="videoPlayer"><video></video><div class="bar"><button aria-label="Settings"></button><button id="pip"></button><button id="fullscreen"></button></div></div>');
    let notify!: MutationCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('MutationObserver', class {constructor(callback: MutationCallback) {notify = callback;} observe() {} disconnect = disconnect;});
    const button = fixture.document.createElement('button');
    const createMenu = vi.fn(() => fixture.document.createElement('div'));
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button, createMenu});
    const bar = fixture.player.querySelector('.bar')!;
    const fullscreen = fixture.player.querySelector('#fullscreen')!;
    const changed = (target: Node, addedNodes: Node[] = [], removedNodes: Node[] = [], type = 'childList') =>
      notify([{target, addedNodes, removedNodes, type} as unknown as MutationRecord], {} as MutationObserver);
    fullscreen.setAttribute('aria-label', 'Full screen');
    changed(fullscreen, [], [], 'attributes');
    expect(button.nextElementSibling).toBe(fullscreen);
    for (const move of [() => bar.appendChild(button), () => button.remove(), () => bar.appendChild(fullscreen)]) {
      move();
      changed(bar, [button], [button]);
      expect(button.nextElementSibling).toBe(fullscreen);
      expect(button.parentElement).toBe(bar);
    }
    const insert = vi.spyOn(bar, 'insertBefore');
    changed(bar, [button], [button]);
    button.title = 'progress';
    changed(button, [], [], 'attributes');
    expect(insert).not.toHaveBeenCalled();
    const replacement = fixture.document.createElement('div');
    replacement.innerHTML = '<button aria-label="Settings"></button><button id="new-pip" aria-label="Picture in picture"></button><button id="new-fullscreen" aria-label="Full screen"></button>';
    bar.replaceWith(replacement);
    changed(fixture.player, [replacement], [bar]);
    expect(button.previousElementSibling?.id).toBe('new-pip');
    expect(button.nextElementSibling?.id).toBe('new-fullscreen');
    expect(createMenu).toHaveBeenCalledTimes(1);
    binding.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    changed(replacement, [button]);
    expect(button.isConnected).toBe(false);
  });
});

describe('video player binding', () => {
  it('uses native controls and exposes generation progress beside the icon', () => {
    const {document, locator, target, player} = createFixture();
    const button = document.createElement('button');
    const binding = createVideoPlayerBinding({
      document,
      locator,
      getState: () => ({enabled: true, progress: .42}),
      createButton: () => button,
    });
    expect(button.parentElement?.className).toBe('ytp-right-controls');
    expect(button.parentElement?.lastElementChild).toBe(button);
    expect(button.getAttribute('data-fluent-read-video-progress')).toBe('42%');
    expect(player.classList.contains('fluent-read-video-player-host')).toBe(true);
    expect(binding.getTarget()).toBe(target);
    button.dispatchEvent(new document.defaultView!.Event('click', {bubbles: true}));
    binding.destroy();
    expect(button.isConnected).toBe(false);
    expect(player.classList.contains('fluent-read-video-player-host')).toBe(false);
  });

  it('invokes the injected button callback and observes a focused player', () => {
    const fixture = createFixture();
    const button = fixture.document.createElement('button');
    const onButtonClick = vi.fn();
    Object.defineProperty(fixture.document, 'activeElement', {configurable: true, value: fixture.player});
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button, onButtonClick});
    binding.sync();
    button.dispatchEvent(new fixture.window.Event('click', {bubbles: true}));
    expect(onButtonClick).toHaveBeenCalledTimes(1);
    binding.destroy();
  });

  it('recognizes a focused descendant when the player itself is not activeElement', () => {
    const fixture = createFixture();
    const focused = fixture.player.querySelector('.ytp-right-controls')!.querySelector('button')!;
    Object.defineProperty(fixture.document, 'activeElement', {configurable: true, value: focused});
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    expect(fixture.player.getAttribute('data-fluent-read-video-active')).toBe('true');
    binding.destroy();
  });

  it('keeps zero and one hundred percent visible and accepts a custom progress label', () => {
    const fixture = createFixture();
    let progress: number | null = 0;
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({
      document: fixture.document,
      locator: fixture.locator,
      getState: () => ({enabled: true, progress, progressLabel: progress === 0 ? '0%' : undefined}),
      createButton: () => button,
    });
    expect(button.getAttribute('data-fluent-read-video-progress')).toBe('0%');
    progress = 1;
    binding.sync();
    expect(button.getAttribute('data-fluent-read-video-progress')).toBe('100%');
    progress = -1;
    binding.sync();
    expect(button.hasAttribute('data-fluent-read-video-progress')).toBe(false);
    binding.destroy();
  });

  it('uses X settings groups when YouTube controls are absent and handles focused control events', () => {
    const fixture = createFixture('<div class="player"><video></video><div class="x-controls"><button aria-label="Settings"></button><button>other</button></div></div>');
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    expect(button.parentElement?.className).toBe('x-controls');
    expect(button.parentElement?.lastElementChild).toBe(button);
    const settings = fixture.player.querySelector('button')!;
    settings.dispatchEvent(new fixture.window.Event('focusin', {bubbles: true}));
    settings.dispatchEvent(new fixture.window.Event('focusout', {bubbles: true}));
    binding.destroy();
  });

  it('uses the settings parent when it is the only native X control', () => {
    const fixture = createFixture('<div class="player"><video></video><div class="x-controls"><button aria-label="Settings"></button></div></div>');
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    expect(button.parentElement?.className).toBe('x-controls');
    expect(button.parentElement?.lastElementChild).toBe(button);
    binding.destroy();
  });

  it('keeps an existing fallback and tolerates a hostile hover matcher', () => {
    const fixture = createFixture('<div class="player"><video></video><div class="fluent-read-video-controls"></div></div>');
    fixture.player.matches = (() => { throw new Error('hostile selector'); }) as typeof fixture.player.matches;
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    fixture.video.dispatchEvent(new fixture.window.Event('pointerover', {bubbles: true}));
    expect(button.parentElement?.className).toContain('fluent-read-video-controls');
    binding.destroy();
  });

  it('reuses an existing fallback after native controls are removed', () => {
    const fixture = createFixture('<div class="player"><video></video></div>');
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    fixture.video.dispatchEvent(new fixture.window.Event('pointerover', {bubbles: true}));
    const fallback = button.parentElement!;
    const native = fixture.document.createElement('div');
    native.className = 'ytp-right-controls';
    native.append(fixture.document.createElement('button'), fixture.document.createElement('button'));
    fixture.player.appendChild(native);
    binding.sync();
    native.remove();
    binding.sync();
    expect(button.parentElement).toBe(fallback);
    binding.destroy();
  });

  it('removes a fallback that was externally moved before reusing it', () => {
    const fixture = createFixture('<div class="player"><video></video></div>');
    const second = fixture.document.createElement('div');
    second.className = 'second';
    fixture.document.body.appendChild(second);
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    fixture.video.dispatchEvent(new fixture.window.Event('pointerover', {bubbles: true}));
    const fallback = button.parentElement!;
    second.appendChild(fallback);
    binding.sync();
    expect(fallback.isConnected).toBe(false);
    expect(button.parentElement?.parentElement).toBe(fixture.player);
    binding.destroy();
  });

  it('replaces a fallback when the selected player changes and accepts a null menu', () => {
    const fixture = createFixture('<div class="player"><video></video></div>');
    const secondPlayer = fixture.document.createElement('div');
    secondPlayer.className = 'second';
    const secondVideo = fixture.document.createElement('video');
    secondPlayer.appendChild(secondVideo);
    fixture.document.body.appendChild(secondPlayer);
    const second: VideoPlayerTarget = {video: secondVideo, player: secondPlayer, key: 'video:two', fullscreen: false, interacting: true};
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button, createMenu: () => null});
    fixture.video.dispatchEvent(new fixture.window.Event('pointerover', {bubbles: true}));
    fixture.setTarget(second);
    expect(button.parentElement?.className).toContain('fluent-read-video-controls');
    binding.destroy();
  });

  it('removes a previously created menu before recreating the target binding', () => {
    const fixture = createFixture();
    const secondPlayer = fixture.document.createElement('div');
    const secondVideo = fixture.document.createElement('video');
    const secondControls = fixture.document.createElement('div');
    secondControls.className = 'ytp-right-controls';
    secondControls.append(fixture.document.createElement('button'), fixture.document.createElement('button'));
    secondPlayer.append(secondVideo, secondControls);
    fixture.document.body.append(secondPlayer);
    const second: VideoPlayerTarget = {video: secondVideo, player: secondPlayer, key: 'video:two', fullscreen: false, interacting: true};
    const firstMenu = fixture.document.createElement('div');
    const secondMenu = fixture.document.createElement('div');
    let calls = 0;
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({
      document: fixture.document,
      locator: fixture.locator,
      getState: () => ({enabled: true}),
      createButton: () => button,
      createMenu: () => { calls += 1; return calls === 1 ? firstMenu : secondMenu; },
    });
    fixture.setTarget(second);
    expect(firstMenu.isConnected).toBe(false);
    expect(secondMenu.parentElement).toBe(secondPlayer);
    binding.destroy();
  });

  it('removes an externally moved menu before restoring it to the selected player', () => {
    const fixture = createFixture();
    const other = fixture.document.createElement('div');
    fixture.document.body.appendChild(other);
    const menu = fixture.document.createElement('div');
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button, createMenu: () => menu});
    other.appendChild(menu);
    binding.sync();
    expect(menu.parentElement).toBe(fixture.player);
    binding.destroy();
  });

  it('creates and moves an optional menu, preserves static positioning, and cleans after a disconnect', () => {
    const fixture = createFixture();
    const originalView = fixture.document.defaultView;
    fixture.player.style.position = 'absolute';
    Object.defineProperty(fixture.document, 'defaultView', {configurable: true, value: {
      ...fixture.window,
      getComputedStyle: () => ({position: 'static'}),
    }});
    const button = fixture.document.createElement('button');
    const menu = fixture.document.createElement('div');
    let menuCalls = 0;
    const binding = createVideoPlayerBinding({
      document: fixture.document,
      locator: fixture.locator,
      getState: () => ({enabled: true}),
      createButton: () => button,
      createMenu: () => { menuCalls += 1; return menu; },
    });
    expect(menuCalls).toBe(1);
    expect(menu.parentElement).toBe(fixture.player);
    expect(fixture.player.style.position).toBe('relative');
    binding.sync();
    expect(menuCalls).toBe(1);
    fixture.player.remove();
    binding.sync();
    expect(button.isConnected).toBe(false);
    expect(fixture.player.style.position).toBe('absolute');
    binding.destroy();
    Object.defineProperty(fixture.document, 'defaultView', {configurable: true, value: originalView});
  });

  it('falls back to the global document and survives a throwing computed-style boundary', () => {
    const fixture = createFixture();
    const originalView = fixture.document.defaultView;
    Object.defineProperty(fixture.document, 'defaultView', {configurable: true, value: null});
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    expect(button.isConnected).toBe(true);
    binding.destroy();

    const second = createFixture();
    Object.defineProperty(second.document, 'defaultView', {configurable: true, value: {getComputedStyle: () => { throw new Error('style unavailable'); }}});
    const secondButton = second.document.createElement('button');
    const secondBinding = createVideoPlayerBinding({document: second.document, locator: second.locator, getState: () => ({enabled: true}), createButton: () => secondButton});
    expect(secondButton.isConnected).toBe(true);
    secondBinding.destroy();
    Object.defineProperty(fixture.document, 'defaultView', {configurable: true, value: originalView});
  });

  it('restores an empty inline position after making a static player a containing block', () => {
    const fixture = createFixture();
    const originalView = fixture.document.defaultView;
    Object.defineProperty(fixture.document, 'defaultView', {configurable: true, value: {...fixture.window, getComputedStyle: () => ({position: 'static'})}});
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    fixture.player.remove();
    binding.sync();
    expect(fixture.player.style.position).toBe('');
    binding.destroy();
    Object.defineProperty(fixture.document, 'defaultView', {configurable: true, value: originalView});
  });

  it('does not react after destruction and handles unrelated pointer events', () => {
    const fixture = createFixture();
    const button = fixture.document.createElement('button');
    const click = vi.fn();
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button, onButtonClick: click});
    fixture.document.dispatchEvent(new fixture.window.Event('pointerover', {bubbles: true}));
    fixture.document.dispatchEvent(new fixture.window.Event('pointerout', {bubbles: true}));
    const unrelated = fixture.document.createElement('div');
    fixture.document.body.appendChild(unrelated);
    unrelated.dispatchEvent(new fixture.window.Event('pointerover', {bubbles: true}));
    const containedOut = new fixture.window.Event('pointerout', {bubbles: true});
    Object.defineProperty(containedOut, 'relatedTarget', {value: fixture.player.querySelector('video')});
    fixture.player.dispatchEvent(containedOut);
    binding.destroy();
    binding.destroy();
    fixture.emit(fixture.target);
    binding.sync();
    expect(click).not.toHaveBeenCalled();
  });

  it('keeps the fallback host until a native host is actually mounted', () => {
    const fixture = createFixture('<div class="player"><video></video></div>');
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    fixture.video.dispatchEvent(new fixture.window.Event('pointerover', {bubbles: true}));
    const fallback = button.parentElement;
    const native = fixture.document.createElement('div');
    native.className = 'ytp-right-controls';
    native.append(fixture.document.createElement('button'), fixture.document.createElement('button'));
    fixture.player.appendChild(native);
    binding.sync();
    expect(button.parentElement).toBe(native);
    expect(button.parentElement).not.toBe(fallback);
    binding.destroy();
  });

  it('creates fallback only while the selected player is interacted with', () => {
    const {document, window, locator, video, player} = createFixture('<div class="player"><video></video></div>');
    const button = document.createElement('button');
    const binding = createVideoPlayerBinding({
      document,
      locator,
      getState: () => ({enabled: true}),
      createButton: () => button,
    });
    expect(button.isConnected).toBe(false);
    video.dispatchEvent(new window.Event('pointerover', {bubbles: true}));
    expect(button.parentElement?.className).toContain('fluent-read-video-controls');
    expect(player.getAttribute('data-fluent-read-video-active')).toBe('true');
    video.dispatchEvent(new window.Event('pointerout', {bubbles: true}));
    expect(player.getAttribute('data-fluent-read-video-active')).toBe('false');
    binding.destroy();
    expect(player.querySelector('.fluent-read-video-controls')).toBeNull();
  });

  it('does not move the button when native controls merely change visibility', () => {
    const {document, locator, player} = createFixture();
    const button = document.createElement('button');
    const binding = createVideoPlayerBinding({document, locator, getState: () => ({enabled: true}), createButton: () => button});
    const native = player.querySelector('.ytp-right-controls');
    native?.setAttribute('style', 'display:none');
    binding.sync();
    expect(button.parentElement).toBe(native);
    binding.destroy();
  });

  it('moves ownership on a real target change and removes everything when disabled', () => {
    const fixture = createFixture();
    const secondPlayer = fixture.document.createElement('div');
    secondPlayer.className = 'second';
    const secondVideo = fixture.document.createElement('video');
    const secondControls = fixture.document.createElement('div');
    secondControls.className = 'ytp-right-controls';
    secondControls.append(fixture.document.createElement('button'), fixture.document.createElement('button'));
    secondPlayer.append(secondVideo, secondControls);
    fixture.document.body.appendChild(secondPlayer);
    const second: VideoPlayerTarget = {video: secondVideo, player: secondPlayer, key: 'video:two', fullscreen: false, interacting: true};
    let enabled = true;
    const button = fixture.document.createElement('button');
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled}), createButton: () => button});
    fixture.setTarget(second);
    expect(button.parentElement?.parentElement).toBe(secondPlayer);
    enabled = false;
    binding.sync();
    expect(button.isConnected).toBe(false);
    binding.destroy();
  });

  it('guards cleanup against a synchronous focusout reentry during button removal', () => {
    const fixture = createFixture();
    const button = fixture.document.createElement('button');
    const originalRemove = button.remove.bind(button);
    button.remove = () => {
      button.dispatchEvent(new fixture.window.Event('focusout', {bubbles: true}));
      originalRemove();
    };
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton: () => button});
    expect(() => binding.destroy()).not.toThrow();
    expect(button.isConnected).toBe(false);
  });
});

describe('X controls delayed mounting', () => {
  it('waits for native controls on hover and remount without ever creating a corner fallback', () => {
    const fixture = createFixture('<div class="player" data-testid="videoPlayer"><video></video></div>');
    const createButton = vi.fn(() => fixture.document.createElement('button'));
    const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled: true}), createButton});
    fixture.player.dispatchEvent(new fixture.window.Event('pointerover', {bubbles: true}));
    expect(createButton).not.toHaveBeenCalled();
    expect(fixture.player.querySelector('.fluent-read-video-fallback-controls')).toBeNull();
    const controls = fixture.document.createElement('div');
    controls.innerHTML = '<button aria-label="Settings"></button><button>fullscreen</button>';
    fixture.player.appendChild(controls);
    binding.sync();
    expect(createButton).toHaveBeenCalledTimes(1);
    expect(controls.lastElementChild).toBe(createButton.mock.results[0].value);
    controls.remove(); binding.sync();
    expect(fixture.player.querySelector('.fluent-read-video-fallback-controls')).toBeNull();
    expect(createButton.mock.results[0].value.isConnected).toBe(false);
    fixture.player.appendChild(controls); binding.sync();
    expect(controls.lastElementChild).toBe(createButton.mock.results[1].value);
    binding.destroy();
    expect(controls.querySelectorAll('button')).toHaveLength(2);
  });
});

it('controls observer ignores unrelated and owned mutations and rebinds host controls', () => {
 const fixture=createFixture('<div class="player" data-testid="videoPlayer"><video></video></div>');
 let notify!:MutationCallback;vi.stubGlobal('MutationObserver',class {constructor(callback:MutationCallback){notify=callback} observe(){} disconnect(){}});
 const binding=createVideoPlayerBinding({document:fixture.document,locator:fixture.locator,getState:()=>({enabled:true}),createButton:()=>fixture.document.createElement('button')});
 const external=fixture.document.createElement('div');
 notify([{target:external,addedNodes:[],removedNodes:[]} as unknown as MutationRecord],{} as MutationObserver);
 const owned=fixture.document.createElement('div');owned.className='fluent-read-video-ui';fixture.player.appendChild(owned);
 notify([{target:fixture.player,addedNodes:[owned],removedNodes:[]} as unknown as MutationRecord],{} as MutationObserver);
 const controls=fixture.document.createElement('div');controls.innerHTML='<button aria-label="Settings"></button>';fixture.player.appendChild(controls);
 notify([{target:fixture.player,addedNodes:[controls],removedNodes:[]} as unknown as MutationRecord],{} as MutationObserver);
 expect(controls.children.length).toBe(2);binding.destroy();
 notify([{target:fixture.player,addedNodes:[controls],removedNodes:[]} as unknown as MutationRecord],{} as MutationObserver);
});

it('skips text-only player updates and unrelated mixed records while rebinding replaced controls', () => {
  const fixture = createFixture('<div class="player"><video></video><div class="ytp-right-controls"><button>settings</button><button>other</button></div></div>');
  let notify!: MutationCallback;
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: MutationCallback) { notify = callback; }
    observe() {}
    disconnect() {}
  });
  const button = fixture.document.createElement('button');
  const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
    getState: () => ({enabled: true}), createButton: () => button});
  const scans = vi.spyOn(fixture.locator, 'sync');
  scans.mockClear();
  for (let index = 0; index < 60; index += 1) {
    notify([
      {target: fixture.player, addedNodes: [fixture.document.createTextNode(`time ${index}`)], removedNodes: [], type: 'childList'},
      {target: fixture.document.body, addedNodes: [fixture.document.createElement('div')], removedNodes: [], type: 'childList'},
    ] as unknown as MutationRecord[], {} as MutationObserver);
  }
  expect(scans).not.toHaveBeenCalled();
  const previous = fixture.player.querySelector('.ytp-right-controls')!;
  const replacement = fixture.document.createElement('div');
  replacement.className = 'ytp-right-controls';
  replacement.innerHTML = '<button>new settings</button><button>new other</button>';
  previous.replaceWith(replacement);
  notify([{target: fixture.player, addedNodes: [replacement], removedNodes: [previous], type: 'childList'} as unknown as MutationRecord], {} as MutationObserver);
  expect(scans).toHaveBeenCalledOnce();
  expect(button.parentElement).toBe(replacement);
  binding.destroy();
});

it('missing MutationObserver still supports explicit sync and clean teardown', () => {
 const fixture=createFixture();vi.stubGlobal('MutationObserver',undefined);
 const button=fixture.document.createElement('button');
 const binding=createVideoPlayerBinding({document:fixture.document,locator:fixture.locator,getState:()=>({enabled:true}),createButton:()=>button});
 binding.sync();
 // 没有观察器时仍靠显式 sync 挂在播放器控件内，销毁后不能遗留图标。
 expect(fixture.player.contains(button)).toBe(true);
 binding.destroy();
 expect(button.isConnected).toBe(false);
});


it.each(['disable', 'destroy'] as const)('cleans copies in detached X controls while retaining the open menu before %s', finish => {
  const fixture = createFixture('<div class="player" data-testid="videoPlayer"><video></video><div class="x-controls"><button aria-label="Settings"></button><button>fullscreen</button></div></div>');
  let enabled = true;
  const live = fixture.document.createElement('button');
  const menu = fixture.document.createElement('div');
  const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator,
    getState: () => ({enabled}), createButton: () => live, createMenu: () => menu});
  const controls = live.parentElement!;
  const clone = live.cloneNode(true) as HTMLButtonElement;
  const foreign = live.cloneNode(true) as HTMLButtonElement;
  foreign.setAttribute('data-fluent-read-video-binding-owner', 'another-binding');
  controls.append(clone, foreign);
  controls.remove();
  binding.sync();
  expect(menu.isConnected).toBe(true);
  expect(live.parentElement).toBeNull();
  if (finish === 'disable') {enabled = false; binding.sync();}
  else binding.destroy();
  expect(menu.isConnected).toBe(false);
  expect(clone.parentElement).toBeNull();
  expect(foreign.parentElement).toBe(controls);
  fixture.player.appendChild(controls);
  expect(controls.querySelectorAll('[data-fluent-read-video-binding-owner]')).toHaveLength(1);
  expect(controls.querySelector('[data-fluent-read-video-binding-owner]')).toBe(foreign);
  binding.destroy();
});

it('keeps an open X menu usable across controls removal and remount, then cleans up on disable', () => {
  const fixture = createFixture('<div class="player" data-testid="videoPlayer"><video></video><div class="x-controls"><button aria-label="Settings"></button><button>fullscreen</button></div></div>');
  let enabled = true;
  const createMenu = vi.fn(() => {
    const menu = fixture.document.createElement('div');
    menu.hidden = true;
    const toggle = fixture.document.createElement('button');
    toggle.addEventListener('click', () => toggle.setAttribute('aria-checked', 'false'));
    menu.appendChild(toggle);
    return menu;
  });
  const binding = createVideoPlayerBinding({document: fixture.document, locator: fixture.locator, getState: () => ({enabled}), createButton: () => fixture.document.createElement('button'), createMenu});
  const menu = createMenu.mock.results[0].value;
  const toggle = menu.querySelector('button')!;
  menu.hidden = false;
  const controls = fixture.player.querySelector('.x-controls')!;
  controls.remove();
  binding.sync();
  toggle.dispatchEvent(new fixture.window.Event('pointerover', {bubbles: true}));
  toggle.dispatchEvent(new fixture.window.Event('click', {bubbles: true}));
  expect(menu.isConnected).toBe(true);
  expect(menu.hidden).toBe(false);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(fixture.player.querySelector('.fluent-read-video-controls')).toBeNull();
  fixture.player.appendChild(controls);
  binding.sync();
  expect(createMenu).toHaveBeenCalledTimes(1);
  expect(menu.hidden).toBe(false);
  expect(controls.children).toHaveLength(3);
  controls.remove();
  binding.sync();
  enabled = false;
  binding.sync();
  expect(menu.isConnected).toBe(false);
  binding.destroy();
});
