import {afterEach, describe, expect, it, vi} from 'vitest';
import {setMainWorldBridgesEnabled} from '@/src/app/content/mainWorldBridgeLifecycle';
import {
    SHADOW_BRIDGE_DISPOSE_EVENT,
    SHADOW_BRIDGE_ENABLE_EVENT,
} from '@/src/platform/shadow-ui/pageBridgeCore';
import {
    YOUTUBE_BRIDGE_DISPOSE_EVENT,
    YOUTUBE_BRIDGE_ENABLE_EVENT,
} from '@/src/features/video-subtitle/content/youtubeTimedTextBridgeCore';
import {installYoutubeTimedTextBridge} from '@/src/features/video-subtitle/content/youtubeTimedTextBridge';

afterEach(() => vi.unstubAllGlobals());

describe('MAIN world bridge lifecycle publisher', () => {
    it('publishes both enable and disable protocols in stable order', () => {
        const events: string[] = [];
        const target = {dispatchEvent: (event: Event) => events.push(event.type)};

        setMainWorldBridgesEnabled(target, false);
        setMainWorldBridgesEnabled(target, true);

        expect(events).toEqual([
            SHADOW_BRIDGE_DISPOSE_EVENT,
            YOUTUBE_BRIDGE_DISPOSE_EVENT,
            SHADOW_BRIDGE_ENABLE_EVENT,
            YOUTUBE_BRIDGE_ENABLE_EVENT,
        ]);
    });
    it('binds the real page adapter to Fetch, XHR and enable/disable lifecycle without consuming host responses', async () => {
        const response = new Response('<timedtext>host caption</timedtext>');
        const fetch = vi.fn(async (_input?: string) => response), postMessage = vi.fn(), open = vi.fn();
        const page = Object.assign(new EventTarget(), {fetch, postMessage});
        const dom = new EventTarget();
        class PageXhr extends EventTarget {
            responseText = '<timedtext>xhr caption</timedtext>';
            open(method: string, url: string) {open(method, url);}
            send() {this.dispatchEvent(new Event('load'));}
        }
        const originalOpen = PageXhr.prototype.open, originalSend = PageXhr.prototype.send;
        vi.stubGlobal('window', page); vi.stubGlobal('document', dom); vi.stubGlobal('XMLHttpRequest', PageXhr);
        vi.stubGlobal('location', {href: 'https://www.youtube.com/watch?v=fixture', origin: 'https://www.youtube.com'});
        const dispose = installYoutubeTimedTextBridge();
        try {
            expect(await page.fetch('/api/timedtext?lang=en')).toBe(response);
            await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({responseText: '<timedtext>host caption</timedtext>'}), 'https://www.youtube.com'));
            expect(response.bodyUsed).toBe(false);
            const request = new PageXhr() as unknown as XMLHttpRequest;
            request.open('GET', '/api/timedtext?lang=ja'); request.send();
            expect(open).toHaveBeenCalledWith('GET', '/api/timedtext?lang=ja');
            expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({responseText: '<timedtext>xhr caption</timedtext>'}), 'https://www.youtube.com');
            dom.dispatchEvent(new Event(YOUTUBE_BRIDGE_DISPOSE_EVENT)); expect(page.fetch).toBe(fetch); expect(PageXhr.prototype.open).toBe(originalOpen);
            dom.dispatchEvent(new Event(YOUTUBE_BRIDGE_ENABLE_EVENT)); expect(page.fetch).not.toBe(fetch);
        } finally {dispose();}
        expect(page.fetch).toBe(fetch); expect(PageXhr.prototype.open).toBe(originalOpen); expect(PageXhr.prototype.send).toBe(originalSend);
    });
});
