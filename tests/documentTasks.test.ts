import {describe, expect, it} from 'vitest';
import {markRaw, toRaw} from 'vue';
import {parseDocument} from '@/src/features/document-translation/core/document';
import {createDocumentTaskState, useDocumentTasks, type DocumentQueueItem} from '@/src/features/document-translation/ui/useDocumentTasks';

const task = (id: number): DocumentQueueItem => ({
    ...createDocumentTaskState(), id, name: `${id}.txt`, document: markRaw(parseDocument(`${id}.txt`, 'Source')),
});

describe('document task state ownership', () => {
    it('commits edits, provider results and export revisions directly to the task used by the queue', () => {
        const tasks = useDocumentTasks();
        tasks.documentQueue.value.push(task(1));
        tasks.activeDocumentId.value = 1;
        tasks.translatedSegments.value[0] = 'Reader correction';
        tasks.confirmedTranslationIds.value.push(0);
        tasks.taskFingerprint.value = 'settings';
        tasks.runState.value = 'paused';
        tasks.editRevision.value = 2;
        tasks.downloadedRevision.value = 1;
        tasks.errorMessage.value = 'retry';
        tasks.documentBatchTranslation.value = false;
        tasks.bypassCache.value = true;
        const current = tasks.documentQueue.value[0];
        expect(current).toMatchObject({translations: ['Reader correction'], confirmedTranslationIds: [0],
            fingerprint: 'settings', state: 'paused', revision: 2, downloaded: 1, error: 'retry', batchTranslation: false, bypassCache: true});
        current.translations = ['Provider result'];
        expect(tasks.translatedSegments.value).toBe(current.translations);
        expect(tasks.parsedDocument.value).toBe(current.document);
    });

    it('switches the cursor without copying or overwriting the other document', () => {
        const tasks = useDocumentTasks();
        tasks.documentQueue.value.push(task(1), task(2));
        tasks.activeDocumentId.value = 1;
        tasks.translatedSegments.value = ['First'];
        tasks.confirmedTranslationIds.value = [0];
        tasks.editRevision.value = 3;
        tasks.bypassCache.value = true;
        const firstTranslations = tasks.translatedSegments.value;
        tasks.activeDocumentId.value = 2;
        expect(tasks.translatedSegments.value).toEqual([]);
        expect(tasks.confirmedTranslationIds.value).toEqual([]);
        expect(tasks.editRevision.value).toBe(0);
        expect(tasks.bypassCache.value).toBe(false);
        tasks.translatedSegments.value = ['Second'];
        tasks.activeDocumentId.value = 1;
        expect(tasks.translatedSegments.value).toBe(firstTranslations);
        expect(tasks.editRevision.value).toBe(3);
        expect(tasks.bypassCache.value).toBe(true);
        expect(tasks.documentQueue.value[1].translations).toEqual(['Second']);
    });

    it('keeps empty-page failures separate from tasks and resets every field on clear', () => {
        const tasks = useDocumentTasks();
        tasks.errorMessage.value = 'Import failed';
        tasks.translatedSegments.value.push('empty draft');
        tasks.documentQueue.value.push(task(1));
        tasks.activeDocumentId.value = 1;
        expect(tasks.errorMessage.value).toBe('');
        tasks.parsedDocument.value = null;
        tasks.translatedSegments.value = ['Kept'];
        tasks.bypassCache.value = true;
        const previous = tasks.documentQueue.value[0];
        tasks.clear();
        expect(tasks.documentQueue.value).toEqual([]);
        expect(tasks.activeTask.value).toBeNull();
        expect(tasks.activeDocumentId.value).toBeNull();
        expect(tasks.parsedDocument.value).toBeNull();
        expect(tasks.translatedSegments.value).toEqual([]);
        expect(tasks.errorMessage.value).toBe('');
        expect(tasks.confirmedTranslationIds.value).toEqual([]);
        expect(tasks.taskFingerprint.value).toBe('');
        expect(tasks.runState.value).toBe('ready');
        expect(tasks.editRevision.value).toBe(0);
        expect(tasks.downloadedRevision.value).toBe(0);
        expect(tasks.documentBatchTranslation.value).toBe(true);
        expect(tasks.bypassCache.value).toBe(false);
        tasks.translatedSegments.value.push('new draft');
        expect(toRaw(previous).translations).toEqual(['Kept']);
    });

    it('resets idle selection without destroying other tasks and owns independent default arrays', () => {
        const tasks = useDocumentTasks();
        const first = task(1), second = task(2);
        first.translations.push('First');
        first.confirmedTranslationIds.push(0);
        first.bypassCache = true;
        expect(second.translations).toEqual([]);
        expect(second.confirmedTranslationIds).toEqual([]);
        expect(second.bypassCache).toBe(false);
        tasks.documentQueue.value.push(first, second);
        tasks.activeDocumentId.value = 1;
        tasks.clearSelection();
        expect(tasks.documentQueue.value).toHaveLength(2);
        expect(tasks.translatedSegments.value).toEqual([]);
        expect(tasks.bypassCache.value).toBe(false);
        tasks.activeDocumentId.value = 1;
        expect(tasks.translatedSegments.value).toEqual(['First']);
        expect(tasks.confirmedTranslationIds.value).toEqual([0]);
        expect(tasks.bypassCache.value).toBe(true);
    });
});
