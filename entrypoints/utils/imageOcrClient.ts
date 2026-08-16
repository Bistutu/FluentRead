import type { OcrLine } from '@/entrypoints/utils/imageTranslationCore';

interface ImageOcrResponse {
    success: boolean;
    lines?: OcrLine[];
    error?: string;
}

export async function recognizeImageInExtension(image: string, sourceLanguage: string): Promise<OcrLine[]> {
    const response = await browser.runtime.sendMessage({
        type: 'fluentReadImageOcr',
        image,
        sourceLanguage,
    }) as ImageOcrResponse | undefined;

    if (!response?.success) {
        throw new Error(response?.error || '图片 OCR 服务不可用');
    }

    return response.lines || [];
}
