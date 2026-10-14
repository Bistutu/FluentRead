/**
 * @file tests/helpers/compiledVueFixture.ts
 * 文件职责：复用真实 Vue 组件夹具的纯编译结果，减少同一测试文件内的重复 SFC 编译。
 * 主要内容：按绝对路径、源码内容与编译选项缓存不可变脚本源码、JavaScript/CSS 字符串、运行时导入来源与冻结诊断列表；源码变化立即重新编译。
 * 模块边界：不缓存已执行的模块、render 函数、Vue 实例、模拟端口或 DOM；调用者仍须逐次执行并清理夹具。
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {compileScript, compileStyle, compileTemplate, parse} from 'vue/compiler-sfc';
import ts from 'typescript';

type CompileOptions = {
  id: string;
  cacheHandlers?: boolean;
  includeScript?: boolean;
  includeScopedStyle?: boolean;
};
type CompiledVueFixture = Readonly<{scriptSource: string; templateErrors: Readonly<ReturnType<typeof compileTemplate>['errors']>;
  renderCode: string; scriptCode: string; styleCode: string}>;
type InlineCompileOptions = {
  id: string;
  module?: ts.ModuleKind.CommonJS | ts.ModuleKind.ESNext;
  scriptReplacements?: ReadonlyArray<readonly [string, string]>;
};
type CompiledVueInlineFixture = Readonly<{
  scriptSource: string;
  code: string;
  parseErrors: Readonly<ReturnType<typeof parse>['errors']>;
  runtimeImports: ReadonlyArray<string>;
}>;
const compilations = new Map<string, {source: string; result: CompiledVueFixture}>();
const inlineCompilations = new Map<string, {source: string; result: CompiledVueInlineFixture}>();
// Vitest 默认逐文件隔离；额外限制缓存，避免 watch 模式或复用此 helper 的工具无限保留编译产物。
const maxCachedCompilations = 32;

function assertCompiled(filename: string, errors: ReadonlyArray<unknown>): void {
  if (errors.length) throw new Error(`Vue fixture compilation failed (${filename}): ${errors.map(String).join('; ')}`);
}

export function compileVueFixture(filename: string, options: CompileOptions): CompiledVueFixture {
  const absoluteFilename = resolve(filename), source = readFileSync(absoluteFilename, 'utf8');
  const {id, cacheHandlers = false, includeScript = false, includeScopedStyle = false} = options;
  const key = JSON.stringify([absoluteFilename, id, cacheHandlers, includeScript, includeScopedStyle]);
  const cached = compilations.get(key);
  if (cached?.source === source) return cached.result;

  const parsed = parse(source, {filename: absoluteFilename});
  assertCompiled(absoluteFilename, parsed.errors);
  const script = compileScript(parsed.descriptor, {id});
  if (!parsed.descriptor.template) throw new Error(`Vue fixture has no template (${absoluteFilename})`);
  const template = compileTemplate({source: parsed.descriptor.template.content, filename: absoluteFilename, id,
    compilerOptions: {mode: 'function', cacheHandlers, bindingMetadata: script.bindings, expressionPlugins: ['typescript']}});
  assertCompiled(absoluteFilename, template.errors);
  const templateErrors = Object.freeze(template.errors);
  const renderCode = ts.transpileModule(template.code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  const scriptCode = includeScript ? ts.transpileModule(script.content, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText : '';
  let styleCode = '';
  if (includeScopedStyle) {
    const style = parsed.descriptor.styles[0];
    if (!style) throw new Error(`Vue fixture has no scoped style (${absoluteFilename})`);
    const compiled = compileStyle({source: style.content, filename: absoluteFilename, id: `data-v-${id}`, scoped: true});
    assertCompiled(absoluteFilename, compiled.errors);
    styleCode = compiled.code;
  }
  const result = Object.freeze({scriptSource: script.content, templateErrors, renderCode, scriptCode, styleCode});
  if (compilations.size >= maxCachedCompilations && !compilations.has(key)) compilations.delete(compilations.keys().next().value!);
  compilations.set(key, {source, result});
  return result;
}

/** 复用 inlineTemplate 的纯代码；调用方仍须逐次执行 code 并提供该例自己的依赖端口。 */
export function compileVueInlineFixture(filename: string, options: InlineCompileOptions): CompiledVueInlineFixture {
  const absoluteFilename = resolve(filename), source = readFileSync(absoluteFilename, 'utf8');
  const {id, module = ts.ModuleKind.CommonJS, scriptReplacements = []} = options;
  const key = JSON.stringify([absoluteFilename, id, module, scriptReplacements]);
  const cached = inlineCompilations.get(key);
  if (cached?.source === source) return cached.result;

  const parsed = parse(source, {filename: absoluteFilename});
  assertCompiled(absoluteFilename, parsed.errors);
  if (!parsed.descriptor.template) throw new Error(`Vue fixture has no template (${absoluteFilename})`);
  const script = compileScript(parsed.descriptor, {id, inlineTemplate: true});
  const replacedSource = scriptReplacements.reduce((value, [search, replacement]) => value.replaceAll(search, replacement), script.content);
  const code = ts.transpileModule(replacedSource, {compilerOptions: {module, target: ts.ScriptTarget.ES2022}}).outputText;
  const runtimeImports = Object.freeze(Object.values(script.imports ?? {}).filter(item => !item.isType).map(item => item.source));
  const result = Object.freeze({scriptSource: script.content, code, parseErrors: Object.freeze(parsed.errors), runtimeImports});
  if (inlineCompilations.size >= maxCachedCompilations && !inlineCompilations.has(key)) inlineCompilations.delete(inlineCompilations.keys().next().value!);
  inlineCompilations.set(key, {source, result});
  return result;
}
