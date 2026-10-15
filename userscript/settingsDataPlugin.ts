/**
 * @file userscript/settingsDataPlugin.ts
 * 文件职责：在 userscript 构建时无损压缩固定设置数据，完整设置版再压缩学习与目标语言目录。
 * 主要内容：只从指定 const 的字面量 AST 读取 JSON 类型，拒绝计算、重复键和特殊原型键；原地替换初始化值，同步还原所有文本、类型和顺序。
 * 模块边界：不执行源模块、不压缩可执行逻辑，不改远程语言资源；标准版只压缩完整消费的样式表，避免目录表示阻止原有裁剪；沿用 pako，消费函数保持原实现。
 */
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import ts from 'typescript';
import {normalizePath, type Plugin} from 'vite';

type Json = string | number | boolean | null | Json[] | {[key: string]: Json};

function literal(node: ts.Expression): Json {
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) {
        const value = Number(node.text);
        if (Number.isFinite(value)) return value;
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(element => literal(element));
    if (ts.isObjectLiteralExpression(node)) {
        const result: {[key: string]: Json} = {};
        for (const property of node.properties) {
            if (!ts.isPropertyAssignment(property)
                || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name))) {
                throw new Error('Standalone settings data requires literal object properties');
            }
            const key = ts.isNumericLiteral(property.name) ? String(Number(property.name.text)) : property.name.text;
            if (key === '__proto__' || Object.prototype.hasOwnProperty.call(result, key)) {
                throw new Error('Standalone settings data contains a duplicate or prototype key');
            }
            Object.defineProperty(result, key, {value: literal(property.initializer), enumerable: true});
        }
        return result;
    }
    throw new Error('Standalone settings data requires JSON literals');
}

export function createUserscriptSettingsDataPlugin(root: string, enabled: boolean, fullOptions = true): Plugin {
    const targets = new Map([
        [normalizePath(resolve(root, 'src/core/config/translationAppearance.ts')), 'TRANSLATION_STYLE_PRESETS'],
    ]);
    if (fullOptions) {
        targets.set(normalizePath(resolve(root, 'src/core/harness/promptLocales.ts')), 'HARNESS_TRANSLATED_PROMPTS');
        targets.set(normalizePath(resolve(root, 'src/core/config/catalog.ts')), 'localizedTargetLanguageLabels');
    }
    return {
        name: 'standalone-settings-data', enforce: 'pre',
        transform(code, id) {
            const target = targets.get(normalizePath(id.split('?')[0]));
            if (!enabled || !target) return null;
            const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
            // TypeScript 会恢复部分错误语法；先拒绝诊断，不能把损坏源码重新编码成合法数据。
            if ((source as ts.SourceFile & {parseDiagnostics: readonly ts.Diagnostic[]}).parseDiagnostics.length) {
                throw new Error('Standalone settings data source has syntax errors');
            }
            const declarations = source.statements.filter(ts.isVariableStatement)
                .flatMap(statement => [...statement.declarationList.declarations]
                    .filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === target)
                    .map(declaration => ({declaration, constant: Boolean(statement.declarationList.flags & ts.NodeFlags.Const)})));
            const entry = declarations[0];
            if (declarations.length !== 1 || !entry.constant || !entry.declaration.initializer
                || code.includes('__fluentreadInflateSettingsData')) throw new Error(`Standalone settings data declaration changed: ${target}`);
            const initializer = entry.declaration.initializer;
            const compressed = gzipSync(Buffer.from(JSON.stringify(literal(initializer))), {level: 9}).toString('base64');
            // 和原字面量一样，未被消费的表不应触发还原；整个闭包只还原固定数据，无外部写入。
            const value = `/* @__PURE__ */ (() => JSON.parse(__fluentreadInflateSettingsData(Uint8Array.from(atob(${JSON.stringify(compressed)}), character => character.charCodeAt(0)))))()`;
            return {code: "import {inflateWithPako as __fluentreadInflateSettingsData} from '@/userscript/pakoRuntime';\n"
                + code.slice(0, initializer.getStart(source)) + value + code.slice(initializer.end), map: null};
        },
    };
}
