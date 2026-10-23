/**
 * @file scripts/testing/reading-annotation-build.ts
 * 文件职责：为读音缓存适配器提供固定版本日语分词算法的静态构建入口。
 * 主要内容：只解析词典装配与分词构造器两个包内 CJS 模块，避开需要 Node API 的供应商包装入口。
 * 模块边界：仅生成本地模块路径，不修改第三方实现、不下载数据或代码、不改变 CSP。
 */
import {resolve} from 'node:path';

/** 固定包的 exports 不开放内部构造器；仅将两个本地 CJS 算法模块暴露给缓存适配器。 */
export function createReadingDictionaryAliases(root: string) {
  return ['loader/DictionaryLoader', 'Tokenizer'].map(module => ({
    find: new RegExp(`^@faanau/kuromoji/src/${module}$`, 'u'),
    replacement: resolve(root, `node_modules/@faanau/kuromoji/src/${module}.js`),
  }));
}
