import {defineConfig} from 'wxt';
import vue from '@vitejs/plugin-vue';
import {resolve} from 'path';
import fs from 'fs';


const packageJson = JSON.parse(fs.readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

/**
 * Edge 的扩展内容脚本加载器会拒绝产物中的 Unicode 非字符 U+FFFE/U+FFFF，
 * 并把它们误报成“不是 UTF-8 编码”。部分第三方解析器会把源码中的转义
 * 序列展开成这些字符，因此在最终 JavaScript chunk 中重新写成 ASCII 转义，
 * 保持运行时值不变，同时避免扩展加载失败。
 */
function escapeExtensionNoncharacters() {
    const escapeActualNoncharacters = (code: string) => code.replace(/[\uFFFE\uFFFF]/g, (character) => {
        const codePoint = character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
        return `\\u${codePoint}`;
    });

    return {
        name: 'escape-extension-noncharacters',
        generateBundle(_options: unknown, bundle: Record<string, {type: string; code?: string}>) {
            // 部分构建阶段会在 renderChunk 之后再次序列化字符串，因此在
            // 写入扩展目录前再检查一次最终 chunk，覆盖后台脚本等产物。
            for (const chunk of Object.values(bundle)) {
                if (chunk.type !== 'chunk' || chunk.code === undefined) continue;

                const escaped = escapeActualNoncharacters(chunk.code);
                if (escaped !== chunk.code) chunk.code = escaped;
            }
        },
    };
}


// See https://wxt.dev/api/config.html
export default defineConfig({
    modules: ['@wxt-dev/webextension-polyfill'],
    imports: {
        addons: {
            vueTemplate: true,
        },
    },
    vite: () => ({
        plugins: [vue(), escapeExtensionNoncharacters()],
        define: {
            'process.env.VUE_APP_VERSION': JSON.stringify(packageJson.version),
        }
    }),
    manifest: {
        permissions: ['storage', 'alarms', 'contextMenus', 'offscreen'],
        content_security_policy: {
            extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
        },
        host_permissions: [
            'https://translate.google.com/*',
            'https://translate.google.co.uk/*',
            'https://translate.googleapis.com/*',
            'https://dev.microsofttranslator.com/*',
            'https://*.tts.speech.microsoft.com/*',
            'https://deeplx.1stg.me/*',
            'https://freeapi.fanyimao.cn/*',
            'https://api.deeplx.org/*',
            'http://localhost/*',
            'http://127.0.0.1/*',
            'http://*/*',
            'https://*/*',
        ],
    },

});
