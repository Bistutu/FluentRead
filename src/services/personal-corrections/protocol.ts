/**
 * @file src/services/personal-corrections/protocol.ts
 * 文件职责：定义个人校订在内容页、界面和后台之间的轻量消息协议。
 * 主要内容：列出显式查询、管理、项目选择和撤销动作，以及仅含变更信号的广播。
 * 模块边界：可序列化合同不读取网页或存储，不承载凭据、请求头或自动阅读历史。
 */
export const PERSONAL_CORRECTIONS_MESSAGE = 'fluentReadPersonalCorrections' as const;
export const PERSONAL_CORRECTIONS_CHANGED = 'fluentReadPersonalCorrectionsChanged' as const;
export interface PersonalCorrectionMessage {
    type: typeof PERSONAL_CORRECTIONS_MESSAGE;
    action?: unknown;
    query?: unknown;
    input?: unknown;
    id?: unknown;
    expectedRevision?: unknown;
    token?: unknown;
    label?: unknown;
    materialId?: unknown;
    projectId?: unknown;
}
export type PersonalCorrectionResponse<T> = {success: true; data: T} | {success: false; error: string};
