'use strict';

// 只替换本次临时扩展 worker 的微软传输层；网页始终从真实站点加载。
// 用于稳定复现 DOM 生命周期，不提供供应商可用性、质量或时延证据。
async function installControlledProvider(context, createPage, timeout) {
  const install = worker => worker.evaluate(() => {
    if (globalThis.__frCompatibilityTransport) return;
    const originalFetch = globalThis.fetch;
    const state = {requests: 0, texts: 0, active: 0};
    globalThis.__frCompatibilityTransport = state;
    globalThis.fetch = async (input, init) => {
      const address = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      if (address.hostname !== 'edge.microsoft.com' || address.pathname !== '/translate/translatetext') {
        return originalFetch(input, init);
      }
      state.requests += 1;
      state.active += 1;
      try {
        const texts = JSON.parse(init?.body ?? await input.text());
        state.texts += texts.length;
        return new Response(JSON.stringify(texts.map(text => ({translations: [{text: `测试译文：${text}`}]}))),
          {status: 200, headers: {'content-type': 'application/json'}});
      } finally {state.active -= 1;}
    };
  });
  const errors = [];
  const workers = new Set();
  const onWorker = worker => {workers.add(worker); void install(worker).catch(error => errors.push(error.message));};
  context.on('serviceworker', onWorker);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout});
  workers.add(worker);
  await install(worker);
  const popup = await createPage(context, timeout);
  try {
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`, {waitUntil: 'domcontentloaded', timeout});
    const response = await popup.evaluate(async () => {
      const stored = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!stored.success) throw new Error(stored.error);
      const config = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
      const updates = {service: 'microsoft', from: 'en', to: 'zh-Hans', display: 1, autoTranslate: false,
        hotkey: 'Control', floatingBallHotkey: 'Alt+T', fullPageTranslationMode: 'viewport',
        useCache: false, enableAIContext: false, enableAIMultiSegment: false,
        uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true};
      return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: updates,
        expected: Object.fromEntries(Object.keys(updates).map(key => [key, config[key]])),
        clientId: 'web-compatibility-suite', sequence: 1, baseRevision: config.__fluentConfigRevision});
    });
    if (!response?.success) throw new Error(`Controlled-provider configuration failed: ${JSON.stringify(response)}`);
  } finally {await popup.close();}
  return {
    async snapshot() {
      if (errors.length) throw new Error(`Controlled transport worker failed: ${errors.join('; ')}`);
      const current = context.serviceWorkers()[0];
      if (!current || workers.size !== 1) throw new Error('Controlled transport worker changed or disappeared; response attribution is not proven');
      const state = await current.evaluate(() => globalThis.__frCompatibilityTransport);
      if (!state || !Number.isSafeInteger(state.requests) || state.requests < 1 || !Number.isSafeInteger(state.texts) || state.texts < 1 || state.active !== 0) {
        throw new Error('Controlled transport has no completed request evidence or remains active');
      }
      return {mode: 'controlled-microsoft-response', scope: 'real-site DOM compatibility only',
        workerCount: workers.size, ...state, errors};
    },
    dispose() {context.off('serviceworker', onWorker);},
  };
}

module.exports = {installControlledProvider};
