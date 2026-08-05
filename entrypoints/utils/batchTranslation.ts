import { config } from './config';
import { cache } from './cache';
import { detectlang } from './common';
import { enqueueTranslation } from './translateQueue';
import { servicesType } from './option';

export interface BatchTextItem {
  id: string;
  text: string;
  node: Element;
  nodeId: string;
  translated: boolean;
}

export interface BatchTranslationGroup {
  id: string;
  items: BatchTextItem[];
  totalTextLength: number;
  translatedText?: string;
  translated?: boolean;
  // 该批次翻译完成后的结果段落（与 items 一一对应）。
  // 翻译阶段（可并发）只填充该字段，应用阶段再按顺序写入 DOM。
  resultSegments?: string[];
  // 标记本批次是否已完成翻译阶段（无论成功失败）。
  done?: boolean;
}

export class BatchTranslationManager {
  private groups: Map<string, BatchTranslationGroup> = new Map();
  private isProcessing: boolean = false;

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

    // 从前往后查找第一个仍可容纳本条文本的批次，确保批次顺序与文档顺序一致。
    const groupsArray = Array.from(this.groups.values());
    let targetGroup: BatchTranslationGroup | undefined;
    for (let i = 0; i < groupsArray.length; i++) {
      const g = groupsArray[i];
      if (!g.translated && !g.done) {
        const estimatedSize = g.totalTextLength + item.text.length + (g.items.length + 1) * 3 + 2;
        if (estimatedSize <= config.batchTranslationSize) {
          targetGroup = g;
          break;
        }
      }
    }

