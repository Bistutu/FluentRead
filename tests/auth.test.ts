import { describe, expect, it } from 'vitest';

import { appendOptionalBearer, appendOptionalHeader } from '@/entrypoints/service/auth';

describe('可选 API 鉴权请求头', () => {
    it('没有令牌时不发送伪造的 Bearer 请求头', () => {
        const headers = new Headers();
        appendOptionalBearer(headers, '  ');
        expect(headers.has('Authorization')).toBe(false);
    });

    it('有令牌时保留标准鉴权请求头', () => {
        const headers = new Headers();
        appendOptionalBearer(headers, ' secret-token ');
        expect(headers.get('Authorization')).toBe('Bearer secret-token');
    });

    it('可选的非 Bearer 鉴权头同样跳过空值', () => {
        const headers = new Headers();
        appendOptionalHeader(headers, 'x-api-key', '');
        expect(headers.has('x-api-key')).toBe(false);
    });
});
