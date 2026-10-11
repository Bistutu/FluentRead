import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';
import {createVideoSentenceLearningSession, type VideoSentenceLearningTarget} from '@/src/features/video-subtitle/content/sentenceLearningSession';
import type {MutableVideoSentenceLearningProps} from '@/src/features/video-subtitle/content/sentenceLearningHost';

function deferred<T>() {
    let resolve!: (value: T) => void; let reject!: (cause: Error) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}

function fixture() {
    const {document} = parseHTML('<html><body><div id="player"><div id="fullscreen"><video></video></div></div><div id="other"><video id="another"></video></div></body></html>');
    const player = document.getElementById('player')!; const fullscreen = document.getElementById('fullscreen')!;
    const video = document.querySelector('video')! as HTMLVideoElement;
    let target: VideoSentenceLearningTarget | null = {player, video}; let allowed = true;
    const load = vi.fn(async () => 'View'); const unmount = vi.fn(), placeSync = vi.fn(), placeDestroy = vi.fn();
    const mount = vi.fn((_view: string, host: HTMLElement) => {
        const section = document.createElement('section'); section.focus = vi.fn(); host.appendChild(section); return unmount;
    });
    const readProps = vi.fn(({video}: VideoSentenceLearningTarget, onClose: () => void): MutableVideoSentenceLearningProps => ({
        video, onClose, cues: [{text: 'A complete sentence.', startMs: 1000, durationMs: 2000}],
        platform: 'youtube', title: 'Video title', sourceLanguage: 'en', targetLanguage: 'zh-Hans', translate: async text => text,
    }));
    const session = createVideoSentenceLearningSession({load, mount, readProps, markUi: vi.fn(),
        place: () => ({syncPlayer: placeSync, destroy: placeDestroy}), readTarget: () => target, canOpen: () => allowed});
    return {document, player, fullscreen, video, session, load, mount, readProps, unmount, placeSync, placeDestroy,
        setTarget: (next: VideoSentenceLearningTarget | null) => {target = next;}, setAllowed: (next: boolean) => {allowed = next;}};
}

