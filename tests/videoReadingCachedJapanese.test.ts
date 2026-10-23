import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createCachedJapaneseBuilder} from '@/src/features/video-subtitle/reading/cachedJapaneseTokenizer';
import {createJapaneseRomanizer} from '@/src/features/video-subtitle/reading/japanese';

afterEach(() => vi.restoreAllMocks());

const bytesFromPackage = async (url: string): Promise<ArrayBuffer> => {
    const name = url.slice(url.lastIndexOf('/') + 1);
    const bytes = await readFile(resolve('node_modules/@faanau/kuromoji/dict', name));
    return Uint8Array.from(bytes).buffer;
};

describe('cached Japanese dictionary integration', () => {
    it('runs the unchanged tokenizer using compressed data read through the cache port without network', async () => {
        const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
        const read = vi.fn(bytesFromPackage);
        const romanize = createJapaneseRomanizer(createCachedJapaneseBuilder(read));
        expect(await romanize('私は学校へ行きます。', 'chrome-extension://test/reading-data/')).toBe('watashi wa gakkō e ikimasu.');
        expect(await romanize('東京大学で日本語を学ぶ。', 'chrome-extension://test/reading-data/')).toBe('tōkyōdaigaku de nihongo o manabu.');
        expect(read).toHaveBeenCalledTimes(12);
        expect(new Set(read.mock.calls.map(([url]) => url.split('/').at(-1))).size).toBe(12);
        expect(network).not.toHaveBeenCalled();
    });

    it('propagates an unavailable dictionary and can retry without changing the local tokenizer algorithm', async () => {
        let unavailable = true;
        const read = vi.fn(async (url: string) => {
            if (unavailable) throw new Error('download unavailable');
            return bytesFromPackage(url);
        });
        const romanize = createJapaneseRomanizer(createCachedJapaneseBuilder(read));
        await expect(romanize('猫', 'cache/')).rejects.toThrow('download unavailable');
        unavailable = false;
        await expect(romanize('猫', 'cache/')).resolves.toBe('neko');
    });

    it('rejects data which cannot be decompressed and retries the same fixed reading request', async () => {
        const inflate = vi.fn().mockRejectedValueOnce(new Error('gzip invalid'))
            .mockImplementation(async (bytes: ArrayBuffer) => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
        const romanize = createJapaneseRomanizer(createCachedJapaneseBuilder(bytesFromPackage, inflate));
        await expect(romanize('猫', 'cache/')).rejects.toThrow('gzip invalid');
        await expect(romanize('猫', 'cache/')).resolves.toBe('neko');
    });

    it.each([new Error('tokenizer rejected dictionary'), 'unexpected tokenizer failure'])(
        'settles initialization when the tokenizer constructor fails (%s)', async failure => {
            vi.resetModules();
            vi.doMock('@faanau/kuromoji/src/Tokenizer', () => ({default: class {constructor() {throw failure;}}}));
            try {
                const {createCachedJapaneseBuilder: createBuilder} = await import('@/src/features/video-subtitle/reading/cachedJapaneseTokenizer');
                const builder = createBuilder(bytesFromPackage);
                const initialized = new Promise((resolve, reject) => builder({dicPath: 'cache/'}).build((error, value) => error ? reject(error) : resolve(value)));
                await expect(initialized).rejects.toThrow(failure instanceof Error ? failure.message : 'failed to initialize');
            } finally {
                vi.doUnmock('@faanau/kuromoji/src/Tokenizer');
                vi.resetModules();
            }
        },
    );
});
