/**
 * @file tests/sentenceActionsMount.test.ts
 * 文件职责：验证页面学习功能不再为悬停高亮挂载额外句子入口。
 * 主要内容：覆盖不同浏览器、逐句高亮和划词开关组合，确认句子操作归已有划词卡片，渐进阅读只加入主动功能定义。
 * 模块边界：只测试真实组合根，指针和选区由生产浏览器专项验证。
 */
import {describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {resolveBrowserCapabilities} from '@/src/platform/browser/capabilities';
vi.mock('@/src/features/writing-assistant/public', () => ({
    mountWritingAssistant: vi.fn(), unmountWritingAssistant: vi.fn(), isWritingAssistantMounted: () => false,
}));
vi.mock('@/src/features/progressive-reading/public', () => ({mountProgressiveReading: vi.fn(), unmountProgressiveReading: vi.fn()}));
import {createLearningContentFeatures} from '@/src/app/content/learningFeatures';
import type {ContentScriptContext} from 'wxt/utils/content-script-context';

describe('sentence entry ownership', () => {
    it.each(['chrome', 'firefox', 'userscript'] as const)(
        'does not add a hover entry on %s regardless of highlight or selection preferences', browser => {
            for (const highlighted of [false, true]) {
                for (const selectionMode of ['disabled', 'bilingual'] as const) {
                    const config = Object.assign(new Config(), {
                        bilingualSentenceHighlightEnabled: highlighted, selectionTranslatorMode: selectionMode,
                    });
                    const features = createLearningContentFeatures({} as ContentScriptContext, config,
                        resolveBrowserCapabilities({browser, manifestVersion: browser === 'chrome' ? 3 : 2}));
                    expect(features.map(feature => feature.id)).toEqual(['progressive-reading', 'writing-assistant']);
                    expect(features[0].isEnabled()).toBe(browser !== 'userscript' && config.on);
                }
            }
        },
    );

    it('excludes progressive reading from the userscript build even with injected extension capabilities', () => {
        vi.stubEnv('BROWSER', 'userscript');
        try {
            const features = createLearningContentFeatures({} as ContentScriptContext, new Config(),
                resolveBrowserCapabilities({browser: 'chrome', manifestVersion: 3}));
            expect(features.map(feature => feature.id)).toEqual(['writing-assistant']);
        } finally {
            vi.unstubAllEnvs();
        }
    });
});
