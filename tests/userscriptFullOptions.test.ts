import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {installOptionsApp} from '@/src/app/options';
import {
    buildUserscriptSettingsUrl,
    closeUserscriptSettings,
    openUserscriptSettings,
} from '@/userscript/settingsFull';
import {installUserscriptInterfaceFontPreviews} from '@/userscript/interfaceFontPreviews';

const mocks = vi.hoisted(() => ({
    createVueShadowUi: vi.fn(),
    remove: vi.fn(),
}));

vi.mock('@/src/app/options', () => ({installOptionsApp: vi.fn()}));
vi.mock('@/src/app/options/OptionsApp.vue', () => ({default: {name: 'OptionsApp'}}));
vi.mock('@/src/platform/shadow-ui', () => ({createVueShadowUi: mocks.createVueShadowUi}));

const previewCss = (family = 'FluentRead Preview Inter', weight = '400', source = 'data:font/woff2;base64,d09GMg==') =>
    `@font-face {font-family: '${family}'; src: url('${source}') format('woff2'); font-weight: ${weight}; font-style: normal;}`;

function previewHarness() {
    type Face = {family: string; data: Uint8Array; weight: string; load(): Promise<Face>};
    const registered = new Set<Face>();
    const load = vi.fn(async (face: Face) => face);
    const construct = vi.fn(function (family: string, data: Uint8Array, descriptors: {weight: string}) {
        const face: Face = {family, data, weight: descriptors.weight, load: () => load(face)};
        return face;
    });
    const fonts = {
        add: vi.fn((face: Face) => {registered.add(face); return fonts;}),
        delete: vi.fn((face: Face) => registered.delete(face)),
    };
    vi.stubGlobal('FontFace', construct);
    vi.stubGlobal('document', {fonts});
    return {registered, load, construct, fonts};
}

