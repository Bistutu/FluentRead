import {withProviderSnapshot} from './helpers/providerSnapshot';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {config, bridge} = vi.hoisted(() => ({config: {} as Record<string, any>, bridge: vi.fn()}));
vi.mock('@/src/services/config/store', () => ({config}));
vi.mock('@/src/platform/chatgpt-plan/bridge', () => ({requestChatGPTPlanResponse: bridge}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {id: 'test', getURL: (path: string) => path}}}));

import {Config} from '@/src/core/config/model';
import {currentModelIds, defaultModels, models, services, servicesType} from '@/src/core/config/catalog';
import {resolveBrowserCapabilities} from '@/src/platform/browser/capabilities';
import {ChatGPTPlanResponseError, readChatGPTPlanStream, streamChatGPTPlanEvents} from '@/src/platform/chatgpt-plan/events';
import * as planEvents from '@/src/platform/chatgpt-plan/events';
import chatgptPlan, {buildChatGPTPlanPayload} from '@/src/providers/translation/chatgpt-plan';
import {supportsNativeTranslationBatch, supportsTranslationBatch, isTranslationServiceAvailable,
    getTranslationServiceUnavailableMessage} from '@/src/services/translation/capabilities';
import {attachTranslationImageInput, attachTranslationModelUsageObserver, attachTranslationProviderConfig,
    attachTranslationRequestScheduler, createTranslationProviderConfigSnapshot} from '@/src/services/translation/requestSnapshot';

const event = (type: string, fields: Record<string, unknown> = {}) => `event: ${type}\ndata: ${JSON.stringify({type, ...fields})}\n\n`;
const completed = (text = '译文', extra: Record<string, unknown> = {}) => ({status: 'completed', model: 'account-model',
    output: [{type: 'message', role: 'assistant', status: 'completed', content: [{type: 'output_text', text}]}], ...extra});
const doneEvent = (text?: string, extra?: Record<string, unknown>) => event('response.completed', {response: completed(text, extra)});
const sse = (text: string, init: ResponseInit = {}) => new Response(text, {headers: {'Content-Type': 'text/event-stream'}, ...init});
const frozen = () => createTranslationProviderConfigSnapshot(config as any);

beforeEach(() => {
    for (const key of Object.keys(config)) delete config[key];
    Object.assign(config, new Config(), {service: services.chatgptPlan, to: 'zh-Hans',
        model: {[services.chatgptPlan]: 'account-model'}, system_role: {[services.chatgptPlan]: '系统提示'},
        user_role: {[services.chatgptPlan]: '翻译成{{to}}：{{origin}}'}});
    bridge.mockReset();
    bridge.mockImplementation(async () => sse(doneEvent()));
});
afterEach(() => {vi.useRealTimers();vi.restoreAllMocks();});

