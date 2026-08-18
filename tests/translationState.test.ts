import { beforeEach, describe, expect, it, vi } from "vitest";
import {parseHTML} from "linkedom";
import {
    beginTranslation,
    detachFailedTranslationUi,
    discardTranslation,
    getTranslationOwnersForRemovedNode,
    getTranslationState,
    isCurrentTranslation,
    markTranslationComplete,
    markTranslationError,
    restoreTranslation,
    setBilingualContent,
    setRenderedStyleAttribute,
    setRetryWrapper,
    setSpinner,
    setTextSlotsApplied,
    type TranslationState,
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

    it("保存候选提取后的精确 source，而不是包含扩展 artifact 的 textContent", () => {
        const attempt = beginTranslation(
            node as unknown as HTMLElement,
            "bilingual",
            "content",
            false,
            "Exact protected-aware source",
            [],
        );

        expect(attempt?.state.sourceText).toBe("Exact protected-aware source");
        expect(attempt?.state.sourceTextNodes).toEqual([]);
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

    it("single 在尚未写入译文时恢复，不会断开宿主子节点", () => {
        const originalChild = node.childNodes[0];
        const attempt = beginTranslation(node as unknown as HTMLElement, "single");
        expect(attempt).not.toBeNull();

        expect(restoreTranslation(node as unknown as HTMLElement)).toBe(true);
        expect(node.childNodes).toEqual([originalChild]);
        expect(getTranslationState(node as unknown as HTMLElement)).toBeUndefined();
        expect(attempt!.state.controller.signal.aborted).toBe(true);
    });

    it("站点在异步请求期间重渲染时，全局恢复也不覆盖站点的新节点", () => {
        const attempt = beginTranslation(node as unknown as HTMLElement, "single");
        expect(attempt).not.toBeNull();

        const hostChild = { type: "host-rerendered-child" };
        node.childNodes = [hostChild];
        node.innerHTML = "Host rerendered text";
        attempt!.state.phase = "translated";

        expect(restoreTranslation(node as unknown as HTMLElement)).toBe(true);
        expect(node.childNodes).toEqual([hostChild]);
        expect(getTranslationState(node as unknown as HTMLElement)).toBeUndefined();
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

    it("调用方完成精确 source 校验后，可忽略仅属性导致的 innerHTML 差异", () => {
        const attempt = beginTranslation(node as unknown as HTMLElement, "bilingual");
        expect(attempt).not.toBeNull();
        node.innerHTML = '<span class="animated">Original text</span>';

        expect(markTranslationComplete(
            node as unknown as HTMLElement,
            attempt!.state,
            attempt!.generation,
            false,
        )).toBe(true);
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

    it("live text 恢复保留节点身份，并且不覆盖宿主更新后的文本", () => {
        const {document} = parseHTML('<html><body><p id="target">Open <a href="/guide">the guide</a>.</p></body></html>');
        const target = document.querySelector('#target') as HTMLElement;
        const link = target.querySelector('a')!;
        const attempt = beginTranslation(target, 'single');
        expect(attempt).not.toBeNull();
        const originalNodes = attempt!.state.originalTextValues.map(({node: textNode}) => textNode);

        originalNodes[0]!.nodeValue = '打开 ';
        originalNodes[1]!.nodeValue = '指南';
        setTextSlotsApplied(target, [originalNodes[0]!]);
        expect(attempt!.state.translatedTextNodes).toEqual([originalNodes[0]]);
        originalNodes[1]!.nodeValue = 'Host updated link';

        expect(restoreTranslation(target)).toBe(true);
        expect(target.firstChild).toBe(originalNodes[0]);
        expect(target.querySelector('a')).toBe(link);
        expect(originalNodes[0]!.nodeValue).toBe('Open ');
        expect(originalNodes[1]!.nodeValue).toBe('Host updated link');
    });

    it("能在宿主移除双语 wrapper 后找到并清理其 owner", () => {
        const {document} = parseHTML('<html><body><p id="target">Readable paragraph.</p></body></html>');
        const target = document.querySelector('#target') as HTMLElement;
        const attempt = beginTranslation(target, 'bilingual');
        expect(attempt).not.toBeNull();
        const wrapper = document.createElement('span');
        wrapper.setAttribute('data-fr-translation-owned', 'true');
        target.appendChild(wrapper);
        setBilingualContent(target, wrapper);
        wrapper.remove();

        expect(getTranslationOwnersForRemovedNode(wrapper)).toEqual([target]);
        expect(restoreTranslation(target)).toBe(true);
        expect(getTranslationOwnersForRemovedNode(wrapper)).toEqual([]);
    });

    it("失败重试 wrapper 被宿主移除后仍能通过 ownership 索引找到 owner", () => {
        const {document} = parseHTML('<html><body><p id="target">Readable paragraph.</p></body></html>');
        const target = document.querySelector('#target') as HTMLElement;
        const attempt = beginTranslation(target, 'bilingual')!;
        expect(markTranslationError(target, attempt.state, attempt.generation)).toBe(true);
        const retryWrapper = document.createElement('span');
        retryWrapper.setAttribute('data-fr-translation-owned', 'true');
        target.appendChild(retryWrapper);
        setRetryWrapper(target, retryWrapper);

        retryWrapper.remove();

        expect(getTranslationOwnersForRemovedNode(retryWrapper)).toEqual([target]);
        expect(discardTranslation(target, attempt.state)).toBe(true);
        expect(getTranslationOwnersForRemovedNode(retryWrapper)).toEqual([]);
    });

    it("宿主移除失败 UI 后保留 error tombstone，但清除 UI ownership 和失败 class", () => {
        const {document} = parseHTML('<html><body><p id="target" class="host">Readable paragraph.</p></body></html>');
        const target = document.querySelector('#target') as HTMLElement;
        const attempt = beginTranslation(target, 'bilingual')!;
        expect(markTranslationError(target, attempt.state, attempt.generation)).toBe(true);
        const retryWrapper = document.createElement('span');
        retryWrapper.setAttribute('data-fr-translation-owned', 'true');
        target.appendChild(retryWrapper);
        target.classList.add('fluent-read-failure');
        setRetryWrapper(target, retryWrapper);
        setRenderedStyleAttribute(target);
        retryWrapper.remove();

        expect(detachFailedTranslationUi(target, attempt.state)).toBe(true);
        expect(getTranslationState(target)).toBe(attempt.state);
        expect(attempt.state.phase).toBe('error');
        expect(attempt.state.retryWrapper).toBeUndefined();
        expect(target.className).toBe('host');
        expect(getTranslationOwnersForRemovedNode(retryWrapper)).toEqual([]);
        expect(restoreTranslation(target)).toBe(true);
    });

    it("removed ancestor 和 owner 自身移除都能通过 subtree 索引找到 owner", () => {
        const {document} = parseHTML(`
            <html><body>
                <section id="removed"><div><p id="target">Readable paragraph.</p></div></section>
            </body></html>
        `);
        const removed = document.querySelector("#removed") as HTMLElement;
        const target = document.querySelector("#target") as HTMLElement;
        const attempt = beginTranslation(target, "bilingual");
        expect(attempt).not.toBeNull();

        removed.remove();

        expect(getTranslationOwnersForRemovedNode(removed)).toEqual([target]);
        expect(getTranslationOwnersForRemovedNode(target)).toEqual([target]);
        expect(restoreTranslation(target)).toBe(true);
    });

    it("removed subtree 查询不会读取大批无关 active owner 的状态", () => {
        const {document} = parseHTML(`
            <html><body>
                <section id="removed"><p id="target">Target paragraph.</p></section>
                <main id="unrelated"></main>
            </body></html>
        `);
        const removed = document.querySelector("#removed") as HTMLElement;
        const target = document.querySelector("#target") as HTMLElement;
        const unrelatedRoot = document.querySelector("#unrelated") as HTMLElement;
        const targetAttempt = beginTranslation(target, "bilingual")!;
        const unrelatedAttempts: Array<{owner: HTMLElement; state: TranslationState}> = [];
        let unrelatedStateReads = 0;

        for (let index = 0; index < 1_000; index += 1) {
            const owner = document.createElement("p");
            owner.textContent = `Unrelated paragraph ${index}.`;
            unrelatedRoot.appendChild(owner);
            const attempt = beginTranslation(owner, "bilingual")!;
            Object.defineProperty(attempt.state, "spinner", {
                configurable: true,
                get: () => {
                    unrelatedStateReads += 1;
                    return undefined;
                },
            });
            unrelatedAttempts.push({owner, state: attempt.state});
        }

        try {
            removed.remove();
            expect(getTranslationOwnersForRemovedNode(removed)).toEqual([target]);
            expect(unrelatedStateReads).toBe(0);
        } finally {
            discardTranslation(target, targetAttempt.state);
            unrelatedAttempts.forEach(({owner, state}) => discardTranslation(owner, state));
        }
    });

    it("discard 后 owner 和已脱离的 artifact 都不再命中索引", () => {
        const {document} = parseHTML('<html><body><p id="target">Readable paragraph.</p></body></html>');
        const target = document.querySelector("#target") as HTMLElement;
        const attempt = beginTranslation(target, "bilingual")!;
        const wrapper = document.createElement("span");
        target.appendChild(wrapper);
        setBilingualContent(target, wrapper);
        wrapper.remove();

        expect(discardTranslation(target, attempt.state)).toBe(true);
        expect(getTranslationOwnersForRemovedNode(target)).toEqual([]);
        expect(getTranslationOwnersForRemovedNode(wrapper)).toEqual([]);
    });

    it("替换 spinner 时 ownership 索引只保留当前 artifact", () => {
        const {document} = parseHTML('<html><body><p id="target">Readable paragraph.</p></body></html>');
        const target = document.querySelector("#target") as HTMLElement;
        const attempt = beginTranslation(target, "bilingual")!;
        const firstSpinner = document.createElement("span");
        const secondSpinner = document.createElement("span");
        target.appendChild(firstSpinner);
        setSpinner(target, firstSpinner);

        firstSpinner.remove();
        target.appendChild(secondSpinner);
        setSpinner(target, secondSpinner);

        expect(getTranslationOwnersForRemovedNode(firstSpinner)).toEqual([]);
        expect(getTranslationOwnersForRemovedNode(secondSpinner)).toEqual([target]);
        expect(discardTranslation(target, attempt.state)).toBe(true);
        expect(getTranslationOwnersForRemovedNode(secondSpinner)).toEqual([]);
    });

    it("请求完成并清除 spinner 后同步移除 artifact ownership", () => {
        const {document} = parseHTML('<html><body><p id="target">Readable paragraph.</p></body></html>');
        const target = document.querySelector("#target") as HTMLElement;
        const attempt = beginTranslation(target, "bilingual")!;
        const spinner = document.createElement("span");
        target.appendChild(spinner);
        setSpinner(target, spinner);
        spinner.remove();

        expect(markTranslationComplete(target, attempt.state, attempt.generation)).toBe(true);
        expect(getTranslationOwnersForRemovedNode(spinner)).toEqual([]);
        expect(restoreTranslation(target)).toBe(true);
    });

    it("新一代 begin 会移除旧 artifact 的 ownership", () => {
        const {document} = parseHTML('<html><body><p id="target">Readable paragraph.</p></body></html>');
        const target = document.querySelector("#target") as HTMLElement;
        const first = beginTranslation(target, "bilingual")!;
        const oldWrapper = document.createElement("span");
        target.appendChild(oldWrapper);
        setBilingualContent(target, oldWrapper);
        first.state.phase = "error";

        const second = beginTranslation(target, "bilingual")!;

        expect(getTranslationOwnersForRemovedNode(oldWrapper)).toEqual([]);
        expect(getTranslationOwnersForRemovedNode(target)).toEqual([target]);
        expect(discardTranslation(target, second.state)).toBe(true);
    });

    it("synthetic segment restore 解包后不会残留 ownership", () => {
        const {document} = parseHTML(`
            <html><body><p id="parent">Before <span id="synthetic">inline segment</span> after.</p></body></html>
        `);
        const parent = document.querySelector("#parent") as HTMLElement;
        const synthetic = document.querySelector("#synthetic") as HTMLElement;
        const attempt = beginTranslation(synthetic, "bilingual", "content", true);
        expect(attempt).not.toBeNull();
        expect(getTranslationOwnersForRemovedNode(synthetic)).toEqual([synthetic]);

        expect(restoreTranslation(synthetic)).toBe(true);

        expect(parent.querySelector("#synthetic")).toBeNull();
        expect(parent.textContent).toContain("inline segment");
        expect(getTranslationOwnersForRemovedNode(synthetic)).toEqual([]);
    });
});
