/**
 * @file src/app/selection/cardVisibility.ts
 * 文件职责：让独立 PDF 划词结果窗口跟随既有卡片的实际收起状态退出，避免配置变化留下空白窗口。
 * 主要内容：只观察调用方持有的卡片根的直接子节点，确认 tooltip 曾加入后才响应移除；同批添加与移除也保留出现记录，重复通知与停止后的回调均不重复退出。
 * 模块边界：只处理自有 DOM 可见性，不修改共享组件、翻译策略或配置；页面禁用与正常卸载须先停止观察，再销毁组件，保留各自的提示行为。
 */
export function observeNativePdfSelectionCard(root: HTMLElement, dismiss: () => void): () => void {
    let appeared = false;
    let dismissed = false;
    let disposed = false;
    const isCard = (node: Node): boolean => node.nodeType === 1 && (node as Element).classList.contains('fr-translation-tooltip');
    const sync = (records: MutationRecord[]) => {
        if (disposed || dismissed) return;
        const visible = Array.from(root.children).some(isCard);
        if (visible || records.some(record => Array.from(record.addedNodes).some(isCard))) appeared = true;
        if (!appeared || visible) return;
        dismissed = true;
        dismiss();
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, {childList: true});
    sync([]);
    return () => {disposed = true; observer.disconnect();};
}
