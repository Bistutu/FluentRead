import { method } from "../utils/constant";
import { services } from "../utils/option";
import { config } from "@/entrypoints/utils/config";

// 腾讯云机器翻译语言代码映射
const languageMap: Record<string, string> = {
    'zh-Hans': 'zh',
    'zh-Hant': 'zh-TW',
    'en': 'en',
    'ja': 'ja',
    'ko': 'ko',
    'fr': 'fr',
    'ru': 'ru',
    'de': 'de',
    'es': 'es',
    'it': 'it',
    'tr': 'tr',
    'th': 'th',
    'ar': 'ar',
    'pt': 'pt',
    'auto': 'auto'
};

// 生成HMAC签名 (返回二进制数据)
async function generateHmacSignature(key: string | ArrayBuffer, message: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const keyData = typeof key === 'string' ? encoder.encode(key) : key;
    
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

// 将二进制数据转换为十六进制字符串
function arrayBufferToHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// 生成腾讯云API签名
async function createTencentSignature(requestPayload: string, timestamp: number, secretId: string, secretKey: string): Promise<string> {
    const date = new Date(timestamp * 1000).toISOString().substring(0, 10);
    
    // 步骤1：拼接规范请求串
    const httpRequestMethod = "POST";
    const canonicalUri = "/";
    const canonicalQueryString = "";
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:tmt.tencentcloudapi.com\n`;
    const signedHeaders = "content-type;host";
    
    const hashedRequestPayload = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestPayload));
    const hashedPayloadHex = Array.from(new Uint8Array(hashedRequestPayload))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayloadHex}`;
    
    // 步骤2：拼接待签名字符串
    const algorithm = "TC3-HMAC-SHA256";
    const credentialScope = `${date}/tmt/tc3_request`;
    
    const hashedCanonicalRequest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest));
    const hashedCanonicalRequestHex = Array.from(new Uint8Array(hashedCanonicalRequest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequestHex}`;
    
    // 步骤3：计算签名
    const kDate = await generateHmacSignature(`TC3${secretKey}`, date);
    const kService = await generateHmacSignature(kDate, "tmt");
    const kSigning = await generateHmacSignature(kService, "tc3_request");
    const signatureBuffer = await generateHmacSignature(kSigning, stringToSign);
    const signature = arrayBufferToHex(signatureBuffer);
    
    // 步骤4：拼接 Authorization
    const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    
    return authorization;
}

async function tencent(message: any) {
    try {
        // 从配置中获取 SecretId 和 SecretKey
        const secretId = config.tencentSecretId?.trim();
        const secretKey = config.tencentSecretKey?.trim();
        
        if (!secretId || !secretKey) {
            throw new Error('腾讯云机器翻译密钥未配置，请在设置中配置SecretId和SecretKey');
        }
        
        // 基本格式验证
        if (secretId.length < 10 || secretKey.length < 10) {
            throw new Error('SecretId或SecretKey格式不正确，请检查是否完整复制了密钥信息');
        }
        
        // 转换语言代码
        const sourceLang = languageMap[config.from] || config.from;
        const targetLang = languageMap[config.to] || config.to;
        
        if (!targetLang || targetLang === 'auto') {
            throw new Error('腾讯云机器翻译不支持目标语言自动检测');
        }
        
        // 构建JSON请求体
        const requestBody = JSON.stringify({
            SourceText: message.origin,
            Source: sourceLang,
            Target: targetLang,
            ProjectId: 0
        });
        
        const timestamp = Math.floor(Date.now() / 1000);
        
        // 生成签名和Authorization头
        const authorization = await createTencentSignature(requestBody, timestamp, secretId, secretKey);
        
        // 判断是否使用代理
        const url = config.proxy[config.service] || 'https://tmt.tencentcloudapi.com/';
        
        const response = await fetch(url, {
            method: method.POST,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Host': 'tmt.tencentcloudapi.com',
                'Authorization': authorization,
                'X-TC-Action': 'TextTranslate',
                'X-TC-Version': '2018-03-21',
                'X-TC-Region': 'ap-beijing',
                'X-TC-Timestamp': timestamp.toString()
            },
            body: requestBody
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`腾讯云机器翻译请求失败: ${response.status} ${response.statusText}\n${errorText}`);
        }
        
        const result = await response.json();
        
        // 检查是否有错误
        if (result.Response?.Error) {
            throw new Error(`腾讯云机器翻译错误: ${result.Response.Error.Code} - ${result.Response.Error.Message}`);
        }
        
        // 返回翻译结果
        if (result.Response?.TargetText) {
            return result.Response.TargetText;
        } else {
            throw new Error('腾讯云机器翻译返回格式异常');
        }
        
    } catch (error) {
        console.error('腾讯云机器翻译服务调用失败:', error);
        throw error;
    }
}

export default tencent;
