import {afterEach, describe, expect, it, vi} from 'vitest';
import {createPdfReaderUrl, getPdfSourceUrl, normalizeOnlinePdfUrl, readPdfSourceFragment} from '@/src/features/document-translation/core/pdfSource';
import {fetchOnlinePdf} from '@/src/features/document-translation/services/pdfSource';
import {PDF_MAX_BYTES} from '@/src/features/document-translation/core/document';

const pdfBytes = new TextEncoder().encode('%PDF-1.7\nfixture');
afterEach(() => vi.unstubAllGlobals());
function download(response: Response) {return vi.fn(async () => response) as unknown as typeof fetch;}
function stream(chunks: Uint8Array[]) {return new ReadableStream<Uint8Array>({start(controller) {chunks.forEach(chunk => controller.enqueue(chunk)); controller.close();}});}

describe('PDF source entry URL boundary', () => {
    it.each(['', 'garbage', 'javascript:alert(1)', 'file:///tmp/paper.pdf', 'chrome://settings', 'https://user:password@example.com/paper.pdf'])('rejects unsafe source %s', value => {
        expect(normalizeOnlinePdfUrl(value)).toBeNull();
        expect(getPdfSourceUrl(value)).toBeNull();
        expect(() => createPdfReaderUrl('chrome-extension://id/document.html', value)).toThrow();
    });
    it.each(['https://example.com/Paper.PDF?download=1', 'http://example.com/paper.pdf', 'https://arxiv.org/pdf/1706.03762', 'https://www.arxiv.org/pdf/1706.03762v7/'])('recognizes clear PDF sources %s', value => {
        expect(getPdfSourceUrl(value)).toBe(value);
    });
    it.each(['https://example.com/paper.pdf/view', 'https://example.com/?pdf=paper.pdf', 'https://example.com/pdf/id', 'https://arxiv.org/abs/1706.03762'])('keeps ambiguous webpage %s as a webpage', value => expect(getPdfSourceUrl(value)).toBeNull());
    it('normalizes source fragment without exposing it as page query parameters', () => {
        const source = 'https://arxiv.org/pdf/1706.03762?x=a&y=1#page=2';
        const reader = createPdfReaderUrl('chrome-extension://id/document.html#old', source);
        expect(reader.startsWith('chrome-extension://id/document.html#pdf=')).toBe(true);
        expect(readPdfSourceFragment(new URL(reader).hash)).toBe('https://arxiv.org/pdf/1706.03762?x=a&y=1');
        expect(readPdfSourceFragment('')).toBeNull();
        expect(readPdfSourceFragment('#pdf=')).toBeNull();
        expect(readPdfSourceFragment('#pdf=javascript%3Aalert(1)')).toBeNull();
    });
});

