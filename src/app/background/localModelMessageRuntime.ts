/**
 * @file src/app/background/localModelMessageRuntime.ts
 * 文件职责：为后台消息组合根集中装配浏览器本地模型能力的公开处理器。
 * 主要内容：保持本地翻译、信息高亮、朗读的注册顺序与各自独立运行时，降低主消息文件的装配体积。
 * 模块边界：仅调用 feature 的后台组合出口，不共享模型、缓存、协议或算法，不额外注册 runtime listener。
 */
import {createLocalTranslationBackgroundRuntime} from '@/src/features/local-translation/background/runtime';
import {createInformationHighlightBackgroundRuntime} from '@/src/features/information-highlight/background/runtime';
import {createLocalTtsBackgroundRuntime} from '@/src/features/local-tts/background/runtime';
import type {BackgroundMessageHandler} from './messageRouter';

export function createLocalModelMessageHandlers<TContext>(): Array<BackgroundMessageHandler<TContext>> {
    return [
        ...createLocalTranslationBackgroundRuntime(),
        ...createInformationHighlightBackgroundRuntime(),
        ...createLocalTtsBackgroundRuntime(),
    ];
}
