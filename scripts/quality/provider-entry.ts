/** 质量实验只装配已有匿名 provider；不读取浏览器配置、私有页面或凭据。 */
import {translateMicrosoftTexts} from '@/src/providers/translation/microsoft';
import {translateGoogleText} from '@/src/providers/translation/google';
import {translateFreeWebText} from '@/src/providers/translation/free-web';
import {translateFreeChineseWebText} from '@/src/providers/translation/free-chinese-web';
import {translateOfficialFreeWebText} from '@/src/providers/translation/free-official-web';
import {translateExtraFreeWebText} from '@/src/providers/translation/free-extra-web';
import {translateBilibiliFree} from '@/src/providers/translation/bilibili-free';
import {translateDoubaoWeb} from '@/src/providers/translation/doubao-web';
export {setRuntimeFetch} from '@/src/platform/http/runtime';
export {isLikelyUntranslatedResponse, isClearlyWrongLanguageResponse} from '@/src/core/translation/resultValidation';
export {FREE_TRANSLATION_PROVIDERS} from '@/src/core/config/freeTranslation';

export async function translate(provider: string, text: string, source: string, target: string, signal: AbortSignal): Promise<string> {
    if (provider === 'microsoft') return (await translateMicrosoftTexts([text], source, target, signal, false))[0]!;
    if (provider === 'google') return translateGoogleText(text, source, target, signal, false, 15_000);
    if (provider === 'transmart' || provider === 'yandexFree' || provider === 'volcengineFree') return translateFreeWebText(provider, text, source, target, signal);
    if (provider === 'youdaoFree' || provider === 'icibaFree') return translateFreeChineseWebText(provider, text, source, target, signal);
    if (provider === 'alibabaFree' || provider === 'modernMtFree' || provider === 'laraFree' || provider === 'lingvanexFree') return translateOfficialFreeWebText(provider, text, source, target, signal);
    if (provider === 'reversoFree' || provider === 'apertiumFree') return translateExtraFreeWebText(provider, text, source, target, signal);
    const request = {origin: text, sourceLanguage: source, targetLanguage: target, abortSignal: signal};
    if (provider === 'bilibiliFree') return translateBilibiliFree(request);
    if (provider === 'doubaoWeb') return translateDoubaoWeb(request);
    throw new Error(`Unsupported evaluation provider: ${provider}`);
}
