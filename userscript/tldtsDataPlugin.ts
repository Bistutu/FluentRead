/**
 * @file userscript/tldtsDataPlugin.ts
 * 文件职责：只在 standalone 构建中无损压缩锁定 tldts 的公开后缀静态表。
 * 主要内容：白名单校验七项导出及字面量类型，保留数组顺序、整数、字符串和 typed array 构造器，同步还原数据。
 * 模块边界：不执行供应商源码，不改变域名解析算法；标准版与 Greasy Fork 不使用本插件，原模块 ID 保留许可归属。
 */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import ts from 'typescript';
import {normalizePath, type Plugin} from 'vite';

export function createUserscriptTldtsDataCompressionPlugin(root: string, enabled = true): Plugin {
    const sourcePath = normalizePath(fs.realpathSync(resolve(root, 'node_modules/tldts/dist/es6/src/data/trie.js')));
    const fields = new Map([
        ['nodeFlags', 'Uint8Array'], ['edgeStart', 'Uint16Array'], ['edgeLength', 'Uint8Array'],
        ['edgeChild', 'Uint16Array'], ['labelText', 'string'], ['rulesRoot', 'number'], ['exceptionsRoot', 'number'],
    ]);
    return {
        name: 'compress-userscript-tldts-data',
        enforce: 'pre',
        transform(code, id) {
            if (!enabled || normalizePath(id) !== sourcePath) return null;
            const source = ts.createSourceFile(sourcePath, code, ts.ScriptTarget.Latest, true);
            const names: string[] = [];
            const values: Array<number[] | string | number> = [];
            const unsupported = () => new Error('Userscript tldts data must match the seven literal-only public suffix exports');
            const diagnostics = ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ESNext}, reportDiagnostics: true}).diagnostics;
            if (diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw unsupported();
            const integer = (node: ts.Expression, maximum: number) => {
                if (!ts.isNumericLiteral(node)) throw unsupported();
                const value = Number(node.text);
                if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw unsupported();
                return value;
            };
            for (const statement of source.statements) {
                if (!ts.isVariableStatement(statement)
                    || statement.modifiers?.length !== 1 || statement.modifiers[0].kind !== ts.SyntaxKind.ExportKeyword
                    || !(statement.declarationList.flags & ts.NodeFlags.Const)
                    || statement.declarationList.declarations.length !== 1) throw unsupported();
                const declaration = statement.declarationList.declarations[0];
                if (!ts.isIdentifier(declaration.name) || !declaration.initializer || declaration.type) throw unsupported();
                const name = declaration.name.text, kind = fields.get(name), value = declaration.initializer;
                if (!kind || names.includes(name)) throw unsupported();
                names.push(name);
                if (kind === 'string') {
                    if (!ts.isStringLiteral(value)) throw unsupported();
                    values.push(value.text);
                } else if (kind === 'number') values.push(integer(value, Number.MAX_SAFE_INTEGER));
                else {
                    if (!ts.isNewExpression(value) || !ts.isIdentifier(value.expression) || value.expression.text !== kind
                        || value.typeArguments || value.arguments?.length !== 1 || !ts.isArrayLiteralExpression(value.arguments[0])) throw unsupported();
                    values.push(value.arguments[0].elements.map(node => integer(node, kind === 'Uint8Array' ? 255 : 65535)));
                }
            }
            if (names.length !== fields.size || names.some((name, index) => name !== [...fields.keys()][index])) throw unsupported();
            const compressed = gzipSync(Buffer.from(JSON.stringify(values)), {level: 9}).toString('base64');
            return {
                code: [
                    '/* Non-code tldts public suffix data; source sha256 ' + createHash('sha256').update(code).digest('hex') + '. */',
                    "import {inflateWithPako} from '@/userscript/pakoRuntime';",
                    'const bytes = Uint8Array.from(atob(' + JSON.stringify(compressed) + '), character => character.charCodeAt(0));',
                    'const suffixTables = JSON.parse(inflateWithPako(bytes));',
                    ...names.map((name, index) => 'export const ' + name + ' = ' +
                        (fields.get(name)!.startsWith('Uint') ? 'new ' + fields.get(name) + '(suffixTables[' + index + '])' : 'suffixTables[' + index + ']') + ';'),
                ].join('\n'),
                map: null,
            };
        },
    };
}
