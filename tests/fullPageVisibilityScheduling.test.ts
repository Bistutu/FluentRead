import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {parseHTML} from "linkedom";

const runtime = vi.hoisted(() => ({
    candidates: [] as Array<{
        element: HTMLElement;
        kind: "content";
        reason: string;
        nodes?: readonly Node[];
        adapterId?: string;
    }>,
    requests: vi.fn<(origins: readonly string[]) => Promise<string[]>>(async (origins) =>
        origins.map((origin) => `译:${origin}`),
    ),
    retryCallbacks: [] as Array<() => void>,
    config: {service: "microsoft", display: 0, to: "zh"},
}));

vi.mock("@/entrypoints/utils/check", () => ({checkConfig: () => true}));
vi.mock("@/entrypoints/utils/option", () => ({
    services: {microsoft: "microsoft", freeTranslation: "freeTranslation"},
}));
vi.mock("@/entrypoints/utils/constant", () => ({
    styles: {singleTranslation: 0, bilingualTranslation: 1},
}));
vi.mock("@/entrypoints/utils/config", () => ({
    config: runtime.config,
}));
vi.mock("@/entrypoints/utils/common", () => ({detectlang: () => ""}));
vi.mock("@/entrypoints/utils/translateApi", () => ({
    translateText: async (origin: string) => (await runtime.requests([origin]))[0],
    translateTextBatch: (origins: readonly string[]) => runtime.requests(origins),
}));
vi.mock("@/entrypoints/utils/translateQueue", () => ({
    createTranslationQueueSession: () => ({}),
    cancelTranslationQueueSession: () => undefined,
}));
vi.mock("@/entrypoints/utils/icon", () => ({
    insertLoadingSpinner: (node: HTMLElement) => {
        const spinner = node.ownerDocument.createElement("span");
        spinner.setAttribute("data-fr-translation-owned", "true");
        node.appendChild(spinner);
        return spinner;
    },
    insertFailedTip: (node: HTMLElement, _message: string, onRetry: () => void) => {
        runtime.retryCallbacks.push(onRetry);
        return node.ownerDocument.createElement("span");
    },
}));
vi.mock("@/entrypoints/main/translationRenderer", () => ({
    appendBilingualTranslation: (node: HTMLElement, text: string) => {
        const wrapper = node.ownerDocument.createElement("span");
        wrapper.className = "fluent-read-bilingual-content";
        wrapper.setAttribute("data-fr-translation-owned", "true");
        wrapper.textContent = text;
        node.appendChild(wrapper);
        return wrapper;
    },
}));
vi.mock("@/entrypoints/translation-core/public", () => {
    const protectedSelector = [
        "head", "script", "style", "noscript", "iframe", "input", "textarea", "select", "option",
        "math", "svg", "canvas", "audio", "video", "object", "template", "xmp", "pre", "code",
        "kbd", "samp", "var", "mjx-container", ".MathJax_Display", ".MathJax", ".MathJax_Preview",
        ".katex", ".notranslate", "[translate='no']", "[data-notranslate='true']", "[hidden]",
        "[inert]", "[aria-hidden='true']",
    ].join(",");
    const isProtected = (element: Element) => Boolean(element.closest(protectedSelector));
    const textSlots = (element: HTMLElement) => {
        const slots: Array<{node: Text; prefix: string; source: string; suffix: string}> = [];
        const walker = element.ownerDocument.createTreeWalker(element, 4);
        let current = walker.nextNode();
        while (current) {
            const node = current as Text;
            const source = node.nodeValue ?? "";
            if (source.trim() && node.parentElement && !isProtected(node.parentElement) &&
                !node.parentElement.closest('[data-fr-translation-owned="true"]')) {
                slots.push({node, prefix: "", source, suffix: ""});
            }
            current = walker.nextNode();
        }
        return slots;
    };

    return {
        extractTranslationText: (element: HTMLElement) => textSlots(element).map(({source}) => source).join(""),
        extractTranslationTextFromNodes: (nodes: readonly Node[]) =>
            nodes.map((node) => node.textContent ?? "").join(""),
        applyTranslationsToSnapshot: (_snapshot: unknown, translations: readonly string[]) => translations.join(""),
        collectLiveTranslationTextSlots: textSlots,
        createTranslationSourceSnapshot: (element: HTMLElement) => ({
            slots: textSlots(element).map(({source}) => ({source})),
        }),
        evaluateHardGuard: (element: Element) => ({prune: isProtected(element)}),
        getComposedParent: (element: Element) => element.parentElement ??
            ((element.getRootNode?.() as {host?: Element})?.host ?? null),
        isProtectedDescendantElement: (element: Element) => element.matches(protectedSelector),
        getCurrentTranslationCore: () => ({
            shouldStayOriginal: () => false,
            shouldIgnoreMutation: () => false,
            inspect: (element: HTMLElement) => ({
                candidate: [...runtime.candidates].reverse().find((candidate) =>
                    candidate.element === element && !isProtected(candidate.element)),
            }),
            resolve: (start: Node | null | undefined) => [...runtime.candidates].reverse().find((candidate) => {
                if (!start || isProtected(candidate.element)) return false;
                const key = candidate.nodes?.[0] ?? candidate.element;
                return key === start || candidate.element === start || candidate.element.contains(start);
            }),
            *discoverSteps() {
                for (const segment of document.querySelectorAll<HTMLElement>(
                    '[data-fr-translation-segment="true"]',
                )) {
                    yield {phase: "enter", element: segment};
                }
                for (const candidate of runtime.candidates) {
                    if (isProtected(candidate.element)) continue;
                    if (candidate.element.matches('[data-fr-translation-segment="true"]') ||
                        candidate.element.querySelector('[data-fr-translation-segment="true"]')) continue;
                    yield {
                        phase: "exit",
                        element: candidate.element,
                        candidate,
                    };
                }
            },
        }),
        getOpenShadowRoots: () => [],
        getTranslationCandidateKey: (candidate: {element: HTMLElement; nodes?: readonly Node[]}) =>
            candidate.nodes?.[0] ?? candidate.element,
        isClearlyTargetLanguage: () => false,
        parseTranslationSlots: () => null,
        resolveTranslationCandidate: (start: Node | null | undefined) =>
            [...runtime.candidates].reverse().find((candidate) => candidate.element === start),
        resolveTranslationCandidateAtPoint: () => null,
        selectPreferredTranslationCandidate: (
            existing: {element: HTMLElement; adapterId?: string},
            candidate: {element: HTMLElement; adapterId?: string},
        ) => candidate.adapterId ? candidate : existing,
        serializeTranslationSlots: (origins: readonly string[]) => ({payload: origins.join("\n")}),
    };
});

