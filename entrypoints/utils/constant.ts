// 常量工具类

import {services} from "./option";

export const app = {
    version: "0.0.2",
}

export const urls = {
    [services.deepL]: "https://api-free.deepl.com/v2/translate",
    [services.openai]: "https://api.openai.com/v1/chat/completions",
    [services.moonshot]: "https://api.moonshot.cn/v1/chat/completions",
    [services.ollama]: "https://api.ollama.com/v1/chat/completions",
    [services.tongyi]: "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
    [services.zhipu]: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    [services.xiaoniu]: "https://api.niutrans.com/NiuTransServer/translationXML",
    [services.claude]: "https://api.anthropic.com/v1/messages",
    [services.baidu]: "https://fanyi-api.baidu.com/api/trans/vip/translate",
}

export const method = {POST: "POST", GET: "GET",};