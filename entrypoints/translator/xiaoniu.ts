import {Config} from "../utils/model";
import {method, urls} from "../utils/constant";
import {services} from "../utils/option";

async function xiaoniu(config: Config, message: any) {
    // 根据需要调整目标语言
    let targetLang = config.to === 'zh-Hans' ? 'zh' : config.to;

    const resp = await fetch(urls[services.xiaoniu], {
        method: method.POST,
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `from=auto&to=${targetLang}&apikey=${config.token[services.xiaoniu]}&src_text=${encodeURIComponent(message.origin)}`
    });

    if (resp.ok) {
        let result = await resp.json();
        return result.tgt_text
    } else {
        console.log(resp)
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default xiaoniu;
