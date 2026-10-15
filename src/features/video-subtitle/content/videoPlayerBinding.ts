/**
 * @file src/features/video-subtitle/content/videoPlayerBinding.ts
 * 文件职责：把字幕入口和菜单绑定到定位器选中的视频播放器，并在信息流、全屏及原生控件重挂载时保持稳定。
 * 主要内容：以画中画和全屏控件为锚点维护入口顺序，按真实控件结构变化绑定入口，在所持控制栏内清除站点深复制的本实例入口，观察器在原按钮位置不变时也识别本实例新副本，忽略字幕与 tooltip 内容更新，管理 fallback 控件、进度徽标和禁用状态下的节点清理。
 * 模块边界：只管理 FluentRead 播放器节点的挂载位置与事件；按钮行为、菜单内容和字幕业务由调用方注入。
 */

import {
  markVideoUi,
  VIDEO_FALLBACK_CONTROLS_CLASS,
  VIDEO_PLAYER_ACTIVE_ATTRIBUTE,
  VIDEO_PLAYER_HOST_CLASS,
  VIDEO_PLAYER_PROGRESS_ATTRIBUTE,
  VIDEO_RIGHT_CONTROLS_SELECTOR,
  VIDEO_X_SETTINGS_CONTROL_SELECTOR,
} from './ui';
import type {VideoPlayerLocator, VideoPlayerTarget} from './videoPlayerLocator';

export interface VideoPlayerBindingState {
  readonly enabled: boolean;
  readonly progress?: number | null;
  readonly progressLabel?: string;
}

export interface VideoPlayerBindingOptions {
  readonly locator: VideoPlayerLocator;
  readonly document?: Document;
  readonly getState: () => VideoPlayerBindingState;
  readonly createButton: () => HTMLButtonElement;
  readonly createMenu?: (target: VideoPlayerTarget) => HTMLElement | null;
  readonly onButtonClick?: (event: MouseEvent, target: VideoPlayerTarget) => void;
}

export interface VideoPlayerBinding {
  sync(): void;
  getTarget(): VideoPlayerTarget | null;
  destroy(): void;
}

const VIDEO_PLAYER_FULLSCREEN_ATTRIBUTE = 'data-fluent-read-video-fullscreen';
const FULLSCREEN_CONTROL_SELECTOR = [
  '.ytp-fullscreen-button', '[data-testid*="fullscreen" i]',
  '[aria-label*="Full screen" i]', '[aria-label*="Fullscreen" i]',
  '[aria-label*="全屏"]', '[aria-label*="全螢幕"]',
  '[title*="Full screen" i]', '[title*="Fullscreen" i]', '[title*="全屏"]', '[title*="全螢幕"]',
].join(', ');
const PICTURE_IN_PICTURE_CONTROL_SELECTOR = [
  '[data-testid*="pictureInPicture" i]', '[data-testid*="pipButton" i]',
  '[aria-label*="Picture in picture" i]', '[aria-label*="Picture-in-picture" i]',
  '[aria-label*="画中画"]', '[aria-label*="子母畫面"]',
  '[title*="Picture in picture" i]', '[title*="Picture-in-picture" i]', '[title*="画中画"]',
].join(', ');

function isConnected(element: Element | null): element is Element {
  return Boolean(element && element.isConnected !== false);
}

/** 只匹配站点自己的控件；FluentRead 菜单里的“设置”等按钮不能被当作原生控制栏。 */
function nativeControl(root: HTMLElement, selector: string): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).find(control => !control.closest('.fluent-read-video-ui')) || null;
}

function nativeControls(player: HTMLElement): HTMLElement | null {
  const youtube = player.querySelector<HTMLElement>(VIDEO_RIGHT_CONTROLS_SELECTOR);
  if (youtube) return youtube;
  const anchor = nativeControl(player, FULLSCREEN_CONTROL_SELECTOR)
    || nativeControl(player, PICTURE_IN_PICTURE_CONTROL_SELECTOR) || nativeControl(player, VIDEO_X_SETTINGS_CONTROL_SELECTOR);
  if (!anchor) return null;
  let current = anchor.parentElement;
  while (current && current !== player) {
    // 自己的入口不能让单按钮 tooltip 包装层被误识别为完整控制栏。
    if (Array.from(current.querySelectorAll('button, [role="button"]'))
      .filter(control => !control.closest('.fluent-read-video-ui')).length >= 2) return current;
    current = current.parentElement;
  }
  return anchor.parentElement;
}