import {
    autoTranslateEnglishPage,
    handleBilingualTranslation,
    isFullPageTranslationActive,
    restoreOriginalContent,
} from "@/entrypoints/main/trans";
import {getTranslationState} from "@/entrypoints/main/translationState";

class TestIntersectionObserver {
    static instances: TestIntersectionObserver[] = [];

    readonly observed = new Set<Element>();
    readonly observe = vi.fn((target: Element) => this.observed.add(target));
    readonly unobserve = vi.fn((target: Element) => this.observed.delete(target));
    readonly disconnect = vi.fn(() => this.observed.clear());

    constructor(private readonly callback: IntersectionObserverCallback) {
        TestIntersectionObserver.instances.push(this);
    }

    emit(target: Element, isIntersecting: boolean): void {
        this.callback([{target, isIntersecting} as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
}

class TestMutationObserver {
    static instances: TestMutationObserver[] = [];

    readonly observe = vi.fn();
    readonly disconnect = vi.fn();
    readonly takeRecords = vi.fn(() => [] as MutationRecord[]);

    constructor(private readonly callback: MutationCallback) {
        TestMutationObserver.instances.push(this);
    }

    emit(records: MutationRecord[]): void {
        this.callback(records, this as unknown as MutationObserver);
    }
}

const replacedGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();

function replaceGlobal(name: PropertyKey, value: unknown): void {
    if (!replacedGlobals.has(name)) replacedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
}

function setLayoutBox(element: Element, width: number, height: number): void {
    const rect = {width, height, top: 0, right: width, bottom: height, left: 0, x: 0, y: 0};
    Object.defineProperty(element, "getClientRects", {
        configurable: true,
        value: () => width > 0 && height > 0
            ? Object.assign([rect], {item: (index: number) => index === 0 ? rect : null})
            : Object.assign([], {item: () => null}),
    });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

async function finishScheduledWork(): Promise<void> {
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
}

describe("全文翻译可见性锚点", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        runtime.candidates = [];
        runtime.requests.mockReset();
        runtime.requests.mockImplementation(async (origins) => origins.map((origin) => `译:${origin}`));
        runtime.retryCallbacks = [];
        runtime.config.display = 0;
        TestIntersectionObserver.instances = [];
        TestMutationObserver.instances = [];

        const {window, document} = parseHTML("<html><head><title>Fixture</title></head><body></body></html>");
        replaceGlobal("window", window);
        replaceGlobal("document", document);
        replaceGlobal("Node", window.Node);
        replaceGlobal("Element", window.Element);
        replaceGlobal("HTMLElement", window.HTMLElement);
        replaceGlobal("Text", window.Text);
        replaceGlobal("ShadowRoot", window.ShadowRoot);
        replaceGlobal("DOMParser", window.DOMParser);
        replaceGlobal("MutationObserver", TestMutationObserver);
        replaceGlobal("IntersectionObserver", TestIntersectionObserver);
        Object.defineProperty(window, "setTimeout", {configurable: true, value: globalThis.setTimeout});
        Object.defineProperty(window, "clearTimeout", {configurable: true, value: globalThis.clearTimeout});
    });

    afterEach(() => {
        restoreOriginalContent();
        vi.clearAllTimers();
        vi.useRealTimers();
        for (const [name, descriptor] of replacedGlobals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
        replacedGlobals.clear();
    });

    it("候选自身有布局盒时直接观察候选，不改用内部标签", async () => {
        document.body.innerHTML = '<h1 id="title"><span id="label">Visible heading</span></h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        const label = document.querySelector<HTMLElement>("#label")!;
        setLayoutBox(title, 320, 48);
        setLayoutBox(label, 200, 28);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(title);
        expect(observer.observe).not.toHaveBeenCalledWith(label);
        expect(runtime.requests).not.toHaveBeenCalled();
    });

    it("观察 display:contents H1 的首个真实布局后代，并在完成后解除该锚点", async () => {
        document.body.innerHTML = '<h1 id="title"><span id="label">Pull request title</span></h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        const label = document.querySelector<HTMLElement>("#label")!;
        setLayoutBox(title, 0, 0);
        setLayoutBox(label, 240, 36);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(label);
        expect(observer.observe).not.toHaveBeenCalledWith(title);
        expect(runtime.requests).not.toHaveBeenCalled();

        observer.emit(label, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledWith(["Pull request title"]);
        expect(title.textContent).toBe("译:Pull request title");
        expect(observer.unobserve).toHaveBeenCalledWith(label);
    });

    it("hydration 替换 display:contents 后代后刷新同候选 anchor，旧 IO 不会丢失或重复调度", async () => {
        document.body.innerHTML = '<h1 id="title"><span id="label-a">Hydrating title</span></h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        const labelA = document.querySelector<HTMLElement>("#label-a")!;
        setLayoutBox(title, 0, 0);
        setLayoutBox(labelA, 220, 36);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(labelA);

        const labelB = document.createElement("span");
        labelB.id = "label-b";
        labelB.textContent = "Hydrated title";
        setLayoutBox(labelB, 240, 40);
        labelA.replaceWith(labelB);
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "childList",
            target: title,
            addedNodes: [labelB] as unknown as NodeList,
            removedNodes: [labelA] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);

        expect(observer.unobserve).toHaveBeenCalledWith(labelA);
        expect(observer.observe).toHaveBeenCalledWith(labelB);
        expect(runtime.requests).not.toHaveBeenCalled();

        // A queued callback for the detached target is harmless; only the new
        // live anchor can cross the visibility gate for this stable H1 key.
        observer.emit(labelA, true);
        await finishScheduledWork();
        expect(runtime.requests).not.toHaveBeenCalled();

        const request = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => request.promise);
        observer.emit(labelB, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        // A second IO notification while the first generation is in flight
        // must not create another provider call or displace that generation.
        observer.emit(labelB, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        request.resolve(["译:Hydrated title"]);
        await finishScheduledWork();
        expect(title.textContent).toBe("译:Hydrated title");
        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("没有任何布局锚点的 H1 仍直接进入受控翻译队列", async () => {
        document.body.innerHTML = '<h1 id="title">Text-only heading</h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        setLayoutBox(title, 0, 0);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        await finishScheduledWork();

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).not.toHaveBeenCalled();
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests).toHaveBeenCalledWith(["Text-only heading"]);
        expect(title.textContent).toBe("译:Text-only heading");
    });

    it("inFlightCandidates 是唯一并发计数，并在 settle 后释放下一候选", async () => {
        document.body.innerHTML = ["One", "Two", "Three", "Four"]
            .map((label, index) => `<p id="candidate-${index}">${label}</p>`)
            .join("");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("p"));
        candidates.forEach((candidate) => setLayoutBox(candidate, 400, 40));
        runtime.candidates = candidates.map((element) => ({
            element,
            kind: "content" as const,
            reason: "paragraph",
        }));
        const requests = candidates.map(() => deferred<string[]>());
        let nextRequest = 0;
        runtime.requests.mockImplementation(() => requests[nextRequest++]!.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const observer = TestIntersectionObserver.instances[0]!;
        candidates.forEach((candidate) => observer.emit(candidate, true));
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        expect(runtime.requests).toHaveBeenCalledTimes(3);

        requests[0]!.resolve(["译:One"]);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(4);

        requests[1]!.resolve(["译:Two"]);
        requests[2]!.resolve(["译:Three"]);
        requests[3]!.resolve(["译:Four"]);
        await finishScheduledWork();
        expect(candidates.map((candidate) => candidate.textContent)).toEqual([
            "译:One", "译:Two", "译:Three", "译:Four",
        ]);
    });

    it("不会把扩展生成的布局节点当成候选可见性锚点", async () => {
        document.body.innerHTML = `
            <h1 id="title">
                <span id="owned" data-fr-translation-owned="true">Loading</span>
                <span id="host-label">Host title</span>
            </h1>
        `;
        const title = document.querySelector<HTMLElement>("#title")!;
        const owned = document.querySelector<HTMLElement>("#owned")!;
        const hostLabel = document.querySelector<HTMLElement>("#host-label")!;
        setLayoutBox(title, 0, 0);
        setLayoutBox(owned, 100, 20);
        setLayoutBox(hostLabel, 180, 30);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(hostLabel);
        expect(observer.observe).not.toHaveBeenCalledWith(owned);
        expect(runtime.requests).not.toHaveBeenCalled();
    });

    it("替换同 key 候选时解除旧 anchor、切换 owner，并在 stop 后不再调度", async () => {
        document.body.innerHTML = `
            <div id="generic"><h1 id="title"><span id="label">Exact title</span></h1></div>
        `;
        const generic = document.querySelector<HTMLElement>("#generic")!;
        const title = document.querySelector<HTMLElement>("#title")!;
        const label = document.querySelector<HTMLElement>("#label")!;
        setLayoutBox(generic, 640, 120);
        setLayoutBox(title, 0, 0);
        setLayoutBox(label, 220, 36);
        runtime.candidates = [
            {element: generic, nodes: [title], kind: "content", reason: "inline-run"},
            {element: title, kind: "content", reason: "site-title", adapterId: "site"},
        ];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(generic);
        expect(observer.unobserve).toHaveBeenCalledWith(generic);
        expect(observer.observe).toHaveBeenCalledWith(label);
        expect(isFullPageTranslationActive()).toBe(true);

        restoreOriginalContent();
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
        expect(isFullPageTranslationActive()).toBe(false);

        observer.emit(label, true);
        await finishScheduledWork();
        expect(runtime.requests).not.toHaveBeenCalled();
    });

    it("旧 IntersectionObserver 的排队 callback 不会把新会话候选送入队列", async () => {
        document.body.innerHTML = '<h1 id="title">Shared title across sessions</h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        setLayoutBox(title, 320, 48);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const oldObserver = TestIntersectionObserver.instances[0]!;
        expect(oldObserver.observe).toHaveBeenCalledWith(title);

        restoreOriginalContent();
        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const newObserver = TestIntersectionObserver.instances[1]!;
        expect(newObserver.observe).toHaveBeenCalledWith(title);

        // Browser delivery can race disconnect(). Even if an already-queued old
        // callback carries a target observed again by the new session, it still
        // belongs to the disposed session and must not consult the new maps.
        oldObserver.emit(title, true);
        await finishScheduledWork();
        expect(runtime.requests).not.toHaveBeenCalled();

        newObserver.emit(title, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests).toHaveBeenCalledWith(["Shared title across sessions"]);
    });

    it("失败 UI 注入的重试回调会按点击时的当前显示模式重新解析候选", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = '<p id="prose">Retry with the latest display mode.</p>';
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];
        runtime.requests.mockRejectedValueOnce(new Error("provider unavailable"));

        handleBilingualTranslation(paragraph, false);
        await finishScheduledWork();

        expect(getTranslationState(paragraph)?.phase).toBe("error");
        expect(runtime.retryCallbacks).toHaveLength(1);

        runtime.config.display = 0;
        runtime.retryCallbacks[0]!();
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(getTranslationState(paragraph)).toMatchObject({phase: "translated", mode: "single"});
        expect(paragraph.querySelector(".fluent-read-bilingual-content")).toBeNull();
        expect(paragraph.textContent).toBe("译:Retry with the latest display mode.");
    });

    it.each(["translate-no", "hidden"] as const)(
        "全文会话登记启动前 hover 状态的祖先索引，新增 %s 会恢复且 stop 后不再响应",
        async (guard) => {
            runtime.config.display = 1;
            document.body.innerHTML = `
                <section id="ancestor">
                    <p id="prose">Hover translation exists before full-page discovery.</p>
                </section>
            `;
            const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
            const paragraph = document.querySelector<HTMLElement>("#prose")!;
            setLayoutBox(paragraph, 620, 90);
            runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

            handleBilingualTranslation(paragraph, false);
            await finishScheduledWork();

            const hoverState = getTranslationState(paragraph)!;
            expect(hoverState.phase).toBe("translated");
            expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
            expect(runtime.requests).toHaveBeenCalledTimes(1);

            autoTranslateEnglishPage();
            await vi.advanceTimersByTimeAsync(50);

            // Discovery must only register the existing hover state in the
            // current full session. It must not replace the state or request it
            // again before an authoritative ancestor guard changes.
            expect(getTranslationState(paragraph)).toBe(hoverState);
            expect(runtime.requests).toHaveBeenCalledTimes(1);
            const mutationObserver = TestMutationObserver.instances.at(-1)!;

            if (guard === "translate-no") ancestor.setAttribute("translate", "no");
            else ancestor.hidden = true;
            mutationObserver.emit([{
                type: "attributes",
                target: ancestor,
                attributeName: guard === "translate-no" ? "translate" : "hidden",
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await finishScheduledWork();

            expect(hoverState.controller.signal.aborted).toBe(true);
            expect(getTranslationState(paragraph)).toBeUndefined();
            expect(paragraph.textContent).toBe("Hover translation exists before full-page discovery.");
            expect(paragraph.querySelectorAll('[data-fr-translation-owned="true"]')).toHaveLength(0);
            expect(runtime.requests).toHaveBeenCalledTimes(1);

            restoreOriginalContent();
            expect(isFullPageTranslationActive()).toBe(false);
            if (guard === "translate-no") ancestor.removeAttribute("translate");
            else ancestor.hidden = false;
            mutationObserver.emit([{
                type: "attributes",
                target: ancestor,
                attributeName: guard === "translate-no" ? "translate" : "hidden",
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await finishScheduledWork();
            expect(runtime.requests).toHaveBeenCalledTimes(1);
        },
    );

    it("全文 discovery enter 会登记启动前已提交的 hover synthetic 状态", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                    <p>Independent block child.</p>
                </div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceNodes = [host.firstChild as Text, document.querySelector<HTMLElement>("#emphasis")!] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];

        handleBilingualTranslation(host, false);
        await finishScheduledWork();

        const segment = host.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        const hoverState = getTranslationState(segment)!;
        expect(hoverState.phase).toBe("translated");
        expect(segment.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        expect(getTranslationState(segment)).toBe(hoverState);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.setAttribute("translate", "no");
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "translate",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();

        expect(hoverState.controller.signal.aborted).toBe(true);
        expect(segment.isConnected).toBe(false);
        expect(ancestor.querySelectorAll(
            '[data-fr-translation-segment="true"], [data-fr-translation-owned="true"]',
        )).toHaveLength(0);
        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("全文 discovery enter 会登记启动前 in-flight hover synthetic 状态且旧结果不可覆盖", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                    <p>Independent block child.</p>
                </div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceNodes = [host.firstChild as Text, document.querySelector<HTMLElement>("#emphasis")!] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];
        const pendingRequest = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => pendingRequest.promise);

        handleBilingualTranslation(host, false);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        const segment = host.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        const hoverState = getTranslationState(segment)!;
        expect(hoverState.phase).toBe("loading");
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        expect(getTranslationState(segment)).toBe(hoverState);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.hidden = true;
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "hidden",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);

        expect(hoverState.controller.signal.aborted).toBe(true);
        expect(segment.isConnected).toBe(false);
        pendingRequest.resolve(runtime.requests.mock.calls[0]![0].map((origin) => `旧译:${origin}`));
        await finishScheduledWork();

        expect(ancestor.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(0);
        expect(ancestor.querySelectorAll('[data-fr-translation-owned="true"]')).toHaveLength(0);
        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("共享 key 状态会按 candidate owner 到实际 keyedTarget 登记祖先索引", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="owner"><p id="prose">Exact hover target shares a later full-page key.</p></div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const owner = document.querySelector<HTMLElement>("#owner")!;
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        setLayoutBox(owner, 640, 120);
        setLayoutBox(paragraph, 600, 80);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "exact-hover"}];

        handleBilingualTranslation(paragraph, false);
        await finishScheduledWork();
        const hoverState = getTranslationState(paragraph)!;
        expect(hoverState.phase).toBe("translated");
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        runtime.candidates = [{
            element: owner,
            nodes: [paragraph],
            kind: "content",
            reason: "shared-key-inline-run",
        }];
        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        expect(getTranslationState(paragraph)).toBe(hoverState);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.setAttribute("translate", "no");
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "translate",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();

        expect(hoverState.controller.signal.aborted).toBe(true);
        expect(getTranslationState(paragraph)).toBeUndefined();
        expect(paragraph.textContent).toBe("Exact hover target shares a later full-page key.");
        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("异步 nodes 候选只忽略 synthetic source 迁移与当前 spinner 的真实 childList 记录", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                <p>Independent block child.</p>
            </div>
        `;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceText = host.firstChild as Text;
        const emphasis = document.querySelector<HTMLElement>("#emphasis")!;
        const sourceNodes = [sourceText, emphasis] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];
        const pendingRequest = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => pendingRequest.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(host, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        const segment = host.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        const spinner = segment.querySelector<HTMLElement>('[data-fr-translation-owned="true"]')!;
        expect(Array.from(segment.childNodes).filter((node) => node !== spinner)).toEqual(sourceNodes);
        const nativeCloneNode = segment.cloneNode.bind(segment);
        let snapshotCloneCalls = 0;
        Object.defineProperty(segment, "cloneNode", {
            configurable: true,
            value: (deep?: boolean) => {
                snapshotCloneCalls += 1;
                return nativeCloneNode(deep);
            },
        });

        // These are the actual live Node identities produced by materialization:
        // the host gains the segment, its source nodes move into that segment,
        // and the same segment receives the one state-owned spinner.
        TestMutationObserver.instances.at(-1)!.emit([
            {
                type: "childList",
                target: host,
                addedNodes: [segment] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            },
            ...sourceNodes.map((node) => ({
                type: "childList",
                target: host,
                addedNodes: [] as unknown as NodeList,
                removedNodes: [node] as unknown as NodeList,
            })),
            ...Array.from({length: 64}, () => ({
                type: "childList",
                target: segment,
                addedNodes: [...sourceNodes, spinner] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            })),
        ] as unknown as MutationRecord[]);
        await vi.advanceTimersByTimeAsync(100);

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(snapshotCloneCalls).toBe(1);
        expect(segment.isConnected).toBe(true);
        pendingRequest.resolve(runtime.requests.mock.calls[0]![0].map((origin) => `译:${origin}`));
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(segment.isConnected).toBe(true);
        expect(segment.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
    });

    it("已译 synthetic inline-run 的祖先新增 translate=no 会 abort、unwrap，移除后可重译", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                    <p>Independent block child.</p>
                </div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceNodes = [host.firstChild as Text, document.querySelector<HTMLElement>("#emphasis")!] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(host, true);
        await finishScheduledWork();

        const firstSegment = host.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        const firstState = getTranslationState(firstSegment)!;
        expect(firstSegment.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
        expect(firstState.controller.signal.aborted).toBe(false);

        ancestor.setAttribute("translate", "no");
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "translate",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();

        expect(firstState.controller.signal.aborted).toBe(true);
        expect(firstSegment.isConnected).toBe(false);
        expect(ancestor.querySelectorAll(
            '[data-fr-translation-segment="true"], [data-fr-translation-owned="true"]',
        )).toHaveLength(0);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.removeAttribute("translate");
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "translate",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(host, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(host.querySelectorAll('[data-fr-translation-segment="true"]')).toHaveLength(1);
        expect(host.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
    });

    it("in-flight synthetic inline-run 的祖先 hidden 会 abort，旧结果不可覆盖且解除后可翻译", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                    <p>Independent block child.</p>
                </div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceNodes = [host.firstChild as Text, document.querySelector<HTMLElement>("#emphasis")!] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];
        const firstRequest = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => firstRequest.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(host, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        const firstSegment = host.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        const firstState = getTranslationState(firstSegment)!;
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(firstState.phase).toBe("loading");

        ancestor.hidden = true;
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "hidden",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);

        expect(firstState.controller.signal.aborted).toBe(true);
        expect(firstSegment.isConnected).toBe(false);
        expect(ancestor.querySelectorAll(
            '[data-fr-translation-segment="true"], [data-fr-translation-owned="true"]',
        )).toHaveLength(0);

        firstRequest.resolve(runtime.requests.mock.calls[0]![0].map((origin) => `旧译:${origin}`));
        await finishScheduledWork();
        expect(ancestor.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(0);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.hidden = false;
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "hidden",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(host, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(host.querySelectorAll('[data-fr-translation-segment="true"]')).toHaveLength(1);
        expect(host.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
        expect(host.textContent).not.toContain("旧译:");
    });

    it("loading synthetic 内新增 lookalike owned artifact 仍会 stale、恢复并重译", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                <p>Independent block child.</p>
            </div>
        `;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceText = host.firstChild as Text;
        const emphasis = document.querySelector<HTMLElement>("#emphasis")!;
        const sourceNodes = [sourceText, emphasis] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];
        const firstRequest = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => firstRequest.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(host, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        const segment = host.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        const spinner = segment.querySelector<HTMLElement>('[data-fr-translation-owned="true"]')!;
        const mutationObserver = TestMutationObserver.instances.at(-1)!;
        mutationObserver.emit([{
            type: "childList",
            target: segment,
            addedNodes: [...sourceNodes, spinner] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        expect(segment.isConnected).toBe(true);

        const lookalike = document.createElement("span");
        lookalike.setAttribute("data-fr-translation-owned", "true");
        lookalike.textContent = "Host inserted lookalike artifact";
        segment.appendChild(lookalike);
        mutationObserver.emit([{
            type: "childList",
            target: segment,
            addedNodes: [lookalike] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);

        expect(segment.isConnected).toBe(false);
        expect(lookalike.isConnected).toBe(false);
        firstRequest.resolve(runtime.requests.mock.calls[0]![0].map((origin) => `译:${origin}`));
        await finishScheduledWork();
        visibilityObserver.emit(host, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(host.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
    });

    it("provider 进行中 attribute/owner 与下一代 source 依次失效后只提交最新 generation", async () => {
        document.body.innerHTML = `
            <article id="owner" data-layout="paragraph">
                <p id="math">A long perspective paragraph with an inline formula.</p>
            </article>
        `;
        const owner = document.querySelector<HTMLElement>("#owner")!;
        const paragraph = document.querySelector<HTMLElement>("#math")!;
        setLayoutBox(owner, 750, 180);
        setLayoutBox(paragraph, 750, 140);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        const firstRequest = deferred<string[]>();
        const secondRequest = deferred<string[]>();
        runtime.requests
            .mockImplementationOnce(() => firstRequest.promise)
            .mockImplementationOnce(() => secondRequest.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const observer = TestIntersectionObserver.instances[0]!;
        observer.emit(paragraph, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests).toHaveBeenNthCalledWith(1, [
            "A long perspective paragraph with an inline formula.",
        ]);

        // First invalidate only semantic ownership. The source is intentionally
        // unchanged so this path proves commit-time candidate revalidation rather
        // than relying on the source snapshot check.
        owner.setAttribute("data-layout", "article");
        runtime.candidates = [{element: owner, kind: "content", reason: "article-prose"}];
        firstRequest.resolve(["译:A long perspective paragraph with an inline formula."]);

        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        await Promise.resolve();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(runtime.requests).toHaveBeenNthCalledWith(2, [
            "A long perspective paragraph with an inline formula.",
        ]);

        // The fresh ARTICLE generation is now in flight. Change its source and
        // resolve the old request; lifecycle retry must reset for the new source
        // signature and commit only the third generation.
        paragraph.firstChild!.nodeValue = "The settled perspective paragraph keeps the inline formula intact.";
        secondRequest.resolve(["译:A long perspective paragraph with an inline formula."]);

        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(3);
        expect(runtime.requests).toHaveBeenNthCalledWith(3, [
            "The settled perspective paragraph keeps the inline formula intact.",
        ]);
        expect(paragraph.textContent).toBe("译:The settled perspective paragraph keeps the inline formula intact.");

        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(3);
    });

    it("显式 unchanged 在同一全文会话形成 source 签名墓碑，普通 rescan 不重复请求", async () => {
        document.body.innerHTML = '<h1 id="brand">Microsoft</h1>';
        const brand = document.querySelector<HTMLElement>("#brand")!;
        setLayoutBox(brand, 300, 48);
        runtime.candidates = [{element: brand, kind: "content", reason: "heading"}];
        runtime.requests.mockImplementation(async (origins) => [...origins]);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        TestIntersectionObserver.instances[0]!.emit(brand, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(brand.textContent).toBe("Microsoft");

        brand.className = "layout-only-change";
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: brand,
            attributeName: "class",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("已译 prose 忽略 MathJax/code 等保护后代 churn，但外层 source mutation 会重启", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <p id="prose">
                <span id="lead">Readable prose before protected renderers. </span>
                <span id="math-v2-root" class="MathJax_Display"><span id="math-v2">x + y</span></span>
                <mjx-container id="math-v3-root"><span id="math-v3">a = b</span></mjx-container>
                <span id="katex-root" class="katex"><span id="katex">c = d</span></span>
                <code id="code">const answer = 42;</code>
                <span id="translate-no" translate="no">Do not translate</span>
                <span id="notranslate" class="notranslate">Keep original</span>
                <span id="tail"> Readable prose after protected renderers.</span>
            </p>
        `;
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        const lead = document.querySelector<HTMLElement>("#lead")!;
        const protectedChurnHosts = [
            "#math-v2", "#math-v3", "#katex", "#code", "#translate-no", "#notranslate",
        ].map((selector) => document.querySelector<HTMLElement>(selector)!);
        const protectedAttributeRoots = [
            "#math-v2-root", "#math-v3-root", "#katex-root", "#code", "#translate-no", "#notranslate",
        ].map((selector) => document.querySelector<HTMLElement>(selector)!);
        setLayoutBox(paragraph, 700, 140);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        const firstWrapper = paragraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
        expect(firstWrapper?.isConnected).toBe(true);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);

        const records: MutationRecord[] = [];
        for (const [index, host] of protectedChurnHosts.entries()) {
            const text = host.firstChild as Text;
            text.nodeValue = `host churn ${index}`;
            records.push({
                type: "characterData",
                target: text,
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord);
            const renderedChild = document.createElement("span");
            renderedChild.textContent = `rendered ${index}`;
            host.appendChild(renderedChild);
            records.push({
                type: "childList",
                target: host,
                addedNodes: [renderedChild] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord);
        }
        for (const [index, root] of protectedAttributeRoots.entries()) {
            root.setAttribute("style", `--render-pass: ${index}`);
            records.push({
                type: "attributes",
                target: root,
                attributeName: "style",
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord);
        }
        TestMutationObserver.instances.at(-1)!.emit(records);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(firstWrapper.isConnected).toBe(true);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);

        lead.firstChild!.nodeValue = "Updated readable prose before protected renderers. ";
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "characterData",
            target: lead.firstChild!,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(firstWrapper.isConnected).toBe(false);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
    });

    it("离屏 MathJax v2 父 P staging 事务保留 wrapper，真实 prose/slot 变化仍重启", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <p id="prose">
                <span id="lead">Perspective projection prose stays translatable. </span>
                <span id="preview" class="MathJax_Preview">FORMULA_PREVIEW_SECRET</span>
                <script id="tex" type="math/tex; mode=display">FORMULA_TEX_SECRET</script>
                <span id="tail"> The explanation continues around the equation.</span>
                <a id="reference" href="/before">Stable reference text</a>
            </p>
        `;
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        const lead = document.querySelector<HTMLElement>("#lead")!;
        const preview = document.querySelector<HTMLElement>("#preview")!;
        const reference = document.querySelector<HTMLAnchorElement>("#reference")!;
        setLayoutBox(paragraph, 750, 338);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        const mutationObserver = TestMutationObserver.instances.at(-1)!;
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests.mock.calls[0]![0].join(" ")).not.toMatch(
            /FORMULA_PREVIEW_SECRET|FORMULA_TEX_SECRET/u,
        );
        const firstWrapper = paragraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
        expect(firstWrapper.isConnected).toBe(true);

        // The candidate has left IO. MathJax v2 first inserts an unclassified,
        // detached staging span at the direct P boundary, then replaces it with
        // its protected Display/MathJax tree while the TeX source script stays.
        // No second positive IO event is allowed to repair a lost wrapper.
        visibilityObserver.emit(paragraph, false);
        const staging = document.createElement("span");
        preview.replaceWith(staging);
        const display = document.createElement("span");
        display.className = "MathJax_Display";
        const renderedMath = document.createElement("span");
        renderedMath.className = "MathJax";
        renderedMath.textContent = "FORMULA_RENDERED_SECRET";
        display.append(renderedMath);
        staging.replaceWith(display);
        mutationObserver.emit([
            {
                type: "childList",
                target: paragraph,
                addedNodes: [staging] as unknown as NodeList,
                removedNodes: [preview] as unknown as NodeList,
            } as unknown as MutationRecord,
            {
                type: "childList",
                target: paragraph,
                addedNodes: [display] as unknown as NodeList,
                removedNodes: [staging] as unknown as NodeList,
            } as unknown as MutationRecord,
            {
                type: "childList",
                target: display,
                addedNodes: [renderedMath] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord,
        ]);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(firstWrapper.isConnected).toBe(true);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);

        // A real source edit uses the existing restart path. Lazy full-page
        // scheduling still waits for visibility; once re-entered it requests
        // exactly one fresh payload and continues excluding renderer content.
        lead.firstChild!.nodeValue = "Updated perspective projection prose must be translated. ";
        mutationObserver.emit([{
            type: "characterData",
            target: lead.firstChild!,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();
        expect(firstWrapper.isConnected).toBe(false);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(runtime.requests.mock.calls[1]![0].join(" ")).toContain(
            "Updated perspective projection prose must be translated.",
        );
        expect(runtime.requests.mock.calls[1]![0].join(" ")).not.toMatch(
            /FORMULA_RENDERED_SECRET|FORMULA_TEX_SECRET/u,
        );

        // Replacing an inline link with the same text still changes the exact
        // translatable Text identity, so the bilingual snapshot cannot be kept.
        const secondWrapper = paragraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
        const replacementReference = document.createElement("a");
        replacementReference.id = "reference-next";
        replacementReference.href = "/after";
        replacementReference.textContent = reference.textContent;
        reference.replaceWith(replacementReference);
        mutationObserver.emit([{
            type: "childList",
            target: paragraph,
            addedNodes: [replacementReference] as unknown as NodeList,
            removedNodes: [reference] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();

        expect(secondWrapper.isConnected).toBe(false);
        expect(runtime.requests).toHaveBeenCalledTimes(2);
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(3);
    });

    it("宿主篡改译文 wrapper 不会被 hard guard 当成可忽略 mutation", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = '<p id="prose">Host prose remains authoritative.</p>';
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        setLayoutBox(paragraph, 620, 90);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        const firstWrapper = paragraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
        const translatedText = firstWrapper.firstChild as Text;
        translatedText.nodeValue = "Host overwrote the extension translation.";
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "characterData",
            target: translatedText,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(firstWrapper.isConnected).toBe(false);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
    });

    it.each(["element", "text"] as const)(
        "宿主向译文 wrapper append %s 的 childList mutation 会恢复并重译",
        async (kind) => {
            runtime.config.display = 1;
            document.body.innerHTML = '<p id="prose">Host prose remains authoritative.</p>';
            const paragraph = document.querySelector<HTMLElement>("#prose")!;
            setLayoutBox(paragraph, 620, 90);
            runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

            autoTranslateEnglishPage();
            await vi.advanceTimersByTimeAsync(50);
            const visibilityObserver = TestIntersectionObserver.instances[0]!;
            visibilityObserver.emit(paragraph, true);
            await finishScheduledWork();
            expect(runtime.requests).toHaveBeenCalledTimes(1);

            const firstWrapper = paragraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
            const mutationObserver = TestMutationObserver.instances.at(-1)!;

            // MutationObserver delivers the extension's own wrapper insertion
            // asynchronously. Its intact snapshot must remain a no-op.
            mutationObserver.emit([{
                type: "childList",
                target: paragraph,
                addedNodes: [firstWrapper] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await finishScheduledWork();
            expect(runtime.requests).toHaveBeenCalledTimes(1);
            expect(firstWrapper.isConnected).toBe(true);

            const appended = kind === "element"
                ? document.createElement("span")
                : document.createTextNode("Host appended translation text.");
            if (appended.nodeType === 1) appended.textContent = "Host appended translation element.";
            firstWrapper.appendChild(appended);
            mutationObserver.emit([{
                type: "childList",
                target: firstWrapper,
                addedNodes: [appended] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await vi.advanceTimersByTimeAsync(50);
            visibilityObserver.emit(paragraph, true);
            await finishScheduledWork();

            expect(runtime.requests).toHaveBeenCalledTimes(2);
            expect(firstWrapper.isConnected).toBe(false);
            expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
        },
    );

    it("普通后代新增 translate=no 会重启，且新 payload 排除受保护文本", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <p id="prose">
                <span>Readable prefix. </span>
                <span id="dynamic">This text becomes protected.</span>
                <span> Readable suffix.</span>
            </p>
        `;
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        const dynamic = document.querySelector<HTMLElement>("#dynamic")!;
        setLayoutBox(paragraph, 620, 90);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests.mock.calls[0]![0].join(" ")).toContain("This text becomes protected.");

        const firstWrapper = paragraph.querySelector<HTMLElement>(".fluent-read-bilingual-content")!;
        dynamic.setAttribute("translate", "no");
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: dynamic,
            attributeName: "translate",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(runtime.requests.mock.calls[1]![0].join(" ")).not.toContain("This text becomes protected.");
        expect(firstWrapper.isConnected).toBe(false);
        expect(paragraph.querySelectorAll(".fluent-read-bilingual-content")).toHaveLength(1);
    });

    it("provider 空结果的立即重排有上限，source 变化后才开启新 generation", async () => {
        document.body.innerHTML = '<p id="late">Initial prose before hydration.</p>';
        const paragraph = document.querySelector<HTMLElement>("#late")!;
        setLayoutBox(paragraph, 600, 80);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "late-paragraph"}];
        const firstRequest = deferred<string[]>();
        runtime.requests
            .mockImplementationOnce(() => firstRequest.promise)
            .mockImplementation(async () => []);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const observer = TestIntersectionObserver.instances[0]!;
        observer.emit(paragraph, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        // Re-entering the IO threshold while this key is in flight only keeps
        // one pending wake-up. It must not create an `owned` task that forgets
        // the generation before its bounded empty-result retries are finalized.
        observer.emit(paragraph, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        firstRequest.resolve([]);
        await finishScheduledWork();

        // Initial request plus two lifecycle retries; a third retryable outcome
        // stores the capped signature and must not schedule a fourth request.
        expect(runtime.requests).toHaveBeenCalledTimes(3);

        paragraph.firstChild!.nodeValue = "Late prose became readable after hydration.";
        runtime.requests.mockImplementation(async (origins) => origins.map((origin) => `译:${origin}`));
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "characterData",
            target: paragraph.firstChild!,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        expect(observer.observed.has(paragraph)).toBe(true);
        observer.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(4);
        expect(paragraph.textContent).toBe("译:Late prose became readable after hydration.");
    });
});
