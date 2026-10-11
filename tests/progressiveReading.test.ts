/**
 * @file tests/progressiveReading.test.ts
 * 文件职责：验证渐进阅读的纯提示边界和按需翻译会话，证明帮助强度与主动学习状态不会产生隐式请求或掌握推断。
 * 主要内容：覆盖多词表达、Unicode 词界、同语境明确掌握、选词预算、四档自由切换、已有译文复用、短语坐标、取消及迟到回复、宿主失效、收藏刷新和可重试失败。
 * 模块边界：仅替换翻译和学习库端口，不模拟 DOM、Vue 或供应商质量；实际网页交互由独立隔离浏览器验证。
 */
import {describe, expect, it, vi} from 'vitest';
import type {VocabularyReadingHint} from '@/src/features/vocabulary/protocol';
import {normalizeReadingText, readingLogicClues, readingPhraseHints, type PhraseHint, type ReadingMode} from '@/src/features/progressive-reading/hints';
import {createReadingSession, createReadingState, type ReadingSource} from '@/src/features/progressive-reading/session';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
async function settle() {for (let i = 0; i < 5; i += 1) await Promise.resolve();}
function saved(text: string, term: string, patch: Partial<VocabularyReadingHint> = {}): VocabularyReadingHint {
  const start = text.indexOf(term);
  return {id: 'saved', term, sourceLanguage: 'en', reference: '收藏释义', start, end: start + term.length,
    explicitMastered: false, sameContext: false, ...patch};
}
function setup(text = 'We may rule out this option only if the evidence is sound.', selected = 'rule out', translation = '') {
  const state = createReadingState();
  const hints = vi.fn(async (_text: string): Promise<VocabularyReadingHint[]> => []);
  const translate = vi.fn(async (_text: string, _context: string, _signal: AbortSignal): Promise<string> => '当前服务译文');
  let valid = true;
  const source: ReadingSource = {text, selected, translation, valid: () => valid};
  const session = createReadingSession(state, {hints, translate});
  return {state, hints, translate, source, session, setValid: (value: boolean) => {valid = value;}};
}

