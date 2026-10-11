import {describe, expect, it, vi} from 'vitest';

import {createFloatingPopupHandlers} from '@/src/features/floating-ball/background/popupHandler';

const runtimeId = 'fluentread-fixture';
const popupUrl = `chrome-extension://${runtimeId}/popup.html`;
type PopupContext = Parameters<ReturnType<typeof createFloatingPopupHandlers>[0]['handle']>[1];

function contentContext(overrides: Record<string, unknown> = {}): PopupContext {
    return {sender: {id: runtimeId, url: 'https://example.com/article', frameId: 0, tab: {id: 12}, ...overrides}} as PopupContext;
}

function popupContext(overrides: Record<string, unknown> = {}): PopupContext {
    return {sender: {id: runtimeId, url: popupUrl, frameId: 7, tab: {id: 12}, ...overrides}} as PopupContext;
}

function fixture() {
    let clock = 1_000;
    let sequence = 0;
    const randomToken = vi.fn(() => `a${(++sequence).toString(16).padStart(31, '0')}`);
    const [request, authorize] = createFloatingPopupHandlers({runtimeId, popupUrl, randomToken, now: () => clock});
    return {request, authorize, randomToken, setTime: (value: number) => {clock = value;}};
}

async function issue(current: ReturnType<typeof fixture>, context = contentContext()) {
    const response = await current.request.handle({type: 'requestFloatingPopup'}, context);
    expect(response.success).toBe(true);
    return response.token;
}

