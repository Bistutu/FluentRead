/**
 * @file src/app/options/aboutImages.ts
 * 文件职责：为关于页提供支持码与联系码的同步图像访问入口。
 * 主要内容：保留调用方捕获的支持图地址与原联系图资产；独立脚本仅在构建期替换为延迟恢复的相同接口。
 * 模块边界：不读取或写入宿主全局状态，不创建异步请求、对象 URL 或图像恢复副作用。
 */
import wechatContactUrl from './assets/wechat-contact.jpg';

/** 普通出口继续使用 Options setup 已捕获的全局图像或 public 路径。 */
export function getSupportImageUrl(normalUrl: string): string {
    return normalUrl;
}

/** 联系图仍由普通出口原有的本地 JPEG 资产管线提供。 */
export function getContactImageUrl(): string {
    return wechatContactUrl;
}
