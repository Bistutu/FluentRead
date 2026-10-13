/**
 * @file src/ui/assets/serviceBrandIcons.ts
 * 文件职责：为共享服务图标提供同步的品牌路径访问口。
 * 主要内容：普通出口读取完整原 JSON，仅返回输入表实际拥有的品牌路径。
 * 模块边界：不判断服务能力、不改别名、不联网；独立脚本的无损表示由构建插件负责。
 */
import serviceBrandPaths from './serviceBrandPaths.json';

export function getServiceBrandIcon(service: string) {
    return Object.hasOwn(serviceBrandPaths, service)
        ? serviceBrandPaths[service as keyof typeof serviceBrandPaths]
        : undefined;
}
