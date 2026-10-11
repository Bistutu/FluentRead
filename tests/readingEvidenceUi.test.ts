import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type ViteDevServer} from 'vite';
import {afterEach, expect, it} from 'vitest';
import {buildReadingEvidence} from '@/src/core/harness/evidence';

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
const {renderToString} = createRequire(import.meta.url)('vue/server-renderer') as typeof import('vue/server-renderer');
let server: ViteDevServer | undefined;
afterEach(async () => {await server?.close(); server = undefined;});

async function renderAnswer(text: string, sourceText = 'Practice helps.') {
  server ??= await createServer({configFile: false, appType: 'custom', logLevel: 'silent', root: process.cwd(),
    plugins: [{name: 'reading-evidence-i18n', enforce: 'pre', resolveId(id) {if (id === '\0evidence-i18n') return id;},
      load(id) {if (id === '\0evidence-i18n') return `export const useUiI18n = () => ({t: (key, params) => key + (params?.quote || ''), translateLegacy: text => text});`; }}, vue()],
    resolve: {alias: [{find: '@/src/ui/i18n', replacement: '\0evidence-i18n'}, {find: '@', replacement: resolve(process.cwd())}]}, server: {hmr: false, middlewareMode: true}});
  const {default: component} = await server.ssrLoadModule('/src/features/reading-assistant/ui/ReadingAnswer.vue');
  return renderToString(runtime.createSSRApp(component, {text, sourceText, evidenceSources: buildReadingEvidence(sourceText, '')}));
}

it('renders citations next to claims as safe native buttons and keeps external knowledge visibly separate', async () => {
  const source = buildReadingEvidence('Practice helps.', '')[0];
  const html = await renderAnswer(`It helps. [[cite:${source.id}|Practice helps.]]\n\n[[external]] General learning background.\n\nUnverified [[cite:invented|A fake sentence.]]`);
  expect(html).toContain('data-reading-evidence'); expect(html).toContain('type="button"');
  expect(html).toContain('reading.evidence.locatePractice helps.');
  expect(html).toContain('title="Practice helps."');
  expect(html).toContain('data-evidence-quote="Practice helps."');
  const button = parseHTML(html).document.querySelector('button[data-reading-evidence]')!;
  expect(button.textContent).toBe('');
  expect(button.getAttribute('aria-label')).toBe('reading.evidence.locatePractice helps.');
  expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(button.querySelector('svg')?.getAttribute('focusable')).toBe('false');
  const icon = button.querySelector('svg')!;
  expect(icon.getAttribute('data-evidence-icon')).toBe('quote');
  expect(icon.querySelectorAll('path')).toHaveLength(2);
  expect(icon.querySelector('circle, line, text')).toBeNull();
  expect(icon.innerHTML).not.toContain('M8 7v4M8 4.75h.01');
  expect(html).not.toContain('reading.evidence.label');
  expect(html).not.toContain('reading.evidence.label · Practice helps.');
  expect(html).toContain('【reading.evidence.external】');
  expect(html).toContain('data-evidence-state="unverified"');
  expect(html).toContain('A fake sentence.'); expect(html.match(/data-reading-evidence/g)).toHaveLength(1);
  expect(html).not.toContain('[[cite:');
});

it('keeps grammar-table citations clickable while preserving the existing structure view for citation-free tables', async () => {
  const source = buildReadingEvidence('Practice helps.', '')[0];
  const table = `| Text | POS | Role | Meaning |\n| --- | --- | --- | --- |\n| Practice | noun | subject | Practice |\n| helps | verb | predicate | Useful [[cite:${source.id}|Practice helps.]] |`;
  const html = await renderAnswer(table);
  expect(html).toMatch(/<table(?:\s|>)/u); expect(html).toContain('data-reading-evidence'); expect(html).not.toContain('fr-reading-structure');
  expect(html).not.toContain('[[cite:');
  const button = parseHTML(html).document.querySelector('td button[data-reading-evidence]')!;
  expect(button.textContent).toBe('');
  expect(button.getAttribute('title')).toBe('Practice helps.');
  expect(button.getAttribute('aria-label')).toBe('reading.evidence.locatePractice helps.');
  expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(button.querySelector('svg')?.getAttribute('data-evidence-icon')).toBe('quote');
  expect(button.querySelectorAll('svg path')).toHaveLength(2);
  expect(button.querySelector('svg circle')).toBeNull();
  const original = await renderAnswer(table.replace(` [[cite:${source.id}|Practice helps.]]`, ''));
  expect(original).toContain('fr-reading-structure'); expect(original).not.toContain('data-reading-evidence');
});
