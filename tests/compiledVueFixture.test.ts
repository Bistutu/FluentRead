/**
 * @file tests/compiledVueFixture.test.ts
 * 文件职责：验证组件测试的编译缓存不会掩盖源码变化、混用编译选项或泄漏夹具状态。
 * 主要内容：缓存命中与容量边界、源码修改、编译诊断、选项隔离，以及相同产物的独立模块/模板执行。
 * 模块边界：只使用临时 SFC 和真实 Vue renderer；不加载扩展、Vite server 或业务组件。
 */
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import ts from 'typescript';
import {compileVueFixture, compileVueInlineFixture} from './helpers/compiledVueFixture';

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
let directory: string;
const apps: import('vue').App[] = [];
beforeEach(() => {directory = mkdtempSync(join(tmpdir(), 'fluentread-vue-fixture-'));});
afterEach(() => {apps.splice(0).forEach(app => app.unmount());rmSync(directory, {recursive: true, force: true});});
function fixture(source = '<script setup>let label = "first"</script><template><button @click="label">{{label}}</button></template><style scoped>button {color: red}</style>', name = 'Fixture.vue') {
  const filename = join(directory, name);writeFileSync(filename, source);return filename;
}
type FixtureNode = {tag: string; props: Record<string, any>; text?: string};
function mountComponent<T extends import('vue').Component>(component: T) {
  const nodes: FixtureNode[] = [];
  const renderer = runtime.createRenderer<FixtureNode, FixtureNode>({
    patchProp: (node, key, _previous, value) => {node.props[key] = value;},
    insert: () => undefined, remove: () => undefined,
    createElement: tag => {const node = {tag, props: {}};nodes.push(node);return node;},
    createText: () => ({tag: '#text', props: {}}), createComment: () => ({tag: '#comment', props: {}}),
    setText: () => undefined, setElementText: (node, text) => {node.text = text;},
    parentNode: () => null, nextSibling: () => null, querySelector: () => null, setScopeId: () => undefined,
    cloneNode: node => ({...node}), insertStaticContent: () => [{tag: '#static', props: {}}, {tag: '#static', props: {}}],
  });
  const app = renderer.createApp(component);apps.push(app);app.mount({tag: '#root', props: {}});
  return {component, button: nodes.find(node => node.tag === 'button')!};
}

