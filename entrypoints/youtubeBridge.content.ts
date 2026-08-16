const TIMED_TEXT_MESSAGE = 'fluent-read-youtube-timedtext';
const BRIDGE_FLAG = '__fluentReadYoutubeTimedTextBridgeInstalled__';

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isYoutubeTimedTextUrl(value: string): boolean {
  try {
    const url = new URL(value, window.location.href);
    return url.hostname.endsWith('youtube.com') && url.pathname.includes('/api/timedtext');
  } catch {
    return false;
  }
}

function publishTimedText(url: string, responseText: string): void {
  if (!responseText || !isYoutubeTimedTextUrl(url)) return;
  window.postMessage({
    source: 'fluent-read',
    type: TIMED_TEXT_MESSAGE,
    url,
    responseText,
  }, window.location.origin);
}

export default defineContentScript({
  matches: ['*://*.youtube.com/watch*', '*://*.youtube.com/shorts*', '*://youtube.com/watch*', '*://youtube.com/shorts*'],
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
      if (isYoutubeTimedTextUrl(url)) {
        void response.clone().text().then((responseText) => publishTimedText(url, responseText)).catch(() => undefined);
      }
      return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const requestUrls = new WeakMap<XMLHttpRequest, string>();
    XMLHttpRequest.prototype.open = function open(method: string, url: string | URL, ...rest: any[]) {
      const requestUrl = String(url);
      if (isYoutubeTimedTextUrl(requestUrl)) requestUrls.set(this, requestUrl);
      return Reflect.apply(originalOpen, this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.send = function send(body?: Document | XMLHttpRequestBodyInit | null) {
      const requestUrl = requestUrls.get(this);
      if (requestUrl) {
        this.addEventListener('load', () => {
          try {
            if (typeof this.responseText === 'string') publishTimedText(requestUrl, this.responseText);
          } catch {
            // 非文本 responseType 不能读取 responseText，忽略即可。
          }
        }, { once: true });
      }
      return originalSend.call(this, body);
    };
  },
});
