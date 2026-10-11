/**
 * @file userscript/configRuntime.ts
 * 文件职责：提供 userscript 启动阶段需要的共享配置出口，保留动态加载后的同一份配置实例。
 * 主要内容：仅再导出配置、就绪 Promise 和保存函数，避免启动并发加载物化整个配置模块命名空间。
 * 模块边界：不创建配置副本、不改变水合或存储权限；配置迁移完成后仍由 main 动态加载。
 */
export {config, configReady, saveConfig} from '@/src/services/config/store';
