/**
 * Vue 验证归属门禁：真实组件消费者、无状态展示例外与冻结的历史债务分别登记。
 * 本模块审计证据路径与源码边界，不把构建、源码名称出现或被 mock 的 SFC 当作行为证明。
 */
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import ts from 'typescript';
import {parse} from 'vue/compiler-sfc';
import {buildDependencyGraph} from '../../scripts/testing/run-affected-tests.mjs';

export type VueOwner =
    | {kind: 'behavior'; tests: string[]; scenario: string}
    | {kind: 'presentation' | 'composition'; reason: string}
    | {kind: 'frozen-debt'; sourceSha256: string; reason: string; exitCriteria: string; browser?: {runner: string; scope: string; limitation: string}};

export function sourceHash(source: string): string {
    return createHash('sha256').update(source).digest('hex');
}

function literalData(node: ts.Expression): boolean {
    if (ts.isLiteralExpression(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
        || node.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isArrayLiteralExpression(node)) return node.elements.every(literalData);
    return ts.isObjectLiteralExpression(node) && node.properties.every(item => ts.isPropertyAssignment(item) && literalData(item.initializer));
}

/** 展示例外只接收 props/静态常量/组件 import；状态、方法、watch、异步和模板事件均须行为 owner。 */
export function isDeclarativeVue(source: string, filename: string): boolean {
    const parsed = parse(source, {filename});
    if (parsed.errors.length || parsed.descriptor.script?.src || parsed.descriptor.scriptSetup?.src) return false;
    const script = [parsed.descriptor.script?.content, parsed.descriptor.scriptSetup?.content].filter(Boolean).join('\n');
    const ast = ts.createSourceFile(filename, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const macro = (node: ts.Expression) => ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && ['defineProps', 'defineOptions', 'defineEmits'].includes(node.expression.text)
        && node.arguments.every(literalData);
    const declarative = ast.statements.every(statement => {
        if (ts.isImportDeclaration(statement)) return statement.importClause?.isTypeOnly
            || (ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.endsWith('.vue'));
        if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEmptyStatement(statement)) return true;
        if (ts.isExpressionStatement(statement)) return macro(statement.expression);
        return ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
            && statement.declarationList.declarations.every(item => item.initializer && (macro(item.initializer) || literalData(item.initializer)));
    });
    if (!declarative) return false;
    // 编译器提供的 template AST 逐表达式检查，避免把模板内 fetch()/赋值/函数藏进展示例外。
    const visit = (node: unknown): boolean => {
        if (!node || typeof node !== 'object') return true;
        const value = node as {type?: number; name?: string; isStatic?: boolean; content?: unknown; children?: unknown[]; props?: unknown[]; exp?: unknown; arg?: unknown};
        if (value.type === 7 && !['bind', 'if', 'else-if', 'else', 'for', 'show', 'slot', 'pre', 'cloak', 'once', 'memo', 'text'].includes(value.name ?? '')) return false;
        if (value.type === 4 && !value.isStatic && typeof value.content === 'string') {
            const expression = ts.createSourceFile('template.ts', '(' + value.content + ')', ts.ScriptTarget.Latest, true);
            let safe = true;
            const check = (item: ts.Node) => {
                if (ts.isCallExpression(item) || ts.isNewExpression(item) || ts.isFunctionLike(item) || ts.isAwaitExpression(item)
                    || ts.isPostfixUnaryExpression(item) || ts.isPrefixUnaryExpression(item) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(item.operator)
                    || ts.isBinaryExpression(item) && item.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
                        && item.operatorToken.kind <= ts.SyntaxKind.LastAssignment) safe = false;
                ts.forEachChild(item, check);
            };
            check(expression);
            if (!safe) return false;
        }
        return [...value.children ?? [], ...value.props ?? [], value.exp, value.arg,
            typeof value.content === 'object' ? value.content : undefined].every(visit);
    };
    return visit(parsed.descriptor.template?.ast);
}

function runtimeConsumer(source: string, component: string, filename: string): boolean {
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let runtime = false, assertion = false, mocked = false, actual = false;
    let loader = false, compiled = false, setup = false, effect = false, materialized = false, executedCompiled = false;
    const imported = new Set<string>();
    const normalize = (value: string) => value.startsWith('@/') ? value.slice(2) : value.startsWith('/src/') ? value.slice(1)
        : value.startsWith('.') ? posix.normalize(posix.join(posix.dirname(filename), value)) : value;
    for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
            || normalize(statement.moduleSpecifier.text) !== component || statement.importClause?.isTypeOnly) continue;
        const clause = statement.importClause;
        if (clause?.name) imported.add(clause.name.text);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
            clause.namedBindings.elements.filter(item => !item.isTypeOnly).forEach(item => imported.add(item.name.text));
    }
    // 正常 SFC 测试可能先为同一组件选择实际模板或 setup-only renderer，再交给 h。
    // 只沿词法作用域内的 const 透明别名/展开追踪；属性引用、任意工厂和可变绑定不能作为证据。
    const bindings = new Map<ts.Node, Map<string, ts.VariableDeclaration>>();
    const collectBindings = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            let scope: ts.Node | undefined = node.parent;
            while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isFunctionLike(scope)) scope = scope.parent;
            if (scope) {
                if (!bindings.has(scope)) bindings.set(scope, new Map());
                bindings.get(scope)!.set(node.name.text, node);
            }
        }
        ts.forEachChild(node, collectBindings);
    };
    collectBindings(ast);
    const componentReference = (node: ts.Node, seen = new Set<ts.Node>()): boolean => {
        if (seen.has(node)) return false;
        const nextSeen = new Set(seen).add(node);
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return componentReference(node.expression, nextSeen);
        if (ts.isConditionalExpression(node)) return componentReference(node.whenTrue, nextSeen) || componentReference(node.whenFalse, nextSeen);
        if (ts.isObjectLiteralExpression(node)) return node.properties.some(item => ts.isSpreadAssignment(item) && componentReference(item.expression, nextSeen));
        if (!ts.isIdentifier(node)) return false;
        for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
            if (ts.isFunctionLike(scope) && scope.parameters.some(item => ts.isIdentifier(item.name) && item.name.text === node.text)) return false;
            const declaration = bindings.get(scope)?.get(node.text);
            if (declaration) return ts.isVariableDeclarationList(declaration.parent) && (declaration.parent.flags & ts.NodeFlags.Const) !== 0
                && Boolean(declaration.initializer && componentReference(declaration.initializer, nextSeen));
        }
        return imported.has(node.text);
    };
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
            const name = ts.isIdentifier(node.expression) ? node.expression.text
                : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
            if (/^(?:mount\w*|render\w*|loadClient|compileClient|compileVue\w*|createApp|createSSRApp|createRenderer|ssrLoadModule)$/u.test(name)) runtime = true;
            if (name === 'ssrLoadModule' || /^compileVue\w*$/u.test(name)) loader = true;
            if (name === 'compileScript') compiled = true;
            if (ts.isNewExpression(node.expression) && ts.isIdentifier(node.expression.expression)
                && node.expression.expression.text === 'Function') executedCompiled = true;
            if (name === 'setup') setup = true;
            if (name === 'effectScope') effect = true;
            if (/^(?:mount\w*|createApp|createSSRApp|h|createVNode)$/u.test(name)) {
                const find = (argument: ts.Node) => {
                    if (ts.isIdentifier(argument) && componentReference(argument)) materialized = true;
                    ts.forEachChild(argument, find);
                };
                node.arguments.forEach(find);
            }
            if (name === 'expect') assertion = true;
            const argument = node.arguments[0];
            if (argument && ts.isStringLiteralLike(argument) && normalize(argument.text) === component) {
                if (node.expression.kind === ts.SyntaxKind.ImportKeyword) loader = true;
                if (['mock', 'doMock'].includes(name)) mocked = true;
                if (name === 'importActual') actual = true;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
    return assertion && (!mocked || actual)
        && (runtime && (materialized || loader || actual || compiled && executedCompiled)
            || compiled && executedCompiled && setup && effect);
}

