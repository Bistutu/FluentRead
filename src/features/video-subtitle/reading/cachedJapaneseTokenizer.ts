/**
 * @file src/features/video-subtitle/reading/cachedJapaneseTokenizer.ts
 * 文件职责：将日语分词器的字典读取绑定到固定版本、经过完整性校验的本机下载缓存。
 * 主要内容：复用 kuromoji 的原有二进制词典装配和分词算法，只替换文件读取端口，在自有 Worker 内解压 gzip 并传播初始化失败。
 * 模块边界：不修改第三方包、不执行下载代码、不接受页面提供的下载来源；词典下载和持久缓存由 japaneseDictionary 管理。
 */
import DictionaryLoader from '@faanau/kuromoji/src/loader/DictionaryLoader';
import Tokenizer from '@faanau/kuromoji/src/Tokenizer';
import {readJapaneseDictionaryFile} from './japaneseDictionary';
import type {BuildTokenizer} from './japaneseTypes';

async function decompressDictionary(bytes: ArrayBuffer): Promise<ArrayBuffer> {
    const body = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(body).arrayBuffer();
}

export function createCachedJapaneseBuilder(
    read = readJapaneseDictionaryFile,
    decompress = decompressDictionary,
): BuildTokenizer {
    return ({dicPath}) => ({build(callback) {
        const loader = new DictionaryLoader(dicPath);
        loader.loadArrayBuffer = (url, done) => {
            void read(url).then(decompress).then(bytes => done(null, bytes), error => done(error));
        };
        loader.load((error, dictionary) => {
            if (error) {callback(error); return;}
            try {callback(null, new Tokenizer(dictionary));}
            catch (failure) {callback(failure instanceof Error ? failure : new Error('Japanese tokenizer failed to initialize'));}
        });
    }});
}

export const cachedJapaneseBuilder = createCachedJapaneseBuilder();
