import { config } from "@/entrypoints/utils/config";
import type { OcrLine } from "@/entrypoints/utils/imageTranslationCore";
import type { AreaTranslationSelection } from "@/entrypoints/utils/areaTranslationCore";
import type { ImageOcrLanguageCode } from "@/entrypoints/utils/imageOcrLanguages";
import type { OffscreenImageTranslationResult } from "@/entrypoints/offscreen/imageTranslation";

/**
 * Chrome 内置翻译 API 服务
 * 基于 Chrome 浏览器的 Translation API 实现快速、安全的翻译
 * 
 * 使用 Chrome Offscreen API 在独立的 DOM 环境中运行翻译功能
 */

let creatingOffscreenDocument: Promise<void> | null = null;

interface SelectionTtsOffscreenPayload {
    audioBase64?: string;
    contentType?: string;
    sourceUrl?: string;
    tabId: number;
    requestId: number;
}

async function sendOffscreenMessage(message: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({target: 'offscreen', ...message}, (response: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

// 在 background script 中使用 offscreen API 处理翻译
async function translateWithOffscreen(message: any): Promise<any> {
    try {
        // 确保 offscreen 文档存在
        await ensureOffscreenDocument();

        // 向 offscreen 文档发送翻译请求
        const response = await sendOffscreenMessage({
                type: 'CHROME_TRANSLATE_OFFSCREEN',
                data: {
                    text: message.origin,
                    from: config.from,
                    to: config.to
                }
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

// 确保 offscreen 文档存在；OCR 和音频共享同一个静态文档。
export async function ensureOffscreenDocument(): Promise<void> {
    if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== 'function') {
        throw new Error('当前浏览器不支持扩展 Offscreen 文档');
    }

    try {
        // 检查是否已经有 offscreen 文档
        if (typeof chrome.runtime.getContexts !== 'function') {
            throw new Error('当前浏览器不支持查询 Offscreen 文档');
        }
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });

        if (existingContexts.length > 0) {
            return; // 已经存在
        }

        if (!creatingOffscreenDocument) {
            creatingOffscreenDocument = chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['DOM_SCRAPING', 'AUDIO_PLAYBACK'],
                justification: 'FluentRead needs an extension-owned DOM for Translation API, OCR, and CSP-independent TTS playback',
            }).finally(() => {
                creatingOffscreenDocument = null;
            });
        }
        await creatingOffscreenDocument;

        console.log('Offscreen 文档创建成功');
    } catch (error) {
        console.error('创建 offscreen 文档失败:', error);
        throw new Error('无法创建 offscreen 文档');
    }
}

export async function playSelectionTtsWithOffscreen(payload: SelectionTtsOffscreenPayload): Promise<void> {
    await ensureOffscreenDocument();
    const response = await sendOffscreenMessage({
        type: 'PLAY_SELECTION_TTS',
        ...payload,
    });
    if (!response?.success) throw new Error(response?.error || 'Offscreen TTS 播放失败');
}

export async function stopSelectionTtsWithOffscreen(requestId?: number): Promise<void> {
    if (!chrome.offscreen || typeof chrome.runtime.getContexts !== 'function') return;
    const existingContexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
    if (existingContexts.length === 0) return;
    await sendOffscreenMessage({type: 'STOP_SELECTION_TTS', requestId});
}

// 在 offscreen 页面中运行本地 OCR，避免内容脚本从网页源启动扩展 worker 时被浏览器拦截。
export async function recognizeImageWithOffscreen(image: string, sourceLanguage: string): Promise<OcrLine[]> {
    await ensureOffscreenDocument();

    const response = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'FLUENT_READ_IMAGE_OCR_OFFSCREEN',
            image,
            sourceLanguage,
        }, (result: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });

    if (response?.success) return response.lines || [];
    throw new Error(response?.error || '图片 OCR 失败');
}

export async function translateImageWithOffscreen(
    image: string,
    sourceLanguage: string,
    title: string,
): Promise<OffscreenImageTranslationResult> {
    await ensureOffscreenDocument();

    const response = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'FLUENT_READ_IMAGE_TRANSLATE_OFFSCREEN',
            image,
            sourceLanguage,
            title,
        }, (result: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });

    if (response?.success) return response;
    throw new Error(response?.error || '图片翻译失败');
}

export async function translateAreaWithOffscreen(
    image: string,
    sourceLanguage: string,
    title: string,
    selection: AreaTranslationSelection,
): Promise<OffscreenImageTranslationResult> {
    await ensureOffscreenDocument();

    const response = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'FLUENT_READ_AREA_TRANSLATE_OFFSCREEN',
            image,
            sourceLanguage,
            title,
            selection,
        }, (result: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });

    if (response?.success) return response;
    throw new Error(response?.error || '圈选翻译失败');
}

export async function downloadImageOcrLanguagesWithOffscreen(languages: ImageOcrLanguageCode[]): Promise<void> {
    await ensureOffscreenDocument();

    const response = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'FLUENT_READ_IMAGE_OCR_DOWNLOAD_OFFSCREEN',
            languages,
        }, (result: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });

    if (!response?.success) throw new Error(response?.error || '图片 OCR 语言包下载失败');
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
