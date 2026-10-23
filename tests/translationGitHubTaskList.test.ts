import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';
import {createTranslationSourceSnapshot, extractTranslationText} from '@/src/core/translation/public';
import {createTranslationCore} from './helpers/translationCore';

const url = new URL('https://github.com/kohya-ss/musubi-tuner/issues/1029');
function fixture() {
    const {document} = parseHTML(readFileSync(new URL('./fixtures/translation-pages/github-task-list.html', import.meta.url), 'utf8'));
    Object.defineProperty(document.defaultView!, 'getComputedStyle', {configurable: true, value: (element: HTMLElement) => ({
        display: element.style.display ?? '', visibility: 'visible', position: element.style.position,
        width: element.style.width, height: element.style.height, overflow: element.style.overflow,
        clip: element.style.clip, clipPath: element.style.clipPath,
    })});
    return document;
}
const id = (element: Element) => element.getAttribute('data-testid');
const expected = ['task-heading', 'task-content-0', 'task-content-1', 'task-content-2', 'adjacent-paragraph'];

describe('GitHub React task list ownership', () => {
    it('keeps every hydrated row independent in content scope', () => {
        const document = fixture();
        const core = createTranslationCore({url});
        const owners = core.discover(document);
        expect(owners.map(candidate => id(candidate.element))).toEqual(expected);
        const before = document.querySelector('main')!.innerHTML;
        for (const index of [0, 1, 2]) {
            const row = document.querySelector<HTMLElement>(`[data-testid="task-content-${index}"]`)!;
            expect(owners.filter(candidate => candidate.element === row)).toHaveLength(1);
            expect(core.resolve(row.firstChild)?.element).toBe(row);
            for (const inline of row.querySelectorAll('a:not(.notranslate), strong, code')) {
                expect(core.resolve(inline.firstChild)?.element).toBe(row);
            }
            const snapshot = createTranslationSourceSnapshot(row, core.shouldStayOriginal, undefined, undefined, core.shouldOmitFromTranslation);
            expect(snapshot.clone.querySelector('input,svg')).toBeNull();
            expect(snapshot.slots.map(slot => slot.source).join(' ')).not.toMatch(/draggable|announcement|model\.encode|@sdbds/);
        }
        expect(extractTranslationText(document.querySelector('[data-testid="task-group"]')!, core.shouldStayOriginal)).not.toContain('draggable');
        expect(document.querySelector('main')!.innerHTML).toBe(before);
    });

    it('keeps all-node scope candidates inside each row without swallowing the list', () => {
        const document = fixture();
        const core = createTranslationCore({url, scope: 'all'});
        const list = document.querySelector('[data-testid="task-list"]')!;
        const candidates = core.discover(list);
        for (const candidate of candidates) {
            expect(candidate.element.closest('[data-testid^="task-content-"]')).not.toBeNull();
        }
        for (const index of [0, 1, 2]) {
            const row = document.querySelector(`[data-testid="task-content-${index}"]`)!;
            expect(candidates.some(candidate => row.contains(candidate.element))).toBe(true);
        }
    });

    it('re-discovers server list items after React replaces them with a single grouped LI', () => {
        const document = fixture();
        const list = document.querySelector('[data-testid="task-list"]')!;
        const hydrated = list.innerHTML;
        list.innerHTML = '<li id="first">First server-rendered task.</li><li id="second">Second server-rendered task.</li>';
        const core = createTranslationCore({url});
        expect(core.discover(list).map(candidate => candidate.element.id)).toEqual(['first', 'second']);
        list.innerHTML = hydrated;
        const owners = core.discover(list);
        expect(owners.map(candidate => id(candidate.element))).toEqual(expected.slice(1, 4));
        const row = document.querySelector('[data-testid="task-content-1"]')!;
        row.firstChild!.nodeValue = 'The host updated this task while reading.';
        expect(core.discover(row).map(candidate => candidate.element)).toEqual([row]);
        expect(core.resolve(row.firstChild)?.element).toBe(row);
        expect(extractTranslationText(row)).toContain('The host updated this task');
    });

    it.each(['li', 'blockquote', 'figcaption', 'dt', 'dd', 'th', 'td'])('does not let a GitHub %s swallow nested paragraphs or lists', tag => {
        const {document} = parseHTML(`<html><body><main class="markdown-body"><${tag} id="container">Introductory source text.<task-lists><ul><li id="first">First nested list item.</li><li id="second">Second nested list item.</li></ul></task-lists><p id="last">Final source paragraph.</p></${tag}></main></body></html>`);
        const core = createTranslationCore({url});
        const owners = core.discover(document);
        expect(owners.filter(candidate => !candidate.nodes).map(candidate => candidate.element.id)).toEqual(['first', 'second', 'last']);
        const intro = owners.find(candidate => candidate.element.id === 'container');
        expect(intro?.nodes?.map(node => node.textContent).join('')).toBe('Introductory source text.');
        for (const name of ['first', 'second', 'last']) {
            const element = document.getElementById(name)!;
            expect(core.resolve(element.firstChild)?.element).toBe(element);
        }
    });

    it('preserves a plain leaf list item as one paragraph with links and code', () => {
        const {document} = parseHTML('<html><body><main class="markdown-body"><ul><li id="row">Install <code>tool install</code> and read <a href="/manual">the documentation</a>.</li></ul></main></body></html>');
        const core = createTranslationCore({url});
        const row = document.getElementById('row')!;
        expect(core.discover(document).map(candidate => candidate.element)).toEqual([row]);
        expect(core.resolve(row.querySelector('a')!.firstChild)?.element).toBe(row);
    });
});


