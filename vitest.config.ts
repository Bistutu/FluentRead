import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import vue from '@vitejs/plugin-vue';

const configuredMaxWorkers = Number(process.env.FLUENTREAD_TEST_MAX_WORKERS);
const maxWorkers = Number.isInteger(configuredMaxWorkers) && configuredMaxWorkers > 0 ? configuredMaxWorkers : 2;

// 独立的 Vitest 配置（与 wxt 构建配置互不影响）
export default defineConfig({
    // 组件生命周期测试执行实际客户端 SFC 模板，让 V8 归因到原始 Vue 源码。
    plugins: [vue({include: [
        /\/src\/(?:features\/share-card\/ui\/ShareCardStudio|features\/selection-translation\/ui\/SelectionTranslator|features\/settings\/ui\/services\/RequestLimit(?:Settings|Fields)|features\/reading-assistant\/ui\/[^/]+|ui\/components\/(?:MarkdownContent|MarkdownTable|[^/]*Reading[^/]*)|features\/image-translation\/ui\/MangaEntry|app\/document-translation\/(?:DocumentApp|DocumentSegmentEditor)|ui\/components\/(?:CustomHotkeyInput|UiSelect|GlossaryLibrarySelect|ServiceIcon|TranslationLoadingPreview|UiIcon|FeatureEnableCard)|features\/settings\/ui\/components\/(?:FieldHelp|InterfaceSkinPreview|PopupLayoutPreview|PopupLayoutPreviewItem|SettingsGroup|SettingsItem|TranslationColorField|TranslationStylePreview|WritingStylePreview|SegmentedControl))\.vue$/,
        resolve(__dirname, 'src/features/document-translation/ui/PdfReader.vue'),
        resolve(__dirname, 'src/features/video-subtitle/ui/VideoSentenceLearning.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/BrandReader.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/BrowserGlyph.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/BrowserGuide.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/BrowserInstall.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/DemoSteps.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/DocsHome.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/DocumentDemo.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/ExtensionMenuPreview.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/FeatureDemo.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/GrammarDemo.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/GuideLayout.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/GuideVisual.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/HeroOrbit.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/LandingHeader.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/ProductHome.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/ProductHomeEn.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/PromoVideo.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/SettingsGuide.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/SiteHome.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/StepCallout.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/SupportOptions.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/TransferFlow.vue'),
        resolve(__dirname, 'docs/.vitepress/theme/TranslationDemo.vue'),
        resolve(__dirname, 'src/features/area-translation/ui/AreaTranslator.vue'),
        resolve(__dirname, 'src/features/floating-ball/ui/FloatingBall.vue'),
        resolve(__dirname, 'src/features/glossary/ui/BuiltinGlossaries.vue'),
        resolve(__dirname, 'src/features/glossary/ui/GlossarySettings.vue'),
        resolve(__dirname, 'src/features/image-translation/ui/ImageOcrSettings.vue'),
        resolve(__dirname, 'src/features/image-translation/ui/MangaModelSettings.vue'),
        resolve(__dirname, 'src/features/image-translation/ui/MangaSettings.vue'),
        resolve(__dirname, 'src/features/settings/ui/CloudConfigBackup.vue'),
        resolve(__dirname, 'src/features/settings/ui/services/ChatGPTPlanSettings.vue'),
        resolve(__dirname, 'src/features/settings/ui/ConfigManagement.vue'),
        resolve(__dirname, 'src/features/settings/ui/GoogleDriveSync.vue'),
        resolve(__dirname, 'src/features/settings/ui/LearningMemoryManager.vue'),
        resolve(__dirname, 'src/features/settings/ui/LocalDataManagement.vue'),
        resolve(__dirname, 'src/features/settings/ui/LocalTtsSettings.vue'),
        resolve(__dirname, 'src/features/settings/ui/RemoteConfigSync.vue'),
        resolve(__dirname, 'src/features/settings/ui/SentenceHighlightStyleSettings.vue'),
        resolve(__dirname, 'src/features/settings/ui/TranslationCacheSettings.vue'),
        resolve(__dirname, 'src/features/settings/ui/VideoLocalModelSettings.vue'),
        resolve(__dirname, 'src/features/settings/ui/VideoSentenceLearningAppearanceSettings.vue'),
        resolve(__dirname, 'src/features/settings/ui/WebDavBackup.vue'),
        resolve(__dirname, 'src/features/settings/ui/components/SettingsPanel.vue'),
        resolve(__dirname, 'src/features/settings/ui/components/SettingsPreviewLayout.vue'),
        resolve(__dirname, 'src/features/settings/ui/components/PopupPreview.vue'),
        resolve(__dirname, 'src/ui/components/DownloadProgress.vue'),
        resolve(__dirname, 'src/features/image-translation/ui/ImageTranslationSettingsPreview.vue'),
        resolve(__dirname, 'src/features/selection-translation/ui/SpeechFollowText.vue'),
        resolve(__dirname, 'src/features/writing-assistant/ui/WritingChoices.vue'),
        resolve(__dirname, 'src/features/writing-assistant/ui/WritingLanguagePicker.vue'),
        resolve(__dirname, 'src/features/writing-assistant/ui/WritingPanel.vue'),
        resolve(__dirname, 'src/features/writing-assistant/ui/WritingPopover.vue'),
        resolve(__dirname, 'src/features/writing-assistant/ui/WritingStyleEditor.vue'),
        resolve(__dirname, 'src/features/personal-corrections/ui/PersonalCorrectionPanel.vue'),
        resolve(__dirname, 'userscript/SettingsPanel.vue'),
    ]})],
    resolve: {
        alias: {
            // 与 wxt 一致：'@' 指向项目根目录
            '@': resolve(__dirname, '.'),
        },
    },
    test: {
        environment: 'node',
        testTransformMode: {web: ['**/tests/chatgptPlanSettingsLifecycle.test.ts', '**/tests/videoSentenceLearningAppearanceSettingsLifecycle.test.ts', '**/tests/personalCorrectionUiPanel.test.ts', '**/tests/pdfReaderLifecycle.test.ts', '**/tests/finalCoveragePublicBoundariesA.test.ts', '**/tests/implementationAudit49A.test.ts', '**/tests/implementationAudit49B.test.ts', '**/tests/implementationAudit49C.test.ts', '**/tests/implementationAudit49E.test.ts', '**/tests/implementationAudit49F.test.ts', '**/tests/implementationAudit49H.test.ts', '**/tests/implementationAudit48J.test.ts', '**/tests/implementationAudit48I.test.ts', '**/tests/implementationAudit48C.test.ts', '**/tests/implementationAudit48E.test.ts', '**/tests/mangaEntryComponentLifecycle.test.ts', '**/tests/customHotkeyInputLifecycle.test.ts', '**/tests/sharedUiComponentsLifecycle.test.ts', '**/tests/documentAppLifecycle.test.ts', '**/tests/documentUserActions.test.ts']},
        include: ['tests/**/*.test.ts'],
        globalSetup: ['./scripts/testing/vitest-resource-lock.mjs'],
        maxWorkers,
        minWorkers: 1,
        fileParallelism: false,
        // 页内样式契约执行四份实际 CSS，避免空 inline 样式掩盖命名或所有权回归。
        css: {include: [/(?:src\/app\/content\/page|src\/ui\/styles\/(?:translation-display|bilingual-sentence-highlight|vocabulary-reencounter))\.css(?:\?|$)/]},
    },
});
