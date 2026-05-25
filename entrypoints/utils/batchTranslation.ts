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

    const groupsArray = Array.from(this.groups.values());
    let targetGroup: BatchTranslationGroup | undefined;
    for (let i = groupsArray.length - 1; i >= 0; i--) {
      const g = groupsArray[i];
      if (!g.translated) {
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

  private buildGroupKey(group: BatchTranslationGroup): string {
    return JSON.stringify(group.items.map(i => i.text));
  }

  private async translateGroup(group: BatchTranslationGroup): Promise<void> {
    if (group.translatedText) {
      return;
    }

    const isLLM = servicesType.isAI(config.service);
    const key = this.buildGroupKey(group);

    if (group.items.length === 1 || !isLLM) {
      return enqueueTranslation(async () => {
        try {
          if (group.items.length === 1) {
            await this.translateAndApplySingle(group.items[0]);
          } else {
            await this.fallbackIndividualTranslation(group);
          }
        } finally {
          this.groups.delete(group.id);
        }
      }, group.totalTextLength);
    }

    const cached = cache.localGet(key);
    if (cached) {
      const segments = this.parseBatchResponse(cached, group.items.length);
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

    const origin = key;
    const characterCount = group.totalTextLength;

    return enqueueTranslation(async () => {
      try {
        const result = await Promise.race([
          browser.runtime.sendMessage({ context: document.title, origin }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('翻译请求超时')), 60000)
          )
        ]) as string;

        if (result && result !== origin) {
          cache.localSet(key, result);

          const segments = this.parseBatchResponse(result, group.items.length);
          if (segments.length === group.items.length) {
            group.items.forEach((item, index) => {
              this.applyTranslationToNode(item, segments[index]);
              item.translated = true;
            });
          } else {
            await this.fallbackIndividualTranslation(group);
          }
        } else {
          group.items.forEach(item => item.translated = true);
        }
      } catch (error) {
        console.error('Batch translation failed:', error);
        group.items.forEach(item => item.translated = true);
      } finally {
        this.groups.delete(group.id);
      }
    }, characterCount);
  }

  private async translateAndApplySingle(item: BatchTextItem): Promise<void> {
    const cached = cache.localGet(item.text);
    if (cached) {
      this.applyTranslationToNode(item, cached);
      item.translated = true;
      return;
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
      console.error('Single translation failed:', error);
      item.translated = true;
    }
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