describe('完整句学习延迟加载会话归属', () => {
    it('只在具备资格和目标时加载，用同一媒体最新全屏容器挂载并复用 host 的更新与清理', async () => {
        const f = fixture(); f.setAllowed(false); await f.session.open(); expect(f.load).not.toHaveBeenCalled();
        f.setAllowed(true); f.setTarget(null); await f.session.open(); expect(f.load).not.toHaveBeenCalled();
        f.setTarget({video: f.video, player: f.player});
        const pending = deferred<string>(); f.load.mockReturnValueOnce(pending.promise);
        const opening = f.session.open(); expect(f.session.isOpen()).toBe(false); expect(f.mount).not.toHaveBeenCalled();
        f.setTarget({video: f.video, player: f.fullscreen}); pending.resolve('Ready view'); await opening;
        expect(f.mount).toHaveBeenCalledWith('Ready view', f.document.getElementById('fluent-read-video-learning-panel'), f.readProps.mock.results[0].value);
        expect(f.readProps).toHaveBeenCalledWith({video: f.video, player: f.fullscreen}, f.session.close);
        expect(f.session.isConnected(f.fullscreen)).toBe(true); expect(f.session.hasCues()).toBe(true);
        const cues = [{text: 'Updated sentence.', startMs: 4000, durationMs: 1000}];
        f.session.updateCues(cues, 'de'); expect(f.readProps.mock.results[0].value.cues).toBe(cues);
        expect(f.session.syncPlayer(f.player, f.video)).toBe(true); expect(f.placeSync).toHaveBeenCalledWith(f.player);
        f.readProps.mock.results[0].value.onClose(); expect(f.session.isOpen()).toBe(false);
        expect(f.unmount).toHaveBeenCalledOnce(); expect(f.placeDestroy).toHaveBeenCalledOnce(); f.session.destroy();
    });

    it.each(['missing', 'different', 'disallowed'] as const)('加载期间目标变为 %s 时不会挂载旧媒体', async kind => {
        const f = fixture(); const pending = deferred<string>(); f.load.mockReturnValueOnce(pending.promise);
        const opening = f.session.open();
        if (kind === 'missing') f.setTarget(null);
        if (kind === 'different') f.setTarget({player: f.document.getElementById('other')!, video: f.document.getElementById('another')! as HTMLVideoElement});
        if (kind === 'disallowed') f.setAllowed(false);
        pending.resolve('View'); await opening; expect(f.mount).not.toHaveBeenCalled(); f.session.destroy();
    });

    it('定位器缓存失联媒体时不加载视图，重新连接后仍能打开', async () => {
        const f = fixture(); f.player.remove(); await f.session.open();
        expect(f.load).not.toHaveBeenCalled(); expect(f.readProps).not.toHaveBeenCalled();
        f.document.body.appendChild(f.player); await f.session.open();
        expect(f.session.isConnected(f.player)).toBe(true); expect(f.load).toHaveBeenCalledOnce(); f.session.destroy();
    });

    it.each(['remove-video', 'remove-player', 'move-video'] as const)('站点在视图加载期间 %s，缓存旧目标不能挂载或启动翻译', async change => {
        const f = fixture(); const pending = deferred<string>(); f.load.mockReturnValueOnce(pending.promise);
        const opening = f.session.open();
        if (change === 'remove-video') f.video.remove();
        if (change === 'remove-player') {f.document.body.appendChild(f.video); f.player.remove();}
        if (change === 'move-video') f.document.getElementById('other')!.appendChild(f.video);
        pending.resolve('View'); await opening;
        expect(f.mount).not.toHaveBeenCalled(); expect(f.readProps).not.toHaveBeenCalled();
        expect(f.session.isOpen()).toBe(false); expect(f.document.getElementById('fluent-read-video-learning-panel')).toBeNull();
        f.session.destroy();
    });

    it.each(['close', 'destroy'] as const)('%s 淘汰正在加载的结果，销毁后不能重新打开', async action => {
        const f = fixture(); const pending = deferred<string>(); f.load.mockReturnValueOnce(pending.promise);
        const opening = f.session.open(); f.session[action](); pending.resolve('Stale view'); await opening;
        expect(f.mount).not.toHaveBeenCalled(); f.session.destroy(); f.session.destroy(); await f.session.open();
        expect(f.load).toHaveBeenCalledOnce(); expect(f.session.isOpen()).toBe(false);
    });

    it('连续打开只接受最近一次完成，迟到成功不会替换已经显示的面板', async () => {
        const f = fixture(); const first = deferred<string>(), second = deferred<string>();
        f.load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const old = f.session.open(); const latest = f.session.open();
        second.resolve('Latest view'); await latest; const panel = f.document.getElementById('fluent-read-video-learning-panel');
        first.resolve('Old view'); await old; expect(f.mount).toHaveBeenCalledOnce();
        expect(f.document.getElementById('fluent-read-video-learning-panel')).toBe(panel);
        expect(f.mount.mock.calls[0][0]).toBe('Latest view'); f.session.destroy();
    });

    it('当前加载失败可重试，迟到旧失败及销毁后的失败不会传播到新面板的关闭回调', async () => {
        const f = fixture(); f.load.mockRejectedValueOnce(new Error('Current load failed'));
        await expect(f.session.open()).rejects.toThrow('Current load failed'); await f.session.open(); expect(f.session.isOpen()).toBe(true);
        const oldFailure = deferred<string>(); f.load.mockReturnValueOnce(oldFailure.promise);
        const old = f.session.open(); await f.session.open(); oldFailure.reject(new Error('Stale failure')); await expect(old).resolves.toBeUndefined();
        expect(f.session.isOpen()).toBe(true);
        const destroyedFailure = deferred<string>(); f.load.mockReturnValueOnce(destroyedFailure.promise);
        const destroyed = f.session.open(); f.session.destroy(); destroyedFailure.reject(new Error('After destroy'));
        await expect(destroyed).resolves.toBeUndefined(); expect(f.session.isOpen()).toBe(false);
    });
});
