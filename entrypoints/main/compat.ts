// 兼容部分网站独特的 DOM 结构

import {findMatchingElement} from "@/entrypoints/utils/common";

type ReplaceFunction = (node: any, text: any) => any;
type SelectFunction = (node: any) => any | {skip: boolean} | false;

const parser = new DOMParser();

// 调试相关
const isDev = process.env.NODE_ENV === 'development';

/**
 * 调试日志函数，只在开发模式下输出
 * @param type 日志类型
 * @param message 日志消息
 * @param ...args 日志参数
 */
function debugLog(type: string, message: string, ...args: any[]): void {
  if (!isDev) return;

  // 为不同类型设置不同颜色
  const colors: {[key: string]: string} = {
    'Twitter': 'color: #1DA1F2; font-weight: bold',
    'GitHub': 'color: #6e5494; font-weight: bold',
    'StackOverflow': 'color: #f48024; font-weight: bold',
    'Reddit': 'color: #FF4500; font-weight: bold',
    'Medium': 'color: #00ab6c; font-weight: bold',
    'YouTube': 'color: #FF0000; font-weight: bold',  // 添加YouTube的颜色
    'Compat': 'color: #0366d6; font-weight: bold',
    'Skip': 'color: #d73a49; font-weight: bold',
    'Content': 'color: #28a745; font-weight: bold',
    'Default': 'color: #24292e; font-weight: bold'
  };
  
  const color = colors[type] || colors['Default'];
  const prefix = `%c[FluentRead][${type}]`;
  
  // 根据日志类型决定是否需要分组
  if (['Content', 'Skip', 'YouTube', 'GitHub', 'Twitter'].includes(type) && args.length > 0) {
    // 使用折叠分组，减少日志视觉干扰
    console.groupCollapsed(prefix, color, message);
    args.forEach((arg, index) => {
      if (typeof arg === 'string') {
        console.log(`参数${index + 1}:`, arg.substring(0, 100) + (arg.length > 100 ? '...' : ''));
      } else {
        console.log(`参数${index + 1}:`, arg);
      }
    });
    console.groupEnd();
  } else {
    // 常规日志输出
    console.log(prefix, color, message, ...args);
  }
}

interface ReplaceCompatFn {
    [domain: string]: ReplaceFunction;
}

interface SelectCompatFn {
    [domain: string]: SelectFunction;
}

// 根据浏览器 url.host 是获取获取主域名
export function getMainDomain(url: any) {
    try {
        // 处理URL对象或字符串
        let hostname = '';
        
        // 如果是URL字符串，提取hostname部分
        if (typeof url === 'string') {
            // 移除协议部分
            const noProtocol = url.replace(/^(https?:\/\/)/, '');
            // 提取域名部分（移除路径和查询参数）
            hostname = noProtocol.split('/')[0];
        } else if (url instanceof URL) {
            hostname = url.hostname;
        } else {
            return '';
        }
        
        // 处理特殊情况: 将Twitter的旧域名和新域名统一处理
        if (hostname === 'twitter.com' || hostname === 'x.com' || 
            hostname === 'www.twitter.com' || hostname === 'www.x.com') {
            return 'x.com';
        }
        
        // 移除可能的www前缀
        hostname = hostname.replace(/^www\./, '');
        
        // 提取基本域名
        const parts = hostname.split('.');
        if (parts.length >= 2) {
            // 对于常见的二级域名（如co.uk），需要特殊处理
            if (parts.length >= 3 && 
                ((parts[parts.length-2] === 'co' || parts[parts.length-2] === 'com') && 
                 parts[parts.length-1].length === 2)) {
                // 例如 example.co.uk 应该返回 example.co.uk
                return parts.slice(-3).join('.');
            } else {
                // 否则返回主域名和顶级域名
                return parts.slice(-2).join('.');
            }
        }
        
        return hostname;
    } catch (error) {
        console.error('getMainDomain error:', error);
        return '';
    }
}

/**
 * 检查文本内容是否属于不应翻译的特殊内容
 * 比如：URLs、邮箱地址、用户名、代码片段等
 */
function isSpecialContent(text: string): boolean {
    if (!text) return false;
    
    const trimmedText = text.trim();
    
    // 检查是否为URL
    if (/^https?:\/\/\S+/i.test(trimmedText)) return true;
    
    // 检查是否为邮箱地址
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmedText)) return true;
    
    // 检查是否为社交媒体用户名格式
    if (/^@\w+$/.test(trimmedText)) return true;      // Twitter格式：@username
    if (/^u\/\w+$/.test(trimmedText)) return true;    // Reddit格式：u/username
    
    // 检查是否为x.com或twitter.com的ID格式
    if (/^id@https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/status\/\d+/.test(trimmedText)) return true;
    
    // 检查是否为GitHub相关特殊内容
    // GitHub Issue或PR编号
    if (/^#\d+$/.test(trimmedText)) return true;
    // GitHub仓库引用 user/repo#123
    if (/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+#\d+$/.test(trimmedText)) return true;
    // GitHub 文件路径
    if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/(blob|tree)\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-\/]+$/.test(trimmedText)) return true;
    // GitHub提交哈希
    if (/^[a-f0-9]{7,40}$/.test(trimmedText)) return true;
    // 以.开头的文件名
    if (/^\.[a-zA-Z0-9_.-]+$/.test(trimmedText)) return true;
    // 以通过文件后缀结尾的
    if (/^[a-zA-Z0-9_.-]+\.[a-zA-Z0-9_.-]+$/.test(trimmedText)) return true;

    // 检查是否为代码片段（简单判断，可能会有误判）
    if (/^[a-zA-Z0-9_]+\([^)]*\)/.test(trimmedText)) return true;  // 函数调用
    if (/^import\s+|^from\s+|^require\(/.test(trimmedText)) return true;  // 导入语句
    if (/^const\s+|^let\s+|^var\s+|^function\s+/.test(trimmedText)) return true;  // 变量/函数声明
    
    // 检查是否为哈希值或其他特殊标识符
    if (/^[a-f0-9]{8,}$/i.test(trimmedText)) return true;
    
    return false;
}

// 文本替换环节的兼容函数，主域名 : 兼容函数
export const replaceCompatFn: ReplaceCompatFn = {
    ["youtube.com"]: (node: any, text: any) => {
        // 使用DOMParser解析翻译后的HTML
        const doc = parser.parseFromString(text, 'text/html');
        const newNode = doc.body.firstChild as HTMLElement;
        
        // 针对YouTube特有的格式化字符串进行特殊处理
        if (node.tagName.toLowerCase() === 'yt-formatted-string') {
            // 尝试保留原有的属性和样式
            if (node.hasAttribute('has-link-only_')) {
                node.innerHTML = newNode.innerHTML;
                return;
            }
            
            // 处理具有特殊格式的内容
            if (node.querySelector('a') || node.querySelector('span')) {
                // 尝试保留链接和格式，但更新文本内容
                const links = node.querySelectorAll('a');
                const spans = node.querySelectorAll('span');
                
                if (links.length > 0 || spans.length > 0) {
                    // 创建临时元素存储新文本
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = newNode.innerHTML;
                    
                    // 保留原有的链接和格式元素
                    node.childNodes.forEach((child: Node) => {
                        if (child.nodeType === Node.ELEMENT_NODE) {
                            // 保留原有的HTML元素
                            if (child.nodeName.toLowerCase() === 'a' || child.nodeName.toLowerCase() === 'span') {
                                // 更新元素内容，但保留属性
                                (child as HTMLElement).textContent = tempDiv.textContent || '';
                            }
                        }
                    });
                    return;
                }
            }
        }
        
        // 默认处理：直接替换innerHTML
        node.innerHTML = newNode.innerHTML;
    }
};

