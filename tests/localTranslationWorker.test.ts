import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {LOCAL_TRANSLATION_MODEL_IDS} from '@/src/core/config/localTranslation';

const mocks = vi.hoisted(() => ({pipeline: vi.fn(), threads: vi.fn(), forceSingleThread: vi.fn(), dispose: vi.fn()}));
vi.mock('@huggingface/transformers', () => ({env: {backends: {onnx: {}}}, pipeline: mocks.pipeline,
    InterruptableStoppingCriteria: class {interrupted = false; interrupt() {this.interrupted = true;}}}));
vi.mock('@wllama/wllama/esm/index.js', () => ({Wllama: vi.fn()}));
vi.mock('@/src/shared/onnx/resources', () => ({forceSingleThreadInference: mocks.forceSingleThread, localWasmThreads: mocks.threads,
    paceLocalInference: (run: () => Promise<unknown>) => run(), paceLocalInitialization: (run: () => Promise<unknown>) => run()}));
vi.mock('@/src/features/local-translation/offscreen/artifactStore', () => ({getTranslationArtifacts: () => [], matchTranslationArtifact: vi.fn(), translationArtifactBlob: vi.fn()}));

beforeEach(() => {vi.resetModules();vi.clearAllMocks();mocks.threads.mockReturnValue(1);
    mocks.pipeline.mockResolvedValue(Object.assign(vi.fn(async () => [{translation_text: '你好'}]), {dispose: mocks.dispose}));});
afterEach(() => vi.unstubAllGlobals());
async function start() {
    const postMessage = vi.fn(), addEventListener = vi.fn();
    vi.stubGlobal('self', {postMessage, addEventListener, setTimeout, clearTimeout, location: {href: 'chrome-extension://test/localTranslationWorker.js'}});
    (await import('@/src/features/local-translation/offscreen/translation.worker')).startLocalTranslationWorker();
    const listener = addEventListener.mock.calls[0][1] as (event: {data: unknown}) => void;
    return {postMessage, send: (value: unknown) => listener({data: value})};
}
describe('actual local translation Worker message boundary', () => {
    it('rejects malformed controls before loading a model, then translates and disposes through the same queue', async () => {
        const scope = await start();
        for (const value of [null, {}, {requestId: '1'}, {requestId: 0}, {requestId: NaN}]) scope.send(value);
        expect(scope.postMessage).not.toHaveBeenCalled();
        scope.send({requestId: 1, type: 'translate', model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, text: 1});
        expect(scope.postMessage).toHaveBeenLastCalledWith({requestId: 1, success: false, error: expect.stringContaining('消息格式无效')});
        expect(mocks.pipeline).not.toHaveBeenCalled();
        scope.send({requestId: 2, type: 'translate', model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, text: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh'});
        await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(2));
        expect(scope.postMessage.mock.calls[1][0]).toMatchObject({requestId: 2, success: true, result: '你好', backend: 'wasm'});
        scope.send({requestId: 3, type: 'dispose'});
        await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(3));
        expect(mocks.dispose).toHaveBeenCalledOnce();expect(scope.postMessage).toHaveBeenLastCalledWith({requestId: 3, success: true});
    });
    it('keeps a typed single-thread retry hint on actual initialization failure and accepts a later forced retry', async () => {
        const scope = await start();mocks.threads.mockReturnValue(2);mocks.pipeline.mockRejectedValueOnce(new Error('pthread unavailable'));
        const command = {type: 'translate', model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, text: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh'};
        scope.send({requestId: 1, ...command});
        await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(1));
        expect(scope.postMessage).toHaveBeenLastCalledWith({requestId: 1, success: false, error: 'pthread unavailable', retrySingleThread: true});
        scope.send({requestId: 2, ...command, singleThread: true});
        await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(2));
        expect(mocks.forceSingleThread).toHaveBeenCalledOnce();expect(scope.postMessage.mock.calls[1][0]).toMatchObject({requestId: 2, success: true, result: '你好'});
    });
});
