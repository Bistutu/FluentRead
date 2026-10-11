/**
 * @file tests/userscriptTldtsData.test.ts
 * 文件职责：验证 standalone 的公开后缀表压缩逐字保留锁定 tldts 的真实数据与构造器。
 * 主要内容：从真实 ESM 数据取基线，通过 Vite 编译生成模块并使用真实 bundled pako 还原七项导出；拒绝可执行、类型变化及不完整的输入，标准版和 Greasy Fork 不转换该模块。
 * 模块边界：不模拟域名解析结果，不调用浏览器或网络，也不执行拒绝用例中的供应商源码。
 */
import {readFileSync, realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {transformWithEsbuild} from 'vite';
import {inflateWithPako} from '@/userscript/pakoBundled';
import {createUserscriptTldtsDataCompressionPlugin} from '@/userscript/tldtsDataPlugin';

const root = process.cwd();
const sourcePath = realpathSync(resolve(root, 'node_modules/tldts/dist/es6/src/data/trie.js'));
const originalSource = readFileSync(sourcePath, 'utf8');
const lockedSourceSha256 = '69d3a276aabe4a4e240b94c7a1634bbe925d87bc4619d2669b5a0c8764a2f6f0';
const fields = ['nodeFlags', 'edgeStart', 'edgeLength', 'edgeChild', 'labelText', 'rulesRoot', 'exceptionsRoot'] as const;
type TrieData = {
    nodeFlags: Uint8Array;
    edgeStart: Uint16Array;
    edgeLength: Uint8Array;
    edgeChild: Uint16Array;
    labelText: string;
    rulesRoot: number;
    exceptionsRoot: number;
};
const createPlugin = (enabled = true) => createUserscriptTldtsDataCompressionPlugin(root, enabled) as unknown as {
    transform: (code: string, id: string) => {code: string; map: null} | null;
};
const fixture = [
    'export const nodeFlags = new Uint8Array([1, 2]);',
    'export const edgeStart = new Uint16Array([0, 2]);',
    'export const edgeLength = new Uint8Array([3]);',
    'export const edgeChild = new Uint16Array([0]);',
    'export const labelText = "com";',
    'export const rulesRoot = 0;',
    'export const exceptionsRoot = 1;',
].join('\n');
let original: TrieData;

beforeAll(async () => {
    // 引用模块只在已核实的安装字节上执行；拒绝样例永远只交给 AST 解析器。
    if (createHash('sha256').update(originalSource).digest('hex') !== lockedSourceSha256) {
        throw new Error('Installed tldts suffix data no longer matches the locked audit source');
    }
    original = await import(/* @vite-ignore */ pathToFileURL(sourcePath).href) as TrieData;
});
afterEach(() => {vi.unstubAllEnvs(); vi.resetModules();});

describe('standalone lossless public suffix tables', () => {
    it('binds the real installed data to the locked package manifest and source digest', () => {
        const manifest = JSON.parse(readFileSync(resolve(root, 'node_modules/tldts/package.json'), 'utf8'));
        expect({name: manifest.name, version: manifest.version, license: manifest.license})
            .toEqual({name: 'tldts', version: '7.4.10', license: 'MIT'});
        expect(createHash('sha256').update(originalSource).digest('hex')).toBe(lockedSourceSha256);
        expect(Object.keys(original).sort()).toEqual([...fields].sort());
    });

    it('restores all seven real ESM exports with exact constructors, array bytes, string and declaration order', async () => {
        const transformed = createPlugin().transform(originalSource, sourcePath)!;
        expect(transformed).not.toBeNull();
        const exportedNames = [...transformed.code.matchAll(/export const ([A-Za-z]+) =/gu)].map(match => match[1]);
        expect(exportedNames).toEqual(fields);
        const generated = transformed.code.replace("import {inflateWithPako} from '@/userscript/pakoRuntime';", '');
        const compiled = await transformWithEsbuild(generated, 'tldts-suffix-data-fixture.js', {format: 'cjs', target: 'es2018'});
        const realm = {
            module: {exports: {} as TrieData},
            atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
            Uint8Array: original.nodeFlags.constructor,
            Uint16Array: original.edgeStart.constructor,
            inflateWithPako,
        };
        runInNewContext(compiled.code, realm, {timeout: 5000});
        const restored = realm.module.exports;
        expect(Object.keys(restored).sort()).toEqual(Object.keys(original).sort());
        for (const name of ['nodeFlags', 'edgeStart', 'edgeLength', 'edgeChild'] as const) {
            const actual = restored[name], expected = original[name];
            expect(actual.constructor).toBe(expected.constructor);
            expect(actual.byteOffset).toBe(expected.byteOffset);
            expect(actual.length).toBe(expected.length);
            expect(Array.from(actual)).toEqual(Array.from(expected));
            expect(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength))
                .toEqual(Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength));
        }
        expect(restored.labelText).toBe(original.labelText);
        expect(restored.rulesRoot).toBe(original.rulesRoot);
        expect(restored.exceptionsRoot).toBe(original.exceptionsRoot);
    });

    it.each(['standard', 'greasyfork'] as const)('keeps the actual %s build configuration outside the suffix-table transform', async mode => {
        vi.stubEnv('FLUENTREAD_USERSCRIPT_STANDALONE', '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', mode === 'greasyfork' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_VENDOR_URL', 'https://fixture.invalid/vendor.js');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_DATA_URL', 'https://fixture.invalid/data.js');
        vi.resetModules();
        const {default: config} = await import('@/userscript/vite.config');
        const plugin = (config.plugins as Array<{name: string; transform?: Function | {handler: Function}}>)
            .find(item => item.name === 'compress-userscript-tldts-data')!;
        const transform = typeof plugin.transform === 'function' ? plugin.transform : plugin.transform!.handler;
        expect(await Reflect.apply(transform, {}, [originalSource, sourcePath])).toBeNull();
    });

    it('leaves the original domain-parser entry and unrelated package modules untouched', () => {
        const entryPath = realpathSync(resolve(root, 'node_modules/tldts/dist/es6/index.js'));
        expect(createPlugin().transform(readFileSync(entryPath, 'utf8'), entryPath)).toBeNull();
        expect(createPlugin().transform(originalSource, sourcePath + '?raw')).toBeNull();
    });

    it.each([
        ['call', fixture.replace('new Uint8Array([1, 2])', 'Uint8Array([1, 2])')],
        ['call inside a field', fixture.replace('rulesRoot = 0', 'rulesRoot = executable()')],
        ['spread', fixture.replace('[1, 2]', '[...[1, 2]]')],
        ['uint8 overflow', fixture.replace('[1, 2]', '[256]')],
        ['uint16 overflow', fixture.replace('new Uint16Array([0, 2])', 'new Uint16Array([65536])')],
        ['negative integer', fixture.replace('[1, 2]', '[-1]')],
        ['sparse array', fixture.replace('[1, 2]', '[1, , 2]')],
        ['missing export', fixture.split('\n').slice(1).join('\n')],
        ['extra export', fixture + '\nexport const unexpected = 0;'],
        ['duplicate export', fixture + '\nexport const rulesRoot = 0;'],
        ['reordered exports', [fixture.split('\n')[1], fixture.split('\n')[0], ...fixture.split('\n').slice(2)].join('\n')],
        ['mutable declaration', fixture.replace('export const nodeFlags', 'export let nodeFlags')],
        ['different constructor', fixture.replace('new Uint8Array([1, 2])', 'new Uint16Array([1, 2])')],
        ['computed constructor', fixture.replace('new Uint8Array([1, 2])', 'new globalThis.Uint8Array([1, 2])')],
        ['extra constructor argument', fixture.replace('new Uint8Array([1, 2])', 'new Uint8Array([1, 2], 0)')],
        ['declaration type', fixture.replace('nodeFlags =', 'nodeFlags: Uint8Array =')],
        ['incorrect field type', fixture.replace('labelText = "com"', 'labelText = 1')],
        ['executable statement', fixture + '\nexecutable();'],
        ['invalid bracket syntax', fixture.replace('[1, 2])', '[1, 2)')],
    ] as const)('rejects %s without evaluating the supplied source', (_kind, source) => {
        expect(() => createPlugin().transform(source, sourcePath)).toThrow(/seven literal-only public suffix exports|syntax/iu);
    });
});
