import {services} from "../utils/option";
import microsoft from "./microsoft";
import deepl from "./deepl";
import deeplx from "./deeplx";
import custom from "./custom";
import tongyi from "./tongyi";
import zhipu from "./zhipu";
import yiyan from "./yiyan";
import gemini from "./gemini";
import google from "./google";
import xiaoniu from "./xiaoniu";
import youdao from "./youdao";
import tencent from "./tencent";
import claude from "./claude";
import infini from "@/entrypoints/service/infini";
import minimax from "@/entrypoints/service/minimax";
import common from "@/entrypoints/service/common";
import coze from "@/entrypoints/service/coze";
import deepseek from "./deepseek";
import newapi from "./newapi";

type ServiceFunction = (message: any) => Promise<any>;
type ServiceMap = {[key: string]: ServiceFunction;};

export const _service: ServiceMap = {
    // 传统机器翻译
    [services.microsoft]: microsoft,
    [services.deepL]: deepl,
    [services.deeplx]: deeplx,
    [services.google]: google,
    [services.xiaoniu]: xiaoniu,
    [services.youdao]: youdao,
    [services.tencent]: tencent,

    // 大模型翻译
    [services.custom]: custom,
    [services.tongyi]: tongyi,
    [services.zhipu]: zhipu,
    [services.yiyan]: yiyan,
    [services.gemini]: gemini,
    [services.claude]: claude,
    [services.infini]: infini,
    [services.minimax]: minimax,
    [services.cozecom]: coze,
    [services.cozecn]: coze,
    [services.deepseek]: deepseek,
    [services.newapi]: newapi,
    // openai schema
    [services.openai]: common,
    [services.moonshot]: common,
    [services.baichuan]: common,
    [services.lingyi]: common,
    [services.jieyue]: common,
    [services.groq]: common,
    [services.huanYuan]: common,
    [services.doubao]: common,
    [services.siliconCloud]: common,
    [services.openrouter]: common,
    [services.grok]: common,
}
