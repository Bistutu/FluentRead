import {services} from "../utils/option";
import microsoft from "./microsoft";
import freeTranslation from "./free-translation";
import deepl from "./deepl";
import deeplx from "./deeplx";
import custom from "./custom";
import tongyi from "./tongyi";
import zhipu from "./zhipu";
import gemini from "./gemini";
import google from "./google";
import xiaoniu from "./xiaoniu";
import youdao from "./youdao";
import tencent from "./tencent";
import claude from "./claude";
import common from "@/entrypoints/service/common";
import coze from "@/entrypoints/service/coze";
import deepseek from "./deepseek";
import newapi from "./newapi";
import azureOpenai from "./azure-openai";
import chromeTranslator from "./chrome-translator";
import hunyuanTranslation from "./hunyuan-translation";

type ServiceFunction = (message: any) => Promise<any>;
type ServiceMap = {[key: string]: ServiceFunction;};

export const _service: ServiceMap = {
    // 机器翻译
    [services.microsoft]: microsoft,
    [services.freeTranslation]: freeTranslation,
    [services.deepL]: deepl,
    [services.deeplx]: deeplx,
    [services.google]: google,
    [services.xiaoniu]: xiaoniu,
    [services.youdao]: youdao,
    [services.tencent]: tencent,
    [services.chromeTranslator]: chromeTranslator,

    // 大模型翻译
    [services.custom]: custom,
    [services.tongyi]: tongyi,
    [services.zhipu]: zhipu,
    [services.yiyan]: common,
    [services.gemini]: gemini,
    [services.claude]: claude,
    [services.infini]: common,
    [services.minimax]: common,
    [services.mimo]: common,
    [services.cozecom]: coze,
    [services.cozecn]: coze,
    [services.deepseek]: deepseek,
    [services.newapi]: newapi,
    // openai schema
    [services.openai]: common,
    [services.azureOpenai]: azureOpenai,
    [services.moonshot]: common,
    [services.baichuan]: common,
    [services.lingyi]: common,
    [services.jieyue]: common,
    [services.groq]: common,
    [services.huanYuan]: common,
    [services.huanYuanTranslation]: hunyuanTranslation,
    [services.doubao]: common,
    [services.siliconCloud]: common,
    [services.openrouter]: common,
    [services.grok]: common,
}
