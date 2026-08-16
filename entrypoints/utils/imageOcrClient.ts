import type { OcrLine } from '@/entrypoints/utils/imageTranslationCore';

interface ImageTranslationLine extends OcrLine {
    backgroundColor: string;
}

interface ImageTranslationResponse {
    success: boolean;
    image?: string;
    lines?: ImageTranslationLine[];
    error?: string;
}

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

export async function translateImageInExtension(
    image: string,
    sourceLanguage: string,
    title: string,
): Promise<{ image: string; lines: ImageTranslationLine[] }> {
    const response = await browser.runtime.sendMessage({
        type: 'fluentReadImageTranslate',
        image,
        sourceLanguage,
        title,
    }) as ImageTranslationResponse | undefined;

    if (!response?.success || !response.image || !Array.isArray(response.lines)) {
        throw new Error(response?.error || '图片翻译服务不可用');
    }

    return { image: response.image, lines: response.lines };
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
