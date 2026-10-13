import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {createReadingEvidenceAnchor, type ReadingEvidenceAnchor, type ReadingEvidenceCitation} from '@/src/features/reading-assistant/evidenceAnchor';
import type {ReadingSelection} from '@/src/features/reading-assistant/types';

const anchors: ReadingEvidenceAnchor[] = [];
afterEach(() => {
    anchors.splice(0).forEach(anchor => anchor.dispose());
    vi.useRealTimers();
});

function fixture(html = '<p id="selected">Anna watered the plant. It grew.</p>', selected = 'It', selector = '#selected', selectedOffset?: number) {
    vi.useFakeTimers();
    const {document, window: nativeWindow} = parseHTML(`<html><head></head><body><main>${html}</main></body></html>`);
    const root = document.querySelector(selector)! as HTMLElement;
    const node = root.firstChild!;
    const range = {startContainer: node, endContainer: node, startOffset: selectedOffset ?? node.textContent!.indexOf(selected), endOffset: (selectedOffset ?? node.textContent!.indexOf(selected)) + selected.length} as unknown as Range;
    const registry = new Map<string, Set<Range>>();
    const location = {href: 'https://fixture.test/read?q=one#part'};
    const ranges: Array<Range & {getClientRects: ReturnType<typeof vi.fn>}> = [];
    const observations: Array<{callback: MutationCallback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>}> = [];
    const window = {
        addEventListener: nativeWindow.addEventListener.bind(nativeWindow),
        removeEventListener: nativeWindow.removeEventListener.bind(nativeWindow),
        dispatchEvent: nativeWindow.dispatchEvent.bind(nativeWindow),
        Event: nativeWindow.Event,
    } as unknown as Window & typeof globalThis;
    Object.defineProperty(document, 'defaultView', {configurable: true, value: window});
    const rects = [{left: 15, top: 20, width: 80, height: 18}];
    const createRange = vi.fn(() => {
        const current: any = {setStart: vi.fn((startContainer, startOffset) => Object.assign(current, {startContainer, startOffset})),
            setEnd: vi.fn((endContainer, endOffset) => Object.assign(current, {endContainer, endOffset})),
            getClientRects: vi.fn(() => rects)};
        ranges.push(current); return current;
    });
    Object.assign(document, {createRange});
    Object.defineProperty(window, 'CSS', {configurable: true, value: {highlights: registry}});
    Object.defineProperty(window, 'Highlight', {configurable: true, value: class extends Set<Range> {constructor(...values: Range[]) {super(values);}}});
    Object.defineProperty(window, 'location', {configurable: true, value: location});
    Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: undefined});
    Object.defineProperty(window, 'MutationObserver', {configurable: true, value: class {
        observe = vi.fn(); disconnect = vi.fn();
        constructor(public callback: MutationCallback) {observations.push(this);}
    }});
    const scroll = vi.fn(); Object.assign(root, {scrollIntoView: scroll});
    const selectedText = selected;
    const context = 'Anna watered the plant. It grew.';
    const selection: ReadingSelection = {text: selectedText, context, sentence: 'It grew.'};
    const create = (snapshot: ReadingSelection = selection, options = {}) => {
        const anchor = createReadingEvidenceAnchor(range, snapshot, options); anchors.push(anchor); return anchor;
    };
    const mutation = (target: Node = root, removedNodes: Node[] = []) => observations[0]?.callback([{target, removedNodes} as unknown as MutationRecord], {} as MutationObserver);
    return {document, window, root, node, range, registry, location, ranges, observations, rects, createRange, scroll, selection, create, mutation};
}
const quote: ReadingEvidenceCitation = {sourceText: 'It grew.', quote: 'It grew.', kind: 'context', sourceOffset: 24};