// 元素 node 选择环节的兼容函数
export const selectCompatFn: SelectCompatFn = {
    ["mvnrepository.com"]: (node: any) => {
        if (node.tagName.toLowerCase() === 'div' && node.classList.contains('im-description')) return node
    },
    ["aozora.gr.jp"]: (node: any) => {
        if (node.tagName.toLowerCase() === 'div' && node.classList.contains('main_text')) return node
    },
    ["youtube.com"]: (node: any) => {
        // 检查是否应该跳过该节点
        if (shouldSkipYouTubeElement(node)) {
            debugLog('Compat', '跳过YouTube元素:', node.textContent);
            return { skip: true };
        }
        
        // 视频标题
        const videoTitle = findMatchingElement(node, 'h1.title');
        if (videoTitle) {
            debugLog('YouTube', '翻译视频标题', videoTitle.textContent);
            return videoTitle;
        }
        
        // 视频描述
        const videoDescription = findMatchingElement(node, 'div#description-inline-expander');
        if (videoDescription) {
            debugLog('YouTube', '翻译视频描述', videoDescription.textContent?.substring(0, 50) + '...');
            return videoDescription;
        }
        
        // 评论内容
        const commentContent = findMatchingElement(node, 'yt-formatted-string#content-text');
        if (commentContent) {
            debugLog('YouTube', '翻译评论内容', commentContent.textContent);
            return commentContent;
        }
        
        // 频道简介
        const channelDescription = findMatchingElement(node, 'div#description');
        if (channelDescription) {
            debugLog('YouTube', '翻译频道简介', channelDescription.textContent?.substring(0, 50) + '...');
            return channelDescription;
        }

        // 播放列表描述
        const playlistDescription = findMatchingElement(node, 'yt-formatted-string.ytd-playlist-panel-renderer');
        if (playlistDescription) {
            debugLog('YouTube', '翻译播放列表描述', playlistDescription.textContent);
            return playlistDescription;
        }
        
        // 视频卡片标题
        const videoCardTitle = findMatchingElement(node, 'yt-formatted-string.ytd-compact-video-renderer');
        if (videoCardTitle) {
            debugLog('YouTube', '翻译视频卡片标题', videoCardTitle.textContent);
            return videoCardTitle;
        }
        
        // 社区帖子内容
        const communityPost = findMatchingElement(node, 'div#content');
        if (communityPost && communityPost.closest('ytd-backstage-post-renderer')) {
            debugLog('YouTube', '翻译社区帖子', communityPost.textContent?.substring(0, 50) + '...');
            return communityPost;
        }
        
        // 字幕内容
        const captionText = findMatchingElement(node, 'span.captions-text');
        if (captionText) {
            debugLog('YouTube', '翻译字幕内容', captionText.textContent);
            return captionText;
        }
        
        // 视频信息文本 - 一般格式化字符串处理
        if (node.tagName.toLowerCase() === 'yt-formatted-string' && 
            node.textContent?.trim() &&
            node.textContent.length > 5) {
            // 检查是否不在按钮或控制区域内
            let isInControl = false;
            let parent = node.parentElement;
            while (parent) {
                if (parent.id === 'top-level-buttons-computed' || 
                    parent.id === 'subscribe-button' || 
                    parent.classList?.contains('ytd-menu-renderer')) {
                    isInControl = true;
                    break;
                }
                parent = parent.parentElement;
            }
            
            if (!isInControl) {
                debugLog('YouTube', '翻译格式化字符串', node.textContent);
                return node;
            }
        }
        
        // 默认不翻译
        return false;
    },
    ['webtrees.net']: (node: any) => {
        // class='kmsg'
        if (node.tagName.toLowerCase() === 'div' && node.classList.contains('kmsg')) return node
    },
    ['x.com']: (node: any) => {
        // 需要先检查是否为应该跳过的元素
        if (shouldSkipTwitterElement(node)) {
            // 开发模式下记录被跳过的Twitter元素
            debugLog('Compat', '跳过Twitter元素:', node.textContent);
            return { skip: true };
        }
        
        // 个人简介
        const userDescription = findMatchingElement(node, 'div[data-testid="UserDescription"]'); 
        if (userDescription) return userDescription;
        
        // 推文正文 - 但不包括用户名提及部分
        const tweetText = findMatchingElement(node, 'div[data-testid="tweetText"]');
        if (tweetText) return tweetText;
        
        // 评论内容
        const reply = findMatchingElement(node, 'div[role="group"] div[lang]');
        if (reply) return reply;
        
        // 主页时间线帖子
        const timelineCell = findMatchingElement(node, 'div[data-testid="cellInnerDiv"] div[lang]');
        if (timelineCell) return timelineCell;

        // 返回应该翻译的主要内容元素
        const tweetContent = findMatchingElement(node, 'article div[lang]');
        if (tweetContent) return tweetContent;
        
        // 默认返回false，表示不翻译
        return false;
    },
    ['github.com']: (node: any) => {
        // 判断是否应该跳过该节点
        if (shouldSkipGitHubElement(node)) {
            return { skip: true };
        }
        
        // 检查是否为目录节点
        if (isGitHubPathOrFileName(node)) {
            debugLog('GitHub', '目录/文件名跳过', node.textContent);
            return { skip: true };
        }
        
        // 首先翻译最重要的文本内容
        
        // 问题（Issue）和PR内容
        const issueBody = findMatchingElement(node, 'div.comment-body');
        if (issueBody) return issueBody;
        
        // 评论内容
        const comment = findMatchingElement(node, 'div.comment-body td.comment-body');
        if (comment) return comment;
        
        // 然后翻译次要但仍然重要的内容
        
        // 问题（Issue）标题
        const issueTitle = findMatchingElement(node, 'div.js-issue-title');
        if (issueTitle) return issueTitle;
        
        // PR描述
        const prDescription = findMatchingElement(node, 'div.pull-request-review-comment');
        if (prDescription) return prDescription;
        
        // 仓库描述
        const repoDescription = findMatchingElement(node, 'p.f4.my-3');
        if (repoDescription) return repoDescription;
        
        // 代码提交信息
        const commitMessage = findMatchingElement(node, 'div.commit-desc pre');
        if (commitMessage) return commitMessage;
        
        // 项目关于（About）文本
        const aboutText = findMatchingElement(node, 'div.BorderGrid-cell > p');
        if (aboutText) return aboutText;
        
        // 最后翻译其他辅助内容
        
        // PR状态信息
        const prStatus = findMatchingElement(node, 'div.merge-status-item span.status-meta');
        if (prStatus) return prStatus;
        
        // 项目语言描述
        const languageDesc = findMatchingElement(node, 'div.f6.color-fg-muted.mt-2');
        if (languageDesc) return languageDesc;
        
        // 个人简介
        const profile = findMatchingElement(node, 'div.p-note.user-profile-bio');
        if (profile) return profile;
        
        // 仓库列表项说明
        const repoListDesc = findMatchingElement(node, 'p.pinned-item-desc');
        if (repoListDesc) return repoListDesc;
        
        // Action运行日志
        const actionLog = findMatchingElement(node, 'div.js-log-container pre');
        if (actionLog) return actionLog;
        
        // 默认不翻译
        return false;
    },
    ['stackoverflow.com']: (node: any) => {
        // 判断是否应该跳过该节点
        if (shouldSkipStackOverflowElement(node)) {
            return { skip: true };
        }
        
        // 首先翻译最重要的内容
        
        
        // 然后翻译次要但仍然重要的内容
        
        // 问题标题
        const questionTitle = findMatchingElement(node, 'h1.question-hyperlink');
        if (questionTitle) return questionTitle;
        
        // 问题描述摘要
        const excerpt = findMatchingElement(node, 'div.excerpt');
        if (excerpt) return excerpt;
        
        // 最后翻译其他辅助内容
        
        // 问题状态提示
        const status = findMatchingElement(node, 'div.question-status');
        if (status) return status;
        
        // 用户简介
        const userProfile = findMatchingElement(node, 'div.profile-about');
        if (userProfile) return userProfile;
        
        // 错误提示
        const errorMessage = findMatchingElement(node, 'div.s-notice');
        if (errorMessage) return errorMessage;
        
        // 默认不翻译
        return false;
    },
    ['medium.com']: (node: any) => {
        // 判断是否应该跳过该节点
        if (shouldSkipMediumElement(node)) {
            return { skip: true };
        }
        
        // 文章标题
        const articleTitle = findMatchingElement(node, 'h1');
        if (articleTitle) return articleTitle;
        
        // 文章副标题
        const articleSubtitle = findMatchingElement(node, 'h2');
        if (articleSubtitle) return articleSubtitle;
        
        // 文章段落
        const articleParagraph = findMatchingElement(node, 'p');
        if (articleParagraph) return articleParagraph;
        
        // 文章列表项
        const articleListItem = findMatchingElement(node, 'li');
        if (articleListItem) return articleListItem;
        
        // 引用内容
        const blockquote = findMatchingElement(node, 'blockquote');
        if (blockquote) return blockquote;
        
        // 文章正文容器
        const articleBody = findMatchingElement(node, 'article section');
        if (articleBody) return articleBody;
        
        // 作者简介
        const authorBio = findMatchingElement(node, 'p.pw-author-note');
        if (authorBio) return authorBio;
        
        // 评论内容
        const comment = findMatchingElement(node, 'div.pw-responses-thread p');
        if (comment) return comment;
        
        // 默认不翻译
        return false;
    },
    ['reddit.com']: (node: any) => {
        // 判断是否应该跳过该节点
        if (shouldSkipRedditElement(node)) {
            debugLog('Reddit', '跳过Reddit元素', node.textContent);
            return { skip: true };
        }
        
        // 帖子标题
        const postTitle = findMatchingElement(node, 'h1, h3[data-click-id="body"]');
        if (postTitle) {
            debugLog('Reddit', '翻译帖子标题', postTitle.textContent);
            return postTitle;
        }
        
        // 描述文本
        const description = findMatchingElement(node, 'div.community-details-heading p, div.community-details p, div.wiki-page-content, div[data-click-id="text"]');
        if (description) {
            debugLog('Reddit', '翻译描述文本', description.textContent?.substring(0, 50) + '...');
            return description;
        }
        
        // Wiki内容
        const wikiContent = findMatchingElement(node, 'div.md-container div.md, div.md');
        if (wikiContent) {
            debugLog('Reddit', '翻译Wiki内容', wikiContent.textContent?.substring(0, 50) + '...');
            return wikiContent;
        }
        
        // 社区描述
        const communityDescription = findMatchingElement(node, 'div[data-click-id="about"] h2, div[data-redditstyle="true"] h2');
        if (communityDescription) {
            debugLog('Reddit', '翻译社区描述', communityDescription.textContent);
            return communityDescription;
        }
        
        // 社区规则
        const communityRules = findMatchingElement(node, 'div.rules-list div.rule-item div.rule-item-body, div.rule-item p');
        if (communityRules) {
            debugLog('Reddit', '翻译社区规则', communityRules.textContent);
            return communityRules;
        }
        
        // 帖子卡片内容
        const postCard = findMatchingElement(node, 'div[data-testid="post-title"], div.Post h3');
        if (postCard) {
            debugLog('Reddit', '翻译帖子卡片', postCard.textContent);
            return postCard;
        }
        
        // 公告内容
        const announcement = findMatchingElement(node, 'div[data-testid="content"], div.announcement');
        if (announcement) {
            debugLog('Reddit', '翻译公告内容', announcement.textContent?.substring(0, 50) + '...');
            return announcement;
        }
        
        // 默认不翻译
        return false;
    },
    ['news.ycombinator.com']: (node: any) => {
        // 判断是否应该跳过该节点
        if (shouldSkipHNElement(node)) {
            return { skip: true };
        }
        
        // 帖子标题
        const storyTitle = findMatchingElement(node, 'td.title a.titlelink');
        if (storyTitle) return storyTitle;
        
        // 评论内容
        const comment = findMatchingElement(node, 'div.comment span.commtext');
        if (comment) return comment;
        
        // 帖子文本
        const storyText = findMatchingElement(node, 'div.toptext');
        if (storyText) return storyText;
        
        // 用户简介
        const userAbout = findMatchingElement(node, 'td.default');
        if (userAbout) return userAbout;
        
        // 默认不翻译
        return false;
    }
}

