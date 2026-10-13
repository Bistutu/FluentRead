/**
 * @file src/features/information-highlight/public.ts
 * 文件职责：提供信息高亮 feature 的纯内容脚本公共装配入口。
 * 主要内容：导出页面控制器、注入端口与本地规则评分；跨上下文纯数据另从 protocol 导入，模型后台和 Worker 另有独立公共出口。
 * 模块边界：此出口不汇总平台、Worker、模型下载或后台运行时，应用负责注入评分消息并拥有页面生命周期。
 */
export {installInformationHighlight, INFORMATION_HIGHLIGHT_NAME, type InformationHighlightController, type InformationHighlightPorts} from './content/runtime';
export {scoreInformationKeywords} from './domain/keywords';
