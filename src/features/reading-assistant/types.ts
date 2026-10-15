/**
 * @file src/features/reading-assistant/types.ts
 * 文件职责：声明划词阅读卡与后台 Harness 之间的可序列化请求和回答契约。
 * 主要内容：限定选区快照及只在客户端使用的材料来源、近期问答、流式增量、持久会话及后台签发的追问锚点和取消消息；传输内容不包含密钥、DOM 节点或页面 URL。
 * 模块边界：这里只定义类型，页面负责捕获用户选中的正文，后台负责校验、模型请求和内核运行。
 */
import type {HarnessActionId} from '@/src/core/config/harness';
import type {MaterialSelection} from '@/src/features/vocabulary/material/protocol';

export interface ReadingSelection {
    text: string;
    context: string;
    sentence: string;
    /** 仅供本机学习关联，调用模型时必须移除此字段。 */
    material?: MaterialSelection;
}

export interface ReadingTurn {
    question: string;
    answer: string;
}

export interface ReadingRequest {
    type: 'fluentReadHarness';
    action: 'run';
    requestId: string;
    selection: ReadingSelection;
    intent: HarnessActionId;
    /** 学习中心的定向任务，提示词在后台组装；question 仅保存用户可读的问题或造句。 */
    studyMode?: 'understand' | 'use' | 'sentence';
    question: string;
    history?: ReadingTurn[];
    sessionId?: string;
    anchorTurnId?: string;
}

export interface ReadingCancelRequest {
    type: 'fluentReadHarness';
    action: 'cancel';
    requestId: string;
}

export type ReadingResponse =
    | {success: true; text: string; service: string; model: string; sessionId?: string; turnId?: string; persistenceWarning?: string; memoryCount?: number}
    | {success: false; error: string; cancelled?: boolean};

export type ReadingProgress =
    | {kind: 'model'; service: string; model: string}
    | {kind: 'memory'; count: number; warning?: string}
    | {kind: 'text'; text: string}
    | {kind: 'session'; sessionId?: string; turnId?: string; persistent: boolean; warning?: string};

export type ReadingStreamMessage =
    | {type: 'progress'; requestId: string; progress: ReadingProgress}
    | {type: 'result'; requestId: string; response: ReadingResponse};