/**
 * 判断是否应该跳过Twitter网站上的特定元素
 */
function shouldSkipTwitterElement(node: any): boolean {
    // 检查是否为特殊内容（URL、邮箱、用户名等）
    if (node.textContent && isSpecialContent(node.textContent)) {
        debugLog('Twitter', '特殊内容', node.textContent);
        return true;
    }

    // 如果当前节点或其祖先节点匹配这些选择器，则跳过
    const skipSelectors = [
        // 侧边栏导航
        // 'nav[aria-label="Primary"]',
        'div[data-testid="sidebarColumn"]',
        // 趋势栏
        'div[aria-label="Timeline: Trending now"]',
        'aside[aria-label="Who to follow"]',
        // 搜索栏
        'div[data-testid="SearchBox_Search_Input"]',
        // 各种按钮和UI元素
        'div[role="button"]',
        'div[data-testid="BottomBar"]',
        // 未展开的帖子操作区域
        'div[role="group"][aria-label]',
        // 推荐关注
        'div[data-testid="suggestedUserHover"]',
        // 各种图标和操作按钮
        'div[aria-label*="icon"]',
        'div[data-testid*="icon"]',
        // 顶部应用栏
        'header[role="banner"]',
        // 字数限制计数器
        'div[data-testid="characterCount"]',
        // 用户名称相关
        'div[data-testid="User-Name"]',
        'div[data-testid="UserName"]',
        'span[data-testid="tweetText"] span.r-bcqeeo',
        // 用户ID和用户名相关
        'div[data-testid="HoverCard"]',
        'div[data-testid="UserCell"]',
        'a[role="link"][href*="/status/"]',
        // 关注按钮
        'div[role="button"][data-testid="follow"]',
        'div[role="button"][data-testid="unfollow"]',
        // 包含"关注"文本的元素
        'div[dir="auto"][id^="id__"]'
    ];

    // 检查当前节点是否匹配跳过选择器
    for (const selector of skipSelectors) {
        if (node.matches?.(selector)) {
            debugLog('Twitter', '选择器匹配跳过', selector, node.textContent);
            return true;
        }
    }
    
    // 检查节点的类名、属性等特征
    const nodeTag = node.tagName?.toLowerCase();
    if (nodeTag === 'svg' || nodeTag === 'path' || nodeTag === 'g') {
        debugLog('Twitter', 'SVG元素跳过', node.textContent);
        return true;
    }

    // 检查是否为操作按钮文本（点赞、转发、评论等）
    if (node.textContent?.trim().match(/^(\d+|Like|Reply|Retweet|Share)$/)) {
        debugLog('Twitter', '操作按钮跳过', node.textContent);
        return true;
    }
    
    // 检查是否为用户名或用户ID
    const textContent = node.textContent?.trim();
    if (textContent) {
        // 检查是否为用户名格式
        if (textContent.startsWith('@')) {
            debugLog('Twitter', '用户名跳过', node.textContent);
            return true;
        }
        
        // 检查是否为用户ID格式 
        if (textContent.startsWith('id@')) {
            debugLog('Twitter', '用户ID跳过', node.textContent);
            return true;
        }
        
        // 检查是否包含关注字样
        if (textContent.includes('关注') || textContent.includes('Follow')) {
            debugLog('Twitter', '关注按钮跳过', node.textContent);
            return true;
        }
        
        // 检查是否为Twitter用户名标签
        if (/^([A-Za-z0-9_]{1,15})$/.test(textContent)) {
            debugLog('Twitter', '用户名标签跳过', node.textContent);
            return true;
        }
    }
    
    // 检查常见的Twitter UI元素类名
    const classList = node.classList;
    if (classList) {
        // Twitter常用的UI类名前缀
        for (const className of classList) {
            if (className.startsWith('r-') || className.startsWith('css-')) {
                // 进一步检查节点内容是否为纯UI元素
                const text = node.textContent?.trim();
                if (!text || text.length < 10) {
                    debugLog('Twitter', 'UI元素跳过', node.textContent);
                    return true;
                }
            }
        }
    }
    
    // 检查ID属性
    if (node.id && node.id.startsWith('id__')) {
        debugLog('Twitter', 'ID属性跳过', node.textContent);
        return true;
    }
    
    return false;
}

/**
 * 判断是否应该跳过GitHub网站上的特定元素
 */
