/**
 * @file src/app/popup/sourceTab.ts
 * 文件职责：决定默认 Popup 操作的网页来源，保持页内面板与发起悬浮球操作的标签页关联。
 * 主要内容：优先使用后台授权的来源，其余扩展页面可解析唯一的固定来源参数；普通工具栏 Popup 查询当前网页，固定来源只读取指定标签页。
 * 模块边界：仅通过注入端口读取标签页，不调用浏览器 API、不改变活动窗口，也不在来源失效时选择其他网页。
 */
import type {PopupActiveTab} from './pageContracts';

export interface PopupTabSourcePorts {
    get(tabId: number): Promise<PopupActiveTab>;
    query(): Promise<PopupActiveTab[]>;
}

/** 固定来源参数即使无效也保持固定模式，避免把操作意图转交给当前窗口中的其他网页。 */
export function createPopupTabSource(search: string, ports: PopupTabSourcePorts, authorizedTabId: number | null = null) {
    const values = new URLSearchParams(search).getAll('sourceTabId');
    const fixed = authorizedTabId !== null || values.length > 0;
    const parsed = authorizedTabId !== null ? authorizedTabId
        : values.length === 1 && /^(?:0|[1-9]\d*)$/u.test(values[0]) ? Number(values[0]) : NaN;
    const sourceTabId = Number.isSafeInteger(parsed) ? parsed : null;
    return {
        fixed,
        sourceTabId,
        async getTab(): Promise<PopupActiveTab | undefined> {
            if (!fixed) return (await ports.query())[0];
            if (sourceTabId === null) throw new TypeError('无效的 Popup 来源标签页');
            return ports.get(sourceTabId);
        },
    };
}
