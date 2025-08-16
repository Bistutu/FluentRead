/**
 * 自然段翻译模块
 * 按照自然段落而不是HTML标签进行翻译
 */

export interface ParagraphInfo {
  text: string;           // 段落文本内容
  nodes: Node[];          // 包含的DOM节点
  startNode: Node;        // 起始节点
  endNode: Node;          // 结束节点
  boundingRect: DOMRect;  // 段落边界矩形
}

export interface ParagraphTranslationConfig {
  minParagraphLength: number;     // 最小段落长度
  maxParagraphLength: number;     // 最大段落长度
  mergeThreshold: number;         // 句子合并阈值（像素）
  ignoreInlineTags: string[];     // 忽略的内联标签
  breakOnTags: string[];          // 强制分段的标签
}

const defaultConfig: ParagraphTranslationConfig = {
  minParagraphLength: 10,
  maxParagraphLength: 1000, // 降低最大长度，避免过长段落
  mergeThreshold: 5, // 5像素内的文本认为是连续的
  ignoreInlineTags: ['span', 'strong', 'b', 'em', 'i', 'u', 'small', 'mark', 'a', 'code'],
  breakOnTags: ['br', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote']
};

/**
 * 检测自然段落
 * @param rootNode 根节点
 * @param config 配置选项
 * @returns 段落信息数组
 */
export function detectParagraphs(rootNode: Element, config: ParagraphTranslationConfig = defaultConfig): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = [];
  const MAX_NODES = 1000; // 限制最大处理节点数
  const TIMEOUT_MS = 5000; // 5秒超时
  
  const startTime = Date.now();
  let processedNodes = 0;
  
  try {
    const walker = document.createTreeWalker(
      rootNode,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node: Node) => {
          // 超时检查
          if (Date.now() - startTime > TIMEOUT_MS) {
            console.warn('[段落翻译] 检测超时，停止处理');
            return NodeFilter.FILTER_REJECT;
          }
          
          // 节点数量限制
          if (++processedNodes > MAX_NODES) {
            console.warn('[段落翻译] 处理节点数超限，停止处理');
            return NodeFilter.FILTER_REJECT;
          }
          
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent?.trim();
            return text && text.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }
          
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            const tagName = element.tagName.toLowerCase();
            
            // 跳过不需要的标签
            if (['script', 'style', 'noscript', 'svg', 'iframe', 'video', 'audio'].includes(tagName)) {
              return NodeFilter.FILTER_REJECT;
            }
            
            // 跳过隐藏元素
            if (element.hasAttribute('hidden') || 
                element.classList.contains('notranslate') ||
                element.style.display === 'none' ||
                element.style.visibility === 'hidden') {
              return NodeFilter.FILTER_REJECT;
            }
            
            return NodeFilter.FILTER_ACCEPT;
          }
          
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let currentParagraph: {
      text: string;
      nodes: Node[];
      lastRect?: DOMRect;
    } = {
      text: '',
      nodes: []
    };

    let node: Node | null;
    const rectCache = new Map<Node, DOMRect>(); // 缓存边界矩形
    
    while (node = walker.nextNode()) {
      // 定期检查超时
      if (Date.now() - startTime > TIMEOUT_MS) {
        console.warn('[段落翻译] 处理超时，终止');
        break;
      }
      
      if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text;
        const text = textNode.textContent?.trim();
        
        if (!text || text.length === 0) continue;

        // 获取或计算文本节点的边界矩形
        let rect: DOMRect;
        try {
          if (rectCache.has(textNode)) {
            rect = rectCache.get(textNode)!;
          } else {
            const range = document.createRange();
            range.selectNodeContents(textNode);
            rect = range.getBoundingClientRect();
            rectCache.set(textNode, rect);
            range.detach(); // 清理范围对象
          }
          
          // 跳过不可见的文本节点
          if (rect.width === 0 && rect.height === 0) continue;
          
        } catch (error) {
          console.warn('[段落翻译] 获取边界矩形失败:', error);
          continue;
        }

        // 检查是否需要开始新段落
        if (shouldStartNewParagraph(currentParagraph, rect, config)) {
          if (currentParagraph.text.length >= config.minParagraphLength) {
            paragraphs.push(finalizeParagraph(currentParagraph));
          }
          currentParagraph = {
            text: '',
            nodes: []
          };
        }

        // 添加到当前段落
        currentParagraph.text += (currentParagraph.text ? ' ' : '') + text;
        currentParagraph.nodes.push(textNode);
        currentParagraph.lastRect = rect;

        // 检查段落长度限制
        if (currentParagraph.text.length >= config.maxParagraphLength) {
          paragraphs.push(finalizeParagraph(currentParagraph));
          currentParagraph = {
            text: '',
            nodes: []
          };
        }

        // 限制段落数量，避免处理过多
        if (paragraphs.length >= 50) {
          console.warn('[段落翻译] 段落数量过多，停止处理');
          break;
        }

      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        const tagName = element.tagName.toLowerCase();
        
        // 遇到强制分段标签时结束当前段落
        if (config.breakOnTags.includes(tagName)) {
          if (currentParagraph.text.length >= config.minParagraphLength) {
            paragraphs.push(finalizeParagraph(currentParagraph));
          }
          currentParagraph = {
            text: '',
            nodes: []
          };
        }
      }
    }

    // 处理最后一个段落
    if (currentParagraph.text.length >= config.minParagraphLength) {
      paragraphs.push(finalizeParagraph(currentParagraph));
    }
    
  } catch (error) {
    console.error('[段落翻译] 检测过程出错:', error);
    // 出错时返回空数组，避免卡死
    return [];
  }

  console.log(`[段落翻译] 检测完成，处理了${processedNodes}个节点，找到${paragraphs.length}个段落，用时${Date.now() - startTime}ms`);
  return paragraphs;
}

