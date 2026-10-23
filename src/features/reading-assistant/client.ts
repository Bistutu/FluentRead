/**
 * @file src/features/reading-assistant/client.ts
 * 文件职责：封装阅读助手的流式 runtime port、本机会话与长期学习记忆协议，向 UI 提供稳定的异步边界。
 * 主要内容：发送 run 请求、消费流式进度并统一持有取消；扩展重载后的远程取消失败不能中断本地清理，查询最近会话，并按白名单快照发送用户主动管理的记忆。
 * 模块边界：本文件不解析提示词、不保存 DOM 或密钥；后台负责模型调用、来源校验和数据持久化，组件负责展示和生命周期。
 */
import browser from 'webextension-polyfill';
import type {ReadingProgress, ReadingRequest, ReadingResponse, ReadingStreamMessage} from './types';
import type {HarnessSession, HarnessSessionSummary} from '@/src/services/harness/sessionTypes';
import type {LearningMemory, LearningMemoryInput} from '@/src/services/harness/learningMemory';

export type HarnessStreamHandlers = {
    progress?: (progress: ReadingProgress) => void;
    result?: (response: ReadingResponse) => void;
    error?: (error: Error) => void;
};

export function streamReading(request: ReadingRequest, handlers: HarnessStreamHandlers): {cancel: () => void} {
    const port = browser.runtime.connect({name: 'fluentReadHarnessStream'});
    let closed = false;
    const close = () => {
        closed = true;
        port.onMessage.removeListener?.(handleMessage);
        port.onDisconnect.removeListener?.(handleDisconnect);
        try { port.disconnect(); } catch { /* port 已断开。 */ }
    };
    const cancel = () => {
        if (closed) return;
        close();
        try {
            void browser.runtime.sendMessage({type: 'fluentReadHarness', action: 'cancel', requestId: request.requestId}).catch(() => undefined);
        } catch { /* 扩展重载可能同步撤销 runtime；端口与监听已释放，清理不再依赖远端应答。 */ }
    };
    const handleMessage = (rawMessage: unknown) => {
        if (closed || !rawMessage || typeof rawMessage !== 'object') return;
        const message = rawMessage as ReadingStreamMessage;
        if (message.requestId !== request.requestId) return;
        if (message.type === 'progress') handlers.progress?.(message.progress);
        else if (message.type === 'result') { close(); handlers.result?.(message.response); }
    };
    const handleDisconnect = () => {
        if (closed) return;
        close();
        handlers.error?.(new Error('阅读助手连接已断开，请重试。'));
    };
    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(handleDisconnect);
    try { port.postMessage(request); } catch { handleDisconnect(); }
    return {cancel};
}

async function sessionMessage<T>(message: Record<string, unknown>): Promise<T> {
    const response = await browser.runtime.sendMessage({type: 'fluentReadHarness', ...message}) as T & {success?: boolean; error?: string};
    if (response?.success !== true) throw new Error(response?.error || '会话操作失败');
    return response;
}

export async function listHarnessSessions(offset = 0): Promise<{sessions: HarnessSessionSummary[]; hasMore: boolean}> {
    return sessionMessage({action: 'sessions-list', offset});
}
export async function getHarnessSession(sessionId: string): Promise<HarnessSession | null> {
    const response = await sessionMessage<{session: HarnessSession | null}>({action: 'sessions-get', sessionId});
    return response.session;
}
export async function deleteHarnessSession(sessionId: string): Promise<void> { await sessionMessage({action: 'sessions-delete', sessionId}); }
export async function clearHarnessSessions(): Promise<void> { await sessionMessage({action: 'sessions-clear'}); }

export async function listLearningMemories(): Promise<LearningMemory[]> {
    const response = await sessionMessage<{memories: LearningMemory[]}>({action: 'memory-list'});
    return response.memories;
}
export async function saveLearningMemory(input: LearningMemoryInput): Promise<LearningMemory> {
    const response = await sessionMessage<{memory: LearningMemory}>({action: 'memory-save', input: {
        content: input.content, kind: input.kind, ...(input.id === undefined ? {} : {id: input.id}),
    }});
    return response.memory;
}
export async function deleteLearningMemory(id: string): Promise<void> { await sessionMessage({action: 'memory-delete', id}); }
export async function clearLearningMemories(): Promise<void> { await sessionMessage({action: 'memory-clear'}); }
