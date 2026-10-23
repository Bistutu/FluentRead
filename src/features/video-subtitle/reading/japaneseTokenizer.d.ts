/**
 * @file src/features/video-subtitle/reading/japaneseTokenizer.d.ts
 * 文件职责：声明固定版本 kuromoji 二进制词典装配与分词器的最小适配端口。
 * 主要内容：允许自有 Worker 注入字典读取回调，保持第三方分词算法不变。
 * 模块边界：仅提供类型，不读取文件、不建立网络请求、不改变第三方实现。
 */
declare module '@faanau/kuromoji/src/loader/DictionaryLoader' {
    export default class DictionaryLoader {
        constructor(path: string);
        loadArrayBuffer(url: string, callback: (error: Error | null, bytes?: ArrayBuffer) => void): void;
        load(callback: (error: Error | null, dictionary: unknown) => void): void;
    }
}
declare module '@faanau/kuromoji/src/Tokenizer' {
    export default class Tokenizer {
        constructor(dictionary: unknown);
        tokenize(text: string): import('./japaneseTypes').JapaneseReadingToken[];
    }
}