/**
 * 判断是否应该开始新段落
 */
function shouldStartNewParagraph(
  currentParagraph: { text: string; nodes: Node[]; lastRect?: DOMRect },
  currentRect: DOMRect,
  config: ParagraphTranslationConfig
): boolean {
  if (!currentParagraph.lastRect || currentParagraph.nodes.length === 0) {
    return false;
  }

  const lastRect = currentParagraph.lastRect;
  
  // 检查垂直距离
  const verticalGap = Math.abs(currentRect.top - lastRect.bottom);
  if (verticalGap > config.mergeThreshold) {
    return true;
  }

  // 检查水平距离（换行检测）
  const horizontalGap = Math.abs(currentRect.left - lastRect.right);
  if (horizontalGap > 100) { // 可能是换行
    const lineHeight = lastRect.height;
    const verticalDistance = currentRect.top - lastRect.top;
    
    // 如果垂直距离超过1.5倍行高，认为是新段落
    if (verticalDistance > lineHeight * 1.5) {
      return true;
    }
  }

  return false;
}

/**
 * 完成段落信息构建
 */
function finalizeParagraph(paragraph: {
  text: string;
  nodes: Node[];
  lastRect?: DOMRect;
}): ParagraphInfo {
  const startNode = paragraph.nodes[0];
  const endNode = paragraph.nodes[paragraph.nodes.length - 1];
  
  // 计算段落边界矩形
  const range = document.createRange();
  range.setStartBefore(startNode);
  range.setEndAfter(endNode);
  const boundingRect = range.getBoundingClientRect();

  return {
    text: paragraph.text,
    nodes: paragraph.nodes,
    startNode,
    endNode,
    boundingRect
  };
}

/**
 * 根据段落信息创建翻译容器
 * @param paragraph 段落信息
 * @returns 翻译容器元素
 */
export function createParagraphContainer(paragraph: ParagraphInfo): HTMLElement {
  const container = document.createElement('div');
  container.className = 'fluent-read-paragraph-container';
  container.setAttribute('data-original-text', paragraph.text);
  
  // 设置容器样式
  container.style.position = 'relative';
  container.style.display = 'inline';
  
  return container;
}

/**
 * 将段落节点包装到容器中
 * @param paragraph 段落信息
 * @param container 容器元素
 */
