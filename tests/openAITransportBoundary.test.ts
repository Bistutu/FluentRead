import {afterEach, describe, expect, it, vi} from 'vitest';
import {providerConfigFixture, withProviderSnapshot} from './helpers/providerSnapshot';
import {translateOpenAICompatible, type AiSdkTranslationRequest, type OpenAICompatibleCall, type OpenAICompatibleExecution} from '@/src/providers/translation/ai-sdk/openai-transport';
import {LlmTransportError, normalizeAiSdkError} from '@/src/providers/translation/ai-sdk/errors';
import {LlmTransportError as SharedError} from '@/src/providers/translation/ai-sdk/transport-errors';
import {translateWithOpenAICompatibleAiSdk as direct} from '@/userscript/openaiCompatible';
import * as endpoints from '@/src/providers/translation/ai-sdk/endpoints';
import * as templates from '@/src/services/translation/templates';
import {setRuntimeFetch} from '@/src/platform/http/runtime';
import {attachTranslationImageInput, attachTranslationModelUsageObserver, attachTranslationRequestScheduler, attachTranslationProviderConfig, requireTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import {createTranslationRequestScheduler} from '@/src/services/translation/requestScheduler';
import type {TranslationConfigSource} from '@/src/services/translation/types';

const config = () => providerConfigFixture({service: 'custom', model: {custom: 'fixture-model'}, token: {},
  custom: 'https://fixture.invalid/v1', translationMaxRetries: 0});
const request = (overrides: Partial<AiSdkTranslationRequest> = {}, settings: Partial<TranslationConfigSource> = {}) =>
  withProviderSnapshot({origin: 'Fixture source', ...overrides}, {...config(), ...settings});
const execution = (run: OpenAICompatibleExecution['run']): OpenAICompatibleExecution => ({run, normalizeError: normalizeAiSdkError});
const textResponse = (extra: Record<string, unknown> = {}) => new Response(JSON.stringify({choices: [{message: {content: '译文'}}], ...extra}));

afterEach(() => {setRuntimeFetch(); vi.restoreAllMocks(); vi.useRealTimers();});

describe('shared OpenAI request and response boundary', () => {
  it('re-exports one error class instead of producing incompatible SDK and standalone identities', () => {
    expect(SharedError).toBe(LlmTransportError);
  });

  it.each(['{', 'null', '3', '[]', '{"model":4,"messages":[]}', '{"model":" ","messages":[]}', '{"model":"valid","messages":{}}'])
  ('rejects a malformed payload at the preparation boundary before dispatch: %s', async body => {
    vi.spyOn(templates, 'commonMsgTemplate').mockReturnValueOnce(body);
    const run = vi.fn();
    await expect(translateOpenAICompatible(request(), execution(run))).rejects.toMatchObject({kind: 'bad-request', retryable: false});
    expect(run).not.toHaveBeenCalled();
  });

  it('normalizes a non-Error endpoint rejection and rejects malformed custom headers without a request', async () => {
    vi.spyOn(endpoints, 'resolveOpenAICompatibleEndpoint').mockImplementationOnce(() => {throw 'invalid endpoint';});
    const run = vi.fn();
    await expect(translateOpenAICompatible(request(), execution(run))).rejects.toMatchObject({message: 'invalid endpoint', kind: 'bad-request'});
    vi.mocked(endpoints.resolveOpenAICompatibleEndpoint).mockReturnValueOnce({endpoint: 'https://fixture.invalid/v1/chat/completions', baseURL: 'https://fixture.invalid/v1'});
    await expect(translateOpenAICompatible(request({serviceOverride: 'custom:fixture'},
      {customHeaders: {'custom:fixture': '{"invalid header":"value"}'}}), execution(run))).rejects.toMatchObject({kind: 'bad-request'});
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps OpenRouter attribution headers in the shared prepared request', async () => {
    const run = vi.fn(async (_call: OpenAICompatibleCall) => '译文');
    await translateOpenAICompatible(request({serviceOverride: 'openrouter'}, {model: {openrouter: 'fixture/model'}}), execution(run));
    expect(run.mock.calls[0][0].headers).toEqual({'HTTP-Referer': 'https://fluent.thinkstu.com', 'X-Title': 'FluentRead'});
  });

  it.each([
    {prompt_tokens_details: 'invalid', completion_tokens_details: 'invalid'},
    {prompt_tokens_details: [], completion_tokens_details: []},
    {prompt_tokens_details: {}, completion_tokens_details: {}},
    {prompt_tokens_details: {cached_tokens: 2.8, cache_write_tokens: 3.9}, completion_tokens_details: {reasoning_tokens: 4.7}},
    {prompt_tokens_details: {cached_tokens: -2, cache_write_tokens: '3'}, completion_tokens_details: {reasoning_tokens: -1}},
  ])('normalizes optional usage details while retaining the original usage observation: %j', async usage => {
    const original = textResponse({usage, model: 'actual-model'});
    setRuntimeFetch(async () => original);
    const observe = vi.fn();
    const source = attachTranslationModelUsageObserver(request(), observe);
    let normalized: any;
    await translateOpenAICompatible(source, execution(async call => {
      const response = await call.fetch('https://fixture.invalid/v1/chat/completions', {signal: call.signal});
      normalized = await response.json(); return normalized.choices[0].message.content;
    }));
    expect(normalized.model).toBe('actual-model');
    expect(original.bodyUsed).toBe(true);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0][0]).toMatchObject({outcome: 'success', actualModel: 'actual-model'});
    if (typeof usage.prompt_tokens_details === 'object' && !Array.isArray(usage.prompt_tokens_details)
      && 'cached_tokens' in usage.prompt_tokens_details && typeof usage.prompt_tokens_details.cached_tokens === 'number'
      && usage.prompt_tokens_details.cached_tokens >= 0) {
      expect(normalized.usage).toEqual({prompt_tokens_details: {cached_tokens: 2, cache_write_tokens: 3}, completion_tokens_details: {reasoning_tokens: 4}});
    } else expect(normalized.usage).toBeUndefined();
  });

  it.each(['{broken', 'null', '{"choices":[]}', '{"choices":[{"message":{"content":null}}]}'])
  ('keeps malformed or non-text HTTP responses as errors rather than rebuilding success: %s', async body => {
    setRuntimeFetch(async () => new Response(body));
    await expect(direct(request())).rejects.toBeInstanceOf(LlmTransportError);
  });

  it('uses an attached scheduler without inventing a lease or a signal when the executor omits init', async () => {
    const scheduler = createTranslationRequestScheduler(() => ({maxConcurrentTranslations: 1}));
    const schedule = vi.spyOn(scheduler, 'scheduleAttempt');
    const observe = vi.spyOn(scheduler, 'observeResponse');
    setRuntimeFetch(async () => textResponse());
    const source = attachTranslationRequestScheduler(request(), scheduler);
    await translateOpenAICompatible(source, execution(async call => {
      const response = await call.fetch('https://fixture.invalid/v1/chat/completions');
      return (await response.json()).choices[0].message.content;
    }));
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({signal: undefined, countConcurrency: false}));
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it('retains explicit attempt settlement on the caller lease and defaults older snapshots to two retries', async () => {
    const scheduler = createTranslationRequestScheduler(() => ({}));
    const lease = {holdUntil: vi.fn()};
    const snapshot = requireTranslationProviderConfig(request());
    const source = attachTranslationRequestScheduler(attachTranslationProviderConfig({origin: 'Source'},
      {...snapshot, translationMaxRetries: undefined}), scheduler, undefined, lease);
    setRuntimeFetch(async () => textResponse());
    await translateOpenAICompatible(source, execution(async call => {
      expect(call.maxRetries).toBe(2);
      await call.fetch('https://fixture.invalid/v1/chat/completions', {signal: call.signal});
      return '译文';
    }));
    expect(lease.holdUntil).toHaveBeenCalledTimes(1);
    await expect(lease.holdUntil.mock.calls[0][0]).resolves.toMatchObject({response: expect.any(Response)});
  });

  it.each([
    ['image_url is not supported by this model', true],
    ['invalid model request', false],
  ] as const)('keeps explicit image rejection ownership: %s', async (message, unsupported) => {
    setRuntimeFetch(async () => new Response(JSON.stringify({error: {message}}), {status: 400}));
    const source = attachTranslationImageInput(request(), 'data:image/png;base64,AAAA');
    const error = await direct(source).catch(error => error);
    expect(Boolean(error.imageInputUnsupported)).toBe(unsupported);
    expect(error instanceof LlmTransportError).toBe(!unsupported);
  });

  it('preserves caller cancellation before execution and cleans its deadline timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(); controller.abort();
    const run = vi.fn(async (call: OpenAICompatibleCall) => {expect(call.signal.aborted).toBe(true); throw new DOMException('aborted', 'AbortError');});
    await expect(translateOpenAICompatible(request({abortSignal: controller.signal}), execution(run))).rejects.toMatchObject({kind: 'timeout', retryable: false});
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['', '<think>Only reasoning</think>'])('rejects empty visible text and preserves its transport identity: %s', async text => {
    await expect(translateOpenAICompatible(request(), execution(async () => text))).rejects.toMatchObject({kind: 'response', retryable: false});
  });

  it('preserves an already classified error from the executor without rewrapping it', async () => {
    const error = new LlmTransportError('classified', {kind: 'bad-request', retryable: false});
    await expect(translateOpenAICompatible(request(), execution(async () => {throw error;}))).rejects.toBe(error);
  });

  it('does not start a second batch item when the shared absolute budget expired between items', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const run = vi.fn(async () => {vi.setSystemTime(1020); return 'first';});
    await expect(translateOpenAICompatible(request({origin: ['one', 'two'], requestTimeoutMs: 10}), execution(run))).rejects.toMatchObject({kind: 'timeout', retryable: true});
    expect(run).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});
