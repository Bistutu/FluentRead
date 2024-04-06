import {Config} from "../utils/model";
import {ollamaMsgTemplate} from "../utils/template";
import {method} from "../utils/constant";

async function ollama(config: Config, message: any) {
    const resp = await fetch(config.native, {
        method: method.POST,
        headers: {'Content-Type': 'application/json'},
        body: ollamaMsgTemplate(config, message.origin)
    });

    if (resp.ok) {
        let result = await resp.json();
        return result.choices[0].message.content
    } else {
        console.log("翻译失败：", resp);
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default ollama;