export function wrapParagraphNodes(paragraph: ParagraphInfo, container: HTMLElement): void {
  try {
    const startNode = paragraph.startNode;
    const endNode = paragraph.endNode;
    
    // 检查节点是否仍在DOM中
    if (!startNode.parentNode || !document.contains(startNode)) {
      console.warn('[段落翻译] 起始节点不在DOM中，跳过包装');
      return;
    }
    
    // 在起始节点前插入容器
    startNode.parentNode.insertBefore(container, startNode);
    
    // 安全地将段落内的节点移动到容器中
    const nodesToMove = [...paragraph.nodes]; // 创建副本避免在遍历时修改
    const MAX_ITERATIONS = 100; // 防止无限循环
    let iterations = 0;
    
    for (const nodeToMove of nodesToMove) {
      if (++iterations > MAX_ITERATIONS) {
        console.warn('[段落翻译] 节点移动迭代次数超限，停止处理');
        break;
      }
      
      // 确保节点仍然存在且在DOM中
      if (nodeToMove && nodeToMove.parentNode && document.contains(nodeToMove)) {
        try {
          container.appendChild(nodeToMove);
        } catch (error) {
          console.warn('[段落翻译] 移动节点失败:', error);
        }
      }
    }
    
  } catch (error) {
    console.error('[段落翻译] 包装节点失败:', error);
  }
}

/**
 * 应用段落翻译结果
 * @param container 段落容器
 * @param translatedText 翻译后的文本
 * @param isBilingual 是否双语显示
 */
export function applyParagraphTranslation(
  container: HTMLElement, 
  translatedText: string, 
  isBilingual: boolean = false
): void {
  const originalText = container.getAttribute('data-original-text') || '';
  
  container.innerHTML = '';
  
  if (isBilingual) {
    // 双语模式
    const originalElement = document.createElement('div');
    originalElement.className = 'fluent-read-original';
    originalElement.textContent = originalText;
    originalElement.style.color = '#666';
    originalElement.style.fontSize = '0.9em';
    originalElement.style.marginBottom = '4px';
    
    const translatedElement = document.createElement('div');
    translatedElement.className = 'fluent-read-translation';
    translatedElement.textContent = translatedText;
    
    container.appendChild(originalElement);
    container.appendChild(translatedElement);
  } else {
    // 仅译文模式
    container.textContent = translatedText;
  }
  
  container.setAttribute('data-translated', 'true');
}

/**
 * 获取页面中所有段落并进行翻译准备
 * @param rootElement 根元素
 * @param config 配置选项
 * @returns 准备翻译的段落容器数组
 */
export function prepareParagraphTranslation(
  rootElement: Element = document.body,
  config: ParagraphTranslationConfig = defaultConfig
): HTMLElement[] {
  const startTime = Date.now();
  
  try {
    // 检查根元素是否合理
    if (!rootElement || !document.contains(rootElement)) {
      console.warn('[段落翻译] 根元素无效');
      return [];
    }
    
    // 如果根元素过大，限制处理范围
    const elementCount = rootElement.querySelectorAll('*').length;
    if (elementCount > 5000) {
      console.warn('[段落翻译] DOM结构过于复杂，跳过段落模式');
      return [];
    }
    
    const paragraphs = detectParagraphs(rootElement, config);
    const containers: HTMLElement[] = [];
    
    // 限制并发处理的段落数量
    const MAX_PARAGRAPHS = 30;
    const processParagraphs = paragraphs.slice(0, MAX_PARAGRAPHS);
    
    if (paragraphs.length > MAX_PARAGRAPHS) {
      console.log(`[段落翻译] 限制处理段落数：${MAX_PARAGRAPHS}/${paragraphs.length}`);
    }
    
    processParagraphs.forEach((paragraph, index) => {
      try {
        const container = createParagraphContainer(paragraph);
        wrapParagraphNodes(paragraph, container);
        containers.push(container);
      } catch (error) {
        console.warn(`[段落翻译] 处理第${index}个段落失败:`, error);
      }
    });
    
    console.log(`[段落翻译] 准备完成，创建了${containers.length}个容器，用时${Date.now() - startTime}ms`);
    return containers;
    
  } catch (error) {
    console.error('[段落翻译] 准备过程失败:', error);
    return [];
  }
}
