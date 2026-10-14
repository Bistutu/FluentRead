/**
 * @file src/app/background/handlers/freeTranslationWeights.ts
 * 文件职责：把免费翻译权重快照安全地提供给扩展设置页。
 * 主要内容：限制调用来源为 options 页面，等待配置初始化后返回不含凭据的当前权重。
 * 模块边界：不执行翻译、不读取页面内容；快照计算和后台健康状态分别由 provider 与 translation service 负责。
 */
import {
    FREE_TRANSLATION_WEIGHTS_MESSAGE_TYPE,
    type FreeTranslationWeightSnapshot,
    type FreeTranslationWeightsResponse,
} from '@/src/services/translation/freeWeights';
import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';

export interface FreeTranslationWeightsMessage {
    type: typeof FREE_TRANSLATION_WEIGHTS_MESSAGE_TYPE;
}

export interface FreeTranslationWeightsDependencies {
    readonly ready: Promise<unknown>;
    readonly getSnapshot: () => Promise<FreeTranslationWeightSnapshot>;
    readonly isOptionsUrl: (url: string) => boolean;
}

function senderUrl(context: unknown): string {
    if (!context || typeof context !== 'object') return '';
    const sender = (context as {sender?: unknown}).sender;
    if (!sender || typeof sender !== 'object') return '';
    const url = (sender as {url?: unknown}).url;
    return typeof url === 'string' ? url : '';
}

/** 权重仅服务于设置页，避免把后台健康细节扩散到宿主页面或普通 content 消息。 */
export function createFreeTranslationWeightsHandler(
    dependencies: FreeTranslationWeightsDependencies,
): BackgroundMessageHandler<unknown, FreeTranslationWeightsMessage, FreeTranslationWeightsResponse> {
    return {
        type: FREE_TRANSLATION_WEIGHTS_MESSAGE_TYPE,
        async handle(_message, context) {
            if (!dependencies.isOptionsUrl(senderUrl(context))) throw new Error('当前上下文无权访问免费翻译权重');
            await dependencies.ready;
            return {success: true, snapshot: await dependencies.getSnapshot()};
        },
    };
}
