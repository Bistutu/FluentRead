import { config } from './config';

export interface TranslationLanguageOverride {
    sourceLanguage?: string;
    targetLanguage?: string;
}

function readLanguage(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * Resolve the language pair attached to a translation request without mutating
 * the shared extension configuration. This keeps comparison requests isolated
 * when several services are translated at the same time.
 */
export function getTranslationLanguages(message?: TranslationLanguageOverride | null): {
    sourceLanguage: string;
    targetLanguage: string;
} {
    return {
        sourceLanguage: readLanguage(message?.sourceLanguage, config.from),
        targetLanguage: readLanguage(message?.targetLanguage, config.to),
    };
}