describe('bounded reading evidence source mapping', () => {
    it('locates only a supplied source and paints the actual original sentence without changing source nodes', () => {
        const f = fixture(); const anchor = f.create();
        const original = f.root.innerHTML;
        expect(anchor.locate(quote)).toBe('located');
        expect(f.ranges[0]).toMatchObject({startContainer: f.node, startOffset: 24, endContainer: f.node, endOffset: 32});
        expect(f.scroll).toHaveBeenCalledWith({block: 'nearest', inline: 'nearest', behavior: 'instant'});
        expect([...f.registry.keys()][0]).toMatch(/^fluentread-reading-evidence-/u);
        expect(f.document.querySelector('style[data-fluent-read-ui="reading-evidence-highlight"]')!.textContent).toContain('::highlight(');
        expect(f.root.innerHTML).toBe(original);
        anchor.clear(); expect(f.registry.size).toBe(0); expect(f.document.querySelector('style')).toBeNull();
        expect(anchor.locate(quote)).toBe('located');
        vi.advanceTimersByTime(3500); expect(f.registry.size).toBe(0);
    });
    it('maps split text nodes and collapsed whitespace to actual raw node offsets', () => {
        const f = fixture('<p> Anna\t watered <b>the plant.</b> <span id="selected">It\n grew.</span></p>', 'It');
        const anchor = f.create();
        expect(anchor.locate({...quote, quote: 'grew.'})).toBe('located');
        expect(f.ranges[0]).toMatchObject({startContainer: f.node, startOffset: 4, endContainer: f.node, endOffset: 9});
        expect(anchor.locate({kind: 'selection', sourceText: 'It', quote: 'It', sourceOffset: 0})).toBe('located');
    });
    it('uses the selected occurrence when a selected word and sentence repeat', () => {
        const f = fixture('<p id="selected">It grew. It grew.</p>', 'It', '#selected', 9);
        const anchor = f.create({text: 'It', context: 'It grew. It grew.', sentence: 'It grew.'});
        expect(anchor.locate({kind: 'selection', sourceText: 'It grew.', quote: 'grew.'})).toBe('located');
        expect(f.ranges[0].startOffset).toBe(12);
        expect(anchor.locate({kind: 'context', sourceText: 'It grew.', quote: 'grew.'})).toBe('unavailable');
        expect(anchor.locate({kind: 'context', sourceText: 'It grew.', quote: 'grew.', sourceOffset: 0})).toBe('located');
        expect(f.ranges.at(-1)!.startOffset).toBe(3);
        expect(anchor.locate({kind: 'context', sourceText: 'It grew.', quote: 'grew.', sourceOffset: 9})).toBe('located');
        expect(f.ranges.at(-1)!.startOffset).toBe(12);
        expect(anchor.locate({sourceText: 'It grew.', quote: 'grew.', sourceOffset: 0})).toBe('unavailable');
    });
    it('resolves clipped context ellipses using the selected location and keeps source offsets in provided text', () => {
        const f = fixture('<p id="selected">Before. Anna watered the plant. It grew. After.</p>', 'It');
        const anchor = f.create({...f.selection, context: '…Anna watered the plant. It grew.…'});
        expect(anchor.locate({...quote, sourceOffset: 25})).toBe('located');
        expect(f.ranges[0].startOffset).toBe(32);
        expect(anchor.locate({...quote, sourceOffset: 24})).toBe('unavailable');
        expect(anchor.locate({kind: 'context', sourceText: '…Anna watered', quote: '…Anna watered'})).toBe('unavailable');
    });
    it('supports absent kind only when all source derivations agree and rejects unavailable context', () => {
        const f = fixture(); const anchor = f.create();
        expect(anchor.locate({sourceText: 'It grew.', quote: 'It grew.'})).toBe('located');
        const selectionOnly = f.create({...f.selection, context: '', sentence: 'It'});
        expect(selectionOnly.locate(quote)).toBe('unavailable');
        expect(selectionOnly.locate({sourceText: 'It', quote: 'It'})).toBe('located');
        expect(selectionOnly.locate({kind: 'context', sourceText: 'It', quote: 'It'})).toBe('unavailable');
    });
    it('refuses invented, mismatched, ambiguous, empty, or invalid offset citations', () => {
        const f = fixture(); const anchor = f.create();
        for (const citation of [
            {...quote, sourceText: 'The plant flourished.'}, {...quote, quote: 'was watered'}, {...quote, quote: ''},
            {...quote, sourceText: ''}, {...quote, sourceOffset: -1}, {...quote, sourceOffset: 24.5}, {...quote, sourceOffset: Number.NaN},
        ]) expect(anchor.locate(citation)).toBe('unavailable');
        const repeated = fixture('<p id="selected">It grew and grew.</p>', 'It');
        expect(repeated.create({text: 'It', sentence: 'It grew and grew.', context: 'It grew and grew.'}).locate({sourceText: 'It grew and grew.', quote: 'grew'})).toBe('unavailable');
    });
    it('excludes controls, hidden text, extension translations and comments from the captured original', () => {
        const f = fixture('<p>Anna watered <!-- comment --><button>secret</button><span hidden>hidden</span><code>code</code><span data-fluent-read-ui>UI</span>the plant. <span id="selected">It grew.</span><span class="fluent-read-bilingual-content">它长大了。</span></p><p>It grew.</p>', 'It');
        expect(f.create().locate(quote)).toBe('located');
        f.document.querySelector('.fluent-read-bilingual-content')!.textContent = '译文更新';
        expect(f.create().locate(quote)).toBe('located');
    });
    it('uses separate native ranges across allowed source nodes so controls in between never become highlighted', () => {
        const f = fixture('<p>Anna <button>PRIVATE</button>watered the plant. <span id="selected">It grew.</span></p>');
        const anchor = f.create();
        expect(anchor.locate({kind: 'context', sourceText: 'Anna watered the plant.', quote: 'Anna watered the plant.', sourceOffset: 0})).toBe('located');
        expect(f.ranges).toHaveLength(2);
        for (const range of f.ranges) expect(range.startContainer.parentElement!.tagName).not.toBe('BUTTON');
    });
    it('uses computed styles and ignores non-element/non-text nodes', () => {
        const f = fixture('<p>Anna watered <!-- ignored --><span class="hide">secret</span>the plant. <span id="selected">It grew.</span></p>', 'It');
        Object.defineProperty(f.window, 'getComputedStyle', {configurable: true, value: (element: Element) => ({display: element.classList.contains('hide') ? 'none' : 'block', visibility: 'visible'})});
        expect(f.create().locate(quote)).toBe('located');
    });
    it('does not capture shells, editable/hidden prose, cross-block or disconnected ranges', () => {
        for (const html of ['<main id="selected">It grew.</main>', '<p id="selected" contenteditable="true">It grew.</p>', '<p id="selected" hidden>It grew.</p>']) {
            const f = fixture(html); expect(f.create().locate(quote)).toBe('unavailable');
        }
        const f = fixture('<p id="selected">It grew.</p><p id="other">It grew.</p>');
        Object.assign(f.range, {endContainer: f.document.querySelector('#other')!.firstChild!});
        expect(f.create().locate(quote)).toBe('unavailable');
        f.root.remove(); expect(f.create().locate(quote)).toBe('unavailable');
    });
    it('rejects malformed element selection boundaries and source snapshots mismatching the selected text', () => {
        const f = fixture(); const anchor = f.create({...f.selection, text: 'not selected'});
        expect(anchor.locate(quote)).toBe('unavailable');
        Object.assign(f.range, {startContainer: f.root, endContainer: f.root, startOffset: 0});
        expect(f.create().locate(quote)).toBe('unavailable');
        Object.assign(f.range, {startContainer: f.document, endContainer: f.document});
        expect(f.create().locate(quote)).toBe('unavailable');
    });
    it('supports whole paragraph element boundaries and trimmed leading selection whitespace', () => {
        const f = fixture('<p id="selected">  Anna watered the plant. It grew.  </p>', '  Anna');
        Object.assign(f.range, {startContainer: f.root, endContainer: f.root, startOffset: 0, endOffset: 1});
        const all = {text: 'Anna watered the plant. It grew.', sentence: 'Anna watered the plant. It grew.', context: ''};
        expect(f.create(all).locate({kind: 'selection', sourceText: all.text, quote: 'It grew.', sourceOffset: 0})).toBe('located');
        const whites = fixture('<p id="selected">Before.   It grew.</p>', '   It');
        expect(whites.create({text: 'It', sentence: 'It grew.', context: 'Before. It grew.'}).locate({sourceText: 'It grew.', quote: 'It grew.'})).toBe('located');
        const nested = fixture('<p id="selected"><b>Anna watered the plant.</b> It grew.</p>', 'Anna');
        Object.assign(nested.range, {startContainer: nested.root, endContainer: nested.root, startOffset: 0, endOffset: 2});
        expect(nested.create(all).locate({kind: 'selection', sourceText: all.text, quote: 'It grew.'})).toBe('located');
    });
    it('refuses empty selection, clipped-only context and overlapping ambiguous source bases', () => {
        const f = fixture(); expect(f.create({...f.selection, text: ''}).check()).toBe('unavailable');
        expect(f.create({...f.selection, context: '…'}).locate(quote)).toBe('unavailable');
        const ambiguous = fixture('<p id="selected">banana</p>', 'a', '#selected', 3);
        expect(ambiguous.create({text: 'a', sentence: '', context: 'ana'}).locate({kind: 'context', sourceText: 'ana', quote: 'an'})).toBe('unavailable');
    });
    it('declines excessive nodes, sibling counts, and raw text while retaining only bounded snapshots', () => {
        const crowded = fixture(`<p><span id="selected">It grew.</span>${'<i>x</i>'.repeat(1100)}</p>`);
        expect(crowded.create().check()).toBe('unavailable');
        const crowdedLeaf = fixture(`<p><!-- odd node --><span id="selected">It grew.</span>${'<i>x</i>'.repeat(1100)}</p>`);
        expect(crowdedLeaf.create().check()).toBe('unavailable');
        const wide = fixture(`<p><span id="selected">It grew.</span>${'<br>'.repeat(2100)}</p>`);
        expect(wide.create().check()).toBe('unavailable');
        const long = fixture(`<p id="selected">It grew.${' '.repeat(64_001)}</p>`);
        expect(long.create().check()).toBe('unavailable');
    });
});