function shouldSkipGitHubElement(node: any): boolean {
    // 检查是否为特殊内容（URL、邮箱、用户名等）
    if (node.textContent && isSpecialContent(node.textContent)) {
        debugLog('GitHub', '特殊内容跳过', node.textContent);
        return true;
    }
    
    // 判断是否为目录名称或路径
    if (isGitHubPathOrFileName(node)) {
        debugLog('GitHub', '目录/文件名跳过', node.textContent);
        return true;
    }
    
    // 检查是否为GitHub特定的标签文本
    const gitHubLabels = [
        'bug', 'feature', 'enhancement', 'documentation', 'duplicate', 'good first issue',
        'help wanted', 'invalid', 'question', 'wontfix', 'dependencies', 'security',
        'enhancement', 'open', 'closed', 'merged', 'draft', 'done', 'in progress',
        'pending', 'fixed', 'resolved', 'won\'t fix', 'needs review', 'approved',
        'blocked', 'stale', 'needs work', 'ready for review', 'needs more information',
        'enhancement', 'frontend', 'backend', 'api', 'ui', 'ux', 'refactor', 'test',
        'needs tests', 'ready for work', 'wip', 'top priority', 'low priority', 'medium priority',
        'high priority', 'work in progress', 'needs investigation', 'feature request',
        'discussion', 'breaking change', 'needs triage'
    ];
    
    // GitHub状态文本
    const gitHubStatusTexts = [
        'Open', 'Closed', 'Merged', 'Draft', 'Pending', 'Approved',
        'Changes requested', 'Review required', 'Needs work', 'Ready for review',
        'Assignee', 'Author', 'Changed', 'Comments', 'Commits', 'Conversation',
        'Files changed', 'Participants', 'Reviewers', 'Unresolved conversations',
        'View changes', 'Clone', 'Code', 'Contributors', 'Raw', 'Blame', 'History',
        'is:issue', 'is:pr', 'is:open', 'is:closed', 'state:open', 'state:closed',
        'No wrap', 'Soft wrap', 'Set status'
    ];
    
    // 如果节点文本是GitHub标签或状态文本，跳过翻译
    if (node.textContent) {
        const text = node.textContent.trim();
        
        // 检查是否为GitHub Label文本
        for (const label of gitHubLabels) {
            if (text.toLowerCase() === label.toLowerCase()) {
                debugLog('GitHub', 'GitHub Label跳过', text);
                return true;
            }
        }
        
        // 检查是否为GitHub状态文本
        for (const status of gitHubStatusTexts) {
            if (text === status) {
                debugLog('GitHub', 'GitHub状态文本跳过', text);
                return true;
            }
        }
        
        // 检查是否为搜索过滤器语法
        if (/^([a-z]+):([a-z]+)(\s+([a-z]+):([a-z]+))*$/.test(text)) {
            debugLog('GitHub', '搜索过滤器语法跳过', text);
            return true;
        }
        
        // 检查是否为版本号或数字统计
        if (/^v?\d+\.\d+(\.\d+)?(-[a-z0-9.]+)?$/.test(text) || 
            /^\d+\s+(issues|pull requests|commits|stars|forks|watching)$/.test(text.toLowerCase())) {
            debugLog('GitHub', '版本号或数字统计跳过', text);
            return true;
        }
    }
    
    // 如果当前节点或其祖先节点匹配这些选择器，则跳过
    const skipSelectors = [
        // 导航栏和菜单
        'header.Header',
        'nav.js-repo-nav',
        'nav.menu',
        // 侧边栏
        'div.Layout-sidebar',
        // 表单元素
        'form',
        'input',
        'textarea',
        'button',
        // 代码块和相关元素
        'pre.highlight',
        'code',
        'table.highlight',
        'table.diff-table',
        // 分页和过滤器
        'div.pagination',
        'div.subnav',
        // 操作按钮区域
        'div.file-header',
        'div.file-actions',
        // 贡献图
        'div.js-calendar-graph',
        // 统计信息区
        'ul.repository-lang-stats-numbers',
        // 按钮文本
        'summary',
        'span.Counter',
        'div.controls',
        'span.js-hidden-pane-button',
        // 文件树
        'div.js-details-container Details',
        'div.Box-row',
        // 目录文件名相关
        'div.react-directory-filename-column',
        'div.react-directory-filename-cell',
        'div.react-directory-truncate',
        'div[class*="directory-"]', // 匹配所有包含directory-的类名
        'a[title][aria-label*="Directory"]',
        'a[title][aria-label*="File"]',
        // 底部
        'footer',
        // 用户名相关
        'a.author',
        'span.author',
        'a.user-mention',
        'a.commit-author',
        // Pull Request和Issue相关元素
        'div.merge-status-list',
        'div.js-navigation-container',
        'span.State', // PR状态标签
        'div.TimelineItem-badge',
        'div.color-fg-muted', // 灰色提示文本
        'div.Box-header',
        'div.js-details-container', // 折叠的详情容器
        'span.Link--secondary', // 次要链接文本
        // 仓库元数据
        'div.BorderGrid-row',
        
        // 仓库统计信息和小组件
        '.repo-language-color', // 语言颜色指示器
        'a.topic-tag', // 话题标签
        'span.d-inline-block.mr-3', // 内联统计块
        'a.Link--muted', // 次要链接
        'span.no-wrap', // 不换行的文本（通常是统计数据）
        '.octicon', // 图标
        'a.Link--primary > svg.octicon', // 主要链接中的图标
        'div.d-flex', // 弹性布局容器（常用于统计信息）
        'div.repo-and-owner', // 仓库和所有者信息
        
        // 仓库顶部区域
        'nav.js-repo-nav',
        'h1.flex-auto', // 标题
        'div.pagehead', // 页面头部
        'div.pagehead-actions', // 页面头部操作区
        'div.f4.mt-3', // 主要描述
        'h2#files', // 文件列表标题
        
        // 底部区域元素
        'div.commit-tease', // 提交信息预览
        'div.file-wrap', // 文件包装器
        'ul.repository-lang-stats-numbers', // 语言统计数字
        
        // 统计计数器和标签
        'span.Counter', // 计数器
        'a.UnderlineNav-item', // 导航下划线项
        'span[data-view-component="true"]', // 视图组件
        'span.color-fg-muted', // 灰色文本
        'span.text-bold', // 粗体文本
        
        // Issue/PR导航区域
        'div.tabnav', // 标签导航
        'div.tabnav-tabs', // 标签导航标签
        'div.table-list-header-toggle', // 表格列表头切换
        
        // 活动区域
        'div.Box-header',
        'div.TimelineItem-badge',
        
        // 包管理和发布区域
        'div.package-list', // 包列表
        'div.release-entry', // 发布条目
        
        // 通用组件
        'span.Label', // 标签
        'span.State', // 状态指示器
        'a.social-count', // 社交计数
        'a.pl-3', // 带左内边距的链接
        'div[role="grid"]', // 网格角色的div
        'div.flash', // 闪烁通知
        
        // 仓库信息卡片
        'div.Box-row--gray', // 灰色行
        'div.BorderGrid-cell', // 边框网格单元格
        
        // Issue和PR搜索结果页面的元素
        'div.issue-item', // Issue项
        'div.issue-item-header', // Issue项头部
        'span.opened-by', // 打开者标记
        'div.issue-item-body', // Issue项内容
        'div.issue-item-footer', // Issue项底部
        'span.issue-item-meta', // Issue项元数据
        'span.issue-meta-section', // Issue元数据区域
        'div.flex-auto.min-width-0', // 弹性自动最小宽度容器
        'div.issues-reset-query-wrapper', // 重置查询包装器
        'span.issue-keyword', // Issue关键字
        'a.issues-reset-query', // 重置查询链接
        'span.selected-text', // 选中文本
        'a.filter-item', // 过滤项
        'span.label', // 标签
        'span.tooltipped', // 提示标签
        'div.select-menu-item-text', // 选择菜单项文本
        'div.select-menu-filters', // 选择菜单过滤器
        'a.select-menu-item', // 选择菜单项
        'div.select-menu-list', // 选择菜单列表
        'nav.subnav', // 子导航
        'div.flex-column.flex-auto', // 弹性列自动容器
        'div.table-list-filters', // 表格列表过滤器
        'div.table-list-header', // 表格列表头
        'div.flex-items-center.flex-justify-between', // 弹性项目居中和两端对齐
        'div.js-issue-row', // Issue行
        'div.lh-default', // 默认行高
        'a.js-selected-navigation-item', // 选中的导航项
        'nav.d-flex', // 弹性导航
        'div.js-check-all-container', // 全选容器
        'div.flex-shrink-0', // 弹性收缩为0
        'div.timeline-comment-header', // 时间线评论头
        'div.comment-form-textarea', // 评论表单文本域
        'div.sidebar-notifications', // 侧边栏通知
        'div.gh-header', // GitHub头部
        'span.js-issue-title', // Issue标题
        'a.js-hard-refresh', // 强制刷新链接
        'div.Link--muted', // 次要链接
        
        // 新增：Issue标签元素
        'a.IssueLabel', // Issue标签链接
        'span.IssueLabel', // Issue标签
        'span.Label', // 通用标签
        'span.labels', // 标签容器
        'span.label-link', // 标签链接
        'a.label-link', // 标签链接
        'div.labels', // 标签容器
        'span.color-label', // 颜色标签
        'span.bg-yellow', // 黄色背景（通常用于标签）
        'span.bg-green', // 绿色背景
        'span.bg-red', // 红色背景
        'span.bg-purple', // 紫色背景
        'span.bg-blue', // 蓝色背景
        'span.text-green', // 绿色文本
        'span.text-red', // 红色文本
        'span.text-gray', // 灰色文本
        'div.js-issue-labels', // Issue标签容器
        'div.js-issue-labels .labels a', // Issue标签链接
        'div.js-issue-labels .IssueLabel', // Issue标签
        'span.js-issue-labels', // Issue标签
        'span.issue-meta-section.ml-2.issue-label-group', // Issue标签组
        'span.color-fg-danger', // 危险颜色（通常用于closed/rejected状态）
        'span.color-fg-success', // 成功颜色（通常用于open/accepted状态）
        'span.color-fg-muted', // 暗淡颜色（通常用于辅助信息）
        'span.color-fg-done', // 完成颜色
    ];

    // 检查当前节点是否匹配跳过选择器
    for (const selector of skipSelectors) {
        if (node.matches?.(selector)) {
            debugLog('GitHub', '选择器匹配跳过', selector, node.textContent);
            return true;
        }
    }
    
    // 检查节点的类名是否包含特定关键字
    const skipClassKeywords = [
        'octicon', 'anim-', 'btn', 'menu', 'icon', 'Avatar', 'repo', 
        'branch', 'commits', 'issues', 'pull', 'directory', 'filename', 
        'Counter', 'topic-tag', 'social-count', 'State', 'Label', 'UnderlineNav',
        'IssueLabel', 'issue-keyword', 'issue-label', 'label-link', 'color-label',
        'js-issue-labels', 'issue-meta', 'bg-',  'color-text-'
    ];
    
    if (node.className && typeof node.className === 'string') {
        for (const keyword of skipClassKeywords) {
            if (node.className.includes(keyword)) {
                debugLog('GitHub', '类名关键字跳过', keyword, node.className);
                return true;
            }
        }
    }
    
    // 检查特定属性
    const skipAttributes = [
        'data-hovercard-type', 'data-issue-and-pr-hovercards-enabled',
        'data-issue-title', 'data-url', 'data-pjax', 'data-hotkey', 'data-target', 
        'data-filter-value', 'data-direction', 'data-state'
    ];
    
    for (const attr of skipAttributes) {
        if (node.hasAttribute && node.hasAttribute(attr)) {
            debugLog('GitHub', '属性匹配跳过', attr);
            return true;
        }
    }
    
    // 检查是否为用户名或@提及
    if (node.textContent?.trim().startsWith('@')) {
        debugLog('GitHub', '用户名@提及跳过', node.textContent);
        return true;
    }
    
    // 忽略代码片段
    if (node.tagName?.toLowerCase() === 'pre' || node.tagName?.toLowerCase() === 'code') {
        debugLog('GitHub', '代码片段跳过', node.tagName);
        return true;
    }
    
    // 忽略图标
    if (node.tagName?.toLowerCase() === 'svg') {
        debugLog('GitHub', 'SVG图标跳过');
        return true;
    }
    
    // 检查是否为统计数字和计数（例如：16.3k stars, 854 watching等）
    const statCountPattern = /^\s*\d+(\.\d+)?[kKmMbB]?\s*(stars|watching|forks|views|issues|pull|commits|watchers)?\s*$/;
    if (statCountPattern.test(node.textContent?.trim())) {
        debugLog('GitHub', '统计数字跳过', node.textContent);
        return true;
    }
    
    // 检查是否为仓库标签文本
    if (node.className?.includes('topic-tag-link') || 
        node.className?.includes('topic-tag') || 
        node.parentElement?.className?.includes('topic-tag')) {
        debugLog('GitHub', '仓库标签跳过', node.textContent);
        return true;
    }
    
    // 检查是否为许可证文本
    if (/^Apache-[\d.]+|MIT|GPL-[\d.]+|BSD|LGPL/.test(node.textContent?.trim())) {
        debugLog('GitHub', '许可证文本跳过', node.textContent);
        return true;
    }
    
    return false;
}