describe('ChatGPT 套餐 provider 与能力', () => {
    it('是独立 AI 服务，账户模型为空目录，凭据和端点不进入常规设置字段', () => {
        expect(servicesType.isAI(services.chatgptPlan)).toBe(true);
        expect(servicesType.isUseModel(services.chatgptPlan)).toBe(true);
        for (const predicate of [servicesType.isAiSdk, servicesType.isUseToken, servicesType.isUseProxy, servicesType.isUseCustomBody]) {
            expect(predicate(services.chatgptPlan)).toBe(false);
        }
        expect(currentModelIds.chatgptPlan).toBe('');
        expect(models.get(services.chatgptPlan)).toEqual([]);
        expect(defaultModels.has(services.chatgptPlan)).toBe(false);
        expect(supportsTranslationBatch(services.chatgptPlan)).toBe(true);
        expect(supportsNativeTranslationBatch(services.chatgptPlan)).toBe(false);
        const userscript = resolveBrowserCapabilities({browser: 'userscript', manifestVersion: 2});
        expect(isTranslationServiceAvailable(services.chatgptPlan, userscript)).toBe(false);
        expect(getTranslationServiceUnavailableMessage(services.chatgptPlan, userscript)).toContain('脚本版');
        expect(isTranslationServiceAvailable(services.chatgptPlan, resolveBrowserCapabilities({browser: 'firefox', manifestVersion: 2}))).toBe(false);
    });

    it('复用冻结提示词、模型和上下文，仅发送套餐协议允许字段', async () => {
        config.customBody[services.chatgptPlan] = JSON.stringify({model: 'untrusted-model', messages: [{role: 'user', content: 'untrusted'}], tools: [{type: 'web_search'}], temperature: 99});
        config.token[services.chatgptPlan] = 'unused-test-token';
        const request = attachTranslationProviderConfig({origin: 'Hello', pageContext: '标题', modelOverride: 'selected-account-model'}, frozen());
        config.model[services.chatgptPlan] = 'changed-model';
        config.system_role[services.chatgptPlan] = 'changed-system';
        expect(await chatgptPlan(withProviderSnapshot(request, config))).toBe('译文');
        const [payload] = bridge.mock.calls[0];
        expect(Object.keys(payload).sort()).toEqual(['input', 'instructions', 'model']);
        expect(payload.model).toBe('selected-account-model');
        expect(payload.instructions).toBe('系统提示');
        expect(JSON.stringify(payload.input)).toContain('Hello');
        expect(JSON.stringify(payload.input)).toContain('标题');
        expect(JSON.stringify(payload)).not.toMatch(/unused-test-token|untrusted-model|changed-system/);
    });

    it('图片转换为 Responses input_image 并保留可信识别提示词', async () => {
        const request = attachTranslationImageInput(attachTranslationProviderConfig({origin: '识别文字'}, frozen()), 'data:image/png;base64,YQ==');
        await chatgptPlan(withProviderSnapshot(request, config));
        const [payload] = bridge.mock.calls[0];
        expect(payload.input[0].content).toEqual(expect.arrayContaining([{type: 'input_image', image_url: 'data:image/png;base64,YQ=='}]));
        expect(JSON.stringify(payload.input)).toContain('识别文字');
    });

    it('摘要覆盖提示词仍通过统一模板，未配置模型时不启动助手请求', () => {
        const payload = buildChatGPTPlanPayload({origin: 'text', summaryPrompt: '摘要：text', summarySystemPrompt: '摘要系统'}, 'text', frozen());
        expect(payload.instructions).toBe('摘要系统');
        expect(JSON.stringify(payload.input)).toContain('摘要：text');
        delete config.model[services.chatgptPlan];
        expect(() => buildChatGPTPlanPayload({origin: 'text'}, 'text', frozen())).toThrow('账户可用列表');
        expect(bridge).not.toHaveBeenCalled();
    });

    it('逐条完成数组并共享冻结模型，用量观察包含真实 Responses token', async () => {
        const observations: unknown[] = [];
        bridge.mockImplementation(async () => {
            config.model[services.chatgptPlan] = 'changed-during-batch';
            return sse(doneEvent('text', {usage: {input_tokens: 8, output_tokens: 2, total_tokens: 10, input_tokens_details: {cached_tokens: 3}}}));
        });
        expect(await chatgptPlan(withProviderSnapshot(attachTranslationModelUsageObserver({origin: ['one', 'two']}, observation => observations.push(observation)), config))).toEqual(['text', 'text']);
        expect(bridge.mock.calls.map(([payload]) => payload.model)).toEqual(['account-model', 'account-model']);
        expect(observations).toHaveLength(2);
        expect(observations[0]).toMatchObject({actualModel: 'account-model', usageAvailability: 'reported', inputTokens: 8, outputTokens: 2, totalTokens: 10, cachedInputTokens: 3, outcome: 'success'});
    });

    it('首条请求由 broker 计速率，额外数组项登记 attempt 并持有真实结算', async () => {
        const scheduleAttempt = vi.fn(async (task: () => Promise<string>) => task());
        const holdUntil = vi.fn();
        const request = attachTranslationRequestScheduler({origin: ['one', 'two']}, {scheduleAttempt} as any, undefined, {holdUntil} as any);
        await chatgptPlan(withProviderSnapshot(request, config));
        expect(scheduleAttempt).toHaveBeenCalledTimes(1);
        expect(holdUntil).toHaveBeenCalledTimes(2);
    });

    it('已完成但仅含推理或拒绝输出不提交为译文，用量观察记失败', async () => {
        const observe = vi.fn();
        bridge.mockResolvedValue(sse(doneEvent('', {output: [{type: 'reasoning', summary: [{type: 'summary_text', text: 'secret reasoning'}]}]})));
        await expect(chatgptPlan(withProviderSnapshot(attachTranslationModelUsageObserver({origin: 'text'}, observe), config))).rejects.toThrow('没有返回有效译文');
        expect(observe).toHaveBeenCalledWith(expect.objectContaining({outcome: 'error', usageAvailability: 'unreported'}));
    });

    it('显式剩余预算不被设置下限抬高，超时会中止助手', async () => {
        vi.useFakeTimers();
        bridge.mockImplementation((_payload, signal: AbortSignal) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), {once: true});
        }));
        const pending = chatgptPlan(withProviderSnapshot({origin: 'text', requestTimeoutMs: 40}, config));
        const expectation = expect(pending).rejects.toMatchObject({kind: 'timeout', retryable: true});
        await vi.advanceTimersByTimeAsync(40);
        await expectation;
        expect(bridge.mock.calls[0][1].aborted).toBe(true);
    });

    it('调用方取消保留 AbortError，失败数组不会提交不完整结果', async () => {
        const controller = new AbortController();
        bridge.mockImplementationOnce(async () => sse(doneEvent('first')))
            .mockImplementationOnce(async (_payload, signal: AbortSignal) => {
                controller.abort();
                throw signal.reason;
            });
        await expect(chatgptPlan(withProviderSnapshot({origin: ['one', 'two'], abortSignal: controller.signal}, config))).rejects.toMatchObject({name: 'AbortError'});
        expect(bridge).toHaveBeenCalledTimes(2);
    });

    it('额度与其他流错误记失败用量，完成缺失model时使用冻结模型', async () => {
        const observe = vi.fn();
        bridge.mockResolvedValueOnce(sse(event('error', {code: 'subscription_sharing_usage_unavailable'})));
        await expect(chatgptPlan(withProviderSnapshot(attachTranslationModelUsageObserver({origin: 'text'}, observe), config))).rejects.toMatchObject({kind: 'rate-limit', retryable: false});
        expect(observe).toHaveBeenCalledWith(expect.objectContaining({outcome: 'error', statusCode: 429}));
        bridge.mockResolvedValueOnce(sse(doneEvent('text', {model: undefined})));
        await chatgptPlan(withProviderSnapshot(attachTranslationModelUsageObserver({origin: 'text', targetLanguage: 'en'}, observe), config));
        expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({actualModel: 'account-model', outcome: 'success'}));
        bridge.mockRejectedValueOnce(undefined);
        await expect(chatgptPlan(withProviderSnapshot(attachTranslationModelUsageObserver({origin: 'text'}, observe), config))).rejects.toBeUndefined();
        expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({outcome: 'error', statusCode: undefined}));
    });

    it('批次剩余预算已过时不启动下一条，读取完成后的取消仍不提交', async () => {
        const time = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(50);
        await expect(chatgptPlan(withProviderSnapshot({origin: ['one'], requestTimeoutMs: 40}, config))).rejects.toMatchObject({kind: 'timeout'});
        expect(bridge).not.toHaveBeenCalled();time.mockRestore();
        const controller = new AbortController();
        vi.spyOn(planEvents, 'readChatGPTPlanStream').mockImplementationOnce(async () => {controller.abort();return completed();});
        await expect(chatgptPlan(withProviderSnapshot({origin: 'text', abortSignal: controller.signal}, config))).rejects.toMatchObject({name: 'AbortError'});
    });
});

