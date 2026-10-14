import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {build} from 'vite';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ONESHOT_FREE_ENDPOINT, translate} from '@deeplx/core';
import {createDeepLXRuntimeBuildPlugin} from '../scripts/testing/deeplx-runtime-build';
import {setRuntimeFetch} from '../src/platform/http/runtime';

const root = resolve(__dirname, '..');

afterEach(() => setRuntimeFetch());

describe('DeepLX runtime build boundary', () => {
    it('only redirects the published core transport and selects its browser dependencies', () => {
        const plugin = createDeepLXRuntimeBuildPlugin(root);
        const importer = realpathSync(resolve(root, 'node_modules/@deeplx/core/lib/translate.js'));
        expect(plugin.resolveId('x-fetch', importer)).toBe(resolve(root, 'src/platform/http/deeplxRuntime.ts'));
        expect(plugin.resolveId('x-fetch', importer + '?v=1')).toBe(resolve(root, 'src/platform/http/deeplxRuntime.ts'));
        expect(plugin.resolveId('./random.js', importer)).toBe(realpathSync(resolve(root, 'node_modules/@deeplx/core/lib/random.browser.js')));
        expect(plugin.resolveId('node-fetch-native/proxy', importer)).toMatch(/\/node-fetch-native\/dist\/proxy-stub\.mjs$/u);
        expect(plugin.resolveId('unrelated-package', importer)).toBeNull();
        expect(plugin.resolveId('x-fetch', resolve(root, 'src/providers/translation/deeplx.ts'))).toBeNull();
        expect(plugin.resolveId('x-fetch', importer.replace('/@deeplx/core/', '/another/core/'))).toBeNull();
        expect(plugin.resolveId('x-fetch')).toBeNull();
    });

    it('uses the current runtime transport for real core requests and retains HTTP errors', async () => {
        const first = vi.fn(async () => Response.json({translations: [{text: '你好'}]}));
        setRuntimeFetch(first);
        await expect(translate('Hello', 'ZH', 'auto', {skipWarm: true})).resolves.toBe('你好');
        expect(first).toHaveBeenCalledTimes(1);
        const [url, init] = first.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(ONESHOT_FREE_ENDPOINT);
        expect(init.method).toBe('POST');
        expect(init.credentials).toBe('omit');
        expect(JSON.parse(init.body as string)).toMatchObject({text: ['Hello'], target_lang: 'zh-Hans'});

        const next = vi.fn(async () => Response.json({title: 'Blocked by DeepL'}, {status: 403}));
        setRuntimeFetch(next);
        await expect(translate('Hello again', 'ZH', 'auto', {skipWarm: true})).rejects.toMatchObject({
            message: 'Blocked by DeepL', cause: {code: 403},
        });
        expect(next).toHaveBeenCalledTimes(1);
        expect(first).toHaveBeenCalledTimes(1);
    });

    it('bundles the published browser entry with the same runtime transport', async () => {
        const entry = resolve(root, '.deeplx-runtime-build-fixture.js');
        const built = await build({
            root, configFile: false, publicDir: false, logLevel: 'silent',
            plugins: [createDeepLXRuntimeBuildPlugin(root), {
                name: 'deeplx-test-entry',
                resolveId: source => source === entry ? entry : null,
                load: id => id === entry ? `
                    import {translate} from '@deeplx/core';
                    import {setRuntimeFetch} from './src/platform/http/runtime.ts';
                    globalThis.deeplxFixture = {translate, setRuntimeFetch};
                ` : null,
            }],
            build: {
                write: false, minify: false,
                lib: {entry, name: 'DeepLXFixture', formats: ['iife']},
            },
        });
        const output = (Array.isArray(built) ? built[0] : built) as import('vite').Rollup.RollupOutput;
        const chunk = output.output[0];
        if (chunk.type !== 'chunk') throw new Error('Expected a self-contained browser chunk');
        expect(chunk.imports).toEqual([]);
        expect(chunk.code).not.toMatch(/node:crypto|node:net|node:tls/u);
        const nativeFetch = vi.fn(() => { throw new Error('Core bypassed runtimeFetch'); });
        const realm = {Headers, Response, URLSearchParams, crypto: globalThis.crypto, fetch: nativeFetch, deeplxFixture: undefined as unknown};
        runInNewContext(chunk.code, realm, {timeout: 5_000});
        const fixture = realm.deeplxFixture as {translate: typeof translate; setRuntimeFetch: typeof setRuntimeFetch};
        const transport = vi.fn(async () => Response.json({translations: [{text: '浏览器译文'}]}));
        fixture.setRuntimeFetch(transport);
        await expect(fixture.translate('Browser', 'ZH', 'auto', {skipWarm: true})).resolves.toBe('浏览器译文');
        expect(transport).toHaveBeenCalledTimes(1);
        expect((transport.mock.calls[0] as unknown as [string, RequestInit])[1].credentials).toBe('omit');
        expect(nativeFetch).not.toHaveBeenCalled();
    });
});
