import {describe, expect, it, vi} from 'vitest';
import {VideoAiRequestSession} from '@/src/features/video-subtitle/content/video-ai/requestSession';
import {createVideoSubtitleBackgroundHandlers} from '@/src/features/video-subtitle/background/handlers';
import type {OffscreenClient} from '@/src/platform/offscreen/client';

describe('AI transcription request session identity', () => {
    it('keeps old cancellation identity separate while a newer local session wins transcription ownership', () => {
        const session = new VideoAiRequestSession('player-stream');
        const old = session.start(1, 'tiny', 'en')!;
        const next = session.start(3, 'small', 'auto')!;
        expect(old.generation).toBeLessThan(next.generation);
        expect(session.read(1)).toBeNull();expect(session.read(3)).toBe(next);
        expect(Object.isFrozen(next)).toBe(true);
        expect(next).toMatchObject({streamId: 'player-stream', generation: 2, model: 'small', sourceLanguage: 'auto'});
        expect(old.model).toBe('tiny');expect(old.sourceLanguage).toBe('en');
    });
    it('disposal prevents new requests while retaining exact cancellation tokens for resource teardown', () => {
        const session = new VideoAiRequestSession('player-stream');const token = session.start(4, 'tiny', 'auto');
        session.dispose();session.dispose();
        expect(session.start(1, 'tiny', 'en')).toBeNull();
        expect(session.read(4)).toBe(token);expect(session.read(1)).toBeNull();
    });
    it('shares the actual background single-stream contract while old warmup and cancellation cannot own a newer generation', async () => {
        let completeOld!: (response: {success: boolean; model: string}) => void;
        const oldWarmup = new Promise<{success: boolean; model: string}>(resolve => {completeOld = resolve;});
        const offscreen = {send: vi.fn().mockReturnValueOnce(oldWarmup).mockResolvedValue({success: true, model: 'small'}),
            sendIfPresent: vi.fn().mockResolvedValue({success: true})};
        const handlers = createVideoSubtitleBackgroundHandlers({offscreen: offscreen as unknown as OffscreenClient,
            storage: {get: async () => ({}), set: async () => undefined}});
        const prepare = handlers.find(handler => handler.type === 'fluentReadPrepareLocalVideoModel')!;
        const cancel = handlers.find(handler => handler.type === 'fluentReadCancelLocalVideoTranscription')!;
        const context = {sender: {tab: {id: 42}}};
        const session = new VideoAiRequestSession('player-stream');const full = session.start(1, 'tiny', 'en')!;
        const fullPrepare = {type: 'fluentReadPrepareLocalVideoModel', ...full, keepWarm: true};
        const first = Promise.resolve(prepare.handle(fullPrepare, context)).catch(error => error);
        const current = session.start(2, 'small', 'ja')!;
        const currentPrepare = {type: 'fluentReadPrepareLocalVideoModel', ...current, keepWarm: true};
        await expect(prepare.handle(currentPrepare, context)).resolves.toMatchObject({success: true});
        expect(offscreen.sendIfPresent).toHaveBeenCalledOnce();
        const oldCancellation = {type: 'fluentReadCancelLocalVideoTranscription', ...full, reason: 'pause'};
        await expect(cancel.handle(oldCancellation, context)).resolves.toMatchObject({stale: true});
        expect(offscreen.sendIfPresent).toHaveBeenCalledOnce();
        completeOld({success: true, model: 'tiny'});await expect(first).resolves.toBeInstanceOf(Error);
        const currentCompletion = {type: 'fluentReadCancelLocalVideoTranscription', ...current, reason: 'complete'};
        await expect(cancel.handle(currentCompletion, context)).resolves.toMatchObject({completed: true});
    });
});
