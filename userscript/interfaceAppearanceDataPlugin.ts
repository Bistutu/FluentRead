/**
 * @file userscript/interfaceAppearanceDataPlugin.ts
 * 文件职责：仅在 userscript 构建期无损压缩皮肤与字体的纯数据注册表。
 * 主要内容：匹配唯一物理模块及两个具名导出 const，严格读取字面量 AST，以既有 gzip/pako 同步还原全部字段、值和枚举顺序；遇调用、展开、动态键或重复声明拒绝构建。
 * 模块边界：不改共享配置源码、类型或归一化逻辑，不压缩可执行代码；Greasy Fork 沿用可读数据，扩展构建不使用本插件，不引入网络或新的解码依赖。
 */
import {resolve} from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';
import ts from 'typescript';
import {normalizePath, type Plugin} from 'vite';

const registryNames = ['interfaceSkinOptions', 'interfaceFontOptions'] as const;

/** 保留原模块求值时序：原来的两张 const 表在同一位置同步恢复，再由既有 Map 和函数消费。 */
export function createUserscriptInterfaceAppearanceDataPlugin(root: string, enabled = false): Plugin {
    const sourcePath = normalizePath(resolve(root, 'src/core/config/interfaceAppearance.ts'));
    return {
        name: 'compress-userscript-interface-appearance-data',
        enforce: 'pre',
        transform(code, id) {
            if (!enabled || normalizePath(id) !== sourcePath) return null;
            const unsupported = () => new Error('Userscript appearance registries must be unique exported const literal arrays');
            const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
            const declarations = new Map<string, ts.VariableDeclaration>();
            for (const statement of source.statements) {
                if (!ts.isVariableStatement(statement)) continue;
                for (const declaration of statement.declarationList.declarations) {
                    if (!ts.isIdentifier(declaration.name) || !registryNames.includes(declaration.name.text as typeof registryNames[number])) continue;
                    if (declarations.has(declaration.name.text) || !declaration.initializer
                        || !(statement.declarationList.flags & ts.NodeFlags.Const)
                        || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) throw unsupported();
                    declarations.set(declaration.name.text, declaration);
                }
            }
            if (declarations.size !== registryNames.length) throw unsupported();
            function literal(node: ts.Expression): unknown {
                if (ts.isAsExpression(node)) return literal(node.expression);
                if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
                if (ts.isNumericLiteral(node) && Number.isFinite(Number(node.text))) return Number(node.text);
                if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
                if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
                if (node.kind === ts.SyntaxKind.NullKeyword) return null;
                if (ts.isArrayLiteralExpression(node)) return node.elements.map(element => literal(element as ts.Expression));
                if (ts.isObjectLiteralExpression(node)) {
                    const value: Record<string, unknown> = {};
                    for (const property of node.properties) {
                        if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
                            || property.name.text === '__proto__' || Object.hasOwn(value, property.name.text)) throw unsupported();
                        value[property.name.text] = literal(property.initializer);
                    }
                    return value;
                }
                throw unsupported();
            }
            let transformed = code;
            const ordered = [...declarations.values()].sort((left, right) => right.pos - left.pos);
            for (const declaration of ordered) {
                const initializer = declaration.initializer!;
                const value = literal(initializer);
                if (!Array.isArray(value) || value.length === 0) throw unsupported();
                const json = JSON.stringify(value);
                const compressed = gzipSync(Buffer.from(json, 'utf8'), {level: 9});
                // 字节往返同时约束对象字段顺序、数组顺序及所有 JSON 值，不借助执行原始源码求值。
                if (JSON.stringify(JSON.parse(gunzipSync(compressed).toString('utf8'))) !== json) throw unsupported();
                const restored = `JSON.parse(__fluentReadAppearanceInflate(Uint8Array.from(atob(${JSON.stringify(compressed.toString('base64'))}), character => character.charCodeAt(0))))`;
                transformed = transformed.slice(0, initializer.getStart(source)) + restored + transformed.slice(initializer.end);
            }
            const importCode = "import {inflateWithPako as __fluentReadAppearanceInflate} from '@/userscript/pakoRuntime';\n";
            // 放在首个实际语句前，保留共享模块的文件注释与其余声明源码。
            const firstStatement = source.statements[0].getStart(source);
            return {code: transformed.slice(0, firstStatement) + importCode + transformed.slice(firstStatement), map: null};
        },
    };
}