describe('immutable Vue fixture compilation cache', () => {
  it('reuses unchanged compilation and invalidates immediately when source content changes', () => {
    const filename = fixture(), first = compileVueFixture(filename, {id: 'fixture', includeScript: true});
    expect(compileVueFixture(filename, {id: 'fixture', includeScript: true})).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Reflect.set(first, 'scriptSource', 'mutated')).toBe(false);
    expect(Object.isFrozen(first.templateErrors)).toBe(true);
    expect(Reflect.set(first.templateErrors, 0, 'injected template error')).toBe(false);
    expect(first.templateErrors).toEqual([]);
    fixture('<script setup>const label = "second"</script><template><section>{{label}}</section></template>');
    const second = compileVueFixture(filename, {id: 'fixture', includeScript: true});
    expect(second).not.toBe(first);
    expect(second.scriptSource).toContain('second');expect(second.scriptCode).toContain('second');expect(second.renderCode).toContain('section');
    expect(first.scriptSource).toContain('first');expect(first.scriptCode).toContain('first');expect(first.renderCode).toContain('button');
  });

  it('keeps compiler IDs, cached-handler settings and optional script/style outputs separate', () => {
    const filename = fixture();
    const plain = compileVueFixture(filename, {id: 'first'});
    const cached = compileVueFixture(filename, {id: 'first', cacheHandlers: true});
    const scoped = compileVueFixture(filename, {id: 'first', includeScript: true, includeScopedStyle: true});
    const otherId = compileVueFixture(filename, {id: 'second', includeScript: true, includeScopedStyle: true});
    expect(plain.scriptCode).toBe('');expect(plain.styleCode).toBe('');
    expect(plain.scriptSource).toContain('first');expect(plain.templateErrors).toEqual([]);
    expect(cached.renderCode).not.toBe(plain.renderCode);
    expect(scoped.scriptCode).not.toBe('');expect(scoped.styleCode).toContain('data-v-first');
    expect(otherId.styleCode).toContain('data-v-second');expect(otherId).not.toBe(scoped);
    expect(compileVueFixture(filename, {id: 'first', cacheHandlers: false, includeScript: false, includeScopedStyle: false})).toBe(plain);
  });

  it('evaluates fresh import ports, component state and render closures for each mount', async () => {
    const filename = fixture(`<script setup lang="ts">
      import {ref} from 'vue';import {port} from 'fixture-port';
      const clicks = ref(0);const tag: string = port.tag;
      </script><template><button @click="clicks++">{{tag}}:{{clicks}}</button></template>`);
    const compiled = compileVueFixture(filename, {id: 'fresh', includeScript: true, cacheHandlers: true});
    function mount(tag: string) {
      const exports: Record<string, any> = {};
      new Function('require', 'exports', compiled.scriptCode)((id: string) => {
        if (id === 'vue') return runtime;if (id === 'fixture-port') return {port: {tag}};
        throw new Error(`Unexpected fixture import: ${id}`);
      }, exports);
      const component = exports.default;
      component.render = new Function('Vue', compiled.renderCode)(runtime);
      return mountComponent(component);
    }
    const first = mount('first'), second = mount('second');
    expect(first.component).not.toBe(second.component);expect(first.component.render).not.toBe(second.component.render);
    expect(first.button.text).toBe('first:0');expect(second.button.text).toBe('second:0');
    first.button.props.onClick();await runtime.nextTick();
    expect(first.button.text).toBe('first:1');expect(second.button.text).toBe('second:0');
    second.button.props.onClick();await runtime.nextTick();
    expect(first.button.text).toBe('first:1');expect(second.button.text).toBe('second:1');
  });

  it('fails on parse/template/style errors and missing required blocks without caching a failed result', () => {
    const filename = fixture('<script setup>const value = 1</script><template><div></span></template>');
    expect(() => compileVueFixture(filename, {id: 'invalid'})).toThrow('Vue fixture compilation failed');
    fixture('<script setup>const value = 1</script><template><div v-if></div></template>');
    expect(() => compileVueFixture(filename, {id: 'invalid'})).toThrow('Vue fixture compilation failed');
    fixture('<script setup>const value = 1</script>');
    expect(() => compileVueFixture(filename, {id: 'invalid'})).toThrow('has no template');
    fixture('<script setup>const value = 1</script><template>{{value}}</template>');
    expect(() => compileVueFixture(filename, {id: 'invalid', includeScopedStyle: true})).toThrow('has no scoped style');
    fixture('<script setup>const value = 1</script><template>{{value}}</template><style scoped>div {</style>');
    expect(() => compileVueFixture(filename, {id: 'invalid', includeScopedStyle: true})).toThrow('Vue fixture compilation failed');
    fixture();expect(compileVueFixture(filename, {id: 'invalid', includeScopedStyle: true}).styleCode).toContain('data-v-invalid');
  });

  it('evicts old compiler products while keeping subsequent recompilation equivalent', () => {
    const filename = fixture(), first = compileVueFixture(filename, {id: 'oldest'});
    for (let index = 0; index < 32; index++) compileVueFixture(filename, {id: `later-${index}`});
    const recompiled = compileVueFixture(filename, {id: 'oldest'});
    expect(recompiled).not.toBe(first);expect(recompiled).toEqual(first);
  });

  it('keeps inline modules, ordered replacements and changing source isolated in immutable products', () => {
    const filename = fixture('<script setup lang="ts">const platform = import.meta.env.BROWSER;const label = "first";</script><template><button>{{platform}}:{{label}}</button></template>');
    const options = {id: 'inline', scriptReplacements: [['import.meta.env.BROWSER', '"chrome"']] as const};
    const first = compileVueInlineFixture(filename, options);
    expect(compileVueInlineFixture(filename, {...options, module: ts.ModuleKind.CommonJS})).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);expect(Object.isFrozen(first.parseErrors)).toBe(true);
    expect(Reflect.set(first, 'code', 'mutated')).toBe(false);expect(Reflect.set(first.parseErrors, 0, 'injected error')).toBe(false);
    expect(first.parseErrors).toEqual([]);expect(first.scriptSource).toContain('import.meta.env.BROWSER');
    expect(first.code).toContain('"chrome"');expect(first.code).toContain('exports.default');
    const otherModule = compileVueInlineFixture(filename, {...options, module: ts.ModuleKind.ESNext});
    expect(otherModule).not.toBe(first);expect(otherModule.code).toContain('export default');
    const otherBrowser = compileVueInlineFixture(filename, {id: 'inline', scriptReplacements: [['import.meta.env.BROWSER', '"firefox"']]});
    expect(otherBrowser).not.toBe(first);expect(otherBrowser.code).toContain('"firefox"');
    const forward = compileVueInlineFixture(filename, {id: 'inline', scriptReplacements: [...options.scriptReplacements, ['first', 'second'], ['second', 'third']]});
    const reverse = compileVueInlineFixture(filename, {id: 'inline', scriptReplacements: [...options.scriptReplacements, ['second', 'third'], ['first', 'second']]});
    expect(forward).not.toBe(reverse);expect(forward.code).toContain('third');expect(reverse.code).toContain('second');
    fixture('<script setup lang="ts">const platform = import.meta.env.BROWSER;const label = "second";</script><template><button>{{platform}}:{{label}}</button></template>');
    const second = compileVueInlineFixture(filename, options);
    expect(second).not.toBe(first);expect(second.code).toContain('second');expect(first.code).toContain('first');
  });

  it('evaluates independent inline setup closures, import ports and reactive state on each mount', async () => {
    const filename = fixture(`<script setup lang="ts">import {ref} from 'vue';import {port} from 'fixture-port';import type {Ignored} from 'ignored-port';
      const clicks = ref(0);const tag: string = port.tag;</script><template><button @click="clicks++">{{tag}}:{{clicks}}</button></template>`);
    const compiled = compileVueInlineFixture(filename, {id: 'inline-fresh'});
    expect(compiled.runtimeImports).toEqual(['vue', 'fixture-port']);expect(Object.isFrozen(compiled.runtimeImports)).toBe(true);
    expect(Reflect.set(compiled.runtimeImports, 0, 'foreign-port')).toBe(false);
    function mount(tag: string) {
      const module = {exports: {} as {default: import('vue').Component & {setup?: unknown}}};
      new Function('require', 'exports', 'module', compiled.code)((id: string) => {
        if (id === 'vue') return runtime;if (id === 'fixture-port') return {port: {tag}};
        throw new Error(`Unexpected inline fixture import: ${id}`);
      }, module.exports, module);
      return {...mountComponent(module.exports.default), component: module.exports.default};
    }
    const first = mount('first'), second = mount('second');
    expect(first.component).not.toBe(second.component);expect(first.component.setup).not.toBe(second.component.setup);
    expect(first.button.text).toBe('first:0');expect(second.button.text).toBe('second:0');
    first.button.props.onClick();await runtime.nextTick();
    expect(first.button.text).toBe('first:1');expect(second.button.text).toBe('second:0');
    second.button.props.onClick();await runtime.nextTick();
    expect(first.button.text).toBe('first:1');expect(second.button.text).toBe('second:1');
  });

  it('rejects failed inline compilation, recovers after source repair and bounds retained compiler products', () => {
    const filename = fixture('<script setup>const value = 1</script><template><div></span></template>');
    expect(() => compileVueInlineFixture(filename, {id: 'invalid-inline'})).toThrow('Vue fixture compilation failed');
    fixture('<script setup>const value = 1</script>');
    expect(() => compileVueInlineFixture(filename, {id: 'invalid-inline'})).toThrow('has no template');
    fixture();const first = compileVueInlineFixture(filename, {id: 'inline-oldest'});
    for (let index = 0; index < 32; index++) compileVueInlineFixture(filename, {id: `inline-later-${index}`});
    const again = compileVueInlineFixture(filename, {id: 'inline-oldest'});
    expect(again).not.toBe(first);expect(again).toEqual(first);expect(again.parseErrors).toEqual([]);
  });
});