/**
 * 判断节点是否包含GitHub的路径或文件名
 */
function isGitHubPathOrFileName(node: any): boolean {
    if (!node || !node.textContent) return false;
    
    const text = node.textContent.trim();
    if (!text) return false;
    
    // 检查节点是否为导航路径元素
    if (node.matches?.('nav[aria-label="Breadcrumb"]') || 
        node.matches?.('span.final-path') || 
        node.matches?.('span.js-repo-root') ||
        node.matches?.('a[title][aria-label*="Directory"]') ||
        node.matches?.('a[title][aria-label*="File"]')) {
        debugLog('GitHub', '路径导航元素', '匹配选择器', node.outerHTML?.substring(0, 100));
        return true;
    }
    
    // 检查父元素是否为目录元素
    let parent = node.parentElement;
    while (parent) {
        if (parent.matches?.('div.react-directory-filename-column') || 
            parent.matches?.('div.react-directory-filename-cell') ||
            parent.matches?.('div.react-directory-truncate') ||
            parent.className?.includes('directory-')) {
            debugLog('GitHub', '目录元素父节点', '匹配父元素选择器', parent.outerHTML?.substring(0, 100));
            return true;
        }
        parent = parent.parentElement;
    }
    
    // 检查是否为目录链接
    if (node.tagName?.toLowerCase() === 'a' && 
        node.getAttribute('aria-label')?.includes('Directory')) {
        debugLog('GitHub', '目录链接', 'aria-label包含Directory', node.getAttribute('aria-label'));
        return true;
    }
    
    // 检查是否为常见目录或文件名
    if (/^\.github|^src\/|^test\/|^docs\/|^\.gitignore$|^LICENSE$|^README\.md$|^CHANGELOG\.md$|^package\.json$|^Dockerfile$/i.test(text)) {
        // 如果当前节点是链接或者在文件列表中
        if (node.tagName?.toLowerCase() === 'a' || 
            node.parentElement?.matches?.('div.Box-row')) {
            debugLog('GitHub', '常见目录或文件名', text);
            return true;
        }
    }
    
    // 检查是否为路径格式（包含/的短文本）
    if (text.includes('/') && text.length < 100 && 
        !/\s/.test(text) && // 不包含空格
        !/[，。？！；：""''（）【】「」『』〔〕]/.test(text)) { // 不包含中文标点
        debugLog('GitHub', '路径格式文本', text);
        return true;
    }
    
    // 检查是否为常见的开发相关文件扩展名
    if (/\.(js|ts|jsx|tsx|css|scss|html|json|md|py|java|go|rs|c|cpp|h|hpp|rb|php|sh|bat|cmd|yaml|yml|xml)$/i.test(text)) {
        debugLog('GitHub', '文件扩展名匹配', text);
        return true;
    }
    
    // 检查是否为Issue/PR编号格式
    if (/^#\d+$/.test(text) || /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+#\d+$/.test(text)) {
        debugLog('GitHub', 'Issue/PR编号', text);
        return true;
    }
    
    return false;
}

/**
 * 判断是否应该跳过Stack Overflow网站上的特定元素
 */
function shouldSkipStackOverflowElement(node: any): boolean {
    // 如果当前节点或其祖先节点匹配这些选择器，则跳过
    const skipSelectors = [
        // 导航栏
        'nav.s-topbar',
        'div.s-topbar',
        // 侧边栏
        'div.s-sidebarwidget',
        // 表单元素
        'form',
        'input',
        'textarea',
        'button',
        // 代码块
        'pre.s-code-block',
        'code',
        // 操作按钮
        'div.js-voting-container',
        'div.js-post-menu',
        // 链接和标签
        'div.post-taglist',
        'div.module.community-bulletin',
        // 统计信息
        'div.-flair',
        'div.s-stats',
        'div.s-badge',
        // 页脚
        'footer',
        'div.site-footer',
    ];
    
    // 检查当前节点是否匹配跳过选择器
    for (const selector of skipSelectors) {
        if (node.matches?.(selector)) return true;
        
        // 检查祖先节点
        let parent = node.parentElement;
        while (parent) {
            if (parent.matches?.(selector)) return true;
            parent = parent.parentElement;
        }
    }
    
    // 检查节点的类名是否包含特定关键字
    const skipClassKeywords = ['js-', 'icon', 'btn', 'badge', 'vote', 'tag', 's-btn', 'vote-count'];
    
    if (node.className && typeof node.className === 'string') {
        for (const keyword of skipClassKeywords) {
            if (node.className.includes(keyword)) return true;
        }
    }
    
    // 忽略代码片段
    if (node.tagName?.toLowerCase() === 'pre' || node.tagName?.toLowerCase() === 'code') return true;
    
    // 忽略图标
    if (node.tagName?.toLowerCase() === 'svg') return true;
    
    return false;
}

/**
 * 判断是否应该跳过Medium网站上的特定元素
 */
