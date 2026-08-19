import {describe, expect, it, vi} from 'vitest';

const {adapter} = vi.hoisted(() => ({
    adapter: vi.fn(),
}));

vi.mock('@/entrypoints/service/_service', () => ({
    _service: {
        demo: adapter,
    },
}));

import {
    CONNECTION_TEST_ORIGIN,
    runTranslationServiceConnectionTest,
} from '@/entrypoints/service/connection-test';
import {formatServiceError} from '@/entrypoints/utils/serviceError';
import {services} from '@/entrypoints/utils/option';

describe('翻译服务连接测试', () => {
    it('调用真实适配器并禁用翻译缓存', async () => {
        adapter.mockResolvedValue('测试译文');

        await expect(runTranslationServiceConnectionTest('demo')).resolves.toEqual(expect.objectContaining({
            durationMs: expect.any(Number),
        }));
        expect(adapter).toHaveBeenCalledWith(expect.objectContaining({
            origin: CONNECTION_TEST_ORIGIN,
            serviceOverride: 'demo',
            useCache: false,
        }));
    });

    it('拒绝空响应，避免把仅 HTTP 成功误报为连接正常', async () => {
        adapter.mockResolvedValue('   ');

        await expect(runTranslationServiceConnectionTest('demo')).rejects.toThrow('没有返回有效译文');
    });

    it('将 MiniMax 2049 错误转换为 Key、区域和计费类型提示', () => {
        const message = formatServiceError(
            services.minimax,
            new Error('翻译失败: 401 Unauthorized body: {"message":"invalid api key (2049)"}'),
        );

        expect(message).toContain('Token Plan Key');
        expect(message).toContain('api.minimaxi.com');
        expect(message).toContain('api.minimax.io');
        expect(message).toContain('不能互换');
    });
});
