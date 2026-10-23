/**
 * @file src/core/config/freeProviderOrigins.ts
 * 文件职责：为免费服务运行时和构建配置提供同一份精确请求域目录。
 * 主要内容：从标准 JSON 单一源读取当前十六个 provider 的二十个 HTTPS origin，包含初始化和内部备用端点，并冻结目录与各域列表；已退役节点不再进入授权和构建范围。
 * 模块边界：只提供纯数据，不读取浏览器、权限或配置；Node20 原生打包验证器直接读取同一 JSON，新增服务或请求域时必须同步目录并验证授权范围。
 */
import originsByProvider from './freeProviderOrigins.json';
import type {FreeTranslationProviderId} from './freeTranslation';

export const FREE_PROVIDER_ORIGINS: Readonly<Record<FreeTranslationProviderId, readonly string[]>> = /* @__PURE__ */ (() => {
    // 只冻结新建副本，不修改 JSON 导入对象；未使用目录的构建可删除整个纯初始化。
    const origins = Object.fromEntries(Object.entries(originsByProvider).map(([id, values]) => [id, Object.freeze([...values])])) as Record<FreeTranslationProviderId, readonly string[]>;
    return Object.freeze(origins);
})();
