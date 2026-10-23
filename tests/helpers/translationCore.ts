/** 使用生产候选核心和默认站点目录构造独立测试实例，避免污染当前页面的模块级核心缓存。 */
import {TranslationCandidateCore, type TranslationCoreOptions} from '@/src/core/translation/public';
import {defaultTranslationAdapters} from '@/src/core/translation/registry';

export function createTranslationCore(options: TranslationCoreOptions = {}): TranslationCandidateCore {
    return new TranslationCandidateCore({...options, adapters: options.adapters ?? defaultTranslationAdapters});
}