describe('渐进阅读的短语与词面逻辑线索', () => {
  it('只归一化读取副本的空白与 NFC，保留原文内容', () => {
    expect(normalizeReadingText('  cafe\u0301\n\tmay  not\u00a0work  ')).toBe('café may not work');
    expect(normalizeReadingText('')).toBe('');
  });
  it('多词表达可跨空白并保留真实原文坐标和大小写', () => {
    const expressions = ['take into account', 'rule out', 'in spite of', 'as long as', 'by and large', 'in terms of', 'give rise to', 'carry out', 'rather than'];
    const text = `Take\tinto\naccount; ${expressions.slice(1).join('; ')}.`;
    const hints = readingPhraseHints(text, []);
    expect(hints).toHaveLength(9);
    expect(hints[0]).toMatchObject({term: 'Take\tinto\naccount', start: 0, hidden: false, saved: false});
    expect(hints.map(hint => hint.term.toLowerCase().replace(/\s+/gu, ' '))).toEqual(expressions);
    for (const hint of hints) {expect(text.slice(hint.start, hint.end)).toBe(hint.term); expect(hint.reference).not.toBe('');}
  });
  it('完整词界不会从字母、数字、下划线或其他语言单词中截取表达', () => {
    const text = 'prerule out; rule outer; rule outé; érule out; rule out2; rule out_; _rule out; rule out\u0301; (rule out).';
    const hints = readingPhraseHints(text, []);
    expect(hints).toHaveLength(1);
    expect(hints[0].start).toBe(text.lastIndexOf('rule out'));
  });
  it('收藏覆盖同坐标本地释义，只有同语境的明确掌握才收起', () => {
    const text = 'rule out this route';
    for (const explicitMastered of [false, true]) for (const sameContext of [false, true]) {
      const hints = readingPhraseHints(text, [saved(text, 'rule out', {explicitMastered, sameContext})], 'rule out');
      expect(hints).toEqual([{term: 'rule out', reference: '收藏释义', start: 0, end: 8, saved: true, hidden: explicitMastered && sameContext}]);
    }
  });
  it('收藏规范词条与原文大小写不同仍使用真实词面，并可查询当前用法', async () => {
    const {session, source, state, hints, translate} = setup('We may Rule OUT this route.', 'Rule OUT');
    hints.mockResolvedValueOnce([saved(source.text, 'Rule OUT', {term: 'rule out'})]); session.useSource(source); await settle();
    expect(state.phrases).toEqual([{term: 'Rule OUT', reference: '收藏释义', start: 7, end: 15, hidden: false, saved: true}]);
    await session.assistance('phrases', state.phrases[0]);
    expect(translate).toHaveBeenCalledWith('Rule OUT', source.text, expect.any(AbortSignal)); expect(state.phraseAnswer).toBe('当前服务译文');
  });
  it('熟词的陌生用法仍可由主动选词请求帮助，无收藏或本地词典也有入口', () => {
    const text = 'The bank of the river was steep.';
    const hint = readingPhraseHints(text, [saved(text, 'bank', {explicitMastered: true, sameContext: false})], 'bank')[0];
    expect(hint).toMatchObject({term: 'bank', hidden: false, saved: true});
    expect(readingPhraseHints(text, [], ' bank ')).toEqual([{term: 'bank', reference: '', start: 4, end: 8, hidden: false, saved: false}]);
    expect(readingPhraseHints(text, [], 'unknown')).toEqual([]);
    expect(readingPhraseHints('a'.repeat(161), [], 'a'.repeat(161))).toEqual([]);
  });
  it('整段完整句子不重复成为短语，独立词语和多词表达仍有查询入口', () => {
    const sentence = 'We may rule out this option only if the evidence is sound.';
    expect(readingPhraseHints(sentence, [], sentence).map(hint => hint.term)).toEqual(['rule out']);
    expect(readingPhraseHints('The bank of the river was steep.”', [], 'The bank of the river was steep.”')).toEqual([]);
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen';
    expect(readingPhraseHints(long, [], long)).toEqual([]);
    for (const expression of ['bank', 'at the river bank', 'take into account']) {
      expect(readingPhraseHints(expression, [], expression).map(hint => hint.term)).toEqual([expression]);
    }
    expect(readingPhraseHints('Read the next clause. Then stop.', [], 'the next clause.')).toEqual([
      {term: 'the next clause.', reference: '', start: 5, end: 21, hidden: false, saved: false},
    ]);
  });
  it('相同起点优先较长表达，自动提示至多24项且不会挤掉后文主动选词', () => {
    const text = `${'rule out; '.repeat(30)}bank`;
    const hints = readingPhraseHints(text, [], 'bank');
    expect(hints).toHaveLength(24); expect(hints.at(-1)?.term).toBe('bank');
    expect(hints.map(hint => hint.start)).toEqual([...hints.map(hint => hint.start)].sort((a, b) => a - b));
    expect(readingPhraseHints(text, [])).toHaveLength(24);
    expect(readingPhraseHints('take into account', [saved('take into account', 'take')], 'take into account').map(hint => hint.term)).toEqual(['take into account', 'take']);
  });
  it('逻辑提示引用原文否定、可能性、条件及范围，保留重叠词面的不同含义', () => {
    const text = 'We may not act unless all agree; only if evidence holds. 可能不能实行，除非所有人同意。';
    const clues = readingLogicClues(text);
    expect(new Set(clues.map(clue => clue.label))).toEqual(new Set(['否定 / 例外', '可能性', '条件', '适用范围']));
    expect(clues.filter(clue => clue.term === 'unless').map(clue => clue.label)).toEqual(['否定 / 例外', '条件']);
    expect(clues.some(clue => clue.term === 'only if' && clue.label === '条件')).toBe(true);
    for (const clue of clues) {expect(text.slice(clue.start, clue.end)).toBe(clue.term); expect(clue.detail).not.toBe('');}
    expect(clues.map(clue => clue.start)).toEqual([...clues.map(clue => clue.start)].sort((a, b) => a - b));
  });
  it('没有词面线索时返回空；密集原文最多32项且每次匹配从头开始', () => {
    expect(readingLogicClues('The river bank is steep.')).toEqual([]);
    expect(readingLogicClues('noté émight if2 only_ not\u0301')).toEqual([]);
    const text = 'may not if only '.repeat(50);
    const first = readingLogicClues(text);
    expect(first).toHaveLength(32); expect(readingLogicClues(text)).toEqual(first);
  });
});

