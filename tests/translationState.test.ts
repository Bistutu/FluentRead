import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    beginTranslation,
    getTranslationState,
    isCurrentTranslation,
    markTranslationError,
    restoreTranslation,
} from "@/entrypoints/main/translationState";

/**
 * 用最小的 DOM 替身测试状态机，不把 jsdom 引入生产依赖。
 * 这些对象只实现 translationState.ts 真正使用的节点能力。
 */
class FakeElement {
    isConnected = true;
    textContent = "Original text";
    innerHTML = "Original text";
    outerHTML = "<p>Original text</p>";
    childNodes: object[] = [{ type: "original-child" }];
    classList = { remove: vi.fn() };
    controller?: AbortController;

    get firstChild(): object | undefined {
        return this.childNodes[0];
    }

    removeChild(child: object): object {
        const index = this.childNodes.indexOf(child);
        if (index >= 0) this.childNodes.splice(index, 1);
        return child;
    }

    appendChild(child: object): object {
        this.childNodes.push(child);
        return child;
    }

    querySelectorAll(): object[] {
        return [];
    }
}

describe("指定节点翻译状态机", () => {
    let node: FakeElement;

    beforeEach(() => {
        node = new FakeElement();
    });

    it("同一个节点在 loading 期间不会重复发起请求", () => {
        const first = beginTranslation(node as unknown as HTMLElement, "single");

        expect(first).not.toBeNull();
        expect(beginTranslation(node as unknown as HTMLElement, "single")).toBeNull();
        expect(getTranslationState(node as unknown as HTMLElement)).toBe(first?.state);
    });

    it("旧一代请求在重新开始后不再被视为当前请求", () => {
        const first = beginTranslation(node as unknown as HTMLElement, "bilingual");
        expect(first).not.toBeNull();

        markTranslationError(
            node as unknown as HTMLElement,
            first!.state,
            first!.generation,
        );
        const second = beginTranslation(node as unknown as HTMLElement, "bilingual");

        expect(second?.generation).toBe(first!.generation + 1);
        expect(isCurrentTranslation(
            node as unknown as HTMLElement,
            first!.state,
            first!.generation,
        )).toBe(false);
        expect(isCurrentTranslation(
            node as unknown as HTMLElement,
            second!.state,
            second!.generation,
        )).toBe(true);
    });

    it("仅译文模式恢复原始 ChildNode 对象，而不是重建 HTML", () => {
        const originalChild = node.childNodes[0];
        const attempt = beginTranslation(node as unknown as HTMLElement, "single");
        expect(attempt).not.toBeNull();

        node.childNodes = [{ type: "translated-child" }];
        node.innerHTML = "Translated text";
        attempt!.state.phase = "translated";
        attempt!.state.translatedHTML = node.innerHTML;

        expect(restoreTranslation(node as unknown as HTMLElement)).toBe(true);
        expect(node.childNodes).toEqual([originalChild]);
        expect(getTranslationState(node as unknown as HTMLElement)).toBeUndefined();
        expect(attempt!.state.controller.signal.aborted).toBe(true);
    });

    it("站点在异步请求期间重渲染时，不覆盖站点的新节点", () => {
        const originalChild = node.childNodes[0];
        const attempt = beginTranslation(node as unknown as HTMLElement, "single");
        expect(attempt).not.toBeNull();

        const hostChild = { type: "host-rerendered-child" };
        node.childNodes = [hostChild];
        node.innerHTML = "Host rerendered text";
        attempt!.state.phase = "translated";
        attempt!.state.translatedHTML = "Translated text";

        expect(restoreTranslation(node as unknown as HTMLElement)).toBe(true);
        expect(node.childNodes).toEqual([hostChild]);
        expect(node.childNodes).not.toContain(originalChild);
    });

    it("站点在请求期间重渲染时，不把失败状态写入新内容", () => {
        const attempt = beginTranslation(node as unknown as HTMLElement, "bilingual");
        expect(attempt).not.toBeNull();

        node.innerHTML = "Host rerendered text";

        expect(markTranslationError(
            node as unknown as HTMLElement,
            attempt!.state,
            attempt!.generation,
        )).toBe(false);
        expect(getTranslationState(node as unknown as HTMLElement)).toBe(attempt!.state);
        expect(attempt!.state.phase).toBe("loading");
    });
});
