import {describe, expect, it} from 'vitest';
import {LOCAL_TRANSLATION_MODEL_IDS} from '@/src/core/config/localTranslation';
import {isVideoWorkerDisposal, parseVideoWorkerRequest, parseVideoWorkerResponse} from '@/src/features/video-subtitle/workerProtocol';
import {parseLocalTranslationWorkerRequest, parseLocalTranslationWorkerResponse} from '@/src/features/local-translation/workerProtocol';
import {parseLocalTtsWorkerRequest, parseLocalTtsWorkerResponse} from '@/src/features/local-tts/protocol';

describe('worker message public contracts', () => {
    it.each([undefined, null, [], 1, 'reply', {}, {requestId: 0}, {requestId: NaN}, {requestId: 1.5}, {requestId: Number.MAX_SAFE_INTEGER + 1}])(
        'rejects invalid worker envelopes %#', value => {
            for (const parse of [parseVideoWorkerRequest, parseLocalTtsWorkerRequest, parseLocalTranslationWorkerRequest]) expect(() => parse(value)).toThrow(TypeError);
            expect(() => parseVideoWorkerResponse(value, 'transcribe')).toThrow(TypeError);
            expect(() => parseLocalTtsWorkerResponse(value)).toThrow(TypeError);
            expect(() => parseLocalTranslationWorkerResponse(value)).toThrow(TypeError);
        });
    it('accepts actual video PCM and model controls while rejecting wrong operation or payload fields', () => {
        const audio = new Float32Array([0, .5, -.5]);
        expect(parseVideoWorkerRequest({requestId: 1, type: 'transcribe', model: 'tiny', audio, sourceLanguage: 'en', languageSessionKey: 'stream', device: 'wasm'}).audio).toBe(audio);
        expect(parseVideoWorkerRequest({requestId: 2, type: 'prepare'})).toEqual({requestId: 2, type: 'prepare'});
        expect(isVideoWorkerDisposal({type: 'dispose'})).toBe(true);expect(isVideoWorkerDisposal(null)).toBe(false);
        for (const patch of [{type: 'unknown'}, {model: 'unregistered'}, {audio: new Uint8Array(2)}, {sourceLanguage: 1}, {languageSessionKey: {}}, {device: 'webgpu'}])
            expect(() => parseVideoWorkerRequest({requestId: 1, type: 'transcribe', ...patch})).toThrow(TypeError);
    });
    it('requires valid core video results and preserves failure and CPU retry identity', () => {
        expect(parseVideoWorkerResponse({requestId: 1, success: false, retryWithCpu: true, error: 'GPU stopped'}, 'transcribe'))
            .toMatchObject({requestId: 1, success: false, retryWithCpu: true, error: 'GPU stopped'});
        expect(parseVideoWorkerResponse({requestId: 2, success: true, model: 'small'}, 'prepare')).toMatchObject({model: 'small'});
        for (const patch of [{success: 'yes'}, {text: null}, {segments: null}, {segments: [{startMs: 0, endMs: 1, text: 2}]}, {model: 1}, {retryWithCpu: 'true'}, {error: 7}])
            expect(() => parseVideoWorkerResponse({requestId: 1, success: true, text: 'hello', segments: [], ...patch}, 'transcribe')).toThrow(TypeError);
        expect(() => parseVideoWorkerResponse({requestId: 1, success: true}, 'prepare')).toThrow(TypeError);
        expect(() => parseVideoWorkerResponse({requestId: 1, success: true}, 'transcribe')).toThrow(TypeError);
    });
    it('keeps a valid transcript while filtering invalid optional diagnostics without mutating the message', () => {
        const value = {requestId: 1, success: true, text: 'hello', segments: [], model: 'tiny', backend: 'other', gpuInfo: 1,
            inferenceMs: Infinity, audioDurationMs: -1, threads: 'many', dtype: 'other', detectedLanguage: 'not-language',
            languageConfidence: 2, languageDetectionMs: -1, encoderReuse: 'yes', encoderDtype: 'other', decoderDtype: 'other'};
        const response = parseVideoWorkerResponse(value, 'transcribe');
        expect(response).toMatchObject({text: 'hello', segments: [], model: 'tiny', backend: undefined, gpuInfo: undefined,
            inferenceMs: undefined, audioDurationMs: undefined, threads: undefined, dtype: undefined});
        expect(response.detectedLanguage).toBeUndefined();expect(response.encoderReuse).toBeUndefined();
        expect(value.backend).toBe('other');expect(value.detectedLanguage).toBe('not-language');
        for (const [backend, dtype] of [['webgpu', 'q4'], ['wasm', 'q8']]) {
            expect(parseVideoWorkerResponse({...value, backend, dtype, gpuInfo: 'GPU', decodeMs: 0, inferenceMs: 1, audioDurationMs: 2, threads: 1,
                detectedLanguage: 'en', languageConfidence: .8, languageDetectionMs: 2, encoderReuse: true, encoderDtype: 'fp32', decoderDtype: 'q4'}, 'transcribe'))
                .toMatchObject({backend, dtype, gpuInfo: 'GPU', decodeMs: 0, inferenceMs: 1, audioDurationMs: 2, threads: 1, detectedLanguage: 'en', encoderReuse: true});
        }
    });
    it('accepts real translation/disposal controls and prevents a successful response from also requesting a retry', () => {
        const request = {requestId: 1, type: 'translate', model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, text: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh', singleThread: true};
        expect(parseLocalTranslationWorkerRequest(request)).toEqual(request);
        expect(parseLocalTranslationWorkerRequest({requestId: 2, type: 'dispose'})).toEqual({requestId: 2, type: 'dispose'});
        for (const patch of [{type: 'prepare'}, {model: 'unknown'}, {text: 4}, {text: ''}, {sourceLanguage: {}}, {targetLanguage: undefined}, {singleThread: 'true'}])
            expect(() => parseLocalTranslationWorkerRequest({...request, ...patch})).toThrow(TypeError);
        expect(parseLocalTranslationWorkerResponse({requestId: 1, success: false, retrySingleThread: true})).toMatchObject({retrySingleThread: true});
        expect(parseLocalTranslationWorkerResponse({requestId: 1, success: true, result: '译文', backend: 'wasm', elapsedMs: 1, dtype: 'q8', model: 'opus'}))
            .toMatchObject({result: '译文', backend: 'wasm'});
        expect(() => parseLocalTranslationWorkerResponse({requestId: 1, success: true, result: '译文', retrySingleThread: true})).toThrow('同时成功');
        for (const patch of [{success: 1}, {result: []}, {backend: 'other'}, {elapsedMs: NaN}, {error: 1}, {dtype: false}, {model: {}}, {retrySingleThread: 'yes'}])
            expect(() => parseLocalTranslationWorkerResponse({requestId: 1, success: true, result: '译文', ...patch})).toThrow(TypeError);
    });
    it('accepts TTS controls and validates actual audio while normalizing optional timing metadata', () => {
        const request = {requestId: 1, type: 'synthesize', text: 'Hello', voice: 'af_maple', speed: 1, device: 'wasm'};
        expect(parseLocalTtsWorkerRequest(request)).toEqual(request);
        for (const type of ['prepare', 'dispose']) expect(parseLocalTtsWorkerRequest({requestId: 2, type})).toEqual({requestId: 2, type});
        for (const patch of [{type: 'unknown'}, {text: {}}, {voice: 1}, {speed: NaN}, {device: 'webgpu'}])
            expect(() => parseLocalTtsWorkerRequest({...request, ...patch})).toThrow(TypeError);
        const audio = new ArrayBuffer(44);
        expect(parseLocalTtsWorkerResponse({requestId: 1, success: true, audio}).audio).toBe(audio);
        expect(parseLocalTtsWorkerResponse({requestId: 1, success: true, audio}).timings).toBeUndefined();
        const cue = {startChar: 0, endChar: 5, startTime: 0, endTime: 1};
        for (const timings of ['bad', null, [{bad: true}]])
            expect(parseLocalTtsWorkerResponse({requestId: 1, success: true, audio, timings}).timings).toEqual([]);
        const raw = {requestId: 1, success: true, audio, timings: [cue, {bad: true}], samplingRate: 24_000, backend: 'wasm'};
        expect(parseLocalTtsWorkerResponse(raw)).toMatchObject({audio, timings: [], samplingRate: 24_000, backend: 'wasm'});
        expect(raw.timings).toHaveLength(2);
        expect(parseLocalTtsWorkerResponse({...raw, timings: [cue]}).timings).toEqual([cue]);
        for (const patch of [{success: 'yes'}, {audio: new Uint8Array(4)}, {samplingRate: Infinity}, {backend: 'other'}, {error: {}}, {retryWithCpu: 'true'}])
            expect(() => parseLocalTtsWorkerResponse({requestId: 1, success: true, audio, ...patch})).toThrow(TypeError);
    });
});
