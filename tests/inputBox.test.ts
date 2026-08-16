import { describe, expect, it } from 'vitest';
import {
    getInputBoxText,
    isInputElement,
    matchesInputBoxTrigger,
    removeTriggerSymbols,
} from '@/entrypoints/utils/inputBox';

function keyEvent(key: string, code: string, shiftKey = false): KeyboardEvent {
    return { key, code, shiftKey } as KeyboardEvent;
}

function fakeElement(tagName: string, attributes: Record<string, string> = {}): HTMLElement {
    return {
        tagName,
        getAttribute(name: string) {
            return attributes[name] ?? null;
        },
        isContentEditable: false,
        value: '',
        textContent: '',
        innerText: '',
        type: 'text',
    } as unknown as HTMLElement;
}

describe('输入框快捷键', () => {
    it('兼容浏览器的 Space、Equal 和 Minus 按键值', () => {
        expect(matchesInputBoxTrigger(keyEvent(' ', 'Space'), 'triple_space')).toBe(true);
        expect(matchesInputBoxTrigger(keyEvent('=', 'Equal'), 'triple_equal')).toBe(true);
        expect(matchesInputBoxTrigger(keyEvent('-', 'Minus'), 'triple_dash')).toBe(true);
        expect(matchesInputBoxTrigger(keyEvent('+', 'Equal', true), 'triple_equal')).toBe(false);
    });

    it('识别 plaintext-only 可编辑区域并跳过只读输入框', () => {
        expect(isInputElement(fakeElement('DIV', { contenteditable: 'plaintext-only' }))).toBe(true);
        expect(isInputElement({ ...fakeElement('TEXTAREA'), readOnly: true } as unknown as HTMLElement)).toBe(false);
    });

    it('清理触发符号后保留真实输入内容', () => {
        expect(removeTriggerSymbols('Hello   ', 'triple_space')).toBe('Hello');
        expect(removeTriggerSymbols('Hello===', 'triple_equal')).toBe('Hello');
        expect(getInputBoxText({ ...fakeElement('DIV'), innerText: ' Hello world ' } as unknown as HTMLElement)).toBe('Hello world');
    });
});