describe('full userscript Options entry', () => {
    beforeEach(() => {
        mocks.createVueShadowUi.mockReset().mockResolvedValue({remove: mocks.remove});
        mocks.remove.mockReset();
        vi.mocked(installOptionsApp).mockReset();
    });

    afterEach(() => {
        closeUserscriptSettings();
        vi.unstubAllGlobals();
    });

    it('opens the same URL with a settings fragment through Safari GM.openInTab', async () => {
        const openInTab = vi.fn().mockResolvedValue({id: 1});
        const browserOpen = vi.fn();
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article?ref=home#old', hash: '#old'},
            open: browserOpen,
        });
        vi.stubGlobal('GM', {openInTab});

        await openUserscriptSettings({id: 'context'}, 'settings-services');

        expect(openInTab).toHaveBeenCalledWith(
            buildUserscriptSettingsUrl('https://example.test/article?ref=home#old', 'settings-services'),
            false,
        );
        expect(browserOpen).not.toHaveBeenCalled();
        expect(mocks.createVueShadowUi).not.toHaveBeenCalled();
    });

    it('uses GM_openInTab with an active tab for classic managers', async () => {
        const openInTab = vi.fn();
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article', hash: ''},
            open: vi.fn(),
        });
        vi.stubGlobal('GM', undefined);
        vi.stubGlobal('GM_openInTab', openInTab);

        await openUserscriptSettings({id: 'context'}, 'settings-writing');

        expect(openInTab).toHaveBeenCalledWith(
            'https://example.test/article#fluentread-userscript-settings/settings-writing',
            expect.objectContaining({active: true}),
        );
        expect(mocks.createVueShadowUi).not.toHaveBeenCalled();
    });

    it('opens settings in-page on Android even if GM_openInTab exists', async () => {
        const openInTab = vi.fn();
        vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'});
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article#host-route', hash: '#host-route'},
            open: vi.fn(),
        });
        vi.stubGlobal('GM', undefined);
        vi.stubGlobal('GM_openInTab', openInTab);

        await openUserscriptSettings({id: 'context'}, 'settings-general');

        expect(openInTab).not.toHaveBeenCalled();
        expect(window.open).not.toHaveBeenCalled();
        expect(mocks.createVueShadowUi).toHaveBeenCalledOnce();
        expect(window.location.hash).toBe('#host-route');
    });

    it('opens the full Options in-page when no manager tab API exists', async () => {
        const browserOpen = vi.fn();
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article#host-route', hash: '#host-route'},
            open: browserOpen,
        });
        vi.stubGlobal('GM', undefined);
        vi.stubGlobal('GM_openInTab', undefined);

        await openUserscriptSettings({id: 'context'});

        expect(browserOpen).not.toHaveBeenCalled();
        expect(mocks.createVueShadowUi).toHaveBeenCalledWith(
            {id: 'context'},
            expect.objectContaining({mode: 'closed', viewport: true}),
        );
        const options = mocks.createVueShadowUi.mock.calls[0][1];
        expect(options.component).toEqual({name: 'OptionsApp'});
        const {document} = parseHTML('<div id="owned-options-overlay"></div>');
        const exactContainer = document.querySelector<HTMLElement>('#owned-options-overlay')!;
        const fakeApp = {use: vi.fn(), component: vi.fn(), onUnmount: vi.fn()};
        options.configureApp(fakeApp, exactContainer);
        expect(installOptionsApp).toHaveBeenCalledOnce();
        expect(installOptionsApp).toHaveBeenCalledWith(fakeApp, {documentRoot: null, uiRoot: exactContainer});
        expect(vi.mocked(installOptionsApp).mock.calls[0][1]?.uiRoot).toBe(exactContainer);
        vi.stubGlobal('ShadowRoot', class {});
        vi.stubGlobal('HTMLElement', class {});
        expect(options.props({getRootNode: () => ({})})).toMatchObject({
            locationRouting: 'internal',
            settingsHashPrefix: undefined,
            onClose: closeUserscriptSettings,
        });
        expect(window.location.hash).toBe('#host-route');
        closeUserscriptSettings();
        expect(mocks.remove).toHaveBeenCalledOnce();
    });

    it('configures the separate settings page with its own UI container and no host document permissions', async () => {
        const openInTab = vi.fn();
        vi.stubGlobal('window', {
            location: {
                href: 'https://example.test/article#fluentread-userscript-settings/settings-general',
                hash: '#fluentread-userscript-settings/settings-general',
            },
            open: vi.fn(),
        });
        vi.stubGlobal('GM', {openInTab});
        vi.stubGlobal('GM_openInTab', undefined);

        await openUserscriptSettings({id: 'separate-context'}, 'settings-services');

        expect(openInTab).not.toHaveBeenCalled();
        expect(window.open).not.toHaveBeenCalled();
        expect(mocks.createVueShadowUi).toHaveBeenCalledOnce();
        const options = mocks.createVueShadowUi.mock.calls[0][1];
        const {document} = parseHTML('<div id="owned-options-page"></div>');
        const exactContainer = document.querySelector<HTMLElement>('#owned-options-page')!;
        const fakeApp = {use: vi.fn(), component: vi.fn(), onUnmount: vi.fn()};
        options.configureApp(fakeApp, exactContainer);
        expect(installOptionsApp).toHaveBeenCalledOnce();
        expect(installOptionsApp).toHaveBeenCalledWith(fakeApp, {documentRoot: null, uiRoot: exactContainer});
        expect(vi.mocked(installOptionsApp).mock.calls[0][1]?.uiRoot).toBe(exactContainer);
        vi.stubGlobal('ShadowRoot', class {});
        vi.stubGlobal('HTMLElement', class {});
        expect(options.props(exactContainer)).toMatchObject({
            queryRoot: document,
            settingsHashPrefix: '#fluentread-userscript-settings',
            initialSection: undefined,
            locationRouting: undefined,
            onClose: undefined,
        });
        expect(window.location.hash).toBe('#fluentread-userscript-settings/settings-services');
        closeUserscriptSettings();
        expect(mocks.remove).toHaveBeenCalledOnce();
    });

    it('keeps the selected settings section in the in-page fallback', async () => {
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article#host-route', hash: '#host-route'},
            open: vi.fn(),
        });
        vi.stubGlobal('GM', undefined);
        vi.stubGlobal('GM_openInTab', undefined);

        await openUserscriptSettings({id: 'context'}, 'settings-services');

        const options = mocks.createVueShadowUi.mock.calls[0][1];
        vi.stubGlobal('ShadowRoot', class {});
        vi.stubGlobal('HTMLElement', class {});
        expect(options.props({getRootNode: () => ({})})).toMatchObject({
            initialSection: 'settings-services',
            locationRouting: 'internal',
        });
        expect(window.location.hash).toBe('#host-route');
    });

    it('falls back to the in-page Options when GM.openInTab rejects asynchronously', async () => {
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article', hash: ''},
            open: vi.fn(),
        });
        vi.stubGlobal('GM', {openInTab: vi.fn().mockRejectedValue(new Error('blocked'))});

        await openUserscriptSettings({id: 'context'});
        await vi.waitFor(() => expect(mocks.createVueShadowUi).toHaveBeenCalledOnce());
    });

    it.each(['legacy', 'modern'] as const)('does not resurrect closed settings after a late %s tab failure', async manager => {
        let rejectTab!: (reason: unknown) => void;
        const pending = new Promise((_resolve, reject) => {rejectTab = reject;});
        vi.stubGlobal('window', {location: {href: 'https://example.test/article', hash: ''}});
        vi.stubGlobal('GM_openInTab', manager === 'legacy' ? () => pending : undefined);
        vi.stubGlobal('GM', manager === 'modern' ? {openInTab: () => pending} : undefined);
        await openUserscriptSettings({id: 'context'});
        closeUserscriptSettings();
        rejectTab(new Error('late manager failure'));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mocks.createVueShadowUi).not.toHaveBeenCalled();
    });

    it('ignores the first tab failure after a later settings request opens successfully', async () => {
        let rejectTab!: (reason: unknown) => void;
        const first = new Promise((_resolve, reject) => {rejectTab = reject;});
        vi.stubGlobal('window', {location: {href: 'https://example.test/article', hash: ''}});
        vi.stubGlobal('GM_openInTab', undefined);
        vi.stubGlobal('GM', {openInTab: vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined)});
        await openUserscriptSettings({id: 'context'}, 'settings-general');
        await openUserscriptSettings({id: 'context'}, 'settings-services');
        rejectTab(new Error('old request failed'));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mocks.createVueShadowUi).not.toHaveBeenCalled();
    });

    it('removes a pending settings mount after the page closes', async () => {
        let resolveMount!: (value: {remove: typeof mocks.remove}) => void;
        mocks.createVueShadowUi.mockReturnValue(new Promise((resolve) => { resolveMount = resolve; }));
        vi.stubGlobal('window', {
            location: {href: 'https://example.test/article#host-route', hash: '#host-route'},
            open: vi.fn(() => null),
        });
        vi.stubGlobal('GM', undefined);
        vi.stubGlobal('GM_openInTab', undefined);

        const firstOpen = openUserscriptSettings({id: 'context'});
        const secondOpen = openUserscriptSettings({id: 'context'});
        expect(mocks.createVueShadowUi).toHaveBeenCalledOnce();
        closeUserscriptSettings();
        resolveMount({remove: mocks.remove});
        await Promise.all([firstOpen, secondOpen]);
        expect(mocks.remove).toHaveBeenCalledOnce();
    });

    it('releases preview fonts when a settings mount fails or the mounted UI closes', async () => {
        const h = previewHarness();
        vi.stubGlobal('__fluentReadUserscriptCss', previewCss());
        vi.stubGlobal('window', {location: {href: 'https://example.test/#fluentread-userscript-settings', hash: '#fluentread-userscript-settings'}});
        mocks.createVueShadowUi.mockRejectedValueOnce(new Error('mount failed'));
        await expect(openUserscriptSettings({})).rejects.toThrow('mount failed');
        expect(h.registered.size).toBe(0);
        await openUserscriptSettings({});
        expect(h.registered.size).toBe(1);
        closeUserscriptSettings();
        expect(h.registered.size).toBe(0);
    });

    it('attaches preview cleanup to Vue unmount as well as explicit close', async () => {
        const h = previewHarness();
        vi.stubGlobal('__fluentReadUserscriptCss', previewCss());
        vi.stubGlobal('window', {location: {href: 'https://example.test/#fluentread-userscript-settings', hash: '#fluentread-userscript-settings'}});
        await openUserscriptSettings({});
        const onUnmount = vi.fn();
        mocks.createVueShadowUi.mock.calls[0][1].configureApp({onUnmount});
        expect(h.registered.size).toBe(1);
        onUnmount.mock.calls[0][0]();
        expect(h.registered.size).toBe(0);
    });
});

