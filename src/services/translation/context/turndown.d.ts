/**
 * @file src/services/translation/context/turndown.d.ts
 *
 * 文件职责：为锁定的 Turndown 7.2.4 声明页面上下文适配器使用的最小类型契约。
 * 主要内容：声明构造选项、节点规则、Markdown 转换和保留节点接口；不包含第三方实现。
 * 模块边界：仅补齐未附带 TypeScript 声明的依赖类型，不引入运行时代码或扩大正文适配器的职责。
 */

declare module 'turndown' {
    interface Options {
        headingStyle?: 'setext' | 'atx';
        hr?: string;
        bulletListMarker?: '-' | '+' | '*';
        codeBlockStyle?: 'indented' | 'fenced';
        emDelimiter?: '_' | '*';
        preformattedCode?: boolean;
    }

    interface Rule {
        filter: string | string[] | ((node: HTMLElement) => boolean);
        replacement: (content: string, node: HTMLElement) => string;
    }

    export default class TurndownService {
        constructor(options?: Options);
        escape(value: string): string;
        turndown(value: string | HTMLElement): string;
        addRule(name: string, rule: Rule): this;
        keep(names: string[]): this;
        remove(names: string[]): this;
    }
}