describe('悬浮球 popup 一次性授权', () => {
    it('从可信网页主 frame 发放令牌，并把授权绑定到浏览器来源 tab', async () => {
        const current = fixture();
        expect(current.request.type).toBe('requestFloatingPopup');
        expect(current.authorize.type).toBe('authorizeFloatingPopup');
        const response = await current.request.handle(
            {type: 'requestFloatingPopup', tabId: 99, frameId: 99, url: popupUrl} as never,
            contentContext(),
        );
        expect(response).toEqual({success: true, token: 'a0000000000000000000000000000001'});
        await expect(current.authorize.handle(
            {type: 'authorizeFloatingPopup', token: response.token, sourceTabId: 99} as never,
            popupContext(),
        )).resolves.toEqual({success: true, sourceTabId: 12});
        expect(current.randomToken).toHaveBeenCalledOnce();
    });

    it.each(['https://example.com', 'http://localhost/page', 'file:///tmp/article.html'])('接受已有内容脚本支持的网页来源 %s', async url => {
        const current = fixture();
        const token = await issue(current, contentContext({url}));
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext()))
            .resolves.toEqual({success: true, sourceTabId: 12});
    });

    it('tab 0 有效且不依赖可伪造 payload 或窗口标识', async () => {
        const current = fixture();
        const token = await issue(current, contentContext({tab: {id: 0, windowId: -1}}));
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext({tab: {id: 0}})))
            .resolves.toEqual({success: true, sourceTabId: 0});
    });

    it('缺失 sender、tab 或扩展身份时不发放令牌', async () => {
        const current = fixture();
        const invalidContexts = [
            {},
            {sender: {}},
            contentContext({id: undefined}),
            contentContext({id: 'another-extension'}),
            contentContext({tab: undefined}),
            contentContext({tab: {}}),
        ];
        for (const context of invalidContexts) {
            await expect(current.request.handle({type: 'requestFloatingPopup', tabId: 12} as never, context as PopupContext))
                .rejects.toThrow();
        }
        expect(current.randomToken).not.toHaveBeenCalled();
    });

    it.each([undefined, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '12'])('拒绝无效请求 tab id %s', async id => {
        const current = fixture();
        await expect(current.request.handle({type: 'requestFloatingPopup'}, contentContext({tab: {id}})))
            .rejects.toThrow();
        expect(current.randomToken).not.toHaveBeenCalled();
    });

    it.each([undefined, -1, 1, 0.5, NaN, Infinity, '0'])('仅允许网页主 frame 发放令牌，拒绝 frame %s', async frameId => {
        const current = fixture();
        await expect(current.request.handle({type: 'requestFloatingPopup'}, contentContext({frameId})))
            .rejects.toThrow();
        expect(current.randomToken).not.toHaveBeenCalled();
    });

    it.each([
        undefined,
        'not a url',
        'about:blank',
        'data:text/html,fixture',
        popupUrl,
        `chrome-extension://${runtimeId}/options.html`,
        'moz-extension://another-extension/popup.html',
    ])('不向非网页来源发放令牌 %s', async url => {
        const current = fixture();
        await expect(current.request.handle({type: 'requestFloatingPopup'}, contentContext({url})))
            .rejects.toThrow();
        expect(current.randomToken).not.toHaveBeenCalled();
    });

    it('来源不匹配的兑换不消耗合法令牌', async () => {
        const current = fixture();
        const token = await issue(current);
        const invalidContexts = [
            {},
            {sender: {}},
            popupContext({id: undefined}),
            popupContext({id: 'another-extension'}),
            popupContext({tab: undefined}),
            popupContext({tab: {}}),
            popupContext({tab: {id: 99}}),
        ];
        for (const context of invalidContexts) {
            await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, context as PopupContext))
                .rejects.toThrow();
        }
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext()))
            .resolves.toEqual({success: true, sourceTabId: 12});
    });

    it.each([undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '7'])('拒绝非嵌入子 frame 兑换 %s', async frameId => {
        const current = fixture();
        const token = await issue(current);
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext({frameId})))
            .rejects.toThrow();
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext()))
            .resolves.toEqual({success: true, sourceTabId: 12});
    });

    it.each([
        undefined,
        'not a url',
        `${popupUrl}?sourceTabId=12`,
        `${popupUrl}#main`,
        `${popupUrl}/child`,
        `chrome-extension://${runtimeId}/options.html`,
        'chrome-extension://another-extension/popup.html',
        `https://example.com/popup.html?origin=${popupUrl}`,
    ])('只有清单中精确 popup URL 能兑换 %s', async url => {
        const current = fixture();
        const token = await issue(current);
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext({url})))
            .rejects.toThrow();
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext()))
            .resolves.toEqual({success: true, sourceTabId: 12});
    });

    it.each([undefined, null, '', 1, true, {}, [], 'unknown-token'])('拒绝缺失、畸形或未知令牌 %s', async token => {
        const current = fixture();
        const validToken = await issue(current);
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext()))
            .rejects.toThrow();
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token: validToken}, popupContext()))
            .resolves.toEqual({success: true, sourceTabId: 12});
    });

    it('成功兑换会立即消耗令牌，顺序重放和并发重放均失败', async () => {
        const current = fixture();
        const token = await issue(current);
        const first = current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext());
        const replay = current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext());
        await expect(first).resolves.toEqual({success: true, sourceTabId: 12});
        await expect(replay).rejects.toThrow();
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext()))
            .rejects.toThrow();
    });

    it('令牌在 30 秒之前可用，到期边界与之后均失败', async () => {
        const current = fixture();
        const token = await issue(current);
        current.setTime(30_999);
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext()))
            .resolves.toEqual({success: true, sourceTabId: 12});
        const expiresAt = fixture();
        const expiredToken = await issue(expiresAt);
        expiresAt.setTime(31_000);
        await expect(expiresAt.authorize.handle({type: 'authorizeFloatingPopup', token: expiredToken}, popupContext()))
            .rejects.toThrow();
        expiresAt.setTime(31_001);
        await expect(expiresAt.authorize.handle({type: 'authorizeFloatingPopup', token: expiredToken}, popupContext()))
            .rejects.toThrow();
    });

    it('同 tab 的新请求替换旧令牌，其他 tab 仍可分别兑换', async () => {
        const current = fixture();
        const oldToken = await issue(current);
        const otherToken = await issue(current, contentContext({tab: {id: 13}}));
        const token = await issue(current);
        expect(token).not.toBe(oldToken);
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token: oldToken}, popupContext()))
            .rejects.toThrow();
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token: otherToken}, popupContext({tab: {id: 13}})))
            .resolves.toEqual({success: true, sourceTabId: 13});
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext()))
            .resolves.toEqual({success: true, sourceTabId: 12});
    });

    it('过期令牌不会影响后续新请求的兑换', async () => {
        const current = fixture();
        const oldToken = await issue(current);
        current.setTime(31_000);
        const token = await issue(current, contentContext({tab: {id: 13}}));
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token: oldToken}, popupContext()))
            .rejects.toThrow();
        await expect(current.authorize.handle({type: 'authorizeFloatingPopup', token}, popupContext({tab: {id: 13}})))
            .resolves.toEqual({success: true, sourceTabId: 13});
    });
});
