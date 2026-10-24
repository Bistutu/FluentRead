/**
 * @file entrypoints/neteaseMailFrame.content.ts
 * 文件职责：只在网易免费邮箱页面及其 about:blank 正文子文档声明内容脚本。
 * 主要内容：为 163、126 和 yeah 邮箱启用 frame 注入，委托独立的网易应用装配器，运行时再核验阅读页与正文边界。
 * 模块边界：不扩大通用入口的注入范围，也不在登录或写信页面直接挂载翻译功能。
 */
import {startNeteaseMailFrameApp} from '@/src/app/content/neteaseMailFrameRuntime';
export default defineContentScript({
    matches: ['https://*.mail.163.com/*', 'https://*.mail.126.com/*', 'https://*.mail.yeah.net/*'],
    allFrames: true,
    matchAboutBlank: true,
    runAt: 'document_end',
    cssInjectionMode: 'ui',
    main: startNeteaseMailFrameApp,
});
