/**
 * 审计生产源码对稳定 i18n key 的引用。Vue 模板和 TypeScript 使用各自语法树，
 * 只识别项目 i18n 导入及其绑定，不把注释、用户文本或普通同名函数当作资源调用。
 * 可枚举的条件与模板字面量展开检查；真正动态的 key 单独报告，交由业务状态测试验证。
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const {parse} = require(require.resolve('@vue/compiler-sfc', {paths: [path.dirname(require.resolve('vue/package.json'))]}));
const {parse: parseTemplate} = require(require.resolve('@vue/compiler-dom', {paths: [path.dirname(require.resolve('vue/package.json'))]}));

function unwrap(node) {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
        || ts.isNonNullExpression(node))) node = node.expression;
    return node;
}

function alternatives(node) {
    node = unwrap(node);
    if (!node) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isConditionalExpression(node)) {
        const left = alternatives(node.whenTrue), right = alternatives(node.whenFalse);
        if (!left || !right) return undefined;
        const values = [...new Set([...left, ...right])];
        return values.length <= 128 ? values : undefined;
    }
    if (ts.isTemplateExpression(node)) {
        let values = [node.head.text];
        for (const span of node.templateSpans) {
            const suffixes = alternatives(span.expression);
            if (!suffixes || values.length * suffixes.length > 128) return undefined;
            values = values.flatMap(value => suffixes.map(suffix => value + suffix + span.literal.text));
        }
        return values;
    }
    return undefined;
}

function objectKeys(node, undefinedIsMissing = true) {
    node = unwrap(node);
    if (!node || node.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(node)
        || (undefinedIsMissing && ts.isIdentifier(node) && node.text === 'undefined')) return [];
    if (!ts.isObjectLiteralExpression(node)) return undefined;
    const keys = [];
    for (const item of node.properties) {
        if ((!ts.isPropertyAssignment(item) && !ts.isShorthandPropertyAssignment(item))
            || (!ts.isIdentifier(item.name) && !ts.isStringLiteral(item.name))) return undefined;
        keys.push(item.name.text);
    }
    return keys;
}

function scope(parent, functionScope = false) {
    return {parent, functionScope, bindings: new Map()};
}

function lookup(current, name) {
    for (let owner = current; owner; owner = owner.parent) {
        if (owner.bindings.has(name)) return owner.bindings.get(name);
    }
    return undefined;
}

function bindingNames(node) {
    if (ts.isIdentifier(node)) return [node.text];
    if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
        return node.elements.flatMap(item => ts.isBindingElement(item) ? bindingNames(item.name) : []);
    }
    return [];
}

/** 只解析值声明的词法作用域，不建立 TypeScript Program，也不推断跨函数类型或别名。 */
function bindScopes(ast, rootScope, scopes, declarations) {
    function declare(node, name, owner) {
        const binding = {};
        owner.bindings.set(name, binding);
        if (!declarations.has(node)) declarations.set(node, new Map());
        declarations.get(node).set(name, binding);
    }
    function visit(node, parentScope) {
        if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) {
            declare(node, node.name.text, parentScope);
        }
        let current = parentScope;
        if (ts.isFunctionLike(node)) {
            current = scope(parentScope, true);
            if (ts.isFunctionExpression(node) && node.name) declare(node, node.name.text, current);
        } else if (ts.isBlock(node) || ts.isCaseBlock(node) || ts.isCatchClause(node)
            || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
            || ts.isClassExpression(node) || ts.isClassDeclaration(node)) {
            current = scope(parentScope);
            if (ts.isClassExpression(node) && node.name) declare(node, node.name.text, current);
        }
        scopes.set(node, current);
        if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
            let owner = current;
            if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)
                && !(node.parent.flags & ts.NodeFlags.BlockScoped)) {
                while (owner.parent && !owner.functionScope) owner = owner.parent;
            }
            for (const name of bindingNames(node.name)) declare(node, name, owner);
        } else if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            if (clause?.name) declare(node, clause.name.text, current);
            if (clause?.namedBindings) {
                const bindings = clause.namedBindings;
                if (ts.isNamespaceImport(bindings)) declare(node, bindings.name.text, current);
                else for (const binding of bindings.elements) declare(node, binding.name.text, current);
            }
        }
        ts.forEachChild(node, child => visit(child, current));
    }
    visit(ast, rootScope);
}

