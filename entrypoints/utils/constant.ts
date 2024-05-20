// 常量工具类

import {services} from "./option";

export const app = {
    version: "0.0.5",
}

export const urls = {
    [services.deepL]: "https://api-free.deepl.com/v2/translate",
    [services.deepLx]: "http://localhost:1188/translate",
    [services.openai]: "https://api.openai.com/v1/chat/completions",
    [services.moonshot]: "https://api.moonshot.cn/v1/chat/completions",
    [services.custom]: "https://localhost:11434/v1/chat/completions",
    [services.tongyi]: "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
    [services.zhipu]: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    [services.xiaoniu]: "https://api.niutrans.com/NiuTransServer/translationXML",
    [services.claude]: "https://api.anthropic.com/v1/messages",
    [services.baidu]: "https://fanyi-api.baidu.com/api/trans/vip/translate",
    [services.baichuan]: "https://api.baichuan-ai.com/v1/chat/completions",
    [services.lingyi]: "https://api.lingyiwanwu.com/v1/chat/completions",
    [services.deepseek]: "https://api.deepseek.com/chat/completions",
    [services.jieyue]:"https://api.stepfun.com/v1/chat/completions",
}

export const method = {POST: "POST", GET: "GET",};

export const constants = {
    DoubleClick : "DoubleClick",
    LongPress : "LongPress",
    MiddleClick : "MiddleClick",
}

export const styles = {
    // 仅译文
    translationOnly: 0,
    // 双语对照模式
    bilingualComparison: 1,
}