function shouldSkipMediumElement(node: any): boolean {
    // 如果当前节点或其祖先节点匹配这些选择器，则跳过
    const skipSelectors = [
        // 导航栏和工具栏
        'nav',
        'div.metabar',
        'div.js-metabar',
        // 侧边栏 
        'div.js-sidebarContainer',
        'div.js-sidebar',
        // UI元素
        'button',
        'input',
        'textarea',
        // 代码块
        'pre',
        'code',
        // 底部元素
        'footer',
        // 作者资料卡
        'div.pw-multi-author-card',
        // 推荐文章卡片上的标题/描述以外的内容
        'div.pw-card-body div.pw-card-description ~ *',
        // 分享按钮和响应按钮
        'div.pw-post-actions',
        'div.pw-responses-header',
    ];
    
    // 检查当前节点是否匹配跳过选择器
    for (const selector of skipSelectors) {
        if (node.matches?.(selector)) return true;
        
        // 检查祖先节点
        let parent = node.parentElement;
        while (parent) {
            if (parent.matches?.(selector)) return true;
            parent = parent.parentElement;
        }
    }
    
    // 检查节点的类名是否包含特定关键字
    const skipClassKeywords = ['js-', 'btn', 'button', 'u-', 'overlay', 'postActionsBar'];
    
    if (node.className && typeof node.className === 'string') {
        for (const keyword of skipClassKeywords) {
            if (node.className.includes(keyword)) return true;
        }
    }
    
    // 忽略代码片段
    if (node.tagName?.toLowerCase() === 'pre' || node.tagName?.toLowerCase() === 'code') return true;
    
    // 忽略图片图标
    if (node.tagName?.toLowerCase() === 'svg' || node.tagName?.toLowerCase() === 'img') return true;
    
    return false;
}

/**
 * 判断是否应该跳过Reddit网站上的特定元素
 */