// Only selected const initializers enter this VM. Launch, main(), file writes,
// provider setup and browser helpers in the CLI are never evaluated.
function taskListCliWaiters(document: Document, live = false) {
    const filename = new URL('../scripts/testing/run-github-task-list-test.cjs', import.meta.url);
    const source = readFileSync(filename, 'utf8');
    const ast = ts.createSourceFile(filename.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const selected = ['bodySelector', 'taskSelector', 'owned', 'waitTasks', 'waitFull'];
    const declarations = new Map<string, string>();
    let defaultTimeout: number | undefined;
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            if (selected.includes(node.name.text)) {
                declarations.set(node.name.text, `const ${node.name.text} = ${node.initializer.getText(ast)};`);
            }
            if (node.name.text === 'args' && ts.isObjectLiteralExpression(node.initializer)) {
                for (const property of node.initializer.properties) {
                    if (ts.isPropertyAssignment(property) && property.name.getText(ast) === 'timeout'
                        && ts.isNumericLiteral(property.initializer)) defaultTimeout = Number(property.initializer.text);
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
    for (const name of selected.filter(name => name !== 'waitFull')) {
        if (!declarations.has(name)) throw new Error(`Missing CLI declaration: ${name}`);
    }
    if (defaultTimeout === undefined) throw new Error('Missing numeric CLI default timeout');
    const calls: Array<{argument: unknown; options: {timeout: number}; sample: () => boolean}> = [];
    const page = {
        waitForFunction(predicate: (argument: unknown) => boolean, argument: unknown, options: {timeout: number}) {
            const call = {argument, options, sample: () => Boolean(predicate(argument))};
            calls.push(call);
            return call;
        },
    };
    const names = selected.filter(name => declarations.has(name));
    const bindings = new Script(`${names.map(name => declarations.get(name)).join('\n')}\n({${names.join(',')}})`)
        .runInNewContext({document, page, args: {live, timeout: defaultTimeout}});
    // The unpatched CLI's full stages call waitTasks(1). Keep that actual
    // baseline behavior so a regression fails on DOM state, not collection.
    const full = () => bindings.waitFull ? bindings.waitFull() : bindings.waitTasks(1);
    return {rows: (expected: number) => bindings.waitTasks(expected), full, calls};
}

const taskListOwned = '.fluent-read-bilingual-content';
function appendTaskListWrapper(document: Document, owner: Element): Element {
    const wrapper = document.createElement('span');
    wrapper.className = taskListOwned.slice(1);
    wrapper.setAttribute('data-fr-translation-owned', 'true');
    wrapper.textContent = '测试译文';
    owner.append(wrapper);
    return wrapper;
}
function completeTaskListFixture(document: Document): void {
    for (const name of expected) appendTaskListWrapper(document, document.querySelector(`[data-testid="${name}"]`)!);
}

describe('GitHub task list CLI full-stage completion', () => {
    it('keeps the full waiter pending when tasks finish before the adjacent paragraph without any loading DOM', () => {
        const document = fixture();
        for (const name of expected.filter(name => name !== 'adjacent-paragraph')) {
            appendTaskListWrapper(document, document.querySelector(`[data-testid="${name}"]`)!);
        }
        expect(document.querySelectorAll('.fluent-read-loading')).toHaveLength(0);
        expect(document.querySelectorAll(taskListOwned)).toHaveLength(4);
        const waits = taskListCliWaiters(document);
        const oldRows = waits.rows(1);
        const full = waits.full();
        expect(oldRows.sample()).toBe(true);
        expect(full.sample()).toBe(false);
        appendTaskListWrapper(document, document.querySelector('[data-testid="adjacent-paragraph"]')!);
        expect(full.sample()).toBe(true);
    });

    it('rejects missing, duplicate, misplaced and nested owners even when aggregate counts appear complete', () => {
        const mutations: Array<[string, (document: Document) => void]> = [
            ['heading wrapper missing', document => document.querySelector(`[data-testid="task-heading"] ${taskListOwned}`)!.remove()],
            ['footer wrapper missing', document => document.querySelector(`[data-testid="adjacent-paragraph"] ${taskListOwned}`)!.remove()],
            ['heading wrapper duplicate', document => appendTaskListWrapper(document, document.querySelector('[data-testid="task-heading"]')!)],
            ['footer wrapper duplicate', document => appendTaskListWrapper(document, document.querySelector('[data-testid="adjacent-paragraph"]')!)],
            ['heading owner missing', document => document.querySelector('[data-testid="task-heading"]')!.remove()],
            ['footer owner missing', document => document.querySelector('[data-testid="adjacent-paragraph"]')!.remove()],
            ['heading owner duplicate', document => {
                const heading = document.querySelector('[data-testid="task-heading"]')!;
                heading.after(heading.cloneNode(true));
            }],
            ['footer owner duplicate', document => {
                const footer = document.querySelector('[data-testid="adjacent-paragraph"]')!;
                footer.after(footer.cloneNode(true));
            }],
            ['five wrappers with one duplicated task and another missing', document => {
                document.querySelector(`[data-testid="task-content-1"] ${taskListOwned}`)!.remove();
                appendTaskListWrapper(document, document.querySelector('[data-testid="task-content-0"]')!);
            }],
            ['five wrappers with a nested heading translation instead of the footer', document => {
                document.querySelector(`[data-testid="adjacent-paragraph"] ${taskListOwned}`)!.remove();
                appendTaskListWrapper(document, document.querySelector(`[data-testid="task-heading"] ${taskListOwned}`)!);
            }],
            ['five wrappers with an unrelated translation instead of the footer', document => {
                document.querySelector(`[data-testid="adjacent-paragraph"] ${taskListOwned}`)!.remove();
                appendTaskListWrapper(document, document.querySelector('[data-testid="task-group"]')!);
            }],
        ];
        for (const [name, mutate] of mutations) {
            const document = fixture();
            completeTaskListFixture(document);
            mutate(document);
            expect(taskListCliWaiters(document).full().sample(), name).toBe(false);
        }
    });

    it('accepts all five original owners and requires the sixth owner after a fourth task is added or remounted', () => {
        const document = fixture();
        completeTaskListFixture(document);
        const waits = taskListCliWaiters(document);
        const full = waits.full();
        expect(document.querySelectorAll(taskListOwned)).toHaveLength(5);
        expect(full.sample()).toBe(true);
        const original = document.querySelector('[data-testid="task-content-0"]')!
            .closest('[class*="TaskListItems-module__task-list-item"]')!;
        const row = original.cloneNode(true) as Element;
        row.querySelectorAll(taskListOwned).forEach(wrapper => wrapper.remove());
        row.querySelectorAll('[data-testid], [id]').forEach(node => {
            node.removeAttribute('data-testid'); node.removeAttribute('id');
        });
        const content = row.querySelector('[class*="TaskListItem-module__task-list-html"]')!;
        content.setAttribute('data-testid', 'dynamic-task-content');
        document.querySelector('[data-testid="task-rows"]')!.append(row);
        expect(full.sample()).toBe(false);
        appendTaskListWrapper(document, content);
        expect(document.querySelectorAll(taskListOwned)).toHaveLength(6);
        expect(full.sample()).toBe(true);
        const remounted = content.cloneNode(true) as Element;
        remounted.querySelectorAll(taskListOwned).forEach(wrapper => wrapper.remove());
        content.replaceWith(remounted);
        expect(document.querySelectorAll(taskListOwned)).toHaveLength(5);
        expect(full.sample()).toBe(false);
        appendTaskListWrapper(document, remounted);
        expect(document.querySelectorAll(taskListOwned)).toHaveLength(6);
        expect(full.sample()).toBe(true);
    });

    it('preserves the live row contract and one wait call with the actual 30-second CLI default', () => {
        const document = fixture();
        completeTaskListFixture(document);
        document.querySelector('[data-testid="task-heading"]')!.remove();
        document.querySelector('[data-testid="adjacent-paragraph"]')!.remove();
        const live = taskListCliWaiters(document, true);
        const call = live.full();
        expect(live.calls).toHaveLength(1);
        expect(call).toBe(live.calls[0]);
        expect(call.options.timeout).toBe(30000);
        expect(call.argument).toMatchObject({expected: 1});
        expect(call.sample()).toBe(true);
        document.querySelector(`[data-testid="task-content-1"] ${taskListOwned}`)!.remove();
        expect(call.sample()).toBe(false);
        const local = taskListCliWaiters(document);
        const localCall = local.full();
        expect(local.calls).toHaveLength(1);
        expect(localCall.options.timeout).toBe(30000);
    });
});
