import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    beginTranslation,
    getTranslationState,
    isCurrentTranslation,
    markTranslationError,
    restoreTranslation,
    setRenderedStyleAttribute,
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
    attributes = new Map<string, string>();
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

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
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

    it("恢复双语翻译时还原插件临时修改的内联样式", () => {
        node.setAttribute("style", "display: -webkit-box; -webkit-line-clamp: 2; max-height: 4px;");
        const attempt = beginTranslation(node as unknown as HTMLElement, "bilingual");
        expect(attempt).not.toBeNull();

        node.setAttribute("style", "display: -webkit-box; -webkit-line-clamp: unset; max-height: unset;");
        setRenderedStyleAttribute(node as unknown as HTMLElement);

        expect(restoreTranslation(node as unknown as HTMLElement)).toBe(true);
        expect(node.getAttribute("style")).toBe("display: -webkit-box; -webkit-line-clamp: 2; max-height: 4px;");
    });

    it("网站在翻译后更新样式时，恢复不会覆盖网站的新值", () => {
        node.setAttribute("style", "max-height: 4px;");
        const attempt = beginTranslation(node as unknown as HTMLElement, "bilingual");
        expect(attempt).not.toBeNull();

        node.setAttribute("style", "max-height: unset;");
        setRenderedStyleAttribute(node as unknown as HTMLElement);
        node.setAttribute("style", "max-height: none;");

        expect(restoreTranslation(node as unknown as HTMLElement)).toBe(true);
        expect(node.getAttribute("style")).toBe("max-height: none;");
    });

    it("原节点没有 style 属性时，恢复会移除插件临时创建的 style", () => {
        const attempt = beginTranslation(node as unknown as HTMLElement, "bilingual");
        expect(attempt).not.toBeNull();

        node.setAttribute("style", "-webkit-line-clamp: unset; max-height: unset;");
        setRenderedStyleAttribute(node as unknown as HTMLElement);

        expect(restoreTranslation(node as unknown as HTMLElement)).toBe(true);
        expect(node.getAttribute("style")).toBeNull();
    });
});
