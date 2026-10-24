import {createHash, webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createZoteroFontLoader, memoizeZoteroFontLoader, type ZoteroFontIO} from '../integrations/zotero/fontCache';
import {PDF_READING_FONT_BYTES, PDF_READING_FONT_SHA256} from '../src/features/document-translation/services/pdfReadingFont';

const font = new Uint8Array(readFileSync(new URL('../assets/pdf-fonts/FluentReadNotoSansSC-Regular.woff2', import.meta.url)));
const directory = '/isolated-profile/fluentread/fonts';
const path = `${directory}/${PDF_READING_FONT_SHA256}.woff2`;
function expectFont(bytes: Uint8Array) {
    expect(bytes.byteLength).toBe(PDF_READING_FONT_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PDF_READING_FONT_SHA256);
}
function harness(cacheDirectory = directory) {
    const files = new Map<string, Uint8Array>();
    const io = {
        read: vi.fn(async (name: string, options?: Record<string, unknown>) => {
            if (!files.has(name)) throw new DOMException('missing', 'NotFoundError');
            return files.get(name)!.slice(0, options?.maxBytes as number | undefined);
        }),
        write: vi.fn(async (name: string, bytes: Uint8Array, _options?: Record<string, unknown>) => {files.set(name, bytes.slice());}),
        makeDirectory: vi.fn(async (_name: string, _options?: Record<string, unknown>) => undefined),
        exists: vi.fn(async (name: string) => files.has(name)),
        remove: vi.fn(async (name: string, _options?: Record<string, unknown>) => {files.delete(name);}),
        setPermissions: vi.fn(async (_name: string, _permissions: number) => undefined),
    } satisfies ZoteroFontIO;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(font.slice()));
    const options = {io, directory: cacheDirectory, fetch};
    return {files, io, fetch, options, load: createZoteroFontLoader(options)};
}
beforeEach(() => {vi.stubGlobal('crypto', webcrypto);});
afterEach(() => vi.unstubAllGlobals());

describe('Zotero PDF font profile cache', () => {
    it('atomically persists the verified fixed font privately and reuses defensive copies in memory', async () => {
        const h = harness();
        const first = await h.load();
        expectFont(first);
        expect(h.io.makeDirectory).toHaveBeenCalledWith(directory, {ignoreExisting: true, permissions: 0o700});
        expect(h.io.setPermissions).toHaveBeenCalledWith(directory, 0o700);
        expect(h.io.setPermissions).toHaveBeenCalledWith(path, 0o600);
        const [writtenPath, writtenBytes, options] = h.io.write.mock.calls[0];
        expect(writtenPath).toBe(path); expectFont(writtenBytes);
        expect(options).toMatchObject({tmpPath: expect.stringMatching(new RegExp(`\\.woff2\\.[a-f0-9-]+\\.tmp$`)), flush: true, permissions: 0o600});
        expect(h.io.remove).toHaveBeenCalledWith(options!.tmpPath, {ignoreAbsent: true});
        first[0] ^= 1;
        const second = await h.load();
        expectFont(second); expect(second).not.toBe(first);
        expect(h.fetch).toHaveBeenCalledOnce(); expect(h.io.exists).toHaveBeenCalledOnce();
    });

    it('reopens the profile offline and bounds file reads before the shared integrity check', async () => {
        const h = harness(); await h.load(); h.fetch.mockRejectedValue(new Error('offline'));
        const reopened = createZoteroFontLoader(h.options);
        expectFont(await reopened());
        expect(h.fetch).toHaveBeenCalledOnce();
        expect(h.io.read).toHaveBeenCalledWith(path, {maxBytes: PDF_READING_FONT_BYTES + 1});
    });

    it.each(['hash', 'short', 'oversize'] as const)('evicts a %s profile entry and only publishes the verified replacement', async kind => {
        const h = harness();
        const corrupt = kind === 'short' ? new Uint8Array(4) : kind === 'oversize' ? new Uint8Array(font.length + 100) : font.slice();
        if (kind === 'hash') corrupt[50] ^= 1;
        h.files.set(path, corrupt);
        expectFont(await h.load());
        expect(h.io.remove).toHaveBeenCalledWith(path, {ignoreAbsent: true});
        expectFont(h.files.get(path)!); expect(h.fetch).toHaveBeenCalledOnce();
    });

    it.each(['exists', 'read', 'makeDirectory', 'write', 'remove', 'setPermissions'] as const)
    ('keeps verified session data usable when profile %s fails', async stage => {
        const h = harness();
        if (stage === 'read' || stage === 'remove') h.files.set(path, new Uint8Array(3));
        h.io[stage].mockRejectedValue(new Error('profile unavailable'));
        expectFont(await h.load());
        expectFont(await h.load());
        expect(h.fetch).toHaveBeenCalledOnce();
    });

    it('removes a published file when native permission hardening fails', async () => {
        const h = harness();
        h.io.setPermissions.mockImplementation(async name => {if (name === path) throw new Error('chmod failed');});
        expectFont(await h.load());
        expect(h.files.has(path)).toBe(false);
        expect(h.io.remove).toHaveBeenCalledWith(path, {ignoreAbsent: true});
        expectFont(await h.load()); expect(h.fetch).toHaveBeenCalledOnce();
    });

    it('uses native Windows separators and supports a minimal private-write IO adapter', async () => {
        const h = harness('C:\\isolated-profile\\fluentread\\fonts\\');
        const {setPermissions: _unused, ...io} = h.io;
        await createZoteroFontLoader({...h.options, io})();
        expect(h.io.write.mock.calls[0][0]).toBe(`C:\\isolated-profile\\fluentread\\fonts\\${PDF_READING_FONT_SHA256}.woff2`);
        expect(h.io.makeDirectory.mock.calls[0][0]).toBe('C:\\isolated-profile\\fluentread\\fonts');
    });

    it('does not cache a failed or canceled load and preserves cancellation before memory hits', async () => {
        const load = vi.fn(async () => new Uint8Array([1, 2, 3]));
        const cached = memoizeZoteroFontLoader(load);
        load.mockRejectedValueOnce(new Error('offline'));
        await expect(cached()).rejects.toThrow('offline');
        const controller = new AbortController();
        load.mockImplementationOnce(async () => {controller.abort(new Error('canceled')); return new Uint8Array([7]);});
        await expect(cached(controller.signal)).rejects.toThrow('canceled');
        expect(await cached()).toEqual(new Uint8Array([1, 2, 3]));
        await expect(cached(controller.signal)).rejects.toThrow('canceled');
        expect(load).toHaveBeenCalledTimes(3);
    });

    it('preserves independent cancellation while the shared verified download remains in flight', async () => {
        const h = harness();
        let resolve!: (response: Response) => void;
        let started!: () => void;
        const connected = new Promise<void>(yes => {started = yes;});
        h.fetch.mockImplementationOnce(async () => {started(); return new Promise<Response>(yes => {resolve = yes;});});
        const firstController = new AbortController();
        const first = h.load(firstController.signal);
        const canceled = expect(first).rejects.toThrow('first export closed');
        const second = h.load();
        await connected; firstController.abort(new Error('first export closed')); await canceled;
        resolve(new Response(font.slice()));
        expectFont(await second); expectFont(await h.load());
        expect(h.fetch).toHaveBeenCalledOnce();
    });
});
