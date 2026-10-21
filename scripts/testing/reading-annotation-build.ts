/**
 * @file scripts/testing/reading-annotation-build.ts
 * 文件职责：把固定的 Go WASM 支持代码作为本地构建模块导入，避免供应商动态 eval 加载。
 * 主要内容：只解析唯一虚拟模块名，返回锁定安装包中的静态脚本并保留其初始化副作用。
 * 模块边界：仅构建期文件读取，不更改 CSP、不下载资源、不把供应商包装器带入运行时。
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
export function createReadingGoRuntimePlugin(root: string) {
  const id = '\0fluentread-reading-go-runtime';
  return {
    name: 'fluentread-reading-go-runtime', enforce: 'pre' as const,
    resolveId(source: string) {return source === '@fluentread/gomanize-go-runtime' ? {id,moduleSideEffects:true} : null;},
    load(source: string) {return source === id ? {code:readFileSync(resolve(root,'node_modules/@budhash/gomanize/dist/wasm_exec.js'),'utf8'),moduleSideEffects:true} : null;},
  };
}