describe('Online PDF streamed import ownership and memory', () => {
    it('reads a streamed PDF including a split signature and reports actual received bytes', async () => {
        const progress = vi.fn();
        const request = download(new Response(stream([pdfBytes.slice(0, 2), pdfBytes.slice(2, 4), pdfBytes.slice(4)]), {headers: {'content-length': String(pdfBytes.length)}}));
        const file = await fetchOnlinePdf('https://arxiv.org/pdf/1706.03762', {fetch: request, onProgress: progress});
        expect(file.name).toBe('1706.03762.pdf');
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(pdfBytes);
        expect(progress).toHaveBeenLastCalledWith({received: pdfBytes.length, total: pdfBytes.length});
        expect(request).toHaveBeenCalledWith('https://arxiv.org/pdf/1706.03762', {signal: undefined, credentials: 'omit', referrerPolicy: 'no-referrer'});
    });
    it.each(['https://example.com/Paper.PDF', 'https://example.com/download/%3Cpaper%3E', 'https://example.com/', 'https://example.com/%E0%A4'])('provides a safe local filename for %s', async url => {
        const file = await fetchOnlinePdf(url, {fetch: download(new Response(pdfBytes))});
        expect(file.name.endsWith('.pdf') || file.name.endsWith('.PDF')).toBe(true);
        expect(file.name).not.toMatch(/[<>/]/u);
    });
    it('uses the final response URL filename after a redirect', async () => {
        const response = new Response(pdfBytes); Object.defineProperty(response, 'url', {value: 'https://example.com/final.pdf'});
        expect((await fetchOnlinePdf('https://example.com/download', {fetch: download(response)})).name).toBe('final.pdf');
    });
    it('supports a response without a readable stream', async () => {
        const response = new Response(pdfBytes); Object.defineProperty(response, 'body', {value: null});
        const progress = vi.fn();
        const file = await fetchOnlinePdf('https://example.com/download', {fetch: download(response), onProgress: progress});
        expect(file.size).toBe(pdfBytes.length);
        expect(progress).toHaveBeenCalledWith({received: pdfBytes.length, total: undefined});
    });
    it('uses the default fetch adapter and can cancel after fallback progress', async () => {
        vi.stubGlobal('fetch', download(new Response(pdfBytes)));
        expect((await fetchOnlinePdf('https://example.com/a.pdf')).size).toBe(pdfBytes.length);
        const response = new Response(pdfBytes); Object.defineProperty(response, 'body', {value: null});
        const controller = new AbortController();
        await expect(fetchOnlinePdf('https://example.com/a.pdf', {fetch: download(response), signal: controller.signal,
            onProgress: () => controller.abort(new Error('Canceled fallback'))})).rejects.toThrow('Canceled fallback');
    });
    it.each([new Uint8Array(), new TextEncoder().encode('<html>login page')])('rejects non-PDF responses even with PDF-like URLs', async bytes => {
        await expect(fetchOnlinePdf('https://example.com/paper.pdf', {fetch: download(new Response(bytes))})).rejects.toThrow('有效 PDF');
    });
    it('does not fetch an invalid source or an already-aborted request', async () => {
        const request = vi.fn();
        await expect(fetchOnlinePdf('file:///tmp/test.pdf', {fetch: request})).rejects.toThrow('HTTP');
        const controller = new AbortController(); controller.abort(new Error('Stopped'));
        await expect(fetchOnlinePdf('https://example.com/paper.pdf', {fetch: request, signal: controller.signal})).rejects.toThrow('Stopped');
        expect(request).not.toHaveBeenCalled();
    });
    it('surfaces HTTP failure and network errors for retry', async () => {
        await expect(fetchOnlinePdf('https://example.com/a.pdf', {fetch: download(new Response('', {status: 403}))})).rejects.toThrow('HTTP 403');
        await expect(fetchOnlinePdf('https://example.com/a.pdf', {fetch: vi.fn().mockRejectedValue(new Error('offline'))})).rejects.toThrow('offline');
    });
    it('cancels before reading a declared oversized body', async () => {
        const response = new Response(stream([]), {headers: {'content-length': String(PDF_MAX_BYTES + 1)}});
        const cancel = vi.spyOn(response.body!, 'cancel');
        await expect(fetchOnlinePdf('https://example.com/a.pdf', {fetch: download(response)})).rejects.toThrow('MB');
        expect(cancel).toHaveBeenCalledOnce();
    });
    it('rejects an oversized response without a body and releases cancellation errors', async () => {
        const response = {ok: true, headers: new Headers({'content-length': String(PDF_MAX_BYTES + 1)}), body: null} as Response;
        await expect(fetchOnlinePdf('https://example.com/a.pdf', {fetch: download(response)})).rejects.toThrow('MB');
        const controller = new AbortController();
        const failedCancel = new Response(new ReadableStream({start(c) {c.enqueue(pdfBytes);}, cancel() {throw new Error('cancel failed');}}));
        await expect(fetchOnlinePdf('https://example.com/a.pdf', {fetch: download(failedCancel), signal: controller.signal,
            onProgress: () => controller.abort(new Error('Stopped'))})).rejects.toThrow('Stopped');
        expect(failedCancel.body?.locked).toBe(false);
    });
    it('stops an unknown-length stream immediately when its real bytes exceed the limit', async () => {
        const cancel = vi.fn();
        const response = new Response(new ReadableStream({start(c) {c.enqueue(new Uint8Array(PDF_MAX_BYTES + 1));}, cancel}));
        await expect(fetchOnlinePdf('https://example.com/a.pdf', {fetch: download(response)})).rejects.toThrow('MB');
        expect(cancel).toHaveBeenCalledOnce();
    });
    it('checks fallback arrayBuffer size before creating the imported File', async () => {
        const response = {ok: true, url: '', headers: new Headers(), body: null, arrayBuffer: async () => new ArrayBuffer(PDF_MAX_BYTES + 1)} as Response;
        await expect(fetchOnlinePdf('https://example.com/a.pdf', {fetch: download(response)})).rejects.toThrow('MB');
    });
    it('cancels a stalled stream on abort, releases its lock, and never returns a partial PDF', async () => {
        const cancel = vi.fn(); const controller = new AbortController();
        const response = new Response(new ReadableStream({start(c) {c.enqueue(pdfBytes);}, cancel}));
        const progress = vi.fn(() => controller.abort(new Error('Stopped')));
        await expect(fetchOnlinePdf('https://example.com/a.pdf', {fetch: download(response), signal: controller.signal, onProgress: progress})).rejects.toThrow('Stopped');
        expect(cancel).toHaveBeenCalled(); expect(response.body?.locked).toBe(false);
    });
    it('releases the lock when a network stream errors during its read and cancel', async () => {
        const response = new Response(new ReadableStream({start(controller) {controller.error(new Error('Stream failed'));}}));
        await expect(fetchOnlinePdf('https://example.com/a.pdf', {fetch: download(response)})).rejects.toThrow('Stream failed');
        expect(response.body?.locked).toBe(false);
    });
});
