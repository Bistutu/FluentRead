import { config } from "@/entrypoints/utils/config";

/**
 * Chrome 内置翻译 API 服务
 * 基于 Chrome 浏览器的 Translation API 实现快速、安全的翻译
 * 
 * 使用 Chrome Offscreen API 在独立的 DOM 环境中运行翻译功能
 */

// 在 background script 中使用 offscreen API 处理翻译
async function translateWithOffscreen(message: any): Promise<any> {
    try {
        // 确保 offscreen 文档存在
        await ensureOffscreenDocument();

        // 向 offscreen 文档发送翻译请求
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'CHROME_TRANSLATE_OFFSCREEN',
                data: {
                    text: message.origin,
                    from: config.from,
                    to: config.to
                }
            }, (response: any) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });

        // 检查响应
        if (response && typeof response === 'object' && 'success' in response) {
            const typedResponse = response as { success: boolean; result?: string; error?: string };
            if (typedResponse.success) {
                return typedResponse.result;
            } else {
                throw new Error(typedResponse.error || '翻译失败');
            }
        }

        throw new Error('无效的响应格式');
    } catch (error) {
        console.error('Offscreen 翻译失败:', error);
        throw new Error(`Chrome Translation API 不可用：${error instanceof Error ? error.message : '未知错误'}`);
    }
}

// 确保 offscreen 文档存在
async function ensureOffscreenDocument() {
    try {
        // 检查是否已经有 offscreen 文档
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });

        if (existingContexts.length > 0) {
            return; // 已经存在
        }

        // 创建 offscreen 文档
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['DOM_SCRAPING'], // 使用 DOM_SCRAPING 原因来访问 Translation API
            justification: 'Chrome Translation API requires DOM context'
        });

        console.log('Offscreen 文档创建成功');
    } catch (error) {
        console.error('创建 offscreen 文档失败:', error);
        throw new Error('无法创建 offscreen 文档');
    }
}

// 主翻译函数
export default async function chromeTranslator(message: any): Promise<any> {
    // console.log('Chrome Translator 收到消息:', message);

    const text = message.origin;
    
    if (!text || typeof text !== 'string' || text.trim() === '') {
        // console.error('翻译文本为空或无效:', { text, type: typeof text, message });
        throw new Error('翻译文本不能为空');
    }

    // 检查是否在 background script 环境中
    if (typeof window === 'undefined') {
        // console.log('在 background script 中，使用 offscreen API');
        // 在 background script 中，使用 offscreen API
        return await translateWithOffscreen(message);
    }

    // 如果在其他环境中，抛出错误
    throw new Error('Chrome Translation API 只能在 Google Chrome 浏览器 v138 stable 版本以上使用');
}