import {services} from "../utils/option";
import {yiyanMsgTemplate} from "../utils/template";
import {method, urls} from "../utils/constant";
import {config} from "@/entrypoints/utils/config";

// ERNIE-Bot 4.0 模型，模型定价页面：https://console.bce.baidu.com/qianfan/chargemanage/list
// api 文档中心：https://cloud.baidu.com/doc/WENXINWORKSHOP/s/clntwmv7t

// 文心一言根据 ak, sk 获取 secret 和 expiration
async function yiyan(message: any) {

    let model = config.model[services.yiyan]
    // model 参数转换
    if (model === "ERNIE-Bot 4.0") model = "completions_pro"
    else if (model === "ERNIE-Bot") model = "completions"
    else if (model === "ERNIE-Speed-8K") model = "ernie_speed"
    else if (model === "ERNIE-Speed-128K") model = "ernie-speed-128k"

    const secret = await getSecret();
    const url = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}?access_token=${secret}`;

    // 发起 fetch 请求
    const resp = await fetch(url, {
        method: method.POST,
        headers: {'Content-Type': 'application/json'},
        body: yiyanMsgTemplate(message.origin)
    });

    if (resp.ok) {
        let result = await resp.json();
        if (result.error_code) throw new Error(`翻译失败: ${result.error_code} ${result.error_msg}`)
        return result.result
    } else {
        console.log(resp)
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

async function getSecret() {
    let secret, expiration;
    config.extra[services.yiyan] && ({secret, expiration} = config.extra[services.yiyan]);

    // 检查 secret 是否存在且未过期
    if (secret && config.ak && config.sk && expiration > Date.now()) return secret;

    // 构建请求参数
    let params = new URLSearchParams({
        'grant_type': 'client_credentials',
        'client_id': config.ak,
        'client_secret': config.sk,
    });

    // 发起 fetch 请求
    const resp = await fetch(urls[config.service].tokenUrl, {
        method: method.POST,
        body: params
    });

    const res = await resp.json();
    if (resp.ok && res.access_token) {
        // 获取有效时间范围，有效期30天（单位秒），需 x1000 转换为毫秒
        let expiration = new Date().getTime() + res.expires_in * 1000;
        // 缓存 secret 和 expiration
        config.extra[services.yiyan] = {secret: res.access_token, expiration: expiration};
        storage.setItem('local:config', JSON.stringify(config));
        return res.access_token;
    } else throw new Error(res.error_description || '文心一言获取 token 失败');
}

export default yiyan;