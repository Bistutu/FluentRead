/**
 * @file src/core/readingAnnotation.ts
 * 文件职责：识别视频原文可用的读音标注语言与稳定转写方案。
 * 主要内容：规范化字幕轨语言，区分普通话与粤语、日语与纯汉字歧义，拒绝英语音标及未知语言误转写；提供轻量脚本判断与首次词典下载的有界等待预算，供内容、后台及离屏端共用。
 * 模块边界：仅纯字符串与元数据，不加载词典、浏览器、配置或任何转写依赖。
 */
export type ReadingAnnotationLanguage = 'ja' | 'ko' | 'zh' | 'ru' | 'el' | 'ar' | 'hi' | 'th';
// 数据下载最多两分钟；额外时间用于校验、缓存和初始化，外层再为离屏准备与回包留出余量。
export const READING_ANNOTATION_WORKER_TIMEOUT_MS = 180_000;
export const READING_ANNOTATION_REQUEST_TIMEOUT_MS = READING_ANNOTATION_WORKER_TIMEOUT_MS + 10_000;
export const READING_ANNOTATION_SCHEMES: Record<ReadingAnnotationLanguage, string> = {
  ja: 'hepburn-ipadic-v1', ko: 'revised-romanization-v1', zh: 'hanyu-pinyin-tone-v1',
  ru: 'scientific-cyrillic-v1', el: 'modern-greek-romanization-v1', ar: 'arabic-written-transliteration-v1',
  hi: 'hindi-phonetic-latin-v1', th: 'thai-rtgs-v1',
};
const scripts: Record<ReadingAnnotationLanguage, RegExp> = {
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  ko: /[\p{Script=Hangul}]/u, zh: /\p{Script=Han}/u,
  ru: /[А-Яа-яЁё]/u, el: /\p{Script=Greek}/u,
  ar: /\p{Script=Arabic}/u, hi: /\p{Script=Devanagari}/u, th: /\p{Script=Thai}/u,
};
const aliases: Record<string, ReadingAnnotationLanguage> = {ja:'ja',jpn:'ja',ko:'ko',kor:'ko',zh:'zh',cmn:'zh',zho:'zh',ru:'ru',rus:'ru',el:'el',ell:'el',gre:'el',ar:'ar',ara:'ar',hi:'hi',hin:'hi',th:'th',tha:'th'};
export function getReadingAnnotationLanguage(text: string, sourceLanguage: string): ReadingAnnotationLanguage | null {
  if (!text.trim() || text.length > 3_000) return null;
  const tag = sourceLanguage.trim().toLowerCase().replace(/_/g, '-');
  // 同是汉字也不能把粤语/闽南语标成普通话，明确 Latin 轨道同样不需要反向转写。
  if (/(?:^|-)(?:yue|nan|hak|wuu|latn)(?:-|$)/u.test(tag)) return null;
  const primary = tag.split('-')[0];
  const language = Object.hasOwn(aliases, primary) ? aliases[primary] : undefined;
  if (language) return scripts[language].test(text) ? language : null;
  if (tag && !['auto','und','unknown','original'].includes(tag)) return null;
  // 假名和现代韩文足以选择对应引擎；纯汉字及共用文字的语言不猜测。
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return 'ja';
  if (scripts.ko.test(text)) return 'ko';
  if (scripts.el.test(text)) return 'el';
  if (scripts.th.test(text)) return 'th';
  return null;
}
