/**
 * @file userscript/characterDataPlugin.ts
 * 文件职责：在 userscript 构建期无损压缩语言识别的静态字符串数据，保留共享 core 的原始导出契约。
 * 主要内容：复用同一 AST 白名单解析两份导出 const 字符串；非 GF 保持相邻码点或原字符串 gzip，GF 从固定的明文 JSON 资源同步恢复。
 * 模块边界：不压缩可执行源码，不修改生成文件；Greasy Fork 保留可读数据，扩展不使用本插件。
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import ts from 'typescript';
import {normalizePath, type Plugin} from 'vite';

export type UserscriptCharacterDataResource = Record<'chineseVariants' | 'functionWordData', Record<string, string>>;

function characterDataSources(root: string) {
    return new Map<string, {key: keyof UserscriptCharacterDataResource; mode: 'delta' | 'strings'}>([
        [normalizePath(resolve(root, 'src/core/language/chineseVariants.ts')), {key: 'chineseVariants', mode: 'delta'}],
        [normalizePath(resolve(root, 'src/core/language/functionWordData.ts')), {key: 'functionWordData', mode: 'strings'}],
    ]);
}

/** 压缩模块和 GF 明文资源共用唯一白名单；不执行源码，不接受逻辑或重复导出。 */
export function parseUserscriptCharacterData(code: string, id: string) {
    const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
    const names: string[] = [];
    const strings: string[] = [];
    const unsupported = () => new Error('Userscript language data must contain only exported const strings');
    if ((source as ts.SourceFile & {parseDiagnostics: readonly ts.Diagnostic[]}).parseDiagnostics.length) throw unsupported();
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)
            || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
            || !(statement.declarationList.flags & ts.NodeFlags.Const)) throw unsupported();
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer
                || !(ts.isStringLiteral(declaration.initializer) || ts.isNoSubstitutionTemplateLiteral(declaration.initializer))
                || names.includes(declaration.name.text)) throw unsupported();
            names.push(declaration.name.text);
            strings.push(declaration.initializer.text);
        }
    }
    if (!names.length) throw unsupported();
    return {source, names, strings};
}

/** 仅生成普通对象给 GF data asset；JSON 序列化由已有资源出口执行，保留原名和顺序。 */
export function readUserscriptCharacterDataResource(root: string): UserscriptCharacterDataResource {
    return Object.fromEntries([...characterDataSources(root)].map(([id, definition]) => {
        const {names, strings} = parseUserscriptCharacterData(readFileSync(id, 'utf8'), id);
        return [definition.key, Object.fromEntries(names.map((name, index) => [name, strings[index]]))];
    })) as UserscriptCharacterDataResource;
}

/** true: 原压缩出口；false: 不转换；resource: GF 固定明文资源，不压缩产品代码。 */
export function createUserscriptCharacterDataCompressionPlugin(root: string, enabled: boolean | 'resource' = true): Plugin {
    const sources = characterDataSources(root);
    return {
        name: 'compress-userscript-character-data',
        enforce: 'pre',
        transform(code, id) {
            const sourcePath = normalizePath(id.split('?')[0]);
            const definition = sources.get(sourcePath);
            if (enabled === false || !definition) return null;
            const {source, names, strings} = parseUserscriptCharacterData(code, sourcePath);
            const digest = createHash('sha256').update(code).digest('hex');
            if (enabled === 'resource') {
                return {
                    code: [
                        code.slice(0, source.statements[0].getStart(source)),
                        '/* Non-code language data; source sha256 ' + digest + '. */',
                        `const characterData = globalThis.__FLUENTREAD_USERSCRIPT_DATA__?.characterData?.${definition.key};`,
                        `if (!characterData || ${JSON.stringify(names)}.some(name => typeof characterData[name] !== 'string')) {`,
                        `    throw new Error("Missing pinned userscript character data: ${definition.key}");`,
                        '}',
                        ...names.map((name) => `export const ${name} = characterData[${JSON.stringify(name)}];`),
                    ].join('\n'),
                    map: null,
                };
            }
            const mode = definition.mode;
            const tables: Array<number[] | string> = strings.map(value => {
                if (mode === 'strings') return value;
                let previous = 0;
                return Array.from(value, (character) => {
                    const point = character.codePointAt(0)!;
                    const delta = point - previous;
                    previous = point;
                    return delta;
                });
            });
            const compressed = gzipSync(Buffer.from(JSON.stringify(tables)), {level: 9}).toString('base64');
            return {
                code: [
                    code.slice(0, source.statements[0].getStart(source)),
                    '/* Non-code language data; source sha256 ' + digest + '. */',
                    "import {inflateWithPako} from '@/userscript/pakoRuntime';",
                    'const bytes = Uint8Array.from(atob(' + JSON.stringify(compressed) + '), (character) => character.charCodeAt(0));',
                    ...(mode === 'strings' ? ['const characterTables = JSON.parse(inflateWithPako(bytes));'] : [
                        'const characterTables = JSON.parse(inflateWithPako(bytes)).map((deltas) => {',
                        '    let point = 0;',
                        '    return deltas.map((delta) => {',
                        '        point += delta;',
                        // fromCharCode 避免给旧内核新增 String.fromCodePoint 依赖；完整保留补充平面字符。
                        '        return point > 0xFFFF',
                        '            ? String.fromCharCode(0xD800 + ((point - 0x10000) >> 10), 0xDC00 + ((point - 0x10000) & 0x3FF))',
                        '            : String.fromCharCode(point);',
                        "    }).join('');",
                        '});',
                    ]),
                    ...names.map((name, index) => 'export const ' + name + ' = characterTables[' + index + '];'),
                ].join('\n'),
                map: null,
            };
        },
    };
}
