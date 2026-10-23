import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';
import {
    createDeclarativeAdapter,
    createTranslationSourceSnapshot,
} from '@/src/core/translation/public';
import {createTranslationCore} from './helpers/translationCore';

describe('upstream message metadata regressions', () => {
    it('只省略显式 metadata，keepOriginal 内容仍留在双语原文骨架', () => {
        const {document} = parseHTML('<html><body><p id="owner">Readable <code id="code">KEEP_ME</code><span id="metadata">11:08 AM (edited)</span></p></body></html>');
        const core = createTranslationCore({
            url: new URL('https://metadata.example/article'),
            adapters: [createDeclarativeAdapter({
                id: 'metadata-fixture',
                hosts: ['metadata.example'],
                keepOriginal: [
                    {selector: '#code', reason: 'fixture-code'},
                    {selector: '#metadata', reason: 'fixture-metadata'},
                ],
                omitFromTranslation: [{selector: '#metadata', reason: 'fixture-metadata'}],
            })],
        });
        const owner = document.querySelector<HTMLElement>('#owner')!;
        const snapshot = createTranslationSourceSnapshot(
            owner,
            core.shouldStayOriginal,
            undefined,
            undefined,
            core.shouldOmitFromTranslation,
        );

        expect(snapshot.slots.map((slot) => slot.source)).toEqual(['Readable']);
        expect(snapshot.clone.querySelector('#code')?.textContent).toBe('KEEP_ME');
        expect(snapshot.clone.querySelector('#metadata')).toBeNull();
    });

    it('X Chat 普通及长消息的页脚不会进入服务请求，时间线相似正文仍可翻译', () => {
        const {document} = parseHTML('<html><body><div id="bubble"><div id="body">Please read the latest update.<span aria-hidden="true"><div class="flex items-center ml-auto shrink-0 gap-1">11:08 AM</div></span></div><div class="absolute bottom-0 inset-e-0"><div id="footer" class="flex items-center ml-auto shrink-0 gap-1">11:08 AM Delivered</div></div></div></body></html>');
        const core = createTranslationCore({url: new URL('https://chat.x.com/conversation')});
        const bubble = document.querySelector('#bubble') as HTMLElement;
        const footer = document.querySelector('#footer') as HTMLElement;
        const snapshot = () => createTranslationSourceSnapshot(
            bubble,
            core.shouldStayOriginal,
            undefined,
            undefined,
            core.shouldOmitFromTranslation,
        );
        const text = () => snapshot().slots.map((slot) => slot.source).join('|');
        expect(text()).toBe('Please read the latest update.');
        expect(core.resolve(footer)).toBeNull();
        expect(core.discover(document).some((candidate) => candidate.element.id === 'body')).toBe(true);
        footer.parentElement!.className = 'contents';
        expect(text()).toBe('Please read the latest update.');
        expect(snapshot().clone.querySelector('#footer')).toBeNull();
        const timeline = createTranslationCore({url: new URL('https://x.com/home')});
        expect(createTranslationSourceSnapshot(bubble, timeline.shouldStayOriginal).slots.map((slot) => slot.source))
            .toContain('11:08 AM Delivered');
    });

    it('Discord 编辑后新增时间戳元数据不会污染消息，非 Discord 页面同名类保持可译', () => {
        const {document} = parseHTML('<html><body><div id="message-content-123"><span id="body">Please review this edited message.</span></div></body></html>');
        const core = createTranslationCore({url: new URL('https://discord.com/channels/1/2')});
        const message = document.querySelector('#message-content-123') as HTMLElement;
        const body = document.querySelector('#body') as HTMLElement;
        const snapshot = () => createTranslationSourceSnapshot(
            message,
            core.shouldStayOriginal,
            undefined,
            undefined,
            core.shouldOmitFromTranslation,
        );
        const source = () => snapshot().slots.map((slot) => slot.source);
        expect(source()).toEqual(['Please review this edited message.']);
        for (const className of ['timestamp_c19a55', 'message-timestamp']) {
            const metadata = document.createElement('span');
            metadata.className = className;
            metadata.innerHTML = '<time><span>(edited)</span></time><span class="hiddenVisually_b18fe2">Tuesday, July 21, 2026 at 11:51 AM</span>';
            message.appendChild(metadata);
            expect(source()).toEqual(['Please review this edited message.']);
            expect(snapshot().clone.querySelector(`.${className}`)).toBeNull();
            expect(core.resolve(metadata)).toBeNull();
            expect(core.resolve(body)?.element).toBe(message);
            expect(core.discover(document).map((candidate) => candidate.element)).toContain(message);
            metadata.remove();
        }
        body.className = 'timestamp_c19a55';
        // 类名出现在正常正文后代时不能成为宽泛的全站排除。
        const outside = createTranslationCore({url: new URL('https://example.test/article')});
        expect(createTranslationSourceSnapshot(message, outside.shouldStayOriginal).slots.map((slot) => slot.source))
            .toEqual(['Please review this edited message.']);
    });
});
