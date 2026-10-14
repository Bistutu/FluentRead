import {describe, expect, it, vi} from 'vitest';
import {createDocumentHistoryCommitter} from '@/src/features/document-translation/services/historyCommitter';
import type {DocumentHistoryRecord} from '@/src/features/document-translation/services/history';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}
const record = (id: string, text: string): DocumentHistoryRecord => ({
    id, name: 'notes.txt', format: 'text', size: 1, total: 1, completed: 1, updatedAt: 1,
    bytes: new Uint8Array([1]), mimeType: 'text/plain', translations: [text], fingerprint: 'settings',
});
const flush = async () => {for (let step = 0; step < 5; step++) await Promise.resolve();};

describe('document history durable revision ownership', () => {
    it('acknowledges only committed writes and deduplicates the same pending revision', async () => {
        const commit = deferred<boolean>();
        const save = vi.fn<(value: DocumentHistoryRecord) => Promise<boolean>>().mockReturnValueOnce(commit.promise).mockResolvedValue(true);
        const writer = createDocumentHistoryCommitter(save);
        const task: {revision: number; savedRevision?: number} = {revision: 0};
        const first = writer.save(task, record('file', 'First'));
        expect(writer.save(task, record('file', 'First'))).toBe(first);
        await flush();
        expect(task.savedRevision).toBeUndefined();
        expect(save).toHaveBeenCalledOnce();
        commit.resolve(true);
        expect(await first).toBe(true);
        expect(task.savedRevision).toBe(0);
        expect(await writer.save(task, record('file', 'First'))).toBe(true);
        expect(save).toHaveBeenCalledOnce();
        task.revision = 1;
        await writer.save(task, record('file', 'Second'));
        expect(task.savedRevision).toBe(1);
        expect(save).toHaveBeenCalledTimes(2);
    });

    it.each(['refused', 'rejected'] as const)('keeps a %s revision dirty and retries the same revision', async failure => {
        const save = vi.fn<(value: DocumentHistoryRecord) => Promise<boolean>>().mockResolvedValue(true);
        if (failure === 'refused') save.mockResolvedValueOnce(false);
        else save.mockRejectedValueOnce(new Error('Database unavailable'));
        const writer = createDocumentHistoryCommitter(save);
        const task: {revision: number; savedRevision?: number} = {revision: 3, savedRevision: 2};
        expect(await writer.save(task, record('file', 'Reader correction'))).toBe(false);
        expect(task.savedRevision).toBe(2);
        expect(await writer.save(task, record('file', 'Reader correction'))).toBe(true);
        expect(task.savedRevision).toBe(3);
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('serializes the same material while allowing unrelated documents to commit independently', async () => {
        const earlier = deferred<boolean>();
        const save = vi.fn<(value: DocumentHistoryRecord) => Promise<boolean>>().mockReturnValueOnce(earlier.promise).mockResolvedValue(true);
        const writer = createDocumentHistoryCommitter(save);
        const task = {revision: 1, savedRevision: 0}, other = {revision: 1};
        const first = writer.save(task, record('same', 'Earlier'));
        task.revision = 2;
        const second = writer.save(task, record('same', 'Latest'));
        const independent = writer.save(other, record('other', 'Independent'));
        await independent;
        expect(save.mock.calls.map(([value]) => value.translations[0])).toEqual(['Earlier', 'Independent']);
        expect(task.savedRevision).toBe(0);
        earlier.resolve(true);
        await first;
        expect(task.savedRevision).toBe(1);
        await second;
        expect(task.savedRevision).toBe(2);
        expect(save.mock.calls.map(([value]) => value.translations[0])).toEqual(['Earlier', 'Independent', 'Latest']);
    });

    it('does not let a late acknowledgement lower a newer saved revision and advances after synchronous storage failure', async () => {
        const earlier = deferred<boolean>();
        const save = vi.fn<(value: DocumentHistoryRecord) => Promise<boolean>>().mockReturnValueOnce(earlier.promise)
            .mockImplementationOnce(() => {throw new Error('Storage revoked');}).mockResolvedValue(true);
        const writer = createDocumentHistoryCommitter(save);
        const task = {revision: 1, savedRevision: 0};
        const first = writer.save(task, record('file', 'Earlier'));
        await flush();
        task.savedRevision = 2;
        earlier.resolve(true);
        await first;
        expect(task.savedRevision).toBe(2);
        task.revision = 3;
        expect(await writer.save(task, record('file', 'Latest'))).toBe(false);
        expect(task.savedRevision).toBe(2);
        expect(await writer.save(task, record('file', 'Latest'))).toBe(true);
        expect(task.savedRevision).toBe(3);
    });
});
