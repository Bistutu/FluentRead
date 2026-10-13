/**
 * 用户脚本的第三方依赖出口。这里只重导出仓库已经使用的库符号，不包含 FluentRead 产品逻辑。
 * 生成产物供 Greasy Fork 源码版通过固定提交的 @require 缓存加载。
 */
import {APICallError, RetryError, generateText} from 'ai';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import sha256 from 'crypto-js/sha256';
import md5 from 'crypto-js/md5';
import hmacSha256 from 'crypto-js/hmac-sha256';
import aes from 'crypto-js/aes';
import encUtf8 from 'crypto-js/enc-utf8';
import encBase64 from 'crypto-js/enc-base64';
import modeEcb from 'crypto-js/mode-ecb';
import padPkcs7 from 'crypto-js/pad-pkcs7';
import DexieImplementation from 'dexie/dist/dexie.min.js';
import {franc, francAll} from 'franc-min';

export const ai = {APICallError, RetryError, generateText};
export const openAICompatible = {createOpenAICompatible};
export const francMin = {franc, francAll};
export const Dexie = DexieImplementation;
export {sha256, md5, hmacSha256, aes, encUtf8, encBase64, modeEcb, padPkcs7};
