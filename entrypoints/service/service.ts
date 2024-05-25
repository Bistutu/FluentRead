import {services} from "../utils/option";
import microsoft from "./microsoft";
import deepl from "./deepl";
import custom from "./custom";
import tongyi from "./tongyi";
import zhipu from "./zhipu";
import yiyan from "./yiyan";
import gemini from "./gemini";
import google from "./google";
import xiaoniu from "./xiaoniu";
import claude from "./claude";
import infini from "@/entrypoints/service/infini";
import baidu from "@/entrypoints/service/baidu";
import minimax from "@/entrypoints/service/minimax";
import common from "@/entrypoints/service/common";
import deeplx from "@/entrypoints/service/deeplx";


export const service = {
    [services.microsoft]: microsoft,
    [services.deepL]: deepl,
    [services.deepLx]:deeplx,
    [services.google]: google,
    [services.openai]: common,
    [services.moonshot]: common,
    [services.custom]: custom,
    [services.tongyi]: tongyi,
    [services.zhipu]: zhipu,
    [services.yiyan]: yiyan,
    [services.gemini]: gemini,
    [services.xiaoniu]: xiaoniu,
    [services.claude]: claude,
    [services.infini]: infini,
    [services.baidu]: baidu,
    [services.baichuan]: common,
    [services.lingyi]: common,
    [services.deepseek]: common,
    [services.minimax]: minimax,
    [services.jieyue]:common,
}
