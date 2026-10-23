/**
 * @file src/features/video-subtitle/reading/hindi.ts
 * 文件职责：在专用读音 Worker 内按需准备印地语数据并复用静态 TypeScript 读音引擎。
 * 主要内容：共享可重试初始化、输入边界与 NFC 规范化，保留原有词典和双候选排序行为；纯数据首次下载后离线缓存。
 * 模块边界：固定资源来源由 hindiAssets 决定，旧 WASM 参数仅供调用兼容且不会用于下载；不执行远程代码。
 */
import {loadHindiReadingEngine} from './hindiAssets';

type HindiTransliterator = (text: string, options: {lexicon: boolean; rerank: boolean}) => string;

export function createHindiRomanizer(load: (legacyUrl?: string) => Promise<HindiTransliterator> = loadHindiReadingEngine): (text: string, legacyWasmUrl?: string) => Promise<string> {
  let initialization: Promise<HindiTransliterator> | undefined;
  return async (text, _legacyWasmUrl) => {
    if (text.length > 3000) throw new Error('Hindi reading text exceeds 3000 characters');
    const normalized = text.normalize('NFC');
    if (!/\p{Script=Devanagari}/u.test(normalized)) return normalized;
    initialization ??= load();
    const current = initialization;
    try {return (await current)(normalized, {lexicon:true, rerank:true});}
    catch (error) {if (initialization === current) initialization = undefined; throw error;}
  };
}

export const romanizeHindi = createHindiRomanizer();
