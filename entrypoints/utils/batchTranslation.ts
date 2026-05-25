/**
 * 批量翻译管理器
 * 负责收集、分组、批量翻译和分配翻译结果
 */

import { config } from './config';
import { cache } from './cache';
import { detectlang } from './common';
import { enqueueTranslation } from './translateQueue';

// 批量翻译文本项接口
export interface BatchTextItem {
  id: string; // 唯一标识
  text: string; // 原始文本
  node: Element; // 对应的DOM节点
  nodeId: string; // 节点ID
  translated: boolean; // 是否已翻译
}

// 批量翻译组接口
export interface BatchTranslationGroup {
  id: string; // 组ID
  items: BatchTextItem[]; // 该组包含的文本项
  combinedText: string; // 合并后的文本
  translatedText?: string; // 翻译后的文本
  translated?: boolean; // 是否已翻译
}

// 批量翻译管理器类
export class BatchTranslationManager {
  private groups: Map<string, BatchTranslationGroup> = new Map();
  private isProcessing: boolean = false;

  /**
   * 添加文本项到批量翻译队列
   * @param text 原始文本
   * @param node 对应的DOM节点
   */
  public addTextItem(text: string, node: Element): void {
    if (!text || !text.trim() || this.isTextTranslated(text)) {
      return;
    }

    const nodeId = node.getAttribute('data-fr-node-id');
    if (!nodeId) {
      console.warn('Node does not have data-fr-node-id attribute');
      return;
    }

    const item: BatchTextItem = {
      id: `item-${Date.now()}-${crypto.randomUUID()}`,
      text: text.trim(),
      node: node,
      nodeId: nodeId,
      translated: false
    };

    const groupsArray = Array.from(this.groups.values());
    let targetGroup: BatchTranslationGroup | undefined;
    for (let i = groupsArray.length - 1; i >= 0; i--) {
      const g = groupsArray[i];
      if (!g.translated) {
        const sep = this.getSeparator(g.items.length);
        const newLength = (g.combinedText ? g.combinedText.length + sep.length : 0) + item.text.length;
        if (newLength <= config.batchTranslationSize) {
          targetGroup = g;
          break;
        }
      }
    }

    if (targetGroup) {
      const sep = this.getSeparator(targetGroup.items.length);
      targetGroup.items.push(item);
      targetGroup.combinedText = (targetGroup.combinedText ? targetGroup.combinedText + sep : '') + item.text;
    } else {
      // 创建新组并加入
      const groupId = `group-${Date.now()}-${crypto.randomUUID()}`;
      const group: BatchTranslationGroup = {
        id: groupId,
        items: [item],
        combinedText: item.text
      };
      this.groups.set(groupId, group);
    }
  }

  /**
   * 开始批量翻译
   */
  public async startBatchTranslation(): Promise<void> {
    if (this.isProcessing || this.groups.size === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      for (const group of this.groups.values()) {
        if (!group.translatedText && !group.translated) {
          group.translated = true;
          this.translateGroup(group);
        }
      }
    } catch (error) {
      console.error('Batch translation failed:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 翻译一个组
   */
  private async translateGroup(group: BatchTranslationGroup): Promise<void> {
    if (group.translatedText) {
      return;
    }

    const combinedText = group.combinedText;

    const cached = cache.localGet(combinedText);
    if (cached) {
      group.translatedText = cached;
      const segments = this.splitTranslatedText(combinedText, cached, group.items.length);
      if (segments.length === group.items.length) {
        group.items.forEach((item, index) => {
          this.applyTranslationToNode(item, segments[index]);
          item.translated = true;
        });
        this.groups.delete(group.id);
      } else {
        enqueueTranslation(async () => {
          await this.fallbackIndividualTranslation(group);
          this.groups.delete(group.id);
        }, 0);
      }
      return;
    }

    // 计算字符数
    const characterCount = combinedText.length;

    return enqueueTranslation(async () => {
      try {
        const result = await Promise.race([
          browser.runtime.sendMessage({ context: document.title, origin: combinedText }),

          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('翻译请求超时')), 60000)
          )
        ]) as string;

        if (result && result !== combinedText) {
          group.translatedText = result;
          cache.localSet(combinedText, result);

          const segments = this.splitTranslatedText(combinedText, result, group.items.length);
          if (segments.length === group.items.length) {
            group.items.forEach((item, index) => {
              this.applyTranslationToNode(item, segments[index]);
              item.translated = true;
            });
          } else {
            await this.fallbackIndividualTranslation(group);
          }
        } else {
          group.translatedText = combinedText;
          group.items.forEach(item => item.translated = true);
        }
      } catch (error) {
        console.error('Group translation failed:', error);
        group.translatedText = combinedText;
        group.items.forEach(item => item.translated = true);
      } finally {
        this.groups.delete(group.id);
      }
    }, characterCount);
  }

