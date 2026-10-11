import {beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
const mocks = vi.hoisted(() => ({capture: vi.fn(), excerpt: vi.fn()}));
vi.mock('@/src/features/reading-assistant/public', () => ({captureReadingSelection: mocks.capture}));
vi.mock('@/src/features/full-page-translation/public', () => ({readBilingualExcerpt: mocks.excerpt}));
import {captureProgressiveSource} from '@/src/features/progressive-reading/source';

function fixture(html = '<p id="p">Some source <a href="#next">text</a>.</p>') {
  const {document} = parseHTML(`<html><body>${html}</body></html>`);
  Object.defineProperty(document, 'location', {value: {href: 'https://example.test/article'}});
  const p = document.querySelector('#p')!;
  const range = {startContainer: p.firstChild!, endContainer: p.firstChild!, toString: vi.fn(() => 'Some source text.'), intersectsNode: vi.fn(() => false), cloneRange() {return this;}};
  const selection = {isCollapsed: false, rangeCount: 1, getRangeAt: () => range};
  Object.defineProperty(document, 'getSelection', {value: () => selection, configurable: true});
  return {document: document as unknown as Document, p, range, selection};
}
beforeEach(() => {vi.clearAllMocks(); mocks.capture.mockReturnValue({context: 'Some source text.', text: 'Some source text.'}); mocks.excerpt.mockReturnValue(null);});
describe('progressive reading source ownership', () => {
  it('reads a linked paragraph without changing source DOM or links, and validates whitespace-normalized text', () => {
    const {document, p, range} = fixture(); const before = p.outerHTML;
    const source = captureProgressiveSource(document)!;
    expect(source.text).toBe('Some source text.'); expect(source.valid()).toBe(true); expect(p.outerHTML).toBe(before);
    range.toString.mockReturnValue(' Some  source text. '); expect(source.valid()).toBe(true);
    range.toString.mockReturnValue('changed'); expect(source.valid()).toBe(false);
  });
  it('rejects absent, collapsed, multiple, empty, oversized and disconnected selections', () => {
    const f = fixture(); Object.defineProperty(f.document, 'getSelection', {value: () => null, configurable: true}); expect(captureProgressiveSource(f.document)).toBeNull();
    const g = fixture(); g.selection.isCollapsed = true; expect(captureProgressiveSource(g.document)).toBeNull();
    g.selection.isCollapsed = false; g.selection.rangeCount = 2; expect(captureProgressiveSource(g.document)).toBeNull();
    g.selection.rangeCount = 1; g.range.toString.mockReturnValue(''); expect(captureProgressiveSource(g.document)).toBeNull();
    g.range.toString.mockReturnValue('a'.repeat(4097)); expect(captureProgressiveSource(g.document)).toBeNull();
    g.range.toString.mockReturnValue('source'); g.range.startContainer = g.document.createTextNode('source'); expect(captureProgressiveSource(g.document)).toBeNull();
  });
  it('blocks protected endpoints, crossed code, huge context and multi-paragraph selection', () => {
    for (const attr of ['contenteditable="true"', 'translate="no"', 'data-fluent-read-ui="other"', 'role="button"', 'data-notranslate="true"']) {
      const f = fixture(`<p id="p" ${attr}>text</p>`); expect(captureProgressiveSource(f.document)).toBeNull();
    }
    const f = fixture('<p id="p">text<code>x</code></p>'); f.range.intersectsNode.mockReturnValue(true); expect(captureProgressiveSource(f.document)).toBeNull();
    f.range.intersectsNode.mockReturnValue(false); mocks.capture.mockReturnValue({context: 'a'.repeat(4097), text: 'text'}); expect(captureProgressiveSource(f.document)).toBeNull();
    mocks.capture.mockReturnValue({context: '', text: ''}); expect(captureProgressiveSource(f.document)).toBeNull();
    const g = fixture('<p id="p">text</p><p id="q">other</p>'); g.range.endContainer = g.document.querySelector('#q')!.firstChild!; expect(captureProgressiveSource(g.document)).toBeNull();
    const h = fixture('<article id="p">text</article>'); expect(captureProgressiveSource(h.document)).toBeNull();
  });
  it('reuses only an owned exact matching bilingual excerpt and otherwise falls back to selected text', () => {
    const f = fixture('<p id="p">text<i class="fluent-read-bilingual-content" data-fr-translation-owned="true">译</i><i class="fluent-read-bilingual-content" data-fr-translation-owned="true">译2</i></p>');
    mocks.excerpt.mockReturnValueOnce(null).mockReturnValue({original: ' Some source  text. ', translation: '可信译文'});
    expect(captureProgressiveSource(f.document)!.translation).toBe('可信译文');
    mocks.excerpt.mockReturnValue({original: 'another source', translation: '错误译文'}); expect(captureProgressiveSource(f.document)!.translation).toBe('');
    mocks.capture.mockReturnValue({context: '', text: 'Some source text.'}); expect(captureProgressiveSource(f.document)!.valid()).toBe(true);
  });
  it('invalidates changed context, route, removal, protected start/end and element-based ranges', () => {
    const f = fixture(); const source = captureProgressiveSource(f.document)!;
    mocks.capture.mockReturnValue({context: 'changed', text: 'Some source text.'}); expect(source.valid()).toBe(false);
    mocks.capture.mockReturnValue({context: '', text: 'Some source text.'}); expect(source.valid()).toBe(true);
    f.document.location.href = 'https://example.test/next'; expect(source.valid()).toBe(false); f.document.location.href = 'https://example.test/article';
    f.p.setAttribute('translate', 'no'); expect(source.valid()).toBe(false); f.p.removeAttribute('translate');
    f.p.remove(); expect(source.valid()).toBe(false);
    const g = fixture('<p id="p">text<em>end</em></p>'); g.range.startContainer = g.p; g.range.endContainer = g.p.querySelector('em')!;
    const elementSource = captureProgressiveSource(g.document)!; expect(elementSource.valid()).toBe(true);
    g.p.querySelector('em')!.setAttribute('hidden', ''); expect(elementSource.valid()).toBe(false);
  });
  it('validates visibility of the full ancestor chain and supports a small inline text root', () => {
    const f = fixture('<span id="p">text</span>'); let style = {display: 'block', visibility: 'visible'};
    Object.defineProperty(f.document.defaultView!, 'getComputedStyle', {value: () => style, configurable: true});
    const source = captureProgressiveSource(f.document)!; expect(source.valid()).toBe(true);
    style = {display: 'none', visibility: 'visible'}; expect(source.valid()).toBe(false);
    style = {display: 'block', visibility: 'hidden'}; expect(source.valid()).toBe(false);
    style = {display: 'block', visibility: 'visible'}; expect(source.valid()).toBe(true);
    f.range.endContainer = f.document.createTextNode('detached'); expect(source.valid()).toBe(false); expect(captureProgressiveSource(f.document)).toBeNull();
    f.range.endContainer = f.p.firstChild!; f.range.startContainer = f.document.createTextNode('detached'); expect(source.valid()).toBe(false);
  });
  it('invalidates protected descendants introduced inside an unchanged element-endpoint selection', () => {
    const f = fixture('<p id="p">Some <span>source</span> text.</p>'); f.range.startContainer = f.p; f.range.endContainer = f.p;
    f.range.intersectsNode.mockReturnValue(true); const source = captureProgressiveSource(f.document)!; expect(source.valid()).toBe(true);
    const span = f.p.querySelector('span')!; span.setAttribute('contenteditable', 'true'); expect(source.valid()).toBe(false); span.removeAttribute('contenteditable');
    f.range.startContainer = span.firstChild!; span.setAttribute('role', 'button'); expect(source.valid()).toBe(false); span.removeAttribute('role');
    f.range.endContainer = span.firstChild!; span.setAttribute('data-notranslate', 'true'); expect(source.valid()).toBe(false); span.removeAttribute('data-notranslate');
    f.range.startContainer = f.document.body; expect(source.valid()).toBe(false); f.range.startContainer = f.p;
    f.range.endContainer = f.document.body; expect(source.valid()).toBe(false);
  });
});
