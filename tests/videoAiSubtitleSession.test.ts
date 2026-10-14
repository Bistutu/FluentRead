import {describe, expect, it, vi} from 'vitest';
import {VideoAiSubtitleSession} from '@/src/features/video-subtitle/content/video-ai/subtitleSession';
import type {VideoAiSubtitleCacheRequest} from '@/src/features/video-subtitle/transcriptionCache';
import type {VideoSubtitleCue} from '@/src/features/video-subtitle/content/youtubeSubtitleData';

const cue = (text = 'A complete source sentence.'): VideoSubtitleCue[] => [{startMs: 0, durationMs: 2000, text}];
function deferred<T>() {let resolve!: (value: T) => void;let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes;reject = no;});return {promise, resolve, reject};}
function harness() {
    let request: VideoAiSubtitleCacheRequest | null = {source: {mediaId: '123'}, model: 'tiny', videoSourceLanguage: 'en'};
    let allowed = true;
    const get = vi.fn<(request: VideoAiSubtitleCacheRequest) => Promise<VideoSubtitleCue[] | null>>().mockResolvedValue(cue());
    const set = vi.fn<(request: VideoAiSubtitleCacheRequest, cues: readonly VideoSubtitleCue[]) => Promise<void>>().mockResolvedValue();
    const restore = vi.fn<(cues: VideoSubtitleCue[]) => boolean>().mockReturnValue(true);
    const session = new VideoAiSubtitleSession({readRequest: () => request, canRestore: () => allowed, get, set, restore});
    return {session, get, set, restore, read: () => request!, request: (next: VideoAiSubtitleCacheRequest | null) => {request = next;}, allow: (next: boolean) => {allowed = next;}};
}
const settle = async () => {await Promise.resolve();await Promise.resolve();};

