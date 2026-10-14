import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockConfig} = vi.hoisted(() => ({mockConfig: {
    from: 'auto', to: 'zh-Hans', myMemoryEmail: '',
}}));
vi.mock('@/src/services/config/store', () => ({config: mockConfig}));
vi.mock('webextension-polyfill', () => ({default: {storage: {
    session: {get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined)},
    onChanged: {addListener: vi.fn(), removeListener: vi.fn()},
}}}));

import {Config} from '@/src/core/config/model';
import {createTranslationProviderConfigSnapshot} from '@/src/services/translation/requestSnapshot';
import {setRuntimeFetch} from '@/src/platform/http/runtime';
import {CONNECTION_TEST_ORIGIN, runTranslationServiceConnectionTest} from '@/src/providers/translation/connectionTest';

const fetchMock = vi.fn<typeof fetch>();
const reply = () => Response.json({responseStatus: 200, responseData: {translatedText: '来自流畅阅读的问候。'}});
const requestUrl = () => new URL(String(fetchMock.mock.calls.at(-1)![0]));

beforeEach(() => {
    fetchMock.mockReset().mockImplementation(async () => reply());
    Object.assign(mockConfig, {from: 'auto', to: 'zh-Hans', myMemoryEmail: ''});
    setRuntimeFetch(fetchMock);
});
afterEach(() => setRuntimeFetch());

describe('MyMemory 检查连接的短英文语言回归', () => {
    it('真实适配器缺少快照时在网络前明确失败', async () => {
        await expect(runTranslationServiceConnectionTest('myMemory')).rejects.toMatchObject({code: 'TRANSLATION_PROVIDER_CONFIG_REQUIRED'});
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([
        {from: 'auto', to: 'zh-Hans', myMemoryEmail: ''},
        {from: 'auto', to: 'en', myMemoryEmail: ''},
        {from: 'ja', to: 'fr', myMemoryEmail: ''},
        {from: 'auto', to: 'zh-Hant', myMemoryEmail: 'check@example.com'},
    ])('设置为 $from → $to 时使用有效测试语言对且保留配置', async settings => {
        const source = Object.assign(new Config(), settings);
        const snapshot = createTranslationProviderConfigSnapshot(source);
        // 模拟开始检查后其他页面更改配置；邮箱仍取本次冻结快照。
        Object.assign(mockConfig, {from: 'de', to: 'en', myMemoryEmail: 'changed@example.com'});

        await expect(runTranslationServiceConnectionTest('myMemory', {configSnapshot: snapshot}))
            .resolves.toEqual({durationMs: expect.any(Number)});

        expect(fetchMock).toHaveBeenCalledOnce();
        const url = requestUrl();
        expect(url.origin + url.pathname).toBe('https://api.mymemory.translated.net/get');
        expect(url.searchParams.get('q')).toBe(CONNECTION_TEST_ORIGIN);
        expect(url.searchParams.get('langpair')).toBe('en|zh-CN');
        expect(url.searchParams.get('de')).toBe(settings.myMemoryEmail || null);
        expect(source).toMatchObject(settings);
        expect(snapshot).toMatchObject(settings);
    });

    it('调用边界显式注入快照后发送请求，无需改动自动识别设置', async () => {
        await expect(runTranslationServiceConnectionTest('myMemory', {configSnapshot: createTranslationProviderConfigSnapshot(Object.assign(new Config(), mockConfig))})).resolves.toBeTruthy();
        expect(requestUrl().searchParams.get('langpair')).toBe('en|zh-CN');
        expect(mockConfig).toEqual({from: 'auto', to: 'zh-Hans', myMemoryEmail: ''});
    });

    it('实际额度失败仍报错，重试会重新请求并可恢复成功', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({
            responseStatus: 200, quotaFinished: true, responseData: {translatedText: 'quota exhausted'},
        }));
        await expect(runTranslationServiceConnectionTest('myMemory', {configSnapshot: createTranslationProviderConfigSnapshot(Object.assign(new Config(), mockConfig))})).rejects.toMatchObject({statusCode: 429});
        await expect(runTranslationServiceConnectionTest('myMemory', {configSnapshot: createTranslationProviderConfigSnapshot(Object.assign(new Config(), mockConfig))})).resolves.toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
