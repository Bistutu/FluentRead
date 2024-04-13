import {services} from "../utils/option";
import microsoft from "./microsoft";
import deepl from "./deepl";
import openai from "./openai";
import moonshot from "./moonshot";
import ollama from "./ollama";
import tongyi from "./tongyi";
import zhipu from "./zhipu";
import yiyan from "./yiyan";
import gemini from "./gemini";
import google from "./google";
import xiaoniu from "./xiaoniu";
import claude from "./claude";
import infini from "@/entrypoints/translator/infini";
import baidu from "@/entrypoints/translator/baidu";


export const translator = {
    [services.microsoft]: microsoft,
    [services.deepL]: deepl,
    [services.google]: google,
    [services.openai]: openai,
    [services.moonshot]: moonshot,
    [services.ollama]: ollama,
    [services.tongyi]: tongyi,
    [services.zhipu]: zhipu,
    [services.yiyan]: yiyan,
    [services.gemini]: gemini,
    [services.xiaoniu]: xiaoniu,
    [services.claude]: claude,
    [services.infini]: infini,
    [services.baidu]: baidu,
}
