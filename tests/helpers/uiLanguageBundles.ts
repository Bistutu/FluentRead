/**
 * @file tests/helpers/uiLanguageBundles.ts
 * 文件职责：为需要完整语言目录的测试注册真实资源，避免把测试便利函数放进生产出口。
 * 主要内容：复用生产注册器与构建期资源目录；注册表身份仍由测试当前模块实例决定。
 * 模块边界：只在测试引用，不进入扩展或 userscript 构建。
 */
import {registerUiLanguageBundle} from '@/src/core/i18n';
import {UI_LANGUAGE_BUNDLES} from '@/src/core/i18n/bundles';
import type {RegisteredUiLanguage} from '@/src/core/i18n/types';
export {UI_LANGUAGE_BUNDLES, createUiLanguageBundleFiles, createExtensionMetadataLocaleFiles} from '@/src/core/i18n/bundles';
export function registerAllUiLanguageBundles(): void {
    for (const [language, bundle] of Object.entries(UI_LANGUAGE_BUNDLES)) {
        registerUiLanguageBundle(language as RegisteredUiLanguage, bundle);
    }
}