/** 插在原生按钮所属的直接子节点旁，保留站点的 tooltip 包装和点击事件。 */
function insertionAnchor(host: HTMLElement, button: HTMLButtonElement): Element | null {
  const fullscreen = host.querySelector<HTMLElement>(FULLSCREEN_CONTROL_SELECTOR);
  let control: Element | null = fullscreen || host.querySelector<HTMLElement>(PICTURE_IN_PICTURE_CONTROL_SELECTOR);
  if (!control) return null;
  while (control.parentElement !== host) control = control.parentElement!;
  if (fullscreen) return control;
  const next = control.nextElementSibling;
  return next === button ? button.nextElementSibling : next;
}

function playerIsFocused(player: HTMLElement, document: Document): boolean {
  const active = document.activeElement;
  return Boolean(active && (active === player || player.contains(active)));
}

function playerIsHovered(player: HTMLElement): boolean {
  try {
    return player.matches(':hover');
  } catch {
    return false;
  }
}

function setProgress(button: HTMLButtonElement, state: VideoPlayerBindingState): void {
  const value = state.progress;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    button.removeAttribute(VIDEO_PLAYER_PROGRESS_ATTRIBUTE);
    button.removeAttribute('aria-valuenow');
    return;
  }
  const percentage = Math.round(Math.max(0, Math.min(1, value)) * 100);
  button.setAttribute(VIDEO_PLAYER_PROGRESS_ATTRIBUTE, state.progressLabel || `${percentage}%`);
  button.setAttribute('aria-valuenow', String(percentage));
}

