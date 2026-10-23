/**
 * @file src/features/video-subtitle/reading/japaneseTypes.d.ts
 * 文件职责：声明日语读音格式化和缓存分词适配器共用的最小类型契约。
 * 主要内容：原始词元、同步分词器和异步装配回调，避免算法与读取端口互相依赖。
 * 模块边界：仅类型，不加载字典、算法、网络或浏览器能力。
 */
export interface JapaneseReadingToken {
    surface_form: string;
    pos?: string;
    pos_detail_1?: string;
    reading?: string;
    pronunciation?: string;
    word_type?: string;
}

export interface JapaneseTokenizer {
    tokenize(text: string): JapaneseReadingToken[];
}

export type BuildTokenizer = (options: {dicPath: string}) => {
    build(callback: (error: Error | null, tokenizer?: JapaneseTokenizer) => void): void;
};
