import { services } from "./option";
import type { MiniMaxBillingPlan, MiniMaxRegion } from "./option";
import {DEFAULT_DEEPLX_ENDPOINT} from "./deeplx";

// MiniMax 的 OpenAI 兼容地址目前按区域区分；计费方案单独建模，用于
// Key/权益校验，也为未来两套方案出现不同端点保留明确的配置维度。
export const MINIMAX_ENDPOINTS: Record<MiniMaxBillingPlan, Record<MiniMaxRegion, string>> = {
    payg: {
        global: "https://api.minimax.io/v1/chat/completions",
        cn: "https://api.minimaxi.com/v1/chat/completions",
    },
    "token-plan": {
        global: "https://api.minimax.io/v1/chat/completions",
        cn: "https://api.minimaxi.com/v1/chat/completions",
    },
};

// 常量工具类
export const urls: any = {
    [services.deepL]: "https://api-free.deepl.com/v2/translate",
    [services.deeplx]: DEFAULT_DEEPLX_ENDPOINT,
    [services.openai]: "https://api.openai.com/v1/chat/completions",
    [services.azureOpenai]: "https://your-resource-name.openai.azure.com/openai/deployments/your-deployment-name/chat/completions?api-version=2024-02-15-preview",
    [services.moonshot]: "https://api.moonshot.cn/v1/chat/completions",
    [services.custom]: "https://localhost:11434/v1/chat/completions",
    [services.tongyi]: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    [services.zhipu]: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    [services.xiaoniu]: "https://api.niutrans.com/NiuTransServer/translationXML",
    [services.youdao]: "https://openapi.youdao.com/api",
    [services.tencent]: "https://tmt.tencentcloudapi.com/",
    [services.claude]: "https://api.anthropic.com/v1/messages",
    [services.baichuan]: "https://api.baichuan-ai.com/v1/chat/completions",
    [services.lingyi]: "https://api.lingyiwanwu.com/v1/chat/completions",
    [services.deepseek]: "https://api.deepseek.com/chat/completions",
    [services.infini]: "https://cloud.infini-ai.com/maas/v1/chat/completions",
    [services.minimax]: MINIMAX_ENDPOINTS.payg.cn,
    [services.jieyue]: "https://api.stepfun.com/v1/chat/completions",
    [services.yiyan]: "https://qianfan.bj.baidubce.com/v2/chat/completions",
    [services.groq]: "https://api.groq.com/openai/v1/chat/completions",
    [services.cozecom]: "https://api.coze.com/open_api/v2/chat",
    [services.cozecn]: "https://api.coze.cn/open_api/v2/chat",
    [services.huanYuan]: "https://api.tokenhub.tencent.com/v1/chat/completions",
    [services.huanYuanTranslation]: "https://hunyuan.tencentcloudapi.com/",
    [services.doubao]: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    [services.siliconCloud]: "https://api.siliconflow.cn/v1/chat/completions",
    [services.openrouter]: "https://openrouter.ai/api/v1/chat/completions",
    [services.grok]: "https://api.x.ai/v1/chat/completions",

    // [services.baidufree]:"https://fanyi.baidu.com/transapi"
    // [services.baidu]: "https://fanyi-api.baidu.com/api/trans/vip/translate",
}

export const method = {POST: "POST", GET: "GET",};

export const CONNECTION_TEST_MESSAGE = 'testTranslationService' as const;

// qwen3.8 预览模型属于百炼 Token Plan，使用独立的 OpenAI 兼容端点。
export const tongyiTokenPlanUrl = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions";

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

// 右键菜单ID常量
export const CONTEXT_MENU_IDS = {
    TRANSLATE_FULL_PAGE: 'fluent-read-translate-full-page',
}
