import {method} from "../utils/constant";
import {geminiMsgTemplate} from "../utils/template";
import {customModelString} from "../utils/option";
import {config} from "@/entrypoints/utils/config";


async function gemini(message: any) {
    const service = message.serviceOverride || config.service;

    let model = config.model[service] === customModelString ? config.customModel[service] : config.model[service]

    // 判断是否使用代理
    let url: string = config.proxy[service] ?
        config.proxy[service] : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.token[service]}`;

    const resp = await fetch(url, {
        method: method.POST,
        headers: {'Content-Type': 'application/json'},
        body: geminiMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage),
    });
    if (resp.ok) {
        let result = await resp.json();
        return result.candidates[0].content.parts[0].text;
    } else {
        console.log(resp)
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default gemini;
