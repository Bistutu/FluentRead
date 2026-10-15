/**
 * @file src/core/config/freeProviderOrigins.ts
 * 文件职责：为免费服务运行时和构建配置提供同一份精确请求域目录。
 * 主要内容：从标准 JSON 单一源读取十七个 provider 的二十一个 HTTPS origin，包含初始化和内部备用端点，并冻结目录与各域列表。
 * 模块边界：只提供纯数据，不读取浏览器、权限或配置；Node20 原生打包验证器直接读取同一 JSON，新增服务或请求域时必须同步目录并验证授权范围。
 */
import originsByProvider from './freeProviderOrigins.json';
import type {FreeTranslationProviderId} from './freeTranslation';

for (const origins of Object.values(originsByProvider)) Object.freeze(origins);
export const FREE_PROVIDER_ORIGINS: Readonly<Record<FreeTranslationProviderId, readonly string[]>> = Object.freeze(originsByProvider);
