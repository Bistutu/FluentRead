/**
 * @file src/app/popup/pageContracts.ts
 * 文件职责：提供 Popup 页面操作共用的标签页类型契约。
 * 主要内容：保留浏览器返回的标签页标识、窗口标识和当前或待导航地址，让各个操作控制器通过注入端口接收同一种结构。
 * 模块边界：仅导出类型，不依赖控制器、浏览器运行时或功能实现，避免控制器之间形成类型依赖环。
 */
export interface PopupActiveTab {id?: number; windowId?: number; url?: string; pendingUrl?: string}
