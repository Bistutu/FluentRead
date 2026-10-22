/**
 * @file src/features/video-subtitle/reading/goRuntime.d.ts
 * 文件职责：声明由构建插件固定解析的 Go WASM 运行时副作用模块。
 * 主要内容：仅允许编译期固定别名，不给第三方包的 eval 加载器提供调用入口。
 * 模块边界：类型声明，无运行时代码；实际源码来自锁定版本 @budhash/gomanize 的 dist/wasm_exec.js。
 */
declare module '@fluentread/gomanize-go-runtime';
