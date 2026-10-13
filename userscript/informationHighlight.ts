/**
 * @file userscript/informationHighlight.ts
 * 文件职责：让 userscript 在扩展公开契约处明确关闭不可达的信息高亮功能。
 * 主要内容：提供关闭状态及幂等空生命周期，构建不包含正文扫描器、原生绘制或本地模型请求。
 * 模块边界：仅供构建期 alias，不读取网页、不创建观察器，不修改共享偏好。
 */
import type {InformationHighlightPreferences} from '../src/core/config/informationHighlight';
import type {InformationHighlightController} from '../src/features/information-highlight/content/runtime';
export function installInformationHighlight(_document: Document, preferences: InformationHighlightPreferences): InformationHighlightController {
    const getState = () => ({enabled: false, phase: 'unsupported' as const, sessionId: '0',
        processedParagraphs: 0, queuedParagraphs: 0, highlightedSpans: 0, mode: preferences.mode});
    return {getState, setEnabled: getState, retry: getState, updatePreferences(next) {preferences = next;},
        refresh() {}, dispose() {}};
}