    if (targetGroup) {
      targetGroup.items.push(item);
      targetGroup.totalTextLength += item.text.length;
    } else {
      const groupId = `group-${Date.now()}-${crypto.randomUUID()}`;
      const group: BatchTranslationGroup = {
        id: groupId,
        items: [item],
        totalTextLength: item.text.length,
      };
      this.groups.set(groupId, group);
    }
  }

  public async startBatchTranslation(): Promise<void> {
    if (this.isProcessing || this.groups.size === 0) {
      return;
    }

    this.isProcessing = true;

    // 按插入顺序（即文档从上到下的顺序）快照所有未完成的批次。
    // 翻译阶段：所有批次并发提交到全局并发队列（保留并发速度，受 maxConcurrentTranslations 控制）。
    // 应用阶段：严格按文档顺序写入 DOM —— 第 i 个批次必须等第 i-1 个批次应用完成后才应用，
    // 这样用户从上到下依次看到翻译结果，避免"后面的文字先翻译出来"的问题。
    const orderedGroups = Array.from(this.groups.values()).filter(
      g => !g.translatedText && !g.translated && !g.done
    );

    try {
      // 1) 并发发起所有批次的翻译（仅生产结果，不写 DOM）。
      //    每个批次完成后将结果填入 group.resultSegments，并标记 group.done。
      const groupPromises = orderedGroups.map(group => {
        group.translated = true;
        return this.translateGroup(group);
      });

      // 2) 按文档顺序串行应用：等待第 i 个批次完成 -> 写入 DOM -> 再处理第 i+1 个。
      for (let i = 0; i < orderedGroups.length; i++) {
        const group = orderedGroups[i];
        try {
          await groupPromises[i];
        } catch {
          // 单个批次失败不影响后续批次的应用；翻译阶段内部已做容错并填充了 resultSegments。
        }
        this.applyGroupResult(group);
      }
    } catch (error) {
      console.error('Batch translation failed:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 将某批次的结果按顺序应用到 DOM。
   * 翻译阶段只负责生产 resultSegments，所有 DOM 写入都集中到这里，保证顺序一致。
   */
  private applyGroupResult(group: BatchTranslationGroup): void {
    if (group.resultSegments && group.resultSegments.length === group.items.length) {
      group.items.forEach((item, index) => {
        this.applyTranslationToNode(item, group.resultSegments![index]);
        item.translated = true;
      });
    } else {
      // 没有结果（失败或无翻译内容），仅标记为已处理，保持顺序推进。
      group.items.forEach(item => (item.translated = true));
    }
    this.groups.delete(group.id);
  }

  private buildGroupKey(group: BatchTranslationGroup): string {
    return JSON.stringify(group.items.map(i => i.text));
  }

  /**
   * 翻译单个批次：仅生产结果（填入 group.resultSegments），不直接写 DOM。
   * 由 startBatchTranslation 负责按顺序调用 applyGroupResult 写入 DOM。
   */
  private async translateGroup(group: BatchTranslationGroup): Promise<void> {
    if (group.done || group.resultSegments) {
      return;
    }

    const isLLM = servicesType.isAI(config.service);
    const key = this.buildGroupKey(group);

    if (group.items.length === 1 || !isLLM) {
      try {
        const segments = await enqueueTranslation(async () => {
          if (group.items.length === 1) {
            return await this.translateSingleItem(group.items[0]);
          } else {
            return await this.fallbackIndividualTranslation(group);
          }
        }, group.totalTextLength);
        group.resultSegments = segments;
      } catch (error) {
        console.error('Batch translation failed:', error);
      } finally {
        group.done = true;
      }
      return;
    }

    const cached = cache.localGet(key);
    if (cached) {
      const segments = this.parseBatchResponse(cached, group.items.length);
      if (segments.length === group.items.length) {
        group.resultSegments = segments;
        group.done = true;
        return;
      }
      // 缓存解析失败，回退到逐条翻译
      try {
        const segs = await enqueueTranslation(async () => {
          return await this.fallbackIndividualTranslation(group);
        }, 0);
        group.resultSegments = segs;
      } catch (error) {
        console.error('Batch translation failed:', error);
      } finally {
        group.done = true;
      }
      return;
    }

    const origin = key;
    const characterCount = group.totalTextLength;

    console.log('[BatchTranslation] Sending to LLM:', { itemCount: group.items.length, texts: group.items.map(i => i.text), origin });

    try {
      const result = await enqueueTranslation(async () => {
        return await Promise.race([
          browser.runtime.sendMessage({ context: document.title, origin }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('翻译请求超时')), 60000)
          )
        ]) as string;
      }, characterCount);

      if (result && result !== origin) {
        cache.localSet(key, result);

        const segments = this.parseBatchResponse(result, group.items.length);
        if (segments.length === group.items.length) {
          group.resultSegments = segments;
        } else {
          // LLM 返回的段数不匹配，回退到逐条翻译
          group.resultSegments = await this.fallbackIndividualTranslation(group);
        }
      }
    } catch (error) {
      console.error('Batch translation failed:', error);
    } finally {
      group.done = true;
    }
  }

  /**
   * 翻译单条文本：返回译文，不直接写 DOM。
   *（写入 DOM 由 applyGroupResult 统一按顺序完成。）
   */
  private async translateSingleItem(item: BatchTextItem): Promise<string[]> {
    const cached = cache.localGet(item.text);
    if (cached) {
      return [cached];
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
        return [result];
      }
    } catch (error) {
      console.error('Single translation failed:', error);
    }
    return [item.text];
  }

  private parseBatchResponse(response: string, expectedCount: number): string[] {
    if (!response || expectedCount <= 0) return [];
    if (expectedCount === 1) return [response];

    let text = response.trim();

    text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    text = text.trim();

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length === expectedCount) {
        return parsed.map((item: any) => String(item));
      }
    } catch {}

    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length === expectedCount) {
          return parsed.map((item: any) => String(item));
        }
      } catch {}
    }

    return [];
  }

  /**
   * 逐条翻译回退：返回与 items 一一对应的译文数组，不直接写 DOM。
   *（写入 DOM 由 applyGroupResult 统一按顺序完成。）
   */
  private async fallbackIndividualTranslation(group: BatchTranslationGroup): Promise<string[]> {
    const segments: string[] = [];
    for (const item of group.items) {
      const cached = cache.localGet(item.text);
      if (cached) {
        segments.push(cached);
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
          segments.push(result);
        } else {
          segments.push(item.text);
        }
      } catch (error) {
        console.error('Individual translation fallback failed:', error);
        segments.push(item.text);
      }
    }
    return segments;
  }

  private applyTranslationToNode(item: BatchTextItem, translatedText: string): void {
    if (!translatedText || translatedText === item.text) {
      return;
    }

    const node = item.node;

    if (config.display === 1) {
      node.classList.add('fluent-read-bilingual');

      const existingTranslation = node.querySelector('.fluent-read-bilingual-content');
      if (existingTranslation) {
        existingTranslation.remove();
      }

      const translationNode = document.createElement('span');
      translationNode.className = 'fluent-read-bilingual-content';
      translationNode.textContent = translatedText;
      node.appendChild(translationNode);
    } else {
      node.innerHTML = translatedText;
    }
  }

  public clear(): void {
    this.groups.clear();
    this.isProcessing = false;
  }

  private isTextTranslated(text: string): boolean {
    if (detectlang(text.replace(/[\s\u3000]/g, '')) === config.to) {
      return true;
    }

    return false;
  }
}

export const batchTranslationManager = new BatchTranslationManager();
