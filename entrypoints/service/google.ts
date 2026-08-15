import {config} from "@/entrypoints/utils/config";

const GOOGLE_TRANSLATE_RPC_ID = 'MkEWBc';
const GOOGLE_TRANSLATE_URL = `https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?rpcids=${GOOGLE_TRANSLATE_RPC_ID}`;
const GOOGLE_TRANSLATE_TIMEOUT_MS = 15_000;

function createGoogleBatchRequest(text: string, fromLang: string, toLang: string): string {
    const request = JSON.stringify([[text, fromLang, toLang, true], [null]]);
    return JSON.stringify([[[GOOGLE_TRANSLATE_RPC_ID, request, null, 'generic']]]);
}

export function parseGoogleBatchResponse(responseBody: string): string {
    const lines = responseBody
        .replace(/^\)\]\}'(?:\r?\n)?/, '')
        .split(/\r?\n/);

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine.startsWith('[')) {
            continue;
        }

        let records: unknown;
        try {
            records = JSON.parse(trimmedLine);
        } catch {
            continue;
        }

        if (!Array.isArray(records)) {
            continue;
        }

        for (const record of records) {
            if (
                !Array.isArray(record)
                || record[0] !== 'wrb.fr'
                || record[1] !== GOOGLE_TRANSLATE_RPC_ID
                || typeof record[2] !== 'string'
            ) {
                continue;
            }

            let payload: unknown;
            try {
                payload = JSON.parse(record[2]);
            } catch {
                continue;
            }

            const segments = (payload as any)?.[1]?.[0]?.[0]?.[5];
            if (!Array.isArray(segments)) {
                continue;
            }

            const translatedText = segments
                .map(segment => Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : '')
                .join('');
            if (translatedText.length > 0) {
                return translatedText;
            }
        }
    }

    throw new Error('谷歌翻译返回格式异常');
}

export async function translateGoogleText(
    text: string,
    fromLang: string,
    toLang: string,
): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GOOGLE_TRANSLATE_TIMEOUT_MS);
    let resp: Response;
    let responseBody: string;

    try {
        resp = await fetch(GOOGLE_TRANSLATE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            body: new URLSearchParams({
                'f.req': createGoogleBatchRequest(text, fromLang, toLang),
            }).toString(),
            signal: controller.signal,
        });
        responseBody = await resp.text();
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`谷歌翻译请求超时（${GOOGLE_TRANSLATE_TIMEOUT_MS / 1000} 秒）`);
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`谷歌翻译网络请求失败: ${message}`);
    } finally {
        clearTimeout(timeout);
    }

    if (!resp.ok) {
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${responseBody}`);
    }

    return parseGoogleBatchResponse(responseBody);
}

async function google(message: {origin: string}) {
    if (typeof message.origin !== 'string') {
        throw new Error('谷歌翻译仅支持单条文本');
    }
    return translateGoogleText(message.origin, config.from, config.to);
}

export default google;