describe('userscript Shadow DOM font previews', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('registers 400/700 bundled bytes and only removes its own faces on disposal', async () => {
        const h = previewHarness();
        const mount = installUserscriptInterfaceFontPreviews(previewCss() + previewCss('FluentRead Preview Inter', '700'));
        await mount.ready;
        expect(h.construct).toHaveBeenCalledTimes(2);
        expect(h.construct.mock.calls[0][1]).toEqual(new Uint8Array([0x77, 0x4f, 0x46, 0x32]));
        expect(h.construct.mock.calls.map(call => call[2].weight)).toEqual(['400', '700']);
        const foreign = {family: 'host font'} as any;
        h.registered.add(foreign);
        mount.dispose(); mount.dispose();
        expect([...h.registered]).toEqual([foreign]);
        expect(h.fonts.delete).toHaveBeenCalledTimes(2);
    });

    it('accepts the unquoted family and data URL syntax produced by CSS minification', async () => {
        const h = previewHarness();
        await installUserscriptInterfaceFontPreviews(
            '@font-face{font-family:FluentRead Preview LXGW WenKai;src:url(data:font/woff2;base64,d09GMg==) format("woff2");font-weight:400}',
        ).ready;
        expect(h.registered.size).toBe(1);
        expect(h.construct.mock.calls[0][0]).toBe('FluentRead Preview LXGW WenKai');
    });

    it('never registers cancelled late loads or removes the next mount faces', async () => {
        const h = previewHarness();
        let release!: () => void;
        h.load.mockImplementationOnce(face => new Promise(resolve => {release = () => resolve(face);}));
        const previous = installUserscriptInterfaceFontPreviews(previewCss());
        previous.dispose();
        const next = installUserscriptInterfaceFontPreviews(previewCss());
        await next.ready;
        const currentFaces = [...h.registered];
        release(); await previous.ready; previous.dispose();
        expect([...h.registered]).toEqual(currentFaces);
        expect(h.fonts.add).toHaveBeenCalledOnce();
        next.dispose();
        expect(h.registered.size).toBe(0);
    });

    it('ignores invalid data, other families, weights and remote or multi-source rules without network', async () => {
        const h = previewHarness();
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const invalid = [
            previewCss('Host font'), previewCss('FluentRead Preview Inter', '500'),
            previewCss('FluentRead Preview Inter', '400', 'https://example.test/font.woff2'),
            previewCss('FluentRead Preview Inter', '400', 'data:font/ttf;base64,d09GMg=='),
            previewCss('FluentRead Preview Inter', '400', 'data:font/woff2;base64,?'),
            previewCss('FluentRead Preview Inter', '400', 'data:font/woff2;base64,d09GMg='),
            previewCss('FluentRead Preview Inter', '400', 'data:font/woff2;base64,eA=='),
            previewCss().replace("format('woff2')", "format('woff2'), url('https://example.test/fallback.woff2')"),
        ].join('');
        await installUserscriptInterfaceFontPreviews(invalid).ready;
        expect(h.construct).not.toHaveBeenCalled();
        expect(h.registered.size).toBe(0);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('retains system fallback when the API is absent or font parsing fails', async () => {
        const h = previewHarness();
        h.load.mockRejectedValueOnce(new Error('decode failed'));
        const failed = installUserscriptInterfaceFontPreviews(previewCss());
        await expect(failed.ready).resolves.toBeUndefined();
        expect(h.registered.size).toBe(0);
        failed.dispose();
        vi.stubGlobal('FontFace', undefined);
        await installUserscriptInterfaceFontPreviews(previewCss()).ready;
        expect(h.construct).toHaveBeenCalledOnce();
        vi.stubGlobal('document', {});
        await installUserscriptInterfaceFontPreviews(previewCss()).ready;
        expect(h.construct).toHaveBeenCalledOnce();
    });
});