describe('渐进阅读会话及按需翻译所有权', () => {
  it('开启空面板不读取或翻译；关闭后释放所有状态并可重新开启', async () => {
    const {state, session, hints, translate} = setup();
    expect(state).toEqual(createReadingState()); session.open();
    expect(state.open).toBe(true); await session.refreshHints(); await session.assistance('bilingual');
    expect(hints).not.toHaveBeenCalled(); expect(translate).not.toHaveBeenCalled();
    state.showKnown = true; state.error = 'old error'; session.close(); expect(state).toEqual(createReadingState());
    await session.assistance('original'); expect(translate).not.toHaveBeenCalled();
    session.open(); expect(state.error).toBe(''); expect(state.open).toBe(true);
  });
  it('失效源不能进入会话或读取收藏；已有原文关闭时也不刷新', async () => {
    const {state, session, source, hints, setValid} = setup(); setValid(false); session.useSource(source);
    expect(state).toMatchObject({open: true, source: '', error: '请选择当前网页中可读的正文。'});
    expect(hints).not.toHaveBeenCalled(); setValid(true); session.useSource(source); await settle();
    hints.mockClear(); state.open = false; await session.refreshHints(); await session.assistance('bilingual'); expect(hints).not.toHaveBeenCalled();
  });
  it('每次换原文回到原文档，提示读取不触发翻译或改变掌握状态', async () => {
    const {state, session, source, hints, translate} = setup(); session.useSource(source); await settle();
    expect(hints).toHaveBeenCalledWith(source.text); expect(translate).not.toHaveBeenCalled();
    expect(state).toMatchObject({open: true, mode: 'original', source: source.text, selected: source.selected, showKnown: false});
    state.showKnown = true; state.mode = 'logic'; session.useSource({...source, text: 'New paragraph.', selected: 'paragraph'}); await settle();
    expect(state).toMatchObject({mode: 'original', source: 'New paragraph.', showKnown: false, translation: '', translationOrigin: ''});
  });
  it('四档任意切换无需逐级完成；原文可直接进入双语且重复查看复用结果', async () => {
    const {state, session, source, translate} = setup(); session.useSource(source); await settle();
    await session.assistance('bilingual'); expect(translate).toHaveBeenCalledWith(source.text, source.text, expect.any(AbortSignal));
    expect(state).toMatchObject({mode: 'bilingual', translation: '当前服务译文', translationOrigin: '当前翻译服务', loading: false});
    for (const mode of ['original', 'logic', 'phrases', 'bilingual'] as ReadingMode[]) {await session.assistance(mode); expect(state.mode).toBe(mode);}
    expect(translate).toHaveBeenCalledOnce();
  });
  it('精确已有网页译文无需请求，仍可按需查询熟悉表达的当前用法', async () => {
    const {state, session, source, translate, hints} = setup(undefined, undefined, '已有完整译文');
    hints.mockResolvedValue([saved(source.text, 'rule out', {explicitMastered: true, sameContext: true})]); session.useSource(source); await settle();
    await session.assistance('bilingual'); expect(translate).not.toHaveBeenCalled();
    expect(state.translationOrigin).toBe('已有网页译文'); expect(state.phrases[0].hidden).toBe(true);
    state.showKnown = true; await session.assistance('phrases', state.phrases[0]);
    expect(translate).toHaveBeenCalledWith('rule out', source.text, expect.any(AbortSignal));
    expect(state).toMatchObject({mode: 'phrases', phraseTerm: 'rule out', phraseAnswer: '当前服务译文', phraseLoading: false, translation: '已有完整译文'});
  });
  it.each([
    {start: -1}, {start: NaN}, {end: NaN}, {start: 1.5}, {end: 2.5}, {start: 8, end: 8, term: ''},
    {start: 8, end: 7}, {end: 9000}, {term: 'changed'},
  ])('无效短语坐标 %j 不请求服务', async patch => {
    const {session, source, state, translate} = setup(); session.useSource(source); await settle();
    const phrase = {...state.phrases[0], ...patch} as PhraseHint; await session.assistance('phrases', phrase);
    expect(translate).not.toHaveBeenCalled(); expect(state.phraseLoading).toBe(false);
  });
  it('模式切回本地帮助会取消当前请求并拒绝迟到的双语答案', async () => {
    const {session, state, source, translate} = setup(), answer = deferred<string>(); translate.mockReturnValueOnce(answer.promise);
    session.useSource(source); await settle(); const pending = session.assistance('bilingual');
    const signal = translate.mock.calls[0][2]; expect(state.loading).toBe(true);
    await session.assistance('logic'); expect(signal.aborted).toBe(true); expect(state.loading).toBe(false);
    answer.resolve('迟到译文'); await pending; expect(state).toMatchObject({mode: 'logic', translation: '', error: ''});
  });
  it('短语被新的整段请求替代时取消旧请求；旧完成不能释放新请求的加载状态', async () => {
    const {session, state, source, translate} = setup(), phrase = deferred<string>(), full = deferred<string>();
    translate.mockReturnValueOnce(phrase.promise).mockReturnValueOnce(full.promise); session.useSource(source); await settle();
    const old = session.assistance('phrases', state.phrases[0]); expect(state.phraseLoading).toBe(true);
    const fresh = session.assistance('bilingual'); expect(translate.mock.calls[0][2].aborted).toBe(true);
    phrase.resolve('旧短语答案'); await old; expect(state).toMatchObject({loading: true, phraseLoading: false, phraseAnswer: '', phraseTerm: ''});
    full.resolve('新整段译文'); await fresh; expect(state).toMatchObject({loading: false, translation: '新整段译文'});
  });
  it('关闭取消所有请求，重新选原文后旧回答不能污染新会话', async () => {
    const {session, state, source, translate} = setup(), oldAnswer = deferred<string>(); translate.mockReturnValueOnce(oldAnswer.promise);
    session.useSource(source); await settle(); const old = session.assistance('bilingual'); session.close();
    expect(translate.mock.calls[0][2].aborted).toBe(true); expect(state).toEqual(createReadingState());
    session.useSource({...source, text: 'A new source.', selected: 'new', translation: '新段已有译文'});
    oldAnswer.resolve('旧段译文'); await old; expect(state).toMatchObject({source: 'A new source.', translation: '新段已有译文', mode: 'original'});
  });
  it('宿主在请求期间失效时不提交响应，显式失效清空旧结果并等待重新选文', async () => {
    const {session, state, source, translate, setValid} = setup(), answer = deferred<string>(); translate.mockReturnValueOnce(answer.promise);
    session.useSource(source); await settle(); const pending = session.assistance('bilingual'); setValid(false);
    answer.resolve('过期回答'); await pending; expect(state.translation).toBe(''); expect(state.loading).toBe(false);
    await session.assistance('phrases'); expect(state).toMatchObject({open: true, mode: 'original', source: '', phrases: [], error: '网页原文已变化，请重新选择正文。'});
    session.open(); expect(state.error).toBe(''); await session.refreshHints();
  });
  it('最新收藏刷新胜出，明确掌握变化只更新提示且保留当前译文与帮助档', async () => {
    const {session, state, source, hints, translate} = setup(); session.useSource(source); await settle(); await session.assistance('bilingual');
    const old = deferred<VocabularyReadingHint[]>(), fresh = deferred<VocabularyReadingHint[]>(); hints.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const first = session.refreshHints(), second = session.refreshHints(); fresh.resolve([saved(source.text, 'rule out', {explicitMastered: true, sameContext: true})]); await second;
    expect(state.phrases[0].hidden).toBe(true); old.resolve([saved(source.text, 'rule out')]); await first; expect(state.phrases[0].hidden).toBe(true);
    hints.mockResolvedValueOnce([saved(source.text, 'rule out', {explicitMastered: true, sameContext: false})]); await session.refreshHints();
    expect(state.phrases[0].hidden).toBe(false); expect(state).toMatchObject({mode: 'bilingual', translation: '当前服务译文'}); expect(translate).toHaveBeenCalledOnce();
  });
  it('收藏读取失败保留本地提示和完整译文入口，成功刷新清除提醒', async () => {
    const {session, state, source, hints, translate} = setup(); hints.mockRejectedValueOnce(Error('storage')); session.useSource(source); await settle();
    expect(state.phrases.some(hint => hint.term === 'rule out')).toBe(true); expect(state.hintError).toContain('仍可查询表达和完整译文');
    await session.assistance('bilingual'); expect(translate).toHaveBeenCalledOnce(); await session.refreshHints(); expect(state.hintError).toBe('');
  });
  it('过期收藏成功或失败不能覆盖新会话；同一源的旧失败不能抹掉新收藏', async () => {
    for (const rejected of [false, true]) {
      const {session, state, source, hints} = setup(), old = deferred<VocabularyReadingHint[]>(); hints.mockReturnValueOnce(old.promise); session.useSource(source);
      session.useSource({...source, text: 'New bank usage.', selected: 'bank'}); await settle();
      if (rejected) old.reject(Error('old storage')); else old.resolve([saved(source.text, 'rule out')]); await settle();
      expect(state).toMatchObject({source: 'New bank usage.', hintError: ''}); expect(state.phrases.map(hint => hint.term)).toEqual(['bank']);
    }
    const {session, state, source, hints} = setup(), old = deferred<VocabularyReadingHint[]>(); hints.mockReturnValueOnce(old.promise); session.useSource(source);
    hints.mockResolvedValueOnce([saved(source.text, 'rule out', {reference: '新参考'})]); await session.refreshHints(); old.reject(Error('old read')); await settle();
    expect(state.hintError).toBe(''); expect(state.phrases[0].reference).toBe('新参考');
  });
  it('宿主失效后的收藏结果不展示，关闭后的收藏结果不重新开启', async () => {
    for (const closed of [false, true]) {
      const {session, state, source, hints, setValid} = setup(), pending = deferred<VocabularyReadingHint[]>(); hints.mockReturnValueOnce(pending.promise); session.useSource(source);
      if (closed) session.close(); else setValid(false); pending.resolve([saved(source.text, 'rule out', {reference: '迟到收藏'})]); await settle();
      expect(state.phrases.some(hint => hint.reference === '迟到收藏')).toBe(false); expect(state.open).toBe(!closed);
    }
  });
  it.each([new Error('服务故障'), 'provider unavailable', ''])('翻译失败 %j 释放状态并可重试', async failure => {
    const {session, state, source, translate} = setup(); session.useSource(source); await settle();
    if (failure === '') translate.mockResolvedValueOnce('   '); else translate.mockRejectedValueOnce(failure);
    await session.assistance('bilingual'); expect(state.loading).toBe(false); expect(state.translation).toBe('');
    expect(state.error).toBe(failure instanceof Error ? '服务故障' : failure === '' ? '翻译服务未返回内容，请重试。' : '翻译暂时失败，请重试。');
    await session.assistance('bilingual'); expect(state).toMatchObject({error: '', translation: '当前服务译文', loading: false});
  });
  it('被取消或宿主失效后的请求失败不留下新错误或覆盖新请求', async () => {
    for (const invalid of [false, true]) {
      const {session, state, source, translate, setValid} = setup(), pending = deferred<string>(); translate.mockReturnValueOnce(pending.promise);
      session.useSource(source); await settle(); const request = session.assistance('bilingual');
      if (invalid) setValid(false); else await session.assistance('original'); pending.reject(Error('stale failure')); await request;
      expect(state.error).toBe(''); expect(state.loading).toBe(false); expect(state.translation).toBe('');
    }
  });
});
