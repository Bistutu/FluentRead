import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockConfig} = vi.hoisted(() => ({
    mockConfig: {
        from: 'auto',
        to: 'zh-Hans',
    },
}));

vi.mock('@/entrypoints/utils/config', () => ({config: mockConfig}));

import google, {
    parseGoogleBatchResponse,
    parseGoogleLegacyResponse,
    translateGoogleText,
} from '@/entrypoints/service/google';

const fetchMock = vi.fn<typeof fetch>();

function createBatchResponse(translations: string[]): string {
    const payload = [
        null,
        [[[
            null,
            null,
            null,
            null,
            null,
            translations.map(text => [text]),
        ]]],
    ];
    const records = [
        ['wrb.fr', 'MkEWBc', JSON.stringify(payload), null, null, null, 'generic'],
        ['di', 123],
    ];
    return `)]}'\n\n${JSON.stringify(records)}`;
}

function createLegacyResponse(translations: string[]): string {
    return JSON.stringify([
        translations.map(text => [text, null, null, null]),
        null,
        'en',
    ]);
}

function mockResponse(responseBody: string, overrides: Partial<Response> = {}): Response {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(responseBody),
        ...overrides,
    } as unknown as Response;
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('谷歌翻译适配器', () => {
    it('优先通过无需 API Key 的主网页 RPC 返回译文', async () => {
        fetchMock.mockResolvedValue(mockResponse(createBatchResponse(['此域名仅用于文档中的示例。'])));

        await expect(google({origin: 'This domain is for use in documents.'}))
            .resolves.toBe('此域名仅用于文档中的示例。');

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe('https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?rpcids=MkEWBc');
        expect(init).toMatchObject({
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
        });
        expect(init?.headers).not.toHaveProperty('X-Goog-API-Key');

        const requestBody = new URLSearchParams(String(init?.body)).get('f.req');
        expect(requestBody).not.toBeNull();
        const batchRequest = JSON.parse(requestBody!);
        expect(batchRequest[0][0][0]).toBe('MkEWBc');
        expect(batchRequest[0][0][2]).toBeNull();
        expect(batchRequest[0][0][3]).toBe('generic');
        expect(JSON.parse(batchRequest[0][0][1])).toEqual([
            ['This domain is for use in documents.', 'auto', 'zh-Hans', true],
            [null],
        ]);
    });

    it('主网页 RPC 失败后切换到备用区域 RPC', async () => {
        fetchMock
            .mockResolvedValueOnce(mockResponse('temporarily unavailable', {
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
            }))
            .mockResolvedValueOnce(mockResponse(createBatchResponse(['备用接口成功'])));

        await expect(translateGoogleText('hello', 'en', 'zh-Hans'))
            .resolves.toBe('备用接口成功');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1]?.[0]).toBe(
            'https://translate.google.co.uk/_/TranslateWebserverUi/data/batchexecute?rpcids=MkEWBc',
        );
    });

    it('两个网页 RPC 都失败后使用旧版 gtx 接口', async () => {
        fetchMock
            .mockResolvedValueOnce(mockResponse('bad gateway', {
                ok: false,
                status: 502,
                statusText: 'Bad Gateway',
            }))
            .mockResolvedValueOnce(mockResponse(`)]}'\n\n[["unexpected", true]]`))
            .mockResolvedValueOnce(mockResponse(createLegacyResponse(['旧版', '接口成功'])));

        await expect(translateGoogleText('hello & goodbye', 'en', 'zh-Hans'))
            .resolves.toBe('旧版接口成功');

        expect(fetchMock).toHaveBeenCalledTimes(3);
        const [url, init] = fetchMock.mock.calls[2]!;
        expect(url).toBeInstanceOf(URL);
        const legacyUrl = url as URL;
        expect(legacyUrl.origin + legacyUrl.pathname).toBe(
            'https://translate.googleapis.com/translate_a/single',
        );
        expect(legacyUrl.searchParams.get('client')).toBe('gtx');
        expect(legacyUrl.searchParams.get('q')).toBe('hello & goodbye');
        expect(init).toMatchObject({method: 'GET'});
        expect(init?.headers).toBeUndefined();
    });

    it('所有接口失败时汇总原因并隐藏 CAPTCHA HTML', async () => {
        fetchMock
            .mockResolvedValueOnce(mockResponse('<!doctype html><html>captcha details</html>', {
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
            }))
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(mockResponse('not-json'));

        await expect(translateGoogleText('hello', 'en', 'zh-Hans'))
            .rejects.toThrow(
                '谷歌翻译所有匿名接口均失败：主网页 RPC: HTTP 429 Too Many Requests，响应: 收到 HTML 页面（可能触发了 CAPTCHA）；备用网页 RPC: Failed to fetch；旧版 gtx 接口: 返回的不是 JSON',
            );
    });

    it('按网页 RPC 服务端片段原样拼接译文，不额外插入空格', () => {
        expect(parseGoogleBatchResponse(createBatchResponse(['第一句话。', '第二句话！'])))
            .toBe('第一句话。第二句话！');
    });

    it('按旧版 gtx 服务端片段原样拼接译文', () => {
        expect(parseGoogleLegacyResponse(createLegacyResponse(['第一句话。', '第二句话！'])))
            .toBe('第一句话。第二句话！');
    });

    it('保留换行和普通文本中的 HTML 字符', async () => {
        fetchMock.mockResolvedValue(mockResponse(
            createBatchResponse(['如果 x < 3 && y > 1\n', '下一行']),
        ));

        await expect(translateGoogleText('if x < 3 && y > 1\nNext line', 'en', 'zh-Hans'))
            .resolves.toBe('如果 x < 3 && y > 1\n下一行');
    });

    it('忽略网页 RPC 的防劫持前缀、长度行和无关记录', () => {
        const response = createBatchResponse(['测试成功']).replace('\n\n', '\n\n1234\nnot-json\n');
        expect(parseGoogleBatchResponse(response)).toBe('测试成功');
    });

    it('拒绝无法识别的网页 RPC 与旧版响应结构', () => {
        expect(() => parseGoogleBatchResponse(`)]}'\n\n[["unexpected", true]]`))
            .toThrow('返回格式异常');
        expect(() => parseGoogleLegacyResponse('{"unexpected":true}'))
            .toThrow('返回格式异常');
    });

    it('三个接口均发生网络异常时返回完整故障转移信息', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(translateGoogleText('hello', 'en', 'zh-Hans'))
            .rejects.toThrow(
                '谷歌翻译所有匿名接口均失败：主网页 RPC: Failed to fetch；备用网页 RPC: Failed to fetch；旧版 gtx 接口: Failed to fetch',
            );
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('拒绝批量文本输入', async () => {
        await expect(google({origin: ['hello']} as unknown as {origin: string}))
            .rejects.toThrow('谷歌翻译仅支持单条文本');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
