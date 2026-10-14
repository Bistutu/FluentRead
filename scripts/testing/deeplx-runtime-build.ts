import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import type {Plugin} from 'vite';

/** 只替换固定版本 DeepLX core 的 transport，其他 x-fetch 使用者继续使用其原始入口。 */
export function createDeepLXRuntimeBuildPlugin(repositoryRoot: string) {
    const adapter = resolve(repositoryRoot, 'src/platform/http/deeplxRuntime.ts');
    const resolveDependency = (source: string, importer?: string) => {
        const importerPath = importer?.split('?', 1)[0];
        if (!importerPath || !importerPath.replace(/\\/gu, '/').endsWith('/node_modules/@deeplx/core/lib/translate.js')) return null;
        if (source === 'x-fetch') return adapter;
        // Vitest 在 Node 环境执行，但该 provider 与所有交付产物共享浏览器入口。
        if (source === './random.js') return resolve(dirname(importerPath), 'random.browser.js');
        if (source === 'node-fetch-native/proxy') {
            const proxyEntry = createRequire(importerPath).resolve(source);
            return resolve(dirname(proxyEntry), 'proxy-stub.mjs');
        }
        return null;
    };
    return {
        name: 'fluentread-deeplx-runtime-fetch',
        enforce: 'pre' as const,
        resolveId: resolveDependency,
    } satisfies Plugin;
}
