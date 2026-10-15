/**
 * @file src/features/full-page-translation/content/styleRoots.ts
 * 文件职责：把翻译实际使用的开放 ShadowRoot 通知给内容组合根，保证独立样式树中的译文使用公共排版。
 * 主要内容：按节点所在的真实根判定开放边界，同步通知已注册样式安装器；订阅只持有安装器，不保留宿主节点或 ShadowRoot，关闭后立即释放监听。
 * 模块边界：不读取配置、不持有 CSS、不创建样式或观察器；renderer 和 runtime 请求样式，app/pageStyles 拥有注入与清理，闭合 ShadowRoot 保持隔离。
 */
const listeners = new Set<(root: ShadowRoot) => void>();

export function subscribeTranslationStyleRoots(listener: (root: ShadowRoot) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** 只处理真实开放根；document、普通 Fragment 与闭合组件均不扩大样式作用域。 */
export function prepareTranslationStyleRoot(node: Node): void {
    const root = node.getRootNode();
    if (root.nodeType !== 11 || !('host' in root) || (root as ShadowRoot).host.shadowRoot !== root) return;
    for (const listener of listeners) listener(root as ShadowRoot);
}
