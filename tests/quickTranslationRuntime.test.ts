import {beforeEach, describe, expect, it, vi} from 'vitest';
import {services} from '@/src/core/config/catalog';
import type {Config} from '@/src/core/config/model';
import type {QuickTranslationProfile} from '@/src/core/config/quickTranslation';

const mocks = vi.hoisted(() => ({
    mountedDependencies: null as Record<string, any> | null,
    autoTranslateEnglishPage: vi.fn(),
    cancelPendingHoverTranslation: vi.fn(),
    handleTranslation: vi.fn(),
    isFullPageTranslationActive: vi.fn(() => false),
    restoreOriginalContent: vi.fn(),
    startSectionTranslationPicker: vi.fn(),
    serviceAvailable: vi.fn(),
}));
vi.mock('@/src/services/translation/capabilities', () => ({isTranslationServiceAvailable: mocks.serviceAvailable}));

vi.mock('@/src/features/quick-translation/public', () => ({
    mountQuickTranslationContentFeature: (deps: Record<string, any>) => {
        mocks.mountedDependencies = deps;
    },
}));
vi.mock('@/src/features/full-page-translation/public', () => ({
    autoTranslateEnglishPage: mocks.autoTranslateEnglishPage,
    cancelPendingHoverTranslation: mocks.cancelPendingHoverTranslation,
    handleTranslation: mocks.handleTranslation,
    isFullPageTranslationActive: mocks.isFullPageTranslationActive,
    restoreOriginalContent: mocks.restoreOriginalContent,
}));

vi.mock('@/src/features/section-translation/public', () => ({startSectionTranslationPicker: mocks.startSectionTranslationPicker}));

import {mountConfiguredQuickTranslation} from '@/src/app/content/quickTranslationRuntime';

function profile(overrides: Partial<QuickTranslationProfile> = {}): QuickTranslationProfile {
    return {
        id: 'quick-1',
        enabled: true,
        action: 'hover',
        hotkey: 'Ctrl+T',
        service: services.openai,
        model: 'quick-model',
        targetLanguage: 'ja',
        displayMode: 'translation-only',
        fullPageMode: 'inherit',
        ...overrides,
    };
}

function config(): Config {
    return {
        service: services.microsoft,
        model: {[services.microsoft]: ''},
        customModel: {},
        to: 'zh-Hans',
        display: 1,
        fullPageTranslationMode: 'viewport',
        translationScope: 'content',
        customSelectionTranslatorHotkey: '',
    } as Config;
}

