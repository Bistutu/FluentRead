/**
 * @file tests/sentenceActionsMount.test.ts
 * 文件职责：验证页面学习功能不再为悬停高亮挂载额外句子入口。
 * 主要内容：覆盖不同浏览器、逐句高亮和划词开关组合，确认句子操作归已有划词卡片；渐进阅读主动入口与默认关闭的个人校订共存，油猴构建排除两项扩展专属功能。
 * 模块边界：只测试真实组合根，指针和选区由生产浏览器专项验证。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {resolveBrowserCapabilities} from '@/src/platform/browser/capabilities';
vi.mock('@/src/features/writing-assistant/public', () => ({
    mountWritingAssistant: vi.fn(), unmountWritingAssistant: vi.fn(), isWritingAssistantMounted: () => false,
}));
vi.mock('@/src/features/progressive-reading/public', () => ({mountProgressiveReading: vi.fn(), unmountProgressiveReading: vi.fn()}));
vi.mock('@/src/app/content/personalCorrections', () => ({mountPersonalCorrectionContent: vi.fn(), unmountPersonalCorrectionContent: vi.fn()}));
vi.mock('@/src/features/personal-corrections/public', () => ({unmountPersonalCorrections: vi.fn()}));
import {createLearningContentFeatures} from '@/src/app/content/learningFeatures';
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
afterEach(() => {vi.unstubAllEnvs();});

describe('sentence entry ownership', () => {
    it('油猴构建不登记渐进阅读及校订功能，避免引入空回调和管理面板', () => {
        vi.stubEnv('BROWSER', 'userscript');
        expect(createLearningContentFeatures({} as ContentScriptContext, new Config(), resolveBrowserCapabilities({browser: 'userscript', manifestVersion: 2})).map(feature => feature.id)).toEqual(['writing-assistant']);
        vi.unstubAllEnvs();
    });
    it.each(['chrome', 'firefox', 'userscript'] as const)(
        'does not add a hover entry on %s regardless of highlight or selection preferences', browser => {
            for (const highlighted of [false, true]) {
                for (const selectionMode of ['disabled', 'bilingual'] as const) {
                    const config = Object.assign(new Config(), {
                        bilingualSentenceHighlightEnabled: highlighted, selectionTranslatorMode: selectionMode,
                    });
                    const features = createLearningContentFeatures({} as ContentScriptContext, config,
                        resolveBrowserCapabilities({browser, manifestVersion: browser === 'chrome' ? 3 : 2}));
                    expect(features.map(feature => feature.id)).toEqual(['progressive-reading', 'personal-corrections', 'writing-assistant']);
                    expect(features[0].isEnabled()).toBe(browser !== 'userscript' && config.on);
                    expect(config.personalCorrectionsEnabled).toBe(false);
                    expect(features[1].isEnabled()).toBe(false);
                    config.personalCorrectionsEnabled = true;
                    expect(features[1].isEnabled()).toBe(browser !== 'userscript' && config.on);
                    config.on = false;
                    expect(features[0].isEnabled()).toBe(false);
                    expect(features[1].isEnabled()).toBe(false);
                }
            }
        },
    );

    it('excludes reading and enabled personal corrections from the userscript build even with injected extension capabilities', () => {
        vi.stubEnv('BROWSER', 'userscript');
        try {
            const config = Object.assign(new Config(), {personalCorrectionsEnabled: true});
            const features = createLearningContentFeatures({} as ContentScriptContext, config,
                resolveBrowserCapabilities({browser: 'chrome', manifestVersion: 3}));
            expect(features.map(feature => feature.id)).toEqual(['writing-assistant']);
        } finally {
            vi.unstubAllEnvs();
        }
    });
});
