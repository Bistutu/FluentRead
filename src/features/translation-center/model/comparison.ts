/**
 * @file src/features/translation-center/model/comparison.ts
 * 文件职责：维护翻译中心每个服务独立的对比任务，隔离输入快照、取消和迟到响应。
 * 主要内容：同步服务顺序时保留结果，以任务身份保护并发重试，保留已完成项并仅停止未完成项；空译文作为失败处理，过期结果按原文、语言、模型和组合连接摘要快照判定。
 * 模块边界：本模块不读配置、不持久化原文、不操作 DOM，也不实现 provider 协议；响应式状态和翻译函数由界面注入。
 */
export const MAX_COMPARISON_TEXT_LENGTH = 5000;
export type ComparisonStatus = 'idle' | 'loading' | 'success' | 'error' | 'cancelled';
export type ComparisonInput = {text: string; sourceLanguage: string; targetLanguage: string; model: string; connectionFingerprint?: string};
export type ComparisonCard = {
  service: string; status: ComparisonStatus; result: string; error: string;
  duration: number; run: number; input: ComparisonInput | null;
};
export type ComparisonState = {cards: ComparisonCard[]; run: number};
export type ComparisonTranslator = (service: string, input: ComparisonInput, signal: AbortSignal) => Promise<string>;

export function isComparisonStale(card: ComparisonCard, input: ComparisonInput): boolean {
  return card.input !== null && (card.input.text !== input.text.trim()
    || card.input.sourceLanguage !== input.sourceLanguage
    || card.input.targetLanguage !== input.targetLanguage
    || card.input.model !== input.model
    || card.input.connectionFingerprint !== input.connectionFingerprint);
}

export function createComparisonSession(state: ComparisonState, translate: ComparisonTranslator, now = () => performance.now()) {
  const pending = new Map<string, AbortController>();
  let disposed = false;

  function stopService(service: string): void {
    const controller = pending.get(service);
    if (!controller) return;
    pending.delete(service);
    controller.abort();
    const card = state.cards.find(item => item.service === service);
    if (card) card.status = 'cancelled';
  }

  function stop(): void {
    [...pending.keys()].forEach(stopService);
  }

  function syncServices(services: string[]): void {
    const order = [...new Set(services)];
    [...pending.keys()].filter(service => !order.includes(service)).forEach(stopService);
    const previous = new Map(state.cards.map(card => [card.service, card]));
    state.cards = order.map(service => previous.get(service) || {
      service, status: 'idle', result: '', error: '', duration: 0, run: 0, input: null,
    });
  }

  async function run(services: string[], getInput: (service: string) => ComparisonInput): Promise<void> {
    if (disposed) return;
    const tasks = [...new Set(services)].flatMap(service => {
      const card = state.cards.find(item => item.service === service);
      if (!card || pending.has(service)) return [];
      const input = {...getInput(service)};
      input.text = input.text.trim();
      if (!input.text || input.text.length > MAX_COMPARISON_TEXT_LENGTH
        || input.sourceLanguage === input.targetLanguage) return [];
      return [{card, input}];
    });
    if (!tasks.length) return;
    const run = ++state.run;
    await Promise.all(tasks.map(async ({card, input}) => {
      const controller = new AbortController();
      pending.set(card.service, controller);
      const started = now();
      Object.assign(card, {status: 'loading', result: '', error: '', run, input});
      try {
        const result = (await translate(card.service, input, controller.signal)).trim();
        if (pending.get(card.service) !== controller) return;
        if (!result) throw new Error('empty-result');
        card.result = result;
        card.status = 'success';
      } catch (error) {
        if (pending.get(card.service) !== controller) return;
        if (error instanceof Error && error.name === 'AbortError') {
          card.status = 'cancelled';
        } else {
          card.status = 'error';
          card.error = error instanceof Error ? error.message : String(error);
        }
      } finally {
        if (pending.get(card.service) === controller) {
          pending.delete(card.service);
          card.duration = Math.max(1, Math.round(now() - started));
        }
      }
    }));
  }

  return {syncServices, run, stop, stopService, dispose() {disposed = true; stop();}};
}
