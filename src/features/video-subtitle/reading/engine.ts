/**
 * @file src/features/video-subtitle/reading/engine.ts
 * 文件职责：按原文语言选择本地视频读音标注引擎。
 * 主要内容：日语词典读音、中文声调、韩语修订罗马字、印地语固有元音脱落与泰语 RTGS 音节解析；俄希阿明确采用文字转写，不虚构未写出的元音或重音。各依赖仅在使用对应语言时加载。
 * 模块边界：只在专用 Worker 内执行纯文本转换，不读取网页、不生成 HTML、不请求远程翻译；词典 URL 由扩展 Worker 自身决定。
 */
import {getReadingAnnotationLanguage, READING_ANNOTATION_SCHEMES} from '@/src/core/readingAnnotation';
import type {VideoReadingAnnotation} from '@/src/core/messaging/readingAnnotation';

let chineseEngine: Promise<typeof import('pinyin-pro')> | undefined;
function loadChineseEngine(): Promise<typeof import('pinyin-pro')> {
  // traditional:true 需要显式安装繁简映射；只加载轻量映射，复用已有词组消歧词典。
  chineseEngine ??= Promise.all([import('pinyin-pro'), import('@pinyin-pro/data/traditional')]).then(([engine, mapping]) => {
    engine.addTraditionalDict(mapping.default);
    return engine;
  }).catch(error => {
    chineseEngine = undefined;
    throw error;
  });
  return chineseEngine;
}

export async function annotateReading(text: string, language: string, dictionaryUrl: string): Promise<VideoReadingAnnotation | null> {
  const resolved = getReadingAnnotationLanguage(text, language);
  if (!resolved) return null;
  let reading: string;
  if (resolved === 'ja') reading = await (await import('./japanese')).romanizeJapanese(text, dictionaryUrl);
  else if (resolved === 'zh') {
    const {pinyin} = await loadChineseEngine();
    reading = pinyin(text, {toneType:'symbol', nonZh:'consecutive', type:'array', traditional:true}).join(' ');
  } else if (resolved === 'ko') {
    const {romanize} = await import('koroman');
    // 只转换韩文段，保留英语缩写及人名中现有 Latin 大小写。
    reading = text.replace(/[\p{Script=Hangul}]+/gu, run => romanize(run.normalize('NFC'), {usePronunciationRules:true, casingOption:'lowercase'}));
  } else if (resolved === 'hi') {
    const {romanizeHindi} = await import('./hindi');
    reading = await romanizeHindi(text);
  } else if (resolved === 'th') {
    reading = (await import('./thai')).romanizeThai(text);
  } else reading = (await import('./writtenTransliteration')).transliterateWritten(text, resolved);
  reading = reading.replace(/\s+([,.;!?，。！？、])/gu, '$1').replace(/[\s\u3000]+/gu, ' ').trim();
  return reading && reading !== text.trim() ? {text:reading, language:resolved, scheme:READING_ANNOTATION_SCHEMES[resolved]} : null;
}
