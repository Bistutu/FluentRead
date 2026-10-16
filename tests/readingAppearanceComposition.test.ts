import {afterEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({config: {readingAppearanceSites: {} as Record<string, 'system' | 'original'>}, patch: vi.fn(), setEnabled: vi.fn(), dispose: vi.fn(), send: vi.fn()}));
vi.mock('@/src/services/config/store', () => ({config: mocks.config, requestConfigPatch: mocks.patch}));
vi.mock('@/src/features/reading-appearance/content', () => ({createReadingAppearanceController: () => ({setEnabled: mocks.setEnabled, dispose: mocks.dispose})}));
vi.mock('@/src/features/full-page-translation/content/public', () => ({readVisibleTranslationRoot: vi.fn()}));
import {createContentReadingAppearance} from '@/src/app/content/readingAppearance';
afterEach(() => vi.unstubAllGlobals());
describe('reading appearance content composition', () => {
    it('starts on HTTP pages without the secure-context randomUUID API', async () => {
        vi.stubGlobal('crypto', {getRandomValues: (values: Uint32Array) => values.fill(7)});
        const runtime = createContentReadingAppearance({location: {href: 'http://example.com'}} as Document, () => true);
        runtime.activate();
        expect(await runtime.handle({type: 'getReadingAppearanceState'})).toMatchObject({documentToken: '00000007000000070000000700000007'});
        runtime.dispose();
    });
    it('uses existing config patch transport and page document', async () => {
        vi.stubGlobal('browser', {runtime: {sendMessage: mocks.send}});
        mocks.patch.mockImplementation(async (patch, send) => {await send(patch); mocks.config.readingAppearanceSites = patch.readingAppearanceSites;});
        const document = {location: {href: 'https://example.com/a'}} as Document;
        const runtime = createContentReadingAppearance(document, () => true);
        runtime.activate();
        const state = await runtime.handle({type: 'getReadingAppearanceState'});
        await runtime.handle({type: 'setReadingAppearance', font: 'system', remember: true, documentToken: (state as {documentToken: string}).documentToken});
        expect(mocks.send).toHaveBeenCalledWith({readingAppearanceSites: {'example.com': 'system'}});
        expect(mocks.setEnabled).toHaveBeenLastCalledWith(true);
        runtime.dispose();
        vi.unstubAllGlobals();
    });
});