describe('快捷翻译 content composition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mountedDependencies = null;
        mocks.isFullPageTranslationActive.mockReturnValue(false);
        vi.stubGlobal('document', {addEventListener: vi.fn()});
        vi.stubGlobal('window', {});
    });

    it('外部全文生命周期解除旧方案身份，默认手势回调和服务可用性跟随当前配置', () => {
        const current = config();
        mountConfiguredQuickTranslation(current, {} as any, () => false, new AbortController().signal);
        const dependencies = mocks.mountedDependencies!;
        expect(dependencies.resetLegacyKeyboardGestures()).toBeUndefined();
        mocks.serviceAvailable.mockReturnValueOnce(false).mockReturnValueOnce(true);
        expect(dependencies.isProfileAvailable(profile({service: ''}))).toBe(false);
        current.service = services.google;
        expect(dependencies.isProfileAvailable(profile({service: ''}))).toBe(true);
        expect(mocks.serviceAvailable.mock.calls).toEqual([[services.microsoft], [services.google]]);
        let active = false;
        mocks.isFullPageTranslationActive.mockImplementation(() => active);
        mocks.autoTranslateEnglishPage.mockImplementation(() => {active = true;});
        mocks.restoreOriginalContent.mockImplementation(() => {active = false;});
        const selected = profile({action: 'full-page'});
        dependencies.runFullPage(selected);
        for (const type of ['fluentread-translation-started', 'fluentread-translation-ended']) {
            const listener = vi.mocked(document.addEventListener).mock.calls.find(([event]) => event === type)![1] as () => void;
            listener();
            dependencies.runFullPage(selected);
        }
        expect(mocks.autoTranslateEnglishPage).toHaveBeenCalledTimes(3);
        expect(mocks.restoreOriginalContent).toHaveBeenCalledTimes(3);
    });

    it('把每条悬停方案解析为独立请求覆盖后交给共享翻译引擎', () => {
        const current = config();
        mountConfiguredQuickTranslation(current, {
            shouldReserveSelectionShortcut: vi.fn(),
            getConfiguredSelectionHotkey: vi.fn(() => 'none'),
            hasActiveSelectionTranslationCandidate: vi.fn(() => false),
        } as any, () => false, new AbortController().signal);

        const selected = profile();
        mocks.mountedDependencies!.runHover(selected, 12, 34, {delayMs: 80, continuous: true});

        expect(mocks.handleTranslation).toHaveBeenCalledWith(12, 34, {
            profileId: 'quick-1',
            scope: 'content',
            service: services.openai,
            model: 'quick-model',
            targetLanguage: 'ja',
            displayMode: 'single',
            delayMs: 80,
            continuous: true,
        });
        expect(mocks.mountedDependencies!.cancelPendingHoverTranslation)
            .toBe(mocks.cancelPendingHoverTranslation);
    });

    it('三种快捷入口传递默认显示继承语义，调整全局模式后同一全文方案仍恢复原文', () => {
        let active = false;
        mocks.isFullPageTranslationActive.mockImplementation(() => active);
        mocks.restoreOriginalContent.mockImplementation(() => {active = false;});
        mocks.autoTranslateEnglishPage.mockImplementation(() => {active = true;});
        const current = config();
        mountConfiguredQuickTranslation(current, {} as any, () => false, new AbortController().signal);
        const deps = mocks.mountedDependencies!, selected = profile({displayMode: 'inherit'});
        deps.runHover(selected, 12, 34);
        deps.runSection({...selected, action: 'section'});
        deps.runFullPage({...selected, action: 'full-page'});
        for (const invocation of [mocks.handleTranslation.mock.calls[0][2],
            mocks.startSectionTranslationPicker.mock.calls[0][0], mocks.autoTranslateEnglishPage.mock.calls[0][0]]) {
            expect(invocation).toMatchObject({service: services.openai, model: 'quick-model', targetLanguage: 'ja'});
            expect(invocation).not.toHaveProperty('displayMode');
        }
        current.display = 0;
        deps.runFullPage({...selected, action: 'full-page'});
        expect(mocks.restoreOriginalContent).toHaveBeenCalledTimes(2);
        expect(mocks.autoTranslateEnglishPage).toHaveBeenCalledOnce();
    });

    it('邮件 frame 转发解析后的全文方案，并保留本地悬停执行器', () => {
        const forward = vi.fn();
        mountConfiguredQuickTranslation(config(), {} as any, () => false, new AbortController().signal, vi.fn(), forward);
        const selected = profile({action: 'full-page', fullPageMode: 'all'});
        mocks.mountedDependencies!.runFullPage(selected);
        expect(forward).toHaveBeenCalledWith({profileId: 'quick-1', scope: 'content', service: services.openai,
            model: 'quick-model', targetLanguage: 'ja', displayMode: 'single', fullPageMode: 'all'});
        expect(mocks.cancelPendingHoverTranslation).toHaveBeenCalledOnce();
        expect(mocks.autoTranslateEnglishPage).not.toHaveBeenCalled();
        expect(mocks.restoreOriginalContent).not.toHaveBeenCalled();
    });

    it('全文方案按独立范围启动、切换另一方案，并用同一方案恢复原文', () => {
        let active = false;
        mocks.isFullPageTranslationActive.mockImplementation(() => active);
        mocks.restoreOriginalContent.mockImplementation(() => { active = false; });
        mocks.autoTranslateEnglishPage.mockImplementation(() => { active = true; });
        const current = config();
        mountConfiguredQuickTranslation(current, {
            shouldReserveSelectionShortcut: vi.fn(),
            getConfiguredSelectionHotkey: vi.fn(() => 'none'),
            hasActiveSelectionTranslationCandidate: vi.fn(() => false),
        } as any, () => false, new AbortController().signal);
        const selected = profile({action: 'full-page', hotkey: 'Ctrl+Y', fullPageMode: 'all'});
        const second = profile({id: 'quick-2', action: 'full-page', hotkey: 'Ctrl+U',
            model: 'second-model', fullPageMode: 'viewport'});

        mocks.mountedDependencies!.runFullPage(selected);
        expect(mocks.autoTranslateEnglishPage).toHaveBeenCalledWith({
            profileId: 'quick-1',
            scope: 'content',
            service: services.openai,
            model: 'quick-model',
            targetLanguage: 'ja',
            displayMode: 'single',
            fullPageMode: 'all',
        });
        expect(mocks.restoreOriginalContent).toHaveBeenCalledOnce();

        mocks.mountedDependencies!.runFullPage(second);
        expect(mocks.restoreOriginalContent).toHaveBeenCalledTimes(2);
        expect(mocks.autoTranslateEnglishPage).toHaveBeenLastCalledWith(expect.objectContaining({
            profileId: 'quick-2', model: 'second-model', fullPageMode: 'viewport',
        }));

        mocks.mountedDependencies!.runFullPage(second);
        expect(mocks.restoreOriginalContent).toHaveBeenCalledTimes(3);
        expect(mocks.autoTranslateEnglishPage).toHaveBeenCalledTimes(2);
    });

    it('局部方案把独立请求设置交给容器选择器，保持默认页面配置', () => {
        const current = config();
        const before = JSON.stringify(current);
        mountConfiguredQuickTranslation(current, {} as any, () => false, new AbortController().signal);
        mocks.mountedDependencies!.runSection(profile({action: 'section'}));
        expect(mocks.startSectionTranslationPicker).toHaveBeenCalledWith({
            profileId: 'quick-1', scope: 'content', service: services.openai,
            model: 'quick-model', targetLanguage: 'ja', displayMode: 'single',
        });
        expect(mocks.handleTranslation).not.toHaveBeenCalled();
        expect(mocks.autoTranslateEnglishPage).not.toHaveBeenCalled();
        expect(JSON.stringify(current)).toBe(before);
    });
});
