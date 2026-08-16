import { createWorker, PSM, type Worker } from 'tesseract.js';
import { getOcrLanguages, normalizeOcrLines, type OcrLine } from '@/entrypoints/utils/imageTranslationCore';
import type { ImageOcrLanguageCode } from '@/entrypoints/utils/imageOcrLanguages';

let workerPromise: Promise<Worker> | null = null;
let workerLanguages = '';

function extensionAsset(path: string): string {
    const getRuntimeUrl = chrome.runtime.getURL as (assetPath: string) => string;
    return getRuntimeUrl(`/fluent-read-ocr/${path}`);
}

async function getOcrWorkerForLanguages(languageCodes: string): Promise<Worker> {
    const languages = languageCodes;
    if (workerPromise && workerLanguages === languages) return workerPromise;

    if (workerPromise) {
        const previousWorker = await workerPromise.catch(() => null);
        await previousWorker?.terminate().catch(() => undefined);
    }

    workerLanguages = languages;
    workerPromise = createWorker(languages, 1, {
        workerPath: extensionAsset('worker/worker.min.js'),
        corePath: extensionAsset('core'),
        cachePath: 'fluent-read-image-ocr',
        // 不再把 traineddata 打进扩展；Tesseract.js 会从 jsDelivr 按需下载，
        // 并将解压后的语言包缓存到 Offscreen Document 的 IndexedDB。
        // Offscreen 页面拥有扩展源，直接加载本地 worker 可避免 Blob Worker 的 CSP/源限制。
        workerBlobURL: false,
    }).catch(error => {
        workerPromise = null;
        workerLanguages = '';
        throw error;
    });

    return workerPromise;
}

async function getOcrWorker(sourceLanguage: string): Promise<Worker> {
    return getOcrWorkerForLanguages(getOcrLanguages(sourceLanguage).join('+'));
}

export async function recognizeImage(image: string, sourceLanguage: string): Promise<OcrLine[]> {
    const worker = await getOcrWorker(sourceLanguage);
    // 图片文字通常是分散在画面各处的气泡/标签，不是连续的网页段落。
    // Sparse text 能减少 Tesseract 把相邻控件合并成一个超大行框的情况。
    await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
    });
    const result = await worker.recognize(image, {}, { blocks: true });
    return normalizeOcrLines(result.data.blocks);
}

export async function downloadImageOcrLanguages(languages: ImageOcrLanguageCode[]): Promise<void> {
    if (languages.length === 0) return;
    await getOcrWorkerForLanguages(languages.join('+'));
}