export function createVideoPlayerBinding(options: VideoPlayerBindingOptions): VideoPlayerBinding {
  const document = options.document || window.document;
  const view = document.defaultView || window;
  let target: VideoPlayerTarget | null = null;
  let button: HTMLButtonElement | null = null;
  let menu: HTMLElement | null = null;
  let host: HTMLElement | null = null;
  let before: Element | null = null;
  let fallback: HTMLElement | null = null;
  let destroyed = false;
  let cleaningNodes = false;
  // 属性随 DOM 深复制而保留；只识别本实例入口的副本，不按公共 id 删除其他实例或页面节点。
  const buttonOwner = `${Date.now()}-${Math.random()}`;
  const buttonOwnerAttribute = 'data-fluent-read-video-binding-owner';
  const ownedButtonSelector = `button[${buttonOwnerAttribute}="${buttonOwner}"]`;
  const activePlayers = new WeakSet<HTMLElement>();
  const positionedPlayers = new WeakSet<HTMLElement>();
  const previousPositions = new WeakMap<HTMLElement, {value: string; priority: string}>();

  const removeClonedButtons = (scope: HTMLElement | null, liveButton: HTMLButtonElement | null) => {
    if (!scope) return;
    const previouslyCleaning = cleaningNodes;
    cleaningNodes = true;
    try {
      for (const candidate of scope.querySelectorAll<HTMLButtonElement>(ownedButtonSelector)) {
        if (candidate !== liveButton) candidate.remove();
      }
    } finally {
      cleaningNodes = previouslyCleaning;
    }
  };

  const cleanNodes = () => {
    cleaningNodes = true;
    const buttonToRemove = button;
    const menuToRemove = menu;
    const fallbackToRemove = fallback;
    const hostToClean = host;
    button = null;
    menu = null;
    fallback = null;
    host = null;
    before = null;
    try {
      removeClonedButtons(hostToClean, buttonToRemove);
      buttonToRemove?.remove();
      menuToRemove?.remove();
      fallbackToRemove?.remove();
    } finally {
      cleaningNodes = false;
    }
  };

  const removePlayerMark = (player: HTMLElement | null) => {
    if (!player) return;
    player.classList.remove(VIDEO_PLAYER_HOST_CLASS);
    player.removeAttribute(VIDEO_PLAYER_ACTIVE_ATTRIBUTE);
    player.removeAttribute(VIDEO_PLAYER_FULLSCREEN_ATTRIBUTE);
    if (positionedPlayers.has(player)) {
      const previous = previousPositions.get(player)!;
      // 站点可能在挂载后更新自己的定位；只恢复仍由我们持有的声明。
      if (player.style.position === 'relative'
        && (!player.style.getPropertyPriority || player.style.getPropertyPriority('position') === 'important')) {
        if (previous.value) player.style.setProperty('position', previous.value, previous.priority);
        else player.style.position = '';
      }
      positionedPlayers.delete(player);
      previousPositions.delete(player);
    }
  };

  const ensureContainingBlock = (player: HTMLElement) => {
    if (positionedPlayers.has(player)) return;
    let position = '';
    try {
      position = view.getComputedStyle?.(player)?.position || '';
    } catch {
      position = '';
    }
    if (position !== 'static') return;
    previousPositions.set(player, {value: player.style.position, priority: player.style.getPropertyPriority?.('position') || ''});
    player.style.setProperty('position', 'relative', 'important');
    positionedPlayers.add(player);
  };

  const isInteractive = (next: VideoPlayerTarget): boolean =>
    next.fullscreen || activePlayers.has(next.player) || playerIsHovered(next.player) || playerIsFocused(next.player, document);

  const ensureFallback = (player: HTMLElement): HTMLElement => {
    if (!fallback || fallback.parentElement !== player) {
      fallback?.remove();
      fallback = player.querySelector<HTMLElement>(`.${VIDEO_FALLBACK_CONTROLS_CLASS}`) || document.createElement('div');
      fallback.className = VIDEO_FALLBACK_CONTROLS_CLASS;
      markVideoUi(fallback);
      if (fallback.parentElement !== player) player.appendChild(fallback);
    }
    return fallback;
  };

  const place = (next: VideoPlayerTarget): void => {
    const preferred = nativeControls(next.player);
    // X 的控制栏在悬浮后才挂载。等待真实控制栏，避免右下角 fallback 首帧闪现后跳到进度左侧。
    if (!preferred && next.player.getAttribute('data-testid') === 'videoPlayer') {
      // 原生控制栏的生命周期不代表用户结束菜单操作；保留已打开的菜单及焦点。
      if (menu && menu.parentElement === next.player && !menu.hidden) {
        removeClonedButtons(host, button);
        button?.remove();
        host = null;
        return;
      }
      cleanNodes();
      removePlayerMark(next.player);
      return;
    }
    const currentHostBelongs = host && host.parentElement && next.player.contains(host);
    if (!currentHostBelongs) {
      removeClonedButtons(host, button);
      host = null;
    }

    if (!host) {
      if (preferred) host = preferred;
      else if (isInteractive(next)) host = ensureFallback(next.player);
      else {
        cleanNodes();
        return;
      }
    } else if (preferred && preferred !== host) {
      // 原生控件真正重挂载后才换宿主；仅 display/opacity 变化不会触发此分支。
      removeClonedButtons(host, button);
      host = preferred;
    }

    removeClonedButtons(host, button);
    ensureContainingBlock(next.player);
    if (!button) {
      button = options.createButton();
      button.setAttribute(buttonOwnerAttribute, buttonOwner);
      markVideoUi(button);
      button.addEventListener('click', (event) => {
        if (target) options.onButtonClick?.(event, target);
      });
    }
    setProgress(button, options.getState());
    before = insertionAnchor(host, button);
    if (button.parentElement !== host || button.nextElementSibling !== before) host.insertBefore(button, before);

    if (options.createMenu) {
      if (!menu || menu.parentElement !== next.player) {
        menu?.remove();
        menu = options.createMenu(next);
      }
      if (menu && menu.parentElement !== next.player) next.player.appendChild(menu);
      if (menu) markVideoUi(menu);
    }
    next.player.classList.add(VIDEO_PLAYER_HOST_CLASS);
    next.player.setAttribute(VIDEO_PLAYER_ACTIVE_ATTRIBUTE, String(isInteractive(next)));
    next.player.setAttribute(VIDEO_PLAYER_FULLSCREEN_ATTRIBUTE, String(next.fullscreen));
  };

  const sync = () => {
    if (destroyed || cleaningNodes) return;
    const state = options.getState();
    const next = state.enabled ? options.locator.sync() : null;
    if (next?.key !== target?.key || next?.player !== target?.player) {
      removePlayerMark(target?.player || null);
      cleanNodes();
      target = next;
    } else if (target && (!isConnected(target.video) || !isConnected(target.player))) {
      removePlayerMark(target.player);
      cleanNodes();
      target = null;
    } else {
      // locator 的全屏/交互元数据可能变化但 key 不变，仍需刷新本地快照。
      target = next;
    }
    if (!target) return;
    place(target);
    if (button) setProgress(button, options.getState());
  };

  const markInteraction = (event: Event, active: boolean) => {
    const element = event.target;
    if (!element || typeof (element as {tagName?: unknown}).tagName !== 'string') return;
    const selected = target;
    if (!selected || (element !== selected.player && !selected.player.contains(element as Node))) return;
    if (activePlayers.has(selected.player) === active) return;
    if (active) activePlayers.add(selected.player);
    else activePlayers.delete(selected.player);
    sync();
  };

  const onPointerOver = (event: Event) => markInteraction(event, true);
  const onPointerOut = (event: Event) => {
    const related = (event as MouseEvent).relatedTarget;
    if (related && target?.player.contains(related as Node)) return;
    markInteraction(event, false);
  };
  const onFocusIn = (event: Event) => markInteraction(event, true);
  const onFocusOut = (event: Event) => {
    const related = (event as FocusEvent).relatedTarget;
    if (related && target?.player.contains(related as Node)) return;
    markInteraction(event, false);
  };

  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerdown', onPointerOver, true);
  document.addEventListener('pointerout', onPointerOut, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  const unsubscribe = options.locator.subscribe((next) => {
    if (destroyed) return;
    if (next?.interacting) activePlayers.add(next.player);
    sync();
  });
  const controlsObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(records => {
    if (!target) return;
    const player = target.player;
    const playerRecords = records.filter(record => player.contains(record.target));
    if (playerRecords.length === 0) return;
    const isOwned = (node: Node) => node instanceof Element && Boolean(node.closest('.fluent-read-video-ui'));
    // 原按钮仍在正确锚点时也可能新插入无监听的副本；只检查本实例所持控制栏，避免字幕/tooltip 自身更新触发重新扫描。
    const addsOwnedButtonCopy = (node: Node): boolean => {
      if (!(node instanceof Element) || !host?.contains(node)) return false;
      return (node !== button && node.matches(ownedButtonSelector))
        || Array.from(node.querySelectorAll(ownedButtonSelector)).some(copy => copy !== button);
    };
    const correctlyPlaced = button?.parentElement === host && button?.nextElementSibling === before;
    const controlSelector = [VIDEO_RIGHT_CONTROLS_SELECTOR, FULLSCREEN_CONTROL_SELECTOR,
      PICTURE_IN_PICTURE_CONTROL_SELECTOR, VIDEO_X_SETTINGS_CONTROL_SELECTOR].join(', ');
    const affectsControls = (node: Node): boolean => {
      if (!(node instanceof Element) || isOwned(node)) return false;
      if (node === host || Boolean(host && node.contains(host))) return true;
      if (node.matches(controlSelector) || node.querySelector(controlSelector)) return true;
      return Boolean(host?.contains(node) && (node.matches('button, [role="button"]')
        || node.querySelector('button, [role="button"]')));
    };
    if (playerRecords.every(record => {
      if (record.type === 'childList' && Array.from(record.addedNodes).some(addsOwnedButtonCopy)) return false;
      if (isOwned(record.target)) return true;
      if (record.type === 'attributes') return !affectsControls(record.target);
      const nodes = [...record.addedNodes, ...record.removedNodes];
      if (nodes.every(node => node.nodeType === 3)) return true;
      if (!correctlyPlaced && nodes.some(isOwned)) return false;
      return !nodes.some(affectsControls);
    })) return;
    sync();
  }) : null;
  controlsObserver?.observe(document, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'title', 'data-testid']});
  sync();

  return {
    sync,
    getTarget: () => target,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      controlsObserver?.disconnect();
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerdown', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      removePlayerMark(target?.player || null);
      cleanNodes();
      target = null;
    },
  };
}
