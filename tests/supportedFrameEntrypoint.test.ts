import {afterEach, beforeEach, expect, it, vi} from 'vitest';

const routes = vi.hoisted(() => ({mail: vi.fn(), embedded: vi.fn()}));
vi.mock('@/src/app/content/qqMailFrameRuntime', () => ({startQqMailFrameApp: routes.mail}));
vi.mock('@/src/app/content/embeddedFrameRuntime', () => ({startEmbeddedFrameApp: routes.embedded}));

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('defineContentScript', (entry: unknown) => entry);
});

afterEach(() => vi.unstubAllGlobals());

it('共用入口只覆盖受支持的四类 frame，并按主机委托到对应运行时', async () => {
    const entry = (await import('../entrypoints/supportedFrame.content')).default;
    expect(entry.matches).toEqual([
        'https://*.hf.space/*',
        'https://disqus.com/embed/comments/*',
        'https://www.kaggleusercontent.com/kf/*/__results__.html*',
        'https://mail.qq.com/cgi-bin/readmail*',
    ]);
    expect(entry.allFrames).toBe(true);
    expect(entry.matchAboutBlank).toBeUndefined();

    const context = {id: 'frame-context'} as never;
    vi.stubGlobal('window', {location: {hostname: 'mail.qq.com'}});
    await entry.main(context);
    expect(routes.mail).toHaveBeenCalledOnce();
    expect(routes.mail).toHaveBeenCalledWith(context);
    expect(routes.embedded).not.toHaveBeenCalled();

    routes.mail.mockClear();
    for (const hostname of ['disqus.com', 'www.kaggleusercontent.com', 'fineenvs-rl-explorer.hf.space']) {
        vi.stubGlobal('window', {location: {hostname}});
        await entry.main(context);
    }
    expect(routes.embedded).toHaveBeenCalledTimes(3);
    expect(routes.mail).not.toHaveBeenCalled();
});
