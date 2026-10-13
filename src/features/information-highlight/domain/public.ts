/**
 * @file src/features/information-highlight/domain/public.ts
 * 文件职责：向设置界面公开智能高亮的纯呈现规则，使预览与真实绘制共用同一套色板、浓度和词项选择。
 * 主要内容：再导出色板、透明度、热力层级以及关键词规则评分与选区函数；不含页面控制器、模型或后台实现。
 * 模块边界：只是纯算法的公共出口，不读取 DOM、配置存储或网络；内容脚本入口仍是 feature 根目录的 public。
 */
export {INFORMATION_HIGHLIGHT_COLORS, INFORMATION_HIGHLIGHT_LEVELS, INFORMATION_HIGHLIGHT_PALETTES, informationHighlightOpacity, presentInformationHeatmap, type InformationHeatmapSpan} from './presentation';
export {scoreInformationKeywords, selectInformationSpans} from './keywords';