describe('reading evidence DOM and lifecycle ownership', () => {
    it('survives equivalent DOM reconstruction and original/bilingual switching', () => {
        const f = fixture(); const anchor = f.create();
        expect(anchor.locate(quote)).toBe('located');
        f.root.innerHTML = 'Anna <b>watered</b> the plant. It grew.<span class="fluent-read-bilingual-content">安娜给植物浇水，它长大了。</span>';
        f.mutation(); expect(f.registry.size).toBe(0);
        expect(anchor.locate(quote)).toBe('located');
        f.root.querySelector('.fluent-read-bilingual-content')!.remove();
        expect(anchor.locate(quote)).toBe('located');
    });
    it('recovers an equivalent root replacement only at its preserved local sibling slot', () => {
        const f = fixture('<p id="previous">before</p><p id="selected">Anna watered the plant. It grew.</p><p id="next">after</p>');
        const anchor = f.create();
        const replacement = f.root.cloneNode(true) as Element;
        f.root.replaceWith(replacement); f.mutation(f.root.parentNode ?? f.document.querySelector('main')!, [f.root]);
        expect(anchor.locate(quote)).toBe('located');
        expect(f.ranges[0].startContainer).toBe(replacement.firstChild);
    });
    it('recovers first-child replacement but rejects moved slots, ids, tags, missing parent or neighbors', () => {
        const first = fixture(); const firstAnchor = first.create(); first.root.replaceWith(first.root.cloneNode(true));
        expect(firstAnchor.locate(quote)).toBe('located');
        for (const mode of ['missing', 'id', 'tag', 'next', 'parent', 'previous'] as const) {
            const f = fixture('<p id="previous">before</p><p id="selected">Anna watered the plant. It grew.</p><p id="next">after</p>');
            const anchor = f.create(); const replacement = f.document.createElement(mode === 'tag' ? 'div' : 'p');
            replacement.id = mode === 'id' ? 'changed-id' : 'selected'; replacement.textContent = f.root.textContent;
            f.root.replaceWith(replacement);
            if (mode === 'missing') replacement.remove();
            if (mode === 'next') f.document.querySelector('#next')!.remove();
            if (mode === 'parent') replacement.parentElement!.remove();
            if (mode === 'previous') f.document.querySelector('#previous')!.remove();
            expect(anchor.locate(quote)).toBe('changed');
        }
    });
    it('invalidates changed content permanently and cancels invalidation resources exactly once', () => {
        const f = fixture(); const onInvalidate = vi.fn(); const anchor = f.create(f.selection, {onInvalidate});
        expect(anchor.locate(quote)).toBe('located');
        f.root.textContent = 'Anna watered the plant. It died.'; f.mutation();
        expect(anchor.locate(quote)).toBe('changed'); expect(f.registry.size).toBe(0);
        expect(onInvalidate).toHaveBeenCalledOnce(); expect(onInvalidate).toHaveBeenCalledWith('changed');
        f.root.textContent = 'Anna watered the plant. It grew.'; f.mutation();
        expect(anchor.locate(quote)).toBe('changed'); expect(onInvalidate).toHaveBeenCalledOnce();
        expect(f.observations[0].disconnect).toHaveBeenCalledOnce();
    });
    it('invalidates when the source becomes excluded and ignores mutations outside the local block', () => {
        const f = fixture(); const anchor = f.create();
        f.mutation(f.document.body); expect(anchor.locate(quote)).toBe('located');
        f.root.classList.add('notranslate'); f.mutation();
        expect(anchor.locate(quote)).toBe('changed');
    });
    it('invalidates a removed local ancestor and clears native ranges attached to its detached source', () => {
        const f = fixture(); const anchor = f.create(); expect(anchor.locate(quote)).toBe('located');
        const parent = f.root.parentElement!; parent.remove(); f.mutation(f.document.body, [parent]);
        expect(anchor.check()).toBe('changed'); expect(f.registry.size).toBe(0);
    });
    it('keeps saved source unavailable while the block or an ancestor is hidden and restores visible original', () => {
        const f = fixture(); const anchor = f.create();
        f.root.hidden = true; f.mutation(); expect(anchor.locate(quote)).toBe('unavailable');
        f.root.hidden = false; expect(anchor.locate(quote)).toBe('located');
        f.root.parentElement!.style.display = 'none'; expect(anchor.locate(quote)).toBe('unavailable');
        f.root.parentElement!.style.display = ''; expect(anchor.locate(quote)).toBe('located');
        f.root.style.visibility = 'collapse'; expect(anchor.locate(quote)).toBe('unavailable');
    });
    it('retains hidden inline originals without drawing invisible evidence and permits display restoration', () => {
        const f = fixture('<p>Anna watered the plant. <span id="selected">It grew.</span></p>');
        const anchor = f.create(); f.root.style.visibility = 'hidden'; f.mutation(f.root.parentElement!);
        expect(anchor.locate(quote)).toBe('unavailable');
        f.root.style.visibility = ''; expect(anchor.locate(quote)).toBe('located');
        f.root.setAttribute('aria-hidden', 'true'); expect(anchor.locate(quote)).toBe('unavailable');
    });
    it('detects hash/search/path navigation immediately, on events, on bounded polling and pagehide', () => {
        for (const trigger of ['locate', 'popstate', 'hashchange', 'poll', 'pagehide', 'mutation'] as const) {
            const f = fixture(); const onInvalidate = vi.fn(); const anchor = f.create(f.selection, {onInvalidate});
            expect(anchor.locate(quote)).toBe('located');
            if (trigger !== 'pagehide') f.location.href = 'https://fixture.test/next?q=two#new';
            if (trigger === 'popstate' || trigger === 'hashchange' || trigger === 'pagehide') f.window.dispatchEvent(new f.window.Event(trigger));
            if (trigger === 'poll') vi.advanceTimersByTime(250);
            if (trigger === 'mutation') f.mutation();
            expect(anchor.locate(quote)).toBe('navigated'); expect(f.registry.size).toBe(0);
            expect(onInvalidate).toHaveBeenCalledOnce(); expect(onInvalidate).toHaveBeenCalledWith('navigated');
        }
    });
    it('keeps CSS highlights attached during native positioning scroll and clears on resize', () => {
        const f = fixture(); const anchor = f.create();
        expect(anchor.locate(quote)).toBe('located');
        f.window.dispatchEvent(new f.window.Event('scroll')); expect(f.registry.size).toBe(1);
        expect(anchor.locate(quote)).toBe('located');
        f.window.dispatchEvent(new f.window.Event('resize')); expect(f.registry.size).toBe(0);
        expect(anchor.locate(quote)).toBe('located');
    });
    it('suspends task observers and supports explicitly rechecking or locating the same source', () => {
        const f = fixture(); const anchor = f.create();
        expect(anchor.check()).toBe('located'); expect(anchor.locate(quote)).toBe('located');
        anchor.suspend(); expect(f.registry.size).toBe(0); expect(f.observations[0].disconnect).toHaveBeenCalledOnce();
        expect(anchor.check()).toBe('located'); expect(f.observations).toHaveLength(2);
        anchor.suspend(); expect(anchor.locate(quote)).toBe('located'); expect(f.observations).toHaveLength(3);
        anchor.dispose(); expect(anchor.check()).toBe('unavailable');
        const cancelled = new AbortController(); const paused = f.create(f.selection, {signal: cancelled.signal});
        paused.suspend(); cancelled.abort(); expect(paused.check()).toBe('unavailable');
        const cancelledAgain = new AbortController(); const pausedAgain = f.create(f.selection, {signal: cancelledAgain.signal});
        pausedAgain.suspend(); cancelledAgain.abort(); expect(pausedAgain.locate(quote)).toBe('unavailable');
    });
    it('checks hidden, changed and navigation state synchronously before accepting late replies', () => {
        const f = fixture(); const anchor = f.create();
        f.root.hidden = true; expect(anchor.check()).toBe('unavailable');
        f.root.hidden = false; f.root.textContent = 'Changed'; expect(anchor.check()).toBe('changed');
        expect(anchor.check()).toBe('changed');
        const navigated = fixture(); const another = navigated.create();
        navigated.location.href = 'https://fixture.test/new'; expect(another.check()).toBe('navigated');
    });
    it('cancels and disposes late operations, timers, listeners and observers, including pre-aborted tasks', () => {
        const f = fixture(); const controller = new AbortController(); const onInvalidate = vi.fn();
        const anchor = f.create(f.selection, {signal: controller.signal, onInvalidate});
        expect(anchor.locate(quote)).toBe('located'); controller.abort();
        expect(f.registry.size).toBe(0); expect(anchor.locate(quote)).toBe('unavailable');
        f.location.href = 'https://fixture.test/changed'; f.mutation(); vi.advanceTimersByTime(4000);
        expect(onInvalidate).not.toHaveBeenCalled(); anchor.dispose();
        expect(f.observations[0].disconnect).toHaveBeenCalledOnce();
        expect(f.create(f.selection, {signal: controller.signal}).locate(quote)).toBe('unavailable');
    });
    it('supports safe fixed overlays when CSS Highlights is unavailable and cleans them after a short duration', () => {
        const f = fixture(); Object.defineProperty(f.window, 'Highlight', {configurable: true, value: undefined});
        const anchor = f.create();
        expect(anchor.locate(quote)).toBe('located');
        const overlay = f.document.querySelector('[data-fluent-read-ui="reading-evidence-highlight-overlay"]')!;
        expect(overlay.childElementCount).toBe(1); expect(overlay.firstElementChild!.getAttribute('style')).toContain('left:15px');
        expect(f.root.textContent).toBe('Anna watered the plant. It grew.');
        vi.advanceTimersByTime(3500); expect(overlay.isConnected).toBe(false);
        expect(anchor.locate(quote)).toBe('located'); anchor.dispose(); expect(f.document.querySelector('[data-fluent-read-ui]')).toBeNull();
    });
    it('clears fixed overlays on scroll and removes the exact listener on suspension and dispose', () => {
        const f = fixture(); Object.defineProperty(f.window, 'Highlight', {configurable: true, value: undefined});
        const add = vi.spyOn(f.window, 'addEventListener'); const remove = vi.spyOn(f.window, 'removeEventListener');
        const anchor = f.create(); expect(anchor.locate(quote)).toBe('located');
        f.window.dispatchEvent(new f.window.Event('scroll')); expect(f.document.querySelector('[data-fluent-read-ui]')).toBeNull();
        const callback = add.mock.calls.find(call => call[0] === 'scroll')![1];
        anchor.suspend(); expect(remove).toHaveBeenCalledWith('scroll', callback, true);
        expect(anchor.locate(quote)).toBe('located'); anchor.dispose();
        expect(remove).toHaveBeenCalledWith('scroll', callback, true);
        add.mockRestore(); remove.mockRestore();
    });
    it('removes fixed fallback geometry after nearby sibling insertion or parent hiding, preserving source identity', () => {
        const f = fixture(); Object.defineProperty(f.window, 'Highlight', {configurable: true, value: undefined});
        const anchor = f.create(); expect(anchor.locate(quote)).toBe('located');
        const sibling = f.document.createElement('p'); sibling.textContent = 'A newly inserted block changes layout.';
        f.root.before(sibling); f.mutation(f.root.parentElement!);
        expect(f.document.querySelector('[data-fluent-read-ui]')).toBeNull(); expect(anchor.check()).toBe('located');
        expect(anchor.locate(quote)).toBe('located'); f.root.parentElement!.hidden = true; f.mutation(f.root.parentElement!);
        expect(f.document.querySelector('[data-fluent-read-ui]')).toBeNull(); expect(anchor.check()).toBe('unavailable');
        f.root.parentElement!.hidden = false; expect(anchor.locate(quote)).toBe('located');
    });
    it('refuses empty/invisible fallback rectangles and handles unsupported range geometry safely', () => {
        const f = fixture(); Object.defineProperty(f.window, 'CSS', {configurable: true, value: undefined});
        const anchor = f.create();
        f.rects[0].width = 0; expect(anchor.locate(quote)).toBe('unavailable');
        f.rects[0].width = 80; f.rects[0].height = 0; expect(anchor.locate(quote)).toBe('unavailable');
        f.createRange.mockImplementationOnce(() => {throw new Error('range unavailable');});
        expect(anchor.locate(quote)).toBe('unavailable'); expect(f.document.querySelector('[data-fluent-read-ui]')).toBeNull();
    });
    it('does not remove another owner’s highlight registry entry and can run without observer support', () => {
        const f = fixture(); Object.defineProperty(f.window, 'MutationObserver', {configurable: true, value: undefined});
        const anchor = f.create(); expect(anchor.locate(quote)).toBe('located');
        const key = [...f.registry.keys()][0]; const other = new Set<Range>(); f.registry.set(key, other);
        anchor.clear(); expect(f.registry.get(key)).toBe(other);
        f.root.textContent = 'Changed'; expect(anchor.locate(quote)).toBe('changed');
    });
    it('falls back to the document root for styles and accepts absent optional scrolling', () => {
        const f = fixture(); f.document.head.remove(); delete (f.root as unknown as {scrollIntoView?: unknown}).scrollIntoView;
        Object.defineProperty(f.document, 'head', {configurable: true, value: null});
        expect(f.create().locate(quote)).toBe('located');
        expect(f.document.documentElement.querySelector('style')).not.toBeNull();
    });
    it('handles a detached document without a window and preserves the permitted snapshot against later caller edits', () => {
        const f = fixture(); const anchor = f.create();
        f.selection.context = 'Caller changed'; f.selection.sentence = 'Caller changed'; f.selection.text = 'Caller changed';
        expect(anchor.locate(quote)).toBe('located');
        Object.defineProperty(f.document, 'defaultView', {configurable: true, value: null});
        const noWindow = f.create({text: 'It', sentence: 'It grew.', context: 'Anna watered the plant. It grew.'});
        expect(noWindow.check()).toBe('located');
    });
});