function shouldSkipRedditElement(node: any): boolean {
    // 检查是否为特殊内容（URL、邮箱、用户名等）
    if (node.textContent && isSpecialContent(node.textContent)) {
        debugLog('Reddit', '特殊内容跳过', node.textContent);
        return true;
    }
    
    // 处理帖子标题中的屏幕阅读器内容
    if (node.tagName?.toLowerCase() === 'faceplate-screen-reader-content') {
        debugLog('Reddit', '屏幕阅读器内容跳过', node.textContent);
        return true;
    }
    
    // 处理帖子中的时间标签
    if (node.tagName?.toLowerCase() === 'time') {
        debugLog('Reddit', '时间标签跳过', node.textContent);
        return true;
    }
    
    // 如果当前节点或其祖先节点匹配这些选择器，则跳过
    const skipSelectors = [
        // 导航栏和头部
        'header', 
        'div._3Qx5bBCG_O8wVZee9J-KyJ', // Reddit的头部容器
        'div._1x6pySZ2CoUnAfsFhGe7J1', // 导航栏
        'div._1QhgSEQa6-vyHBHcV0rygZ', // 顶部横幅
        'nav, div[data-testid="subreddit-header"]', // 导航区域
        'div._3ozFtOe6WpJEMUtxDOIvtU', // 菜单条
        'div._2QZ7T4uAFMs_N83BZcN-Em', // 排序栏
        
        // Reddit新UI元素
        'faceplate-timeago', // 时间显示组件
        'a[data-ks-id]', // 帖子链接
        'shreddit-post[data-ks-item]', // 帖子组件
        'a[slot="full-post-link"]', // 完整帖子链接
        'span[slot="credit-bar"]', // 信用栏
        'shreddit-post-flair', // 帖子标签
        'shreddit-join-button', // 加入按钮
        'shreddit-post-overflow-menu', // 溢出菜单
        'shreddit-async-loader', // 异步加载器
        'faceplate-hovercard', // 悬停卡片
        'faceplate-tracker', // 跟踪器
        'faceplate-number', // 数字格式化组件
        'shreddit-distinguished-post-tags', // 特殊帖子标签
        
        // 侧边栏
        'div._1OVBBWLtHoSPfGCRaPzpTf', // 侧边栏容器
        'div.wBtTDilkW_zr1D60d6V2Z', // 侧边栏组件
        'div._3Qkp11fjcAw9I9wtLo8frE', // 边栏卡片
        'div._1HSQGYlfPWzs40LP8sZqzT', // 社区边栏
        'div._2vEf-C2keJaBMY9qk_BxVn', // 侧边栏块
        'div._3Qkp11fjcAw9I9wtLo8frE', // 社区信息卡
        'div._2QmHYFeMADTpuXJtd36LQs', // 边栏模块
        
        // 表单元素
        'form', 'input', 'textarea', 'button',
        'button._3QMG29bQNj9RUoGMvSHpZg', // 主要按钮
        'button._10K5i7NW6qcm-UoCtpB3aK', // 次要按钮
        'div._3QMG29bQNj9RUoGMvSHpZg, div._10K5i7NW6qcm-UoCtpB3aK', // 按钮容器
        
        // 帖子操作区
        'div._1ixsU4oQRnNfZ91jhBU74y', // 投票区
        'div._3-SW6hQX6gXK9G4FM74obr', // 评论操作区
        'div._2hw0iZ3L5x8UbnfX8ZDKb', // 操作按钮组
        'div[data-testid="post-comment-header"]', // 评论头部
        'div[data-click-id="upvote"]', // 投票按钮
        'div[data-click-id="downvote"]', // 踩按钮
        'div[data-click-id="share"]', // 分享按钮
        'div[data-click-id="comments"]', // 评论按钮
        
        // Reddit特定视图元素
        'div[data-post-click-location="text-body"]', // 帖子正文点击区域
        'div.md.feed-card-text-preview', // 帖子预览
        'div#feed-post-credit-bar', // 帖子信用栏
        'span.created-separator', // 创建分隔符
        'span.inline-block.my-0.created-separator', // 分隔符
        'div[data-testid="post-content"]', // 帖子内容
        
        // 投票和互动小组件 - 从截图中可见的元素
        'button._2pFdCpgBihIaYh9DSMWBIu', // 通用按钮
        'div._1E9mcoVn4MYnuBQSVDt1gC', // 投票区域容器
        'span._vaFo96phV6L5Hltvwcox', // 投票计数元素
        'div._3-SW6hQX6gXK9G4FM74obr', // 操作按钮区
        'div._3Qkp11fjcAw9I9wtLo8frE', // 帖子信息卡
        'div._2X6EB3ZhEeXCh1eIVA64XM, div._1hwEKkB_38tIoal6fcdrt9', // 内置小组件
        'div._3nSp9cdBpqL13CqjdMr2L_', // 统计信息元素
        'div._2FKpII1jz0h6xCAw1kQAvS, div._2xLbdLcm9WYMj6tMTDwBmf', // 互动区域
        'div._3U_7i38RDFqmOFXMuRZYvZ, div._VmOLt6lJfSjP8Pr5DL9T', // 分享和存储按钮
        
        // Reddit新版统计元素
        'span[data-testid="community-hover-card:active-count"]', // 社区活跃用户计数
        'span.bg-kiwigreen-400', // 在线状态指示器
        'span.text-12.leading-4.text-neutral-content-weak', // 状态文本
        
        // 界面控制元素
        'a[href="/settings"]', // 设置链接
        'div[role="menu"]', // 菜单角色元素
        'div[role="button"]', // 按钮角色元素
        'div._JRBNstMcGxbZUxrrIKXe, div._2IHh1GBfUxJVQQX0dJvAEf', // 折叠/展开控制
        'div._3MknXZVbkWU8JL9XGlzASi, div._3Z6MIaeww5FJSez7H2YWXi', // 滚动控制
        'div[data-adclicklocation="top_bar"]', // 广告位置属性
        'a[data-click-id="subreddit"]', // 社区链接控件
        
        // 广告
        'div.promotedlink', 'div._3Qkp11fjcAw9I9wtLo8frE div._2vEf-C2keJaBMY9qk_BxVn',
        'div[data-before-content="advertisement"]', // 广告标记
        'div[data-testid="post-container"][data-promoted="true"]', // 推广帖子
        'div[data-testid="post"][data-promoted="true"]', // 另一种推广帖子
        'div.ad-container, div.AdPlace', // 广告容器
        
        // 搜索栏
        'div._2dkUkgReBsuY2IHM9aAHMx', // 搜索栏
        'input[name="q"]', // 搜索输入框
        'div._1LganuXpbKgkYX39pbmrCl, form._1QxZxZ9ntXPkuXMnfDTHzH', // 搜索表单元素
        
        // 底部
        'footer', 'div._3w_665DK_NH7yIsRMuZkqB',
        'div._3Wl-riAhLCZuDLzWNbD_z6', // 底部导航
        'div._3qX0zy2NNkra76bgyHbrcR, div._10YWGZZj2W-2J7T-IJVVNU', // 底部链接组
        
        // 用户相关
        'a[data-testid="post_author_link"]',
        'a.author', 'span.author',
        'a[data-testid="comment_author_link"]',
        'div._2mHuuvyV9doV3zwbZPtIPG', // 用户信息栏
        'a._3BcIEQadBHDKnV8E-qUMtJ', // 用户链接
        'div._23wugcdiaj44hdfugIAlnX', // 用户标记
        'div[data-testid="comment_author"]', // 评论作者
        'span._12nHw-MGuz_r1dQx4wxxAf, a._12nHw-MGuz_r1dQx4wxxAf', // 用户名显示元素
        'div[data-testid="subreddit-sidebar"] div._3ryJoIoycVkI7DggMcJiKM', // 社区用户栏
        
        // 统计信息
        'span._vaFo96phV6L5Hltvwcox', // 投票数
        'span._1jNPl3YUk6zbpLWdjaJT1r', // 评论数
        'div._2mHuuvyV9doV3zwbZPtIPG', // 时间戳
        'div._2ETuFsOP3jKbVR95iRImaDvU-g6W3dAQ', // 帖子信息栏
        'div._3-SW6hQX6gXK9G4FM74obr span', // 操作按钮文本
        'div._3XFx6CfPlg-4Usgxm0gK8R, div.BilRyRl5iuFY2VJoNfVz0', // 统计区域
        'div._11dVAO6CK-nOlDyrYr6tsX, div._3ioGMz1QkHcUCVgLx3kzOQ', // 计数
        'div._2hYRM7d0BaB17cCB3FGmm9', // 时间计数
        
        // 横幅和通知
        'div._3q-XSJ2JokLxfTqcOzQxzf', // 新帖子通知
        'div[data-redditstyle="true"] div._1DooEIX-1Nj5rweIc5cw_E', // 常见的横幅
        'div._31L5xyMG1DzvGnqhbHkKV4, div._3NpZ0JJ2ZEBZXLpt7AMxgW', // 通知条
        'div._3Im6OD67aKo33nql4FpSp0, div._2zeq1aXKDHDDXUNXAJyRVk', // 系统消息
        
        // 其他Reddit特定元素
        'div._2vkeRJojnV7cb9pMlPHy7d', // Join按钮
        'div[data-testid="frontpage-sidebar"]', // 首页侧边栏
        'div._2vEf-C2keJaBMY9qk_BxVn button', // 侧边栏按钮
        'div._3Qx5bBCG_O8wVZee9J-KyJ', // 头部区域
        'div[data-testid="subreddit-name"]', // 社区名区域
        'div._2x02fRB8KYZPG74bIR0jpe', // 帖子工具栏
        'div[data-test-id="post-content"] video', // 视频内容
        'div._3gbb_EMFXxTYrxDZ2kusIp', // 图片帖子
        'div._1sDtEhccxFpHDn2ruDutJe', // 链接预览
        'div._2wKMjKBrZFbRMP33ghA1uI', // 投票条
        'div._3_HlHJ56dAfStT19Jgl1bF', // 投票按钮组
        'div._pGofQ7zn0wPWxvde-6HDL', // 各种徽章
        'div._33axOHPa8DzNnTmwzen-wO', // 奖励徽章
        'div._2hgXdc8jVQaXYAXvnqVBBh, div._1yxKmMhLFJJp2CfU1jFZz5', // 热门/新帖子标签
        'div._2FbYTP2kJW6pyJnjwLWr8f, div._3bl3XkXsAgnvhW0Ghm6Dh-', // 首页主题控制栏
    ];
    
    // 检查当前节点是否匹配跳过选择器
    for (const selector of skipSelectors) {
        if (node.matches?.(selector)) {
            debugLog('Reddit', '选择器匹配跳过', selector, node.textContent);
            return true;
        }
    }
    
    // 检查数据属性
    const skipDataAttributes = [
        'click-id="share"', 'click-id="upvote"', 'click-id="downvote"', 'click-id="award"', 
        'click-id="comments"', 'click-id="save"', 'click-id="vote-arrows"', 'click-id="media"',
        'adclicklocation', 'promoted="true"', 'test-id="comment-top-meta"'
    ];
    
    for (const attr of skipDataAttributes) {
        if (node.hasAttribute && node.hasAttribute(attr)) {
            debugLog('Reddit', '数据属性匹配跳过', attr);
            return true;
        }
    }
    
    // 检查节点的类名是否包含特定关键字
    const skipClassKeywords = [
        '_', 'icon', 'Button', 'vote', 'score', 'flair', 'author',
        'award', 'caret', 'expando', 'menu', 'hover', 'promoted',
        'badge', 'thumbnail', 'timestamp', 'banner', 'hover', 'nav',
        'submit', 'upvote', 'downvote', 'premium', 'moderator', 'join',
        'subscribe', 'share', 'save', 'expand', 'collapse', 'points'
    ];
    
    if (node.className && typeof node.className === 'string') {
        for (const keyword of skipClassKeywords) {
            if (node.className.includes(keyword) && node.textContent?.length < 20) {
                debugLog('Reddit', '类名关键字跳过', keyword, node.className);
                return true;
            }
        }
    }
    
    // 检查是否为用户名格式
    const textContent = node.textContent?.trim();
    if (textContent) {
        // Reddit用户名格式 u/username
        if (/^u\/\w+$/.test(textContent)) {
            debugLog('Reddit', '用户名格式跳过', textContent);
            return true;
        }
        
        // 社区名格式 r/community
        if (/^r\/\w+$/.test(textContent)) {
            debugLog('Reddit', '社区名格式跳过', textContent);
            return true;
        }
        
        // 跳过投票计数
        if (/^\d+(\.\d+)?[kKmM]?$/.test(textContent) || /^[+-]?\d+(\.\d+)?[kKmM]?$/.test(textContent)) {
            debugLog('Reddit', '投票计数跳过', textContent);
            return true;
        }
        
        // 跳过时间戳格式
        if (/^(Posted )?\d+ (minutes|hours|days|weeks|months|years) ago$/.test(textContent)) {
            debugLog('Reddit', '时间戳跳过', textContent);
            return true;
        }
        
        // 跳过评论计数
        if (/^\d+(\.\d+)?[kKmM]? comments?$/.test(textContent)) {
            debugLog('Reddit', '评论计数跳过', textContent);
            return true;
        }
        
        // 统计数字格式: "19K", "1K", 等
        if (/^\s*\d+[KkMmBb]?\s*$/.test(textContent)) {
            debugLog('Reddit', '统计数字跳过', textContent);
            return true;
        }
        
        // 跳过Reddit常用UI文本
        const skipPhrases = [
            'upvote', 'downvote', 'share', 'save', 'hide', 'report', 'crosspost',
            'award', 'reply', 'give award', 'hide', 'comments', 'comment',
            'best', 'top', 'new', 'controversial', 'old', 'random', 'live',
            'hot', 'rising', 'gilded', 'wiki', 'mod', 'moderator', 'approved',
            'submission', 'removed', 'spam', 'reported', 'locked', 'unlocked',
            'pinned', 'unpinned', 'archived', 'unarchived', 'distinguished',
            'undistinguished', 'spoiler', 'nsfw', 'upvoted', 'downvoted',
            'follow', 'join', 'create post', 'community options', 'sort by',
            'join', 'leave', 'view all comments', 'more comments', 'continue this thread',
            'copy link', 'mark as spoiler', 'delete', 'edit', 'embed', 
            'follow thread', 'add to collection', 'post insights', 'view poll',
            'download', 'open in app', 'view community'
        ];
        
        for (const phrase of skipPhrases) {
            if (textContent.toLowerCase() === phrase) {
                debugLog('Reddit', '常用UI文本跳过', textContent);
                return true;
            }
        }
    }
    
    // 忽略代码片段
    if (node.tagName?.toLowerCase() === 'pre' || node.tagName?.toLowerCase() === 'code') {
        debugLog('Reddit', '代码片段跳过');
        return true;
    }
    
    // 忽略图片和图标
    if (node.tagName?.toLowerCase() === 'svg' || node.tagName?.toLowerCase() === 'img') {
        debugLog('Reddit', '图片/图标跳过');
        return true;
    }
    
    return false;
}

/**
 * 判断是否应该跳过Hacker News网站上的特定元素
 */
function shouldSkipHNElement(node: any): boolean {
    // 如果当前节点或其祖先节点匹配这些选择器，则跳过
    const skipSelectors = [
        // 顶部和底部导航
        'td.hnnavbar',
        'span.pagetop',
        // 各种链接区
        'td.subtext',
        // 用户信息
        'span.hnuser',
        'span.age',
        // 表单元素
        'form',
        'input',
        'textarea',
    ];
    
    // 检查当前节点是否匹配跳过选择器
    for (const selector of skipSelectors) {
        if (node.matches?.(selector)) return true;
        
        // 检查祖先节点
        let parent = node.parentElement;
        while (parent) {
            if (parent.matches?.(selector)) return true;
            parent = parent.parentElement;
        }
    }
    
    // 检查节点文本是否为纯按钮/链接文本
    const skipTexts = ['reply', 'flag', 'favorite', 'hide', 'past', 'web', 'comments', 'ask', 'show', 'jobs', 'submit'];
    if (node.textContent && skipTexts.includes(node.textContent.trim().toLowerCase())) {
        return true;
    }
    
    return false;
}