describe('AI subtitle media session ownership', () => {
    it('deduplicates a pending restore and releases only its own completed request', async () => {
        const h = harness(), pending = deferred<VideoSubtitleCue[] | null>();h.get.mockReturnValue(pending.promise);
        const first = h.session.restoreCached();expect(h.session.restoreCached()).toBe(first);
        expect(h.session.isRestoring).toBe(true);await settle();expect(h.get).toHaveBeenCalledOnce();
        pending.resolve(cue());await expect(first).resolves.toBe(true);
        expect(h.restore).toHaveBeenCalledWith(cue());expect(h.session.isRestored).toBe(true);expect(h.session.isRestoring).toBe(false);
        h.session.reset();expect(h.session.isRestored).toBe(false);
    });
    it.each(['media', 'model', 'language'] as const)('rejects an old cache result after %s changes even without a caller invalidation', async change => {
        const h = harness(), pending = deferred<VideoSubtitleCue[] | null>();h.get.mockReturnValue(pending.promise);
        const result = h.session.restoreCached();await settle();
        h.request({...h.read(), ...(change === 'model' ? {model: 'small'} : {}),
            ...(change === 'language' ? {videoSourceLanguage: 'ja'} : {}), ...(change === 'media' ? {source: {mediaId: '456'}} : {})});
        pending.resolve(cue('Old media.'));await expect(result).resolves.toBe(false);
        expect(h.restore).not.toHaveBeenCalled();expect(h.session.isRestored).toBe(false);
    });
    it('allows a new lookup while the obsolete transport remains pending and ignores its finalizer', async () => {
        const h = harness(), old = deferred<VideoSubtitleCue[] | null>(), next = deferred<VideoSubtitleCue[] | null>();
        h.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
        const first = h.session.restoreCached();await settle();h.request({...h.read(), source: {mediaId: '456'}});
        const second = h.session.restoreCached();await settle();old.resolve(cue('Old source.'));await expect(first).resolves.toBe(false);
        expect(h.session.isRestoring).toBe(true);expect(h.session.restoreCached()).toBe(second);
        next.resolve(cue('Current source.'));await expect(second).resolves.toBe(true);expect(h.restore).toHaveBeenCalledOnce();
    });
    it.each(['native', 'hidden', 'disposed', 'generation'] as const)('prevents late cache publication after %s takes ownership', async change => {
        const h = harness(), pending = deferred<VideoSubtitleCue[] | null>();h.get.mockReturnValue(pending.promise);
        const result = h.session.restoreCached();await settle();
        if (change === 'disposed') h.session.dispose();else if (change === 'generation') h.session.beginGeneration();else h.allow(false);
        pending.resolve(cue());await expect(result).resolves.toBe(false);expect(h.restore).not.toHaveBeenCalled();
        expect(h.session.isRestored).toBe(false);
    });
    it('refuses native/disabled, absent media and unidentifiable media without opening cache transport', async () => {
        const h = harness();h.allow(false);await expect(h.session.restoreCached()).resolves.toBe(false);
        h.allow(true);h.request(null);await expect(h.session.restoreCached()).resolves.toBe(false);
        h.request({source: {directSource: 'blob:temporary'}});await expect(h.session.restoreCached()).resolves.toBe(false);
        h.session.dispose();await expect(h.session.restoreCached()).resolves.toBe(false);expect(h.get).not.toHaveBeenCalled();
    });
    it('does not dispatch a cache request when invalidation wins before its first microtask', async () => {
        const h = harness();const pending = h.session.restoreCached();h.session.invalidate();
        await expect(pending).resolves.toBe(false);expect(h.get).not.toHaveBeenCalled();
    });
    it('treats a miss, rejected cache transport and rejected restore as recoverable misses', async () => {
        const h = harness();h.get.mockResolvedValueOnce(null);await expect(h.session.restoreCached()).resolves.toBe(false);
        h.get.mockRejectedValueOnce(new Error('Cache offline'));await expect(h.session.restoreCached()).resolves.toBe(false);
        h.restore.mockReturnValueOnce(false);await expect(h.session.restoreCached()).resolves.toBe(false);
        h.restore.mockImplementationOnce(() => {throw new Error('Player departed');});await expect(h.session.restoreCached()).resolves.toBe(false);
        expect(h.session.isRestored).toBe(false);expect(h.session.isRestoring).toBe(false);
    });
    it('an obsolete rejection cannot erase the newer generation snapshot', async () => {
        const h = harness(), pending = deferred<VideoSubtitleCue[] | null>();h.get.mockReturnValue(pending.promise);
        const old = h.session.restoreCached();await settle();h.session.beginGeneration();
        pending.reject(new Error('Old cache failed'));await expect(old).resolves.toBe(false);
        h.session.persistCompleted(cue());await settle();expect(h.set).toHaveBeenCalledWith(h.read(), cue());
    });
    it.each([false, true])('reentrant restore replacement preserves the newer owner (accepted: %s)', async accepted => {
        const h = harness();h.restore.mockImplementation(() => {
            h.request({...h.read(), source: {mediaId: '456'}});h.session.beginGeneration();return accepted;
        });
        await expect(h.session.restoreCached()).resolves.toBe(false);
        h.session.persistCompleted(cue('New media.'));await settle();
        expect(h.set.mock.calls[0][0].source).toEqual({mediaId: '456'});expect(h.session.isRestored).toBe(false);
    });
    it('captures immutable generation and cue snapshots, with metadata enrichment preserving model and language', async () => {
        const h = harness();h.session.beginGeneration();
        h.read().source.mediaId = '456';h.read().model = 'small';h.read().videoSourceLanguage = 'ja';
        const complete = cue();h.session.persistCompleted(complete);complete[0].text = 'Later mutation';await settle();
        expect(h.set.mock.calls[0]).toEqual([{source: {mediaId: '123'}, model: 'tiny', videoSourceLanguage: 'en'}, cue()]);
        h.session.updateMediaIdentity();h.session.persistCompleted(cue());await settle();
        expect(h.set.mock.calls[1][0]).toEqual({source: {mediaId: '456'}, model: 'tiny', videoSourceLanguage: 'en'});
    });
    it('does not persist partial, unowned, failed or disposed timelines; cleanup is idempotent', async () => {
        const h = harness();h.session.persistCompleted(cue());h.session.updateMediaIdentity();
        h.request(null);h.session.beginGeneration();h.session.persistCompleted(cue());
        h.request({source: {mediaId: '123'}});h.session.beginGeneration();h.session.persistCompleted([]);
        h.request(null);h.session.updateMediaIdentity();h.session.persistCompleted(cue());await settle();expect(h.set).toHaveBeenCalledOnce();
        h.set.mockRejectedValueOnce(new Error('Storage failed'));h.session.persistCompleted(cue());await settle();
        h.session.reset();h.session.persistCompleted(cue());h.session.dispose();h.session.dispose();h.session.beginGeneration();h.session.updateMediaIdentity();h.session.persistCompleted(cue());
        await settle();expect(h.set).toHaveBeenCalledTimes(2);expect(h.session.isRestored).toBe(false);
    });
});
