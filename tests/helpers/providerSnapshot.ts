/**
 * @file tests/helpers/providerSnapshot.ts
 * 文件职责：在 provider 直调测试的调用边界显式冻结并绑定配置，让测试不再依赖适配器读取全局 store。
 * 主要内容：保留已绑定快照与全部内部 symbol，缺省时从测试传入的配置创建本次只读快照。
 * 模块边界：仅为测试提供同步输入组装，不替换 provider、HTTP、结果验证或取消逻辑。
 */
import {attachTranslationProviderConfig, createTranslationProviderConfigSnapshot, getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import type {TranslationConfigSource} from '@/src/services/translation/types';

/** 最小完整配置夹具；测试覆盖项可显式覆写，未提供的连接字段采用空值。 */
export function providerConfigFixture(source: Partial<TranslationConfigSource>): TranslationConfigSource {
    return {
        service: '', from: 'auto', to: 'zh-Hans', useCache: true, enableAIContext: false,
        model: {}, customModel: {}, proxy: {}, custom: '', deeplx: '', newApiUrl: '',
        minimaxBillingPlan: 'payg', minimaxRegion: 'cn', mimoBillingPlan: 'payg', mimoRegion: 'cn',
        azureOpenaiEndpoint: '', customBody: {}, system_role: {}, user_role: {},
        deepseekApiType: 'chat_completions', deepseekThinkingMode: 'disabled', ...source,
    };
}

export function withProviderSnapshot<T extends object>(message: T, source: Partial<TranslationConfigSource>): T {
    const snapshot = getTranslationProviderConfig(message, () => createTranslationProviderConfigSnapshot(providerConfigFixture(source)));
    return attachTranslationProviderConfig({...message}, snapshot);
}
