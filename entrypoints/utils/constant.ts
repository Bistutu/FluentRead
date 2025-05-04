import { services } from "./option";

// 常量工具类
export const urls: any = {
    [services.deepL]: "https://api-free.deepl.com/v2/translate",
    [services.openai]: "https://api.openai.com/v1/chat/completions",
    [services.moonshot]: "https://api.moonshot.cn/v1/chat/completions",
    [services.custom]: "https://localhost:11434/v1/chat/completions",
    [services.tongyi]: "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
    [services.zhipu]: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    [services.xiaoniu]: "https://api.niutrans.com/NiuTransServer/translationXML",
    [services.claude]: "https://api.anthropic.com/v1/messages",
    [services.baichuan]: "https://api.baichuan-ai.com/v1/chat/completions",
    [services.lingyi]: "https://api.lingyiwanwu.com/v1/chat/completions",
    [services.deepseek]: "https://api.deepseek.com/chat/completions",
    [services.jieyue]: "https://api.stepfun.com/v1/chat/completions",
    [services.yiyan]: {tokenUrl: "https://aip.baidubce.com/oauth/2.0/token"},
    [services.groq]: "https://api.groq.com/openai/v1/chat/completions",
    [services.cozecom]: "https://api.coze.com/open_api/v2/chat",
    [services.cozecn]: "https://api.coze.cn/open_api/v2/chat",
    [services.huanYuan]: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    [services.doubao]: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    [services.siliconCloud]: "https://api.siliconflow.cn/v1/chat/completions",
    [services.openrouter]: "https://openrouter.ai/api/v1/chat/completions",
    [services.grok]: "https://api.x.ai/v1/chat/completions",

    // [services.baidufree]:"https://fanyi.baidu.com/transapi"
    // [services.baidu]: "https://fanyi-api.baidu.com/api/trans/vip/translate",
    // [services.deepLx]: "http://localhost:1188/translate",
}

export const method = {POST: "POST", GET: "GET",};

export const constants = {
    // 键鼠事件
    DoubleClick: "DoubleClick",
    LongPress: "LongPress",
    MiddleClick: "MiddleClick",
    // 触屏设备事件
    TwoFinger: "TwoFinger",
    ThreeFinger: "ThreeFinger",
    FourFinger: "FourFinger",
    DoubleClickScreen: "DoubleClickScree",
    TripleClickScreen: "TripleClickScreen",
}

export const styles = {
    // 仅译文模式
    singleTranslation: 0,
    // 双语对照模式
    bilingualTranslation: 1,
}