export function auditVueOwners(input: {
    components: Record<string, string>; records: Record<string, VueOwner>; strictCoverage: Set<string>;
    tests: Record<string, string>; matrixTests: Set<string>; knownFiles: Set<string>; baselineBlobs: Record<string, string>;
}): string[] {
    const {components, records, strictCoverage, tests, matrixTests, knownFiles} = input;
    const errors: string[] = [];
    const graph = buildDependencyGraph({...components, ...tests});
    const reaches = (test: string, component: string) => {
        const pending = [test], seen = new Set(pending);
        for (let index = 0; index < pending.length; index++) {
            for (const path of graph.get(pending[index]) ?? []) {
                if (path === component) return true;
                if (!seen.has(path)) {seen.add(path);pending.push(path);}
            }
        }
        return false;
    };
    for (const path of Object.keys(records)) {
        if (!Object.hasOwn(components, path)) errors.push(`${path}: Vue 归属记录引用不存在的组件`);
        if (strictCoverage.has(path)) errors.push(`${path}: 已有严格覆盖，不应保留重复例外`);
    }
    for (const [path, source] of Object.entries(components)) {
        if (strictCoverage.has(path)) continue;
        const owner = records[path];
        if (!owner) {errors.push(`${path}: Vue 业务组件缺少真实行为验证归属，build 不替代行为`);continue;}
        if (owner.kind === 'behavior') {
            if (!owner.scenario.trim() || !owner.tests.length) errors.push(`${path}: 行为 owner 必须说明场景并登记测试`);
            for (const test of owner.tests) {
                if (!matrixTests.has(test) || !Object.hasOwn(tests, test)) errors.push(`${path}: 行为测试未实际登记 ${test}`);
                else if (!runtimeConsumer(tests[test], path, test) || !reaches(test, path)) errors.push(`${path}: ${test} 不是可追踪的实际组件消费者`);
            }
        } else if (owner.kind === 'presentation' || owner.kind === 'composition') {
            if (!owner.reason.trim() || !isDeclarativeVue(source, path)) errors.push(`${path}: 展示/组装例外增加了可执行行为，必须登记行为 owner`);
        } else if (owner.kind === 'frozen-debt') {
            if (!owner.reason.trim() || !owner.exitCriteria.trim()) errors.push(`${path}: 冻结债务缺少原因或迁出条件`);
            if (sourceHash(source) !== owner.sourceSha256) errors.push(`${path}: 历史 Vue 债务源码已变化，必须迁出到真实行为 owner`);
            const blob = createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex');
            if (blob !== input.baselineBlobs[path]) errors.push(`${path}: 冻结例外只接纳固定历史基线，不能重新冻结修改后的组件或新增组件`);
            if (owner.browser && (!knownFiles.has(owner.browser.runner) || !owner.browser.scope.trim() || !owner.browser.limitation.trim()))
                errors.push(`${path}: 历史浏览器专项必须是存在的入口，并明确场景与证据限制`);
        } else errors.push(`${path}: 未知 Vue 归属类型`);
    }
    return errors;
}
