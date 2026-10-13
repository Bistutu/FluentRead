/**
 * @file src/features/reading-assistant/answer/public.ts
 * 文件职责：公开阅读回答的纯 Markdown 文本结构解析，供写作纯文本转换等非 UI 消费者使用。
 * 主要内容：导出块与行内片段解析函数及其数据类型，不加载阅读卡或回答组件。
 * 模块边界：只转换字符串，不访问浏览器、DOM、存储或模型客户端；回答呈现由独立 UI 出口负责。
 */
export {readingAnswerBlocks, readingAnswerSpans} from '../answerFormat';
export type {ReadingAnswerBlock, ReadingAnswerSpan} from '../answerFormat';
