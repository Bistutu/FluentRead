import {method, urls} from "../utils/constant";
import {services} from "../utils/option";
import {commonMsgTemplate} from "../utils/template";
import CryptoJS from 'crypto-js';
import {config} from "@/entrypoints/utils/config";


// 文档参考：https://open.bigmodel.cn/dev/api#nosdk
async function zhipu(message: any) {
    // 智谱根据 token 获取 secret（签名密钥） 和 expiration
    let token = config.token[services.zhipu];
    let secret, expiration;
    config.extra[services.zhipu] && ({secret, expiration} = config.extra[services.zhipu]);
    if (!secret || expiration <= Date.now()) {
        secret = generateToken(token);
        if (!secret) throw new Error('无法生成令牌');
        // 保存 secret 和 expiration
        config.extra[services.zhipu] = {secret, expiration: Date.now() + 3600000 * 24};
        await storage.setItem('local:config', JSON.stringify(config));
    }

    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Authorization', `Bearer ${secret}`);

    // 发起 fetch 请求
    const resp = await fetch(urls[services.zhipu], {
        method: method.POST,
        headers: headers,
        body: commonMsgTemplate(message.origin)
    });

    if (resp.ok) {
        let result = await resp.json();
        return result.choices[0].message.content;
    } else {
        console.log(resp)
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

function generateToken(APIKey: string) {
    if (!APIKey || !APIKey.includes('.')) {
        console.log("API Key 格式错误：", APIKey)
        return;
    }
    let duration = 3600000 * 24; // 生成的 token 默认24小时后过期
    const [key, secret] = APIKey.split('.');

    return generateJWT(secret, {alg: "HS256", sign_type: "SIGN", typ: "JWT"}, {
        api_key: key,
        exp: Math.floor(Date.now() / 1000) + (duration / 1000),
        timestamp: Math.floor(Date.now() / 1000)
    });
}

// 生成JWT（JSON Web Token）
function generateJWT(secret: string, header: any, payload: any) {
    // 对header和payload部分进行UTF-8编码，然后转换为Base64URL格式
    const encodedHeader = base64UrlSafe(btoa(JSON.stringify(header)));
    const encodedPayload = base64UrlSafe(btoa(JSON.stringify(payload)));
    // 生成 jwt 签名
    let hmacsha256 = base64UrlSafe(CryptoJS.HmacSHA256(encodedHeader + "." + encodedPayload, secret).toString(CryptoJS.enc.Base64))
    return `${encodedHeader}.${encodedPayload}.${hmacsha256}`;
}

// 将Base64字符串转换为Base64URL格式的函数
function base64UrlSafe(base64String: string) {
    return base64String.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default zhipu;
