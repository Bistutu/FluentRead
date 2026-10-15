/** Shared complete local-model wire fixtures; model IDs and download phases mirror real manager snapshots. */
import {LOCAL_TRANSLATION_MODEL_IDS, type LocalTranslationDownloadPhase, type LocalTranslationDownloadSnapshot} from '@/src/core/config/localTranslation';
import {LOCAL_TTS_MODEL_ID} from '@/src/core/config/localTts';
import type {LocalTtsPreparation} from '@/src/core/messaging/offscreen';
export function translationSnapshot(phase: LocalTranslationDownloadPhase = 'queued'): LocalTranslationDownloadSnapshot {
    return {version: 2, tasks: [{model: LOCAL_TRANSLATION_MODEL_IDS.m2m100, phase, downloadedBytes: 0, totalBytes: 100, bytesPerSecond: 0, updatedAt: 1}]};
}
export function ttsPreparation(): LocalTtsPreparation {
    return {model: LOCAL_TTS_MODEL_ID, warm: false};
}
