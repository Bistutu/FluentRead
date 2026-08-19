import { isXSubtitleResourceUrl } from './main/xVideoSubtitleData';

const X_SUBTITLE_RESOURCE_MESSAGE = 'fluent-read-x-video-subtitle-resource';
const BRIDGE_FLAG = '__fluentReadXVideoSubtitleBridgeInstalled__';

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isPotentialSubtitleResponse(url: string, responseText: string): boolean {
  return isXSubtitleResourceUrl(url)
    && (/WEBVTT/i.test(responseText) || /#EXT-X-MEDIA:[^\n]*TYPE=SUBTITLES/i.test(responseText));
}

function publishResource(url: string, responseText: string): void {
  if (!isPotentialSubtitleResponse(url, responseText)) return;
  window.postMessage({
    source: 'fluent-read',
    type: X_SUBTITLE_RESOURCE_MESSAGE,
    url,
    responseText,
  }, window.location.origin);
}

export default defineContentScript({
  matches: [
    '*://*.x.com/*',
    '*://x.com/*',
    '*://*.twitter.com/*',
    '*://twitter.com/*',
  ],
  runAt: 'document_start',
  world: 'MAIN',
  globalName: false,
  main() {
    const pageWindow = window as typeof window & { [BRIDGE_FLAG]?: boolean };
    if (pageWindow[BRIDGE_FLAG]) return;
    pageWindow[BRIDGE_FLAG] = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = getRequestUrl(input);
      const response = await originalFetch(input, init);
      if (isXSubtitleResourceUrl(url)) {
        void response.clone().text().then((responseText) => publishResource(url, responseText)).catch(() => undefined);
      }
      return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const requestUrls = new WeakMap<XMLHttpRequest, string>();
    XMLHttpRequest.prototype.open = function open(method: string, url: string | URL, ...rest: any[]) {
      const requestUrl = String(url);
      if (isXSubtitleResourceUrl(requestUrl)) requestUrls.set(this, requestUrl);
      return Reflect.apply(originalOpen, this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.send = function send(body?: Document | XMLHttpRequestBodyInit | null) {
      const requestUrl = requestUrls.get(this);
      if (requestUrl) {
        this.addEventListener('load', () => {
          try {
            if (typeof this.responseText === 'string') publishResource(requestUrl, this.responseText);
          } catch {
            // 非文本 responseType 不能读取 responseText，忽略即可。
          }
        }, { once: true });
      }
      return originalSend.call(this, body);
    };
  },
});