  /**
   * 生成带索引的分隔符
   */
  private getSeparator(index: number): string {
    return `\n\n=====FR_${index}=====\n\n`;
  }

  /**
   * 分割翻译文本（多策略容错）
   */
  private splitTranslatedText(originalText: string, translatedText: string, expectedCount: number): string[] {
    if (expectedCount <= 1) {
      return [translatedText];
    }

    // 策略1：按带索引的分隔符正则分割
    const indexedSegments = translatedText.split(/\s*=+FR_\d+=+\s*/).filter(s => s.length > 0);
    if (indexedSegments.length === expectedCount) {
      return indexedSegments;
    }

    // 策略2：按连续等号分割
    const simpleSegments = translatedText.split(/\s*={5,}\s*/).filter(s => s.length > 0);
    if (simpleSegments.length === expectedCount) {
      return simpleSegments;
    }

    // 策略3：按原始段落长度比例分割
    const originalSegments = originalText.split(/\s*=+FR_\d+=+\s*/).filter(s => s.length > 0);
    if (originalSegments.length === expectedCount) {
      const originalLengths = originalSegments.map(s => s.length);
      const totalOriginalLength = originalLengths.reduce((a, b) => a + b, 0);
      if (totalOriginalLength > 0) {
        const segments: string[] = [];
        let pos = 0;
        const translatedLen = translatedText.length;
        for (let i = 0; i < expectedCount - 1; i++) {
          const ratio = originalLengths[i] / totalOriginalLength;
          const splitPos = Math.min(pos + Math.round(ratio * translatedLen), translatedLen);
          segments.push(translatedText.substring(pos, splitPos));
          pos = splitPos;
        }
        segments.push(translatedText.substring(pos));
        return segments;
      }
    }

    return [];
  }

  /**
   * 回退：逐条翻译组中的每个文本项
   */
  private async fallbackIndividualTranslation(group: BatchTranslationGroup): Promise<void> {
    for (const item of group.items) {
      if (item.translated) continue;

      const cached = cache.localGet(item.text);
      if (cached) {
        this.applyTranslationToNode(item, cached);
        item.translated = true;
        continue;
      }

      try {
        const result = await Promise.race([
          browser.runtime.sendMessage({ context: document.title, origin: item.text }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('翻译请求超时')), 30000)
          )
        ]) as string;

        if (result && result !== item.text) {
          cache.localSet(item.text, result);
          this.applyTranslationToNode(item, result);
        }
        item.translated = true;
      } catch (error) {
        console.error('Individual translation fallback failed:', error);
        item.translated = true;
      }
    }
  }

  /**
   * 将翻译结果应用到单个节点
   */
  private applyTranslationToNode(item: BatchTextItem, translatedText: string): void {
    if (!translatedText || translatedText === item.text) {
      return;
    }

    const node = item.node;

    // 根据翻译模式应用结果
    if (config.display === 1) {
      // 双语模式
      node.classList.add('fluent-read-bilingual');

      // 移除旧的翻译内容
      const existingTranslation = node.querySelector('.fluent-read-bilingual-content');
      if (existingTranslation) {
        existingTranslation.remove();
      }

      // 添加新的翻译内容
      const translationNode = document.createElement('span');
      translationNode.className = 'fluent-read-bilingual-content';
      translationNode.textContent = translatedText;
      node.appendChild(translationNode);
    } else {
      // 单语模式
      node.innerHTML = translatedText;
    }
  }

  /**
 * 清空所有文本项和组
 */
  public clear(): void {
    this.groups.clear();
    this.isProcessing = false;
  }

  /**
   * 检查文本是否已经翻译
   */
  private isTextTranslated(text: string): boolean {
    // 检查语言
    if (detectlang(text.replace(/[\s\u3000]/g, '')) === config.to) {
      return true;
    }

    return false;
  }
}

// 创建全局批量翻译管理器实例
export const batchTranslationManager = new BatchTranslationManager();
