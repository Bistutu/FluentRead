import type { OcrLine } from '@/entrypoints/utils/imageTranslationCore';

interface ImageOcrResponse {
    success: boolean;
    lines?: OcrLine[];
    error?: string;
}

interface ImageFetchResponse {
    success: boolean;
    image?: string;
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

export async function fetchImageInExtension(imageUrl: string): Promise<string> {
    const response = await browser.runtime.sendMessage({
        type: 'fluentReadImageFetch',
        url: imageUrl,
    }) as ImageFetchResponse | undefined;

    if (!response?.success || !response.image) {
        throw new Error(response?.error || '无法读取远程图片');
    }

    return response.image;
}