/**
 * 判断是否应该跳过YouTube网站上的特定元素
 */
function shouldSkipYouTubeElement(node: any): boolean {
    // 检查是否为特殊内容（URL、邮箱、用户名等）
    if (node.textContent && isSpecialContent(node.textContent)) {
        debugLog('YouTube', '特殊内容跳过', node.textContent);
        return true;
    }
    
    // 如果当前节点或其祖先节点匹配这些选择器，则跳过
    const skipSelectors = [
        // 导航和菜单相关
        'div#masthead-container', // 顶部导航栏
        'div#guide-content', // 左侧菜单
        'ytd-mini-guide-renderer', // 迷你导航
        'div#buttons', // 按钮区域
        'ytd-topbar-menu-button-renderer', // 顶部菜单按钮
        'ytd-guide-entry-renderer', // 导航入口
        'ytd-guide-section-renderer h3', // 导航区标题
        'div#channel-header', // 频道头部区域
        'div#channel-navigation', // 频道导航区域
        
        // 视频控制相关
        'div.ytp-chrome-bottom', // 播放器底部控制栏
        'div.ytp-chrome-top', // 播放器顶部控制栏
        'div.ytp-right-controls', // 右侧控制
        'div.ytp-left-controls', // 左侧控制
        'div.ytp-progress-bar-container', // 进度条容器
        'span.ytp-time-current', // 当前时间
        'span.ytp-time-duration', // 视频总时长
        'button.ytp-button', // 所有播放器按钮
        'div.ytp-chapter-container', // 章节容器
        
        // 统计和互动区域
        'div#info-contents ytd-video-primary-info-renderer div#top-level-buttons-computed', // 点赞/分享按钮
        'span#dot', // 分隔点
        'span.ytd-video-view-count-renderer', // 观看次数
        'span.ytd-video-owner-renderer', // 频道信息区域
        'div#owner', // 视频所有者区域
        'a.ytd-video-owner-renderer', // 频道链接
        'ytd-subscribe-button-renderer', // 订阅按钮
        'div.ytd-subscribe-button-renderer', // 订阅按钮渲染器
        'ytd-button-renderer', // 按钮渲染器
        'ytd-menu-renderer', // 菜单渲染器
        'ytd-badge-supported-renderer', // 徽章支持渲染器
        'div#sponsor-button', // 赞助按钮
        
        // 评论区控制元素
        'div#action-buttons', // 评论操作按钮
        'ytd-toggle-button-renderer', // 切换按钮
        'div#vote-count-middle', // 评论投票计数
        'ytd-comments-header-renderer', // 评论头部渲染器
        'div#title.ytd-comments-header-renderer', // 评论标题
        'span.ytd-comments-header-renderer', // 评论数量
        'ytd-sort-filter-sub-menu-renderer', // 评论排序选项
        'ytd-comment-action-buttons-renderer', // 评论操作按钮
        
        // 内容卡片和元数据
        'div.ytd-metadata-row-container-renderer', // 元数据行
        'div#subscribe-button', // 订阅按钮
        'span.ytd-channel-name', // 频道名称
        'div#owner-sub-count', // 订阅者数量
        'div.ytd-watch-metadata yt-formatted-string[is-empty]', // 空格式化字符串
        'ytd-metadata-row-renderer', // 元数据行
        'div#above-the-fold', // 页面顶部区域
        'div#primary-inner ytd-merch-shelf-renderer', // 商品架
        'div.ytd-structured-description-content-renderer', // 结构化描述内容
        'ytd-info-panel-content-renderer', // 信息面板内容
        'ytd-info-panel-container-renderer', // 信息面板容器
        
        // 缩略图和推荐视频信息
        'span.ytd-thumbnail-overlay-time-status-renderer', // 视频时长
        'span.ytd-video-meta-block', // 视频元数据块
        'div#metadata-line', // 元数据行
        'span.ytd-grid-video-renderer', // 网格视频渲染器
        'div#video-title.ytd-grid-video-renderer', // 视频网格标题
        'a.yt-simple-endpoint.ytd-grid-video-renderer', // 视频网格链接
        'ytd-thumbnail', // 缩略图
        'div#hover-overlays', // 悬停叠加层
        
        // 其他UI元素
        'button', // 所有按钮
        'yt-icon', // YouTube图标
        'a.yt-simple-endpoint[href^="/hashtag/"]', // 话题标签链接
        'a.yt-simple-endpoint[href^="/channel/"]', // 频道链接
        'div#text.ytd-channel-name', // 频道名文本
        'span.yt-core-attributed-string--link-inherit-color', // 特定格式化字符串
        'ytd-notification-topbar-button-renderer', // 通知按钮
        'ytd-searchbox', // 搜索框
        'ytd-dropdown-renderer', // 下拉菜单
        'ytd-live-chat-frame', // 直播聊天
        'ytd-playlist-header-renderer div#stats', // 播放列表统计数据
        'ytd-playlist-panel-renderer div#header-count', // 播放列表计数
        'ytd-playlist-panel-renderer div#play-button', // 播放列表播放按钮
        'ytd-playlist-panel-renderer a.ytd-playlist-panel-video-renderer', // 播放列表视频链接
        'ytd-playlist-byline-renderer', // 播放列表署名
    ];
    
    // 检查当前节点是否匹配跳过选择器
    for (const selector of skipSelectors) {
        if (node.matches?.(selector)) {
            debugLog('YouTube', '选择器匹配跳过', selector, node.textContent);
            return true;
        }
    }
    
    // 检查节点的类名是否包含特定关键字
    const skipClassKeywords = ['ytp-', 'button', 'badge', 'menu', 'selector', 'icon', 'thumbnail', 'avatar'];
    
    if (node.className && typeof node.className === 'string') {
        for (const keyword of skipClassKeywords) {
            if (node.className.includes(keyword)) {
                debugLog('YouTube', '类名关键字跳过', keyword, node.className);
                return true;
            }
        }
    }
    
    // 检查文本内容特征
    const textContent = node.textContent?.trim();
    if (textContent) {
        // 跳过纯数字、视图计数、日期等
        if (/^\d+(\.\d+)?[KMB]?$/.test(textContent)) {
            debugLog('YouTube', '数字计数跳过', textContent);
            return true;
        }
        
        // 跳过视频时长格式
        if (/^\d+:\d+$/.test(textContent) || /^\d+:\d+:\d+$/.test(textContent)) {
            debugLog('YouTube', '时间格式跳过', textContent);
            return true;
        }
        
        // 跳过视图计数和日期组合
        if (/^\d+(\.\d+)?[KMB]? views/.test(textContent) || 
            /\d+ (days|months|years) ago$/.test(textContent) ||
            /^\d+(\.\d+)?[KMB]? watching now$/.test(textContent)) {
            debugLog('YouTube', '视图计数/日期跳过', textContent);
            return true;
        }
        
        // 跳过YouTube常用单词和短语
        const skipPhrases = [
            'Subscribe', 'subscribed', 'subscribers', 'Join', 'Share', 'Save', 
            'Report', 'Download', 'Add to', 'Show more', 'Show less', 
            'Like', 'Dislike', 'Reply', 'Sort by', 'Top comments', 'Newest first',
            'Edit', 'View', 'playlist', 'Autoplay', 'Cast', 'Settings', 'Play',
            'Pause', 'Stream', 'Live', 'Premiere', 'Premieres', 'Premiered',
            'Skip', 'Next', 'Previous', 'Shuffle', 'Transcript', 'Captions',
            'Quality', 'Playback speed', 'More', 'Stats for nerds'
        ];
        
        for (const phrase of skipPhrases) {
            if (textContent.includes(phrase) && textContent.length < 30) {
                debugLog('YouTube', '特定短语跳过', phrase, textContent);
                return true;
            }
        }
        
        // 检查是否为频道名/@用户名
        if (/^@\w+$/.test(textContent) || 
            (textContent.startsWith('@') && textContent.length < 30)) {
            debugLog('YouTube', '频道/用户名跳过', textContent);
            return true;
        }
    }
    
    // 忽略图标和图像
    if (node.tagName?.toLowerCase() === 'svg' || node.tagName?.toLowerCase() === 'img') {
        debugLog('YouTube', '图标/图像跳过');
        return true;
    }
    
    return false;
}
