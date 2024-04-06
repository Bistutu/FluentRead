import {Config} from "../utils/model";
import {method} from "../utils/constant";
import {geminiMsgTemplate} from "../utils/template";
import {customModelString, services} from "../utils/option";


async function gemini(config: Config, message: any) {

    let model = config.model[config.service] === customModelString ? config.customModel[config.service] : config.model[config.service]

    let url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.token[services.gemini]}`;
    const resp = await fetch(url, {
        method: method.POST,
        headers: {'Content-Type': 'application/json'},
        body: geminiMsgTemplate(config, message.origin),
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
