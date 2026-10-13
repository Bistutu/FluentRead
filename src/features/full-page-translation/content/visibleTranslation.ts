/**
 * @file src/features/full-page-translation/content/visibleTranslation.ts
 * 文件职责：向页内阅读绘制功能提供仅译文模式的受控只读文字根入口。
 * 主要内容：以弱映射登记渲染器创建的闭合译文根，只在宿主仍连接且属于原文槽时返回；不枚举或保留已恢复页面的宿主，不暴露扩展交互 UI。
 * 模块边界：不改变 ShadowRoot 的 closed 属性、不拦截 attachShadow、不写宿主节点；登记只由全文渲染器使用，外部公共面仅提供查询。
 */
const visibleRoots = new WeakMap<Element, ShadowRoot>();
export function registerVisibleTranslationRoot(host: Element, root: ShadowRoot): void {visibleRoots.set(host, root);}
export function readVisibleTranslationRoot(host: Element): ShadowRoot | undefined {
    return host.isConnected && host.matches('.fluent-read-single-slot[data-fr-translation-owned="true"]') ? visibleRoots.get(host) : undefined;
}