describe('Responses SSE 严格完成与取消', () => {
    it('增量 UTF-8、CRLF 和心跳不会破坏完整输出，实时 delta按次序交付', async () => {
        const bytes = new TextEncoder().encode(': heartbeat\r\n\r\n' + event('response.output_text.delta', {delta: '译'}).replace(/\n/gu, '\r\n') + doneEvent('译文').replace(/\n/gu, '\r\n'));
        const stream = new ReadableStream<Uint8Array>({start(controller) {
            for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3));
            controller.close();
        }});
        const observed: string[] = [];
        for await (const value of streamChatGPTPlanEvents(new Response(stream, {headers: {'Content-Type': 'text/event-stream; charset=utf-8'}}))) observed.push(String(value.type));
        expect(observed).toEqual(['response.output_text.delta', 'response.completed']);
        expect(await readChatGPTPlanStream(sse(doneEvent()))).toMatchObject(completed());
    });

    it.each([
        ['only delta', event('response.output_text.delta', {delta: 'partial'})],
        ['DONE before complete', 'data: [DONE]\n\n'],
        ['incomplete frame', doneEvent().trimEnd()],
        ['malformed JSON', 'data: {broken}\n\n'],
        ['missing event type', 'data: {}\n\n'],
        ['contradictory event type', 'event: response.failed\ndata: {"type":"response.completed"}\n\n'],
        ['completion without response', event('response.completed')],
        ['completion with in progress response', event('response.completed', {response: completed('partial', {status: 'in_progress'})})],
        ['completion with unfinished message', event('response.completed', {response: completed('partial', {output: [{type: 'message', status: 'in_progress'}]})})],
        ['incomplete', event('response.incomplete', {response: {status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'}}})],
        ['failed', event('response.failed', {response: {status: 'failed', error: {code: 'server_error', message: 'do-not-expose-body'}}})],
    ])('%s 不会提交部分响应', async (_name, text) => {
        await expect(readChatGPTPlanStream(sse(text))).rejects.toBeInstanceOf(ChatGPTPlanResponseError);
    });

    it('额度错误具有稳定分类，忽略含敏感内容的上游文案', async () => {
        const promise = readChatGPTPlanStream(sse(event('error', {code: 'subscription_sharing_usage_limit_exceeded', message: 'do-not-expose-body'})));
        await expect(promise).rejects.toMatchObject({kind: 'rate-limit', retryable: false, statusCode: 429});
        await expect(promise).rejects.not.toThrow('do-not-expose-body');
        await expect(readChatGPTPlanStream(new Response(JSON.stringify({error: {code: 'invalid_token'}}), {status: 401}))).rejects.toMatchObject({kind: 'authentication'});
        await expect(readChatGPTPlanStream(new Response('', {status: 503}))).rejects.toMatchObject({kind: 'provider', retryable: true});
    });

    it('缺失SSE body/类型与无效UTF-8会拒绝', async () => {
        await expect(readChatGPTPlanStream(new Response(null, {headers: {'Content-Type': 'text/event-stream'}}))).rejects.toThrow('事件流');
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        await expect(readChatGPTPlanStream(new Response(new ReadableStream({cancel})))).rejects.toThrow('事件流');
        expect(cancel).toHaveBeenCalledOnce();
        await expect(readChatGPTPlanStream(new Response(new Uint8Array([255]), {headers: {'Content-Type': 'text/event-stream'}}))).rejects.toThrow('UTF-8');
    });

    it('停止等待中的读取会取消 reader，不等待上游主动结束', async () => {
        const controller = new AbortController();
        const cancel = vi.fn();
        const response = new Response(new ReadableStream({cancel}), {headers: {'Content-Type': 'text/event-stream'}});
        const pending = readChatGPTPlanStream(response, controller.signal);
        const expectation = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        controller.abort();
        await expectation;
        expect(cancel).toHaveBeenCalledTimes(1);
        const lateCancel = vi.fn(() => new Promise<void>(() => {}));
        const lateResponse = new Response(new ReadableStream({cancel: lateCancel}), {headers: {'Content-Type': 'text/event-stream'}});
        await expect(readChatGPTPlanStream(lateResponse, controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(lateCancel).toHaveBeenCalledOnce();
    });

    it('完成后取消上游剩余帧，reader不会长期占用连接', async () => {
        const cancel = vi.fn();
        const response = new Response(new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode(doneEvent()));}, cancel}), {headers: {'Content-Type': 'text/event-stream'}});
        expect(await readChatGPTPlanStream(response)).toMatchObject({status: 'completed'});
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('SSE多行data、未知field与没有冒号field符合协议，空event.type拒绝', async () => {
        const body = `id\nretry:1000\ndata:{\ndata:"type":"response.completed",\ndata:"response":${JSON.stringify(completed())}\ndata:}\n\n`;
        expect(await readChatGPTPlanStream(sse(body))).toMatchObject({status: 'completed'});
        await expect(readChatGPTPlanStream(sse('data:{"type":""}\n\n'))).rejects.toThrow('Responses');
    });

    it('缺失类型头、HTTP畸形对象和400拒绝，非Error取消转换为AbortError', async () => {
        await expect(readChatGPTPlanStream(new Response(new ReadableStream()))).rejects.toThrow('事件流');
        await expect(readChatGPTPlanStream(new Response('null', {status: 400}))).rejects.toMatchObject({kind: 'bad-request'});
        await expect(readChatGPTPlanStream(sse(event('error', {code: 'invalid_token'})))).rejects.toMatchObject({kind: 'authentication'});
        await expect(readChatGPTPlanStream(sse(event('error', {code: 'not a safe code'})))).rejects.toMatchObject({code: undefined});
        const controller = new AbortController();controller.abort('cancel');
        await expect(readChatGPTPlanStream(sse(doneEvent()), controller.signal)).rejects.toMatchObject({name: 'AbortError'});
    });

    it('单帧或尚未结束事件过大时有界终止，reader取消失败不会覆盖完成结果', async () => {
        for (const suffix of ['', '\n\n']) await expect(readChatGPTPlanStream(sse('data:' + 'x'.repeat(8_000_001) + suffix))).rejects.toThrow('事件过大');
        const cancel = vi.fn(async () => {throw new Error('fixture-cancel-error');});
        const response = new Response(new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode(doneEvent()));}, cancel}), {headers: {'Content-Type': 'text/event-stream'}});
        expect(await readChatGPTPlanStream(response)).toMatchObject({status: 'completed'});
        expect(cancel).toHaveBeenCalled();
        const controller = new AbortController();
        const stalled = readChatGPTPlanStream(new Response(new ReadableStream({cancel}), {headers: {'Content-Type': 'text/event-stream'}}), controller.signal);
        const failure = expect(stalled).rejects.toMatchObject({name: 'AbortError'});controller.abort();await failure;
    });
});
