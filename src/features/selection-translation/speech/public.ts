/**
 * @file src/features/selection-translation/speech/public.ts
 * 文件职责：向学习中心暴露既有朗读协议和播放所有权控制器，复用划词朗读的后台通路。
 * 主要内容：静态导出请求编号、远程播放状态机和语音语言规范化，不重复提供远程合成服务。
 * 模块边界：公共出口不挂载划词 UI、不读取配置或访问网络；组件注入 runtime 消息并管理本页音频资源。
 */
export {createSelectionTtsContentController} from '../content/selectionTtsContentController';
export {createSelectionTtsClientRequestId} from '../protocol';
export {normalizeSpeechLanguage} from '../core';
