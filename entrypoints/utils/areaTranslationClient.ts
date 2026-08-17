import browser from 'webextension-polyfill';
import type { OcrLine } from '@/entrypoints/utils/imageTranslationCore';
import type { AreaTranslationSelection } from '@/entrypoints/utils/areaTranslationCore';

export interface AreaTranslationResult {
    image: string;
    lines: Array<OcrLine & { backgroundColor: string }>;
}

interface AreaTranslationResponse extends Partial<AreaTranslationResult> {
    success: boolean;
    error?: string;
}

export async function captureVisibleAreaInExtension(): Promise<string> {
    const response = await browser.runtime.sendMessage({ type: 'fluentReadAreaCapture' }) as { success?: boolean; image?: string; error?: string } | undefined;
    if (!response?.success || !response.image) {
        throw new Error(response?.error || '无法读取当前页面区域');
    }
    return response.image;
}

export async function translateCapturedAreaInExtension(
    image: string,
    selection: AreaTranslationSelection,
    sourceLanguage: string,
    title: string,
): Promise<AreaTranslationResult> {
    const response = await browser.runtime.sendMessage({
        type: 'fluentReadAreaTranslateCapture',
        image,
        selection,
        sourceLanguage,
        title,
    }) as AreaTranslationResponse | undefined;

    if (!response?.success || !response.image || !Array.isArray(response.lines)) {
        throw new Error(response?.error || '圈选翻译服务不可用');
    }

    return { image: response.image, lines: response.lines };
}
