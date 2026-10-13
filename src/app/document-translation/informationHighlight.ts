/**
 * @file src/app/document-translation/informationHighlight.ts
 * 文件职责：为文档阅读页装配智能高亮的本地模型评分端口。
 * 主要内容：把扩展运行时消息注入共享的可取消评分适配器；PdfReader 只接触文本与 AbortSignal。
 * 模块边界：组装根，仅在扩展文档页加载；与文档解析、翻译运行时分开，使后者不依赖浏览器扩展 API。
 */
import browser from 'webextension-polyfill';
import {createInformationHighlightScorePort} from '@/src/app/content/informationHighlightScorePort';

export const scoreDocumentInformation = createInformationHighlightScorePort(message => browser.runtime.sendMessage(message));
