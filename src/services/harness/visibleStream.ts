/**
 * @file src/services/harness/visibleStream.ts
 * 文件职责：从 B站模型的增量响应中提取用户可见正文，避免把偶发的思考标签内容显示到页面。
 * 主要内容：每次仅扫描新增片段与最多七字符的未决标签前缀，处理跨片段标签，并在结束时拒绝嵌套、缺失、未闭合标签和空正文。
 * 模块边界：每个生成调用创建独立状态，不持有请求或页面对象；结束原因、取消与用量统计由生成适配器管理。
 */
export function createBilibiliVisibleStream() {
    const opening = '<think>', closing = '</think>';
    let visible = '', pending = '', depth = 0, malformed = false;
    return {
        append(delta: string): string {
            const input = pending + delta;
            pending = '';
            let offset = 0;
            while (offset < input.length) {
                const tagStart = input.indexOf('<', offset);
                if (tagStart < 0) {
                    if (!depth) visible += input.slice(offset);
                    break;
                }
                if (!depth) visible += input.slice(offset, tagStart);
                if (input.startsWith(opening, tagStart)) {
                    if (depth) malformed = true;
                    depth += 1;
                    offset = tagStart + opening.length;
                } else if (input.startsWith(closing, tagStart)) {
                    if (!depth) malformed = true;
                    else depth -= 1;
                    offset = tagStart + closing.length;
                } else {
                    const tail = input.slice(tagStart, tagStart + closing.length);
                    if (opening.startsWith(tail) || closing.startsWith(tail)) {
                        pending = tail;
                        break;
                    }
                    if (!depth) visible += '<';
                    offset = tagStart + 1;
                }
            }
            return visible;
        },
        finish(): string {
            if (depth || pending || malformed || !visible.trim()) throw new Error('B站没有返回完整有效的讲解，请重试');
            return visible.trim();
        },
    };
}

