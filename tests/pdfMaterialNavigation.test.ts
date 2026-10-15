/** PDF 精确材料恢复的异步所有权回归；几何/真实 DOM 另外由 fixed-source integration harness 校验。 */
import {describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import type {ParsedDocument} from '@/src/features/document-translation/core/document';
import {PDF_MATERIAL_MAX_LAYOUT_ATTEMPTS, PDF_MATERIAL_FRAME_WAIT_MS, captureVisiblePdfMaterialLocation, pdfMaterialLocation, resolvePdfMaterialSelection, createPdfMaterialNavigation, waitPdfMaterialFrame, type PdfMaterialNavigationPorts} from '@/src/features/document-translation/ui/pdfMaterialNavigation';
function document(): ParsedDocument {
    return {fileName: 'same.pdf', format: 'pdf', label: 'PDF', parts: [], segments: [{id: 0, source: 'Same'}, {id: 1, source: 'Same'}],
        binary: {kind: 'pdf', bytes: new Uint8Array(), pages: [{pageNumber: 1, width: 600, height: 800, segmentIndexes: [0, 1], blocks: [
            {segmentIndex: 0, x: 10, y: 40, width: 100, height: 20, fontSize: 12, lineHeight: 20, lineCount: 1, fontFamily: 'sans', fontWeight: 400, textAlign: 'left'}, {segmentIndex: 1, x: 10, y: 400, width: 100, height: 20, fontSize: 12, lineHeight: 20, lineCount: 1, fontFamily: 'sans', fontWeight: 400, textAlign: 'left'},
        ]}]}} as ParsedDocument;
}
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
function setup(overrides: Partial<PdfMaterialNavigationPorts> = {}) {
    const state = {document: document(), mode: 'source', active: true};
    const landed = vi.fn(), align = vi.fn(() => ({position: 400, visible: true}));
    const ports: PdfMaterialNavigationPorts = {document: () => state.document, active: () => state.active, mode: () => state.mode,
        resumePage: async () => {}, nextTick: async () => {}, nextFrame: async signal => !signal.aborted, prepare() {}, align, landed, ...overrides};
    return {state, landed, align, navigation: createPdfMaterialNavigation(ports)};
}
describe('PDF material navigation ownership', () => {
    it('waits through absent target DOM and late initial height before confirming two stable placements', async () => {
        const align = vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce({position: 100, visible: true})
            .mockReturnValueOnce({position: 400, visible: true}).mockReturnValue({position: 400, visible: true});
        const test = setup({align});
        expect(await test.navigation.resumeLocation(1)).toBe(true);
        expect(align).toHaveBeenCalledTimes(4); expect(test.landed).toHaveBeenCalledOnce();
        expect(test.landed.mock.calls[0][0].segmentIndex).toBe(1);
    });
    it('does not call a missing or ambiguous segment an exact restoration', async () => {
        const test = setup();
        expect(await test.navigation.resumeLocation(7)).toBe(false);
        const binary = test.state.document.binary;
        if (binary?.kind === 'pdf') binary.pages[0].blocks.push({...binary.pages[0].blocks[1]});
        expect(await test.navigation.resumeLocation(1)).toBe(false);
        expect(test.align).not.toHaveBeenCalled(); expect(test.landed).not.toHaveBeenCalled();
    });
    it('bounds unsuccessful mounting attempts without choosing a nearby paragraph', async () => {
        const align = vi.fn(() => undefined), test = setup({align});
        expect(await test.navigation.resumeLocation(1)).toBe(false);
        expect(align).toHaveBeenCalledTimes(12); expect(test.landed).not.toHaveBeenCalled();
    });
    it.each(['document', 'mode', 'cancel', 'dispose'] as const)('invalidates a pending restore on %s change', async change => {
        const pending = deferred<void>(), test = setup({resumePage: () => pending.promise});
        const result = test.navigation.resumeLocation(1);
        if (change === 'document') test.state.document = document();
        else if (change === 'mode') test.state.mode = 'translated';
        else test.navigation[change]();
        pending.resolve(); expect(await result).toBe(false);
        expect(test.align).not.toHaveBeenCalled(); expect(test.landed).not.toHaveBeenCalled();
    });
    it('only the newest repeated request may report a successful landing', async () => {
        const first = deferred<void>(), second = deferred<void>(); let count = 0;
        const test = setup({resumePage: () => (++count === 1 ? first : second).promise});
        const old = test.navigation.resumeLocation(0), current = test.navigation.resumeLocation(1);
        first.resolve(); second.resolve();
        expect(await old).toBe(false); expect(await current).toBe(true);
        expect(test.landed).toHaveBeenCalledOnce(); expect(test.landed.mock.calls[0][0].segmentIndex).toBe(1);
    });
    it('returns recoverable failure if the reader disappears during the awaited render', async () => {
        const test = setup({resumePage: async () => {throw new Error('disposed');}});
        expect(await test.navigation.resumeLocation(1)).toBe(false); expect(test.landed).not.toHaveBeenCalled();
    });
    it('settles a canceled animation-frame wait even if the browser has paused frames', async () => {
        const abort = new AbortController(), cancelAnimationFrame = vi.fn();
        const result = waitPdfMaterialFrame({requestAnimationFrame: () => 42, cancelAnimationFrame}, abort.signal);
        abort.abort(); expect(await result).toBe(false); expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    });
});

const box = (left: number, top: number, width: number, height: number) => ({left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({left, top, width, height})});
function visibleFixture(mode = 'source', readable = false): any {
    const model = document() as any;
    model.segments.push({id: 2, source: 'Same'});
    model.binary.pages.push({pageNumber: 2, width: 600, height: 800, segmentIndexes: [2], blocks: [{segmentIndex: 2, x: 10, y: 40, width: 100, height: 20}]});
    const {document: dom} = parseHTML('<html><body><section data-fluentread-pdf-document-id="current"><div id="viewport"></div></section></body></html>');
    const viewport = dom.querySelector('#viewport') as any;
    viewport.scrollTop = 0; viewport.clientHeight = 200; viewport.getBoundingClientRect = () => box(0, 0, 1200, 200);
    const sourceHosts = new Map(), translatedHosts = new Map(), readingHosts = new Map();
    for (const page of model.binary.pages) {
        const row = dom.createElement('article'); row.setAttribute('data-page-number', String(page.pageNumber)); viewport.append(row);
        const source = dom.createElement('div'); source.getBoundingClientRect = () => box(0, (page.pageNumber - 1) * 820 - viewport.scrollTop, 600, 800);
        source.innerHTML = `<div data-fluentread-pdf-text data-pdf-page-number="${page.pageNumber}"><span>Partial source</span></div>`;
        row.append(source); sourceHosts.set(page.pageNumber, source);
        const translated = dom.createElement('div'); translated.innerHTML = '<canvas></canvas>';
        translated.getBoundingClientRect = () => box(mode === 'bilingual' ? 650 : 0, (page.pageNumber - 1) * 820 - viewport.scrollTop, 600, 800);
        row.append(translated); translatedHosts.set(page.pageNumber, translated);
        const reading = dom.createElement('article'); reading.getBoundingClientRect = translated.getBoundingClientRect;
        row.append(reading); readingHosts.set(page.pageNumber, reading);
        for (const block of page.blocks) {
            const p = dom.createElement('p'); p.className = 'pdf-reading-paragraph'; p.setAttribute('data-pdf-segment-index', String(block.segmentIndex)); p.setAttribute('data-pdf-source-text', model.segments[block.segmentIndex].source); p.textContent = '不同的译文';
            p.getBoundingClientRect = () => box(10, (page.pageNumber - 1) * 820 + block.y - viewport.scrollTop, 100, 20); reading.append(p);
        }
    }
    const ports = {document: model, renderedDocument: model, identity: 'current', viewport, sourceHosts, translatedHosts, readingHosts,
        mode, readable, residentPages: model.binary.pages, readyPages: new Set([1, 2])};
    const paragraph = (index: number) => viewport.querySelector(`[data-pdf-segment-index="${index}"]`) as any;
    const range = (node: Node = sourceHosts.get(1).querySelector('span').firstChild, rectangles: any[] = [box(20, 45, 20, 10)]) => ({startContainer: node, endContainer: node, collapsed: false, getClientRects: () => rectangles}) as unknown as Range;
    return {model, dom, viewport, ports, paragraph, range};
}

describe('PDF material model and viewport ownership', () => {
    it('refuses absent/non-PDF models and noninteger or multiply owned model segments', () => {
        const doc = document();
        for (const index of [-1, 1.5, 9, NaN]) expect(pdfMaterialLocation(doc, index)).toBeUndefined();
        expect(pdfMaterialLocation({...doc, binary: undefined}, 0)).toBeUndefined();
        expect(pdfMaterialLocation({...doc, binary: {kind: 'docx'} as any}, 0)).toBeUndefined();
        expect(pdfMaterialLocation(doc, 1)?.block.y).toBe(400);
        (doc.binary as any).pages[0].blocks.push({...((doc.binary as any).pages[0].blocks[1])});
        expect(pdfMaterialLocation(doc, 1)).toBeUndefined();
    });
    it('maps original glyph rectangles and tagged translated content to their raw model segment', () => {
        const f = visibleFixture();
        expect(resolvePdfMaterialSelection(f.range(), f.ports)).toBe(0);
        expect(resolvePdfMaterialSelection(f.range(undefined, [box(20, 405, 20, 10)]), f.ports)).toBe(1);
        const second = f.ports.sourceHosts.get(2).querySelector('span').firstChild;
        expect(resolvePdfMaterialSelection(f.range(second, [box(20, 865, 20, 10)]), f.ports)).toBe(2);
        expect(resolvePdfMaterialSelection(f.range(f.paragraph(1).firstChild), f.ports)).toBe(1);
        f.model.binary.pages[0].blocks[0].lines = [{x: 10, y: 40, width: 100, height: 20}];
        expect(resolvePdfMaterialSelection(f.range(undefined, [box(0, 0, 0, 0), box(20, 45, 20, 10)]), f.ports)).toBe(0);
        expect(resolvePdfMaterialSelection(f.range(undefined, []), f.ports)).toBeUndefined();
        expect(resolvePdfMaterialSelection(f.range(undefined, [box(900, 45, 20, 10)]), f.ports)).toBeUndefined();
    });
    it('rejects stale, disconnected, foreign, collapsed, protected and unsupported range boundaries', () => {
        const f = visibleFixture();
        expect(resolvePdfMaterialSelection(f.range(), {...f.ports, renderedDocument: {...f.model}})).toBeUndefined();
        expect(resolvePdfMaterialSelection(f.range(), {...f.ports, identity: 'old'})).toBeUndefined();
        expect(resolvePdfMaterialSelection({...f.range(), collapsed: true} as Range, f.ports)).toBeUndefined();
        const detached = f.dom.createTextNode('detached'); expect(resolvePdfMaterialSelection(f.range(detached), f.ports)).toBeUndefined();
        expect(resolvePdfMaterialSelection({...f.range(), endContainer: detached} as Range, f.ports)).toBeUndefined();
        const outside = f.dom.createElement('p'); outside.textContent = 'foreign'; f.dom.body.append(outside);
        expect(resolvePdfMaterialSelection(f.range(outside.firstChild), f.ports)).toBeUndefined();
        expect(resolvePdfMaterialSelection({...f.range(), endContainer: outside.firstChild} as Range, f.ports)).toBeUndefined();
        const unknown = f.dom.createElement('p'); unknown.textContent = 'UI'; f.viewport.append(unknown);
        expect(resolvePdfMaterialSelection(f.range(unknown), f.ports)).toBeUndefined();
        expect(resolvePdfMaterialSelection({...f.range(), endContainer: unknown} as Range, f.ports)).toBeUndefined();
        f.paragraph(0).setAttribute('hidden', '');
        expect(resolvePdfMaterialSelection(f.range(f.paragraph(0).firstChild), f.ports)).toBeUndefined();
        expect(resolvePdfMaterialSelection({...f.range(), endContainer: f.paragraph(0).firstChild} as Range, f.ports)).toBeUndefined();
        f.viewport.remove(); expect(resolvePdfMaterialSelection(f.range(), f.ports)).toBeUndefined();
    });
    it('validates current tagged index, page association and exact raw source rather than trusting display text', () => {
        const f = visibleFixture(), p = f.paragraph(1), range = f.range(p.firstChild);
        for (const index of ['', '-1', 'bad', '99']) {p.setAttribute('data-pdf-segment-index', index); expect(resolvePdfMaterialSelection(range, f.ports)).toBeUndefined();}
        p.setAttribute('data-pdf-segment-index', '1'); p.setAttribute('data-pdf-source-text', 'wrong'); expect(resolvePdfMaterialSelection(range, f.ports)).toBeUndefined();
        p.setAttribute('data-pdf-source-text', 'Same'); p.closest('[data-page-number]').setAttribute('data-page-number', '2'); expect(resolvePdfMaterialSelection(range, f.ports)).toBeUndefined();
        p.closest('[data-page-number]').removeAttribute('data-page-number'); expect(resolvePdfMaterialSelection(range, f.ports)).toBeUndefined();
    });
    it('refuses missing/zero source hosts, missing pages, invalid block geometry and overlapping original baselines', () => {
        const f = visibleFixture(), range = f.range(), host = f.ports.sourceHosts.get(1);
        expect(resolvePdfMaterialSelection(range, {...f.ports, sourceHosts: new Map()})).toBeUndefined();
        const wrong = f.dom.createElement('div'); f.viewport.append(wrong);
        expect(resolvePdfMaterialSelection(range, {...f.ports, sourceHosts: new Map([[1, wrong]])})).toBeUndefined();
        host.getBoundingClientRect = () => box(0, 0, 0, 800); expect(resolvePdfMaterialSelection(range, f.ports)).toBeUndefined();
        host.getBoundingClientRect = () => box(0, 0, 600, 0); expect(resolvePdfMaterialSelection(range, f.ports)).toBeUndefined();
        host.getBoundingClientRect = () => box(0, 0, 600, 800);
        host.querySelector('[data-fluentread-pdf-text]').setAttribute('data-pdf-page-number', '9'); expect(resolvePdfMaterialSelection(range, f.ports)).toBeUndefined();
        host.querySelector('[data-fluentread-pdf-text]').setAttribute('data-pdf-page-number', '1');
        f.model.binary.pages[0].blocks.push({...f.model.binary.pages[0].blocks[0], segmentIndex: 1}); expect(resolvePdfMaterialSelection(range, f.ports)).toBeUndefined();
        f.model.binary.pages[0].blocks = [{segmentIndex: -1}, {segmentIndex: 99}, {segmentIndex: 0, x: NaN, y: 40, width: 100, height: 20}, {segmentIndex: 0, x: 10, y: NaN, width: 100, height: 20}, {segmentIndex: 0, x: 10, y: 40, width: 0, height: 20}, {segmentIndex: 0, x: 10, y: 40, width: 100, height: 0}];
        expect(resolvePdfMaterialSelection(range, f.ports)).toBeUndefined();
        expect(resolvePdfMaterialSelection(range, {...f.ports, document: {...f.model, binary: undefined}, renderedDocument: {...f.model}})).toBeUndefined();
    });
    it.each(['source', 'bilingual', 'translated'])('captures later same-page paragraph in %s mode without using page-first', mode => {
        const f = visibleFixture(mode); f.viewport.scrollTop = 350;
        expect(captureVisiblePdfMaterialLocation(f.ports)).toBe(1);
        f.viewport.scrollTop = 820; expect(captureVisiblePdfMaterialLocation(f.ports)).toBe(2);
        f.viewport.scrollTop = 700; expect(captureVisiblePdfMaterialLocation(f.ports)).toBe(2);
    });
    it.each(['bilingual', 'translated'])('captures actual reflow nodes in %s mode and refuses malformed tags', mode => {
        const f = visibleFixture(mode, true); f.viewport.scrollTop = 350;
        expect(captureVisiblePdfMaterialLocation(f.ports)).toBe(1);
        const p = f.paragraph(1);
        for (const index of ['', 'bad', '99']) {p.setAttribute('data-pdf-segment-index', index); expect(captureVisiblePdfMaterialLocation({...f.ports, mode: 'translated'})).toBeUndefined();}
        p.setAttribute('data-pdf-segment-index', '1'); p.setAttribute('data-pdf-source-text', 'stale'); expect(captureVisiblePdfMaterialLocation({...f.ports, mode: 'translated'})).toBeUndefined();
        p.setAttribute('data-pdf-source-text', 'Same'); p.setAttribute('hidden', ''); expect(captureVisiblePdfMaterialLocation({...f.ports, mode: 'translated'})).toBeUndefined();
        p.removeAttribute('hidden'); f.model.binary.pages[0].blocks = []; expect(captureVisiblePdfMaterialLocation({...f.ports, mode: 'translated'})).toBeUndefined();
    });
    it('uses visible original column when stacked bilingual reflow is below the viewport and skips absent hosts', () => {
        const f = visibleFixture('bilingual', true); f.viewport.scrollTop = 350;
        f.ports.readingHosts.get(1).getBoundingClientRect = () => box(0, 2000, 600, 800);
        expect(captureVisiblePdfMaterialLocation(f.ports)).toBe(1);
        f.ports.readingHosts.clear(); expect(captureVisiblePdfMaterialLocation(f.ports)).toBe(1);
        f.ports.readyPages.clear(); expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
    });
    it('refuses hidden, nonrendered, unavailable, stale and over-budget visible ownership', () => {
        const f = visibleFixture();
        expect(captureVisiblePdfMaterialLocation({...f.ports, renderedDocument: {...f.model}})).toBeUndefined();
        f.model.binary.kind = 'docx'; expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined(); f.model.binary.kind = 'pdf';
        expect(captureVisiblePdfMaterialLocation({...f.ports, residentPages: Array(6).fill(f.model.binary.pages[0])})).toBeUndefined();
        expect(captureVisiblePdfMaterialLocation({...f.ports, identity: 'old'})).toBeUndefined();
        f.viewport.setAttribute('hidden', ''); expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined(); f.viewport.removeAttribute('hidden');
        f.viewport.checkVisibility = () => false; expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined(); f.viewport.checkVisibility = () => true;
        for (const style of [{display: 'none'}, {visibility: 'hidden'}, {visibility: 'collapse'}]) {f.dom.defaultView.getComputedStyle = () => style; expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();}
        f.dom.defaultView.getComputedStyle = () => ({display: 'block', visibility: 'visible'});
        for (const b of [box(0, 0, 0, 200), box(0, 0, 1200, 0), box(NaN, 0, 1200, 200)]) {f.viewport.getBoundingClientRect = () => b; expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();}
        f.viewport.getBoundingClientRect = () => box(0, 0, 1200, 200); f.viewport.clientHeight = 0; expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
        f.viewport.clientHeight = 200; f.ports.sourceHosts.get(1).replaceChildren(); expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
        f.viewport.remove(); expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
    });
    it('ignores offscreen/invalid geometry and rejects indistinguishable model positions instead of choosing one', () => {
        const f = visibleFixture();
        f.model.binary.pages[0].blocks.push({...f.model.binary.pages[0].blocks[0], segmentIndex: 1}); expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
        f.model.binary.pages[0].blocks = [{segmentIndex: -1}, {segmentIndex: 99}, {segmentIndex: 0, x: NaN, y: 40, width: 100, height: 20}]; expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
        f.ports.sourceHosts.get(1).getBoundingClientRect = () => box(-1000, 0, 600, 800); expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
        f.ports.sourceHosts.get(1).getBoundingClientRect = () => box(0, 0, 600, 800); f.model.binary.pages[0].width = 0; expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
        f.model.binary.pages[0].width = 600; f.model.binary.pages[0].height = 0; expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
        f.model.binary.pages[0].height = 800; f.ports.sourceHosts.clear(); expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
    });
    it('bounds reflow and original candidate visits instead of saving the first candidate from a partial scan', () => {
        const f = visibleFixture('translated', true), host = f.ports.readingHosts.get(1), p = f.paragraph(0);
        host.querySelectorAll = () => Array(8001).fill(p); expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
        f.ports.readable = false; f.model.binary.pages[0].blocks = Array(8001).fill(f.model.binary.pages[0].blocks[0]); expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
    });
});

it('cancels at each async layout boundary and rejects inactive or disposed entry', async () => {
    const inactive = setup(); inactive.state.active = false; expect(await inactive.navigation.resumeLocation(0)).toBe(false);
    inactive.navigation.dispose(); expect(await inactive.navigation.resumeLocation(0)).toBe(false);
    for (const cancelAt of [1, 2]) {
        let ticks = 0; const test = setup({nextTick: async () => {if (++ticks === cancelAt) test.navigation.cancel();}});
        expect(await test.navigation.resumeLocation(0)).toBe(false); expect(test.landed).not.toHaveBeenCalled();
    }
    const stopped = setup({nextFrame: async () => false}); expect(await stopped.navigation.resumeLocation(0)).toBe(false);
    const switched = setup({nextFrame: async () => {switched.state.active = false; return true;}}); expect(await switched.navigation.resumeLocation(0)).toBe(false);
    const invalid = setup({align: () => ({position: NaN, visible: true})}); expect(await invalid.navigation.resumeLocation(0)).toBe(false);
    const abort = new AbortController(); abort.abort();
    expect(await waitPdfMaterialFrame({requestAnimationFrame: () => {throw new Error('must not request');}, cancelAnimationFrame() {}}, abort.signal)).toBe(false);
    let frame!: FrameRequestCallback; const cancel = vi.fn();
    const pending = waitPdfMaterialFrame({requestAnimationFrame: callback => {frame = callback; return 7;}, cancelAnimationFrame: cancel}, new AbortController().signal);
    frame(0); expect(await pending).toBe(true); expect(cancel).toHaveBeenCalledWith(7);
});
it('refuses a stale non-PDF source range and a visible segment with conflicting offscreen ownership', () => {
    const f = visibleFixture(); f.model.binary.kind = 'docx'; expect(resolvePdfMaterialSelection(f.range(), f.ports)).toBeUndefined();
    f.model.binary.kind = 'pdf'; f.viewport.scrollTop = 50;
    expect(captureVisiblePdfMaterialLocation(f.ports)).toBe(0);
    f.model.binary.pages[1].blocks.push({...f.model.binary.pages[0].blocks[0]});
    expect(captureVisiblePdfMaterialLocation(f.ports)).toBeUndefined();
});

it('bounds a paused animation frame and removes its timer on abort or successful completion', async () => {
    vi.useFakeTimers();
    try {
        let callback!: FrameRequestCallback; const cancelAnimationFrame = vi.fn();
        const view = {requestAnimationFrame: (run: FrameRequestCallback) => {callback = run; return 11;}, cancelAnimationFrame};
        const paused = waitPdfMaterialFrame(view, new AbortController().signal);
        await vi.advanceTimersByTimeAsync(749); expect(cancelAnimationFrame).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1); expect(await paused).toBe(false); expect(cancelAnimationFrame).toHaveBeenCalledWith(11);
        callback(0); expect(cancelAnimationFrame).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
        const ready = waitPdfMaterialFrame(view, new AbortController().signal); callback(0); expect(await ready).toBe(true); expect(vi.getTimerCount()).toBe(0);
        const abort = new AbortController(), stopped = waitPdfMaterialFrame(view, abort.signal); abort.abort(); expect(await stopped).toBe(false); expect(vi.getTimerCount()).toBe(0);
    } finally {vi.useRealTimers();}
});
it('user cancellation wins over a delayed restore frame and never scrolls the user back to the old target', async () => {
    let position = 0, frameStarted!: () => void; const started = new Promise<void>(resolve => {frameStarted = resolve;});
    const test = setup({align: () => {position = 400; return {position, visible: true};}, nextFrame: signal => new Promise(resolve => {
        signal.addEventListener('abort', () => resolve(false), {once: true}); frameStarted();
    })});
    const pending = test.navigation.resumeLocation(1); await started;
    position = 850; test.navigation.cancel();
    expect(await pending).toBe(false); expect(position).toBe(850); expect(test.landed).not.toHaveBeenCalled();
});

it('limits cumulative slow-frame waiting to the declared attempts and leaves no animation or timeout handles', async () => {
    vi.useFakeTimers();
    try {
        let id = 0; const animationTimers = new Map<number, ReturnType<typeof setTimeout>>();
        const view = {requestAnimationFrame(callback: FrameRequestCallback) {const key = ++id; animationTimers.set(key, setTimeout(() => callback(0), PDF_MATERIAL_FRAME_WAIT_MS - 1)); return key;},
            cancelAnimationFrame(key: number) {clearTimeout(animationTimers.get(key)); animationTimers.delete(key);}};
        const test = setup({align: () => undefined, nextFrame: signal => waitPdfMaterialFrame(view, signal)});
        const started = Date.now(), pending = test.navigation.resumeLocation(1);
        await vi.advanceTimersByTimeAsync(PDF_MATERIAL_MAX_LAYOUT_ATTEMPTS * PDF_MATERIAL_FRAME_WAIT_MS);
        expect(await pending).toBe(false); expect(id).toBe(PDF_MATERIAL_MAX_LAYOUT_ATTEMPTS);
        expect(Date.now() - started).toBe(9000); expect(animationTimers.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    } finally {vi.useRealTimers();}
});
