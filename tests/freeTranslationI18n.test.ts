import {describe, expect, it, vi} from 'vitest';
import {translate, translateLegacyText} from '@/src/core/i18n';
import type {UiLanguage} from '@/src/core/i18n';
import {registerAllUiLanguageBundles} from './helpers/uiLanguageBundles';
import {options} from '@/src/core/config/catalog';
import {FREE_TRANSLATION_PROVIDERS} from '@/src/core/config/freeTranslation';
import {createUiI18nContext, localizeServiceOptions} from '@/src/ui/i18n';

// 目录文案执行实际 UI 展示链；只隔离持久化、浏览器和资源加载端口。
const configPort = vi.hoisted(() => ({language: 'zh-CN'}));
vi.mock('@/src/services/config/store', () => ({
  config: {get uiLanguage() {return configPort.language;}}, configReady: Promise.resolve(),
  getConfigRevision: () => 0, subscribeConfig: () => () => undefined,
  requestConfigPatch: () => {throw new Error('Service copy checks must not persist configuration');},
}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {
  sendMessage: () => {throw new Error('Service copy checks must not send browser messages');},
}}}));
vi.mock('@/src/platform/i18n/uiLanguageBundles', () => ({
  ensureUiLanguageBundle: async () => true,
}));

// 扩展运行时按需加载界面语言；本文件验证全部语言的文案契约，因此一次注册全部资源包。
registerAllUiLanguageBundles();

const languages: UiLanguage[] = ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'];
const sources = ['免费', '推荐', 'B站翻译', '官方免费文本 API，Index-Translate-35B-A3B，无需密钥', '自动均衡', '自动分配', '实验候选', '网络问题通常几分钟后重试；限流按服务提示恢复；拦截可能需要几小时；日额度通常隔天恢复。', '实验性网页接口，可能触发访问验证', '官方网页接口，无需密钥', '阿里翻译'];

describe('free translation legacy text localization', () => {
  it.each(languages)('%s localizes the native batch switch and its help', language => {
    for (const key of ['settings.services.nativeBatch.label', 'settings.services.nativeBatch.help']) {
      const value = translate(key, language);
      expect(value).not.toBe(key);
      expect(value).not.toBe(translate(key, 'zh-CN'));
      expect(value.trim()).not.toBe('');
    }
  });
  it('localizes the free unofficial badge independently from the DeepLX name', () => {
    const labels = {'zh-CN': '免费 · 非官方', 'en-US': 'Free · Unofficial', 'ja-JP': '無料 · 非公式', 'ko-KR': '무료 · 비공식', 'fr-FR': 'Gratuit · Non officiel', 'ru-RU': 'Бесплатно · Неофициально', 'es-ES': 'Gratis · No oficial'};
    for (const [language, label] of Object.entries(labels)) {
      expect(translate('settings.services.library.freeUnofficial', language as UiLanguage)).toBe(label);
    }
    expect(options.services.find(item => item.value === 'deeplx')?.label).toBe('DeepLX');
  });

  // 全目录名称与说明执行设置页的实际 localizeServiceOptions；旧入口短说明也保留翻译契约。
  it.each(languages)('%s translates every service label, description and description summary', language => {
    configPort.language = language;
    const context = createUiI18nContext();
    try {
      const localized = localizeServiceOptions(options.services, [], context.translateLegacy);
      expect(localized.map(item => item.value)).toEqual(options.services.map(item => item.value));
      for (const [index, source] of options.services.entries()) {
        const rendered = localized[index]!;
        const copy = [{source: source.label, translated: rendered.label}, ...(source.description ? [
          {source: source.description, translated: rendered.description},
          {source: source.description.split('；')[0]!, translated: context.translateLegacy(source.description.split('；')[0]!)},
        ] : [])];
        for (const entry of copy.filter(item => /[\u3400-\u9fff]/u.test(item.source))) {
          expect(entry.translated, `${language} ${source.value}: ${entry.source}`).toBeTruthy();
          expect(entry.translated, `${language} ${source.value}: ${entry.source}`).not.toBe(entry.source);
          if (language !== 'ja-JP') expect(entry.translated, `${language} ${source.value}: ${entry.source}`).not.toMatch(/[\u3400-\u9fff]/u);
        }
      }
    } finally {context.dispose();}
  });

  it.each(languages)('%s translates new free-service labels and guidance', language => {
    for (const source of sources) {
      const translated = translateLegacyText(source, language);
      expect(translated, `${language}: ${source}`).not.toBe(source);
      expect(translated).not.toContain('实验性');
    }
  });

  it.each(languages)('%s localizes every free-pool label and endpoint description', language => {
    for (const {label, description} of FREE_TRANSLATION_PROVIDERS) {
      for (const source of [label, description].filter(source => /[\u3400-\u9fff]/u.test(source))) {
        const localized = translateLegacyText(source, language);
        expect(localized, `${language}: ${source}`).not.toBe(source);
        if (language !== 'ja-JP') expect(localized).not.toMatch(/[\u3400-\u9fff]/u);
      }
    }
  });

  it.each(languages)('%s localizes Doubao web failures with safe HTTP and business codes', language => {
    const failures = ['豆包网页翻译不支持当前目标语言', '豆包网页翻译仅支持文本输入', '豆包网页翻译访客初始化失败', '豆包网页翻译请求失败', '豆包网页翻译返回的流数据无效', '豆包网页翻译返回的译文不完整', '当前运行环境无法发送豆包匿名访客请求。', '豆包匿名访客请求需要脚本管理器的跨域请求能力。', '豆包网页翻译访客初始化失败: 403', '豆包网页翻译请求失败: 429', '豆包网页翻译访客初始化失败（错误码 1001）', '豆包网页翻译请求失败（错误码 1002）'];
    for (const failure of failures) {
      const localized = translateLegacyText(failure, language);
      expect(localized, `${language}: ${failure}`).not.toBe(failure);
      if (language !== 'ja-JP') expect(localized).not.toMatch(/[\u3400-\u9fff]/u);
      const code = failure.match(/\d+/u)?.[0];
      if (code) expect(localized).toContain(code);
    }
  });
});
