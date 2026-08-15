import {translateMicrosoftTexts} from "@/entrypoints/service/microsoft";
import {translateDeepLXText} from "@/entrypoints/service/deeplx";
import {translateGoogleText} from "@/entrypoints/service/google";
import {config} from "@/entrypoints/utils/config";
import {services} from "@/entrypoints/utils/option";

type FreeTranslationProvider = {
    label: string;
    translate: (text: string) => Promise<string>;
};

export const FREE_TRANSLATION_ORDER = [
    "微软翻译",
    "DeepLX",
    "谷歌翻译",
] as const;

function requireTranslation(text: string, label: string): string {
    if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error(`${label}未返回有效译文`);
    }
    return text;
}

const providers: FreeTranslationProvider[] = [
    {
        label: FREE_TRANSLATION_ORDER[0],
        translate: async (text) => {
            const translations = await translateMicrosoftTexts([text], config.from, config.to);
            return requireTranslation(translations[0] || "", FREE_TRANSLATION_ORDER[0]);
        },
    },
    {
        label: FREE_TRANSLATION_ORDER[1],
        translate: (text) => translateDeepLXText(text, services.deeplx),
    },
    {
        label: FREE_TRANSLATION_ORDER[2],
        translate: (text) => translateGoogleText(text, config.from, config.to),
    },
];

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function translateFreeText(text: string): Promise<string> {
    if (typeof text !== "string") {
        throw new Error("免费翻译服务仅支持文本输入");
    }

    const failures: string[] = [];
    for (const provider of providers) {
        try {
            return requireTranslation(await provider.translate(text), provider.label);
        } catch (error) {
            failures.push(`${provider.label}: ${getErrorMessage(error)}`);
        }
    }

    throw new Error(`免费翻译服务均不可用（${FREE_TRANSLATION_ORDER.join(" → ")}）：${failures.join("；")}`);
}

async function freeTranslation(message: {origin: string | string[]}) {
    if (typeof message.origin === "string") {
        return translateFreeText(message.origin);
    }

    if (Array.isArray(message.origin)) {
        return Promise.all(message.origin.map(text => translateFreeText(text)));
    }

    throw new Error("免费翻译服务仅支持文本输入");
}

export default freeTranslation;