/** 收集源码实际调用；参数为 undefined 表示动态对象，不能仅凭静态信息判断缺参。 */
export function collectUiMessageReferences(root) {
    const references = [], dynamic = [];
    function scan(file) {
        const relative = path.relative(root, file), source = fs.readFileSync(file, 'utf8');
        const descriptor = file.endsWith('.vue') ? parse(source, {filename: file}).descriptor : undefined;
        const scripts = descriptor ? [descriptor.script, descriptor.scriptSetup].filter(Boolean).map(block => block.content) : [source];
        const rootScope = scope(undefined, true), scopes = new WeakMap(), declarations = new WeakMap();
        const asts = scripts.map(script => ts.createSourceFile(file + '.ts', script, ts.ScriptTarget.Latest, true));
        asts.forEach(ast => bindScopes(ast, rootScope, scopes, declarations));
        for (const ast of asts) for (const item of ast.statements) {
            if (!ts.isImportDeclaration(item) || !ts.isStringLiteral(item.moduleSpecifier) || item.importClause?.isTypeOnly) continue;
            const specifier = item.moduleSpecifier.text;
            const resolved = specifier.startsWith('@/') ? path.resolve(root, specifier.slice(2))
                : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : '';
            const module = resolved.replace(/(?:\/index)?\.ts$|\/index$/u, '');
            const core = module === path.join(root, 'src/core/i18n');
            const ui = module === path.join(root, 'src/ui/i18n');
            const bindings = item.importClause?.namedBindings;
            if (!bindings || !ts.isNamedImports(bindings)) continue;
            for (const imported of bindings.elements) {
                if (imported.isTypeOnly) continue;
                const name = imported.propertyName?.text ?? imported.name.text;
                const binding = declarations.get(item).get(imported.name.text);
                if (core && name === 'translate') binding.paramsIndex = 2;
                if (ui && name === 'useUiI18n') binding.factory = true;
            }
        }
        function bind(node) {
            const initializer = ts.isVariableDeclaration(node) && unwrap(node.initializer);
            if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
                && initializer && ts.isCallExpression(initializer)
                && ts.isIdentifier(initializer.expression) && lookup(scopes.get(node), initializer.expression.text)?.factory) {
                for (const item of node.name.elements) {
                    const name = item.propertyName && ts.isStringLiteral(item.propertyName)
                        ? item.propertyName.text : item.propertyName?.getText() ?? item.name.getText();
                    if (name === 't' && ts.isIdentifier(item.name)) {
                        declarations.get(node).get(item.name.text).paramsIndex = 1;
                    }
                }
            }
            ts.forEachChild(node, bind);
        }
        asts.forEach(bind);
        function visit(node, location) {
            const binding = ts.isCallExpression(node) && ts.isIdentifier(node.expression)
                ? lookup(scopes.get(node), node.expression.text) : undefined;
            if (binding?.paramsIndex !== undefined) {
                const keys = alternatives(node.arguments[0]);
                if (keys) references.push({file: relative, location, keys,
                    params: objectKeys(node.arguments[binding.paramsIndex], !lookup(scopes.get(node), 'undefined'))});
                else dynamic.push({file: relative, location, expression: node.arguments[0]?.getText() ?? ''});
            }
            ts.forEachChild(node, child => visit(child, location));
        }
        asts.forEach(ast => visit(ast, 'script'));
        if (descriptor?.template) {
            function expression(content, current) {
                const ast = ts.createSourceFile(file + '.template.ts', `(${content})`, ts.ScriptTarget.Latest, true);
                bindScopes(ast, scope(current), scopes, declarations);
                bind(ast);
                visit(ast, 'template');
            }
            function aliases(content, current) {
                const parameters = content.trim();
                const ast = ts.createSourceFile(file + '.alias.ts', `${parameters.startsWith('(') ? parameters : `(${parameters})`} => {}`, ts.ScriptTarget.Latest, true);
                const statement = ast.statements[0];
                if (!statement || !ts.isExpressionStatement(statement) || !ts.isArrowFunction(statement.expression)) return current;
                const local = scope(current);
                for (const parameter of statement.expression.parameters) for (const name of bindingNames(parameter.name)) local.bindings.set(name, {});
                return local;
            }
            function template(node, parent = rootScope) {
                let current = parent;
                for (const prop of node.props || []) {
                    if (prop.type !== 7 || !prop.exp) continue;
                    if (prop.name === 'for') {
                        const match = /^\s*(.*?)\s+(?:in|of)\s+([\s\S]+)$/u.exec(prop.exp.content);
                        if (match) {expression(match[2], parent); current = aliases(match[1], current);}
                    }
                }
                // 插槽参数仅属于插槽子树；组件自己的 prop 仍使用外层绑定。
                let children = current;
                for (const prop of node.props || []) {
                    if (prop.type === 7 && prop.name === 'slot' && prop.exp) children = aliases(prop.exp.content, children);
                }
                if (node.type === 4) expression(node.content, current);
                if (node.content && typeof node.content === 'object') template(node.content, current);
                if (node.exp && node.name !== 'for' && node.name !== 'slot') template(node.exp, current);
                if (node.arg && !node.arg.isStatic) template(node.arg, current);
                for (const child of node.children || []) template(child, children);
                for (const prop of node.props || []) {
                    // Vue 的 v-if 在同元素 v-for 之前求值，不能借循环别名掩盖实际资源调用。
                    if (prop.type === 7 && (prop.name === 'if' || prop.name === 'else-if')) template(prop, parent);
                    else if (prop.type !== 7 || (prop.name !== 'for' && prop.name !== 'slot')) template(prop, current);
                }
            }
            template(parseTemplate(descriptor.template.content));
        }
    }
    function walk(directory) {
        for (const item of fs.readdirSync(directory, {withFileTypes: true})) {
            const file = path.join(directory, item.name);
            if (item.isDirectory()) walk(file);
            else if (/\.(?:ts|vue)$/u.test(item.name) && !item.name.endsWith('.d.ts') && !file.includes(`${path.sep}i18n${path.sep}messages${path.sep}`)) scan(file);
        }
    }
    for (const directory of ['src', 'entrypoints', 'userscript']) {
        const absolute = path.join(root, directory);
        if (fs.existsSync(absolute)) walk(absolute);
    }
    return {references, dynamic};
}

export function auditUiMessageReferences(references, catalog) {
    const issues = [];
    for (const reference of references) for (const key of reference.keys) {
        const at = `${reference.file} (${reference.location}): ${key}`;
        if (!Object.hasOwn(catalog, key)) {issues.push(`${at} — unknown key`); continue;}
        if (!reference.params) continue;
        const required = [...new Set([...catalog[key].matchAll(/\{([a-zA-Z0-9_]+)\}/gu)].map(match => match[1]))];
        const missing = required.filter(name => !reference.params.includes(name));
        if (missing.length) issues.push(`${at} — missing parameters: ${missing.join(', ')}`);
    }
    return issues;
}
