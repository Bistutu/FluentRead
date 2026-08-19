import {TranslationCandidateCore} from './engine';
import {defaultTranslationAdapters} from './registry';
import type {TranslationCoreOptions} from './types';

export function createTranslationCore(options: TranslationCoreOptions = {}): TranslationCandidateCore {
    return new TranslationCandidateCore({
        ...options,
        adapters: options.adapters ?? defaultTranslationAdapters,
    });
}

export {
    getTranslationCandidateKey,
    selectPreferredTranslationCandidate,
    TranslationCandidateCore,
} from './engine';
export type {TranslationDiscoveryStep} from './engine';
export {
    evaluateHardGuard,
    getComposedParent,
    getOpenShadowRoots,
    isProtectedDescendantElement,
} from './dom';
export {
    extractTranslationText,
    extractTranslationTextFromNodes,
    isClearlyTargetLanguage,
    isMeaningfulTranslationText,
} from './text';
export {
    applyTranslationsToSnapshot,
    collectLiveTranslationTextSlots,
    createTranslationSourceSnapshot,
    parseTranslationSlots,
    removeTranslationTruncation,
    serializeTranslationSlots,
} from './serialization';
export type {
    SerializedTranslationSlots,
    TranslationSourceSnapshot,
    TranslationTextSlot,
} from './serialization';
export {createDeclarativeAdapter} from './adapters/declarative';
export {
    getCurrentTranslationCore,
    resolveTranslationCandidate,
    resolveTranslationCandidateAtPoint,
} from './current';
export type * from './types';
