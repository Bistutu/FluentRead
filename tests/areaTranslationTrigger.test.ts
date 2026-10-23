import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountAreaTranslator} from './helpers/areaTranslatorHarness';
import {shouldStartAreaTranslationFromHotkey} from '@/src/features/area-translation/content/areaHotkey';

let close: (() => void) | undefined;
afterEach(() => {close?.(); vi.unstubAllGlobals();});
function mountTranslator() {
  const fixture = mountAreaTranslator(); close = fixture.unmount;
  const {config, document} = fixture;
  const press = (overrides: Record<string, unknown> = {}) => {
    const target = overrides.target ?? document.activeElement ?? document.body;
    const event = {
      isTrusted: true, key: 'Z', code: 'KeyZ', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
      repeat: false, isComposing: false, target, composedPath: () => [target, document.body, document],
      preventDefault: vi.fn(), ...overrides,
    };
    // 快捷键由无 DOM 的内容入口判断，组件只接收已授权的启动请求。
    if (shouldStartAreaTranslationFromHotkey(event as unknown as KeyboardEvent,
      config as unknown as Parameters<typeof shouldStartAreaTranslationFromHotkey>[1], document as unknown as Document)) {
      event.preventDefault();
      fixture.beginSelection();
    }
    return event;
  };
  return {...fixture, press};
}

describe('圈选翻译快捷键触发', () => {
  it('默认 Shift+Z 在正文按下时进入选区模式，Esc 退出', () => {
    const f = mountTranslator();
    const event = f.press();
    expect(f.state.phase).toBe('selecting');
    expect(event.preventDefault).toHaveBeenCalled();
    f.state.handleKeydown({isTrusted: true, key: 'Escape', preventDefault: vi.fn()});
    expect(f.state.phase).toBe('idle');
  });

  it('焦点停在播放器、带 tabindex 的容器或按钮上时仍然触发', () => {
    const f = mountTranslator();
    const focusable = f.document.createElement('div');
    focusable.setAttribute('tabindex', '-1');
    for (const element of [focusable, f.document.createElement('video'), f.document.createElement('button'), f.document.createElement('a')]) {
      f.state.clearResult();
      f.focus(element);
      f.press();
      expect(f.state.phase, element.tagName).toBe('selecting');
    }
  });

  it('正在输入文字时不抢按键，包括 contenteditable、ARIA 输入框和 ShadowRoot 内的输入', () => {
    const f = mountTranslator();
    const editable = f.document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const ariaInput = f.document.createElement('div');
    ariaInput.setAttribute('role', 'textbox');
    const openHost = f.document.createElement('div');
    const shadowInput = f.document.createElement('input');
    Object.defineProperty(openHost, 'shadowRoot', {value: {activeElement: shadowInput}});
    // 封闭 ShadowRoot 只把宿主暴露为 activeElement；宿主自身不可聚焦，按输入保守处理。
    const closedHost = f.document.createElement('div');
    const customElement = f.document.createElement('my-editor');
    for (const element of [
      f.document.createElement('input'), f.document.createElement('textarea'), f.document.createElement('select'),
      editable, ariaInput, openHost, closedHost, customElement,
    ]) {
      f.focus(element);
      f.press();
      expect(f.state.phase, element.tagName).toBe('idle');
    }
  });

  it('按自定义快捷键触发，原默认组合键不再接管按键', () => {
    const f = mountTranslator();
    f.config.selectionAreaHotkey = 'custom';
    f.config.customSelectionAreaHotkey = 'Alt+X';
    f.press();
    expect(f.state.phase).toBe('idle');
    f.press({key: 'x', code: 'KeyX', shiftKey: false, altKey: true});
    expect(f.state.phase).toBe('selecting');
    f.state.clearResult();
    f.config.selectionAreaHotkey = 'Shift+X';
    f.press({key: 'X', code: 'KeyX'});
    expect(f.state.phase).toBe('selecting');
  });

  it('合成事件、重复按键、输入法组合和功能关闭都不会进入选区模式', () => {
    const f = mountTranslator();
    for (const overrides of [{isTrusted: false}, {repeat: true}, {isComposing: true}, {key: 'a', code: 'KeyA'}]) {
      f.press(overrides);
      expect(f.state.phase).toBe('idle');
    }
    f.config.selectionAreaEnabled = false;
    f.press();
    expect(f.state.phase).toBe('idle');
    f.config.selectionAreaEnabled = true;
    f.config.on = false;
    f.press();
    expect(f.state.phase).toBe('idle');
  });

  it('页面自身的滚动不关闭刚打开的选区，只重置进行中的拖拽', () => {
    const f = mountTranslator();
    f.press();
    f.state.handleViewportChange({target: f.document.body});
    expect(f.state.phase).toBe('selecting');
    const pointer = {isTrusted: true, button: 0, pointerId: 3, clientX: 20, clientY: 30, target: f.document.body, preventDefault: vi.fn(), stopPropagation: vi.fn()};
    f.state.handlePointerdown(pointer);
    f.state.handlePointermove({...pointer, clientX: 120, clientY: 130});
    expect(f.state.selectionRect).toEqual({left: 20, top: 30, width: 100, height: 100});
    f.state.handleViewportChange({target: f.document.body});
    expect(f.state.phase).toBe('selecting');
    expect(f.state.selectionRect).toBeNull();
    // 起点已失效，继续移动不得恢复旧选区；重新按下即可开始新的拖拽。
    f.state.handlePointermove({...pointer, clientX: 200, clientY: 200});
    expect(f.state.selectionRect).toBeNull();
    f.state.handlePointerdown({...pointer, pointerId: 4, clientX: 10, clientY: 10});
    expect(f.state.selectionRect).toEqual({left: 10, top: 10, width: 0, height: 0});
  });

  it('截图完成后页面和卡片滚动保留结果，截图未完成时页面变化取消旧坐标', () => {
    const f = mountTranslator();
    f.state.activeRect = {left: 10, top: 20, width: 120, height: 90};
    f.state.phase = 'translated';
    const host = f.document.createElement('div');
    host.id = 'fluent-read-area-translator-container';
    f.document.body.append(host);
    const inside = f.document.createElement('div');
    host.append(inside);
    f.state.handleViewportChange({target: inside});
    expect(f.state.phase).toBe('translated');
    f.state.handleViewportChange({target: f.document.body});
    expect(f.state.phase).toBe('translated');
    expect(f.state.activeRect).not.toBeNull();
    f.state.phase = 'loading';
    f.state.capturePending = true;
    f.state.handleViewportChange({target: f.document.body});
    expect(f.state.phase).toBe('idle');
    expect(f.state.activeRect).toBeNull();
  });

  it('选区开始后缩小窗口，后续结果按新的视口宽度约束', () => {
    const f = mountTranslator();
    f.press();
    window.innerWidth = 390;
    window.innerHeight = 600;
    f.state.handleViewportChange({target: f.document.body});
    const style = f.state.panelStyle({left: 800, top: 700, width: 120, height: 90});
    expect(style.width).toBe('366px');
    expect(style.left).toBe('12px');
    expect(style.top).toBe('360px');
    expect(f.state.phase).toBe('selecting');
  });
});
