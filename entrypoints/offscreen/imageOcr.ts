import { createWorker, PSM, type Worker } from 'tesseract.js';
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
    // 图片文字通常是分散在画面各处的气泡/标签，不是连续的网页段落。
    // Sparse text 能减少 Tesseract 把相邻控件合并成一个超大行框的情况。
    await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
    });
    const result = await worker.recognize(image, {}, { blocks: true });
    return normalizeOcrLines(result.data.blocks);
}
