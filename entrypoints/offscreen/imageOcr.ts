import { createWorker, type Worker } from 'tesseract.js';
import { getOcrLanguages, normalizeOcrLines, type OcrLine } from '@/entrypoints/utils/imageTranslationCore';

let workerPromise: Promise<Worker> | null = null;
let workerLanguages = '';

function extensionAsset(path: string): string {
    const getRuntimeUrl = chrome.runtime.getURL as (assetPath: string) => string;
    return getRuntimeUrl(`/fluent-read-ocr/${path}`);
}

async function getOcrWorker(sourceLanguage: string): Promise<Worker> {
    const languages = getOcrLanguages(sourceLanguage).join('+');
    if (workerPromise && workerLanguages === languages) return workerPromise;

    if (workerPromise) {
        const previousWorker = await workerPromise.catch(() => null);
        await previousWorker?.terminate().catch(() => undefined);
    }

    workerLanguages = languages;
    workerPromise = createWorker(languages, 1, {
        workerPath: extensionAsset('worker/worker.min.js'),
        corePath: extensionAsset('core'),
        langPath: extensionAsset('lang'),
        cachePath: 'fluent-read-image-ocr',
        gzip: true,
        // Offscreen 页面拥有扩展源，直接加载本地 worker 可避免 Blob Worker 的 CSP/源限制。
        workerBlobURL: false,
    });

    return workerPromise;
}

export async function recognizeImage(image: string, sourceLanguage: string): Promise<OcrLine[]> {
    const worker = await getOcrWorker(sourceLanguage);
    const result = await worker.recognize(image, {}, { blocks: true });
    return normalizeOcrLines(result.data.blocks);
}
