import { method } from "../utils/constant";
import { config } from "@/entrypoints/utils/config";
import CryptoJS from 'crypto-js';

interface YoudaoResponse {
  errorCode: string;
  translation: string[];
  basic?: {
    explains: string[];
  };
}

async function youdao(message: any): Promise<string> {
  // 检查必需的配置
  if (!config.youdaoAppKey || !config.youdaoAppSecret) {
    throw new Error('请先配置有道翻译的 App Key 和 App Secret');
  }

  const appKey = config.youdaoAppKey;
  const appSecret = config.youdaoAppSecret;
  const query = message.origin;
  const salt = Date.now().toString();
  const curtime = Math.round(Date.now() / 1000).toString();

  // 生成签名
  function generateSign(appKey: string, query: string, salt: string, curtime: string, appSecret: string): string {
    let str1 = appKey + truncate(query) + salt + curtime + appSecret;
    return CryptoJS.SHA256(str1).toString(CryptoJS.enc.Hex);
  }

  // 截取函数（用于签名计算）
  function truncate(q: string): string {
    const len = q.length;
    if (len <= 20) return q;
    return q.substring(0, 10) + len + q.substring(len - 10, len);
  }

  // 语言代码映射
  const langMap: { [key: string]: string } = {
    'auto': 'auto',
    'zh-Hans': 'zh-CHS',
    'zh-Hant': 'zh-CHT',
    'en': 'en',
    'ja': 'ja',
    'ko': 'ko',
    'fr': 'fr',
    'es': 'es',
    'pt': 'pt',
    'it': 'it',
    'vi': 'vi',
    'de': 'de',
    'ar': 'ar',
    'id': 'id',
    'af': 'af',
    'bs': 'bs',
    'bg': 'bg',
    'ca': 'ca',
    'hr': 'hr',
    'cs': 'cs',
    'da': 'da',
    'nl': 'nl',
    'et': 'et',
    'fj': 'fj',
    'fi': 'fi',
    'el': 'el',
    'ht': 'ht',
    'he': 'he',
    'hi': 'hi',
    'mww': 'mww',
    'hu': 'hu',
    'sw': 'sw',
    'tlh': 'tlh',
    'lv': 'lv',
    'lt': 'lt',
    'ms': 'ms',
    'mt': 'mt',
    'no': 'no',
    'fa': 'fa',
    'pl': 'pl',
    'otq': 'otq',
    'ro': 'ro',
    'ru': 'ru',
    'sr-Cyrl': 'sr-Cyrl',
    'sr-Latn': 'sr-Latn',
    'sk': 'sk',
    'sl': 'sl',
    'sv': 'sv',
    'ty': 'ty',
    'th': 'th',
    'to': 'to',
    'tr': 'tr',
    'uk': 'uk',
    'ur': 'ur',
    'cy': 'cy',
    'yua': 'yua',
    'yue': 'yue'
  };

  const fromLang = langMap[config.from] || 'auto';
  const toLang = langMap[config.to] || 'zh-CHS';

  const sign = generateSign(appKey, query, salt, curtime, appSecret);

  // 构建请求参数
  const params = new URLSearchParams({
    q: query,
    from: fromLang,
    to: toLang,
    appKey: appKey,
    salt: salt,
    sign: sign,
    signType: 'v3',
    curtime: curtime
  });

  try {
    const response = await fetch('https://openapi.youdao.com/api', {
      method: method.POST,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result: YoudaoResponse = await response.json();

    // 处理错误码
    if (result.errorCode !== '0') {
      const errorMessages: { [key: string]: string } = {
        '101': '缺少必填的参数',
        '102': '不支持的语言类型',
        '103': '翻译文本过长',
        '104': '不支持的API类型',
        '105': '不支持的签名类型',
        '106': '不支持的响应类型',
        '107': '不支持的传输加密类型',
        '108': 'appKey无效',
        '109': 'batchLog格式不正确',
        '110': '无相关服务的有效实例',
        '111': '开发者账号无效',
        '113': 'q不能为空',
        '201': '解密失败',
        '202': '签名检验失败',
        '203': '访问IP地址不在可访问IP列表',
        '301': '辞典查询失败',
        '302': '翻译查询失败',
        '303': '服务端的其它异常',
        '401': '账户已经欠费',
        '411': '访问频率受限',
        '412': '长请求过于频繁'
      };
      
      const errorMsg = errorMessages[result.errorCode] || `未知错误(${result.errorCode})`;
      throw new Error(`有道翻译API错误: ${errorMsg}`);
    }

    // 返回翻译结果
    if (result.translation && result.translation.length > 0) {
      return result.translation.join(' ');
    } else {
      throw new Error('翻译结果为空');
    }

  } catch (error: any) {
    console.error('有道翻译错误:', error);
    throw new Error(`翻译失败: ${error.message || error}`);
  }
}

export default youdao;
