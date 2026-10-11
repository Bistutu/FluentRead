/**
 * @file src/features/progressive-reading/session.ts
 * 文件职责：管理主动开启的渐进阅读会话、四档帮助及按需翻译的所有权。
 * 主要内容：新原文恢复原文档、按需读取收藏和复用精确双语结果、取消过期短语/整段请求；学习变更只刷新提示，关闭及宿主变化清空会话。
 * 模块边界：通过注入端口消费已有翻译客户端和学习库，不写配置、掌握状态或行为记录，也不扫描页面；DOM 快照校验由内容适配器提供。
 */
import type {VocabularyReadingHint} from '@/src/features/vocabulary/protocol';
import {readingLogicClues, readingPhraseHints, type LogicClue, type PhraseHint, type ReadingMode} from './hints';

export interface ReadingSource {text: string; selected: string; translation: string; valid(): boolean}
export interface ReadingState {
  open: boolean; mode: ReadingMode; source: string; selected: string; translation: string; translationOrigin: string;
  phrases: PhraseHint[]; clues: LogicClue[]; showKnown: boolean; loading: boolean; error: string; hintError: string;
  phraseTerm: string; phraseAnswer: string; phraseLoading: boolean;
}
export function createReadingState(): ReadingState {
  return {open: false, mode: 'original', source: '', selected: '', translation: '', translationOrigin: '', phrases: [], clues: [], showKnown: false,
    loading: false, error: '', hintError: '', phraseTerm: '', phraseAnswer: '', phraseLoading: false};
}
export interface ReadingPorts {
  hints(text: string): Promise<VocabularyReadingHint[]>;
  translate(text: string, context: string, signal: AbortSignal): Promise<string>;
}
export function createReadingSession(state: ReadingState, ports: ReadingPorts) {
  let source: ReadingSource | null = null;
  let generation = 0, hintsGeneration = 0, requestGeneration = 0;
  let request: AbortController | null = null;
  const cancel = () => {requestGeneration += 1; request?.abort(); request = null; state.loading = false; state.phraseLoading = false;};
  const current = (version: number) => state.open && generation === version && source !== null && source.valid();
  function close() {
    cancel(); generation += 1; hintsGeneration += 1; source = null;
    Object.assign(state, createReadingState());
  }
  function invalidate() {close(); state.open = true; state.error = '网页原文已变化，请重新选择正文。';}
  async function refreshHints() {
    if (!source || !state.open) return;
    const version = generation, read = ++hintsGeneration;
    state.hintError = '';
    try {
      const saved = await ports.hints(source.text);
      if (current(version) && read === hintsGeneration) state.phrases = readingPhraseHints(state.source, saved, state.selected);
    } catch {
      if (current(version) && read === hintsGeneration) {state.phrases = readingPhraseHints(state.source, [], state.selected); state.hintError = '收藏提示暂时无法读取；仍可查询表达和完整译文。';}
    }
  }
  function useSource(next: ReadingSource) {
    close(); state.open = true;
    if (!next.valid()) {state.error = '请选择当前网页中可读的正文。'; return;}
    source = next; state.source = next.text; state.selected = next.selected;
    state.translation = next.translation; state.translationOrigin = next.translation ? '已有网页译文' : '';
    state.phrases = readingPhraseHints(next.text, [], next.selected); state.clues = readingLogicClues(next.text);
    void refreshHints();
  }
  function open() {state.open = true; state.error = '';}
  async function assistance(mode: ReadingMode, phrase?: PhraseHint) {
    state.mode = mode;
    if (!source || !state.open) return;
    if (!source.valid()) {invalidate(); return;}
    cancel(); state.error = ''; state.phraseAnswer = ''; state.phraseTerm = '';
    if (mode !== 'bilingual' && !phrase) return;
    if (mode === 'bilingual' && state.translation) return;
    if (phrase && (!Number.isInteger(phrase.start) || !Number.isInteger(phrase.end) || phrase.start < 0
      || phrase.end <= phrase.start || phrase.end > state.source.length || state.source.slice(phrase.start, phrase.end) !== phrase.term)) return;
    const version = generation, run = requestGeneration, controller = new AbortController(); request = controller;
    if (phrase) {state.phraseTerm = phrase.term; state.phraseLoading = true;} else state.loading = true;
    try {
      const answer = await ports.translate(phrase ? phrase.term : source.text, source.text, controller.signal);
      if (current(version) && requestGeneration === run) {
        if (!answer.trim()) throw new Error('翻译服务未返回内容，请重试。');
        if (phrase) state.phraseAnswer = answer; else {state.translation = answer; state.translationOrigin = '当前翻译服务';}
      }
    } catch (error) {
      if (current(version) && requestGeneration === run) state.error = error instanceof Error ? error.message : '翻译暂时失败，请重试。';
    } finally {
      if (generation === version && requestGeneration === run) {request = null; state.loading = false; state.phraseLoading = false;}
    }
  }
  return {open, close, useSource, refreshHints, invalidate, assistance};
}
